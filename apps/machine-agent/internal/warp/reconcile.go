// SPDX-License-Identifier: AGPL-3.0-only

package warp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Request struct {
	Enabled   bool   `json:"enabled"`
	ProxyPort uint16 `json:"proxyPort"`
	Mode      string `json:"mode"`
}

type Result struct {
	Enabled   bool   `json:"enabled"`
	ProxyPort uint16 `json:"proxyPort"`
	Version   string `json:"version"`
	Status    string `json:"status"`
	Ownership string `json:"ownership"`
}

type Ownership struct {
	Version           int       `json:"version"`
	MachineID         string    `json:"machineId"`
	State             string    `json:"state"`
	AdoptedFromPlanID string    `json:"adoptedFromPlanId,omitempty"`
	AdoptedAt         time.Time `json:"adoptedAt,omitempty"`
}

type Runner interface {
	Run(ctx context.Context, name string, arguments ...string) ([]byte, error)
}

type CommandRunner struct{}

func (CommandRunner) Run(ctx context.Context, name string, arguments ...string) ([]byte, error) {
	return exec.CommandContext(ctx, name, arguments...).CombinedOutput()
}

type Handler struct {
	ManagedRoot string
	MachineID   string
	Runner      Runner
	LookupPath  func(string) (string, error)
	Relay       func(context.Context, uint16) error
	mu          sync.Mutex
	listener    net.Listener
}

func NewHandler(managedRoot, machineID string) *Handler {
	return &Handler{ManagedRoot: managedRoot, MachineID: machineID, Runner: CommandRunner{}}
}

func (h *Handler) Execute(ctx context.Context, payload json.RawMessage) (any, error) {
	request, err := decode(payload)
	if err != nil {
		return nil, err
	}
	if !request.Enabled || request.ProxyPort != 40000 || (request.Mode != "REUSE_EXTERNAL" && request.Mode != "INSTALL_OR_REPAIR_MANAGED") {
		return nil, errors.New("WARP may only be enabled on the managed proxy port 40000")
	}
	if !regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`).MatchString(h.MachineID) {
		return nil, errors.New("WARP Machine ownership identity is invalid")
	}
	if request.Mode == "REUSE_EXTERNAL" {
		if err := h.verifyCompatibleExternal(ctx, request.ProxyPort); err != nil {
			return nil, err
		}
		if err := h.ensureRelayAction(ctx, request.ProxyPort); err != nil {
			return nil, err
		}
		version, err := h.run(ctx, "warp-cli", "--version")
		if err != nil {
			return nil, err
		}
		return Result{Enabled: true, ProxyPort: request.ProxyPort, Version: strings.TrimSpace(string(version)), Status: "CONNECTED", Ownership: "EXTERNAL"}, nil
	}
	lookup := h.LookupPath
	if lookup == nil {
		lookup = exec.LookPath
	}
	if _, err := lookup("warp-cli"); err == nil {
		ownership, ownershipErr := ReadOwnership(h.ManagedRoot)
		if ownershipErr != nil || ownership.MachineID != h.MachineID {
			return nil, errors.New("WARP_TAKEOVER_REQUIRED: existing WARP is not owned by this Machine")
		}
	} else {
		ownership, ownershipErr := ReadOwnership(h.ManagedRoot)
		if ownershipErr == nil {
			if ownership.MachineID != h.MachineID {
				return nil, errors.New("WARP_OWNED_BY_ANOTHER_MACHINE: ownership cannot be replaced")
			}
		} else if !errors.Is(ownershipErr, os.ErrNotExist) {
			return nil, fmt.Errorf("WARP_OWNERSHIP_UNSAFE: %w", ownershipErr)
		} else if err := writeOwnership(h.ManagedRoot, Ownership{Version: 1, MachineID: h.MachineID, State: "INSTALLING"}); err != nil {
			return nil, err
		}
	}
	if err := h.ensureInstalled(ctx); err != nil {
		return nil, err
	}
	if _, err := h.run(ctx, "systemctl", "enable", "--now", "warp-svc"); err != nil {
		return nil, err
	}
	if _, err := h.run(ctx, "warp-cli", "registration", "show"); err != nil {
		if _, err := h.run(ctx, "warp-cli", "--accept-tos", "registration", "new"); err != nil {
			return nil, err
		}
	}
	commands := [][]string{
		{"warp-cli", "--accept-tos", "tunnel", "protocol", "set", "MASQUE"},
		{"warp-cli", "--accept-tos", "mode", "proxy"},
		{"warp-cli", "--accept-tos", "proxy", "port", strconv.Itoa(int(request.ProxyPort))},
		{"warp-cli", "--accept-tos", "connect"},
	}
	for _, command := range commands {
		if _, err := h.run(ctx, command[0], command[1:]...); err != nil {
			return nil, err
		}
	}
	status := ""
	for attempt := 0; attempt < 15; attempt++ {
		output, statusErr := h.run(ctx, "warp-cli", "--accept-tos", "status")
		status = strings.TrimSpace(string(output))
		if statusErr == nil && statusConnected(status) {
			break
		}
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(2 * time.Second):
		}
	}
	if !statusConnected(status) {
		return nil, errors.New("WARP did not reach the connected state")
	}
	if err := h.persistDesired(request); err != nil {
		return nil, err
	}
	currentOwnership, _ := ReadOwnership(h.ManagedRoot)
	if err := writeOwnership(h.ManagedRoot, Ownership{
		Version:           1,
		MachineID:         h.MachineID,
		State:             "MANAGED",
		AdoptedFromPlanID: currentOwnership.AdoptedFromPlanID,
		AdoptedAt:         currentOwnership.AdoptedAt,
	}); err != nil {
		return nil, err
	}
	if err := h.ensureRelayAction(ctx, request.ProxyPort); err != nil {
		return nil, err
	}
	version, err := h.run(ctx, "warp-cli", "--version")
	if err != nil {
		return nil, err
	}
	return Result{Enabled: true, ProxyPort: request.ProxyPort, Version: strings.TrimSpace(string(version)), Status: "CONNECTED", Ownership: "MANAGED"}, nil
}

func (h *Handler) verifyCompatibleExternal(ctx context.Context, proxyPort uint16) error {
	lookup := h.LookupPath
	if lookup == nil {
		lookup = exec.LookPath
	}
	if _, err := lookup("warp-cli"); err != nil {
		return errors.New("WARP_EXTERNAL_INCOMPATIBLE: warp-cli is unavailable")
	}
	if _, err := h.run(ctx, "warp-cli", "registration", "show"); err != nil {
		return errors.New("WARP_EXTERNAL_INCOMPATIBLE: WARP is not registered")
	}
	settings, err := h.run(ctx, "warp-cli", "settings")
	if err != nil {
		return errors.New("WARP_EXTERNAL_INCOMPATIBLE: WARP settings cannot be inspected")
	}
	lowerSettings := strings.ToLower(string(settings))
	if !strings.Contains(lowerSettings, "proxy") || !strings.Contains(lowerSettings, strconv.Itoa(int(proxyPort))) {
		return errors.New("WARP_EXTERNAL_INCOMPATIBLE: WARP must already use proxy mode on port 40000")
	}
	status, err := h.run(ctx, "warp-cli", "status")
	if err != nil || !statusConnected(string(status)) {
		return errors.New("WARP_EXTERNAL_INCOMPATIBLE: WARP is not connected")
	}
	return nil
}

func statusConnected(message string) bool {
	lower := strings.ToLower(message)
	return strings.Contains(lower, "connected") && !strings.Contains(lower, "disconnected")
}

func (h *Handler) ensureRelayAction(ctx context.Context, port uint16) error {
	if h.Relay != nil {
		return h.Relay(ctx, port)
	}
	return h.ensureRelay(ctx, port)
}

func decode(payload json.RawMessage) (Request, error) {
	decoder := json.NewDecoder(strings.NewReader(string(payload)))
	decoder.DisallowUnknownFields()
	var request Request
	if err := decoder.Decode(&request); err != nil {
		return Request{}, fmt.Errorf("decode WARP payload: %w", err)
	}
	return request, nil
}

func (h *Handler) ensureInstalled(ctx context.Context) error {
	lookup := h.LookupPath
	if lookup == nil {
		lookup = exec.LookPath
	}
	if _, err := lookup("warp-cli"); err == nil {
		return nil
	}
	osRelease, err := os.ReadFile("/etc/os-release")
	if err != nil {
		return errors.New("WARP installation requires Debian 12/13 or Ubuntu 22.04/24.04")
	}
	codename := parseOSRelease(string(osRelease), "VERSION_CODENAME")
	osID := parseOSRelease(string(osRelease), "ID")
	if !isSupportedPlatform(osID, codename) {
		return errors.New("WARP installation is unsupported on this operating system")
	}
	temporaryKey := filepath.Join(os.TempDir(), "myremnawave-cloudflare-warp-key.gpg")
	defer os.Remove(temporaryKey)
	if _, err := h.run(ctx, "curl", "--fail", "--silent", "--show-error", "--location", "--proto", "=https", "--tlsv1.2", "--output", temporaryKey, "https://pkg.cloudflareclient.com/pubkey.gpg"); err != nil {
		return err
	}
	keyring := "/usr/share/keyrings/cloudflare-warp-archive-keyring.gpg"
	if _, err := h.run(ctx, "gpg", "--batch", "--yes", "--dearmor", "--output", keyring, temporaryKey); err != nil {
		return err
	}
	repository := fmt.Sprintf("deb [signed-by=%s] https://pkg.cloudflareclient.com/ %s main\n", keyring, codename)
	if err := atomicWrite("/etc/apt/sources.list.d/cloudflare-client.list", []byte(repository), 0o644); err != nil {
		return err
	}
	if _, err := h.run(ctx, "apt-get", "update"); err != nil {
		return err
	}
	_, err = h.run(ctx, "apt-get", "install", "--assume-yes", "--no-install-recommends", "cloudflare-warp")
	return err
}

func ownershipPath(root string) (string, error) {
	if !filepath.IsAbs(root) {
		return "", errors.New("managed root must be absolute")
	}
	return filepath.Join(filepath.Clean(root), "warp", "ownership.json"), nil
}

func ReadOwnership(root string) (Ownership, error) {
	var ownership Ownership
	path, err := ownershipPath(root)
	if err != nil {
		return ownership, err
	}
	info, err := os.Lstat(path)
	if err != nil {
		return ownership, err
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return ownership, errors.New("WARP ownership path is unsafe")
	}
	content, err := os.ReadFile(path)
	if err != nil {
		return ownership, err
	}
	decoder := json.NewDecoder(strings.NewReader(string(content)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&ownership); err != nil {
		return Ownership{}, err
	}
	validState := ownership.State == "INSTALLING" || ownership.State == "MANAGED" || ownership.State == "ADOPTED"
	validAdoption := ownership.State != "ADOPTED" || (uuidPattern.MatchString(ownership.AdoptedFromPlanID) && !ownership.AdoptedAt.IsZero())
	if ownership.Version != 1 || !uuidPattern.MatchString(ownership.MachineID) || !validState || !validAdoption {
		return Ownership{}, errors.New("WARP ownership record is invalid")
	}
	return ownership, nil
}

func writeOwnership(root string, ownership Ownership) error {
	path, err := ownershipPath(root)
	if err != nil {
		return err
	}
	if err := secureDirectory(filepath.Clean(root)); err != nil {
		return err
	}
	if err := secureDirectory(filepath.Dir(path)); err != nil {
		return err
	}
	content, err := json.Marshal(ownership)
	if err != nil {
		return err
	}
	return atomicWrite(path, content, 0o600)
}

func isSupportedPlatform(osID, codename string) bool {
	switch osID {
	case "debian":
		return codename == "bookworm" || codename == "trixie"
	case "ubuntu":
		return codename == "jammy" || codename == "noble"
	default:
		return false
	}
}

func (h *Handler) ensureRelay(ctx context.Context, port uint16) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.listener != nil {
		return nil
	}
	output, err := h.run(ctx, "docker", "network", "inspect", "--format", `{{(index .IPAM.Config 0).Gateway}}`, "myremnawave")
	if err != nil {
		return err
	}
	gateway := strings.TrimSpace(string(output))
	gatewayIP := net.ParseIP(gateway)
	if gatewayIP == nil || gatewayIP.IsUnspecified() || gatewayIP.IsLoopback() || !gatewayIP.IsPrivate() {
		return errors.New("Docker managed network returned an invalid gateway")
	}
	listener, err := net.Listen("tcp", net.JoinHostPort(gateway, strconv.Itoa(int(port))))
	if err != nil {
		return fmt.Errorf("listen on Docker-only WARP relay: %w", err)
	}
	h.listener = listener
	go h.serveRelay(listener, net.JoinHostPort("127.0.0.1", strconv.Itoa(int(port))))
	return nil
}

func (h *Handler) serveRelay(listener net.Listener, target string) {
	for {
		client, err := listener.Accept()
		if err != nil {
			return
		}
		go relayConnection(client, target)
	}
}

func relayConnection(client net.Conn, target string) {
	defer client.Close()
	upstream, err := net.DialTimeout("tcp", target, 10*time.Second)
	if err != nil {
		return
	}
	defer upstream.Close()
	done := make(chan struct{}, 2)
	go func() { _, _ = io.Copy(upstream, client); done <- struct{}{} }()
	go func() { _, _ = io.Copy(client, upstream); done <- struct{}{} }()
	<-done
}

func (h *Handler) persistDesired(request Request) error {
	directory := filepath.Join(filepath.Clean(h.ManagedRoot), "warp")
	if !filepath.IsAbs(directory) {
		return errors.New("managed root must be absolute")
	}
	if err := secureDirectory(filepath.Clean(h.ManagedRoot)); err != nil {
		return err
	}
	if err := secureDirectory(directory); err != nil {
		return err
	}
	content, _ := json.Marshal(request)
	return atomicWrite(filepath.Join(directory, "desired.json"), content, 0o600)
}

func secureDirectory(path string) error {
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		if err := os.MkdirAll(path, 0o700); err != nil {
			return err
		}
		info, err = os.Lstat(path)
	}
	if err != nil {
		return err
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
		return errors.New("managed WARP path must be a real directory")
	}
	return os.Chmod(path, 0o700)
}

func (h *Handler) run(ctx context.Context, name string, arguments ...string) ([]byte, error) {
	runner := h.Runner
	if runner == nil {
		runner = CommandRunner{}
	}
	output, err := runner.Run(ctx, name, arguments...)
	if err == nil {
		return output, nil
	}
	message := strings.TrimSpace(string(output))
	if len(message) > 1024 {
		message = message[:1024]
	}
	if message == "" {
		message = err.Error()
	}
	return output, fmt.Errorf("%s failed: %s", name, message)
}

func parseOSRelease(content, key string) string {
	pattern := regexp.MustCompile(`(?m)^` + regexp.QuoteMeta(key) + `=(?:"([^"]+)"|([^\n]+))$`)
	match := pattern.FindStringSubmatch(content)
	if len(match) == 0 {
		return ""
	}
	if match[1] != "" {
		return match[1]
	}
	return strings.TrimSpace(match[2])
}

func atomicWrite(path string, content []byte, mode os.FileMode) error {
	if info, err := os.Lstat(path); err == nil && (info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular()) {
		return errors.New("managed WARP file path is unsafe")
	} else if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), ".myremnawave-*")
	if err != nil {
		return err
	}
	name := temporary.Name()
	defer os.Remove(name)
	if err := temporary.Chmod(mode); err != nil {
		temporary.Close()
		return err
	}
	if _, err := temporary.Write(content); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	return os.Rename(name, path)
}
