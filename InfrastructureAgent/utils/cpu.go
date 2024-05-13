package oneuptime_infrastructure_agent

import (
	"fmt"
	"log/slog"
	"time"

	"github.com/shirou/gopsutil/v3/cpu"
)

func getCpuMetrics() *CPUMetrics {
	//avg, err := load.Avg()
	//if err != nil {
	//	slog.Error(err)
	//	return nil
	//}
	//
	//numCpu, err := cpu.Counts(true)
	//if err != nil {
	//	slog.Error(err)
	//	return nil
	//}
	//
	//// Calculate CPU usage, which is the average load over the last minute divided by the number of CPUs
	//cpuUsage := (avg.Load1 / float64(numCpu)) * 100

	//trying new calculation method, more accurate
	// Get CPU times at the start
	startTimes, err := cpu.Times(false) // false to get the aggregate of all CPUs
	if err != nil {
		slog.Error(fmt.Sprintf("error fetching initial CPU times: %v", err))
		return nil
	}

	// Wait for a short interval (e.g., 1000 milliseconds)
	time.Sleep(1000 * time.Millisecond)

	// Get CPU times after the interval
	endTimes, err := cpu.Times(false)
	if err != nil {
		slog.Error(fmt.Sprintf("error fetching final CPU times: %v", err))
		return nil
	}

	// Calculate the difference in total and idle times
	totalDelta := totalCPUTime(endTimes[0]) - totalCPUTime(startTimes[0])
	idleDelta := endTimes[0].Idle - startTimes[0].Idle

	// Calculate the CPU usage percentage
	if totalDelta == 0 {
		slog.Error("totalDelta is 0")
		return nil
	}
	cpuUsagePercent := (1 - idleDelta/totalDelta) * 100

	return &CPUMetrics{
		PercentUsed: cpuUsagePercent,
	}
}

func totalCPUTime(times cpu.TimesStat) float64 {
	return times.User + times.System + times.Idle + times.Nice +
		times.Iowait + times.Irq + times.Softirq + times.Steal +
		times.Guest + times.GuestNice
}
