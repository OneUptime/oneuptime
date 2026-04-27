package utils

import (
	"log/slog"
	"oneuptime-infrastructure-agent/model"

	"github.com/shirou/gopsutil/v3/host"
)

// GetHostMetrics returns OS/platform/kernel/virtualization info plus uptime.
func GetHostMetrics() *model.HostMetrics {
	info, err := host.Info()
	if err != nil {
		slog.Warn("Failed to fetch host info", "error", err)
		return nil
	}

	metrics := &model.HostMetrics{
		Platform:             info.Platform,
		PlatformFamily:       info.PlatformFamily,
		PlatformVersion:      info.PlatformVersion,
		KernelVersion:        info.KernelVersion,
		KernelArch:           info.KernelArch,
		OS:                   info.OS,
		UptimeSeconds:        info.Uptime,
		BootTime:             info.BootTime,
		HostID:               info.HostID,
		VirtualizationSystem: info.VirtualizationSystem,
		VirtualizationRole:   info.VirtualizationRole,
		NumProcesses:         info.Procs,
	}

	return metrics
}
