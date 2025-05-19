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

	return &model.CPUMetrics{
		PercentUsed: avgCorePercent,
		Cores:       numberOfCpuCores,
	}
}
