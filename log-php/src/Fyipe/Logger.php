<?php

/**
 * @author bunday
 */

namespace Fyipe;



class Logger
{
    /**
     * @var string
     */
    private $apiUrl;

    /**
     * @var string
     */
    private $applicationLogId;

    /**
     * @var string
     */
    private $applicationLogKey;

    /**
     * Logger constructor.
     * @param string $apiUrl
     * @param string $applicationLogId
     * @param string $applicationLogKey
     */
    public function __construct($apiUrl, $applicationLogId, $applicationLogKey)
    {
        $this->applicationLogId = $applicationLogId;
        $this->setApiUrl($apiUrl);
        $this->applicationLogKey = $applicationLogKey;
    }

    private function setApiUrl(String $apiUrl): void
    {
        $this->apiUrl = $apiUrl . '/application-log/' . $this->applicationLogId . '/log';
    }

    private function makeApiRequest($data, String $type): \stdClass
    {
        // make api request and return response
        $client = new \GuzzleHttp\Client(['base_uri' => $this->apiUrl]);
        $body = [
            'content' => $data,
            'type' => $type,
            'applicationLogKey' => $this->applicationLogKey,
        ];
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

    public function log($content): \stdClass
    {
        if (!(is_object($content) || is_string($content))) {
            throw new \Exception("Invalid Content to be logged");
        }

        $logType = "info";
        return $this->makeApiRequest($content, $logType);
    }
    public function warning($content): \stdClass
    {
        if (!(is_object($content) || is_string($content))) {
            throw new \Exception("Invalid Content to be logged");
        }

        $logType = "warning";
        return $this->makeApiRequest($content, $logType);
    }
    public function error($content): \stdClass
    {
        if (!(is_object($content) || is_string($content))) {
            throw new \Exception("Invalid Content to be logged");
        }

        $logType = "error";
        return $this->makeApiRequest($content, $logType);
    }
}
