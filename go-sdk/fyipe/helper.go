package fyipe

import (
	"fmt"

	"github.com/bxcodec/faker/v3"
)

type SampleUser struct {
	Name               string `faker:"name"`
	Password           string `faker:"oneof: 1234567890, 1234567890"`
	ConfirmPassword    string `faker:"oneof: 1234567890, 1234567890"`
	Email              string `faker:"email"`
	CompanyName        string `faker:"word"`
	JobTitle           string `faker:"word"`
	CompanySize        int    `faker:"boundary_start=3, boundary_end=10"`
	Card               CardStruct
	Subscription       SubscriptionStruct
	CardName           string `faker:"name"`
	CardNumber         string `faker:"cc_number"`
	Expiry             string `faker:"oneof: 04/24, 08/25"`
	CVV                int    `faker:"boundary_start=123, boundary_end=456"`
	City               string `faker:"word"`
	State              string `faker:"word"`
	ZipCode            string `faker:"oneof:3123, 8846"`
	PlanId             string `faker:"oneof: plan_GoWIYiX2L8hwzx, plan_GoWIYiX2L8hwzx"`
	CompanyRole        string `faker:"word"`
	CompanyPhoneNumber string `faker:"phone_number"`
	Reference          string `faker:"oneof: Github, Slack"`
}
type CardStruct struct {
	StripeToken string `faker:"oneof: tok_visa, tok_visa"`
}
type SubscriptionStruct struct {
	StripePlanId int `faker:"oneof: 0, 0"`
}

func GetUser() SampleUser {
	a := SampleUser{}
	err := faker.FakeData(&a)
	if err != nil {
		fmt.Println(err)
	}
	return a
}
func GetTitle() string {
	return faker.Word()
}
