package io.hackerbay.fyipe;

import com.google.gson.JsonObject;
import io.hackerbay.fyipe.model.Tag;
import io.hackerbay.fyipe.model.Timeline;
import io.hackerbay.fyipe.model.TrackerOption;

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
}
