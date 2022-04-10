package oneuptime

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io/ioutil"
	"net/http"
	"testing"

	"github.com/bxcodec/faker/v3"
)

type SampleUser struct {
	Name               string             `faker:"name" json:"name"`
	Password           string             `faker:"oneof: 1234567890, 1234567890" json:"password"`
	ConfirmPassword    string             `faker:"oneof: 1234567890, 1234567890" json:"confirmPassword"`
	Email              string             `faker:"email" json:"email"`
	CompanyName        string             `faker:"word" json:"companyName"`
	JobTitle           string             `faker:"word"  json:"jobTitle"`
	CompanySize        int                `faker:"boundary_start=3, boundary_end=10" json:"companySize"`
	Card               CardStruct         `json:"card"`
	Subscription       SubscriptionStruct `json:"subscription"`
	CardName           string             `faker:"name" json:"cardName"`
	CardNumber         string             `faker:"cc_number" json:"cardNumber"`
	Expiry             string             `faker:"oneof: 04/24, 08/25" json:"expiry"`
	CVV                int                `faker:"boundary_start=123, boundary_end=456" json:"cvv"`
	City               string             `faker:"word" json:"city"`
	State              string             `faker:"word" json:"state"`
	ZipCode            string             `faker:"oneof:3123, 8846" json:"zipCode"`
	PlanId             string             `faker:"oneof: plan_GoWIYiX2L8hwzx, plan_GoWIYiX2L8hwzx" json:"planId"`
	CompanyRole        string             `faker:"word" json:"companyRole"`
	CompanyPhoneNumber string             `faker:"phone_number" json:"companyPhoneNumber"`
	Reference          string             `faker:"oneof: Github, Slack" json:"reference"`
}
type CardStruct struct {
	StripeToken string `faker:"oneof: tok_visa, tok_visa"  json:"stripeToken"`
}
type SubscriptionStruct struct {
	StripePlanId int `faker:"oneof: 0, 0"  json:"stripePlanId"`
}

type NameStruct struct {
	Name string `faker:"name" json:"name"`
}
type SampleLog struct {
	Name     string `faker:"name" json:"name"`
	Location string `faker:"word" json:"state"`
}

func GetUser() SampleUser {
	a := SampleUser{}
	err := faker.FakeData(&a)
	if err != nil {
		fmt.Println(err)
	}
	return a
}
func GetNameComponent() NameStruct {
	a := NameStruct{}
	err := faker.FakeData(&a)
	if err != nil {
		fmt.Println(err)
	}
	return a
}

func GetSampleLog() SampleLog {
	a := SampleLog{}
	err := faker.FakeData(&a)
	if err != nil {
		fmt.Println(err)
	}
	return a
}

func MakeTestApiRequest(apiUrl string, content interface{}, token string) (map[string]interface{}, error) {
	postBody, _ := json.Marshal(content)
	requestBody := bytes.NewBuffer(postBody)

	req, err := http.NewRequest("POST", apiUrl, requestBody)
	if err != nil {
		// log.Fatalf("An Error Occured %v", err)
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	if token != "" {
		req.Header.Set("Authorization", "Basic "+token)
	}

	client := &http.Client{}

	resp, err := client.Do(req)

	if err != nil {
		// log.Fatalf("An Error Occured %v", err)
		return nil, err
	}

	body, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		// log.Fatalln(err)
		return nil, err
	}

	var response map[string]interface{}
	if err := json.Unmarshal([]byte(body), &response); err != nil {
		// panic(err)
		return nil, err
	}

	return response, nil
}

func AssertEqual(t *testing.T, testName string, actual string, expected string) {
	if expected != actual {
		t.Errorf("%v failed expected %v, got %v", testName, expected, actual)
	} else {
		t.Logf("%v success expected %v, got %v", testName, expected, actual)
	}
}

func AssertNotEqual(t *testing.T, testName string, actual string, expected string) {
	if expected == actual {
		t.Errorf("%v failed expected different value  %v, got %v", testName, expected, actual)
	} else {
		t.Logf("%v success expected different value %v, got %v", testName, expected, actual)
	}
}
