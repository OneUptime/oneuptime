package utils

import (
	"log/slog"
	"oneuptime-infrastructure-agent/model"

	"github.com/shirou/gopsutil/v3/mem"
)

func GetMemoryMetrics() *model.MemoryMetrics {
	memoryInfo, err := mem.VirtualMemory()
	if err != nil {
		slog.Error("Error while fetching memory metrics: ", err)
		return nil
	}
	return &model.MemoryMetrics{
		Total:       memoryInfo.Total,
		Free:        memoryInfo.Free,
		Used:        memoryInfo.Used,
		PercentUsed: memoryInfo.UsedPercent,
		PercentFree: 100 - memoryInfo.UsedPercent,
	}
}
