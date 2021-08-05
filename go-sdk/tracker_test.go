package fyipe

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
	option := FyipeTrackerOption{
		ErrorTrackerId:  errorTracker["_id"].(string),
		ErrorTrackerKey: errorTracker["key"].(string),
		ApiUrl:          apiUrl,
		Options:         timelineOpt,
	}

	InitTracker(option)

	AddToTimeline(customTimeline)

	currentTimeline := GetTimeline()

	actualResponse := currentTimeline[0].Category

	if fmt.Sprint(actualResponse) != expectedResponse {
		t.Errorf("TestTakeInCustomTimelineEvent failed expected %v, got %v", expectedResponse, actualResponse)
	} else {
		t.Logf("TestTakeInCustomTimelineEvent success expected %v, got %v", expectedResponse, actualResponse)
	}
}

func TestPositiveTimelineIsRequired(t *testing.T) {
	expectedResponse := ErrInvalidTimeline
	timelineOpt := TrackerOption{
		MaxTimeline: -5,
	}
	option := FyipeTrackerOption{
		ErrorTrackerId:  errorTracker["_id"].(string),
		ErrorTrackerKey: errorTracker["key"].(string),
		ApiUrl:          apiUrl,
		Options:         timelineOpt,
	}

	setupResponse := InitTracker(option)

	if fmt.Sprint(setupResponse) != expectedResponse {
		t.Errorf("TestPositiveTimelineIsRequired failed expected %v, got %v", expectedResponse, setupResponse)
	} else {
		t.Logf("TestPositiveTimelineIsRequired success expected %v, got %v", expectedResponse, setupResponse)
	}
}
func TestCustomTimelineContainsimeStamp(t *testing.T) {

	expectedResponse := reflect.TypeOf(time.Now()).String()
	timelineOpt := TrackerOption{
		MaxTimeline: 10,
	}
	option := FyipeTrackerOption{
		ErrorTrackerId:  errorTracker["_id"].(string),
		ErrorTrackerKey: errorTracker["key"].(string),
		ApiUrl:          apiUrl,
		Options:         timelineOpt,
	}

	InitTracker(option)

	AddToTimeline(customTimeline)

	currentTimeline := GetTimeline()

	actualResponse := reflect.TypeOf(currentTimeline[0].Timestamp).String()

	if fmt.Sprint(actualResponse) != expectedResponse {
		t.Errorf("TestCustomTimelineContainsimeStamp failed expected %v, got %v", expectedResponse, actualResponse)
	} else {
		t.Logf("TestCustomTimelineContainsimeStamp success expected %v, got %v", expectedResponse, actualResponse)
	}
}
func TestCustomTimelineContainsEventId(t *testing.T) {

	expectedResponse := reflect.TypeOf("hi").String()
	timelineOpt := TrackerOption{
		MaxTimeline: 10,
	}
	option := FyipeTrackerOption{
		ErrorTrackerId:  errorTracker["_id"].(string),
		ErrorTrackerKey: errorTracker["key"].(string),
		ApiUrl:          apiUrl,
		Options:         timelineOpt,
	}

	InitTracker(option)

	AddToTimeline(customTimeline)

	currentTimeline := GetTimeline()

	actualResponse := reflect.TypeOf(currentTimeline[0].EventId).String()

	if fmt.Sprint(actualResponse) != expectedResponse {
		t.Errorf("TestCustomTimelineContainsEventId failed expected %v, got %v", expectedResponse, actualResponse)
	} else {
		t.Logf("TestCustomTimelineContainsEventId success expected %v, got %v", expectedResponse, actualResponse)
	}
}

func TestTwoTimelineContainsSameEventId(t *testing.T) {

	timelineOpt := TrackerOption{
		MaxTimeline: 10,
	}
	option := FyipeTrackerOption{
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

	if fmt.Sprint(actualResponse) != expectedResponse {
		t.Errorf("TestTwoTimelineContainsSameEventId failed expected %v, got %v", expectedResponse, actualResponse)
	} else {
		t.Logf("TestTwoTimelineContainsSameEventId success expected %v, got %v", expectedResponse, actualResponse)
	}
}

func TestOlderTimelineAreDiscarded(t *testing.T) {
	timelineOpt := TrackerOption{
		MaxTimeline: 2,
	}
	option := FyipeTrackerOption{
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

	if fmt.Sprint(actualFirstTimelineResponse) != expectedFirstTimelineResponse {
		t.Errorf("TestTwoTimelineContainsSameEventId failed expected %v, got %v", expectedFirstTimelineResponse, actualFirstTimelineResponse)
	} else {
		t.Logf("TestTwoTimelineContainsSameEventId success expected %v, got %v", expectedFirstTimelineResponse, actualFirstTimelineResponse)
	}

	if fmt.Sprint(actualSecondTimelineResponse) != expectedSecondTimelineResponse {
		t.Errorf("TestTwoTimelineContainsSameEventId failed expected %v, got %v", expectedSecondTimelineResponse, actualSecondTimelineResponse)
	} else {
		t.Logf("TestTwoTimelineContainsSameEventId success expected %v, got %v", expectedSecondTimelineResponse, actualSecondTimelineResponse)
	}

}
func TestTagIsAdded(t *testing.T) {
	timelineOpt := TrackerOption{
		MaxTimeline: 2,
	}
	option := FyipeTrackerOption{
		ErrorTrackerId:  errorTracker["_id"].(string),
		ErrorTrackerKey: errorTracker["key"].(string),
		ApiUrl:          apiUrl,
		Options:         timelineOpt,
	}

	InitTracker(option)

	tagKey := "Location"
	tagValue := "Warsaw"

	expectedResponse := tagKey

	SetTag(tagKey, tagValue)

	tags := GetTag()

	actualResponse := tags[0].Key
	if fmt.Sprint(actualResponse) != expectedResponse {
		t.Errorf("TestTagIsAdded failed expected %v, got %v", expectedResponse, actualResponse)
	} else {
		t.Logf("TestTagIsAdded success expected %v, got %v", expectedResponse, actualResponse)
	}
}

func TestTagsAreAdded(t *testing.T) {
	timelineOpt := TrackerOption{
		MaxTimeline: 2,
	}
	option := FyipeTrackerOption{
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
}
func TestOverwriteTagsWithSameKeyWhenAdded(t *testing.T) {
	timelineOpt := TrackerOption{
		MaxTimeline: 2,
	}
	option := FyipeTrackerOption{
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

	if len(tags) != len(availableTags) { // only 3 unique tags
		t.Errorf("TestOverwriteTagsWithSameKeyWhenAdded failed expected %v, got %v", len(tags), len(availableTags))
	}
	if actualResponse != expectedResponse {
		t.Errorf("TestOverwriteTagsWithSameKeyWhenAdded failed expected %v, got %v", expectedResponse, actualResponse)
	} else {
		t.Logf("TestOverwriteTagsWithSameKeyWhenAdded success expected %v, got %v", expectedResponse, actualResponse)
	}
}
func TestFingerprintShouldBeCaptureMessage(t *testing.T) {
	timelineOpt := TrackerOption{
		MaxTimeline: 2,
	}
	option := FyipeTrackerOption{
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

	if actualResponse != expectedResponse {
		t.Errorf("TestFingerprintShouldBeCaptureMessage failed expected %v, got %v", expectedResponse, actualResponse)
	} else {
		t.Logf("TestFingerprintShouldBeCaptureMessage success expected %v, got %v", expectedResponse, actualResponse)
	}
}

func TestFingerprintShouldBeCustomValuesSetAheadCaptureMessage(t *testing.T) {
	timelineOpt := TrackerOption{
		MaxTimeline: 2,
	}
	option := FyipeTrackerOption{
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
		if actualResponse != expectedResponse {
			t.Errorf("TestFingerprintShouldBeCustomValuesSetAheadCaptureMessage failed expected %v, got %v", expectedResponse, actualResponse)
		} else {
			t.Logf("TestFingerprintShouldBeCustomValuesSetAheadCaptureMessage success expected %v, got %v", expectedResponse, actualResponse)
		}
	}
}
func TestCreateEventReadyForServerUsingCaptureMessage(t *testing.T) {
	timelineOpt := TrackerOption{
		MaxTimeline: 2,
	}
	option := FyipeTrackerOption{
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
	if actualType != expectedType {
		t.Errorf("TestCreateEventReadyForServerUsingCaptureMessage failed expected %v, got %v", expectedType, actualType)
	} else {
		t.Logf("TestCreateEventReadyForServerUsingCaptureMessage success expected %v, got %v", expectedType, actualType)
	}

	expectedMsg := errorMessage
	actualMsg := errorEvent.Exception.Message
	if actualMsg != expectedMsg {
		t.Errorf("TestCreateEventReadyForServerUsingCaptureMessage failed expected %v, got %v", expectedMsg, actualMsg)
	} else {
		t.Logf("TestCreateEventReadyForServerUsingCaptureMessage success expected %v, got %v", expectedMsg, actualMsg)
	}
}
func TestCaptureMessageTimelineAndEventWithSameID(t *testing.T) {
	timelineOpt := TrackerOption{
		MaxTimeline: 2,
	}
	option := FyipeTrackerOption{
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
	if actualTimelineCount != expectedTimelineCount {
		t.Errorf("TestCaptureMessageTimelineAndEventWithSameID failed expected %v, got %v", expectedTimelineCount, actualTimelineCount)
	} else {
		t.Logf("TestCaptureMessageTimelineAndEventWithSameID success expected %v, got %v", expectedTimelineCount, actualTimelineCount)
	}

	expectedEventId := errorEvent.EventId
	actualEventId := errorEvent.Timeline[0].EventId
	if actualEventId != expectedEventId {
		t.Errorf("TestCaptureMessageTimelineAndEventWithSameID failed expected %v, got %v", expectedEventId, actualEventId)
	} else {
		t.Logf("TestCaptureMessageTimelineAndEventWithSameID success expected %v, got %v", expectedEventId, actualEventId)
	}

	expectedMsg := errorMessage
	actualMsg := errorEvent.Exception.Message
	if actualMsg != expectedMsg {
		t.Errorf("TestCaptureMessageTimelineAndEventWithSameID failed expected %v, got %v", expectedMsg, actualMsg)
	} else {
		t.Logf("TestCaptureMessageTimelineAndEventWithSameID success expected %v, got %v", expectedMsg, actualMsg)
	}
}
func TestCaptureExceptionReadyForServer(t *testing.T) {
	timelineOpt := TrackerOption{
		MaxTimeline: 2,
	}
	option := FyipeTrackerOption{
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
	if actualMsg != expectedMsg {
		t.Errorf("TestCaptureExceptionReadyForServer failed expected %v, got %v", expectedMsg, actualMsg)
	} else {
		t.Logf("TestCaptureExceptionReadyForServer success expected %v, got %v", expectedMsg, actualMsg)
	}

	expectedType := "exception"
	actualType := errorEvent.Type
	if actualType != expectedType {
		t.Errorf("TestCaptureExceptionReadyForServer failed expected %v, got %v", expectedType, actualType)
	} else {
		t.Logf("TestCaptureExceptionReadyForServer success expected %v, got %v", expectedType, actualType)
	}
}
