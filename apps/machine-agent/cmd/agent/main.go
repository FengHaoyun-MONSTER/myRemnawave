// SPDX-License-Identifier: AGPL-3.0-only

package main

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"github.com/FengHaoyun-MONSTER/myRemnawave/apps/machine-agent/internal/config"
	"github.com/FengHaoyun-MONSTER/myRemnawave/apps/machine-agent/internal/control"
	"github.com/FengHaoyun-MONSTER/myRemnawave/apps/machine-agent/internal/executor"
	"github.com/FengHaoyun-MONSTER/myRemnawave/apps/machine-agent/internal/state"
)

var version = "0.0.0-dev"

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	configuration, err := config.Load()
	if err != nil {
		logger.Error("invalid agent configuration", "error", err.Error())
		os.Exit(1)
	}
	if err := configuration.EnsureStateDir(); err != nil {
		logger.Error("prepare agent state", "error", err.Error())
		os.Exit(1)
	}
	commandStore, err := state.NewFileStore(filepath.Join(configuration.StateDir, "commands"))
	if err != nil {
		logger.Error("prepare command state", "error", err.Error())
		os.Exit(1)
	}
	commandExecutor, err := executor.New(
		commandStore,
		configuration.CommandTimeout,
		executor.DefaultHandlers(configuration.ManagedRoot),
	)
	if err != nil {
		logger.Error("prepare command executor", "error", err.Error())
		os.Exit(1)
	}
	client, err := control.NewClient(configuration, commandExecutor, logger, version)
	if err != nil {
		logger.Error("prepare control client", "error", err.Error())
		os.Exit(1)
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	logger.Info("machine agent starting", "version", version, "machineId", configuration.MachineID)
	if err := client.Run(ctx); err != nil && !errors.Is(err, context.Canceled) {
		logger.Error("machine agent stopped unexpectedly", "error", err.Error())
		os.Exit(1)
	}
	logger.Info("machine agent stopped")
}
