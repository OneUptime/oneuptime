package fyipe

import (
	"fmt"
	"testing"
)

var errorTracker map[string]interface{}

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
	customTimeline := &Timeline{
		Category: "testing",
		Data:     "heyy",
		Type:     "info",
	}
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
