package model

type BasicInfrastructureMetrics struct {
	CpuMetrics    *CPUMetrics         `json:"cpuMetrics"`
	MemoryMetrics *MemoryMetrics      `json:"memoryMetrics"`
	DiskMetrics   []*BasicDiskMetrics `json:"diskMetrics"`
}
