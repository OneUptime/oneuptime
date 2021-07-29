package fyipe

import (
	"sync"
	"time"

	"github.com/google/uuid"
)

type Realm struct {
	mu          sync.RWMutex
	timelines   []*Timeline
	fingerprint []string
	tags        map[string]string
	eventId     string
}

func NewRealm() *Realm {
	realm := Realm{
		timelines:   make([]*Timeline, 0),
		tags:        make(map[string]string),
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
