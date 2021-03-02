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
}
