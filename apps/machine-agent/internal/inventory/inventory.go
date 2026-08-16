// SPDX-License-Identifier: AGPL-3.0-only

package inventory

import (
	"bufio"
	"errors"
	"fmt"
	"os"
	"runtime"
	"strconv"
	"strings"
)

type System struct {
	Hostname      string `json:"hostname"`
	OSID          string `json:"osId"`
	OSVersion     string `json:"osVersion"`
	OSPrettyName  string `json:"osPrettyName"`
	Architecture  string `json:"architecture"`
	CPUCount      int    `json:"cpuCount"`
	MemoryBytes   uint64 `json:"memoryBytes"`
	DiskFreeBytes uint64 `json:"diskFreeBytes"`
}

func Collect(managedRoot string) (System, error) {
	hostname, err := os.Hostname()
	if err != nil {
		return System{}, fmt.Errorf("read hostname: %w", err)
	}
	osRelease, err := readOSRelease("/etc/os-release")
	if err != nil && runtime.GOOS == "linux" {
		return System{}, err
	}
	memoryBytes, err := memoryTotalBytes()
	if err != nil {
		return System{}, err
	}
	diskFreeBytes, err := diskAvailableBytes(managedRoot)
	if err != nil {
		return System{}, err
	}
	return System{
		Hostname:      hostname,
		OSID:          osRelease["ID"],
		OSVersion:     osRelease["VERSION_ID"],
		OSPrettyName:  osRelease["PRETTY_NAME"],
		Architecture:  runtime.GOARCH,
		CPUCount:      runtime.NumCPU(),
		MemoryBytes:   memoryBytes,
		DiskFreeBytes: diskFreeBytes,
	}, nil
}

func readOSRelease(path string) (map[string]string, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open os-release: %w", err)
	}
	defer file.Close()

	values := make(map[string]string)
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 1024), 64*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, raw, ok := strings.Cut(line, "=")
		if !ok || key == "" {
			continue
		}
		value, err := strconv.Unquote(raw)
		if err != nil {
			value = raw
		}
		values[key] = value
	}
	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("scan os-release: %w", err)
	}
	if len(values) == 0 {
		return nil, errors.New("os-release did not contain any values")
	}
	return values, nil
}
