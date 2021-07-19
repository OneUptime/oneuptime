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
	expectedResponse := ErrApplicationLogIDMissing
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
	expectedResponse := ErrApplicationLogKeyMissing
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
func TestValidContentRequired(t *testing.T) {
	expectedResponse := ErrContentMissing
	option := LoggerOptions{
		ApplicationLogId:  appLog["_id"].(string),
		ApplicationLogKey: appLog["key"].(string),
		ApiUrl:            apiUrl,
	}

	setupResponse := Init(option)

	if setupResponse != nil {
		t.Errorf("TestValidContentRequired failed expected %v, got %v", expectedResponse, setupResponse)
	}
	var tag = []string{}

	logResponse, logErr := LogInfo(nil, tag)
	fmt.Sprint(logResponse)
	if fmt.Sprint(logErr) == expectedResponse {
		t.Logf("TestValidContentRequired failed expected %v, got %v", expectedResponse, logErr)
	} else {
		t.Errorf("TestValidContentRequired failed expected %v, got %v", expectedResponse, logErr)
	}
}
func TestContentRequired(t *testing.T) {
	expectedResponse := "Content to be logged is required."
	option := LoggerOptions{
		ApplicationLogId:  appLog["_id"].(string),
		ApplicationLogKey: appLog["key"].(string),
		ApiUrl:            apiUrl,
	}

	setupResponse := Init(option)

	if setupResponse != nil {
		t.Errorf("TestContentRequired failed expected %v, got %v", expectedResponse, setupResponse)
	}
	var tag = []string{}

	logResponse, logErr := LogInfo("", tag)
	actualResponse := logResponse.Message

	if logErr != nil {
		t.Errorf("TestContentRequired failed expected %v, got %v", expectedResponse, logErr)
	}

	if actualResponse != expectedResponse {
		t.Errorf("TestContentRequired failed expected %v, got %v", expectedResponse, actualResponse)
	} else {
		t.Logf("TestContentRequired success expected %v, got %v", expectedResponse, actualResponse)
	}
}
func TestValidApplicationLogRequired(t *testing.T) {
	expectedResponse := "Application Log does not exist."
	option := LoggerOptions{
		ApplicationLogId:  "5eec6f33d7d57033b3a7d502",
		ApplicationLogKey: appLog["key"].(string),
		ApiUrl:            apiUrl,
	}

	setupResponse := Init(option)

	if setupResponse != nil {
		t.Errorf("TestValidApplicationLogRequired failed expected %v, got %v", expectedResponse, setupResponse)
	}
	var tag = []string{}
	randomContent := "Sample Content"

	logResponse, logErr := LogInfo(randomContent, tag)
	actualResponse := logResponse.Message

	if logErr != nil {
		t.Errorf("TestValidApplicationLogRequired failed expected %v, got %v", expectedResponse, logErr)
	}

	if actualResponse != expectedResponse {
		t.Errorf("TestValidApplicationLogRequired failed expected %v, got %v", expectedResponse, actualResponse)
	} else {
		t.Logf("TestValidApplicationLogRequired success expected %v, got %v", expectedResponse, actualResponse)
	}
}
func TestContentStringIsLogged(t *testing.T) {
	expectedResponse := ""
	option := LoggerOptions{
		ApplicationLogId:  appLog["_id"].(string),
		ApplicationLogKey: appLog["key"].(string),
		ApiUrl:            apiUrl,
	}

	setupResponse := Init(option)

	if setupResponse != nil {
		t.Errorf("TestContentStringIsLogged failed expected %v, got %v", expectedResponse, setupResponse)
	}
	var tag = []string{}
	randomContent := "Sample Content"
	expectedResponse = randomContent

	logResponse, logErr := LogInfo(randomContent, tag)
	actualResponse := logResponse.Content

	if logErr != nil {
		t.Errorf("TestContentStringIsLogged failed expected %v, got %v", expectedResponse, logErr)
	}

	if actualResponse != expectedResponse {
		t.Errorf("TestContentStringIsLogged failed expected %v, got %v", expectedResponse, actualResponse)
	} else {
		t.Logf("TestContentStringIsLogged success expected %v, got %v", expectedResponse, actualResponse)
	}
}
func TestContentStructIsLogged(t *testing.T) {
	expectedResponse := ""
	option := LoggerOptions{
		ApplicationLogId:  appLog["_id"].(string),
		ApplicationLogKey: appLog["key"].(string),
		ApiUrl:            apiUrl,
	}

	setupResponse := Init(option)

	if setupResponse != nil {
		t.Errorf("TestContentStringIsLogged failed expected %v, got %v", expectedResponse, setupResponse)
	}
	var tag = []string{}
	randomContent := GetSampleLog()
	expectedResponse = randomContent.Name

	logResponse, logErr := LogInfo(randomContent, tag)
	actualResponse := logResponse.Content.(map[string]interface{})["name"]

	if logErr != nil {
		t.Errorf("TestContentStringIsLogged failed expected %v, got %v", expectedResponse, logErr)
	}

	if actualResponse != expectedResponse {
		t.Errorf("TestContentStringIsLogged failed expected %v, got %v", expectedResponse, actualResponse)
	} else {
		t.Logf("TestContentStringIsLogged success expected %v, got %v", expectedResponse, actualResponse)
	}
}

func TestContentOfTypeWarningIsLogged(t *testing.T) {
	expectedResponse := "warning"
	option := LoggerOptions{
		ApplicationLogId:  appLog["_id"].(string),
		ApplicationLogKey: appLog["key"].(string),
		ApiUrl:            apiUrl,
	}

	setupResponse := Init(option)

	if setupResponse != nil {
		t.Errorf("TestContentOfTypeWarningIsLogged failed expected %v, got %v", expectedResponse, setupResponse)
	}
	var tag = []string{}
	randomContent := "Sample Content"

	logResponse, logErr := LogWarning(randomContent, tag)
	actualResponse := logResponse.Type

	if logErr != nil {
		t.Errorf("TestContentOfTypeWarningIsLogged failed expected %v, got %v", expectedResponse, logErr)
	}

	if actualResponse != expectedResponse {
		t.Errorf("TestContentOfTypeWarningIsLogged failed expected %v, got %v", expectedResponse, actualResponse)
	} else {
		t.Logf("TestContentOfTypeWarningIsLogged success expected %v, got %v", expectedResponse, actualResponse)
	}
}

func TestContentOfTypeErrorIsLogged(t *testing.T) {
	expectedResponse := "error"
	option := LoggerOptions{
		ApplicationLogId:  appLog["_id"].(string),
		ApplicationLogKey: appLog["key"].(string),
		ApiUrl:            apiUrl,
	}

	setupResponse := Init(option)

	if setupResponse != nil {
		t.Errorf("TestContentOfTypeErrorIsLogged failed expected %v, got %v", expectedResponse, setupResponse)
	}
	var tag = []string{}
	randomContent := GetSampleLog()

	logResponse, logErr := LogError(randomContent, tag)
	actualResponse := logResponse.Type

	if logErr != nil {
		t.Errorf("TestContentOfTypeErrorIsLogged failed expected %v, got %v", expectedResponse, logErr)
	}

	if actualResponse != expectedResponse {
		t.Errorf("TestContentOfTypeErrorIsLogged failed expected %v, got %v", expectedResponse, actualResponse)
	} else {
		t.Logf("TestContentOfTypeErrorIsLogged success expected %v, got %v", expectedResponse, actualResponse)
	}
}
func TestContentWithNoTagIsLogged(t *testing.T) {
	expectedResponse := 0
	option := LoggerOptions{
		ApplicationLogId:  appLog["_id"].(string),
		ApplicationLogKey: appLog["key"].(string),
		ApiUrl:            apiUrl,
	}

	setupResponse := Init(option)

	if setupResponse != nil {
		t.Errorf("TestContentWithNoTagIsLogged failed expected %v, got %v", expectedResponse, setupResponse)
	}
	var tag = []string{}
	randomContent := GetSampleLog()

	logResponse, logErr := LogError(randomContent, tag)
	actualResponse := len(logResponse.Tags)

	if logErr != nil {
		t.Errorf("TestContentWithNoTagIsLogged failed expected %v, got %v", expectedResponse, logErr)
	}

	if actualResponse != expectedResponse {
		t.Errorf("TestContentWithNoTagIsLogged failed expected %v, got %v", expectedResponse, actualResponse)
	} else {
		t.Logf("TestContentWithNoTagIsLogged success expected %v, got %v", expectedResponse, actualResponse)
	}
}
func TestContentWithOneTagIsLogged(t *testing.T) {
	expectedResponse := 1
	option := LoggerOptions{
		ApplicationLogId:  appLog["_id"].(string),
		ApplicationLogKey: appLog["key"].(string),
		ApiUrl:            apiUrl,
	}

	setupResponse := Init(option)

	if setupResponse != nil {
		t.Errorf("TestContentWithOneTagIsLogged failed expected %v, got %v", expectedResponse, setupResponse)
	}
	var tag = []string{"randon tag"}
	randomContent := GetSampleLog()

	logResponse, logErr := LogError(randomContent, tag)
	actualResponse := len(logResponse.Tags)

	if logErr != nil {
		t.Errorf("TestContentWithOneTagIsLogged failed expected %v, got %v", expectedResponse, logErr)
	}

	if actualResponse != expectedResponse {
		t.Errorf("TestContentWithOneTagIsLogged failed expected %v, got %v", expectedResponse, actualResponse)
	} else {
		t.Logf("TestContentWithOneTagIsLogged success expected %v, got %v", expectedResponse, actualResponse)
	}
}
func TestContentWithFourTagIsLogged(t *testing.T) {
	expectedResponse := 4
	expectedTypeResponse := "warning"
	option := LoggerOptions{
		ApplicationLogId:  appLog["_id"].(string),
		ApplicationLogKey: appLog["key"].(string),
		ApiUrl:            apiUrl,
	}

	setupResponse := Init(option)

	if setupResponse != nil {
		t.Errorf("TestContentWithFourTagIsLogged failed expected %v, got %v", expectedResponse, setupResponse)
	}
	var tag = []string{"testing", "rubylansh", "trial", "correct"}
	randomContent := GetSampleLog()

	logResponse, logErr := LogWarning(randomContent, tag)
	actualResponse := len(logResponse.Tags)
	actualTypeResponse := logResponse.Type

	if logErr != nil {
		t.Errorf("TestContentWithFourTagIsLogged failed expected %v, got %v", expectedResponse, logErr)
	}

	if actualResponse != expectedResponse {
		t.Errorf("TestContentWithFourTagIsLogged failed expected %v, got %v", expectedResponse, actualResponse)
	} else {
		t.Logf("TestContentWithFourTagIsLogged  success expected %v, got %v", expectedResponse, actualResponse)
	}
	if actualTypeResponse != expectedTypeResponse {
		t.Errorf("TestContentWithFourTagIsLogged failed expected %v, got %v", expectedResponse, actualResponse)
	} else {
		t.Logf("TestContentWithFourTagIsLogged success expected %v, got %v", expectedResponse, actualResponse)
	}
}
