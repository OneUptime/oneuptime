package model

type ServerMonitorReport struct {
	SecretKey                  string                      `json:"secretKey"`
	BasicInfrastructureMetrics *BasicInfrastructureMetrics `json:"basicInfrastructureMetrics"`
	RequestReceivedAt          string                      `json:"requestReceivedAt"`
	OnlyCheckRequestReceivedAt bool                        `json:"onlyCheckRequestReceivedAt"`
	Processes                  []*ServerProcess            `json:"processes"`
	Hostname                   string                      `json:"hostname"`
}
