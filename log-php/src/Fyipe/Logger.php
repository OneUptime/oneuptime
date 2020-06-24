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

    private function setApiUrl($apiUrl) {
        $this->apiUrl = $apiUrl.'application-log/'.$this->applicationLogId.'/logs';
    }

    private function makeApiRequest($data, $type) {
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
            var_dump($responseBody);
        } catch (\Exception $e) {
            var_dump($e);
        }
    }

    public function log($content) {
        if(!is_object($content) || !is_string($content)) {
            throw new \Exception("Invalid Content to be logged");
        }

        $logType = "info";
        return $this->makeApiRequest($content, $logType);
    }


}