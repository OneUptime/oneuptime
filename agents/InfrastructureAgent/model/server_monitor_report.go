package model

type ServerMonitorReport struct {
	SecretKey                  string                      `json:"secretKey"`
	BasicInfrastructureMetrics *BasicInfrastructureMetrics `json:"basicInfrastructureMetrics"`
	RequestReceivedAt          string                      `json:"requestReceivedAt"`
	OnlyCheckRequestReceivedAt bool                        `json:"onlyCheckRequestReceivedAt"`
	// Left out when the agent could not read the processes, so the report
	// says nothing about them - rather than that none runs.
	Processes []*ServerProcess `json:"processes,omitempty"`
	Hostname  string           `json:"hostname"`
}
