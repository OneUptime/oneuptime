package model

type ServerProcess struct {
	Pid     int32  `json:"pid"`
	Name    string `json:"name"`
	Command string `json:"command"`

	CPUPercent    float64 `json:"cpuPercent,omitempty"`
	MemoryBytes   uint64  `json:"memoryBytes,omitempty"`
	MemoryPercent float32 `json:"memoryPercent,omitempty"`
	Status        string  `json:"status,omitempty"`
	Threads       int32   `json:"threads,omitempty"`
	CreateTimeMs  int64   `json:"createTimeMs,omitempty"`
	Username      string  `json:"username,omitempty"`
}
