// SPDX-License-Identifier: AGPL-3.0-only

package certificate

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
	"net"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

func TestImportExistingCertificate(t *testing.T) {
	root := t.TempDir()
	certificatePEM, keyPEM := testCertificate(t, "node.example.com")
	certificatePath := filepath.Join(root, "source.crt")
	keyPath := filepath.Join(root, "source.key")
	if err := os.WriteFile(certificatePath, certificatePEM, 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(keyPath, keyPEM, 0o600); err != nil {
		t.Fatal(err)
	}
	request := Request{
		InstanceID:      "123e4567-e89b-42d3-a456-426614174000",
		Mode:            "IMPORT_EXISTING",
		Domain:          "node.example.com",
		CertificatePath: certificatePath,
		PrivateKeyPath:  keyPath,
	}
	payload, _ := json.Marshal(request)
	result, err := (Handler{ManagedRoot: root}).Execute(context.Background(), payload)
	if err != nil {
		t.Fatal(err)
	}
	if result.(Result).Domain != request.Domain {
		t.Fatalf("unexpected result: %#v", result)
	}
	destinationKey := filepath.Join(root, "instances", request.InstanceID, "certs", "privkey.pem")
	info, err := os.Stat(destinationKey)
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" && info.Mode().Perm() != 0o600 {
		t.Fatalf("private key permissions = %o", info.Mode().Perm())
	}
}

type staticResolver map[string][]net.IPAddr

func (r staticResolver) LookupIPAddr(_ context.Context, host string) ([]net.IPAddr, error) {
	return r[host], nil
}

func TestValidateDNSAcceptsMachineAddress(t *testing.T) {
	resolver := staticResolver{
		"node.example.com": {{IP: net.ParseIP("203.0.113.10")}},
	}
	if err := validateDNS(context.Background(), resolver, "node.example.com", "203.0.113.10"); err != nil {
		t.Fatal(err)
	}
}

func TestValidateDNSRejectsDifferentMachineAddress(t *testing.T) {
	resolver := staticResolver{
		"node.example.com": {{IP: net.ParseIP("203.0.113.10")}},
	}
	if err := validateDNS(context.Background(), resolver, "node.example.com", "203.0.113.11"); err == nil {
		t.Fatal("expected DNS mismatch")
	}
}

func testCertificate(t *testing.T, domain string) ([]byte, []byte) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now()
	template := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: domain},
		DNSNames:     []string{domain},
		NotBefore:    now.Add(-time.Minute),
		NotAfter:     now.Add(time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	keyDer, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatal(err)
	}
	return pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: keyDer})
}
