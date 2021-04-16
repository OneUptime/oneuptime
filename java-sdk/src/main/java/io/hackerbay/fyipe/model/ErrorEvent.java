package io.hackerbay.fyipe.model;

import java.util.ArrayList;

public class ErrorEvent {
    private String type;
    private ArrayList<Timeline> timeline;
    private StackTrace exception;
    private String eventId;
    private ArrayList<Tag> tags;
    private ArrayList<String> fingerprint;
    private String errorTrackerKey;
    private SDK sdk;

    public ErrorEvent(String type, ArrayList<Timeline> timeline, StackTrace exception, String eventId, ArrayList<Tag> tags, ArrayList<String> fingerPrint, String errorTrackerKey, SDK sdk) {
        this.type = type;
        this.timeline = timeline;
        this.exception = exception;
        this.eventId = eventId;
        this.tags = tags;
        this.fingerprint = fingerPrint;
        this.errorTrackerKey = errorTrackerKey;
        this.sdk = sdk;
    }

    public String getType() {
        return type;
    }

    public ArrayList<Timeline> getTimeline() {
        return timeline;
    }

    public StackTrace getException() {
        return exception;
    }

    public String getEventId() {
        return eventId;
    }

    public ArrayList<Tag> getTags() {
        return tags;
    }

    public ArrayList<String> getFingerPrint() {
        return fingerprint;
    }

    public String getErrorTrackerKey() {
        return errorTrackerKey;
    }

    public SDK getSdk() {
        return sdk;
    }

    @Override
    public String toString() {
        return "ErrorEvent{" +
                "type='" + type + '\'' +
                ", timeline=" + timeline +
                ", exception=" + exception +
                ", eventId='" + eventId + '\'' +
                ", tags=" + tags +
                ", fingerPrint=" + fingerprint +
                ", errorTrackerKey='" + errorTrackerKey + '\'' +
                ", sdk=" + sdk +
                '}';
    }
}
