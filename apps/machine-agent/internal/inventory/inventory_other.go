// SPDX-License-Identifier: AGPL-3.0-only

//go:build !linux

package inventory

func memoryTotalBytes() (uint64, error) {
	return 0, nil
}

func diskAvailableBytes(_ string) (uint64, error) {
	return 0, nil
}
