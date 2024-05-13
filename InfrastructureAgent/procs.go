package oneuptime_InfrastructureAgent_go

import (
	"github.com/gookit/slog"
	"github.com/shirou/gopsutil/v3/process"
)

// getServerProcesses retrieves the list of server processes
func getServerProcesses() []*ServerProcess {
	var serverProcesses []*ServerProcess

	// Fetch all processes
	processList, err := process.Processes()
	if err != nil {
		slog.Error("Failed to fetch process list", err)
		return nil
	}

	// Iterate over all processes and collect details
	for _, p := range processList {
		name, err := p.Name()
		if err != nil {
			continue // skip processes where details cannot be retrieved
		}
		cmdline, err := p.Cmdline()
		if err != nil {
			continue
		}

		serverProcesses = append(serverProcesses, &ServerProcess{
			Pid:     p.Pid,
			Name:    name,
			Command: cmdline,
		})
	}

	return serverProcesses
}
