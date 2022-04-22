package oneuptime

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

// constructor for default oneuptimeTracker
func NewTracker(oneuptimeTracker *OneUptimeTracker, realm *Realm) *Tracker {
	tracker := Tracker{
		stack: &stack{{
			oneuptimeTracker: oneuptimeTracker,
			realm:        realm,
		}},
	}
	return &tracker
}

// return stored oneuptimeTracker
func (l *layer) OneUptimeTracker() *OneUptimeTracker {
	l.mu.RLock()
	defer l.mu.RUnlock()
	return l.oneuptimeTracker
}

// set the current oneuptimeTracker
func (l *layer) SetOneUptimeTracker(f *OneUptimeTracker) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.oneuptimeTracker = f
}

// returns an instance of previously initialized Tracker.
func CurrentTracker() *Tracker {
	return currentTracker
}

// set the current oneuptimeTracker being used by the user
func (tracker *Tracker) BindOneUptimeTracker(oneuptimeTracker *OneUptimeTracker) {
	top := tracker.stackTop()
	top.SetOneUptimeTracker(oneuptimeTracker)
}

// always return the topof the stack which contains one oneuptimeTracker
func (tracker *Tracker) stackTop() *layer {
	tracker.mu.RLock()
	defer tracker.mu.RUnlock()

	stack := tracker.stack
	stackLen := len(*stack)
	top := (*stack)[stackLen-1]
	return top
}

// get the current oneuptimeTracker for usage
func (tracker *Tracker) OneUptimeTracker() *OneUptimeTracker {
	top := tracker.stackTop()
	return top.OneUptimeTracker()
}

func (tracker *Tracker) Realm() *Realm {
	top := tracker.stackTop()
	return top.realm
}
func (tracker *Tracker) AddToTimeline(timeline *Timeline) {
	currentOneUptimeTracker := tracker.OneUptimeTracker()

	options := currentOneUptimeTracker.options.Options

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

func (tracker *Tracker) GetExceptionStackTrace(exception error) *Stacktrace {
	currentOneUptimeTracker := tracker.OneUptimeTracker()

	options := currentOneUptimeTracker.options.Options
	return GetExceptionStackTrace(exception, options)
}

func (tracker *Tracker) PrepareErrorObject(category string, errorObj *Exception) TrackerResponse {
	currentOneUptimeTracker := tracker.OneUptimeTracker()

	AddToTimeline(&Timeline{
		Category: category,
		Data:     errorObj.Message,
		Type:     "error",
	})

	tracker.Realm().PrepareErrorObject(category, errorObj, currentOneUptimeTracker.options.ErrorTrackerKey)

	trackerResponse, err := tracker.sendErrorToServer()

	if err != nil {
		// something went wrong, server down, etc
	}
	// clear the Realm after a successful call to the server
	tracker.Realm().clearRealm()

	return trackerResponse
}

func (tracker *Tracker) sendErrorToServer() (TrackerResponse, error) {
	currentOneUptimeTracker := tracker.OneUptimeTracker()
	currentErrorEvent := tracker.Realm().currentErrorEvent

	postBody, _ := json.Marshal(currentErrorEvent)
	responseBody := bytes.NewBuffer(postBody)

	resp, err := http.Post(currentOneUptimeTracker.options.ApiUrl, "application/json", responseBody)

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
