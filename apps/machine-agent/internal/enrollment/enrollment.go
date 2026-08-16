// SPDX-License-Identifier: AGPL-3.0-only

package enrollment

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const (
	maxResponseBytes = int64(128 * 1024)
	requestTimeout   = 30 * time.Second
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
	CSRPEM          string `json:"csrPem"`
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
		client = &http.Client{Timeout: requestTimeout}
	}
	if err := ensureTargetAvailable(configuration.ConfigDir); err != nil {
		return "", err
	}

	privateKey, csrPEM, err := generateCSR()
	if err != nil {
		return "", err
	}
	requestBody, err := json.Marshal(request{
		EnrollmentToken: configuration.Token,
		CSRPEM:          string(csrPEM),
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

	httpResponse, err := client.Do(httpRequest)
	if err != nil {
		return "", fmt.Errorf("request enrollment certificate: %w", err)
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
	if err := validateResponse(envelope.Response, privateKey); err != nil {
		return "", err
	}
	privateKeyDER, err := x509.MarshalPKCS8PrivateKey(privateKey)
	if err != nil {
		return "", fmt.Errorf("encode client private key: %w", err)
	}
	privateKeyPEM := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: privateKeyDER})
	if err := install(configuration.ConfigDir, envelope.Response, privateKeyPEM); err != nil {
		return "", err
	}
	return envelope.Response.MachineUUID, nil
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
