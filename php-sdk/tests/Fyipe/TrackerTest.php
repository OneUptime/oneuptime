<?php

/**
 * @author bunday
 */

use PHPUnit\Framework\TestCase;
use Faker\Factory;


class TrackerTest extends TestCase
{
    private $apiUrl = 'http://localhost:3002/api';
    private static $errorTracker;
    private $faker;
    private $header = [];
    private static $ready = false;

    private static $customTimeline;

    protected function setUp(): void
    {
        if (static::$ready) {
            return;
        }
        parent::setUp();
        $this->faker = Factory::create();
        // create a test user
        $user = new stdClass();
        $user->name = $this->faker->name;
        $user->password = '1234567890';
        $user->confirmPassword = '1234567890';
        $user->email = $this->faker->companyEmail;
        $user->companyName = $this->faker->company;
        $user->jobRole = $this->faker->jobTitle;
        $user->companySize = $this->faker->unique()->randomDigit;
        $stripe = new stdClass();
        $stripe->stripeToken = 'tok_visa';
        $user->card = $stripe;
        $stripe = new stdClass();
        $stripe->stripePlanId = 0;
        $user->subscription = $stripe;
        $user->cardName = $this->faker->creditCardType;
        $user->cardNumber = $this->faker->creditCardNumber;
        $user->cvv = '123';
        $user->expiry = $this->faker->creditCardExpirationDateString;
        $user->city = $this->faker->city;
        $user->state = $this->faker->state;
        $user->zipCode = $this->faker->postcode;
        $user->planId = 'plan_GoWIYiX2L8hwzx';
        $user->companyRole = $this->faker->jobTitle;
        $user->companyPhoneNumber = $this->faker->phoneNumber;
        $user->reference = 'Github';

        sleep(30);
        $client = new \GuzzleHttp\Client(['base_uri' => $this->apiUrl]);
        try {

            // create user
            $response = $client->request('POST', '/user/signup',  ['form_params' => $user]);
            $createdUser = json_decode($response->getBody()->getContents());

            // get token and project
            $token = $createdUser->tokens->jwtAccessToken;
            $this->header['Authorization'] = 'Basic ' . $token;
            $project = $createdUser->project;

            // create a component
            $component = ['name' => $this->faker->words(2, true)];
            $response = $client->request('POST', '/component/' . $project->_id, [
                'headers' => $this->header, 'form_params' => $component
            ]);
            $createdComponent = json_decode($response->getBody()->getContents());

            // create an errorTracker and set it as the global error tracker.
            $errorTracker = ['name' => $this->faker->words(2, true)];
            $response = $client->request('POST', '/error-tracker/'.$project->_id.'/'.$createdComponent->_id.'/create', [
                'headers' => $this->header, 'form_params' => $errorTracker
            ]);
            static::$errorTracker = json_decode($response->getBody()->getContents());
        } catch (Exception $e) {
            dd("Couldnt create an error tracker to run a test, Error occured: ".$e->getMessage());
        }

        // set up custom timeline object
        static::$customTimeline = new stdClass();
        static::$customTimeline->category = 'cart';
        static::$customTimeline->type = 'info';
        $content = new stdClass();
        $content->message = 'test-content';
        static::$customTimeline->content = $content;

        static::$ready = true;
    }

    public function test_should_take_in_custom_timeline_event()
    {
        $tracker = new Fyipe\FyipeTracker($this->apiUrl, static::$errorTracker->_id, static::$errorTracker->key);
        $tracker->addToTimeline(static::$customTimeline->category, static::$customTimeline->content, static::$customTimeline->type);
        $timeline = $tracker->getTimeline();
        $this->assertIsArray($timeline);
        $this->assertCount(1, $timeline);
        $this->assertEquals(static::$customTimeline->category, $timeline[0]->category);
    }
    public function test_should_ensure_timeline_event_contains_eventId_and_timestamp()
    {
        $tracker = new Fyipe\FyipeTracker($this->apiUrl, static::$errorTracker->_id, static::$errorTracker->key);
        $tracker->addToTimeline(static::$customTimeline->category, static::$customTimeline->content, static::$customTimeline->type);
        $timeline = $tracker->getTimeline();
        $this->assertIsString($timeline[0]->eventId);
        $this->assertIsNumeric($timeline[0]->timestamp);
    }
    public function test_should_ensure_different_timeline_event_have_the_same_eventId() {
        $tracker = new Fyipe\FyipeTracker($this->apiUrl, static::$errorTracker->_id, static::$errorTracker->key);
        $tracker->addToTimeline(static::$customTimeline->category, static::$customTimeline->content, static::$customTimeline->type);
        $tracker->addToTimeline(static::$customTimeline->category, static::$customTimeline->content, 'error');
        $timeline = $tracker->getTimeline();
        $this->assertCount(2, $timeline); // two timeline events
        $this->assertEquals($timeline[0]->eventId, $timeline[1]->eventId); // their eventId is the same, till there is an error sent to the server
    }
    public function test_should_ensure_max_timline_cant_be_set_as_a_negative_number() {
        $options = new stdClass();
        $options->maxTimeline = -5;

        $tracker = new Fyipe\FyipeTracker($this->apiUrl, static::$errorTracker->_id, static::$errorTracker->key, [$options]);
        $tracker->addToTimeline(static::$customTimeline->category, static::$customTimeline->content, static::$customTimeline->type);
        $tracker->addToTimeline(static::$customTimeline->category, static::$customTimeline->content, 'error');
        $timeline = $tracker->getTimeline();
        $this->assertCount(2, $timeline);  // two timeline events
    }
    public function test_should_ensure_new_timeline_event_after_max_timeline_are_discarded() {
        $options = new stdClass();
        $options->maxTimeline = 2;

        $tracker = new Fyipe\FyipeTracker($this->apiUrl, static::$errorTracker->_id, static::$errorTracker->key, [$options]);

        $customTimeline2 = new stdClass();
        $customTimeline2->category = 'logout';
        $customTimeline2->type = 'success';
        $content = new stdClass();
        $content->message = 'test-content';
        $customTimeline2->content = $content;

        // add 3 timelinee events
        $tracker->addToTimeline(static::$customTimeline->category, static::$customTimeline->content, static::$customTimeline->type);
        $tracker->addToTimeline($customTimeline2->category, $customTimeline2->content, $customTimeline2->type);
        $tracker->addToTimeline(static::$customTimeline->category, static::$customTimeline->content, 'debug');

        $timeline = $tracker->getTimeline();
        
        $this->assertEquals(sizeof($timeline), $options->maxTimeline);
        $this->assertEquals($timeline[0]->type, static::$customTimeline->type);
        $this->assertEquals($timeline[1]->category, $customTimeline2->category);
    }
    public function test_should_add_tags() {
        $tracker = new Fyipe\FyipeTracker($this->apiUrl, static::$errorTracker->_id, static::$errorTracker->key);
        $tag = new stdClass();
        $tag->key = 'location';
        $tag->value = 'Ontario';
        $tracker->setTag($tag->key, $tag->value);
        
        $availableTags = $tracker->getTags();
        $this->assertIsArray($availableTags);
        $this->assertCount(1, $availableTags);
        $this->assertEquals($tag->key, $availableTags[0]->key);
    }
    public function test_should_add_multiple_tags() {
        
        $tracker = new Fyipe\FyipeTracker($this->apiUrl, static::$errorTracker->_id, static::$errorTracker->key);
        $tags = [];
        $tag = new stdClass();
        $tag->key = 'location';
        $tag->value = 'Ontario';
        array_push($tags, $tag);

        $tagB = new stdClass();
        $tagB->key = 'city';
        $tagB->value = 'Houston';
        array_push($tags, $tagB);

        $tagC = new stdClass();
        $tagC->key = 'device';
        $tagC->value = 'iPhone';
        array_push($tags, $tagC);

        $tracker->setTags($tags);

        $availableTags = $tracker->getTags();
        $this->assertIsArray($availableTags);
        $this->assertCount(sizeof($tags), $availableTags);
    }
    public function test_should_overwrite_existing_keys_to_avoid_duplicate_tags() {
        $tracker = new Fyipe\FyipeTracker($this->apiUrl, static::$errorTracker->_id, static::$errorTracker->key);
        $tags = [];
        $tag = new stdClass();
        $tag->key = 'location';
        $tag->value = 'Ontario';
        array_push($tags, $tag);

        $tagB = new stdClass();
        $tagB->key = 'city';
        $tagB->value = 'Houston';
        array_push($tags, $tagB);

        $tagC = new stdClass();
        $tagC->key = 'location';
        $tagC->value = 'Paris';
        array_push($tags, $tagC);

        $tagD = new stdClass();
        $tagD->key = 'device';
        $tagD->value = 'iPhone';
        array_push($tags, $tagD);

        $tagE = new stdClass();
        $tagE->key = 'location';
        $tagE->value = 'London';
        array_push($tags, $tagE);

        $tracker->setTags($tags);

        $availableTags = $tracker->getTags();
        $this->assertIsArray($availableTags);
        $this->assertCount(3, $availableTags); // only 3 unique tags
        $this->assertEquals($tagE->key, $availableTags[0]->key);
        $this->assertEquals($tagE->value, $availableTags[0]->value); // latest value for that tag location
    }
    public function test_should_create_fingerprint_as_message_for_error_capture_without_any_fingerprint() {
        $tracker = new Fyipe\FyipeTracker($this->apiUrl, static::$errorTracker->_id, static::$errorTracker->key);

        $errorMessage = 'Uncaught Exception';
        $tracker->captureMessage($errorMessage);
        $event = $tracker->getCurrentEvent();
        $this->assertEquals($event->fingerprint[0], $errorMessage);
    }
    public function test_should_use_defined_fingerprint_array_for_error_capture_with_fingerprint() {
        $tracker = new Fyipe\FyipeTracker($this->apiUrl, static::$errorTracker->_id, static::$errorTracker->key);

        
        $fingerprints = ['custom', 'errors'];
        $tracker->setFingerPrint($fingerprints);
        $errorMessage = 'Uncaught Exception';
        $tracker->captureMessage($errorMessage);
        $event = $tracker->getCurrentEvent();
        $this->assertEquals($event->fingerprint[0], $fingerprints[0]);
        $this->assertEquals($event->fingerprint[1], $fingerprints[1]);
    }
    public function test_should_use_defined_fingerprint_string_for_error_capture_with_fingerprint() {
        $tracker = new Fyipe\FyipeTracker($this->apiUrl, static::$errorTracker->_id, static::$errorTracker->key);

        $fingerprint = 'custom-fingerprint';
        $tracker->setFingerPrint($fingerprint);
        $errorMessage = 'Uncaught Exception';
        $tracker->captureMessage($errorMessage);
        $event = $tracker->getCurrentEvent();
        $this->assertEquals($event->fingerprint[0], $fingerprint);
    }
    public function test_should_create_an_event_ready_for_the_server_using_capture_message() {
        $tracker = new Fyipe\FyipeTracker($this->apiUrl, static::$errorTracker->_id, static::$errorTracker->key);

        $errorMessage = 'This is a test';
        $tracker->captureMessage($errorMessage);
        $event = $tracker->getCurrentEvent();
        $this->assertEquals($event->type, 'message');
        $this->assertEquals($event->exception->message, $errorMessage);
    }
    public function test_should_create_an_event_ready_for_the_server_while_having_the_timeline_with_same_event_id() {
        $tracker = new Fyipe\FyipeTracker($this->apiUrl, static::$errorTracker->_id, static::$errorTracker->key);
        $tracker->addToTimeline(static::$customTimeline->category, static::$customTimeline->content, static::$customTimeline->type);
        
        $errorMessage = 'This is a test';
        $tracker->captureMessage($errorMessage);
        $event = $tracker->getCurrentEvent();

        $this->assertCount(1, $event->timeline);
        $this->assertEquals($event->eventId, $event->timeline[0]->eventId);
        $this->assertEquals($event->exception->message, $errorMessage);
    }
    public function test_should_create_an_event_ready_for_the_server_using_capture_exception() {
        $tracker = new Fyipe\FyipeTracker($this->apiUrl, static::$errorTracker->_id, static::$errorTracker->key);

        $errorMessage = 'Error Found';
        $tracker->captureException(new Error($errorMessage));
        $event = $tracker->getCurrentEvent();
        $this->assertEquals($event->type, 'exception');
        $this->assertEquals($event->exception->message, $errorMessage);
    }
    public function test_should_create_an_event_with_array_of_stacktrace() {
        $tracker = new Fyipe\FyipeTracker($this->apiUrl, static::$errorTracker->_id, static::$errorTracker->key);

        $errorMessage = 'Error Found';
        $tracker->captureException(new Error($errorMessage));
        $event = $tracker->getCurrentEvent();
        $this->assertEquals($event->type, 'exception');
        $this->assertEquals($event->exception->message, $errorMessage);
        $this->assertIsObject($event->exception->stacktrace);
        $this->assertIsArray($event->exception->stacktrace->frames);
    }
    public function test_should_create_an_event_with_the_object_of_the_stacktrace_in_place() {
        $tracker = new Fyipe\FyipeTracker($this->apiUrl, static::$errorTracker->_id, static::$errorTracker->key);

        $errorMessage = 'Error Found';
        $tracker->captureException(new Error($errorMessage));
        $event = $tracker->getCurrentEvent();
        $frame = $event->exception->stacktrace->frames[0];
        $this->assertArrayHasKey('methodName', $frame);
        $this->assertArrayHasKey('lineNumber', $frame);
        $this->assertArrayHasKey('fileName', $frame);
    }
    public function test_should_create_an_event_and_new_event_should_have_different_id() {
        $tracker = new Fyipe\FyipeTracker($this->apiUrl, static::$errorTracker->_id, static::$errorTracker->key);
        $errorMessage = 'Error Found';
        $errorMessageObj = 'Object Error Found';
        $tracker->addToTimeline(static::$customTimeline->category, static::$customTimeline->content, static::$customTimeline->type);
        $event = $tracker->captureMessage($errorMessage);
        $tracker->addToTimeline(static::$customTimeline->category, static::$customTimeline->content, static::$customTimeline->type);
        $newEvent = $tracker->captureException(new Error($errorMessageObj));
        // ensure that the first event have a type message, same error message
        $this->assertEquals($event->type, 'message');
        $this->assertEquals($event->content->message, $errorMessage);

        // ensure that the second event have a type exception, same error message
        $this->assertEquals($newEvent->type, 'exception');
        $this->assertEquals($newEvent->content->message, $errorMessageObj);

        // confim their eventId is different
        $this->assertNotEquals($event->_id, $newEvent->_id);
    }
    public function test_should_create_an_event_that_has_timeline_and_new_event_having_timeline_and_tags() {
        $tracker = new Fyipe\FyipeTracker($this->apiUrl, static::$errorTracker->_id, static::$errorTracker->key);
        $errorMessage = 'Error Found';
        $errorMessageObj = 'Object Error Found';
        // add timeline to first tracker
        $tracker->addToTimeline(static::$customTimeline->category, static::$customTimeline->content, static::$customTimeline->type);
        $event = $tracker->captureMessage($errorMessage);

        // add timeline and tag to second tracker
        $tracker->addToTimeline(static::$customTimeline->category, static::$customTimeline->content, static::$customTimeline->type);
        $tag = new stdClass();
        $tag->key = 'platform';
        $tag->value = 'Twitter';
        $tracker->setTag($tag->key, $tag->value);
        $newEvent = $tracker->captureException(new Error($errorMessageObj));

        // ensure that the first event have a type message, same error message and one timeline
        $this->assertEquals($event->type, 'message');
        $this->assertEquals($event->content->message, $errorMessage);
        $this->assertCount(1, $event->timeline);
        $this->assertCount(1, $event->tags); // the default event tag added

        // ensure that the second event have a type exception, same error message and 2 tags
        $this->assertEquals($newEvent->type, 'exception');
        $this->assertEquals($newEvent->content->message, $errorMessageObj);
        $this->assertCount(1, $newEvent->timeline);
        $this->assertCount(2, $newEvent->tags);// the default and custom tag
    }
    public function test_should_contain_version_number_and_sdk_name_in_captured_message() {
        $tracker = new Fyipe\FyipeTracker($this->apiUrl, static::$errorTracker->_id, static::$errorTracker->key);
        $errorMessage = 'Error Found';
        $tracker->captureMessage($errorMessage);
        $event = $tracker->getCurrentEvent();

        $this->assertIsString($event->sdk->name);
        $this->assertRegExp('/(([0-9])+\.([0-9])+\.([0-9])+)/', $event->sdk->version ); // confirm that the versiion follows the patter XX.XX.XX where X is a non negative integer
    }
    public function test_should_add_code_capture_to_stack_trace_when_flag_is_passed_in_options() {
        $options = new stdClass();
        $options->captureCodeSnippet = true;
        $tracker = new Fyipe\FyipeTracker($this->apiUrl, static::$errorTracker->_id, static::$errorTracker->key, [$options]);

        $errorMessageObj = 'Object Error Found';
        $tracker->addToTimeline(static::$customTimeline->category, static::$customTimeline->content, static::$customTimeline->type);
        $event = $tracker->captureException(new Error($errorMessageObj));
        $incidentFrame = $event->content->stacktrace->frames[0];
        $this->assertObjectHasAttribute('linesBeforeError', $incidentFrame);
        $this->assertObjectHasAttribute('linesAfterError', $incidentFrame);
        $this->assertObjectHasAttribute('errorLine', $incidentFrame);
    }
    public function test_should_add_code_capture_and_confirm_data_type_of_fields_added_to_frame() {
        $options = new stdClass();
        $options->captureCodeSnippet = true;
        $tracker = new Fyipe\FyipeTracker($this->apiUrl, static::$errorTracker->_id, static::$errorTracker->key, [$options]);

        $errorMessageObj = 'Object Error Found';
        $tracker->addToTimeline(static::$customTimeline->category, static::$customTimeline->content, static::$customTimeline->type);
        $event = $tracker->captureException(new Error($errorMessageObj));
        $incidentFrame = $event->content->stacktrace->frames[0];

        $this->assertIsString($incidentFrame->errorLine);
        $this->assertIsArray($incidentFrame->linesBeforeError);
        $this->assertIsArray($incidentFrame->linesAfterError);
    }
    public function test_should_not_add_code_capture_to_stack_trace_when_flag_is_passed_in_options() {
        $options = new stdClass();
        $options->captureCodeSnippet = false;
        $tracker = new Fyipe\FyipeTracker($this->apiUrl, static::$errorTracker->_id, static::$errorTracker->key, [$options]);

        $errorMessageObj = 'Object Error Found';
        $tracker->addToTimeline(static::$customTimeline->category, static::$customTimeline->content, static::$customTimeline->type);
        $event = $tracker->captureException(new Error($errorMessageObj));
        $incidentFrame = $event->content->stacktrace->frames[0];

        $this->assertObjectNotHasAttribute('linesBeforeError', $incidentFrame);
        $this->assertObjectNotHasAttribute('linesAfterError', $incidentFrame);
        $this->assertObjectNotHasAttribute('errorLine', $incidentFrame);
    }
    public function test_should_add_code_capture_to_stack_trace_by_default_when_unwanted_flag_is_passed_in_options() {
        $options = new stdClass();
        $options->captureCodeSnippet = "hello"; // sdk expects a true or false but it defaults to true if wrong value is sent
        $tracker = new Fyipe\FyipeTracker($this->apiUrl, static::$errorTracker->_id, static::$errorTracker->key, [$options]);

        $errorMessageObj = 'Object Error Found';
        $tracker->addToTimeline(static::$customTimeline->category, static::$customTimeline->content, static::$customTimeline->type);
        $event = $tracker->captureException(new Error($errorMessageObj));
        $incidentFrame = $event->content->stacktrace->frames[0];
        $this->assertObjectHasAttribute('linesBeforeError', $incidentFrame);
        $this->assertObjectHasAttribute('linesAfterError', $incidentFrame);
        $this->assertObjectHasAttribute('errorLine', $incidentFrame);
    }
}
