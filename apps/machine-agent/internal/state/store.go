// SPDX-License-Identifier: AGPL-3.0-only

package state

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/FengHaoyun-MONSTER/myRemnawave/apps/machine-agent/internal/protocol"
)

type CommandRecord struct {
	IdempotencyKey string                 `json:"idempotencyKey"`
	Result         protocol.CommandResult `json:"result"`
	StoredAt       time.Time              `json:"storedAt"`
}

type Store interface {
	Get(idempotencyKey string) (protocol.CommandResult, bool, error)
	Put(idempotencyKey string, result protocol.CommandResult) (protocol.CommandResult, bool, error)
}

type FileStore struct {
	directory string
	mu        sync.Mutex
}

func NewFileStore(directory string) (*FileStore, error) {
	if !filepath.IsAbs(directory) {
		return nil, errors.New("state store directory must be absolute")
	}
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return nil, fmt.Errorf("create command state directory: %w", err)
	}
	info, err := os.Lstat(directory)
	if err != nil {
		return nil, fmt.Errorf("inspect command state directory: %w", err)
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
		return nil, errors.New("command state directory must be a real directory")
	}
	return &FileStore{directory: directory}, nil
}

func (s *FileStore) Get(idempotencyKey string) (protocol.CommandResult, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.getLocked(idempotencyKey)
}

func (s *FileStore) Put(idempotencyKey string, result protocol.CommandResult) (protocol.CommandResult, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if existing, found, err := s.getLocked(idempotencyKey); err != nil || found {
		return existing, found, err
	}
	record := CommandRecord{
		IdempotencyKey: idempotencyKey,
		Result:         result,
		StoredAt:       time.Now().UTC(),
	}
	raw, err := json.Marshal(record)
	if err != nil {
		return protocol.CommandResult{}, false, fmt.Errorf("encode command record: %w", err)
	}

	finalPath := s.pathFor(idempotencyKey)
	temp, err := os.CreateTemp(s.directory, ".command-*.tmp")
	if err != nil {
		return protocol.CommandResult{}, false, fmt.Errorf("create temporary command record: %w", err)
	}
	tempPath := temp.Name()
	defer os.Remove(tempPath)

	if err := temp.Chmod(0o600); err != nil {
		temp.Close()
		return protocol.CommandResult{}, false, fmt.Errorf("secure temporary command record: %w", err)
	}
	if _, err := temp.Write(raw); err != nil {
		temp.Close()
		return protocol.CommandResult{}, false, fmt.Errorf("write command record: %w", err)
	}
	if err := temp.Sync(); err != nil {
		temp.Close()
		return protocol.CommandResult{}, false, fmt.Errorf("sync command record: %w", err)
	}
	if err := temp.Close(); err != nil {
		return protocol.CommandResult{}, false, fmt.Errorf("close command record: %w", err)
	}
	if err := os.Rename(tempPath, finalPath); err != nil {
		return protocol.CommandResult{}, false, fmt.Errorf("commit command record: %w", err)
	}
	return result, false, nil
}

func (s *FileStore) getLocked(idempotencyKey string) (protocol.CommandResult, bool, error) {
	raw, err := os.ReadFile(s.pathFor(idempotencyKey))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return protocol.CommandResult{}, false, nil
		}
		return protocol.CommandResult{}, false, fmt.Errorf("read command record: %w", err)
	}
	var record CommandRecord
	if err := json.Unmarshal(raw, &record); err != nil {
		return protocol.CommandResult{}, false, fmt.Errorf("decode command record: %w", err)
	}
	if record.IdempotencyKey != idempotencyKey {
		return protocol.CommandResult{}, false, errors.New("command record integrity check failed")
	}
	return record.Result, true, nil
}

func (s *FileStore) pathFor(idempotencyKey string) string {
	hash := sha256.Sum256([]byte(idempotencyKey))
	return filepath.Join(s.directory, hex.EncodeToString(hash[:])+".json")
}
