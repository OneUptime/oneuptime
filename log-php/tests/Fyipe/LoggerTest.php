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
    private $applicationLogId = '5ee8d7cc8701d678901ab908';
    private $applicationLogKey = 'key';
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
        $logger = new Fyipe\Logger($this->apiUrl, $this->applicationLogId, $this->applicationLogKey);
        $response = $logger->log('content');
        $this->assertEquals("Application Log does not exist.", $response->message);
    }
}