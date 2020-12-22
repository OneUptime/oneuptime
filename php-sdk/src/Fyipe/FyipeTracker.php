<?php

/**
 * @author bunday
 */

namespace Fyipe;

use stdClass;
use Util\UUID;

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

    private $configKeys = ['baseUrl', 'maxTimeline'];
    private $MAX_ITEMS_ALLOWED_IN_STACK = 100;
    private $eventId;
    private $tags = [];

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
        $this->setEventId();
    }

    private function setApiUrl(String $apiUrl): void
    {
        $this->apiUrl = $apiUrl . '/error-tracker/' . $this->errorTrackerId . '/track';
    }

    private function setUpOptions($options)
    {
        foreach ($options as $option) {
            // proceed with current key if it is not in the config keys
            if (in_array($option['key'], $this->configKeys)) {
                // set max timeline properly after checking conditions
                if (
                    $option['key'] == 'maxTimeline' &&
                    ($option['value'] > $this->MAX_ITEMS_ALLOWED_IN_STACK || $option['value'] < 1)
                ) {
                    $this->options['key'] = $this->MAX_ITEMS_ALLOWED_IN_STACK;
                } else {
                    $this->options['key'] = $options['value'];
                }
            }
        }
    }
    private function setEventId() {
        $this->eventId = UUID::v4();
    }
    private function getEventId() {
        return $this->eventId;
    }
    private function setTag($key, $value) {
        if (!(is_string($key) || is_string($value))) {
            throw new \Exception("Invalid Tag");
        }
        $exist = false;
        foreach ($this->tags as $tag) {
            if($tag->key === $key) {
                // set the round flag
                $exist = true;
                // replace value if it exist
                $tag->value = $value;
                break;
            }
        }
        if(!$exist) {
            // push key and value if it doesnt
            $tag = new stdClass();
            $tag->key = $key;
            $tag->value = $value;
            array_push($this->tags, $tag);
        }

    }
    private function setTags($tags) {
        if (!is_array($tags)) {
            throw new \Exception("Invalid Tags");
        }
        foreach($tags as $element) {
            if(!is_null($element->key) && !is_null($element->value)) {
                $this->setTag($element->key, $element->key);
            }
        }
    }
    private function getTags() {
        return $this->tags;
    }
}
