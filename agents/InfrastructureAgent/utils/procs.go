package utils

import (
	"log/slog"
	"oneuptime-infrastructure-agent/model"
	"sync"
	"time"

	"github.com/shirou/gopsutil/v4/process"
)

// processCPUReading is a process's CPU time at one collection: the seconds it
// had spent on a CPU (user plus system) since it started, and when that was
// read. createTimeMs tells a process apart from a later one that reuses its PID.
type processCPUReading struct {
	createTimeMs int64
	cpuSeconds   float64
	at           time.Time
}

// The readings of the previous collection, by PID. The agent collects every 30
// seconds, so a process's CPU percent is what it used over those 30 seconds.
// gopsutil's Process.CPUPercent divides all the CPU a process has used since it
// started by its age instead: a lifetime average that barely moves and does not
// follow the load - the flat line the container agents' CPU percent had too
// (agents/DockerAgent/otel-collector-config.yaml).
var (
	processCPUReadingsMu sync.Mutex
	processCPUReadings   = map[int32]processCPUReading{}
)

// cpuPercentSince returns the CPU a process used between its previous reading
// and this one, as a percent of one core - 100 is one core busy for the whole
// interval, as top counts it - and whether there was a previous reading to
// compare with. There is none on a process's first collection, when its PID
// now belongs to another process, when no time has passed, or when the
// counter went backwards.
func cpuPercentSince(previous processCPUReading, hasPrevious bool, current processCPUReading) (float64, bool) {
	if !hasPrevious || previous.createTimeMs != current.createTimeMs {
		return 0, false
	}
	elapsedSeconds := current.at.Sub(previous.at).Seconds()
	usedSeconds := current.cpuSeconds - previous.cpuSeconds
	if elapsedSeconds <= 0 || usedSeconds < 0 {
		return 0, false
	}
	return usedSeconds / elapsedSeconds * 100, true
}

// GetServerProcesses retrieves the list of server processes with enriched metrics
// (CPU%, memory, threads, status) where available. Missing enrichment fields fall
// back to zero so the payload stays compatible with older backends.
//
// A process's CPU% is the CPU it used since the previous collection, as a
// percent of one core. Its first collection (and every process's first, after
// the agent starts) has nothing to compare with and reports no CPU%.
func GetServerProcesses() []*model.ServerProcess {
	var serverProcesses []*model.ServerProcess

	processList, err := process.Processes()
	if err != nil {
		slog.Error("Failed to fetch process list", "error", err)
		return nil
	}

	processCPUReadingsMu.Lock()
	defer processCPUReadingsMu.Unlock()
	readings := make(map[int32]processCPUReading, len(processList))

	for _, p := range processList {
		name, err := p.Name()
		if err != nil {
			continue
		}
		cmdline, err := p.Cmdline()
		if err != nil {
			continue
		}

		proc := &model.ServerProcess{
			Pid:     p.Pid,
			Name:    name,
			Command: cmdline,
		}

		// Enrich with per-process resource usage. Any failure is non-fatal.
		createdMs, createErr := p.CreateTime()
		if createErr == nil {
			proc.CreateTimeMs = createdMs
		}
		if times, err := p.Times(); err == nil && createErr == nil {
			reading := processCPUReading{
				createTimeMs: createdMs,
				cpuSeconds:   times.User + times.System,
				at:           time.Now(),
			}
			readings[p.Pid] = reading
			previous, hasPrevious := processCPUReadings[p.Pid]
			if cpu, ok := cpuPercentSince(previous, hasPrevious, reading); ok {
				proc.CPUPercent = cpu
			}
		}
		if memInfo, err := p.MemoryInfo(); err == nil && memInfo != nil {
			proc.MemoryBytes = memInfo.RSS
		}
		if memPct, err := p.MemoryPercent(); err == nil {
			proc.MemoryPercent = memPct
		}
		if statuses, err := p.Status(); err == nil && len(statuses) > 0 {
			proc.Status = statuses[0]
		}
		if threads, err := p.NumThreads(); err == nil {
			proc.Threads = threads
		}
		if username, err := p.Username(); err == nil {
			proc.Username = username
		}

		serverProcesses = append(serverProcesses, proc)
	}

	// Only this collection's processes are kept: an exited one is let go.
	processCPUReadings = readings

	return serverProcesses
}
