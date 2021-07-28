package fyipe

import "sync"

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
