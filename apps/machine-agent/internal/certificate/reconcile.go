// SPDX-License-Identifier: AGPL-3.0-only

package certificate

import (
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

const certbotImage = "certbot/certbot@sha256:34ee91d2f43008eb78a007d22f23ed4b2eaa9a454cb27ca2c042b49527a695b4"

var (
	uuidPattern   = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)
	domainPattern = regexp.MustCompile(`^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$`)
	emailPattern  = regexp.MustCompile(`^[^@\s]{1,64}@[^@\s]{1,189}$`)
)

type Request struct {
	InstanceID      string `json:"instanceId"`
	Mode            string `json:"mode"`
	Domain          string `json:"domain"`
	ExpectedAddress string `json:"expectedAddress,omitempty"`
	Email           string `json:"email,omitempty"`
	CertificatePath string `json:"certificatePath,omitempty"`
	PrivateKeyPath  string `json:"privateKeyPath,omitempty"`
}

type Result struct {
	InstanceID        string    `json:"instanceId"`
	Domain            string    `json:"domain"`
	ExpiresAt         time.Time `json:"expiresAt"`
	FingerprintSha256 string    `json:"fingerprintSha256"`
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
	Runner      Runner
	Resolver    IPResolver
}

type IPResolver interface {
	LookupIPAddr(ctx context.Context, host string) ([]net.IPAddr, error)
}

func (h Handler) Execute(ctx context.Context, payload json.RawMessage) (any, error) {
	request, err := decode(payload)
	if err != nil {
		return nil, err
	}
	if err := validate(request); err != nil {
		return nil, err
	}
	resolver := h.Resolver
	if resolver == nil {
		resolver = net.DefaultResolver
	}
	if err := validateDNS(ctx, resolver, request.Domain, request.ExpectedAddress); err != nil {
		return nil, err
	}
	instanceDir := filepath.Join(filepath.Clean(h.ManagedRoot), "instances", request.InstanceID)
	if !filepath.IsAbs(instanceDir) {
		return nil, errors.New("managed root must be absolute")
	}
	certDir := filepath.Join(instanceDir, "certs")
	workDir := filepath.Join(instanceDir, "acme")
	if err := ensureDirectory(certDir); err != nil {
		return nil, err
	}

	certificatePath := request.CertificatePath
	privateKeyPath := request.PrivateKeyPath
	if request.Mode == "HTTP_01" {
		if err := ensureDirectory(workDir); err != nil {
			return nil, err
		}
		runner := h.Runner
		if runner == nil {
			runner = DockerRunner{}
		}
		if output, err := runner.Run(ctx, "pull", certbotImage); err != nil {
			return nil, commandError("CERTBOT_PULL_FAILED", output, err)
		}
		containerName := "myremnawave-certbot-" + strings.ReplaceAll(request.InstanceID, "-", "")[:16]
		arguments := []string{
			"run", "--rm", "--name", containerName,
			"--publish", "80:80/tcp",
			"--mount", "type=bind,src=" + workDir + ",dst=/etc/letsencrypt",
			certbotImage,
			"certonly", "--standalone", "--non-interactive", "--agree-tos",
			"--preferred-challenges", "http", "--email", request.Email,
			"--domain", request.Domain, "--cert-name", request.InstanceID,
		}
		if output, err := runner.Run(ctx, arguments...); err != nil {
			return nil, commandError("ACME_HTTP_01_FAILED", output, err)
		}
		certificatePath = filepath.Join(workDir, "live", request.InstanceID, "fullchain.pem")
		privateKeyPath = filepath.Join(workDir, "live", request.InstanceID, "privkey.pem")
	}

	certificatePEM, err := os.ReadFile(certificatePath)
	if err != nil {
		return nil, fmt.Errorf("read certificate: %w", err)
	}
	privateKeyPEM, err := os.ReadFile(privateKeyPath)
	if err != nil {
		return nil, fmt.Errorf("read certificate private key: %w", err)
	}
	leaf, err := validatePair(certificatePEM, privateKeyPEM, request.Domain, time.Now())
	if err != nil {
		return nil, err
	}
	if err := atomicWrite(filepath.Join(certDir, "fullchain.pem"), certificatePEM, 0o644); err != nil {
		return nil, err
	}
	if err := atomicWrite(filepath.Join(certDir, "privkey.pem"), privateKeyPEM, 0o600); err != nil {
		return nil, err
	}
	fingerprint := sha256.Sum256(leaf.Raw)
	return Result{
		InstanceID:        request.InstanceID,
		Domain:            request.Domain,
		ExpiresAt:         leaf.NotAfter.UTC(),
		FingerprintSha256: hex.EncodeToString(fingerprint[:]),
	}, nil
}

func decode(payload json.RawMessage) (Request, error) {
	decoder := json.NewDecoder(strings.NewReader(string(payload)))
	decoder.DisallowUnknownFields()
	var request Request
	if err := decoder.Decode(&request); err != nil {
		return Request{}, fmt.Errorf("decode certificate payload: %w", err)
	}
	request.Domain = strings.TrimSuffix(strings.ToLower(strings.TrimSpace(request.Domain)), ".")
	return request, nil
}

func validate(request Request) error {
	if !uuidPattern.MatchString(request.InstanceID) || len(request.Domain) > 253 || !domainPattern.MatchString(request.Domain) {
		return errors.New("invalid instanceId or certificate domain")
	}
	switch request.Mode {
	case "HTTP_01":
		if !emailPattern.MatchString(request.Email) || strings.TrimSpace(request.ExpectedAddress) == "" || request.CertificatePath != "" || request.PrivateKeyPath != "" {
			return errors.New("HTTP_01 requires an email and expected machine address and does not accept source paths")
		}
	case "IMPORT_EXISTING":
		if request.Email != "" || strings.TrimSpace(request.ExpectedAddress) == "" || !filepath.IsAbs(request.CertificatePath) || !filepath.IsAbs(request.PrivateKeyPath) {
			return errors.New("IMPORT_EXISTING requires an expected machine address and absolute certificate and private key paths")
		}
	default:
		return errors.New("unsupported certificate mode")
	}
	return nil
}

func validateDNS(ctx context.Context, resolver IPResolver, domain, expectedAddress string) error {
	domainAddresses, err := lookupAddresses(ctx, resolver, domain)
	if err != nil {
		return fmt.Errorf("CERTIFICATE_DNS_LOOKUP_FAILED: resolve certificate domain: %w", err)
	}
	expectedAddresses := map[string]struct{}{}
	if address := net.ParseIP(strings.TrimSpace(expectedAddress)); address != nil {
		expectedAddresses[address.String()] = struct{}{}
	} else {
		expectedAddresses, err = lookupAddresses(ctx, resolver, strings.TrimSuffix(strings.ToLower(strings.TrimSpace(expectedAddress)), "."))
		if err != nil {
			return fmt.Errorf("CERTIFICATE_DNS_LOOKUP_FAILED: resolve machine address: %w", err)
		}
	}
	for address := range domainAddresses {
		if _, ok := expectedAddresses[address]; ok {
			return nil
		}
	}
	return errors.New("CERTIFICATE_DNS_MISMATCH: certificate domain does not resolve to the machine address")
}

func lookupAddresses(ctx context.Context, resolver IPResolver, host string) (map[string]struct{}, error) {
	addresses, err := resolver.LookupIPAddr(ctx, host)
	if err != nil {
		return nil, err
	}
	result := make(map[string]struct{}, len(addresses))
	for _, address := range addresses {
		if address.IP != nil {
			result[address.IP.String()] = struct{}{}
		}
	}
	if len(result) == 0 {
		return nil, errors.New("DNS response contained no A or AAAA records")
	}
	return result, nil
}

func validatePair(certificatePEM, privateKeyPEM []byte, domain string, now time.Time) (*x509.Certificate, error) {
	pair, err := tls.X509KeyPair(certificatePEM, privateKeyPEM)
	if err != nil {
		return nil, errors.New("certificate and private key do not form a valid pair")
	}
	block, _ := pem.Decode(certificatePEM)
	if block == nil || block.Type != "CERTIFICATE" {
		return nil, errors.New("certificate file does not contain a PEM certificate")
	}
	leaf, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return nil, errors.New("certificate file is invalid")
	}
	pair.Leaf = leaf
	if err := leaf.VerifyHostname(domain); err != nil {
		return nil, errors.New("certificate does not cover the requested domain")
	}
	if now.Before(leaf.NotBefore) || !now.Before(leaf.NotAfter) {
		return nil, errors.New("certificate is not currently valid")
	}
	return leaf, nil
}

func ensureDirectory(path string) error {
	if err := os.MkdirAll(path, 0o700); err != nil {
		return err
	}
	info, err := os.Lstat(path)
	if err != nil || info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
		return errors.New("certificate destination must be a real directory")
	}
	return os.Chmod(path, 0o700)
}

func atomicWrite(path string, content []byte, mode os.FileMode) error {
	temporary, err := os.CreateTemp(filepath.Dir(path), ".certificate-*")
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
