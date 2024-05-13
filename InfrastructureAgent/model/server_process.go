package oneuptime_infrastructure_agent

type ServerProcess struct {
	Pid     int32  `json:"pid"`
	Name    string `json:"name"`
	Command string `json:"command"`
}
