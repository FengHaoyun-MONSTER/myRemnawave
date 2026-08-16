// SPDX-License-Identifier: AGPL-3.0-only

package state

import (
	"testing"
	"time"

	"github.com/FengHaoyun-MONSTER/myRemnawave/apps/machine-agent/internal/protocol"
)

func TestFileStoreReturnsOriginalResultForDuplicateKey(t *testing.T) {
	store, err := NewFileStore(t.TempDir())
	if err != nil {
		t.Fatalf("create store: %v", err)
	}
	first := protocol.CommandResult{
		CommandID:      "command-1",
		IdempotencyKey: "key-1",
		Status:         protocol.ResultSucceeded,
		CompletedAt:    time.Now().UTC(),
	}
	if _, duplicate, err := store.Put("key-1", first); err != nil || duplicate {
		t.Fatalf("store first result: duplicate=%v err=%v", duplicate, err)
	}
	second := first
	second.CommandID = "command-2"

	result, duplicate, err := store.Put("key-1", second)
	if err != nil {
		t.Fatalf("store duplicate result: %v", err)
	}
	if !duplicate || result.CommandID != first.CommandID {
		t.Fatalf("expected original result, got duplicate=%v result=%#v", duplicate, result)
	}
}
