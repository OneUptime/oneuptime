package utils

import (
	"log/slog"
	"oneuptime-infrastructure-agent/model"

	"github.com/shirou/gopsutil/v3/process"
)

// GetServerProcesses retrieves the list of server processes with enriched metrics
// (CPU%, memory, threads, status) where available. Missing enrichment fields fall
// back to zero so the payload stays compatible with older backends.
func GetServerProcesses() []*model.ServerProcess {
	var serverProcesses []*model.ServerProcess

	processList, err := process.Processes()
	if err != nil {
		slog.Error("Failed to fetch process list", err)
		return nil
	}

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
		// CPUPercent uses gopsutil's internal tick cache — first tick may be 0,
		// subsequent ticks are accurate without needing an explicit sleep.
		if cpu, err := p.CPUPercent(); err == nil {
			proc.CPUPercent = cpu
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
		if createdMs, err := p.CreateTime(); err == nil {
			proc.CreateTimeMs = createdMs
		}
		if username, err := p.Username(); err == nil {
			proc.Username = username
		}

		serverProcesses = append(serverProcesses, proc)
	}

	return serverProcesses
}
