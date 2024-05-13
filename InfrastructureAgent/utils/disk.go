package utils

import (
	"log/slog"

	"github.com/shirou/gopsutil/v3/disk"
)

// getDiskMetrics retrieves disk metrics for a given path
func getDiskMetrics(path string) *BasicDiskMetrics {
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

	metrics := &BasicDiskMetrics{
		Total:       usageStat.Total,
		Free:        usageStat.Free,
		Used:        usageStat.Used,
		DiskPath:    path,
		PercentUsed: percentUsed,
		PercentFree: percentFree,
	}

	return metrics
}

// listDiskMetrics lists disk metrics for all partitions
func listDiskMetrics() []*BasicDiskMetrics {
	partitions, err := disk.Partitions(false) // set to true if you want all filesystems
	if err != nil {
		slog.Error(err.Error())
		return nil
	}

	var metricsList []*BasicDiskMetrics
	for _, partition := range partitions {
		metrics := getDiskMetrics(partition.Mountpoint)
		if metrics == nil {
			continue // Skip this partition on error
		}
		metricsList = append(metricsList, metrics)
	}

	return metricsList
}
