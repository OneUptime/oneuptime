package io.hackerbay.fyipe;

import io.hackerbay.fyipe.model.TrackerOption;

public class FyipeListener {
    private String currentEventId;
    private Util util;
    private FyipeTimelineManager fyipeTimelineManager;

    public FyipeListener(String currentEventId, TrackerOption options) {
        this.fyipeTimelineManager = new FyipeTimelineManager(options);
        this.currentEventId = currentEventId;
        this.util = new Util(options);
    }
}
