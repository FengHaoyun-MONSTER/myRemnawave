// SPDX-License-Identifier: AGPL-3.0-only

package config

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"time"
)

const (
	defaultStateDir        = "/var/lib/myremnawave-agent"
	defaultManagedRoot     = "/opt/myremnawave"
	defaultHeartbeat       = 30 * time.Second
	defaultCommandTimeout  = 5 * time.Minute
	defaultReconnectMin    = time.Second
	defaultReconnectMax    = time.Minute
	defaultMaxMessageBytes = int64(1 << 20)
	hardMaxMessageBytes    = int64(4 << 20)
)

var uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$`)

type LookupEnv func(string) (string, bool)

type Config struct {
	PanelURL          *url.URL
	MachineID         string
	ClientCertFile    string
	ClientKeyFile     string
	CAFile            string
	StateDir          string
	ManagedRoot       string
	HeartbeatInterval time.Duration
	CommandTimeout    time.Duration
	ReconnectMin      time.Duration
	ReconnectMax      time.Duration
	MaxMessageBytes   int64
}

func Load() (Config, error) {
	return LoadFrom(os.LookupEnv)
}

func LoadFrom(lookup LookupEnv) (Config, error) {
	panelRaw, err := required(lookup, "MYREMNAWAVE_PANEL_URL")
	if err != nil {
		return Config{}, err
	}
	panelURL, err := url.Parse(panelRaw)
	if err != nil {
		return Config{}, fmt.Errorf("parse MYREMNAWAVE_PANEL_URL: %w", err)
	}
	if panelURL.Scheme != "wss" || panelURL.Host == "" || panelURL.User != nil {
		return Config{}, errors.New("MYREMNAWAVE_PANEL_URL must be an absolute wss URL without user information")
	}

	machineID, err := required(lookup, "MYREMNAWAVE_MACHINE_ID")
	if err != nil {
		return Config{}, err
	}
	if !uuidPattern.MatchString(machineID) {
		return Config{}, errors.New("MYREMNAWAVE_MACHINE_ID must be a UUID")
	}

	clientCert, err := requiredAbsolutePath(lookup, "MYREMNAWAVE_CLIENT_CERT_FILE")
	if err != nil {
		return Config{}, err
	}
	clientKey, err := requiredAbsolutePath(lookup, "MYREMNAWAVE_CLIENT_KEY_FILE")
	if err != nil {
		return Config{}, err
	}
	caFile, err := requiredAbsolutePath(lookup, "MYREMNAWAVE_CA_FILE")
	if err != nil {
		return Config{}, err
	}

	stateDir, err := optionalAbsolutePath(lookup, "MYREMNAWAVE_STATE_DIR", defaultStateDir)
	if err != nil {
		return Config{}, err
	}
	managedRoot, err := optionalAbsolutePath(lookup, "MYREMNAWAVE_MANAGED_ROOT", defaultManagedRoot)
	if err != nil {
		return Config{}, err
	}

	heartbeat, err := durationValue(lookup, "MYREMNAWAVE_HEARTBEAT_INTERVAL", defaultHeartbeat, 5*time.Second, 5*time.Minute)
	if err != nil {
		return Config{}, err
	}
	commandTimeout, err := durationValue(lookup, "MYREMNAWAVE_COMMAND_TIMEOUT", defaultCommandTimeout, 10*time.Second, 30*time.Minute)
	if err != nil {
		return Config{}, err
	}
	reconnectMin, err := durationValue(lookup, "MYREMNAWAVE_RECONNECT_MIN", defaultReconnectMin, time.Second, time.Minute)
	if err != nil {
		return Config{}, err
	}
	reconnectMax, err := durationValue(lookup, "MYREMNAWAVE_RECONNECT_MAX", defaultReconnectMax, 5*time.Second, 10*time.Minute)
	if err != nil {
		return Config{}, err
	}
	if reconnectMax < reconnectMin {
		return Config{}, errors.New("MYREMNAWAVE_RECONNECT_MAX must be greater than or equal to MYREMNAWAVE_RECONNECT_MIN")
	}

	maxMessageBytes, err := int64Value(lookup, "MYREMNAWAVE_MAX_MESSAGE_BYTES", defaultMaxMessageBytes, 1024, hardMaxMessageBytes)
	if err != nil {
		return Config{}, err
	}

	return Config{
		PanelURL:          panelURL,
		MachineID:         machineID,
		ClientCertFile:    clientCert,
		ClientKeyFile:     clientKey,
		CAFile:            caFile,
		StateDir:          filepath.Clean(stateDir),
		ManagedRoot:       filepath.Clean(managedRoot),
		HeartbeatInterval: heartbeat,
		CommandTimeout:    commandTimeout,
		ReconnectMin:      reconnectMin,
		ReconnectMax:      reconnectMax,
		MaxMessageBytes:   maxMessageBytes,
	}, nil
}

func (c Config) EnsureStateDir() error {
	info, err := os.Lstat(c.StateDir)
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("inspect state directory: %w", err)
		}
		if err := os.MkdirAll(c.StateDir, 0o700); err != nil {
			return fmt.Errorf("create state directory: %w", err)
		}
		return nil
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
		return errors.New("state directory must be a real directory, not a symlink")
	}
	if err := os.Chmod(c.StateDir, 0o700); err != nil {
		return fmt.Errorf("secure state directory: %w", err)
	}
	return nil
}

func required(lookup LookupEnv, name string) (string, error) {
	value, ok := lookup(name)
	if !ok || value == "" {
		return "", fmt.Errorf("%s is required", name)
	}
	return value, nil
}

func requiredAbsolutePath(lookup LookupEnv, name string) (string, error) {
	value, err := required(lookup, name)
	if err != nil {
		return "", err
	}
	if !filepath.IsAbs(value) {
		return "", fmt.Errorf("%s must be an absolute path", name)
	}
	return filepath.Clean(value), nil
}

func optionalAbsolutePath(lookup LookupEnv, name, fallback string) (string, error) {
	value, ok := lookup(name)
	if !ok || value == "" {
		value = fallback
	}
	if !filepath.IsAbs(value) {
		return "", fmt.Errorf("%s must be an absolute path", name)
	}
	return value, nil
}

func durationValue(lookup LookupEnv, name string, fallback, minimum, maximum time.Duration) (time.Duration, error) {
	raw, ok := lookup(name)
	if !ok || raw == "" {
		return fallback, nil
	}
	value, err := time.ParseDuration(raw)
	if err != nil {
		return 0, fmt.Errorf("parse %s: %w", name, err)
	}
	if value < minimum || value > maximum {
		return 0, fmt.Errorf("%s must be between %s and %s", name, minimum, maximum)
	}
	return value, nil
}

func int64Value(lookup LookupEnv, name string, fallback, minimum, maximum int64) (int64, error) {
	raw, ok := lookup(name)
	if !ok || raw == "" {
		return fallback, nil
	}
	value, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("parse %s: %w", name, err)
	}
	if value < minimum || value > maximum {
		return 0, fmt.Errorf("%s must be between %d and %d", name, minimum, maximum)
	}
	return value, nil
}
