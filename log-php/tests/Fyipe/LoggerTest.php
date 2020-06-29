<?php

/**
 * @author bunday
 */

use PHPUnit\Framework\TestCase;
use Faker\Factory;


class LoggerTest extends TestCase
{
    private $apiUrl = 'http://localhost:3002/api';
    private $applicationLog;
    private $faker;
    private $header = [];

    protected function setUp(): void
    {
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

            // create an applicationlog and set it as the global application Log.
            $applicationLog = ['name' => $this->faker->words(2, true)];
            $response = $client->request('POST', '/application-log/'.$project->_id.'/'.$createdComponent->_id.'/create', [
                'headers' => $this->header, 'form_params' => $applicationLog
            ]);
            $this->applicationLog = json_decode($response->getBody()->getContents());
        } catch (Exception $e) {
            dd("Couldnt create an application log to run a test, Error occured: ".$e->getMessage());
        }
    }

    public function test_application_log_key_is_required()
    {
        $logger = new Fyipe\Logger($this->apiUrl, $this->applicationLog->_id, '');
        $response = $logger->log('test content');
        $this->assertEquals("Application Log Key is required.", $response->message);
    }
    public function test_content_is_required()
    {
        $logger = new Fyipe\Logger($this->apiUrl, $this->applicationLog->_id, $this->applicationLog->key);
        $response = $logger->log('');
        $this->assertEquals("Content to be logged is required.", $response->message);
    }
    public function test_valid_applicaiton_log_id_is_required()
    {
        $logger = new Fyipe\Logger($this->apiUrl, '5eec6f33d7d57033b3a7d502', $this->applicationLog->key);
        $response = $logger->log('content');
        $this->assertEquals("Application Log does not exist.", $response->message);
    }
    public function test_valid_string_content_of_type_info_is_logged()
    {
        $log = "sample content to be logged";
        $logger = new Fyipe\Logger($this->apiUrl, $this->applicationLog->_id, $this->applicationLog->key);
        $response = $logger->log($log);
        $this->assertEquals($log, $response->content);
        $this->assertEquals(true, is_string($response->content));
        $this->assertEquals("info", $response->type);
    }
    public function test_valid_object_content_of_type_info_is_logged()
    {
        $log = new stdClass();
        $log->name = "Travis";
        $log->location = "Atlanta";
        $logger = new Fyipe\Logger($this->apiUrl, $this->applicationLog->_id, $this->applicationLog->key);
        $response = $logger->log($log);
        $this->assertEquals($log->name, $response->content->name);
        $this->assertEquals(true, is_object($response->content));
        $this->assertEquals("info", $response->type);
    }
    public function test_valid_string_content_of_type_error_is_logged()
    {
        $log = "sample content to be logged";
        $logger = new Fyipe\Logger($this->apiUrl, $this->applicationLog->_id, $this->applicationLog->key);
        $response = $logger->error($log);
        $this->assertEquals($log, $response->content);
        $this->assertEquals(true, is_string($response->content));
        $this->assertEquals("error", $response->type);
    }
    public function test_valid_object_content_of_type_warning_is_logged()
    {
        $log = new stdClass();
        $log->name = "Travis";
        $log->location = "Atlanta";
        $logger = new Fyipe\Logger($this->apiUrl, $this->applicationLog->_id, $this->applicationLog->key);
        $response = $logger->warning($log);
        $this->assertEquals($log->name, $response->content->name);
        $this->assertEquals(true, is_object($response->content));
        $this->assertEquals("warning", $response->type);
    }
}
