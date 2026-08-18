// SPDX-License-Identifier: AGPL-3.0-only

package control

import (
	"context"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/coder/websocket"

	"github.com/FengHaoyun-MONSTER/myRemnawave/apps/machine-agent/internal/config"
	"github.com/FengHaoyun-MONSTER/myRemnawave/apps/machine-agent/internal/executor"
	"github.com/FengHaoyun-MONSTER/myRemnawave/apps/machine-agent/internal/protocol"
)

const (
	dialTimeout       = 20 * time.Second
	commandQueueDepth = 16
)

var capabilities = []string{
	protocol.CommandInventory,
	protocol.CommandDiscoverHost,
	protocol.CommandPreflight,
	protocol.CommandReconcileInstance,
	protocol.CommandReconcileCertificate,
	protocol.CommandReconcileWARP,
	protocol.CommandApplyConfig,
	protocol.CommandStartInstance,
	protocol.CommandStopInstance,
}

type Client struct {
	config   config.Config
	executor *executor.Executor
	logger   *slog.Logger
	version  string
}

func NewClient(configuration config.Config, commandExecutor *executor.Executor, logger *slog.Logger, version string) (*Client, error) {
	if commandExecutor == nil {
		return nil, errors.New("command executor is required")
	}
	if logger == nil {
		return nil, errors.New("logger is required")
	}
	if version == "" {
		return nil, errors.New("agent version is required")
	}
	return &Client{config: configuration, executor: commandExecutor, logger: logger, version: version}, nil
}

func (c *Client) Run(ctx context.Context) error {
	delay := c.config.ReconnectMin
	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		err := c.runSession(ctx)
		if err == nil || errors.Is(err, context.Canceled) {
			return err
		}
		c.logger.Warn("control session ended", "error", safeLogError(err), "retryIn", delay)
		if err := waitWithJitter(ctx, delay); err != nil {
			return err
		}
		delay *= 2
		if delay > c.config.ReconnectMax {
			delay = c.config.ReconnectMax
		}
	}
}

func (c *Client) runSession(ctx context.Context) error {
	tlsConfig, err := loadTLSConfig(c.config)
	if err != nil {
		return err
	}
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.TLSClientConfig = tlsConfig
	httpClient := &http.Client{Transport: transport}
	header := make(http.Header)
	header.Set("X-MyRemnawave-Machine-ID", c.config.MachineID)

	dialContext, cancel := context.WithTimeout(ctx, dialTimeout)
	defer cancel()
	connection, response, err := websocket.Dial(dialContext, c.config.PanelURL.String(), &websocket.DialOptions{
		HTTPClient:      httpClient,
		HTTPHeader:      header,
		CompressionMode: websocket.CompressionDisabled,
	})
	if err != nil {
		if response != nil {
			response.Body.Close()
			return fmt.Errorf("dial control plane: HTTP %d: %w", response.StatusCode, err)
		}
		return fmt.Errorf("dial control plane: %w", err)
	}
	defer connection.Close(websocket.StatusNormalClosure, "agent session closed")
	connection.SetReadLimit(c.config.MaxMessageBytes)

	sessionContext, sessionCancel := context.WithCancel(ctx)
	defer sessionCancel()
	writer := &sessionWriter{connection: connection}
	if err := c.sendHello(sessionContext, writer); err != nil {
		return err
	}
	c.logger.Info("control session established", "machineId", c.config.MachineID)

	commands := make(chan protocol.Command, commandQueueDepth)
	errorsChannel := make(chan error, 2)
	go c.readLoop(sessionContext, connection, commands, errorsChannel)
	go c.commandLoop(sessionContext, writer, commands, errorsChannel)

	heartbeat := time.NewTicker(c.config.HeartbeatInterval)
	defer heartbeat.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case err := <-errorsChannel:
			return err
		case <-heartbeat.C:
			if err := c.sendHeartbeat(sessionContext, writer); err != nil {
				return err
			}
		}
	}
}

func (c *Client) readLoop(ctx context.Context, connection *websocket.Conn, commands chan<- protocol.Command, errorsChannel chan<- error) {
	for {
		messageType, data, err := connection.Read(ctx)
		if err != nil {
			sendError(ctx, errorsChannel, fmt.Errorf("read control message: %w", err))
			return
		}
		if messageType != websocket.MessageText {
			sendError(ctx, errorsChannel, errors.New("control plane sent a non-text message"))
			return
		}
		envelope, err := protocol.DecodeEnvelope(data, c.config.MaxMessageBytes)
		if err != nil {
			sendError(ctx, errorsChannel, err)
			return
		}
		if envelope.Type != protocol.TypeCommand {
			continue
		}
		command, err := protocol.DecodePayload[protocol.Command](envelope.Payload)
		if err != nil {
			sendError(ctx, errorsChannel, err)
			return
		}
		select {
		case commands <- command:
		case <-ctx.Done():
			return
		default:
			sendError(ctx, errorsChannel, errors.New("command queue capacity exceeded"))
			return
		}
	}
}

func (c *Client) commandLoop(ctx context.Context, writer *sessionWriter, commands <-chan protocol.Command, errorsChannel chan<- error) {
	for {
		select {
		case <-ctx.Done():
			return
		case command := <-commands:
			result := c.executor.Execute(ctx, command)
			envelope, err := protocol.NewEnvelope("result-"+command.ID, protocol.TypeCommandResult, result)
			if err == nil {
				err = writer.write(ctx, envelope)
			}
			if err != nil {
				sendError(ctx, errorsChannel, fmt.Errorf("send command result: %w", err))
				return
			}
		}
	}
}

func (c *Client) sendHello(ctx context.Context, writer *sessionWriter) error {
	envelope, err := protocol.NewEnvelope("hello-"+c.config.MachineID, protocol.TypeHello, protocol.Hello{
		MachineID:    c.config.MachineID,
		AgentVersion: c.version,
		Capabilities: capabilities,
	})
	if err != nil {
		return err
	}
	return writer.write(ctx, envelope)
}

func (c *Client) sendHeartbeat(ctx context.Context, writer *sessionWriter) error {
	now := time.Now().UTC()
	envelope, err := protocol.NewEnvelope(fmt.Sprintf("heartbeat-%d", now.UnixMilli()), protocol.TypeHeartbeat, protocol.Heartbeat{
		MachineID: c.config.MachineID,
		Time:      now,
	})
	if err != nil {
		return err
	}
	return writer.write(ctx, envelope)
}

type sessionWriter struct {
	connection *websocket.Conn
	mu         sync.Mutex
}

func (w *sessionWriter) write(ctx context.Context, envelope protocol.Envelope) error {
	raw, err := json.Marshal(envelope)
	if err != nil {
		return fmt.Errorf("encode control message: %w", err)
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	writeContext, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	if err := w.connection.Write(writeContext, websocket.MessageText, raw); err != nil {
		return fmt.Errorf("write control message: %w", err)
	}
	return nil
}

func loadTLSConfig(configuration config.Config) (*tls.Config, error) {
	certificate, err := tls.LoadX509KeyPair(configuration.ClientCertFile, configuration.ClientKeyFile)
	if err != nil {
		return nil, fmt.Errorf("load client certificate: %w", err)
	}
	caPEM, err := os.ReadFile(configuration.CAFile)
	if err != nil {
		return nil, fmt.Errorf("read control CA: %w", err)
	}
	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM(caPEM) {
		return nil, errors.New("control CA file did not contain a valid certificate")
	}
	return &tls.Config{
		Certificates: []tls.Certificate{certificate},
		RootCAs:      roots,
		MinVersion:   tls.VersionTLS13,
	}, nil
}

func waitWithJitter(ctx context.Context, delay time.Duration) error {
	var randomBytes [8]byte
	if _, err := rand.Read(randomBytes[:]); err == nil {
		jitterRange := delay / 5
		if jitterRange > 0 {
			jitter := time.Duration(binary.BigEndian.Uint64(randomBytes[:]) % uint64(jitterRange))
			delay += jitter
		}
	}
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func sendError(ctx context.Context, channel chan<- error, err error) {
	select {
	case channel <- err:
	case <-ctx.Done():
	}
}

func safeLogError(err error) string {
	if err == nil {
		return ""
	}
	message := err.Error()
	if len(message) > 1024 {
		return message[:1024] + "…"
	}
	return message
}
