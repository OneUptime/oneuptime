package utils

import (
	"fmt"
	"log/slog"
	"oneuptime-infrastructure-agent/model"
	"time"

	"github.com/shirou/gopsutil/v3/cpu"
)

func GetCpuMetrics() *model.CPUMetrics {
	// Get per-core CPU percentages
	perCorePercent, err := cpu.Percent(time.Second, true)
	if err != nil {
		slog.Error(fmt.Sprintf("error fetching per-core CPU percent: %v", err))
		return nil
	}

	// Calculate average of all cores
	var avgCorePercent float64
	if len(perCorePercent) > 0 {
		var sum float64
		for _, p := range perCorePercent {
			sum += p
		}
		avgCorePercent = sum / float64(len(perCorePercent))
	} else {
		// Fallback to overall CPU percentage
		overallPercent, err := cpu.Percent(time.Second, false)
		if err != nil || len(overallPercent) == 0 {
			slog.Error(fmt.Sprintf("error fetching CPU percent: %v", err))
			return nil
		}
		avgCorePercent = overallPercent[0]
	}

	numberOfCpuCores, err := cpu.Counts(true)
	if err != nil {
		slog.Error(fmt.Sprintf("error fetching CPU core count: %v", err))
		return nil
	}

	metrics := &model.CPUMetrics{
		PercentUsed:    avgCorePercent,
		Cores:          numberOfCpuCores,
		PerCorePercent: perCorePercent,
	}

	// CPU time breakdown. Non-fatal: leave zero values if unsupported on this platform.
	if times, err := cpu.Times(false); err == nil && len(times) > 0 {
		t := times[0]
		total := t.User + t.System + t.Idle + t.Nice + t.Iowait + t.Irq + t.Softirq + t.Steal + t.Guest + t.GuestNice
		if total > 0 {
			metrics.TimeUserPercent = (t.User / total) * 100
			metrics.TimeSystemPercent = (t.System / total) * 100
			metrics.TimeIdlePercent = (t.Idle / total) * 100
			metrics.TimeIoWaitPercent = (t.Iowait / total) * 100
			metrics.TimeStealPercent = (t.Steal / total) * 100
			metrics.TimeNicePercent = (t.Nice / total) * 100
			metrics.TimeIrqPercent = (t.Irq / total) * 100
			metrics.TimeSoftIrqPercent = (t.Softirq / total) * 100
		}
	}

	return metrics
}
