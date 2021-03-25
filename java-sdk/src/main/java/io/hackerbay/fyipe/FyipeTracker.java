package io.hackerbay.fyipe;

import com.google.gson.JsonObject;
import io.hackerbay.fyipe.model.*;
import io.hackerbay.fyipe.util.ParameterStringBuilder;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Iterator;

public class FyipeTracker {
    private String apiUrl;
    private String errorTrackerId;
    private String errorTrackerKey;
    private TrackerOption options;
    private int MAX_ITEMS_ALLOWED_IN_STACK = 100;
    private Util util;
    private String eventId;
    private FyipeListener fyipeListener;
    private ArrayList<Tag> tags = new ArrayList<Tag>();
    private ArrayList<String> fingerprint = new ArrayList<String>();
    private SDK sdk;
    private ErrorEvent errorEvent;

    public FyipeTracker(String apiUrl, String errorTrackerId, String errorTrackerKey) {
        this(apiUrl, errorTrackerId, errorTrackerKey, null);
    }
    public FyipeTracker(String apiUrl, String errorTrackerId, String errorTrackerKey,  TrackerOption options) {
        this.errorTrackerId = errorTrackerId;
        this.errorTrackerKey = errorTrackerKey;
        this.setApiUrl(apiUrl);
        // set up options
        this.setUpOptions(options);
        util = new Util(this.options);
        this.setEventId();

        // Initialize Listener for timeline
        this.fyipeListener = new FyipeListener(this.getEventId(), this.options);

        // TODO set up transporter
        // TODO set up error listener
    }

    private void setApiUrl(String apiUrl){
        this.apiUrl = apiUrl + "/error-tracker/" + this.errorTrackerId + "/track";
    }

    private void setUpOptions(TrackerOption options) {
        if(options == null) {
            // If no options is passed, the default option is set
            // set maxTimeline and captureCodeSnippet
            TrackerOption defaultOption = new TrackerOption(5, true);
            this.options = defaultOption;
        } else {
            // in the passed options, we validate the expected fields
            // If user max timeline is less than 1 or greater than allowed max, set default for the user
            if (options.getMaxTimeline() < 1 || options.getMaxTimeline() > this.MAX_ITEMS_ALLOWED_IN_STACK ) {
                options.setMaxTimeline(5);
            }
            this.options = options;
        }
     }
    private void setEventId() {
        this.eventId = this.util.generateV4EventId();
    }
    private String getEventId()
    {
        return this.eventId;
    }
    public void addToTimeline(String category, JsonObject content, String type) {
        Timeline timeline = new Timeline(category, content, type);

        this.fyipeListener.logCustomTimelineEvent(timeline);
    }
    public ArrayList<Timeline> getTimeline() {
        return this.fyipeListener.getTimeline();
    }
    public void setTag(Tag newTag) {
        Iterator<Tag> tagIterator = this.tags.iterator();
        Tag existingTag = null;
        // find if tag exist with that key
        while (tagIterator.hasNext()) { // O(n)
            Tag currentTag = tagIterator.next();
            if(currentTag.getKey() == newTag.getKey()) {
                existingTag = currentTag;
                break;
            }
        }
        if(existingTag != null) {
            // replace existing tag
            this.tags.set(this.tags.indexOf(existingTag), newTag);
        } else {
            // add new tag
            this.tags.add(newTag);
        }
    }
    public void setTags(ArrayList<Tag> tags) {
        Iterator<Tag> tagIterator = tags.iterator();
        while (tagIterator.hasNext()) {
            this.setTag(tagIterator.next());
        }
    }
    public ArrayList<Tag> getTags() {
        return this.tags;
    }
    public void setFingerprint(String value) {
        this.fingerprint.clear(); // clear existing fingerprint
        // set string as fingerprint
        this.fingerprint.add(value);
    }
    public void setFingerprint(ArrayList<String> value) {
        // replace fingerprint array with the new passed array of strings
        this.fingerprint = value;
    }
    public ArrayList<String> getFingerprint(String errorMessage) {
        // if no fingerprint exist currently
        if (this.fingerprint.size() < 1) {
            // set up finger print based on error since none exist
            this.setFingerprint(errorMessage);
        }
        return this.fingerprint;
    }
    public void captureMessage(String message) {
        this.setTag(new Tag("handled","true"));
        StackTrace messageStackTrace = new StackTrace(message);

        this.prepareErrorEvent(ErrorObjectType.message.name(), messageStackTrace);
    }
    public void prepareErrorEvent(String type, StackTrace errorStackTrace) {
        JsonObject obj = new JsonObject();
        obj.addProperty("message", errorStackTrace.getMessage());
        // set a last timeline as the error message
        this.fyipeListener.logErrorEvent(obj, type);
        // get current timeline
        ArrayList<Timeline> timeline = this.getTimeline();

        ArrayList<Tag> tags = this.getTags();
        ArrayList<String> fingerPrint = this.getFingerprint(errorStackTrace.getMessage());
        // get event ID
        // prepare the event so it can be sent to the server
        this.errorEvent = new ErrorEvent(
                type,
                timeline,
                errorStackTrace,
                this.getEventId(),
                tags,
                fingerPrint,
                this.errorTrackerKey,
                this.getSdk()
        );
        System.out.println(this.errorEvent);
    }

    public SDK getSdk() {
        return sdk;
    }

    public void setSdk(SDK sdk) {
        // TODO proper setting of SDK
    }
    public ErrorEvent getCurrentEvent() {
        return errorEvent;
    }
    private JsonObject sendErrorEventToServer() throws IOException {
        FyipeTransport apiTransport = new FyipeTransport(this.apiUrl);
        String errorEventBody = ParameterStringBuilder.getErrorEventRequestString(this.getCurrentEvent());
        JsonObject response = apiTransport.sendErrorEventToServer(errorEventBody);

        // generate a new event Id
        this.setEventId();
        // clear the timeline after a successful call to the server
        this.clear(this.getEventId());

        return response;
    }

    private void clear(String newEventId)
    {
        // clear tags
        this.tags.clear();
        // clear fingerprint
        this.fingerprint.clear();
        // clear timeline
        this.fyipeListener.clearTimeline(newEventId);
    }
}
