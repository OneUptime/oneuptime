package fyipe

import "errors"

const MAX_ITEMS_ALLOWED_IN_STACK = 100

type TrackerOption struct {
	MaxTimeline int
}

type FyipeTrackerOption struct {
	ErrorTrackerId  string
	ErrorTrackerKey string
	ApiUrl          string
	Options         TrackerOption
}

type FyipeTracker struct {
	options FyipeTrackerOption
}

// Generic Error Messages
var (
	ErrErrorTrackerIDMissing  = "Application Log ID cant be empty"
	ErrErrorTrackerKeyMissing = "Application Log Key cant be empty"
	ErrInvalidTimeline        = "Timeline Value must be between 1 and 100"
)

func NewFyipeTracker(options FyipeTrackerOption) (*FyipeTracker, error) {
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
	if userTimelineVal > MAX_ITEMS_ALLOWED_IN_STACK || userTimelineVal < 1 {
		return nil, errors.New(ErrInvalidTimeline)
	}

	// set up API URL
	options.ApiUrl = options.ApiUrl + "/error-tracker/" + options.ErrorTrackerId + "/track"

	fyipeTracker := FyipeTracker{
		options: options,
	}
	return &fyipeTracker, nil
}

// Init initializes the SDK with trackerOptions.
// it returns the error if any of the options are invalid
func InitTracker(options FyipeTrackerOption) error {
	currentFyipeTracker, err := NewFyipeTracker(options)
	if err != nil {
		return err
	}
	// confirm Tracker is ready to be used by binding user's fyipeTracker
	tracker := CurrentTracker()
	tracker.BindFyipeTracker(currentFyipeTracker)

	return nil
}

func addToTimeline(timelineObj Timeline) {

	// TODO log data

}
