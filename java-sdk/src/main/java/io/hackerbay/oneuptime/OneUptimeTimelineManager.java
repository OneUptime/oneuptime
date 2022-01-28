package io.hackerbay.oneuptime;

import io.hackerbay.oneuptime.model.Timeline;
import io.hackerbay.oneuptime.model.TrackerOption;

import java.sql.Timestamp;
import java.util.ArrayList;

public class OneUptimeTimelineManager {
    private TrackerOption options;
    private ArrayList<Timeline> timelineStack = new ArrayList<Timeline>();
    private Timestamp timestamp = new Timestamp(System.currentTimeMillis());

    public OneUptimeTimelineManager(TrackerOption options) {
        this.options = options;
    }
    public void addItemToTimeline(Timeline item) {
        // get the size of the stack
        if(this.timelineStack.size() == this.options.getMaxTimeline()) {
            return; // It discards new timeline update once maximum is reached
        }
        // add time to the timeline item
        item.setTime(timestamp.getTime());

        // add a new item to the stack
        this.timelineStack.add(item);
        return;
    }
    public ArrayList<Timeline> getTimeline() {
        return this.timelineStack;
    }
    public void clearTimeline() {
        this.timelineStack.clear();
    }

}
