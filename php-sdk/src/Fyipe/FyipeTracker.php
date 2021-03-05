<?php

/**
 * @author bunday
 */

namespace Fyipe;

use stdClass;
use Fyipe\Util;

class FyipeTracker
{
    /**
     * @var string
     */
    private $apiUrl;

    /**
     * @var string
     */
    private $errorTrackerId;

    /**
     * @var string
     */
    private $errorTrackerKey;

    private $configKeys = ['baseUrl'];
    private $MAX_ITEMS_ALLOWED_IN_STACK = 100;
    private $eventId;
    private $tags = [];
    private $fingerprint = [];
    private $listenerObj;
    private $utilObj;
    private $event;
    private $options = [
        'maxTimeline' => 5,
        'captureCodeSnippet' => true,
    ];

    /**
     * FyipeTracker constructor.
     * @param string $apiUrl
     * @param string $errorTrackerId
     * @param string $errorTrackerKey
     * @param array $options
     */
    public function __construct($apiUrl, $errorTrackerId, $errorTrackerKey, $options = [])
    {
        $this->errorTrackerId = $errorTrackerId;
        $this->setApiUrl($apiUrl);
        $this->errorTrackerKey = $errorTrackerKey;
        $this->setUpOptions($options);
        $this->utilObj = new Util($this->options);
        $this->setEventId();
        $this->listenerObj = new FyipeListener(
            $this->getEventId(),
            $this->options
        ); // Initialize Listener for timeline


        // initialize exception handler listener
        set_exception_handler(array('self', 'setUpExceptionHandlerListener'));

        // initializa error handler listener
        set_error_handler(array('self', 'setUpErrorHandler'));
    }

    private function setApiUrl(String $apiUrl): void
    {
        $this->apiUrl = $apiUrl . '/error-tracker/' . $this->errorTrackerId . '/track';
    }

    private function setUpOptions($options)
    {
        foreach ($options as $option) {
            $key = key($option);
            $value = $option->$key;
            // proceed with current key if it is not in the config keys
            if (!in_array($key, $this->configKeys)) {
                // if key is allowed in options
                if (isset($this->options[$key])) {
                    // set max timeline properly after checking conditions
                    if (
                        $key == 'maxTimeline' &&
                        ($value > $this->MAX_ITEMS_ALLOWED_IN_STACK || $value < 1)
                    ) {
                        $allowedValue =
                            $value > $this->MAX_ITEMS_ALLOWED_IN_STACK||
                            $value < 1
                                ? $this->MAX_ITEMS_ALLOWED_IN_STACK
                                : $value;
                        $this->options[$key] = $allowedValue;
                    } else if ($key === 'captureCodeSnippet') {
                        // set boolean value if boolean or set default `true` if annything other than boolean is passed
                        $this->options[$key] = is_bool($value) ? $value : true;
                    }  else {
                        $this->options[$key] = $value;
                    }
                }
            }
        }
    }
    private function setEventId()
    {
        $this->eventId = $this->utilObj->v4();
    }
    private function getEventId()
    {
        return $this->eventId;
    }
    public function setTag($key, $value)
    {
        if (!(is_string($key) || is_string($value))) {
            throw new \Exception("Invalid Tag");
        }
        $exist = false;
        foreach ($this->tags as $tag) {
            if ($tag->key === $key) {
                // set the round flag
                $exist = true;
                // replace value if it exist
                $tag->value = $value;
                break;
            }
        }
        if (!$exist) {
            // push key and value if it doesnt
            $tag = new stdClass();
            $tag->key = $key;
            $tag->value = $value;
            array_push($this->tags, $tag);
        }
    }
    public function setTags($tags)
    {
        if (!is_array($tags)) {
            throw new \Exception("Invalid Tags");
        }
        foreach ($tags as $element) {
            if (!is_null($element->key) && !is_null($element->value)) {
                $this->setTag($element->key, $element->value);
            }
        }
    }
    public function getTags()
    {
        return $this->tags;
    }
    public function setFingerPrint($key)
    {
        if (!(is_array($key) || is_string($key))) {
            throw new \Exception("Invalid Fingerprint");
        }

        $this->fingerprint = is_array($key) ? $key : [$key];
    }
    private function getFingerprint($errorMessage)
    {
        // if no fingerprint exist currently
        if (sizeof($this->fingerprint) < 1) {
            // set up finger print based on error since none exist
            $this->setFingerprint($errorMessage);
        }
        return $this->fingerprint;
    }
    private function setUpExceptionHandlerListener($exception)
    {
        // construct the error object
        $errorObj = $this->utilObj->getExceptionStackTrace($exception);

        $this->manageErrorObject($errorObj);
    }
    private function setUpErrorHandler($errno, $errstr, $errfile, $errline)
    {

        $errorObj = $this->utilObj->getErrorStackTrace($errno, $errstr, $errfile, $errline);

        $this->manageErrorObject($errorObj);
    }
    public function captureMessage($message)
    {
        // set the a handled tag
        $this->setTag('handled', 'true');
        $messageObj = new stdClass();
        $messageObj->message = $message;
        $this->prepareErrorObject('message', $messageObj);

        // send to the server
        return $this->sendErrorEventToServer();
    }
    public function captureException($exception)
    {
        // construct the error object
        $exceptionObj = $this->utilObj->getExceptionStackTrace($exception);

        // set the a handled tag
        $this->setTag('handled', 'true');

        $this->prepareErrorObject('exception', $exceptionObj);

        // send to the server
        return $this->sendErrorEventToServer();
    }
    private function manageErrorObject($errorObj)
    {
        // log error event
        $content = new stdClass();
        $content->message = $errorObj->message;

        $this->listenerObj->logErrorEvent($content);
        // set the a handled tag
        $this->setTag('handled', 'false');
        // prepare to send to server
        $this->prepareErrorObject('error', $errorObj);

        // send to the server
        return $this->sendErrorEventToServer();
    }
    public function prepareErrorObject($type, $errorStackTrace)
    {
        // get current timeline
        $timeline = $this->getTimeline();
        // TODO get device location and details
        // const deviceDetails = this.#utilObj._getUserDeviceDetails();
        $tags = $this->getTags();
        $fingerprint = $this->getFingerprint($errorStackTrace->message); // default fingerprint will be the message from the error stacktrace
        // get event ID
        // Temporary display the state of the error stack, timeline and device details when an error occur
        // prepare the event so it can be sent to the server
        $this->event = new stdClass();
        $this->event->type = $type;
        $this->event->timeline = $timeline;
        $this->event->exception = $errorStackTrace;
        $this->event->eventId = $this->getEventId();
        $this->event->tags = $tags;
        $this->event->fingerprint = $fingerprint;
        $this->event->errorTrackerKey = $this->errorTrackerKey;
        $this->event->sdk = $this->getSDKDetails();
    }
    public function addToTimeline($category, $content, $type)
    {
        $timelineObj =  new stdClass();
        $timelineObj->category = $category;
        $timelineObj->data = $content;
        $timelineObj->type = $type;
        $this->listenerObj->logCustomTimelineEvent($timelineObj);
    }
    public function getTimeline()
    {
        return $this->listenerObj->getTimeline();
    }
    private function sendErrorEventToServer()
    {
        $response = $this->makeApiRequest($this->event);
        // generate a new event Id
        $this->setEventId();
        // clear the timeline after a successful call to the server
        $this->clear($this->getEventId());
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
    public function getCurrentEvent()
    {
        return $this->event;
    }
    private function getSDKDetails()
    {
        // get the full directory path, then strip away src/Fyipe before concatenating
        $filePath = substr(__DIR__, 0, strlen(__DIR__) - 9) . "composer.json";
        $content = file_get_contents($filePath);
        $content = json_decode($content, true);

        $sdkDetail = new stdClass();
        $sdkDetail->name = $content['name'];
        $sdkDetail->version = $content['version'];
        return $sdkDetail;
    }
    private function clear($newEventId)
    {
        // clear tags
        $this->tags = [];
        // clear fingerprint
        $this->fingerprint = [];
        // clear timeline
        $this->listenerObj->clearTimeline($newEventId);
    }
}
