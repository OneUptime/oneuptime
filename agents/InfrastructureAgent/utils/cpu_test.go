package utils

import (
	"errors"
	"math"
	"testing"

	"github.com/shirou/gopsutil/v4/cpu"
)

// The CPU's time breakdown - above all its I/O wait, which a criteria alerts
// on - is how the CPU spent the time since the previous collection, not since
// boot.
//
// None of these use t.Parallel: the previous reading is package-level state.

// cpuTimesStat is a reading of the CPU's counters, in seconds since boot.
func cpuTimesStat(user, system, idle, iowait float64) cpu.TimesStat {
	return cpu.TimesStat{CPU: "cpu-total", User: user, System: system, Idle: idle, Iowait: iowait}
}

func closeTo(got, want float64) bool {
	return math.Abs(got-want) < 1e-9
}

// The regression: a disk that has kept the CPU waiting for the last 30
// seconds. Since boot - 10 days of an idle server - the wait is 1% of the
// time, which is what the agent used to report; over the 30 seconds it is 80%.
func TestCPUTimeSharesBetweenAreTheIntervalsNotTheAverageSinceBoot(t *testing.T) {
	previous := cpuTimesStat(43200, 17280, 794880, 8640)
	// 30 seconds on one core: 3s user, 3s system, 24s waiting on the disk.
	current := cpuTimesStat(43203, 17283, 794880, 8664)

	shares, ok := cpuTimeSharesBetween(previous, current)
	if !ok {
		t.Fatal("no breakdown for 30 seconds of CPU time")
	}
	if !closeTo(shares.ioWait, 80) || !closeTo(shares.user, 10) || !closeTo(shares.system, 10) || !closeTo(shares.idle, 0) {
		t.Errorf("shares = %+v, want 80%% I/O wait, 10%% user, 10%% system", shares)
	}

	sinceBoot := current.Iowait / (current.User + current.System + current.Idle + current.Iowait) * 100
	if sinceBoot > 2 {
		t.Fatalf("the test's average since boot is %v%%, not the near-nothing it is meant to be", sinceBoot)
	}
}

func TestCPUTimeSharesBetween(t *testing.T) {
	cases := []struct {
		name     string
		previous cpu.TimesStat
		current  cpu.TimesStat
		ok       bool
		user     float64
		idle     float64
	}{
		{name: "busy then idle", previous: cpuTimesStat(100, 0, 100, 0), current: cpuTimesStat(115, 0, 145, 0), ok: true, user: 25, idle: 75},
		{name: "no time passed", previous: cpuTimesStat(100, 10, 100, 1), current: cpuTimesStat(100, 10, 100, 1), ok: false},
		{name: "a counter went backwards", previous: cpuTimesStat(100, 10, 100, 1), current: cpuTimesStat(90, 20, 130, 1), ok: false},
		{
			// Linux counts a guest's time in User too: it is not counted twice.
			name:     "a guest's time is the user time it is part of",
			previous: cpu.TimesStat{User: 100, Idle: 100, Guest: 50},
			current:  cpu.TimesStat{User: 120, Idle: 120, Guest: 70},
			ok:       true, user: 50, idle: 50,
		},
	}

	for _, c := range cases {
		shares, ok := cpuTimeSharesBetween(c.previous, c.current)
		if ok != c.ok || !closeTo(shares.user, c.user) || !closeTo(shares.idle, c.idle) {
			t.Errorf("%s: got (%+v, %v), want user %v%%, idle %v%%, ok %v", c.name, shares, ok, c.user, c.idle, c.ok)
		}
	}
}

// readingCPUTimes makes cpuTimes return readings one after another (an error
// once they run out), with no previous reading, until the test ends.
func readingCPUTimes(t *testing.T, readings ...cpu.TimesStat) {
	t.Helper()

	previousRead := cpuTimes
	next := 0
	cpuTimes = func() (*cpu.TimesStat, error) {
		if next >= len(readings) {
			return nil, errors.New("not implemented yet")
		}
		reading := readings[next]
		next++
		return &reading, nil
	}

	cpuTimesMu.Lock()
	previousCPUTimes = nil
	cpuTimesMu.Unlock()

	t.Cleanup(func() {
		cpuTimes = previousRead
		cpuTimesMu.Lock()
		previousCPUTimes = nil
		cpuTimesMu.Unlock()
	})
}

// Each collection's breakdown is of the time since the collection before. The
// first reading is taken before the first collection's, so it has one too.
func TestCPUTimeSharesFollowTheCollections(t *testing.T) {
	readingCPUTimes(t,
		cpuTimesStat(1000, 0, 9000, 0),
		cpuTimesStat(1001, 0, 9000, 0), // first collection: all of the second busy
		cpuTimesStat(1001, 0, 9029, 1), // the next: idle, waiting a little
		cpuTimesStat(1016, 0, 9044, 1), // the next: half busy
	)

	readCPUTimesIfFirst()
	readCPUTimesIfFirst() // only the first one reads

	want := []cpuTimeShares{
		{user: 100},
		{idle: 96.66666666666667, ioWait: 3.3333333333333335},
		{user: 50, idle: 50},
	}
	for index, expected := range want {
		shares, ok := cpuTimeSharesSincePreviousReading()
		if !ok || !closeTo(shares.user, expected.user) || !closeTo(shares.idle, expected.idle) || !closeTo(shares.ioWait, expected.ioWait) {
			t.Errorf("collection %d: got (%+v, %v), want %+v", index+1, shares, ok, expected)
		}
	}

	// A platform whose counters cannot be read reports no breakdown.
	if shares, ok := cpuTimeSharesSincePreviousReading(); ok {
		t.Errorf("got %+v from counters that could not be read", shares)
	}
}

// The released agents are built without cgo. gopsutil v3 could not read the
// CPU on macOS without it, so every macOS report said "cpuMetrics": null.
func TestGetCpuMetricsReadsTheCPU(t *testing.T) {
	readingCPUTimes(t)
	cpuTimes = func() (*cpu.TimesStat, error) {
		times, err := cpu.Times(false)
		if err != nil || len(times) == 0 {
			return nil, err
		}
		return &times[0], nil
	}

	metrics := GetCpuMetrics()
	if metrics == nil {
		t.Fatal("no CPU metrics on this platform")
	}
	if metrics.Cores < 1 || len(metrics.PerCorePercent) < 1 {
		t.Errorf("CPU metrics = %+v, want the cores and their usage", *metrics)
	}
	if total := metrics.TimeUserPercent + metrics.TimeSystemPercent + metrics.TimeIdlePercent + metrics.TimeIoWaitPercent + metrics.TimeStealPercent + metrics.TimeNicePercent + metrics.TimeIrqPercent + metrics.TimeSoftIrqPercent; math.Abs(total-100) > 0.01 {
		t.Errorf("the first collection's time breakdown adds up to %v%%, want 100%%: %+v", total, *metrics)
	}
}
