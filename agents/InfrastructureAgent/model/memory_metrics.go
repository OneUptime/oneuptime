package model

type MemoryMetrics struct {
	Total       uint64  `json:"total"`
	Free        uint64  `json:"free"`
	Used        uint64  `json:"used"`
	PercentUsed float64 `json:"percentUsed"`
	PercentFree float64 `json:"percentFree"`

	Available uint64 `json:"available,omitempty"`
	Buffers   uint64 `json:"buffers,omitempty"`
	Cached    uint64 `json:"cached,omitempty"`

	SwapTotal       uint64  `json:"swapTotal,omitempty"`
	SwapUsed        uint64  `json:"swapUsed,omitempty"`
	SwapFree        uint64  `json:"swapFree,omitempty"`
	SwapPercentUsed float64 `json:"swapPercentUsed,omitempty"`
}
