// SPDX-License-Identifier: AGPL-3.0-only

package main

import (
	"context"
	"errors"
	"flag"
	"log/slog"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"

	"github.com/FengHaoyun-MONSTER/myRemnawave/apps/machine-agent/internal/config"
	"github.com/FengHaoyun-MONSTER/myRemnawave/apps/machine-agent/internal/control"
	"github.com/FengHaoyun-MONSTER/myRemnawave/apps/machine-agent/internal/enrollment"
	"github.com/FengHaoyun-MONSTER/myRemnawave/apps/machine-agent/internal/executor"
	"github.com/FengHaoyun-MONSTER/myRemnawave/apps/machine-agent/internal/state"
)

var version = "0.0.0-dev"

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	if len(os.Args) > 1 && os.Args[1] == "enroll" {
		runEnrollment(logger, os.Args[2:])
		return
	}
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

func runEnrollment(logger *slog.Logger, arguments []string) {
	if runtime.GOOS == "linux" && os.Geteuid() != 0 {
		logger.Error("machine enrollment must run as root")
		os.Exit(1)
	}
	flags := flag.NewFlagSet("enroll", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	endpoint := flags.String("url", "", "HTTPS Machine Agent enrollment endpoint")
	token := flags.String("token", "", "one-time enrollment token")
	configDir := flags.String("config-dir", "/etc/myremnawave-agent", "credential configuration directory")
	if err := flags.Parse(arguments); err != nil {
		os.Exit(2)
	}
	configuration, err := enrollment.ParseConfig(*endpoint, *token, *configDir)
	if err != nil {
		logger.Error("invalid enrollment configuration", "error", err.Error())
		os.Exit(1)
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	machineUUID, err := enrollment.Enroll(ctx, configuration, enrollment.NewHTTPClient())
	if err != nil {
		logger.Error("machine enrollment failed", "error", err.Error())
		os.Exit(1)
	}
	logger.Info("machine enrollment completed", "machineId", machineUUID, "configDir", configuration.ConfigDir)
}
