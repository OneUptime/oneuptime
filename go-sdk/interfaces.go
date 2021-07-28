package fyipe

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
	Category string
	Data     interface{}
	Type     string
}
