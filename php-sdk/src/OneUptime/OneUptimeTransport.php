<?php

/**
 * @author bunday
 */

namespace OneUptime;

class OneUptimeTransport
{
    private $apiUrl;
    public function __construct($apiUrl)
    {
        $this->apiUrl = $apiUrl;
    }
    public function sendErrorEventToServer($event)
    {
        $response = $this->makeApiRequest($event);
        return $response;
    }
    private function makeApiRequest($body): \stdClass
    {
        // make api request and return response
        $client = new \GuzzleHttp\Client(['base_uri' => $this->apiUrl]);
        try {
            $response = $client->request('POST', '',  ['form_params' => $body]);

            $responseBody = json_decode($response->getBody()->getContents());
            return $responseBody;
        } catch (\GuzzleHttp\Exception\ClientException $e) {
            $exception = (string) $e->getResponse()->getBody();
            $exception = json_decode($exception);
            return $exception;
        }
    }
}
