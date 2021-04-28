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
        tracker = FyipeTracker(self.apiUrl, self.errorTracker["_id"], self.errorTracker["key"])

        tracker.addToTimeline(self.customTimeline["category"], self.customTimeline["content"], self.customTimeline["type"])
        timeline = tracker.getTimeline()
        self.assertIsInstance(timeline, list)
        self.assertEqual(1, len(timeline))
        self.assertEqual(self.customTimeline["category"], timeline[0]["category"])
    
    def test_should_ensure_timeline_event_contains_eventId_and_timestamp(self):
    
        tracker = FyipeTracker(self.apiUrl, self.errorTracker["_id"], self.errorTracker["key"])

        tracker.addToTimeline(self.customTimeline["category"], self.customTimeline["content"], self.customTimeline["type"])
        timeline = tracker.getTimeline()
        self.assertIsInstance(timeline[0]["eventId"], str)
        self.assertIsInstance(timeline[0]["timestamp"], float)
    
    def test_should_ensure_different_timeline_event_have_the_same_eventId(self): 
        tracker = FyipeTracker(self.apiUrl, self.errorTracker["_id"], self.errorTracker["key"])

        tracker.addToTimeline(self.customTimeline["category"], self.customTimeline["content"], self.customTimeline["type"])
        tracker.addToTimeline(self.customTimeline["category"], self.customTimeline["content"], "error")
        timeline = tracker.getTimeline()
        self.assertEqual(2, len(timeline)) # two timeline events
        self.assertEqual(timeline[0]["eventId"], timeline[1]["eventId"])# their eventId is the same, till there is an error sent to the server
    
    def test_should_ensure_max_timline_cant_be_set_as_a_negative_number(self):
        options = {
            "maxTimeline": -5
        }
        tracker = FyipeTracker(self.apiUrl, self.errorTracker["_id"], self.errorTracker["key"], options)

        tracker.addToTimeline(self.customTimeline["category"], self.customTimeline["content"], self.customTimeline["type"])
        tracker.addToTimeline(self.customTimeline["category"], self.customTimeline["content"], "error")
        timeline = tracker.getTimeline()
        self.assertEqual(2, len(timeline)) # two timeline events
    
    def test_should_ensure_new_timeline_event_after_max_timeline_are_discarded(self): 
        options = {
            "maxTimeline": 2
        }
        tracker = FyipeTracker(self.apiUrl, self.errorTracker["_id"], self.errorTracker["key"], options)

        customTimeline2 = {
            "category": "logout",
            "type": "success",
            "content": {"message": "tester"}
        }

        # add 3 timelinee events
        tracker.addToTimeline(self.customTimeline["category"], self.customTimeline["content"], self.customTimeline["type"])
        tracker.addToTimeline(customTimeline2["category"], customTimeline2["content"], customTimeline2["type"])
        tracker.addToTimeline(self.customTimeline["category"], self.customTimeline["content"], "debug")
        timeline = tracker.getTimeline()
        
        self.assertEqual(options["maxTimeline"], len(timeline)) # three timeline events
        self.assertEqual(timeline[0]["type"], self.customTimeline["type"]) 
        self.assertEqual(timeline[1]["category"], customTimeline2["category"])
    
    
    