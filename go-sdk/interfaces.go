package oneuptime

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

type TrackerResponse struct {
	ID              string `json:"_id"`
	Deleted         bool
	CreatedAt       string
	Content         interface{}
	ErrorTrackerId  string
	Fingerprint     []string
	FingerprintHash string
	CreatedBy       string
	Tags            []Tag
	Timeline        []Timeline
	Type            string
	SDK             SDK
}

type Timeline struct {
	Category  string      `json:"category"`
	Data      interface{} `json:"data"`
	Type      string      `json:"type"`
	Timestamp time.Time   `json:"timestamp"`
	EventId   string      `json:"eventId"`
}

type Exception struct {
	Message    string      `json:"message"`
	Stacktrace *Stacktrace `json:"stacktrace"`
	Type       string      `json:"type"`
	LineNumber string      `json:"lineNumber"`
}

type Tag struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}
type ErrorEvent struct {
	Type            string      `json:"type"`
	Timeline        []*Timeline `json:"timeline"`
	Exception       *Exception  `json:"exception"`
	EventId         string      `json:"eventId"`
	Tags            []*Tag      `json:"tags"`
	Fingerprint     []string    `json:"fingerprint"`
	ErrorTrackerKey string      `json:"errorTrackerKey"`
	SDK             *SDK        `json:"sdk"`
}

// const (
// 	LevelInfo    Level = "info"
// 	LevelWarning Level = "warning"
// 	LevelError   Level = "error"
// )

type Stacktrace struct {
	Frames []Frame `json:"frames"`
}
type Frame struct {
	MethodName       string   `json:"methodName"`
	FileName         string   `json:"fileName"`
	LineNumber       string   `json:"lineNumber"`
	LinesBeforeError []string `json:"lineBeforeError"`
	LinesAfterError  []string `json:"lineAfterError"`
	ErrorLine        string   `json:"errorLine"`
}
type SDK struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}
