package utils

import (
	"errors"
	"fmt"
	"log/slog"
	"oneuptime-infrastructure-agent/model"
	"sync"
	"time"

	"github.com/shirou/gopsutil/v4/cpu"
)

// cpuTimes reads the CPU's counters - the seconds spent in each state since
// boot, summed over every core. It is a variable so tests can hand in the
// readings.
var cpuTimes = func() (*cpu.TimesStat, error) {
	times, err := cpu.Times(false)
	if err != nil {
		return nil, err
	}
	if len(times) == 0 {
		return nil, errors.New("no CPU times returned")
	}
	return &times[0], nil
}

// The CPU's counters at the previous reading. The agent collects every 30
// seconds, so the time breakdown it reports is how the CPU spent those 30
// seconds. The counters alone give a breakdown of the time since boot: an
// average that barely moves, so a disk that had kept the CPU waiting for
// minutes still showed an I/O wait near its average since boot - the same
// lifetime average the process CPU% had (procs.go).
var (
	cpuTimesMu       sync.Mutex
	previousCPUTimes *cpu.TimesStat
)

// cpuTimeShares is how the CPU spent an interval: each state's share of it,
// in percent.
type cpuTimeShares struct {
	user    float64
	system  float64
	idle    float64
	ioWait  float64
	steal   float64
	nice    float64
	irq     float64
	softIrq float64
}

// cpuTimeSharesBetween returns how the CPU spent the time between two readings
// of its counters - each state's share of that time, as top shows it - and
// whether there was time to share out. There is none when no time passed, or
// when a counter went backwards, as it does when it is reset.
func cpuTimeSharesBetween(previous cpu.TimesStat, current cpu.TimesStat) (cpuTimeShares, bool) {
	deltas := []float64{
		current.User - previous.User,
		current.System - previous.System,
		current.Idle - previous.Idle,
		current.Iowait - previous.Iowait,
		current.Steal - previous.Steal,
		current.Nice - previous.Nice,
		current.Irq - previous.Irq,
		current.Softirq - previous.Softirq,
	}

	// Guest and GuestNice are left out: Linux counts the time spent running a
	// guest in User and Nice too, so adding them would count it twice.
	var total float64
	for _, delta := range deltas {
		if delta < 0 {
			return cpuTimeShares{}, false
		}
		total += delta
	}
	if total <= 0 {
		return cpuTimeShares{}, false
	}

	share := func(delta float64) float64 {
		return delta / total * 100
	}

	return cpuTimeShares{
		user:    share(deltas[0]),
		system:  share(deltas[1]),
		idle:    share(deltas[2]),
		ioWait:  share(deltas[3]),
		steal:   share(deltas[4]),
		nice:    share(deltas[5]),
		irq:     share(deltas[6]),
		softIrq: share(deltas[7]),
	}, true
}

// readCPUTimesIfFirst takes the first reading of the CPU's counters, so the
// first collection has an earlier reading to compare with too.
func readCPUTimesIfFirst() {
	cpuTimesMu.Lock()
	defer cpuTimesMu.Unlock()

	if previousCPUTimes != nil {
		return
	}
	if times, err := cpuTimes(); err == nil {
		previousCPUTimes = times
	}
}

// cpuTimeSharesSincePreviousReading reads the CPU's counters and returns how
// the CPU spent the time since the previous reading, and whether that could be
// told: not on a platform the counters cannot be read on, and not without an
// earlier reading.
func cpuTimeSharesSincePreviousReading() (cpuTimeShares, bool) {
	current, err := cpuTimes()
	if err != nil {
		return cpuTimeShares{}, false
	}

	cpuTimesMu.Lock()
	previous := previousCPUTimes
	previousCPUTimes = current
	cpuTimesMu.Unlock()

	if previous == nil {
		return cpuTimeShares{}, false
	}
	return cpuTimeSharesBetween(*previous, *current)
}

func GetCpuMetrics() *model.CPUMetrics {
	// The first collection reads the counters before the second that
	// cpu.Percent takes below, so its time breakdown covers that second.
	// Every later one covers the time since the collection before.
	readCPUTimesIfFirst()

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
	if shares, ok := cpuTimeSharesSincePreviousReading(); ok {
		metrics.TimeUserPercent = shares.user
		metrics.TimeSystemPercent = shares.system
		metrics.TimeIdlePercent = shares.idle
		metrics.TimeIoWaitPercent = shares.ioWait
		metrics.TimeStealPercent = shares.steal
		metrics.TimeNicePercent = shares.nice
		metrics.TimeIrqPercent = shares.irq
		metrics.TimeSoftIrqPercent = shares.softIrq
	}

	return metrics
}
