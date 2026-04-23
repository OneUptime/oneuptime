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

	metrics := &model.MemoryMetrics{
		Total:       memoryInfo.Total,
		Free:        memoryInfo.Free,
		Used:        memoryInfo.Used,
		PercentUsed: memoryInfo.UsedPercent,
		PercentFree: 100 - memoryInfo.UsedPercent,
		Available:   memoryInfo.Available,
		Buffers:     memoryInfo.Buffers,
		Cached:      memoryInfo.Cached,
	}

	if swap, err := mem.SwapMemory(); err == nil && swap != nil {
		metrics.SwapTotal = swap.Total
		metrics.SwapUsed = swap.Used
		metrics.SwapFree = swap.Free
		metrics.SwapPercentUsed = swap.UsedPercent
	}

	return metrics
}
