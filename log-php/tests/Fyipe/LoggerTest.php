<?php

/**
 * @author bunday
 */
// namespace Fyipe\Tests;

use PHPUnit\Framework\TestCase;
// use Fyipe\Logger;

class LoggerTest extends TestCase
{
    private $apiUrl = 'http://localhost:3002/api/';
    private $applicationLogId = "5eec6f33d7d57033b3a7d506";
    private $applicationLogKey = "23c07524-ee1f-48da-9cfd-70a3874b2682";
    protected $logger = NULL;
	
    public function test_application_log_key_is_required() {
        $logger = new Fyipe\Logger($this->apiUrl, $this->applicationLogId, '');
        $response = $logger->log('test content');
        $this->assertEquals("Application Log Key is required.", $response->message);
    }
    public function test_content_is_required() {
        $logger = new Fyipe\Logger($this->apiUrl, $this->applicationLogId, $this->applicationLogKey);
        $response = $logger->log('');
        $this->assertEquals("Content to be logged is required.", $response->message);
    }
    public function test_valid_applicaiton_log_id_is_required() {
        $logger = new Fyipe\Logger($this->apiUrl, '5eec6f33d7d57033b3a7d502', $this->applicationLogKey);
        $response = $logger->log('content');
        $this->assertEquals("Application Log does not exist.", $response->message);
    }
    public function test_valid_string_content_of_type_info_is_logged() {
        $log = "sample content to be logged";
        $logger = new Fyipe\Logger($this->apiUrl, $this->applicationLogId, $this->applicationLogKey);
        $response = $logger->log($log);
        $this->assertEquals($log, $response->content);
        $this->assertEquals(true, is_string($response->content));
        $this->assertEquals("info", $response->type);
    }
    public function test_valid_object_content_of_type_info_is_logged() {
        $log = new stdClass();
        $log->name = "Travis";
        $log->location = "Atlanta";
        $logger = new Fyipe\Logger($this->apiUrl, $this->applicationLogId, $this->applicationLogKey);
        $response = $logger->log($log);
        $this->assertEquals($log->name, $response->content->name);
        $this->assertEquals(true, is_object($response->content));
        $this->assertEquals("info", $response->type);
    }
    public function test_valid_string_content_of_type_error_is_logged() {
        $log = "sample content to be logged";
        $logger = new Fyipe\Logger($this->apiUrl, $this->applicationLogId, $this->applicationLogKey);
        $response = $logger->error($log);
        $this->assertEquals($log, $response->content);
        $this->assertEquals(true, is_string($response->content));
        $this->assertEquals("error", $response->type);
    }
    public function test_valid_object_content_of_type_warning_is_logged() {
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