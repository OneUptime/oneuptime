package fyipe

import (
	"bytes"
	"encoding/json"
	"io/ioutil"
	"net/http"
	"sync"
)

type Tracker struct {
	stack *stack
	mu    sync.RWMutex
}

var currentTracker = NewTracker(nil, NewRealm())

// constructor for default fyipeTracker
func NewTracker(fyipeTracker *FyipeTracker, realm *Realm) *Tracker {
	tracker := Tracker{
		stack: &stack{{
			fyipeTracker: fyipeTracker,
			realm:        realm,
		}},
	}
	return &tracker
}

// return stored fyipeTracker
func (l *layer) FyipeTracker() *FyipeTracker {
	l.mu.RLock()
	defer l.mu.RUnlock()
	return l.fyipeTracker
}

// set the current fyipeTracker
func (l *layer) SetFyipeTracker(f *FyipeTracker) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.fyipeTracker = f
}

// returns an instance of previously initialized Tracker.
func CurrentTracker() *Tracker {
	return currentTracker
}

// set the current fyipeTracker being used by the user
func (tracker *Tracker) BindFyipeTracker(fyipeTracker *FyipeTracker) {
	top := tracker.stackTop()
	top.SetFyipeTracker(fyipeTracker)
}

// always return the topof the stack which contains one fyipeTracker
func (tracker *Tracker) stackTop() *layer {
	tracker.mu.RLock()
	defer tracker.mu.RUnlock()

	stack := tracker.stack
	stackLen := len(*stack)
	top := (*stack)[stackLen-1]
	return top
}

// get the current fyipeTracker for usage
func (tracker *Tracker) FyipeTracker() *FyipeTracker {
	top := tracker.stackTop()
	return top.FyipeTracker()
}

func (tracker *Tracker) Realm() *Realm {
	top := tracker.stackTop()
	return top.realm
}
func (tracker *Tracker) AddToTimeline(timeline *Timeline) {
	currentFyipeTracker := tracker.FyipeTracker()

	options := currentFyipeTracker.options.Options

	userTimeline := options.MaxTimeline

	if userTimeline < 1 {
		return
	}

	tracker.Realm().AddToTimeline(timeline, userTimeline)
}

func (tracker *Tracker) SetTag(key, value string) {
	tracker.Realm().SetTag(key, value)
}

func (tracker *Tracker) SetTags(tags map[string]string) {
	tracker.Realm().SetTags(tags)
}

func (tracker *Tracker) SetFingerprint(fingerprint []string) {
	tracker.Realm().SetFingerprint(fingerprint)
}

func (tracker *Tracker) PrepareErrorObject(category string, errorObj *Exception) TrackerResponse {
	currentFyipeTracker := tracker.FyipeTracker()

	AddToTimeline(&Timeline{
		Category: category,
		Data:     errorObj.Message,
		Type:     "error",
	})

	tracker.Realm().PrepareErrorObject(category, errorObj, currentFyipeTracker.options.ErrorTrackerKey)

	trackerResponse, err := tracker.sendErrorToServer()

	if err != nil {
		// something went wrong, server down, etc
	}

	return trackerResponse
}

func (tracker *Tracker) sendErrorToServer() (TrackerResponse, error) {
	currentFyipeTracker := tracker.FyipeTracker()
	currentErrorEvent := tracker.Realm().currentErrorEvent

	postBody, _ := json.Marshal(currentErrorEvent)
	responseBody := bytes.NewBuffer(postBody)

	resp, err := http.Post(currentFyipeTracker.options.ApiUrl, "application/json", responseBody)

	if err != nil {
		// log.Fatalf("An Error Occured %v", err)
		return TrackerResponse{}, err
	}

	body, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		// log.Fatalln(err)
		return TrackerResponse{}, err
	}

	var trackerResponse TrackerResponse
	if err := json.Unmarshal([]byte(body), &trackerResponse); err != nil {
		panic(err)
	}
	return trackerResponse, nil
}
