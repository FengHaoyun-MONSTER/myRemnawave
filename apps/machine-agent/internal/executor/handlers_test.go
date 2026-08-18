// SPDX-License-Identifier: AGPL-3.0-only

package executor

import (
	"testing"

	"github.com/FengHaoyun-MONSTER/myRemnawave/apps/machine-agent/internal/inventory"
)

func TestResourceChecksRejectUndersizedMachine(t *testing.T) {
	system := inventory.System{MemoryBytes: minimumMemoryBytes - 1, DiskFreeBytes: minimumDiskFreeBytes - 1}
	if memoryCheck(system).OK || diskCheck(system).OK {
		t.Fatal("expected an undersized machine to fail resource preflight")
	}
}

func TestResourceChecksAcceptMinimumMachine(t *testing.T) {
	system := inventory.System{MemoryBytes: minimumMemoryBytes, DiskFreeBytes: minimumDiskFreeBytes}
	if !memoryCheck(system).OK || !diskCheck(system).OK {
		t.Fatal("expected the documented minimum machine to pass resource preflight")
	}
}

func TestSupportedOSVersionsIncludeDebian13(t *testing.T) {
	tests := []struct {
		id      string
		version string
		want    bool
	}{
		{id: "debian", version: "12", want: true},
		{id: "debian", version: "13", want: true},
		{id: "ubuntu", version: "22.04", want: true},
		{id: "ubuntu", version: "24.04.3", want: true},
		{id: "debian", version: "11", want: false},
		{id: "ubuntu", version: "20.04", want: false},
	}
	for _, test := range tests {
		if got := supportsOS(test.id, test.version); got != test.want {
			t.Errorf("supportsOS(%q, %q) = %v, want %v", test.id, test.version, got, test.want)
		}
	}
}
