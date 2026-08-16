// SPDX-License-Identifier: AGPL-3.0-only

package nodeconfig

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRenderRealityRuntimeMaterial(t *testing.T) {
	root := t.TempDir()
	instanceID := "123e4567-e89b-42d3-a456-426614174000"
	directory := filepath.Join(root, "instances", instanceID)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "reality.key"), []byte("private-key\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(directory, "reality.short-id"), []byte("0123456789abcdef"), 0o600); err != nil {
		t.Fatal(err)
	}
	rendered, err := renderRuntimeConfig(root, instanceID, []byte(`{"privateKey":"{{REALITY_PRIVATE_KEY}}","shortIds":["{{REALITY_SHORT_ID}}"]}`))
	if err != nil {
		t.Fatal(err)
	}
	expected := `{"privateKey":"private-key","shortIds":["0123456789abcdef"]}`
	if string(rendered) != expected {
		t.Fatalf("rendered = %s", rendered)
	}
}

func TestRenderRejectsMissingRealityMaterial(t *testing.T) {
	_, err := renderRuntimeConfig(t.TempDir(), "123e4567-e89b-42d3-a456-426614174000", []byte(`{"privateKey":"{{REALITY_PRIVATE_KEY}}"}`))
	if err == nil {
		t.Fatal("expected missing Reality key to be rejected")
	}
}
