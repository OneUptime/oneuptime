package fyipe

import (
	"fmt"
	"regexp"
	"testing"
)

const apiUrl = "http://localhost:3002/api"

func init() {
	fmt.Println("set up will happen here")
	fmt.Println(apiUrl)
	var sampleUser = GetUser()

	MakeTestApiRequest(apiUrl+"/user/signup", sampleUser)

}
func TestHelloName(t *testing.T) {
	name := "Gladys"
	want := regexp.MustCompile(`\b` + name + `\b`)
	if !want.MatchString(name) {
		t.Fatalf(`Hello("Gladys") = %q,  want match for %#q, nil`, name, want)
	}
}
func TestApplicationLogKeyRequired(t *testing.T) {
	option := LoggerOptions{
		ApplicationLogId:  "5eeb5bc23b0014dfbe070dbc",
		ApplicationLogKey: "",
		ApiUrl:            "http://localhost:3002/api",
	}
	Init(option)

	// var res, errorRes = LogInfo("Random Info Message")

}
