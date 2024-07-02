package model

type CPUMetrics struct {
	PercentUsed float64 `json:"percentUsed"`
	Cores       int     `json:"cores"`
}
