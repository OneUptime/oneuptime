package model

type BasicDiskMetrics struct {
	Total       uint64  `json:"total"`
	Free        uint64  `json:"free"`
	Used        uint64  `json:"used"`
	DiskPath    string  `json:"diskPath"`
	PercentUsed float64 `json:"percentUsed"`
	PercentFree float64 `json:"percentFree"`
}
