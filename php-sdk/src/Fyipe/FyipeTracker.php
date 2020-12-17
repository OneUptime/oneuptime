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

    /**
     * FyipeTracker constructor.
     * @param string $apiUrl
     * @param string $errorTrackerId
     * @param string $errorTrackerKey
     */
    public function __construct($apiUrl, $errorTrackerId, $errorTrackerKey)
    {
        $this->errorTrackerId = $errorTrackerId;
        $this->setApiUrl($apiUrl);
        $this->errorTrackerKey = $errorTrackerKey;
    }

    private function setApiUrl(String $apiUrl): void
    {
        $this->apiUrl = $apiUrl . '/error-tracker/' . $this->errorTrackerId . '/track';
    }
}
