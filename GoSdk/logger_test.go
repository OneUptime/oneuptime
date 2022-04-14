package oneuptime

import (
	"fmt"
	"testing"
)

const apiUrl: $TSFixMe = "http://localhost:3002/api"

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

	AssertEqual(t, "TestApplicationLogIDRequired", fmt.Sprint(setupResponse), expectedResponse)
}
func TestApplicationLogKeyRequired(t *testing.T) {
	expectedResponse := ErrApplicationLogKeyMissing
	option := LoggerOptions{
		ApplicationLogId:  appLog["_id"].(string),
		ApplicationLogKey: "",
		ApiUrl:            apiUrl,
	}

	setupResponse := Init(option)

	AssertEqual(t, "TestApplicationLogKeyRequired", fmt.Sprint(setupResponse), expectedResponse)

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
		AssertEqual(t, "TestValidContentRequired", fmt.Sprint(setupResponse), expectedResponse)
	}
	var tag = []string{}

	logResponse, logErr := LogInfo(nil, tag)
	fmt.Sprint(logResponse)

	AssertEqual(t, "TestValidContentRequired", fmt.Sprint(logErr), expectedResponse)

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
		AssertEqual(t, "TestContentRequired", fmt.Sprint(setupResponse), expectedResponse)
	}
	var tag = []string{}

	logResponse, logErr := LogInfo("", tag)
	actualResponse := logResponse.Message

	if logErr != nil {
		AssertEqual(t, "TestContentRequired", fmt.Sprint(logErr), expectedResponse)
	}

	AssertEqual(t, "TestContentRequired", actualResponse, expectedResponse)

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
		AssertEqual(t, "TestValidApplicationLogRequired", fmt.Sprint(setupResponse), expectedResponse)
	}
	var tag = []string{}
	randomContent := "Sample Content"

	logResponse, logErr := LogInfo(randomContent, tag)
	actualResponse := logResponse.Message

	if logErr != nil {
		AssertEqual(t, "TestValidApplicationLogRequired", fmt.Sprint(logErr), expectedResponse)
	}

	AssertEqual(t, "TestValidApplicationLogRequired", actualResponse, expectedResponse)

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
		AssertEqual(t, "TestContentStringIsLogged", fmt.Sprint(setupResponse), expectedResponse)

	}
	var tag = []string{}
	randomContent := "Sample Content"
	expectedResponse = randomContent

	logResponse, logErr := LogInfo(randomContent, tag)
	actualResponse := logResponse.Content

	if logErr != nil {
		AssertEqual(t, "TestContentStringIsLogged", fmt.Sprint(logErr), expectedResponse)

	}

	if expectedResponse != actualResponse {
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
		AssertEqual(t, "TestContentStructIsLogged", fmt.Sprint(setupResponse), expectedResponse)

	}
	var tag = []string{}
	randomContent := GetSampleLog()
	expectedResponse = randomContent.Name

	logResponse, logErr := LogInfo(randomContent, tag)
	actualResponse := logResponse.Content.(map[string]interface{})["name"]

	if logErr != nil {
		AssertEqual(t, "TestContentStructIsLogged", fmt.Sprint(logErr), expectedResponse)

	}

	if expectedResponse != actualResponse {
		t.Errorf("TestContentStructIsLogged failed expected %v, got %v", expectedResponse, actualResponse)
	} else {
		t.Logf("TestContentStructIsLogged success expected %v, got %v", expectedResponse, actualResponse)
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
		AssertEqual(t, "TestContentOfTypeWarningIsLogged", fmt.Sprint(setupResponse), expectedResponse)

	}
	var tag = []string{}
	randomContent := "Sample Content"

	logResponse, logErr := LogWarning(randomContent, tag)
	actualResponse := logResponse.Type

	if logErr != nil {
		AssertEqual(t, "TestContentOfTypeWarningIsLogged", fmt.Sprint(logErr), expectedResponse)

	}

	AssertEqual(t, "TestContentOfTypeWarningIsLogged", actualResponse, expectedResponse)

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
		AssertEqual(t, "TestContentOfTypeErrorIsLogged", fmt.Sprint(setupResponse), expectedResponse)

	}
	var tag = []string{}
	randomContent := GetSampleLog()

	logResponse, logErr := LogError(randomContent, tag)
	actualResponse := logResponse.Type

	if logErr != nil {
		AssertEqual(t, "TestContentOfTypeErrorIsLogged", fmt.Sprint(logErr), expectedResponse)

	}

	AssertEqual(t, "TestContentOfTypeErrorIsLogged", actualResponse, expectedResponse)

}
func TestContentWithNoTagIsLogged(t *testing.T) {
	expectedResponse := "0"
	option := LoggerOptions{
		ApplicationLogId:  appLog["_id"].(string),
		ApplicationLogKey: appLog["key"].(string),
		ApiUrl:            apiUrl,
	}

	setupResponse := Init(option)

	if setupResponse != nil {
		AssertEqual(t, "TestContentWithNoTagIsLogged", fmt.Sprint(setupResponse), expectedResponse)

	}
	var tag = []string{}
	randomContent := GetSampleLog()

	logResponse, logErr := LogError(randomContent, tag)
	actualResponse := len(logResponse.Tags)

	if logErr != nil {
		AssertEqual(t, "TestContentWithNoTagIsLogged", fmt.Sprint(logErr), expectedResponse)

	}

	AssertEqual(t, "TestContentWithNoTagIsLogged", fmt.Sprint(actualResponse), expectedResponse)

}
func TestContentWithOneTagIsLogged(t *testing.T) {
	expectedResponse := "1"
	option := LoggerOptions{
		ApplicationLogId:  appLog["_id"].(string),
		ApplicationLogKey: appLog["key"].(string),
		ApiUrl:            apiUrl,
	}

	setupResponse := Init(option)

	if setupResponse != nil {
		AssertEqual(t, "TestContentWithOneTagIsLogged", fmt.Sprint(setupResponse), expectedResponse)

	}
	var tag = []string{"randon tag"}
	randomContent := GetSampleLog()

	logResponse, logErr := LogError(randomContent, tag)
	actualResponse := len(logResponse.Tags)

	if logErr != nil {
		AssertEqual(t, "TestContentWithOneTagIsLogged", fmt.Sprint(logErr), expectedResponse)

	}

	AssertEqual(t, "TestContentWithOneTagIsLogged", fmt.Sprint(actualResponse), expectedResponse)

}
func TestContentWithFourTagIsLogged(t *testing.T) {
	expectedResponse := "4"
	expectedTypeResponse := "warning"
	option := LoggerOptions{
		ApplicationLogId:  appLog["_id"].(string),
		ApplicationLogKey: appLog["key"].(string),
		ApiUrl:            apiUrl,
	}

	setupResponse := Init(option)

	if setupResponse != nil {
		AssertEqual(t, "TestContentWithFourTagIsLogged", fmt.Sprint(setupResponse), expectedResponse)

	}
	var tag = []string{"testing", "rubylansh", "trial", "correct"}
	randomContent := GetSampleLog()

	logResponse, logErr := LogWarning(randomContent, tag)
	actualResponse := len(logResponse.Tags)
	actualTypeResponse := logResponse.Type

	if logErr != nil {
		AssertEqual(t, "TestContentWithFourTagIsLogged", fmt.Sprint(logErr), expectedResponse)

	}

	AssertEqual(t, "TestContentWithFourTagIsLogged", fmt.Sprint(actualResponse), expectedResponse)
	AssertEqual(t, "TestContentWithFourTagIsLogged", actualTypeResponse, expectedTypeResponse)

}
