package fyipe

import "time"

type ApplicationLog struct {
	ID   string `json:"_id"`
	Name string
}
type LoggerResponse struct {
	ID                 string `json:"_id"`
	Deleted            bool
	CreatedAt          string
	Content            interface{}
	StringifiedContent string
	Type               string
	CreatedBy          string
	AppLog             ApplicationLog `json:"applicationLogId"`
	Tags               []string
	Message            string
}

type Timeline struct {
	Category  string
	Data      interface{}
	Type      string
	Timestamp time.Time
	EventId   string
}

type Exception struct {
	Message string
}

type Tag struct {
	Key   string
	Value string
}
type ErrorEvent struct {
	Type            string
	Timeline        []*Timeline
	Exception       interface{}
	EventId         string
	Tags            []*Tag
	Fingerprint     []string
	ErrorTrackerKey string
}

// const (
// 	LevelInfo    Level = "info"
// 	LevelWarning Level = "warning"
// 	LevelError   Level = "error"
// )
