package utils

import (
	"log/slog"
	"oneuptime-infrastructure-agent/model"

	"github.com/shirou/gopsutil/v3/disk"
)

// getDiskMetrics retrieves disk metrics for a given path
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

// listDiskMetrics lists disk metrics for all partitions
func ListDiskMetrics() []*model.BasicDiskMetrics {
	partitions, err := disk.Partitions(false) // set to true if you want all filesystems
	if err != nil {
		slog.Error(err.Error())
		return nil
	}

	var metricsList []*model.BasicDiskMetrics
	for _, partition := range partitions {
		metrics := GetDiskMetrics(partition.Mountpoint)
		if metrics == nil {
			continue // Skip this partition on error
		}
		metricsList = append(metricsList, metrics)
	}

	return metricsList
}
