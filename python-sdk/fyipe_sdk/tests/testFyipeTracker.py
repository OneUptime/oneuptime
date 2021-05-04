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
    
    # def test_should_ensure_timeline_event_contains_eventId_and_timestamp(self):
    
    #     tracker = FyipeTracker(self.apiUrl, self.errorTracker["_id"], self.errorTracker["key"])

    #     tracker.addToTimeline(self.customTimeline["category"], self.customTimeline["content"], self.customTimeline["type"])
    #     timeline = tracker.getTimeline()
    #     self.assertIsInstance(timeline[0]["eventId"], str)
    #     self.assertIsInstance(timeline[0]["timestamp"], float)
    
    # def test_should_ensure_different_timeline_event_have_the_same_eventId(self): 
    #     tracker = FyipeTracker(self.apiUrl, self.errorTracker["_id"], self.errorTracker["key"])

    #     tracker.addToTimeline(self.customTimeline["category"], self.customTimeline["content"], self.customTimeline["type"])
    #     tracker.addToTimeline(self.customTimeline["category"], self.customTimeline["content"], "error")
    #     timeline = tracker.getTimeline()
    #     self.assertEqual(2, len(timeline)) # two timeline events
    #     self.assertEqual(timeline[0]["eventId"], timeline[1]["eventId"])# their eventId is the same, till there is an error sent to the server
    
    # def test_should_ensure_max_timline_cant_be_set_as_a_negative_number(self):
    #     options = {
    #         "maxTimeline": -5
    #     }
    #     tracker = FyipeTracker(self.apiUrl, self.errorTracker["_id"], self.errorTracker["key"], options)

    #     tracker.addToTimeline(self.customTimeline["category"], self.customTimeline["content"], self.customTimeline["type"])
    #     tracker.addToTimeline(self.customTimeline["category"], self.customTimeline["content"], "error")
    #     timeline = tracker.getTimeline()
    #     self.assertEqual(2, len(timeline)) # two timeline events
    
    # def test_should_ensure_new_timeline_event_after_max_timeline_are_discarded(self): 
    #     options = {
    #         "maxTimeline": 2
    #     }
    #     tracker = FyipeTracker(self.apiUrl, self.errorTracker["_id"], self.errorTracker["key"], options)

    #     customTimeline2 = {
    #         "category": "logout",
    #         "type": "success",
    #         "content": {"message": "tester"}
    #     }

    #     # add 3 timeline events
    #     tracker.addToTimeline(self.customTimeline["category"], self.customTimeline["content"], self.customTimeline["type"])
    #     tracker.addToTimeline(customTimeline2["category"], customTimeline2["content"], customTimeline2["type"])
    #     tracker.addToTimeline(self.customTimeline["category"], self.customTimeline["content"], "debug")
    #     timeline = tracker.getTimeline()
        
    #     self.assertEqual(options["maxTimeline"], len(timeline)) # three timeline events
    #     self.assertEqual(timeline[0]["type"], self.customTimeline["type"]) 
    #     self.assertEqual(timeline[1]["category"], customTimeline2["category"])
    
    # def test_should_add_tags(self):
    #     tracker = FyipeTracker(self.apiUrl, self.errorTracker["_id"], self.errorTracker["key"])

    #     tag = {
    #         "key": "location",
    #         "value": "Warsaw"
    #     } 
    #     tracker.setTag(tag['key'], tag['value'])
        
    #     availableTags = tracker.getTags()
    #     self.assertIsInstance(availableTags, list)
    #     self.assertEqual(1, len(availableTags))
    #     self.assertEqual(tag['key'], availableTags[0]['key'])
    
    # def test_should_add_multiple_tags(self):
        
    #     tracker = FyipeTracker(self.apiUrl, self.errorTracker["_id"], self.errorTracker["key"])
    #     tags = []
    #     tag = {
    #         "key": "location",
    #         "value": "Warsaw"
    #     } 
    #     tags.append(tag)

    #     tagB = {
    #         "key": "city",
    #         "value": "Leeds"
    #     } 
    #     tags.append(tagB)

    #     tagC = {
    #         "key": "device",
    #         "value": "iPhone"
    #     } 
    #     tags.append(tagC)

    #     tracker.setTags(tags)

    #     availableTags = tracker.getTags()
    #     self.assertIsInstance(availableTags, list)
    #     self.assertEqual(len(tags), len(availableTags))
    
    # def test_should_overwrite_existing_keys_to_avoid_duplicate_tags(self):
    #     tracker = FyipeTracker(self.apiUrl, self.errorTracker["_id"], self.errorTracker["key"])

    #     tags = []
    #     tag = {
    #         "key": "location",
    #         "value": "Warsaw"
    #     } 
    #     tags.append(tag)

    #     tagB = {
    #         "key": "city",
    #         "value": "Leeds"
    #     } 
    #     tags.append(tagB)

    #     tagC = {
    #         "key": "location",
    #         "value": "Paris"
    #     } 
    #     tags.append(tagC)

    #     tagD = {
    #         "key": "device",
    #         "value": "iPhone"
    #     } 
    #     tags.append(tagD)

    #     tagE = {
    #         "key": "location",
    #         "value": "London"
    #     } 
    #     tags.append(tagE)

    #     tracker.setTags(tags)

    #     availableTags = tracker.getTags()
    #     self.assertIsInstance(availableTags, list)
    #     self.assertEqual(3, len(availableTags)) # only 3 unique tags
    #     self.assertEqual(tagC["key"], availableTags[0]["key"]) 
    #     self.assertNotEqual(tagC["value"], availableTags[0]["value"])# old value for that tag location
    #     self.assertEqual(tagE["key"], availableTags[0]["key"]) 
    #     self.assertEqual(tagE["value"], availableTags[0]["value"])# latest value for that tag location
    
    # def test_should_create_fingerprint_as_message_for_error_capture_without_any_fingerprint(self):
    #     tracker = FyipeTracker(self.apiUrl, self.errorTracker["_id"], self.errorTracker["key"])

    #     errorMessage = "Uncaught Exception"
    #     tracker.captureMessage(errorMessage)
    #     event = tracker.getCurrentEvent()
    #     self.assertEqual(event["fingerprint"][0], errorMessage)
    
    # def test_should_use_defined_fingerprint_array_for_error_capture_with_fingerprint(self):
    #     tracker = FyipeTracker(self.apiUrl, self.errorTracker["_id"], self.errorTracker["key"])

    #     fingerprints = ['custom', 'errors']
    #     tracker.setFingerPrint(fingerprints)
    #     errorMessage = 'Uncaught Exception'
    #     tracker.captureMessage(errorMessage)
    #     event = tracker.getCurrentEvent()
    #     self.assertEqual(event["fingerprint"][0], fingerprints[0])
    #     self.assertEqual(event["fingerprint"][1], fingerprints[1])
    
    # def test_should_use_defined_fingerprint_string_for_error_capture_with_fingerprint(self):
    #     tracker = FyipeTracker(self.apiUrl, self.errorTracker["_id"], self.errorTracker["key"])

    #     fingerprint = 'custom-fingerprint'
    #     tracker.setFingerPrint(fingerprint)
    #     errorMessage = 'Uncaught Exception'
    #     tracker.captureMessage(errorMessage)
    #     event = tracker.getCurrentEvent()
    #     self.assertEqual(event["fingerprint"][0], fingerprint)
    
    # def test_should_create_an_event_ready_for_the_server_using_capture_message(self):
    #     tracker = FyipeTracker(self.apiUrl, self.errorTracker["_id"], self.errorTracker["key"])

    #     errorMessage = 'This is a test'
    #     tracker.captureMessage(errorMessage)
    #     event = tracker.getCurrentEvent()
    #     self.assertEqual(event["type"], "message") 
    #     self.assertEqual(event["exception"]["message"], errorMessage) 
    
    def test_should_create_an_event_ready_for_the_server_while_having_the_timeline_with_same_event_id(self):
        tracker = FyipeTracker(self.apiUrl, self.errorTracker["_id"], self.errorTracker["key"])
        tracker.addToTimeline(self.customTimeline["category"], self.customTimeline["content"], self.customTimeline["type"])

        
        errorMessage = 'This is a test'
        tracker.captureMessage(errorMessage)
        event = tracker.getCurrentEvent()


        self.assertEqual(2, len(event["timeline"]))
        self.assertEqual(event["eventId"], event["timeline"][0]["eventId"])
        self.assertEqual(event["exception"]["message"], errorMessage)
    
    
    def test_should_create_an_event_ready_for_the_server_using_capture_exception(self):
        tracker = FyipeTracker(self.apiUrl, self.errorTracker["_id"], self.errorTracker["key"])

        errorMessage = 'Error Found'
        tracker.captureException(Exception(errorMessage))
        event = tracker.getCurrentEvent()
        self.assertEqual(event["type"], 'exception')
        self.assertEqual(event["exception"]["message"], errorMessage)
    
    def test_should_create_an_event_with_array_of_stacktrace(self):
        tracker = FyipeTracker(self.apiUrl, self.errorTracker["_id"], self.errorTracker["key"])

        errorType = 'ZeroDivisionError'
        try: 
            divByZero = 1/0
        except Exception as ex:
            tracker.captureException(ex)
        event = tracker.getCurrentEvent()
        self.assertEqual(event["type"], 'exception')
        self.assertEqual(event["exception"]["type"], errorType)
        self.assertIsInstance(event["exception"]["stacktrace"],dict)
        self.assertIsInstance(event["exception"]["stacktrace"]["frames"],list)
    
    def test_should_create_an_event_with_the_object_of_the_stacktrace_in_place(self):
        tracker = FyipeTracker(self.apiUrl, self.errorTracker["_id"], self.errorTracker["key"])

        errorType = 'ZeroDivisionError'
        try:  
            divByZero= 1/0
        except Exception as ex:
            tracker.captureException(ex)
        event = tracker.getCurrentEvent()
        frame = event["exception"]["stacktrace"]["frames"][0]
        
        self.assertIn("methodName", frame)
        self.assertIn("lineNumber", frame)
        self.assertIn("fileName", frame)

