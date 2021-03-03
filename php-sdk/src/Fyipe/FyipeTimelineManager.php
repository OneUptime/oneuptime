<?php

/**
 * @author bunday
 */

namespace Fyipe;


class FyipeTimelineManager
{
    private $options=[];
    private $timeLineStack = [];

    /**
     * FyipeTimelineManager constructor.
     * @param array $options
     */
    public function __construct($options){
        $this->options = $options;
    }
    private function addItemToTimeline($item) {
        // get the size of the stack
        if (isset($this->options['maxTimeline']) && (sizeof($this->timeLineStack) === $this->options['maxTimeline'])) {
            return; // It discards new timline update once maximum is reached
        }
        // add time to it
        $item->timestamp = time();
        // add a new item to the stack
        array_push($this->timeLineStack, $item);
        return true;
    }
    public function addToTimeline($item) {
        $this->addItemToTimeline($item);
    }
     // return the timeline
     public function getTimeline() {
        return $this->timeLineStack;
    }
    // clear the timeline
    public function clearTimeline() {
        $this->timeLineStack = [];
    }
}