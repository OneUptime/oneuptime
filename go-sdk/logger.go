package fyipe

import (
	"bytes"
	"encoding/json"
	"io/ioutil"
	"net/http"
	"sync"
)

var currentLogger = NewLogger(nil)

type Logger struct {
	stack *stack
	mu    sync.RWMutex
}
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

type stack []*layer

type layer struct {
	// mu protects concurrent reads and writes to fyipeLogger.
	mu          sync.RWMutex
	fyipeLogger *FyipeLogger
}

// return stored fyipeLogger
func (l *layer) FyipeLogger() *FyipeLogger {
	l.mu.RLock()
	defer l.mu.RUnlock()
	return l.fyipeLogger
}

// set the current fyipeLogger
func (l *layer) SetFyipeLogger(f *FyipeLogger) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.fyipeLogger = f
}

// constructor for default fyipeLogger
func NewLogger(fyipeLogger *FyipeLogger) *Logger {
	logger := Logger{
		stack: &stack{{
			fyipeLogger: fyipeLogger,
		}},
	}
	return &logger
}

// returns an instance of previously initialized Logger.
func CurrentLogger() *Logger {
	return currentLogger
}

// set the current fyipeLogger being used by the user
func (logger *Logger) BindFyipeLogger(fyipeLogger *FyipeLogger) {
	top := logger.stackTop()
	top.SetFyipeLogger(fyipeLogger)
}

// always return the topof the stack which contains one fyipeLogger
func (logger *Logger) stackTop() *layer {
	logger.mu.RLock()
	defer logger.mu.RUnlock()

	stack := logger.stack
	stackLen := len(*stack)
	top := (*stack)[stackLen-1]
	return top
}

// get the current fyipeLogger for usage
func (logger *Logger) FyipeLogger() *FyipeLogger {
	top := logger.stackTop()
	return top.FyipeLogger()
}

func (logger *Logger) MakeApiRequest(content interface{}, tagType string, tags []string) (LoggerResponse, error) {
	currentFyipeLogger := logger.FyipeLogger()

	postBody, _ := json.Marshal(struct {
		Content           interface{} `json:"content"`
		Type              string      `json:"type"`
		ApplicationLogKey string      `json:"applicationLogKey"`
		Tags              []string    `json:"tags"`
	}{
		Content:           content,
		Type:              tagType,
		ApplicationLogKey: currentFyipeLogger.options.ApplicationLogKey,
		Tags:              tags,
	})
	responseBody := bytes.NewBuffer(postBody)

	resp, err := http.Post(currentFyipeLogger.options.ApiUrl, "application/json", responseBody)

	if err != nil {
		// log.Fatalf("An Error Occured %v", err)
		return LoggerResponse{}, err
	}

	body, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		// log.Fatalln(err)
		return LoggerResponse{}, err
	}

	var loggerResponse LoggerResponse
	if err := json.Unmarshal([]byte(body), &loggerResponse); err != nil {
		panic(err)
	}
	return loggerResponse, nil
}
