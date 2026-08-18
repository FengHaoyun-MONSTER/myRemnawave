// SPDX-License-Identifier: AGPL-3.0-only

package instance

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

const (
	managedLabel    = "io.myremnawave.managed"
	machineLabel    = "io.myremnawave.machine"
	instanceLabel   = "io.myremnawave.instance"
	configHashLabel = "io.myremnawave.config-sha256"
)

func inspectContainer(ctx context.Context, runner Runner, name, machineID, instanceID string) (bool, string, error) {
	output, err := runner.Run(ctx, "inspect", "--format", `{{json .Config.Labels}}`, name)
	if err != nil {
		if dockerObjectNotFound(output, err) {
			return false, "", nil
		}
		return false, "", commandError("CONTAINER_INSPECT_FAILED", output, err)
	}
	labels, err := decodeLabels(output)
	if err != nil {
		return false, "", fmt.Errorf("CONTAINER_INSPECT_FAILED: %w", err)
	}
	if labels[managedLabel] != "true" || labels[machineLabel] != machineID || labels[instanceLabel] != instanceID {
		return true, "", fmt.Errorf("OWNERSHIP_CONFLICT: container %s is not owned by this Machine instance", name)
	}
	return true, labels[configHashLabel], nil
}

func ensureManagedNetwork(ctx context.Context, runner Runner, machineID string) error {
	output, err := runner.Run(ctx, "network", "inspect", "--format", `{{json .Labels}}`, managedNetwork)
	if err != nil {
		if !dockerObjectNotFound(output, err) {
			return commandError("DOCKER_NETWORK_INSPECT_FAILED", output, err)
		}
		if output, createErr := runner.Run(
			ctx,
			"network",
			"create",
			"--label", managedLabel+"=true",
			"--label", machineLabel+"="+machineID,
			managedNetwork,
		); createErr != nil {
			return commandError("DOCKER_NETWORK_FAILED", output, createErr)
		}
		return nil
	}
	labels, err := decodeLabels(output)
	if err != nil {
		return fmt.Errorf("DOCKER_NETWORK_INSPECT_FAILED: %w", err)
	}
	if labels[managedLabel] != "true" || labels[machineLabel] != machineID {
		return fmt.Errorf("OWNERSHIP_CONFLICT: Docker network %s is not owned by this Machine", managedNetwork)
	}
	return nil
}

func decodeLabels(output []byte) (map[string]string, error) {
	labels := map[string]string{}
	if err := json.Unmarshal([]byte(strings.TrimSpace(string(output))), &labels); err != nil {
		return nil, errors.New("Docker returned invalid ownership labels")
	}
	return labels, nil
}

func dockerObjectNotFound(output []byte, err error) bool {
	message := strings.ToLower(strings.TrimSpace(string(output)) + " " + err.Error())
	return strings.Contains(message, "no such object") ||
		strings.Contains(message, "no such container") ||
		strings.Contains(message, "no such network") ||
		strings.Contains(message, "not found")
}
