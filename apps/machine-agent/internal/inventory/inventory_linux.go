// SPDX-License-Identifier: AGPL-3.0-only

//go:build linux

package inventory

import (
	"bufio"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"syscall"
)

func memoryTotalBytes() (uint64, error) {
	file, err := os.Open("/proc/meminfo")
	if err != nil {
		return 0, fmt.Errorf("open meminfo: %w", err)
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) == 3 && fields[0] == "MemTotal:" && fields[2] == "kB" {
			kilobytes, err := strconv.ParseUint(fields[1], 10, 64)
			if err != nil {
				return 0, fmt.Errorf("parse total memory: %w", err)
			}
			return kilobytes * 1024, nil
		}
	}
	if err := scanner.Err(); err != nil {
		return 0, fmt.Errorf("scan meminfo: %w", err)
	}
	return 0, errors.New("MemTotal was not found in /proc/meminfo")
}

func diskAvailableBytes(path string) (uint64, error) {
	var stats syscall.Statfs_t
	if err := syscall.Statfs(path, &stats); err != nil {
		if os.IsNotExist(err) {
			parent := path
			for parent != "/" {
				parent = strings.TrimSuffix(parent, "/")
				index := strings.LastIndex(parent, "/")
				if index <= 0 {
					parent = "/"
				} else {
					parent = parent[:index]
				}
				if candidateErr := syscall.Statfs(parent, &stats); candidateErr == nil {
					return stats.Bavail * uint64(stats.Bsize), nil
				}
			}
		}
		return 0, fmt.Errorf("read disk availability for %s: %w", path, err)
	}
	return stats.Bavail * uint64(stats.Bsize), nil
}
