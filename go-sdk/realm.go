package fyipe

import (
	"sync"
	"time"

	"github.com/google/uuid"
)

type Realm struct {
	mu                sync.RWMutex
	timelines         []*Timeline
	fingerprint       []string
	tags              []*Tag
	eventId           string
	currentErrorEvent *ErrorEvent
}

func NewRealm() *Realm {
	realm := Realm{
		timelines:   make([]*Timeline, 0),
		tags:        make([]*Tag, 0),
		fingerprint: make([]string, 0),
		eventId:     uuid.New().String(),
	}

	return &realm
}

// adds new timeline to the current realm
func (realm *Realm) AddToTimeline(timeline *Timeline, limit int) {
	timeline.Timestamp = time.Now()
	timeline.EventId = realm.eventId

	realm.mu.Lock()
	defer realm.mu.Unlock()

	timelines := append(realm.timelines, timeline)
	if len(timelines) > limit {
		realm.timelines = timelines[1 : limit+1]
	} else {
		realm.timelines = timelines
	}
}

func (realm *Realm) SetTag(key, value string) {
	realm.mu.Lock()
	defer realm.mu.Unlock()

	availableTags := realm.tags
	isFound := false
	for i := range availableTags {
		if availableTags[i].Key == key {
			isFound = true
			availableTags[i].Value = value
		}
	}

	if !isFound {
		availableTags = append(availableTags, &Tag{Key: key, Value: value})
	}
	realm.tags = availableTags
}

func (realm *Realm) SetTags(tags map[string]string) {

	for key, value := range tags {
		SetTag(key, value)
	}
}

func (realm *Realm) SetFingerprint(fingerprint []string) {

	realm.fingerprint = fingerprint
}

func (realm *Realm) PrepareErrorObject(errorType string, errorObj *Exception, errorTrackerKey string) {
	realm.mu.Lock()
	defer realm.mu.Unlock()

	if len(realm.fingerprint) < 1 { // default fingerprint will be the message from the error stacktrace
		fingerprint := []string{errorObj.Message}
		SetFingerprint(fingerprint)
	}

	errorEvent := &ErrorEvent{
		Type:            errorType,
		Timeline:        realm.timelines,
		EventId:         realm.eventId,
		Tags:            realm.tags,
		Fingerprint:     realm.fingerprint,
		Exception:       errorObj,
		ErrorTrackerKey: errorTrackerKey,
	}

	realm.currentErrorEvent = errorEvent

}
