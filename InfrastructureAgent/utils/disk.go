package utils

import (
	"log/slog"
	"oneuptime-infrastructure-agent/model"
	"path/filepath"
	"strings"

	"github.com/shirou/gopsutil/v3/disk"
)

// GetDiskMetrics retrieves disk metrics for a given path
func GetDiskMetrics(path string) *model.BasicDiskMetrics {
	usageStat, err := disk.Usage(path)
	if err != nil {
		slog.Error(err.Error())
		return nil
	}
	var percentUsed, percentFree float64
	if usageStat.Total != 0 {
		percentUsed = float64(usageStat.Used) / float64(usageStat.Total) * 100
		percentFree = float64(usageStat.Free) / float64(usageStat.Total) * 100
	}

	metrics := &model.BasicDiskMetrics{
		Total:       usageStat.Total,
		Free:        usageStat.Free,
		Used:        usageStat.Used,
		DiskPath:    path,
		PercentUsed: percentUsed,
		PercentFree: percentFree,
	}

	return metrics
}

// ListDiskMetrics lists disk metrics for all partitions, enriched with I/O counters.
func ListDiskMetrics() []*model.BasicDiskMetrics {
	partitions, err := disk.Partitions(false) // set to true if you want all filesystems
	if err != nil {
		slog.Error(err.Error())
		return nil
	}

	// Gather I/O counters once, keyed by device name (e.g. "sda", "nvme0n1").
	ioCounters, ioErr := disk.IOCounters()
	if ioErr != nil {
		slog.Warn("Failed to fetch disk I/O counters", "error", ioErr)
	}

	var metricsList []*model.BasicDiskMetrics
	for _, partition := range partitions {
		metrics := GetDiskMetrics(partition.Mountpoint)
		if metrics == nil {
			continue // Skip this partition on error
		}
		metrics.Device = partition.Device
		metrics.Fstype = partition.Fstype

		if ioErr == nil {
			deviceKey := deriveIODeviceKey(partition.Device)
			if io, ok := ioCounters[deviceKey]; ok {
				metrics.ReadBytes = io.ReadBytes
				metrics.WriteBytes = io.WriteBytes
				metrics.ReadCount = io.ReadCount
				metrics.WriteCount = io.WriteCount
				metrics.IoTimeMs = io.IoTime
			}
		}

		metricsList = append(metricsList, metrics)
	}

	return metricsList
}

// deriveIODeviceKey trims /dev/ prefix so it matches gopsutil's IOCounters map keys.
func deriveIODeviceKey(device string) string {
	if device == "" {
		return device
	}
	base := filepath.Base(device)
	return strings.TrimSpace(base)
}
