// SPDX-License-Identifier: AGPL-3.0-only

package inventory

import (
	"os"
	"path/filepath"
	"testing"
)

func TestReadOSRelease(t *testing.T) {
	path := filepath.Join(t.TempDir(), "os-release")
	content := "# comment\nID=debian\nVERSION_ID=\"12\"\nPRETTY_NAME=\"Debian GNU/Linux 12\"\n"
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write test os-release: %v", err)
	}

	values, err := readOSRelease(path)
	if err != nil {
		t.Fatalf("read os-release: %v", err)
	}
	if values["ID"] != "debian" || values["VERSION_ID"] != "12" {
		t.Fatalf("unexpected values: %#v", values)
	}
}
