package oneuptime

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

type stack []*layer

type layer struct {
	// mu protects concurrent reads and writes to these objects.
	mu           sync.RWMutex
	oneuptimeLogger  *OneUptimeLogger
	oneuptimeTracker *OneUptimeTracker
	realm        *Realm
}

// return stored oneuptimeLogger
func (l *layer) OneUptimeLogger() *OneUptimeLogger {
	l.mu.RLock()
	defer l.mu.RUnlock()
	return l.oneuptimeLogger
}

// set the current oneuptimeLogger
func (l *layer) SetOneUptimeLogger(f *OneUptimeLogger) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.oneuptimeLogger = f
}

// constructor for default oneuptimeLogger
func NewLogger(oneuptimeLogger *OneUptimeLogger) *Logger {
	logger := Logger{
		stack: &stack{{
			oneuptimeLogger: oneuptimeLogger,
		}},
	}
	return &logger
}

// returns an instance of previously initialized Logger.
func CurrentLogger() *Logger {
	return currentLogger
}

// set the current oneuptimeLogger being used by the user
func (logger *Logger) BindOneUptimeLogger(oneuptimeLogger *OneUptimeLogger) {
	top := logger.stackTop()
	top.SetOneUptimeLogger(oneuptimeLogger)
}

// always return the topof the stack which contains one oneuptimeLogger
func (logger *Logger) stackTop() *layer {
	logger.mu.RLock()
	defer logger.mu.RUnlock()

	stack := logger.stack
	stackLen := len(*stack)
	top := (*stack)[stackLen-1]
	return top
}

// get the current oneuptimeLogger for usage
func (logger *Logger) OneUptimeLogger() *OneUptimeLogger {
	top := logger.stackTop()
	return top.OneUptimeLogger()
}

func (logger *Logger) MakeApiRequest(content interface{}, tagType string, tags []string) (LoggerResponse, error) {
	currentOneUptimeLogger := logger.OneUptimeLogger()

	postBody, _ := json.Marshal(struct {
		Content           interface{} `json:"content"`
		Type              string      `json:"type"`
		ApplicationLogKey string      `json:"applicationLogKey"`
		Tags              []string    `json:"tags"`
	}{
		Content:           content,
		Type:              tagType,
		ApplicationLogKey: currentOneUptimeLogger.options.ApplicationLogKey,
		Tags:              tags,
	})
	responseBody := bytes.NewBuffer(postBody)

	resp, err := http.Post(currentOneUptimeLogger.options.ApiUrl, "application/json", responseBody)

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
