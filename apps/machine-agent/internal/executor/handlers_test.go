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
