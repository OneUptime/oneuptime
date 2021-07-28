package fyipe

import (
	"sync"
	"time"
)

type Realm struct {
	mu          sync.RWMutex
	timelines   []*Timeline
	fingerprint []string
	tags        map[string]string
}

func NewRealm() *Realm {
	realm := Realm{
		timelines:   make([]*Timeline, 0),
		tags:        make(map[string]string),
		fingerprint: make([]string, 0),
	}

	return &realm
}

// adds new timeline to the current realm
func (realm *Realm) AddToTimeline(timeline *Timeline, limit int) {
	timeline.Timestamp = time.Now()

	realm.mu.Lock()
	defer realm.mu.Unlock()

	timelines := append(realm.timelines, timeline)
	if len(timelines) > limit {
		realm.timelines = timelines[1 : limit+1]
	} else {
		realm.timelines = timelines
	}
}
