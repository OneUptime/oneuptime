package model

type HostMetrics struct {
	Platform             string `json:"platform,omitempty"`
	PlatformFamily       string `json:"platformFamily,omitempty"`
	PlatformVersion      string `json:"platformVersion,omitempty"`
	KernelVersion        string `json:"kernelVersion,omitempty"`
	KernelArch           string `json:"kernelArch,omitempty"`
	OS                   string `json:"os,omitempty"`
	UptimeSeconds        uint64 `json:"uptimeSeconds,omitempty"`
	BootTime             uint64 `json:"bootTime,omitempty"`
	HostID               string `json:"hostId,omitempty"`
	VirtualizationSystem string `json:"virtualizationSystem,omitempty"`
	VirtualizationRole   string `json:"virtualizationRole,omitempty"`
	NumProcesses         uint64 `json:"numProcesses,omitempty"`
}
