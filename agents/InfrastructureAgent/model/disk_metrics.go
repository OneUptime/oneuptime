package model

type BasicDiskMetrics struct {
	Total       uint64  `json:"total"`
	Free        uint64  `json:"free"`
	Used        uint64  `json:"used"`
	DiskPath    string  `json:"diskPath"`
	PercentUsed float64 `json:"percentUsed"`
	PercentFree float64 `json:"percentFree"`

	Device     string `json:"device,omitempty"`
	Fstype     string `json:"fstype,omitempty"`
	ReadBytes  uint64 `json:"readBytes,omitempty"`
	WriteBytes uint64 `json:"writeBytes,omitempty"`
	ReadCount  uint64 `json:"readCount,omitempty"`
	WriteCount uint64 `json:"writeCount,omitempty"`
	IoTimeMs   uint64 `json:"ioTimeMs,omitempty"`
}
