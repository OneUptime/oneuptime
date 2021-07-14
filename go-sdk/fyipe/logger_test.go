package fyipe

import (
	"fmt"
	"testing"
)

const apiUrl = "http://localhost:3002/api"

var appLog map[string]interface{}

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

	// create an applicationlog and set it as the global application Log.
	var sampleAppLog = GetNameComponent()
	localAppLog, err := MakeTestApiRequest(apiUrl+"/application-log/"+project.(map[string]interface{})["_id"].(string)+"/"+createdComponent["_id"].(string)+"/create", sampleAppLog, token.(string))

	appLog = localAppLog
	fmt.Println("Test setup done, Application Log created, tests will begin...")
}
func TestApplicationLogIDRequired(t *testing.T) {
	expectedResponse := "Application Log ID cant be empty"
	option := LoggerOptions{
		ApplicationLogId:  "",
		ApplicationLogKey: appLog["key"].(string),
		ApiUrl:            apiUrl,
	}

	setupResponse := Init(option)

	if fmt.Sprint(setupResponse) != expectedResponse {
		t.Errorf("TestApplicationLogIDRequired failed expected %v, got %v", expectedResponse, setupResponse)
	} else {
		t.Logf("TestApplicationLogIDRequired success expected %v, got %v", expectedResponse, setupResponse)
	}
}
func TestApplicationLogKeyRequired(t *testing.T) {
	expectedResponse := "Application Log Key cant be empty"
	option := LoggerOptions{
		ApplicationLogId:  appLog["_id"].(string),
		ApplicationLogKey: "",
		ApiUrl:            apiUrl,
	}

	setupResponse := Init(option)

	if fmt.Sprint(setupResponse) != expectedResponse {
		t.Errorf("TestApplicationLogKeyRequired failed expected %v, got %v", expectedResponse, setupResponse)
	} else {
		t.Logf("TestApplicationLogKeyRequired success expected %v, got %v", expectedResponse, setupResponse)
	}
}
