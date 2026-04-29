package model

type CPUMetrics struct {
	PercentUsed float64 `json:"percentUsed"`
	Cores       int     `json:"cores"`

	PerCorePercent     []float64 `json:"perCorePercent,omitempty"`
	TimeUserPercent    float64   `json:"timeUserPercent,omitempty"`
	TimeSystemPercent  float64   `json:"timeSystemPercent,omitempty"`
	TimeIdlePercent    float64   `json:"timeIdlePercent,omitempty"`
	TimeIoWaitPercent  float64   `json:"timeIoWaitPercent,omitempty"`
	TimeStealPercent   float64   `json:"timeStealPercent,omitempty"`
	TimeNicePercent    float64   `json:"timeNicePercent,omitempty"`
	TimeIrqPercent     float64   `json:"timeIrqPercent,omitempty"`
	TimeSoftIrqPercent float64   `json:"timeSoftIrqPercent,omitempty"`
}
