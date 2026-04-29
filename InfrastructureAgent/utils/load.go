package utils

import (
	"log/slog"
	"oneuptime-infrastructure-agent/model"

	"github.com/shirou/gopsutil/v3/load"
)

// GetLoadMetrics returns 1/5/15-minute load averages.
// Windows exposes this via a gopsutil emulation layer; native Unix reads from /proc/loadavg.
func GetLoadMetrics() *model.LoadMetrics {
	avg, err := load.Avg()
	if err != nil {
		slog.Warn("Failed to fetch load average", "error", err)
		return nil
	}
	return &model.LoadMetrics{
		Load1:  avg.Load1,
		Load5:  avg.Load5,
		Load15: avg.Load15,
	}
}
