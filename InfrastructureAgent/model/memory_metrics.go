package model

type MemoryMetrics struct {
	Total       uint64  `json:"total"`
	Free        uint64  `json:"free"`
	Used        uint64  `json:"used"`
	PercentUsed float64 `json:"percentUsed"`
	PercentFree float64 `json:"percentFree"`
}
