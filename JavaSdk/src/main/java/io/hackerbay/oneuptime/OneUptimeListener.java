package io.hackerbay.oneuptime;

import com.google.gson.JsonObject;
import io.hackerbay.oneuptime.model.Timeline;
import io.hackerbay.oneuptime.model.TrackerOption;

import java.util.ArrayList;

public class OneUptimeListener {
    private String currentEventId;
    private Util util;
    private OneUptimeTimelineManager oneuptimeTimelineManager;

    public OneUptimeListener(String currentEventId, TrackerOption options) {
        this.oneuptimeTimelineManager = new OneUptimeTimelineManager(options);
        this.currentEventId = currentEventId;
        this.util = new Util(options);
    }
    public void logErrorEvent(JsonObject content, String category){
        Timeline timeline = new Timeline(category, content, ErrorEventType.error.name());
        timeline.setEventId(this.currentEventId);

        this.oneuptimeTimelineManager.addItemToTimeline(timeline);
    }
    public void logCustomTimelineEvent(Timeline timelineObj) {
        timelineObj.setEventId(this.currentEventId);

        // add timeline to the stack
        this.oneuptimeTimelineManager.addItemToTimeline(timelineObj);
    }
    public ArrayList<Timeline> getTimeline() {
        // this always get the current state of the timeline array list
        return this.oneuptimeTimelineManager.getTimeline();
    }
    public void clearTimeline(String eventId) {
        // set a new eventId
        this.currentEventId = eventId;
        // this will reset the state of the timeline array list
        this.oneuptimeTimelineManager.clearTimeline();
    }
}
