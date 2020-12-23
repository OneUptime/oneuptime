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
        $this->utilObj = new Util();
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
}
