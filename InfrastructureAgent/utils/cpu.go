package utils

import (
	"fmt"
	"log/slog"
	"oneuptime-infrastructure-agent/model"
	"time"

	"github.com/shirou/gopsutil/v3/cpu"
)

func GetCpuMetrics() *model.CPUMetrics {
	// Use gopsutil's cpu.Percent for accurate CPU usage
	percent, err := cpu.Percent(time.Second, false)
	if err != nil || len(percent) == 0 {
		slog.Error(fmt.Sprintf("error fetching CPU percent: %v", err))
		return nil
	}
	cpuUsagePercent := percent[0]

	numberOfCpuCores, err := cpu.Counts(true)
	if err != nil {
		slog.Error(fmt.Sprintf("error fetching CPU core count: %v", err))
		return nil
	}

	return &model.CPUMetrics{
		PercentUsed: cpuUsagePercent,
		Cores:       numberOfCpuCores,
	}
}

func TotalCPUTime(times cpu.TimesStat) float64 {
	return times.User + times.System + times.Idle + times.Nice +
		times.Iowait + times.Irq + times.Softirq + times.Steal +
		times.Guest + times.GuestNice
}
