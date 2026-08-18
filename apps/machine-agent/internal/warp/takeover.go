// SPDX-License-Identifier: AGPL-3.0-only

package warp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

const TakeoverDecision = "TAKE_OVER_EXTERNAL_WARP"

var uuidPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

type TakeoverRequest struct {
	PlanID            string `json:"planId"`
	Decision          string `json:"decision"`
	AttestNo3XUIUsage bool   `json:"attestNo3xuiUse"`
}

type TakeoverResult struct {
	PlanID    string `json:"planId"`
	Ownership string `json:"ownership"`
	Message   string `json:"message"`
}

type TakeoverHandler struct {
	ManagedRoot string
	MachineID   string
	Runner      Runner
	LookupPath  func(string) (string, error)
	Detect3XUI  func(context.Context) (bool, string, error)
}

func (h TakeoverHandler) Execute(ctx context.Context, payload json.RawMessage) (any, error) {
	request, err := decodeTakeover(payload)
	if err != nil {
		return nil, err
	}
	if request.Decision != TakeoverDecision || !request.AttestNo3XUIUsage {
		return nil, errors.New("WARP_TAKEOVER_CONFIRMATION_REQUIRED: explicit no-3X-UI-use attestation is required")
	}
	if !uuidPattern.MatchString(request.PlanID) || !uuidPattern.MatchString(h.MachineID) {
		return nil, errors.New("WARP_TAKEOVER_INVALID_IDENTITY: planId and Machine identity must be lowercase UUIDs")
	}

	lookup := h.LookupPath
	if lookup == nil {
		lookup = exec.LookPath
	}
	if _, err := lookup("warp-cli"); err != nil {
		return nil, errors.New("WARP_TAKEOVER_NOT_APPLICABLE: external WARP is absent")
	}
	if ownership, ownershipErr := ReadOwnership(h.ManagedRoot); ownershipErr == nil {
		if ownership.MachineID != h.MachineID {
			return nil, errors.New("WARP_TAKEOVER_OWNED_BY_ANOTHER_MACHINE: ownership cannot be replaced")
		}
		return TakeoverResult{PlanID: request.PlanID, Ownership: ownership.State, Message: "WARP is already owned by this Machine"}, nil
	} else if !errors.Is(ownershipErr, os.ErrNotExist) {
		return nil, fmt.Errorf("WARP_TAKEOVER_OWNERSHIP_UNSAFE: %w", ownershipErr)
	}

	detector := h.Detect3XUI
	if detector == nil {
		detector = h.detect3XUI
	}
	detected, evidence, err := detector(ctx)
	if err != nil {
		return nil, fmt.Errorf("WARP_TAKEOVER_INSPECTION_FAILED: %w", err)
	}
	if detected {
		return nil, fmt.Errorf("WARP_TAKEOVER_FORBIDDEN_3XUI: %s", boundedTakeoverMessage(evidence))
	}

	now := time.Now().UTC()
	if err := createOwnership(h.ManagedRoot, Ownership{
		Version:           1,
		MachineID:         h.MachineID,
		State:             "ADOPTED",
		AdoptedFromPlanID: request.PlanID,
		AdoptedAt:         now,
	}); err != nil {
		if existing, readErr := ReadOwnership(h.ManagedRoot); readErr == nil && existing.MachineID == h.MachineID {
			return TakeoverResult{PlanID: request.PlanID, Ownership: existing.State, Message: "WARP is already owned by this Machine"}, nil
		}
		return nil, err
	}
	return TakeoverResult{
		PlanID:    request.PlanID,
		Ownership: "ADOPTED",
		Message:   "Ownership recorded; create a new resource plan before any WARP mutation",
	}, nil
}

func createOwnership(root string, ownership Ownership) error {
	path, err := ownershipPath(root)
	if err != nil {
		return err
	}
	if err := secureDirectory(filepath.Dir(filepath.Dir(path))); err != nil {
		return err
	}
	if err := secureDirectory(filepath.Dir(path)); err != nil {
		return err
	}
	content, err := json.Marshal(ownership)
	if err != nil {
		return err
	}
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	name := file.Name()
	if _, err := file.Write(content); err != nil {
		file.Close()
		os.Remove(name)
		return fmt.Errorf("write %s: %w", name, err)
	}
	if err := file.Sync(); err != nil {
		file.Close()
		os.Remove(name)
		return fmt.Errorf("sync %s: %w", name, err)
	}
	return file.Close()
}

func decodeTakeover(payload json.RawMessage) (TakeoverRequest, error) {
	decoder := json.NewDecoder(strings.NewReader(string(payload)))
	decoder.DisallowUnknownFields()
	var request TakeoverRequest
	if err := decoder.Decode(&request); err != nil {
		return TakeoverRequest{}, fmt.Errorf("WARP_TAKEOVER_INVALID_PAYLOAD: %w", err)
	}
	return request, nil
}

func (h TakeoverHandler) detect3XUI(ctx context.Context) (bool, string, error) {
	for _, path := range []string{
		"/etc/x-ui",
		"/usr/local/x-ui",
		"/usr/local/bin/x-ui",
		"/etc/systemd/system/x-ui.service",
		"/lib/systemd/system/x-ui.service",
	} {
		if _, err := os.Lstat(path); err == nil {
			return true, path + " exists", nil
		} else if !errors.Is(err, os.ErrNotExist) {
			return false, "", fmt.Errorf("inspect %s: %w", path, err)
		}
	}

	for _, check := range []struct {
		binary    string
		arguments []string
	}{
		{binary: "ps", arguments: []string{"-eo", "comm=,args="}},
		{binary: "systemctl", arguments: []string{"list-unit-files", "--type=service", "--no-legend", "--no-pager"}},
	} {
		output, err := h.runInspection(ctx, check.binary, check.arguments...)
		if err != nil {
			return false, "", err
		}
		if contains3XUIIndicator(output) {
			return true, check.binary + " reported a 3X-UI/x-ui indicator", nil
		}
	}

	lookup := h.LookupPath
	if lookup == nil {
		lookup = exec.LookPath
	}
	if _, err := lookup("docker"); err == nil {
		output, runErr := h.runInspection(ctx, "docker", "ps", "--all", "--format", "{{.Names}} {{.Image}} {{.Command}}")
		if runErr != nil {
			return false, "", errors.New("Docker exists but its containers cannot be inspected")
		}
		if contains3XUIIndicator(output) {
			return true, "Docker reported a 3X-UI/x-ui container", nil
		}
	}
	return false, "no 3X-UI indicators detected", nil
}

func (h TakeoverHandler) runInspection(ctx context.Context, name string, arguments ...string) (string, error) {
	lookup := h.LookupPath
	if lookup == nil {
		lookup = exec.LookPath
	}
	if _, err := lookup(name); err != nil {
		return "", fmt.Errorf("%s is required for the 3X-UI safety inspection", name)
	}
	commandContext, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	runner := h.Runner
	if runner == nil {
		runner = CommandRunner{}
	}
	output, err := runner.Run(commandContext, name, arguments...)
	if err != nil {
		return "", fmt.Errorf("%s safety inspection failed", name)
	}
	return string(output), nil
}

func contains3XUIIndicator(value string) bool {
	lower := strings.ToLower(value)
	return strings.Contains(lower, "x-ui") || strings.Contains(lower, "3x-ui")
}

func boundedTakeoverMessage(message string) string {
	message = strings.TrimSpace(message)
	if len(message) > 512 {
		return message[:512]
	}
	return message
}
