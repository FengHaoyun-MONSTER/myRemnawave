// SPDX-License-Identifier: AGPL-3.0-only

package instance

import (
	"context"
	"crypto/ecdh"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
)

const managedNetwork = "myremnawave"

var (
	uuidPattern   = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)
	imagePattern  = regexp.MustCompile(`^remnawave/node@sha256:[0-9a-f]{64}$`)
	secretPattern = regexp.MustCompile(`^[A-Za-z0-9+/=_-]+$`)
)

type Request struct {
	InstanceID    string   `json:"instanceId"`
	Protocol      string   `json:"protocol"`
	Image         string   `json:"image"`
	ControlPort   uint16   `json:"controlPort"`
	ExternalPort  uint16   `json:"externalPort"`
	FallbackPorts []uint16 `json:"fallbackPorts,omitempty"`
	Network       string   `json:"network"`
	SecretKey     string   `json:"secretKey"`
}

type Result struct {
	InstanceID       string `json:"instanceId"`
	ContainerName    string `json:"containerName"`
	ConfigHash       string `json:"configHash"`
	ExternalPort     uint16 `json:"externalPort"`
	RealityPublicKey string `json:"realityPublicKey,omitempty"`
	RealityShortID   string `json:"realityShortId,omitempty"`
}

type PortProbe interface {
	Available(ctx context.Context, network string, port uint16) (bool, string)
}

type NetPortProbe struct{}

func (NetPortProbe) Available(_ context.Context, network string, port uint16) (bool, string) {
	address := fmt.Sprintf("0.0.0.0:%d", port)
	if network == "tcp" {
		listener, err := net.Listen("tcp4", address)
		if err != nil {
			return false, "TCP port is occupied or unavailable"
		}
		_ = listener.Close()
		return true, "TCP port is available"
	}
	connection, err := net.ListenPacket("udp4", address)
	if err != nil {
		return false, "UDP port is occupied or unavailable"
	}
	_ = connection.Close()
	return true, "UDP port is available"
}

type Runner interface {
	Run(ctx context.Context, arguments ...string) ([]byte, error)
}

type DockerRunner struct{}

func (DockerRunner) Run(ctx context.Context, arguments ...string) ([]byte, error) {
	return exec.CommandContext(ctx, "docker", arguments...).CombinedOutput()
}

type Handler struct {
	ManagedRoot string
	MachineID   string
	Runner      Runner
	Probe       PortProbe
}

func (h Handler) Execute(ctx context.Context, payload json.RawMessage) (any, error) {
	request, err := decode(payload)
	if err != nil {
		return nil, err
	}
	if err := validate(request); err != nil {
		return nil, err
	}
	if !uuidPattern.MatchString(h.MachineID) {
		return nil, errors.New("Machine ownership identity is invalid")
	}
	containerName := "myremnawave-" + strings.ReplaceAll(request.InstanceID, "-", "")[:16]
	runner := h.Runner
	if runner == nil {
		runner = DockerRunner{}
	}
	containerExists, currentHash, err := inspectContainer(ctx, runner, containerName, h.MachineID, request.InstanceID)
	if err != nil {
		return nil, err
	}
	if !containerExists {
		selectedPort, selectErr := selectExternalPort(ctx, h.portProbe(), request)
		if selectErr != nil {
			return nil, selectErr
		}
		request.ExternalPort = selectedPort
	}
	root, err := secureRoot(h.ManagedRoot)
	if err != nil {
		return nil, err
	}
	instanceDir := filepath.Join(root, "instances", request.InstanceID)
	if err := secureDirectory(instanceDir, 0o700); err != nil {
		return nil, err
	}
	certDir := filepath.Join(instanceDir, "certs")
	if err := secureDirectory(certDir, 0o700); err != nil {
		return nil, err
	}
	if err := writePrivateFile(filepath.Join(instanceDir, "node.env"), []byte("NODE_PORT=2222\nSECRET_KEY="+request.SecretKey+"\n")); err != nil {
		return nil, err
	}

	publicKey, shortID, err := ensureRealityMaterial(instanceDir, request.Protocol)
	if err != nil {
		return nil, err
	}
	hash := desiredHash(request)
	if err := ensureManagedNetwork(ctx, runner, h.MachineID); err != nil {
		return nil, err
	}
	if output, err := runner.Run(ctx, "pull", request.Image); err != nil {
		return nil, commandError("IMAGE_PULL_FAILED", output, err)
	}

	if containerExists && currentHash == hash {
		if output, err := runner.Run(ctx, "start", containerName); err != nil && !strings.Contains(string(output), "already running") {
			return nil, commandError("CONTAINER_START_FAILED", output, err)
		}
		return Result{InstanceID: request.InstanceID, ContainerName: containerName, ConfigHash: hash, ExternalPort: request.ExternalPort, RealityPublicKey: publicKey, RealityShortID: shortID}, nil
	}
	if containerExists {
		_, _ = runner.Run(ctx, "stop", "--time", "30", containerName)
		if output, err := runner.Run(ctx, "rm", containerName); err != nil {
			return nil, commandError("CONTAINER_REMOVE_FAILED", output, err)
		}
	}

	arguments := dockerRunArguments(request, containerName, instanceDir, certDir, hash, h.MachineID)
	if output, err := runner.Run(ctx, arguments...); err != nil {
		if containerExists || !isPortBindConflict(output, err) {
			return nil, commandError("CONTAINER_RUN_FAILED", output, err)
		}
		if cleanupErr := removeFailedOwnedContainer(ctx, runner, containerName, h.MachineID, request.InstanceID); cleanupErr != nil {
			return nil, cleanupErr
		}
		retryPort, retryErr := selectExternalPortExcluding(ctx, h.portProbe(), request, request.ExternalPort)
		if retryErr != nil {
			return nil, errors.New("PORT_BIND_RACE_EXHAUSTED: no fallback port remained after the Docker bind race")
		}
		request.ExternalPort = retryPort
		hash = desiredHash(request)
		arguments = dockerRunArguments(request, containerName, instanceDir, certDir, hash, h.MachineID)
		if retryOutput, retryRunErr := runner.Run(ctx, arguments...); retryRunErr != nil {
			if cleanupErr := removeFailedOwnedContainer(ctx, runner, containerName, h.MachineID, request.InstanceID); cleanupErr != nil {
				return nil, cleanupErr
			}
			if isPortBindConflict(retryOutput, retryRunErr) {
				return nil, errors.New("PORT_BIND_RACE_EXHAUSTED: the single fallback bind attempt also conflicted")
			}
			return nil, commandError("CONTAINER_RUN_FAILED", retryOutput, retryRunErr)
		}
	}
	return Result{InstanceID: request.InstanceID, ContainerName: containerName, ConfigHash: hash, ExternalPort: request.ExternalPort, RealityPublicKey: publicKey, RealityShortID: shortID}, nil
}

func dockerRunArguments(request Request, containerName, instanceDir, certDir, hash, machineID string) []string {
	return []string{
		"run", "-d", "--name", containerName,
		"--restart", "unless-stopped",
		"--network", managedNetwork,
		"--add-host", "host.docker.internal:host-gateway",
		"--label", managedLabel + "=true",
		"--label", machineLabel + "=" + machineID,
		"--label", instanceLabel + "=" + request.InstanceID,
		"--label", configHashLabel + "=" + hash,
		"--env-file", filepath.Join(instanceDir, "node.env"),
		"--mount", "type=bind,src=" + certDir + ",dst=/etc/myremnawave/certs,readonly",
		"--publish", fmt.Sprintf("127.0.0.1:%d:2222/tcp", request.ControlPort),
		"--publish", fmt.Sprintf("%d:%d/%s", request.ExternalPort, request.ExternalPort, request.Network),
		request.Image,
	}
}

func (h Handler) portProbe() PortProbe {
	if h.Probe != nil {
		return h.Probe
	}
	return NetPortProbe{}
}

func selectExternalPort(ctx context.Context, probe PortProbe, request Request) (uint16, error) {
	ports := append([]uint16{request.ExternalPort}, request.FallbackPorts...)
	for _, port := range ports {
		available, _ := probe.Available(ctx, request.Network, port)
		if available {
			return port, nil
		}
	}
	return 0, errors.New("PORT_POOL_EXHAUSTED: no requested external port is available")
}

func selectExternalPortExcluding(ctx context.Context, probe PortProbe, request Request, excluded uint16) (uint16, error) {
	ports := append([]uint16{request.ExternalPort}, request.FallbackPorts...)
	for _, port := range ports {
		if port == excluded {
			continue
		}
		available, _ := probe.Available(ctx, request.Network, port)
		if available {
			return port, nil
		}
	}
	return 0, errors.New("no remaining external port is available")
}

func isPortBindConflict(output []byte, err error) bool {
	message := strings.ToLower(strings.TrimSpace(string(output)) + " " + err.Error())
	return strings.Contains(message, "port is already allocated") ||
		strings.Contains(message, "address already in use") ||
		strings.Contains(message, "failed to bind port") ||
		(strings.Contains(message, "bind for") && strings.Contains(message, "failed"))
}

func removeFailedOwnedContainer(ctx context.Context, runner Runner, name, machineID, instanceID string) error {
	exists, _, err := inspectContainer(ctx, runner, name, machineID, instanceID)
	if err != nil {
		return err
	}
	if !exists {
		return nil
	}
	if output, err := runner.Run(ctx, "rm", name); err != nil {
		return commandError("CONTAINER_REMOVE_FAILED", output, err)
	}
	return nil
}

func decode(payload json.RawMessage) (Request, error) {
	decoder := json.NewDecoder(strings.NewReader(string(payload)))
	decoder.DisallowUnknownFields()
	var request Request
	if err := decoder.Decode(&request); err != nil {
		return Request{}, fmt.Errorf("decode reconcile instance payload: %w", err)
	}
	return request, nil
}

func validate(request Request) error {
	if !uuidPattern.MatchString(request.InstanceID) {
		return errors.New("instanceId must be a lowercase UUID")
	}
	expected := map[string]struct {
		control uint16
		network string
	}{
		"VLESS_REALITY":    {2222, "tcp"},
		"VLESS_TLS_VISION": {2223, "tcp"},
		"HYSTERIA2":        {2224, "udp"},
	}
	definition, ok := expected[request.Protocol]
	if !ok || definition.control != request.ControlPort || definition.network != request.Network {
		return errors.New("protocol, controlPort, and network are inconsistent")
	}
	if request.ExternalPort == 0 {
		return errors.New("externalPort is required")
	}
	if request.ExternalPort >= 2222 && request.ExternalPort <= 2224 {
		return errors.New("external ports 2222-2224 are reserved for local control")
	}
	if len(request.FallbackPorts) > 15 {
		return errors.New("at most fifteen fallback ports are allowed")
	}
	seenPorts := map[uint16]struct{}{request.ExternalPort: {}}
	for _, port := range request.FallbackPorts {
		if port == 0 {
			return errors.New("fallback ports must be between 1 and 65535")
		}
		if port >= 2222 && port <= 2224 {
			return errors.New("fallback ports 2222-2224 are reserved for local control")
		}
		if _, duplicate := seenPorts[port]; duplicate {
			return errors.New("fallback ports must be unique")
		}
		seenPorts[port] = struct{}{}
	}
	if !imagePattern.MatchString(request.Image) {
		return errors.New("image must be a digest-pinned remnawave/node image")
	}
	if len(request.SecretKey) < 100 || len(request.SecretKey) > 262144 || !secretPattern.MatchString(request.SecretKey) {
		return errors.New("secretKey is invalid")
	}
	return nil
}

func secureRoot(root string) (string, error) {
	if !filepath.IsAbs(root) {
		return "", errors.New("managed root must be absolute")
	}
	root = filepath.Clean(root)
	if err := secureDirectory(root, 0o700); err != nil {
		return "", err
	}
	if err := secureDirectory(filepath.Join(root, "instances"), 0o700); err != nil {
		return "", err
	}
	return root, nil
}

func secureDirectory(path string, mode os.FileMode) error {
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		if err := os.MkdirAll(path, mode); err != nil {
			return fmt.Errorf("create managed directory: %w", err)
		}
		info, err = os.Lstat(path)
	}
	if err != nil {
		return fmt.Errorf("inspect managed directory: %w", err)
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
		return errors.New("managed path must be a real directory")
	}
	return os.Chmod(path, mode)
}

func writePrivateFile(path string, content []byte) error {
	temporary, err := os.CreateTemp(filepath.Dir(path), ".private-*")
	if err != nil {
		return fmt.Errorf("create temporary private file: %w", err)
	}
	temporaryName := temporary.Name()
	defer os.Remove(temporaryName)
	if err := temporary.Chmod(0o600); err != nil {
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
	return os.Rename(temporaryName, path)
}

func ensureRealityMaterial(instanceDir, protocol string) (string, string, error) {
	if protocol != "VLESS_REALITY" {
		return "", "", nil
	}
	privatePath := filepath.Join(instanceDir, "reality.key")
	shortPath := filepath.Join(instanceDir, "reality.short-id")
	if privateRaw, err := os.ReadFile(privatePath); err == nil {
		privateKey, decodeErr := base64.RawURLEncoding.DecodeString(strings.TrimSpace(string(privateRaw)))
		if decodeErr != nil {
			return "", "", errors.New("stored Reality private key is invalid")
		}
		key, keyErr := ecdh.X25519().NewPrivateKey(privateKey)
		if keyErr != nil {
			return "", "", errors.New("stored Reality private key is invalid")
		}
		shortID, readErr := os.ReadFile(shortPath)
		if readErr != nil || !regexp.MustCompile(`^[0-9a-f]{16}$`).Match(shortID) {
			return "", "", errors.New("stored Reality short ID is invalid")
		}
		return base64.RawURLEncoding.EncodeToString(key.PublicKey().Bytes()), string(shortID), nil
	}
	key, err := ecdh.X25519().GenerateKey(rand.Reader)
	if err != nil {
		return "", "", fmt.Errorf("generate Reality key: %w", err)
	}
	shortBytes := make([]byte, 8)
	if _, err := rand.Read(shortBytes); err != nil {
		return "", "", fmt.Errorf("generate Reality short ID: %w", err)
	}
	privateEncoded := base64.RawURLEncoding.EncodeToString(key.Bytes())
	shortID := hex.EncodeToString(shortBytes)
	if err := writePrivateFile(privatePath, []byte(privateEncoded+"\n")); err != nil {
		return "", "", err
	}
	if err := writePrivateFile(shortPath, []byte(shortID)); err != nil {
		return "", "", err
	}
	return base64.RawURLEncoding.EncodeToString(key.PublicKey().Bytes()), shortID, nil
}

func desiredHash(request Request) string {
	hash := sha256.New()
	hash.Write([]byte(request.InstanceID))
	hash.Write([]byte(request.Protocol))
	hash.Write([]byte(request.Image))
	hash.Write([]byte(fmt.Sprintf("%d:%d:%s", request.ControlPort, request.ExternalPort, request.Network)))
	secretHash := sha256.Sum256([]byte(request.SecretKey))
	hash.Write(secretHash[:])
	return hex.EncodeToString(hash.Sum(nil))
}

func commandError(code string, output []byte, err error) error {
	message := strings.TrimSpace(string(output))
	if len(message) > 1024 {
		message = message[:1024]
	}
	if message == "" {
		message = err.Error()
	}
	return fmt.Errorf("%s: %s", code, message)
}
