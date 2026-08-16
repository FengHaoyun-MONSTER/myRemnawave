// SPDX-License-Identifier: AGPL-3.0-only

package nodeconfig

import (
	"bytes"
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

const maxResponseBytes = 1 << 20
const maxStoredConfigBytes = 4 << 20

var uuidPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

type Request struct {
	InstanceID        string          `json:"instanceId"`
	Revision          uint32          `json:"revision"`
	FailClosedOnError bool            `json:"failClosedOnError"`
	ControlPort       uint16          `json:"controlPort"`
	JWTToken          string          `json:"jwtToken"`
	ClientCert        string          `json:"clientCert"`
	ClientKey         string          `json:"clientKey"`
	CACert            string          `json:"caCert"`
	XrayConfig        json.RawMessage `json:"xrayConfig"`
	Internals         json.RawMessage `json:"internals"`
}

type Result struct {
	InstanceID string `json:"instanceId"`
	Applied    bool   `json:"applied"`
}

type Handler struct {
	ManagedRoot string
}

func (h Handler) Execute(ctx context.Context, payload json.RawMessage) (any, error) {
	request, err := decode(payload)
	if err != nil {
		return nil, err
	}
	if !uuidPattern.MatchString(request.InstanceID) || request.Revision == 0 || request.ControlPort < 2222 || request.ControlPort > 2224 {
		return nil, errors.New("invalid instanceId, revision, or controlPort")
	}
	if len(request.JWTToken) < 100 || len(request.JWTToken) > 32768 || strings.ContainsAny(request.JWTToken, "\r\n") {
		return nil, errors.New("invalid node JWT")
	}
	clientCertificate, err := tls.X509KeyPair([]byte(request.ClientCert), []byte(request.ClientKey))
	if err != nil {
		return nil, errors.New("node API client certificate is invalid")
	}
	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM([]byte(request.CACert)) {
		return nil, errors.New("node API CA certificate is invalid")
	}
	if err := verifyClientCertificate(clientCertificate, roots); err != nil {
		return nil, err
	}

	config, err := renderRuntimeConfig(h.ManagedRoot, request.InstanceID, request.XrayConfig)
	if err != nil {
		return nil, err
	}
	body, err := json.Marshal(struct {
		XrayConfig json.RawMessage `json:"xrayConfig"`
		Internals  json.RawMessage `json:"internals"`
	}{XrayConfig: config, Internals: request.Internals})
	if err != nil {
		return nil, err
	}
	transport := &http.Transport{
		TLSClientConfig: &tls.Config{
			Certificates:       []tls.Certificate{clientCertificate},
			MinVersion:         tls.VersionTLS13,
			InsecureSkipVerify: true, // VerifyConnection validates the CA chain without a DNS name.
			VerifyConnection: func(state tls.ConnectionState) error {
				if len(state.PeerCertificates) == 0 {
					return errors.New("node API did not present a certificate")
				}
				_, err := state.PeerCertificates[0].Verify(x509.VerifyOptions{
					Roots:         roots,
					Intermediates: intermediatePool(state.PeerCertificates[1:]),
					KeyUsages:     []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
					CurrentTime:   time.Now(),
				})
				return err
			},
		},
	}
	defer transport.CloseIdleConnections()
	client := &http.Client{Transport: transport, Timeout: 90 * time.Second}
	endpoint := fmt.Sprintf("https://127.0.0.1:%d/node/xray/start", request.ControlPort)
	instanceDir := filepath.Join(filepath.Clean(h.ManagedRoot), "instances", request.InstanceID)
	if err := ensureRealInstanceDirectory(instanceDir); err != nil {
		return nil, err
	}
	lastGoodPath := filepath.Join(instanceDir, "last-good-config.json")
	if err := postConfigWithRetry(ctx, client, endpoint, request.JWTToken, body); err != nil {
		previous, readErr := os.ReadFile(lastGoodPath)
		if readErr == nil && len(previous) > 0 && len(previous) <= maxStoredConfigBytes && !bytes.Equal(previous, body) {
			if rollbackErr := postConfigWithRetry(ctx, client, endpoint, request.JWTToken, previous); rollbackErr == nil {
				return nil, fmt.Errorf("CONFIG_APPLY_FAILED_ROLLED_BACK: %w", err)
			}
		}
		return nil, fmt.Errorf("apply node config: %w", err)
	}
	if len(body) > maxStoredConfigBytes {
		return nil, errors.New("applied node config exceeded the persistence size limit")
	}
	if err := atomicWrite(lastGoodPath, body, 0o600); err != nil {
		return nil, fmt.Errorf("persist last-known-good node config: %w", err)
	}
	return Result{InstanceID: request.InstanceID, Applied: true}, nil
}

func postConfigWithRetry(ctx context.Context, client *http.Client, endpoint, token string, body []byte) error {
	var lastErr error
	for attempt := 0; attempt < 12; attempt++ {
		httpRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
		if err != nil {
			return err
		}
		httpRequest.Header.Set("Authorization", "Bearer "+token)
		httpRequest.Header.Set("Content-Type", "application/json")
		response, requestErr := client.Do(httpRequest)
		if requestErr == nil {
			responseBody, readErr := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes+1))
			response.Body.Close()
			if readErr != nil {
				return readErr
			}
			if len(responseBody) > maxResponseBytes {
				return errors.New("node API response exceeded the size limit")
			}
			if response.StatusCode >= 200 && response.StatusCode < 300 {
				return nil
			}
			return fmt.Errorf("node API returned HTTP %d", response.StatusCode)
		}
		lastErr = requestErr
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(5 * time.Second):
		}
	}
	return lastErr
}

func decode(payload json.RawMessage) (Request, error) {
	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	var request Request
	if err := decoder.Decode(&request); err != nil {
		return Request{}, fmt.Errorf("decode apply config payload: %w", err)
	}
	if len(request.XrayConfig) == 0 || len(request.Internals) == 0 {
		return Request{}, errors.New("xrayConfig and internals are required")
	}
	return request, nil
}

func renderRuntimeConfig(managedRoot, instanceID string, input json.RawMessage) (json.RawMessage, error) {
	if !filepath.IsAbs(managedRoot) {
		return nil, errors.New("managed root must be absolute")
	}
	instanceDir := filepath.Join(filepath.Clean(managedRoot), "instances", instanceID)
	privateKey, _ := os.ReadFile(filepath.Join(instanceDir, "reality.key"))
	shortID, _ := os.ReadFile(filepath.Join(instanceDir, "reality.short-id"))
	privateKeyValue := strings.TrimSpace(string(privateKey))
	shortIDValue := strings.TrimSpace(string(shortID))
	if bytes.Contains(input, []byte("{{REALITY_PRIVATE_KEY}}")) && privateKeyValue == "" {
		return nil, errors.New("Reality private key is unavailable")
	}
	if bytes.Contains(input, []byte("{{REALITY_SHORT_ID}}")) && shortIDValue == "" {
		return nil, errors.New("Reality short ID is unavailable")
	}
	replaced := bytes.ReplaceAll(input, []byte(`"{{REALITY_PRIVATE_KEY}}"`), jsonString(privateKeyValue))
	replaced = bytes.ReplaceAll(replaced, []byte(`"{{REALITY_SHORT_ID}}"`), jsonString(shortIDValue))
	if bytes.Contains(replaced, []byte("{{REALITY_")) {
		return nil, errors.New("Reality runtime material is unavailable")
	}
	var validated any
	decoder := json.NewDecoder(bytes.NewReader(replaced))
	decoder.UseNumber()
	if err := decoder.Decode(&validated); err != nil {
		return nil, errors.New("rendered Xray config is invalid JSON")
	}
	return replaced, nil
}

func ensureRealInstanceDirectory(path string) error {
	info, err := os.Lstat(path)
	if err != nil {
		return fmt.Errorf("inspect managed instance directory: %w", err)
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
		return errors.New("managed instance path must be a real directory")
	}
	return nil
}

func atomicWrite(path string, content []byte, mode os.FileMode) error {
	temporary, err := os.CreateTemp(filepath.Dir(path), ".last-good-*")
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

func jsonString(value string) []byte {
	encoded, _ := json.Marshal(value)
	return encoded
}

func verifyClientCertificate(certificate tls.Certificate, roots *x509.CertPool) error {
	if len(certificate.Certificate) == 0 {
		return errors.New("node API client certificate is empty")
	}
	leaf, err := x509.ParseCertificate(certificate.Certificate[0])
	if err != nil {
		return errors.New("node API client certificate is invalid")
	}
	if _, err := leaf.Verify(x509.VerifyOptions{Roots: roots, KeyUsages: []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth}}); err != nil {
		return errors.New("node API client certificate is not trusted")
	}
	return nil
}

func intermediatePool(certificates []*x509.Certificate) *x509.CertPool {
	pool := x509.NewCertPool()
	for _, certificate := range certificates {
		pool.AddCert(certificate)
	}
	return pool
}
