package oneuptime_infrastructure_agent

type BasicInfrastructureMetrics struct {
	CpuMetrics    *CPUMetrics         `json:"cpuMetrics"`
	MemoryMetrics *MemoryMetrics      `json:"memoryMetrics"`
	DiskMetrics   []*BasicDiskMetrics `json:"diskMetrics"`
}
