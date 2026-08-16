// SPDX-License-Identifier: AGPL-3.0-only

package config

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadFromRejectsInsecurePanelURL(t *testing.T) {
	env := validEnvironment(t)
	env["MYREMNAWAVE_PANEL_URL"] = "https://panel.example.com/agent"

	_, err := LoadFrom(mapLookup(env))
	if err == nil || !strings.Contains(err.Error(), "absolute wss URL") {
		t.Fatalf("expected secure websocket validation error, got %v", err)
	}
}

func TestLoadFromAcceptsValidConfiguration(t *testing.T) {
	env := validEnvironment(t)

	config, err := LoadFrom(mapLookup(env))
	if err != nil {
		t.Fatalf("load configuration: %v", err)
	}
	if config.MachineID != env["MYREMNAWAVE_MACHINE_ID"] {
		t.Fatalf("unexpected machine id %q", config.MachineID)
	}
	if config.PanelURL.Scheme != "wss" {
		t.Fatalf("unexpected panel scheme %q", config.PanelURL.Scheme)
	}
}

func TestLoadFromRejectsOversizedMessages(t *testing.T) {
	env := validEnvironment(t)
	env["MYREMNAWAVE_MAX_MESSAGE_BYTES"] = "5000000"

	_, err := LoadFrom(mapLookup(env))
	if err == nil || !strings.Contains(err.Error(), "MYREMNAWAVE_MAX_MESSAGE_BYTES") {
		t.Fatalf("expected message size validation error, got %v", err)
	}
}

func validEnvironment(t *testing.T) map[string]string {
	t.Helper()
	root := t.TempDir()
	return map[string]string{
		"MYREMNAWAVE_PANEL_URL":        "wss://panel.example.com/api/machines/connect",
		"MYREMNAWAVE_MACHINE_ID":       "8d13a04f-a31d-4ac7-a3fb-bdbc3b256f43",
		"MYREMNAWAVE_CLIENT_CERT_FILE": filepath.Join(root, "client.pem"),
		"MYREMNAWAVE_CLIENT_KEY_FILE":  filepath.Join(root, "client-key.pem"),
		"MYREMNAWAVE_CA_FILE":          filepath.Join(root, "ca.pem"),
		"MYREMNAWAVE_STATE_DIR":        filepath.Join(root, "state"),
		"MYREMNAWAVE_MANAGED_ROOT":     filepath.Join(root, "managed"),
	}
}

func mapLookup(values map[string]string) LookupEnv {
	return func(name string) (string, bool) {
		value, ok := values[name]
		return value, ok
	}
}
