package io.hackerbay.fyipe.model;

import java.util.ArrayList;

public class ErrorEvent {
    private String type;
    private ArrayList<Timeline> timeline;
    private StackTrace exception;
    private String eventId;
    private ArrayList<Tag> tags;
    private ArrayList<String> fingerPrint;
    private String errorTrackerKey;
    private SDK sdk;

    public ErrorEvent(String type, ArrayList<Timeline> timeline, StackTrace exception, String eventId, ArrayList<Tag> tags, ArrayList<String> fingerPrint, String errorTrackerKey, SDK sdk) {
        this.type = type;
        this.timeline = timeline;
        this.exception = exception;
        this.eventId = eventId;
        this.tags = tags;
        this.fingerPrint = fingerPrint;
        this.errorTrackerKey = errorTrackerKey;
        this.sdk = sdk;
    }
}
