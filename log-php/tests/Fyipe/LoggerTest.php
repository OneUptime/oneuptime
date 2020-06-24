<?php

/**
 * @author bunday
 */

use PHPUnit\Framework\TestCase;
use Faker\Factory;


class LoggerTest extends TestCase
{
    private $apiUrl = 'http://localhost:3002/api/';
    private $applicationLogId = "5eec6f33d7d57033b3a7d506";
    private $applicationLogKey = "23c07524-ee1f-48da-9cfd-70a3874b2682";
    private $faker;
    private $header = [];

    protected function setUp(): void
    {
        parent::setUp();
        $this->faker = Factory::create();
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

        $data = [
            'tokenId' => 'tok_visa',
            'email' => $user->email,
            'companyName' => $user->companyName
        ];
        $client = new \GuzzleHttp\Client(['base_uri' => $this->apiUrl]);
        try {
            $response = $client->request('POST', 'stripe/checkCard',  ['form_params' => $data]);
            $stripeResp = json_decode($response->getBody()->getContents());
            $stripe = new StdClass();
            $stripe->id = $stripeResp->id;
            $user->paymentIntent = $stripe;

            $response = $client->request('POST', 'user/signup',  ['form_params' => $user]);
            $createdUser = json_decode($response->getBody()->getContents());

            $token = $createdUser->tokens->jwtAccessToken;
            $this->header['Authorization'] = 'Basic ' . $token;
            $project = $createdUser->project;

            $component = ['name' => $this->faker->words(2, true)];
            $response = $client->request('POST', 'component/' . $project->_id, ['headers' => $this->header],  ['form_params' => $component]);
            $createdComponent = json_decode($response->getBody()->getContents());

            dd($createdComponent);
        } catch (Exception $e) {
            dd($e);
        }
    }

    public function test_application_log_key_is_required()
    {
        $logger = new Fyipe\Logger($this->apiUrl, $this->applicationLogId, '');
        $response = $logger->log('test content');
        $this->assertEquals("Application Log Key is required.", $response->message);
    }
    public function test_content_is_required()
    {
        $logger = new Fyipe\Logger($this->apiUrl, $this->applicationLogId, $this->applicationLogKey);
        $response = $logger->log('');
        $this->assertEquals("Content to be logged is required.", $response->message);
    }
    public function test_valid_applicaiton_log_id_is_required()
    {
        $logger = new Fyipe\Logger($this->apiUrl, '5eec6f33d7d57033b3a7d502', $this->applicationLogKey);
        $response = $logger->log('content');
        $this->assertEquals("Application Log does not exist.", $response->message);
    }
    public function test_valid_string_content_of_type_info_is_logged()
    {
        $log = "sample content to be logged";
        $logger = new Fyipe\Logger($this->apiUrl, $this->applicationLogId, $this->applicationLogKey);
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
        $logger = new Fyipe\Logger($this->apiUrl, $this->applicationLogId, $this->applicationLogKey);
        $response = $logger->log($log);
        $this->assertEquals($log->name, $response->content->name);
        $this->assertEquals(true, is_object($response->content));
        $this->assertEquals("info", $response->type);
    }
    public function test_valid_string_content_of_type_error_is_logged()
    {
        $log = "sample content to be logged";
        $logger = new Fyipe\Logger($this->apiUrl, $this->applicationLogId, $this->applicationLogKey);
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
        $logger = new Fyipe\Logger($this->apiUrl, $this->applicationLogId, $this->applicationLogKey);
        $response = $logger->warning($log);
        $this->assertEquals($log->name, $response->content->name);
        $this->assertEquals(true, is_object($response->content));
        $this->assertEquals("warning", $response->type);
    }
}
