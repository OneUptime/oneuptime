<?php

/**
 * @author bunday
 */

namespace Fyipe;



class FyipeLogger
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
     * FyipeLogger constructor.
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

    private function makeApiRequest($data, String $type, $tags = null): \stdClass
    {
        // make api request and return response
        $client = new \GuzzleHttp\Client(['base_uri' => $this->apiUrl]);
        $body = [
            'content' => $data,
            'type' => $type,
            'applicationLogKey' => $this->applicationLogKey,
        ];
        if( !is_null($tags)) {
            $body['tags'] = $tags;
        }
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

    public function log($content, $tags = null): \stdClass
    {
        if (!(is_object($content) || is_string($content))) {
            throw new \Exception("Invalid Content to be logged");
        }

        if (!is_null($tags) && !(is_array($tags) || is_string($tags))) {
            throw new \Exception("Invalid Content Tags to be logged");
        }

        $logType = "info";
        return $this->makeApiRequest($content, $logType, $tags);
    }
    public function warning($content, $tags = null): \stdClass
    {
        if (!(is_object($content) || is_string($content))) {
            throw new \Exception("Invalid Content to be logged");
        }

        if (!is_null($tags) && !(is_array($tags) || is_string($tags))) {
            throw new \Exception("Invalid Content Tags to be logged");
        }

        $logType = "warning";
        return $this->makeApiRequest($content, $logType, $tags);
    }
    public function error($content, $tags = null): \stdClass
    {
        if (!(is_object($content) || is_string($content))) {
            throw new \Exception("Invalid Content to be logged");
        }

        if (!is_null($tags) && !(is_array($tags) || is_string($tags))) {
            throw new \Exception("Invalid Content Tags to be logged");
        }

        $logType = "error";
        return $this->makeApiRequest($content, $logType, $tags);
    }
}
