package utils

import (
	"log/slog"
	"oneuptime-infrastructure-agent/model"
	"sync"
	"time"

	"github.com/shirou/gopsutil/v4/cpu"
	"github.com/shirou/gopsutil/v4/process"
)

// runningProcess is what the agent reads of a running process. gopsutil's
// *process.Process is one (gopsutilProcess); tests stand in for processes the
// agent cannot read all of, as Windows' protected ones.
type runningProcess interface {
	PID() int32
	Name() (string, error)
	Cmdline() (string, error)
	CreateTime() (int64, error)
	Times() (*cpu.TimesStat, error)
	MemoryInfo() (*process.MemoryInfoStat, error)
	MemoryPercent() (float32, error)
	Status() ([]string, error)
	NumThreads() (int32, error)
	Username() (string, error)
}

// gopsutilProcess is a process as gopsutil reads it.
type gopsutilProcess struct {
	*process.Process
}

func (p gopsutilProcess) PID() int32 {
	return p.Pid
}

// listProcesses lists the processes running now. It is a variable so tests can
// list processes of their own.
var listProcesses = func() ([]runningProcess, error) {
	processes, err := process.Processes()
	if err != nil {
		return nil, err
	}

	listed := make([]runningProcess, 0, len(processes))
	for _, p := range processes {
		listed = append(listed, gopsutilProcess{p})
	}
	return listed, nil
}

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
//
// It returns nil - and the report then has no process list - when no process
// could be read: the processes could not be listed, or none of them named. A
// server always runs some, so an empty list would only say that every process
// had stopped, and every "Is Not Executing" criteria would fire.
func GetServerProcesses() []*model.ServerProcess {
	processList, err := listProcesses()
	if err != nil {
		slog.Error("Failed to fetch process list", "error", err)
		return nil
	}

	processCPUReadingsMu.Lock()
	defer processCPUReadingsMu.Unlock()
	readings := make(map[int32]processCPUReading, len(processList))
	serverProcesses := make([]*model.ServerProcess, 0, len(processList))

	for _, p := range processList {
		name, err := p.Name()
		if err != nil {
			continue
		}
		// The command line of a protected process - lsass.exe, csrss.exe and
		// the like on Windows - cannot be read even by an administrator. The
		// process is reported by its name with no command: leaving it out
		// made it read as not executing.
		cmdline, err := p.Cmdline()
		if err != nil {
			cmdline = ""
		}

		proc := &model.ServerProcess{
			Pid:     p.PID(),
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
			readings[p.PID()] = reading
			previous, hasPrevious := processCPUReadings[p.PID()]
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

	if len(serverProcesses) == 0 {
		slog.Error("No process could be read; the report will have no process list", "processesListed", len(processList))
		return nil
	}

	return serverProcesses
}
