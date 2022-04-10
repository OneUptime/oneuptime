package oneuptime

import (
	"fmt"
	"reflect"
	"testing"
	"time"

	"github.com/go-errors/errors"
)

var errorTracker map[string]interface{}

var customTimeline = &Timeline{
	Category: "testing",
	Data:     "heyy",
	Type:     "info",
}

func init() {
	fmt.Println("setting up, please wait...")
	var sampleUser = GetUser()
	var token, project interface{}

	// Created User
	res, err := MakeTestApiRequest(apiUrl+"/user/signup", sampleUser, "") // pass empty for token here

	if err != nil {
		fmt.Printf("An error Occured %v", err)
	}

	// get token and project
	token = res["tokens"].(map[string]interface{})["jwtAccessToken"]
	project = res["project"]

	// create a component
	var sampleComponent = GetNameComponent()
	createdComponent, err := MakeTestApiRequest(apiUrl+"/component/"+project.(map[string]interface{})["_id"].(string), sampleComponent, token.(string))

	// create an errorTracker and set it as the global error tracker.
	var sampleErrorTracker = GetNameComponent()
	localErrorTracker, err := MakeTestApiRequest(apiUrl+"/error-tracker/"+project.(map[string]interface{})["_id"].(string)+"/"+createdComponent["_id"].(string)+"/create", sampleErrorTracker, token.(string))

	errorTracker = localErrorTracker
	fmt.Println("Test setup done, Error Tracker created, tests will begin...")
}

func TestTakeInCustomTimelineEvent(t *testing.T) {

	expectedResponse := customTimeline.Category
	timelineOpt := TrackerOption{
		MaxTimeline: 10,
	}
	option := OneUptimeTrackerOption{
		ErrorTrackerId:  errorTracker["_id"].(string),
		ErrorTrackerKey: errorTracker["key"].(string),
		ApiUrl:          apiUrl,
		Options:         timelineOpt,
	}

	InitTracker(option)

	AddToTimeline(customTimeline)

	currentTimeline := GetTimeline()

	actualResponse := currentTimeline[0].Category

	AssertEqual(t, "TestTakeInCustomTimelineEvent", fmt.Sprint(actualResponse), expectedResponse)
}

func TestPositiveTimelineIsRequired(t *testing.T) {
	expectedResponse := ErrInvalidTimeline
	timelineOpt := TrackerOption{
		MaxTimeline: -5,
	}
	option := OneUptimeTrackerOption{
		ErrorTrackerId:  errorTracker["_id"].(string),
		ErrorTrackerKey: errorTracker["key"].(string),
		ApiUrl:          apiUrl,
		Options:         timelineOpt,
	}

	setupResponse := InitTracker(option)

	AssertEqual(t, "TestPositiveTimelineIsRequired", fmt.Sprint(setupResponse), expectedResponse)

}
func TestCustomTimelineContainsimeStamp(t *testing.T) {

	expectedResponse := reflect.TypeOf(time.Now()).String()
	timelineOpt := TrackerOption{
		MaxTimeline: 10,
	}
	option := OneUptimeTrackerOption{
		ErrorTrackerId:  errorTracker["_id"].(string),
		ErrorTrackerKey: errorTracker["key"].(string),
		ApiUrl:          apiUrl,
		Options:         timelineOpt,
	}

	InitTracker(option)

	AddToTimeline(customTimeline)

	currentTimeline := GetTimeline()

	actualResponse := reflect.TypeOf(currentTimeline[0].Timestamp).String()

	AssertEqual(t, "TestCustomTimelineContainsimeStamp", fmt.Sprint(actualResponse), expectedResponse)
}
func TestCustomTimelineContainsEventId(t *testing.T) {

	expectedResponse := reflect.TypeOf("hi").String()
	timelineOpt := TrackerOption{
		MaxTimeline: 10,
	}
	option := OneUptimeTrackerOption{
		ErrorTrackerId:  errorTracker["_id"].(string),
		ErrorTrackerKey: errorTracker["key"].(string),
		ApiUrl:          apiUrl,
		Options:         timelineOpt,
	}

	InitTracker(option)

	AddToTimeline(customTimeline)

	currentTimeline := GetTimeline()

	actualResponse := reflect.TypeOf(currentTimeline[0].EventId).String()

	AssertEqual(t, "TestCustomTimelineContainsEventId", fmt.Sprint(actualResponse), expectedResponse)
}

func TestTwoTimelineContainsSameEventId(t *testing.T) {

	timelineOpt := TrackerOption{
		MaxTimeline: 10,
	}
	option := OneUptimeTrackerOption{
		ErrorTrackerId:  errorTracker["_id"].(string),
		ErrorTrackerKey: errorTracker["key"].(string),
		ApiUrl:          apiUrl,
		Options:         timelineOpt,
	}

	InitTracker(option)

	AddToTimeline(customTimeline)

	secondCustomTimeline := customTimeline
	secondCustomTimeline.Category = "Randoms"
	AddToTimeline(secondCustomTimeline)

	currentTimeline := GetTimeline()

	expectedResponse := currentTimeline[0].EventId

	actualResponse := currentTimeline[1].EventId

	AssertEqual(t, "TestTwoTimelineContainsSameEventId", fmt.Sprint(actualResponse), expectedResponse)
}

func TestOlderTimelineAreDiscarded(t *testing.T) {
	timelineOpt := TrackerOption{
		MaxTimeline: 2,
	}
	option := OneUptimeTrackerOption{
		ErrorTrackerId:  errorTracker["_id"].(string),
		ErrorTrackerKey: errorTracker["key"].(string),
		ApiUrl:          apiUrl,
		Options:         timelineOpt,
	}

	InitTracker(option)

	AddToTimeline(customTimeline)

	secondCustomTimeline := customTimeline
	secondCustomTimeline.Category = "Randoms"
	AddToTimeline(secondCustomTimeline)

	thirdCustomTimeline := &Timeline{
		Category: "Common Grounds",
		Type:     "error",
	}
	AddToTimeline(thirdCustomTimeline)

	// the second and third timeline should remain
	expectedFirstTimelineResponse := secondCustomTimeline.Category // this should be the first time in the timeline stored
	expectedSecondTimelineResponse := thirdCustomTimeline.Type     // this should be the second time in the timeline stored

	currentTimeline := GetTimeline()

	actualFirstTimelineResponse := currentTimeline[0].Category
	actualSecondTimelineResponse := currentTimeline[1].Type

	AssertEqual(t, "TestTwoTimelineContainsSameEventId", fmt.Sprint(actualFirstTimelineResponse), expectedFirstTimelineResponse)

	AssertEqual(t, "TestTwoTimelineContainsSameEventId", fmt.Sprint(actualSecondTimelineResponse), expectedSecondTimelineResponse)

}
func TestTagIsAdded(t *testing.T) {
	timelineOpt := TrackerOption{
		MaxTimeline: 2,
	}
	option := OneUptimeTrackerOption{
		ErrorTrackerId:  errorTracker["_id"].(string),
		ErrorTrackerKey: errorTracker["key"].(string),
		ApiUrl:          apiUrl,
		Options:         timelineOpt,
	}

	InitTracker(option)

	tagKey := "location"
	tagValue := "Warsaw"

	expectedResponse := tagKey

	SetTag(tagKey, tagValue)

	tags := GetTag()

	actualResponse := tags[0].Key

	AssertEqual(t, "TestTagIsAdded", fmt.Sprint(actualResponse), expectedResponse)

}

func TestTagsAreAdded(t *testing.T) {
	timelineOpt := TrackerOption{
		MaxTimeline: 2,
	}
	option := OneUptimeTrackerOption{
		ErrorTrackerId:  errorTracker["_id"].(string),
		ErrorTrackerKey: errorTracker["key"].(string),
		ApiUrl:          apiUrl,
		Options:         timelineOpt,
	}

	InitTracker(option)

	tags := map[string]string{
		"location": "Warsaw",
		"agent":    "Safari",
		"actor":    "Tom Cruise",
	}

	expectedResponse := len(tags)

	SetTags(tags)

	availableTags := GetTag()

	actualResponse := len(availableTags)
	if actualResponse != expectedResponse {
		t.Errorf("TestTagsAreAdded failed expected %v, got %v", expectedResponse, actualResponse)
	} else {
		t.Logf("TestTagsAreAdded success expected %v, got %v", expectedResponse, actualResponse)
	}
	AssertEqual(t, "TestTagIsAdded", fmt.Sprint(actualResponse), fmt.Sprint(expectedResponse))

}
func TestOverwriteTagsWithSameKeyWhenAdded(t *testing.T) {
	timelineOpt := TrackerOption{
		MaxTimeline: 2,
	}
	option := OneUptimeTrackerOption{
		ErrorTrackerId:  errorTracker["_id"].(string),
		ErrorTrackerKey: errorTracker["key"].(string),
		ApiUrl:          apiUrl,
		Options:         timelineOpt,
	}

	InitTracker(option)

	tags := map[string]string{
		"location": "Warsaw",
		"agent":    "Safari",
		"actor":    "Tom Cruise",
	}

	expectedResponse := "Kent"

	SetTags(tags)
	SetTag("location", "Brussels")
	SetTag("location", expectedResponse)

	availableTags := GetTag()

	actualResponse := availableTags[0].Value // latest value for that tag location

	AssertEqual(t, "TestOverwriteTagsWithSameKeyWhenAdded", fmt.Sprint(len(tags)), fmt.Sprint(len(availableTags))) // only 3 unique tags

	AssertEqual(t, "TestOverwriteTagsWithSameKeyWhenAdded", actualResponse, expectedResponse)
}

func TestFingerprintShouldBeCaptureMessage(t *testing.T) {
	timelineOpt := TrackerOption{
		MaxTimeline: 2,
	}
	option := OneUptimeTrackerOption{
		ErrorTrackerId:  errorTracker["_id"].(string),
		ErrorTrackerKey: errorTracker["key"].(string),
		ApiUrl:          apiUrl,
		Options:         timelineOpt,
	}

	InitTracker(option)

	errorMessage := "Uncaught Exception"

	expectedResponse := errorMessage

	CaptureMessage(errorMessage)

	errorEvent := GetErrorEvent()

	actualResponse := errorEvent.Fingerprint[0]

	AssertEqual(t, "TestFingerprintShouldBeCaptureMessage", actualResponse, expectedResponse)
}

func TestFingerprintShouldBeCustomValuesSetAheadCaptureMessage(t *testing.T) {
	timelineOpt := TrackerOption{
		MaxTimeline: 2,
	}
	option := OneUptimeTrackerOption{
		ErrorTrackerId:  errorTracker["_id"].(string),
		ErrorTrackerKey: errorTracker["key"].(string),
		ApiUrl:          apiUrl,
		Options:         timelineOpt,
	}

	InitTracker(option)

	errorMessage := "Uncaught Exception"

	fingerprints := []string{"custom", "errors", "plankton", "ruby", "golang"}
	SetFingerprint(fingerprints)

	CaptureMessage(errorMessage)

	errorEvent := GetErrorEvent()

	for i := range errorEvent.Fingerprint {
		expectedResponse := fingerprints[i]
		actualResponse := errorEvent.Fingerprint[i]
		AssertEqual(t, "TestFingerprintShouldBeCustomValuesSetAheadCaptureMessage", actualResponse, expectedResponse)
	}
}
func TestCreateEventReadyForServerUsingCaptureMessage(t *testing.T) {
	timelineOpt := TrackerOption{
		MaxTimeline: 2,
	}
	option := OneUptimeTrackerOption{
		ErrorTrackerId:  errorTracker["_id"].(string),
		ErrorTrackerKey: errorTracker["key"].(string),
		ApiUrl:          apiUrl,
		Options:         timelineOpt,
	}

	InitTracker(option)

	errorMessage := "Uncaught Exception"

	CaptureMessage(errorMessage)

	errorEvent := GetErrorEvent()

	expectedType := "message"
	actualType := errorEvent.Type

	AssertEqual(t, "TestFingerprintShouldBeCustomValuesSetAheadCaptureMessage", actualType, expectedType)

	expectedMsg := errorMessage
	actualMsg := errorEvent.Exception.Message

	AssertEqual(t, "TestFingerprintShouldBeCustomValuesSetAheadCaptureMessage", actualMsg, expectedMsg)
}
func TestCaptureMessageTimelineAndEventWithSameID(t *testing.T) {
	timelineOpt := TrackerOption{
		MaxTimeline: 2,
	}
	option := OneUptimeTrackerOption{
		ErrorTrackerId:  errorTracker["_id"].(string),
		ErrorTrackerKey: errorTracker["key"].(string),
		ApiUrl:          apiUrl,
		Options:         timelineOpt,
	}

	InitTracker(option)

	AddToTimeline(customTimeline)

	errorMessage := "Uncaught Exception"

	CaptureMessage(errorMessage)

	errorEvent := GetErrorEvent()

	expectedTimelineCount := 2
	actualTimelineCount := len(errorEvent.Timeline)

	AssertEqual(t, "TestCaptureMessageTimelineAndEventWithSameID", fmt.Sprint(actualTimelineCount), fmt.Sprint(expectedTimelineCount))

	expectedEventId := errorEvent.EventId
	actualEventId := errorEvent.Timeline[0].EventId

	AssertEqual(t, "TestCaptureMessageTimelineAndEventWithSameID", actualEventId, expectedEventId)

	expectedMsg := errorMessage
	actualMsg := errorEvent.Exception.Message

	AssertEqual(t, "TestCaptureMessageTimelineAndEventWithSameID", actualMsg, expectedMsg)

}
func TestCaptureExceptionReadyForServer(t *testing.T) {
	timelineOpt := TrackerOption{
		MaxTimeline: 2,
	}
	option := OneUptimeTrackerOption{
		ErrorTrackerId:  errorTracker["_id"].(string),
		ErrorTrackerKey: errorTracker["key"].(string),
		ApiUrl:          apiUrl,
		Options:         timelineOpt,
	}

	InitTracker(option)

	errorMessage := "this function is supposed to crash"
	err := errors.Errorf(errorMessage)

	CaptureException(err)

	errorEvent := GetErrorEvent()

	expectedMsg := errorMessage
	actualMsg := errorEvent.Exception.Message
	AssertEqual(t, "TestCaptureExceptionReadyForServer", actualMsg, expectedMsg)

	expectedType := "exception"
	actualType := errorEvent.Type

	AssertEqual(t, "TestCaptureExceptionReadyForServer", actualType, expectedType)

}
func TestCaptureExceptionAndCaptureMessageWithDifferentID(t *testing.T) {
	timelineOpt := TrackerOption{
		MaxTimeline: 2,
	}
	option := OneUptimeTrackerOption{
		ErrorTrackerId:  errorTracker["_id"].(string),
		ErrorTrackerKey: errorTracker["key"].(string),
		ApiUrl:          apiUrl,
		Options:         timelineOpt,
	}

	InitTracker(option)

	AddToTimeline(customTimeline)

	errorMessage := "this function is supposed to crash"

	event := CaptureMessage(errorMessage)

	AddToTimeline(customTimeline)

	err := errors.Errorf(errorMessage)

	newEvent := CaptureException(err)

	// ensure that the first event have a type message, same error message
	expectedType := "message"
	actualType := event.Type

	AssertEqual(t, "TestCaptureExceptionAndCaptureMessageWithDifferentID", actualType, expectedType)

	actualMessage := event.Content.(map[string]interface{})["message"].(string)

	AssertEqual(t, "TestCaptureExceptionAndCaptureMessageWithDifferentID", actualMessage, errorMessage)

	// ensure that the second event have a type exception, same error message
	expectedType = "exception"
	actualType = newEvent.Type

	AssertEqual(t, "TestCaptureExceptionAndCaptureMessageWithDifferentID", actualType, expectedType)

	actualMessage = newEvent.Content.(map[string]interface{})["message"].(string)
	AssertEqual(t, "TestCaptureExceptionAndCaptureMessageWithDifferentID", actualMessage, errorMessage)

	// confim their eventId is different

	AssertNotEqual(t, "TestCaptureExceptionAndCaptureMessageWithDifferentID", event.ID, newEvent.ID)
}

func TestCapturedErrorWithDifferentProperties(t *testing.T) {
	timelineOpt := TrackerOption{
		MaxTimeline:        2,
		CaptureCodeSnippet: true,
	}
	option := OneUptimeTrackerOption{
		ErrorTrackerId:  errorTracker["_id"].(string),
		ErrorTrackerKey: errorTracker["key"].(string),
		ApiUrl:          apiUrl,
		Options:         timelineOpt,
	}

	InitTracker(option)

	// add timeline to first tracker
	AddToTimeline(customTimeline)

	errorMessage := "this function is supposed to crash"

	event := CaptureMessage(errorMessage)

	// add timeline and tag to second tracker
	AddToTimeline(customTimeline)

	tagKey := "Location"
	tagValue := "Warsaw"

	SetTag(tagKey, tagValue)

	err := errors.Errorf(errorMessage)

	newEvent := CaptureException(err)

	// ensure that the first event have a type message, same error message and two timeline (one custom, one generic)
	expectedType := "message"
	actualType := event.Type

	AssertEqual(t, "TestCapturedErrorWithDifferentProperties", actualType, expectedType)

	actualMessage := event.Content.(map[string]interface{})["message"].(string)
	AssertEqual(t, "TestCapturedErrorWithDifferentProperties", actualMessage, errorMessage)

	AssertEqual(t, "TestCapturedErrorWithDifferentProperties", fmt.Sprint(len(event.Timeline)), "2")

	// ensure that the second event have a type exception, same error message and 2 tags
	expectedType = "exception"
	actualType = newEvent.Type
	AssertEqual(t, "TestCapturedErrorWithDifferentProperties", actualType, expectedType)

	actualMessage = newEvent.Content.(map[string]interface{})["message"].(string)
	AssertEqual(t, "TestCapturedErrorWithDifferentProperties", actualMessage, errorMessage)

	AssertEqual(t, "TestCapturedErrorWithDifferentProperties", fmt.Sprint(len(newEvent.Timeline)), "2")

	AssertEqual(t, "TestCapturedErrorWithDifferentProperties", fmt.Sprint(len(newEvent.Tags)), "2") // the default and custom tag

}
