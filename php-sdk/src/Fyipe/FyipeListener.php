<?php

/**
 * @author bunday
 */

namespace Fyipe;

use stdClass;

class FyipeListener
{
    private $timelineObj;
    private $currentEventId;
    private $utilObj;

    /**
     * FyipeListener constructor.
     * @param string $eventId
     * @param array $options
     */
    public function __construct($eventId, $options)
    {
        // start the timeline manager
        $this->timelineObj = new FyipeTimelineManager($options);
        $this->currentEventId = $eventId;
        $this->utilObj = new Util($options);
    }
    public function logErrorEvent($content) {

        $timelineObj =  new stdClass();
        $timelineObj->category = 'exception';
        $timelineObj->data = $content;
        $timelineObj->type = $this->utilObj->getErrorType()->error;
        $timelineObj->eventId = $this->currentEventId;

        // add timeline to the stack
        $this->timelineObj->addToTimeline($timelineObj);
    }
    public function logCustomTimelineEvent($timelineObj) {
        $timelineObj->eventId = $this->currentEventId;

        // add timeline to the stack
        $this->timelineObj->addToTimeline($timelineObj);
    }
    public function getTimeline() {
        // this always get the current state of the timeline array
        return $this->timelineObj->getTimeline();
    }
    public function clearTimeline($eventId) {
        // set a new eventId
        $this->currentEventId = $eventId;
        // this will reset the state of the timeline array
        return $this->timelineObj->clearTimeline();
    }
}
