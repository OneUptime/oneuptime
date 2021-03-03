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

    private $customTimeline;

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
        $user->reference = 'Gitbuh';

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
        $this->customTimeline = new stdClass();
        $this->customTimeline->category = 'cart';
        $this->customTimeline->type = 'info';
        $content = new stdClass();
        $content->message = 'test-content';
        $this->customTimeline->content = $content;

        static::$ready = true;
    }

    public function test_should_take_in_custom_timeline_event()
    {
        $tracker = new Fyipe\FyipeTracker($this->apiUrl, static::$errorTracker->_id, static::$errorTracker->key);
        $tracker->addToTimeline($this->customTimeline->category, $this->customTimeline->content, $this->customTimeline->type);
        $timeline = $tracker->getTimeline();
        $this->assertIsArray($timeline);
        $this->assertCount(1, $timeline);
        $this->assertEquals($this->customTimeline->category, $timeline[0]->category);
    }
    public function test_should_ensure_timeline_event_contains_eventId_and_timestamp()
    {
        $tracker = new Fyipe\FyipeTracker($this->apiUrl, static::$errorTracker->_id, static::$errorTracker->key);
        $tracker->addToTimeline($this->customTimeline->category, $this->customTimeline->content, $this->customTimeline->type);
        $timeline = $tracker->getTimeline();
        $this->assertIsString($timeline[0]->eventId);
        $this->assertIsNumeric($timeline[0]->timestamp);
    }
    public function test_should_ensure_different_timeline_event_have_the_same_eventId() {
        $tracker = new Fyipe\FyipeTracker($this->apiUrl, static::$errorTracker->_id, static::$errorTracker->key);
        $tracker->addToTimeline($this->customTimeline->category, $this->customTimeline->content, $this->customTimeline->type);
        $tracker->addToTimeline($this->customTimeline->category, $this->customTimeline->content, 'error');
        $timeline = $tracker->getTimeline();
        $this->assertCount(2, $timeline); // two timeline events
        $this->assertEquals($timeline[0]->eventId, $timeline[1]->eventId); // their eventId is the same, till there is an error sent to the server
    }
    public function test_should_ensure_max_timline_cant_be_set_as_a_negative_number() {
        $options = new stdClass();
        $options->maxTimeline = -5;

        $tracker = new Fyipe\FyipeTracker($this->apiUrl, static::$errorTracker->_id, static::$errorTracker->key, [$options]);
        $tracker->addToTimeline($this->customTimeline->category, $this->customTimeline->content, $this->customTimeline->type);
        $tracker->addToTimeline($this->customTimeline->category, $this->customTimeline->content, 'error');
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
        $tracker->addToTimeline($this->customTimeline->category, $this->customTimeline->content, $this->customTimeline->type);
        $tracker->addToTimeline($customTimeline2->category, $customTimeline2->content, $customTimeline2->type);
        $tracker->addToTimeline($this->customTimeline->category, $this->customTimeline->content, 'debug');

        $timeline = $tracker->getTimeline();
        
        $this->assertEquals(sizeof($timeline), $options->maxTimeline);
        $this->assertEquals($timeline[0]->type, $this->customTimeline->type);
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
    public function test_should_create_an_event_ready_for_the_server() {
        $tracker = new Fyipe\FyipeTracker($this->apiUrl, static::$errorTracker->_id, static::$errorTracker->key);

        $errorMessage = 'This is a test';
        $tracker->captureMessage($errorMessage);
        $event = $tracker->getCurrentEvent();
        $this->assertEquals($event->type, 'message');
        $this->assertEquals($event->exception->message, $errorMessage);
    }
    public function test_should_create_an_event_ready_for_the_server_while_having_the_timeline_with_same_event_id() {
        $tracker = new Fyipe\FyipeTracker($this->apiUrl, static::$errorTracker->_id, static::$errorTracker->key);
        $tracker->addToTimeline($this->customTimeline->category, $this->customTimeline->content, $this->customTimeline->type);
        
        $errorMessage = 'This is a test';
        $tracker->captureMessage($errorMessage);
        $event = $tracker->getCurrentEvent();

        $this->assertCount(1, $event->timeline);
        $this->assertEquals($event->eventId, $event->timeline[0]->eventId);
        $this->assertEquals($event->exception->message, $errorMessage);
    }
}
