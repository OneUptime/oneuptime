import unittest
from faker import Faker
import requests
from fyipe_sdk import FyipeTracker

class TrackerTest(unittest.TestCase):
    def setUp(self):
        self.apiUrl = "http://localhost:3002/api"
        self.fake = Faker()
        self.setUserObject()
        self.customTimeline = {
            "category": "cart",
            "type": "info",
            "content": { "message": "test-content"}
        }
        try:
            # create user
            createdUser = self.apiRequest(self.apiUrl + "/user/signup", self.user, {})

            # get token and project
            token = createdUser["tokens"]["jwtAccessToken"]
            self.header = {"Authorization": "Basic " + token}
            self.project = createdUser["project"]

            # create a component
            component = {"name": self.fake.word()}
            createdComponent = self.apiRequest(
                self.apiUrl + "/component/" + self.project["_id"],
                component,
                self.header,
            )
            self.component = createdComponent

            # create an errorTracker and set it as the global error tracker.
            errorTracker = {"name": self.fake.word()}
            createdErrorTracker = self.apiRequest(
                self.apiUrl
                + "/error-tracker/"
                + self.project["_id"]
                + "/"
                + createdComponent["_id"]
                + "/create",
                errorTracker,
                self.header,
            )
            self.errorTracker = createdErrorTracker

        except requests.exceptions.HTTPError as error:
            print("Couldnt create an error tracker to run a test, Error occured: ")
            print(error)

    def setUserObject(self):
        self.user = {
            "name": self.fake.name(),
            "password": "1234567890",
            "confirmPassword": "1234567890",
            "email": self.fake.ascii_company_email(),
            "companyName": self.fake.company(),
            "jobRole": self.fake.job(),
            "companySize": self.fake.random_int(),
            "card": {"stripeToken": "tok_visa"},
            "subscription": {"stripePlanId": 0},
            "cardName": self.fake.credit_card_provider(),
            "cardNumber": self.fake.credit_card_number(),
            "cvv": self.fake.credit_card_security_code(),
            "expiry": self.fake.credit_card_expire(),
            "city": self.fake.city(),
            "state": self.fake.country(),
            "zipCode": self.fake.postcode(),
            "companyRole": self.fake.job(),
            "companyPhoneNumber": self.fake.phone_number(),
            "planId": "plan_GoWIYiX2L8hwzx",
            "reference": "Github",
        }
        return self

    def apiRequest(self, url, body, headers):
        response = requests.post(url, body, headers=headers)
        return response.json()
    
    def test_should_take_in_custom_timeline_event(self):
        tracker = FyipeTracker(self.apiUrl, self.errorTracker["_id"], self.errorTracker["key"]);

        tracker.addToTimeline(self.customTimeline["category"], self.customTimeline["content"], self.customTimeline["type"]);
        timeline = tracker.getTimeline();
        print(timeline)
        # $this->assertIsArray($timeline);
        # $this->assertCount(1, $timeline);
        # $this->assertEquals(static::$customTimeline->category, $timeline[0]->category);
    