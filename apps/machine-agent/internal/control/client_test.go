// SPDX-License-Identifier: AGPL-3.0-only

package control

import (
	"context"
	"testing"
	"time"
)

func TestWaitWithJitterHonorsCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	started := time.Now()
	if err := waitWithJitter(ctx, time.Minute); err == nil {
		t.Fatal("expected cancellation error")
	}
	if time.Since(started) > time.Second {
		t.Fatal("cancellation was not handled promptly")
	}
}
