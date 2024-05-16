package model

type ServerProcess struct {
	Pid     int32  `json:"pid"`
	Name    string `json:"name"`
	Command string `json:"command"`
}
