package model

type BasicInfrastructureMetrics struct {
	CpuMetrics    *CPUMetrics         `json:"cpuMetrics"`
	MemoryMetrics *MemoryMetrics      `json:"memoryMetrics"`
	DiskMetrics   []*BasicDiskMetrics `json:"diskMetrics"`

	NetworkMetrics *NetworkMetrics `json:"networkMetrics,omitempty"`
	LoadMetrics    *LoadMetrics    `json:"loadMetrics,omitempty"`
	HostMetrics    *HostMetrics    `json:"hostMetrics,omitempty"`
}
