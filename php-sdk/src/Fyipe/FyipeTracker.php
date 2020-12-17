<?php

/**
 * @author bunday
 */

namespace Fyipe;



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
}
