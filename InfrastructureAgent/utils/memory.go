package utils

import (
	"log/slog"

	"github.com/shirou/gopsutil/v3/mem"
)

func getMemoryMetrics() *MemoryMetrics {
	memoryInfo, err := mem.VirtualMemory()
	if err != nil {
		slog.Error("Error while fetching memory metrics: ", err)
		return nil
	}
	return &MemoryMetrics{
		Total:       memoryInfo.Total,
		Free:        memoryInfo.Free,
		Used:        memoryInfo.Used,
		PercentUsed: memoryInfo.UsedPercent,
		PercentFree: 100 - memoryInfo.UsedPercent,
	}
}
