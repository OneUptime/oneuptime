package oneuptime

import (
	"errors"
	"reflect"
)

// This is the version of OneUptime Go SDK.
const Version: $TSFixMe = "0.0.1"

const MAX_ITEMS_ALLOWED_IN_STACK: $TSFixMe = 100

type TrackerOption struct {
	MaxTimeline        int
	CaptureCodeSnippet bool
}

type OneUptimeTrackerOption struct {
	ErrorTrackerId  string
	ErrorTrackerKey string
	ApiUrl          string
	Options         TrackerOption
}

type OneUptimeTracker struct {
	options OneUptimeTrackerOption
}

// Generic Error Messages
var (
	ErrErrorTrackerIDMissing  = "Error Tracker ID cant be empty"
	ErrErrorTrackerKeyMissing = "Error Tracker Key cant be empty"
	ErrInvalidTimeline        = "Timeline Value must be between 0 and 100"
)

func NewOneUptimeTracker(options OneUptimeTrackerOption) (*OneUptimeTracker, error) {
	if options.ApiUrl == "" {
		return nil, errors.New(ErrApiURLMissing)
	}
	if options.ErrorTrackerId == "" {
		return nil, errors.New(ErrErrorTrackerIDMissing)
	}
	if options.ErrorTrackerKey == "" {
		return nil, errors.New(ErrErrorTrackerKeyMissing)
	}
	userTimelineVal := options.Options.MaxTimeline
	if userTimelineVal > MAX_ITEMS_ALLOWED_IN_STACK || userTimelineVal < 0 { // if 0 it means user is not recording any timeline activity
		return nil, errors.New(ErrInvalidTimeline)
	}

	// set up API URL
	options.ApiUrl = options.ApiUrl + "/error-tracker/" + options.ErrorTrackerId + "/track"

	oneuptimeTracker := OneUptimeTracker{
		options: options,
	}
	return &oneuptimeTracker, nil
}

// Init initializes the SDK with trackerOptions.
// it returns the error if any of the options are invalid
func InitTracker(options OneUptimeTrackerOption) error {
	currentOneUptimeTracker, err := NewOneUptimeTracker(options)
	if err != nil {
		return err
	}
	// confirm Tracker is ready to be used by binding user's oneuptimeTracker
	tracker := CurrentTracker()
	tracker.BindOneUptimeTracker(currentOneUptimeTracker)

	return nil
}

func AddToTimeline(timeline *Timeline) {

	tracker := CurrentTracker()

	tracker.AddToTimeline(timeline)

}
func GetTimeline() []*Timeline {
	tracker := CurrentTracker()

	return tracker.Realm().timelines
}
func SetTag(key, value string) {
	tracker := CurrentTracker()

	tracker.SetTag(key, value)
}

func SetTags(tags map[string]string) {
	tracker := CurrentTracker()

	tracker.SetTags(tags)
}
func GetTag() []*Tag {
	tracker := CurrentTracker()

	return tracker.Realm().tags
}
func SetFingerprint(fingerprint []string) {
	tracker := CurrentTracker()

	tracker.SetFingerprint(fingerprint)
}

func CaptureMessage(message string) TrackerResponse {
	tracker := CurrentTracker()

	messageObj := &Exception{
		Message: message,
	}

	tracker.SetTag("handled", "true")

	return tracker.PrepareErrorObject("message", messageObj)
}
func GetErrorEvent() *ErrorEvent {
	tracker := CurrentTracker()

	return tracker.Realm().currentErrorEvent
}

func CaptureException(exception error) TrackerResponse {
	tracker := CurrentTracker()

	exceptionObj := &Exception{
		Message:    exception.Error(),
		Type:       reflect.TypeOf(exception).String(),
		Stacktrace: tracker.GetExceptionStackTrace(exception),
	}

	tracker.SetTag("handled", "true")

	return tracker.PrepareErrorObject("exception", exceptionObj)
}
