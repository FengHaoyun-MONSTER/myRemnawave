// SPDX-License-Identifier: AGPL-3.0-only

package enrollment

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"math/big"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

const testMachineUUID = "10e2c8e1-515c-4a9c-99eb-dbb8cc2aabdc"

func TestEnrollKeepsPrivateKeyLocalAndInstallsCredentials(t *testing.T) {
	t.Parallel()
	caCertificate, caPrivateKey, caPEM := createTestCA(t)
	var requestCount atomic.Int32
	server := httptest.NewTLSServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		requestCount.Add(1)
		defer request.Body.Close()
		var body struct {
			EnrollmentToken string `json:"enrollmentToken"`
			CSRPEM          string `json:"csrPem"`
		}
		if err := json.NewDecoder(request.Body).Decode(&body); err != nil {
			t.Errorf("decode request: %v", err)
			writer.WriteHeader(http.StatusBadRequest)
			return
		}
		if body.EnrollmentToken != "mrw_enroll_1234567890123456789012345678901234567890" {
			t.Errorf("unexpected enrollment token")
		}
		if strings.Contains(body.CSRPEM, "PRIVATE KEY") {
			t.Errorf("request uploaded a private key")
		}
		csrBlock, _ := pem.Decode([]byte(body.CSRPEM))
		if csrBlock == nil || csrBlock.Type != "CERTIFICATE REQUEST" {
			t.Errorf("request did not contain a CSR")
			writer.WriteHeader(http.StatusBadRequest)
			return
		}
		csr, err := x509.ParseCertificateRequest(csrBlock.Bytes)
		if err != nil || csr.CheckSignature() != nil {
			t.Errorf("invalid CSR: %v", err)
			writer.WriteHeader(http.StatusBadRequest)
			return
		}
		expiresAt := time.Now().Add(90 * 24 * time.Hour).UTC().Truncate(time.Second)
		leafDER, err := x509.CreateCertificate(rand.Reader, &x509.Certificate{
			SerialNumber:          big.NewInt(2),
			Subject:               pkix.Name{CommonName: testMachineUUID},
			NotBefore:             time.Now().Add(-time.Minute),
			NotAfter:              expiresAt,
			KeyUsage:              x509.KeyUsageDigitalSignature,
			ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
			BasicConstraintsValid: true,
		}, caCertificate, csr.PublicKey, caPrivateKey)
		if err != nil {
			t.Errorf("sign certificate: %v", err)
			writer.WriteHeader(http.StatusInternalServerError)
			return
		}
		writer.Header().Set("Content-Type", "application/json")
		writer.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(writer).Encode(responseEnvelope{Response: response{
			MachineUUID:   testMachineUUID,
			ClientCertPEM: string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: leafDER})),
			CACertPEM:     string(caPEM),
			ControlURL:    "wss://panel.example.test:3010/api/machine-control",
			ExpiresAt:     expiresAt,
		}})
	}))
	defer server.Close()

	endpoint, err := url.Parse(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	configDirectory := filepath.Join(t.TempDir(), "credentials")
	machineUUID, err := Enroll(context.Background(), Config{
		Endpoint:  endpoint,
		Token:     "mrw_enroll_1234567890123456789012345678901234567890",
		ConfigDir: configDirectory,
	}, server.Client())
	if err != nil {
		t.Fatalf("Enroll() error = %v", err)
	}
	if machineUUID != testMachineUUID {
		t.Fatalf("Enroll() machine UUID = %q", machineUUID)
	}
	for _, name := range []string{"client.crt", "client.key", "ca.crt", "agent.env"} {
		if _, err := os.Stat(filepath.Join(configDirectory, name)); err != nil {
			t.Errorf("expected installed file %s: %v", name, err)
		}
	}
	privateKeyRaw, err := os.ReadFile(filepath.Join(configDirectory, "client.key"))
	if err != nil {
		t.Fatal(err)
	}
	privateKeyBlock, _ := pem.Decode(privateKeyRaw)
	if privateKeyBlock == nil || privateKeyBlock.Type != "PRIVATE KEY" {
		t.Fatal("installed client key is not a PKCS#8 private key")
	}
	if _, err := x509.ParsePKCS8PrivateKey(privateKeyBlock.Bytes); err != nil {
		t.Fatalf("parse installed private key: %v", err)
	}

	if _, err := Enroll(context.Background(), Config{
		Endpoint:  endpoint,
		Token:     "mrw_enroll_1234567890123456789012345678901234567890",
		ConfigDir: configDirectory,
	}, server.Client()); err == nil {
		t.Fatal("second enrollment unexpectedly overwrote credentials")
	}
	if requestCount.Load() != 1 {
		t.Fatalf("server request count = %d, want 1", requestCount.Load())
	}
}

func createTestCA(t *testing.T) (*x509.Certificate, *ecdsa.PrivateKey, []byte) {
	t.Helper()
	privateKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	template := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "test-machine-control-ca"},
		NotBefore:             time.Now().Add(-time.Minute),
		NotAfter:              time.Now().Add(365 * 24 * time.Hour),
		IsCA:                  true,
		BasicConstraintsValid: true,
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageDigitalSignature,
	}
	raw, err := x509.CreateCertificate(rand.Reader, template, template, &privateKey.PublicKey, privateKey)
	if err != nil {
		t.Fatal(err)
	}
	certificate, err := x509.ParseCertificate(raw)
	if err != nil {
		t.Fatal(err)
	}
	return certificate, privateKey, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: raw})
}
