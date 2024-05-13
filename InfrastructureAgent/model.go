package oneuptime_infrastructure_agent

type MemoryMetrics struct {
	Total       uint64  `json:"total"`
	Free        uint64  `json:"free"`
	Used        uint64  `json:"used"`
	PercentUsed float64 `json:"percentUsed"`
	PercentFree float64 `json:"percentFree"`
}

type CPUMetrics struct {
	PercentUsed float64 `json:"percentUsed"`
}

type BasicDiskMetrics struct {
	Total       uint64  `json:"total"`
	Free        uint64  `json:"free"`
	Used        uint64  `json:"used"`
	DiskPath    string  `json:"diskPath"`
	PercentUsed float64 `json:"percentUsed"`
	PercentFree float64 `json:"percentFree"`
}

type BasicInfrastructureMetrics struct {
	CpuMetrics    *CPUMetrics         `json:"cpuMetrics"`
	MemoryMetrics *MemoryMetrics      `json:"memoryMetrics"`
	DiskMetrics   []*BasicDiskMetrics `json:"diskMetrics"`
}

type ServerProcess struct {
	Pid     int32  `json:"pid"`
	Name    string `json:"name"`
	Command string `json:"command"`
}

type ServerMonitorReport struct {
	SecretKey                  string                      `json:"secretKey"`
	BasicInfrastructureMetrics *BasicInfrastructureMetrics `json:"basicInfrastructureMetrics"`
	RequestReceivedAt          string                      `json:"requestReceivedAt"`
	OnlyCheckRequestReceivedAt bool                        `json:"onlyCheckRequestReceivedAt"`
	Processes                  []*ServerProcess            `json:"processes"`
}
