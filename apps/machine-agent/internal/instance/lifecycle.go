// SPDX-License-Identifier: AGPL-3.0-only

package instance

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
)

type LifecycleRequest struct {
	InstanceID string `json:"instanceId"`
}

type LifecycleResult struct {
	InstanceID string `json:"instanceId"`
	State      string `json:"state"`
}

type LifecycleHandler struct {
	Runner Runner
	Start  bool
}

func (h LifecycleHandler) Execute(ctx context.Context, payload json.RawMessage) (any, error) {
	var request LifecycleRequest
	decoder := json.NewDecoder(strings.NewReader(string(payload)))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&request); err != nil || !uuidPattern.MatchString(request.InstanceID) {
		return nil, errors.New("invalid instance lifecycle payload")
	}
	runner := h.Runner
	if runner == nil {
		runner = DockerRunner{}
	}
	containerName := "myremnawave-" + strings.ReplaceAll(request.InstanceID, "-", "")[:16]
	if h.Start {
		if output, err := runner.Run(ctx, "start", containerName); err != nil {
			return nil, commandError("CONTAINER_START_FAILED", output, err)
		}
		return LifecycleResult{InstanceID: request.InstanceID, State: "RUNNING"}, nil
	}
	if output, err := runner.Run(ctx, "stop", "--time", "30", containerName); err != nil {
		message := strings.ToLower(string(output))
		if !strings.Contains(message, "no such container") && !strings.Contains(message, "is not running") {
			return nil, commandError("CONTAINER_STOP_FAILED", output, err)
		}
	}
	return LifecycleResult{InstanceID: request.InstanceID, State: "STOPPED"}, nil
}
