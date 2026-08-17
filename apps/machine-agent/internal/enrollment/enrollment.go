// SPDX-License-Identifier: AGPL-3.0-only

package enrollment

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptrace"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
)

const (
	maxResponseBytes = int64(128 * 1024)
	requestTimeout   = 45 * time.Second
	pendingSuffix    = ".enrollment"
)

var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$`)

type Config struct {
	Endpoint  *url.URL
	Token     string
	ConfigDir string
}

type responseEnvelope struct {
	Response response `json:"response"`
}

type response struct {
	MachineUUID   string    `json:"machineUuid"`
	ClientCertPEM string    `json:"clientCertPem"`
	CACertPEM     string    `json:"caCertPem"`
	ControlURL    string    `json:"controlUrl"`
	ExpiresAt     time.Time `json:"expiresAt"`
}

type request struct {
	EnrollmentToken string `json:"enrollmentToken"`
	AttemptID       string `json:"attemptId"`
	CSRPEM          string `json:"csrPem"`
}

type pendingEnrollment struct {
	AttemptID  string
	PrivateKey *ecdsa.PrivateKey
	CSRPEM     []byte
}

func ParseConfig(endpoint, token, configDir string) (Config, error) {
	parsedEndpoint, err := url.Parse(endpoint)
	if err != nil {
		return Config{}, fmt.Errorf("parse enrollment URL: %w", err)
	}
	if parsedEndpoint.Scheme != "https" || parsedEndpoint.Host == "" || parsedEndpoint.User != nil {
		return Config{}, errors.New("enrollment URL must be an absolute https URL without user information")
	}
	if len(token) < 40 || len(token) > 256 {
		return Config{}, errors.New("enrollment token has an invalid length")
	}
	if !filepath.IsAbs(configDir) {
		return Config{}, errors.New("configuration directory must be an absolute path")
	}
	return Config{Endpoint: parsedEndpoint, Token: token, ConfigDir: filepath.Clean(configDir)}, nil
}

func Enroll(ctx context.Context, configuration Config, client *http.Client) (string, error) {
	if client == nil {
		client = NewHTTPClient()
	}
	if err := ensureTargetAvailable(configuration.ConfigDir); err != nil {
		return "", err
	}

	pending, err := loadOrCreatePending(configuration.ConfigDir + pendingSuffix)
	if err != nil {
		return "", err
	}
	requestBody, err := json.Marshal(request{
		EnrollmentToken: configuration.Token,
		AttemptID:       pending.AttemptID,
		CSRPEM:          string(pending.CSRPEM),
	})
	if err != nil {
		return "", fmt.Errorf("encode enrollment request: %w", err)
	}
	requestContext, cancel := context.WithTimeout(ctx, requestTimeout)
	defer cancel()
	httpRequest, err := http.NewRequestWithContext(
		requestContext,
		http.MethodPost,
		configuration.Endpoint.String(),
		bytes.NewReader(requestBody),
	)
	if err != nil {
		return "", fmt.Errorf("create enrollment request: %w", err)
	}
	httpRequest.Header.Set("Content-Type", "application/json")
	httpRequest.Header.Set("Accept", "application/json")
	var requestStage atomic.Value
	requestStage.Store("DNS lookup")
	httpRequest = httpRequest.WithContext(httptrace.WithClientTrace(httpRequest.Context(), &httptrace.ClientTrace{
		DNSDone: func(info httptrace.DNSDoneInfo) {
			if info.Err == nil {
				requestStage.Store("TCP connection")
			}
		},
		ConnectDone: func(_ string, _ string, err error) {
			if err == nil {
				requestStage.Store("TLS handshake")
			}
		},
		TLSHandshakeDone: func(_ tls.ConnectionState, err error) {
			if err == nil {
				requestStage.Store("response headers")
			}
		},
		GotFirstResponseByte: func() { requestStage.Store("response body") },
	}))

	httpResponse, err := client.Do(httpRequest)
	if err != nil {
		return "", describeRequestError(requestStage.Load().(string), err)
	}
	defer httpResponse.Body.Close()
	limitedBody := io.LimitReader(httpResponse.Body, maxResponseBytes+1)
	if httpResponse.StatusCode != http.StatusCreated {
		_, _ = io.Copy(io.Discard, limitedBody)
		return "", fmt.Errorf("enrollment server returned HTTP %d", httpResponse.StatusCode)
	}
	decoder := json.NewDecoder(limitedBody)
	decoder.DisallowUnknownFields()
	var envelope responseEnvelope
	if err := decoder.Decode(&envelope); err != nil {
		return "", fmt.Errorf("decode enrollment response: %w", err)
	}
	if err := ensureJSONEOF(decoder); err != nil {
		return "", err
	}
	if err := validateResponse(envelope.Response, pending.PrivateKey); err != nil {
		return "", err
	}
	privateKeyDER, err := x509.MarshalPKCS8PrivateKey(pending.PrivateKey)
	if err != nil {
		return "", fmt.Errorf("encode client private key: %w", err)
	}
	privateKeyPEM := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: privateKeyDER})
	if err := install(configuration.ConfigDir, envelope.Response, privateKeyPEM); err != nil {
		return "", err
	}
	if err := os.RemoveAll(configuration.ConfigDir + pendingSuffix); err != nil {
		return "", fmt.Errorf("remove completed enrollment state: %w", err)
	}
	return envelope.Response.MachineUUID, nil
}

func NewHTTPClient() *http.Client {
	return &http.Client{
		Timeout: requestTimeout,
		Transport: &http.Transport{
			Proxy:                 http.ProxyFromEnvironment,
			DialContext:           (&net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
			TLSHandshakeTimeout:   10 * time.Second,
			ResponseHeaderTimeout: 20 * time.Second,
			ForceAttemptHTTP2:     true,
		},
	}
}

func generateCSR() (*ecdsa.PrivateKey, []byte, error) {
	privateKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, nil, fmt.Errorf("generate enrollment private key: %w", err)
	}
	csrDER, err := x509.CreateCertificateRequest(rand.Reader, &x509.CertificateRequest{
		Subject:            pkix.Name{CommonName: "myremnawave-machine-agent"},
		SignatureAlgorithm: x509.ECDSAWithSHA256,
	}, privateKey)
	if err != nil {
		return nil, nil, fmt.Errorf("create enrollment CSR: %w", err)
	}
	return privateKey, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE REQUEST", Bytes: csrDER}), nil
}

func loadOrCreatePending(path string) (pendingEnrollment, error) {
	if info, err := os.Lstat(path); err == nil {
		if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
			return pendingEnrollment{}, fmt.Errorf("pending enrollment path %s must be a real directory", path)
		}
		return loadPending(path)
	} else if !errors.Is(err, os.ErrNotExist) {
		return pendingEnrollment{}, fmt.Errorf("inspect pending enrollment state: %w", err)
	}

	privateKey, csrPEM, err := generateCSR()
	if err != nil {
		return pendingEnrollment{}, err
	}
	attemptID, err := randomUUID()
	if err != nil {
		return pendingEnrollment{}, err
	}
	privateKeyDER, err := x509.MarshalPKCS8PrivateKey(privateKey)
	if err != nil {
		return pendingEnrollment{}, fmt.Errorf("encode pending private key: %w", err)
	}
	parent := filepath.Dir(path)
	staging, err := os.MkdirTemp(parent, ".myremnawave-agent-pending-")
	if err != nil {
		return pendingEnrollment{}, fmt.Errorf("create pending enrollment directory: %w", err)
	}
	defer os.RemoveAll(staging)
	if err := os.Chmod(staging, 0o700); err != nil {
		return pendingEnrollment{}, fmt.Errorf("secure pending enrollment directory: %w", err)
	}
	files := []struct {
		name string
		data []byte
		mode os.FileMode
	}{
		{name: "client.key", data: pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: privateKeyDER}), mode: 0o600},
		{name: "request.csr", data: csrPEM, mode: 0o600},
		{name: "attempt-id", data: []byte(attemptID + "\n"), mode: 0o600},
	}
	for _, file := range files {
		if err := os.WriteFile(filepath.Join(staging, file.name), file.data, file.mode); err != nil {
			return pendingEnrollment{}, fmt.Errorf("write pending enrollment file %s: %w", file.name, err)
		}
	}
	if err := os.Rename(staging, path); err != nil {
		return pendingEnrollment{}, fmt.Errorf("commit pending enrollment state: %w", err)
	}
	return pendingEnrollment{AttemptID: attemptID, PrivateKey: privateKey, CSRPEM: csrPEM}, nil
}

func loadPending(path string) (pendingEnrollment, error) {
	keyPEM, err := readRegularFile(path, "client.key", 64*1024)
	if err != nil {
		return pendingEnrollment{}, err
	}
	csrPEM, err := readRegularFile(path, "request.csr", 64*1024)
	if err != nil {
		return pendingEnrollment{}, err
	}
	attemptRaw, err := readRegularFile(path, "attempt-id", 128)
	if err != nil {
		return pendingEnrollment{}, err
	}
	keyBlock, rest := pem.Decode(keyPEM)
	if keyBlock == nil || keyBlock.Type != "PRIVATE KEY" || len(bytes.TrimSpace(rest)) != 0 {
		return pendingEnrollment{}, errors.New("pending enrollment private key is invalid")
	}
	parsedKey, err := x509.ParsePKCS8PrivateKey(keyBlock.Bytes)
	if err != nil {
		return pendingEnrollment{}, fmt.Errorf("parse pending enrollment private key: %w", err)
	}
	privateKey, ok := parsedKey.(*ecdsa.PrivateKey)
	if !ok || privateKey.Curve != elliptic.P256() {
		return pendingEnrollment{}, errors.New("pending enrollment private key must use ECDSA P-256")
	}
	csrBlock, csrRest := pem.Decode(csrPEM)
	if csrBlock == nil || csrBlock.Type != "CERTIFICATE REQUEST" || len(bytes.TrimSpace(csrRest)) != 0 {
		return pendingEnrollment{}, errors.New("pending enrollment CSR is invalid")
	}
	csr, err := x509.ParseCertificateRequest(csrBlock.Bytes)
	if err != nil || csr.CheckSignature() != nil || !privateKey.PublicKey.Equal(csr.PublicKey) {
		return pendingEnrollment{}, errors.New("pending enrollment CSR does not match its private key")
	}
	attemptID := strings.TrimSpace(string(attemptRaw))
	if !uuidPattern.MatchString(attemptID) {
		return pendingEnrollment{}, errors.New("pending enrollment attempt ID is invalid")
	}
	return pendingEnrollment{AttemptID: attemptID, PrivateKey: privateKey, CSRPEM: csrPEM}, nil
}

func readRegularFile(parent, name string, maximum int64) ([]byte, error) {
	path := filepath.Join(parent, name)
	info, err := os.Lstat(path)
	if err != nil {
		return nil, fmt.Errorf("inspect pending enrollment file %s: %w", name, err)
	}
	if !info.Mode().IsRegular() || info.Mode()&os.ModeSymlink != 0 || info.Size() > maximum {
		return nil, fmt.Errorf("pending enrollment file %s is not a safe regular file", name)
	}
	return os.ReadFile(path)
}

func randomUUID() (string, error) {
	value := make([]byte, 16)
	if _, err := rand.Read(value); err != nil {
		return "", fmt.Errorf("generate enrollment attempt ID: %w", err)
	}
	value[6] = (value[6] & 0x0f) | 0x40
	value[8] = (value[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		value[0:4], value[4:6], value[6:8], value[8:10], value[10:16]), nil
}

func describeRequestError(stage string, err error) error {
	var dnsError *net.DNSError
	var certificateError x509.UnknownAuthorityError
	switch {
	case errors.As(err, &dnsError):
		return fmt.Errorf("enrollment DNS lookup failed for %s: %w", dnsError.Name, err)
	case errors.As(err, &certificateError):
		return fmt.Errorf("enrollment TLS certificate verification failed: %w", err)
	case errors.Is(err, context.DeadlineExceeded):
		return fmt.Errorf("enrollment timed out during %s; check DNS, TCP 443, TLS, and panel health: %w", stage, err)
	default:
		return fmt.Errorf("enrollment request failed during %s: %w", stage, err)
	}
}

func validateResponse(result response, privateKey *ecdsa.PrivateKey) error {
	if !uuidPattern.MatchString(result.MachineUUID) {
		return errors.New("enrollment response contains an invalid machine UUID")
	}
	controlURL, err := url.Parse(result.ControlURL)
	if err != nil || controlURL.Scheme != "wss" || controlURL.Host == "" || controlURL.User != nil {
		return errors.New("enrollment response contains an invalid control URL")
	}
	if result.ExpiresAt.Before(time.Now().Add(5 * time.Minute)) {
		return errors.New("enrollment response certificate expires too soon")
	}
	certificate, err := parseSingleCertificate(result.ClientCertPEM)
	if err != nil {
		return fmt.Errorf("parse enrollment client certificate: %w", err)
	}
	caCertificate, err := parseSingleCertificate(result.CACertPEM)
	if err != nil {
		return fmt.Errorf("parse enrollment CA certificate: %w", err)
	}
	publicKey, ok := certificate.PublicKey.(*ecdsa.PublicKey)
	if !ok || !privateKey.PublicKey.Equal(publicKey) {
		return errors.New("enrollment certificate does not match the locally generated private key")
	}
	if certificate.Subject.CommonName != result.MachineUUID {
		return errors.New("enrollment certificate identity does not match the machine UUID")
	}
	if certificate.NotAfter.Before(result.ExpiresAt.Add(-time.Minute)) || certificate.NotAfter.After(result.ExpiresAt.Add(time.Minute)) {
		return errors.New("enrollment certificate expiry does not match the response")
	}
	roots := x509.NewCertPool()
	roots.AddCert(caCertificate)
	if _, err := certificate.Verify(x509.VerifyOptions{
		Roots:     roots,
		KeyUsages: []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
	}); err != nil {
		return fmt.Errorf("verify enrollment certificate: %w", err)
	}
	return nil
}

func parseSingleCertificate(raw string) (*x509.Certificate, error) {
	block, rest := pem.Decode([]byte(raw))
	if block == nil || block.Type != "CERTIFICATE" || len(bytes.TrimSpace(rest)) != 0 {
		return nil, errors.New("expected exactly one PEM certificate")
	}
	return x509.ParseCertificate(block.Bytes)
}

func install(configDir string, result response, privateKeyPEM []byte) error {
	parent := filepath.Dir(configDir)
	if err := ensureRealDirectory(parent); err != nil {
		return err
	}
	staging, err := os.MkdirTemp(parent, ".myremnawave-agent-enrollment-")
	if err != nil {
		return fmt.Errorf("create enrollment staging directory: %w", err)
	}
	defer os.RemoveAll(staging)
	if err := os.Chmod(staging, 0o700); err != nil {
		return fmt.Errorf("secure enrollment staging directory: %w", err)
	}
	files := []struct {
		name string
		data []byte
		mode os.FileMode
	}{
		{name: "client.crt", data: []byte(result.ClientCertPEM), mode: 0o644},
		{name: "client.key", data: privateKeyPEM, mode: 0o600},
		{name: "ca.crt", data: []byte(result.CACertPEM), mode: 0o644},
		{
			name: "agent.env",
			data: []byte(strings.Join([]string{
				envLine("MYREMNAWAVE_PANEL_URL", result.ControlURL),
				envLine("MYREMNAWAVE_MACHINE_ID", result.MachineUUID),
				envLine("MYREMNAWAVE_CLIENT_CERT_FILE", filepath.Join(configDir, "client.crt")),
				envLine("MYREMNAWAVE_CLIENT_KEY_FILE", filepath.Join(configDir, "client.key")),
				envLine("MYREMNAWAVE_CA_FILE", filepath.Join(configDir, "ca.crt")),
				"",
			}, "\n")),
			mode: 0o600,
		},
	}
	for _, file := range files {
		if err := os.WriteFile(filepath.Join(staging, file.name), file.data, file.mode); err != nil {
			return fmt.Errorf("write enrollment file %s: %w", file.name, err)
		}
	}
	if err := os.Rename(staging, configDir); err != nil {
		return fmt.Errorf("commit enrollment configuration: %w", err)
	}
	return nil
}

func ensureTargetAvailable(path string) error {
	_, err := os.Lstat(path)
	if err == nil {
		return errors.New("configuration directory already exists; refusing to overwrite credentials")
	}
	if !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("inspect configuration directory: %w", err)
	}
	return ensureRealDirectory(filepath.Dir(path))
}

func ensureRealDirectory(path string) error {
	info, err := os.Lstat(path)
	if err != nil {
		return fmt.Errorf("inspect directory %s: %w", path, err)
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("directory %s must be a real directory", path)
	}
	return nil
}

func ensureJSONEOF(decoder *json.Decoder) error {
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		if err == nil {
			return errors.New("enrollment response contains multiple JSON values")
		}
		return fmt.Errorf("decode trailing enrollment response: %w", err)
	}
	return nil
}

func envLine(name, value string) string {
	return name + "=" + strconv.Quote(value)
}
