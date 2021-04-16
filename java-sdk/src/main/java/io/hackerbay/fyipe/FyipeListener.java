package io.hackerbay.fyipe;

import com.google.gson.JsonObject;
import io.hackerbay.fyipe.model.Timeline;
import io.hackerbay.fyipe.model.TrackerOption;

import java.util.ArrayList;

public class FyipeListener {
    private String currentEventId;
    private Util util;
    private FyipeTimelineManager fyipeTimelineManager;

    public FyipeListener(String currentEventId, TrackerOption options) {
        this.fyipeTimelineManager = new FyipeTimelineManager(options);
        this.currentEventId = currentEventId;
        this.util = new Util(options);
    }
    public void logErrorEvent(JsonObject content, String category){
        Timeline timeline = new Timeline(category, content, ErrorEventType.error.name());
        timeline.setEventId(this.currentEventId);

        this.fyipeTimelineManager.addItemToTimeline(timeline);
    }
    public void logCustomTimelineEvent(Timeline timelineObj) {
        timelineObj.setEventId(this.currentEventId);

        // add timeline to the stack
        this.fyipeTimelineManager.addItemToTimeline(timelineObj);
    }
    public ArrayList<Timeline> getTimeline() {
        // this always get the current state of the timeline array list
        return this.fyipeTimelineManager.getTimeline();
    }
    public void clearTimeline(String eventId) {
        // set a new eventId
        this.currentEventId = eventId;
        // this will reset the state of the timeline array list
        this.fyipeTimelineManager.clearTimeline();
    }
}
