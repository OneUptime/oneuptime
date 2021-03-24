package io.hackerbay.fyipe;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import io.hackerbay.fyipe.model.*;
import io.hackerbay.fyipe.util.ApiRequest;
import org.junit.Before;
import org.junit.Test;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Random;

import static org.junit.Assert.*;

public class FyipeTrackerTest {
    private final String apiUrl = "http://localhost:3002/api";
    private String errorTrackerId = "";
    private String errorTrackerKey = "";
    private Timeline sampleTimeline;

    @Before
    public void setUp() throws Exception {
        ApiRequest apiRequest = new ApiRequest(this.apiUrl);
        Random random = new Random();
        int num = random.nextInt( 78965);
        String email = "username" + String.valueOf(num) + "@business.com";
        SampleUser user = new SampleUser(
                "Travis Jones",
                email, "12345678",
                "12345678",
                "HackerBay",
                "Analyst",
                10,
                "Mastercard",
                "5555555555554444",
                "123",
                "04/2025",
                "Atlanta",
                "Atlanta",
                "1009087",
                "USA",
                "plan_GoWIYiX2L8hwzx",
                "Analyst",
                "90004322356",
                "Github");
        JsonObject response = apiRequest.makeApiRequest("/user/signup", new Gson().toJson(user), "");
        String token = response.get("tokens").getAsJsonObject().get("jwtAccessToken").getAsString();
        String projectId = response.get("project").getAsJsonObject().get("_id").getAsString();

        SampleComponent component = new SampleComponent("Component For Java Testing");
        response = apiRequest.makeApiRequest("/component/"+projectId, new Gson().toJson(component), token);
        String componentId = response.get("_id").getAsString();

        SampleComponent errorTracker = new SampleComponent("Error Tracker For Java Testing");
        response = apiRequest.makeApiRequest("/application-log/"+projectId+"/"+componentId+"/create", new Gson().toJson(errorTracker), token);
        this.errorTrackerId = response.get("_id").getAsString();
        this.errorTrackerKey = response.get("key").getAsString();
        JsonObject object = new JsonObject();
        object.addProperty("message", "random testing");
        this.sampleTimeline = new Timeline("cart", object ,ErrorEventType.info.name());
    }
    @Test
    public void itShouldTakeInCustomTimelineEvent() throws IOException {

        FyipeTracker tracker = new FyipeTracker(this.apiUrl, this.errorTrackerId, this.errorTrackerKey);
        tracker.addToTimeline(this.sampleTimeline.getCategory(), this.sampleTimeline.getData(), this.sampleTimeline.getType());
        ArrayList<Timeline> currentTimeline = tracker.getTimeline();
        assertEquals(1, currentTimeline.size());
        assertEquals(this.sampleTimeline.getCategory(), currentTimeline.get(0).getCategory());
    }
    @Test
    public void itShouldEnsureTimelineEventContainsEventIdAndTimestamp() throws IOException {
        FyipeTracker tracker = new FyipeTracker(this.apiUrl, this.errorTrackerId, this.errorTrackerKey);
        tracker.addToTimeline(this.sampleTimeline.getCategory(), this.sampleTimeline.getData(), this.sampleTimeline.getType());
        ArrayList<Timeline> currentTimeline = tracker.getTimeline();
        assertNotNull( currentTimeline.get(0).getEventId());
        assertNotNull( currentTimeline.get(0).getTime());
    }
    @Test
    public void itShouldEnsureDifferentTimelineEventHaveTheSameEventId() throws IOException {
        FyipeTracker tracker = new FyipeTracker(this.apiUrl, this.errorTrackerId, this.errorTrackerKey);
        tracker.addToTimeline(this.sampleTimeline.getCategory(), this.sampleTimeline.getData(), this.sampleTimeline.getType());
        tracker.addToTimeline(this.sampleTimeline.getCategory(), this.sampleTimeline.getData(), ErrorEventType.warning.name());
        ArrayList<Timeline> currentTimeline = tracker.getTimeline();
        assertEquals(2, currentTimeline.size());  // two timeline events
        assertEquals( currentTimeline.get(0).getEventId(), currentTimeline.get(1).getEventId()); // their eventId is the same, till there is an error sent to the server
    }
    @Test
    public void itShouldEnsureMaxTimelineCantBeSetAsANegativeNumber() throws IOException {
        TrackerOption option = new TrackerOption(-5, false);
        FyipeTracker tracker = new FyipeTracker(this.apiUrl, this.errorTrackerId, this.errorTrackerKey, option);
        tracker.addToTimeline(this.sampleTimeline.getCategory(), this.sampleTimeline.getData(), this.sampleTimeline.getType());
        tracker.addToTimeline(this.sampleTimeline.getCategory(), this.sampleTimeline.getData(), ErrorEventType.warning.name());
        ArrayList<Timeline> currentTimeline = tracker.getTimeline();
        assertEquals(2, currentTimeline.size());  // two timeline events
    }
    @Test
    public void itShouldEnsureNewTimelineEventAfterMaxTimelineAreDiscarded() throws  IOException {
        int maxTimeline = 2;
        String customCategory = "finance";
        TrackerOption option = new TrackerOption(maxTimeline, false);
        FyipeTracker tracker = new FyipeTracker(this.apiUrl, this.errorTrackerId, this.errorTrackerKey, option);

        // set up 3 timeline events
        tracker.addToTimeline(customCategory+""+this.sampleTimeline.getCategory(), this.sampleTimeline.getData(), ErrorEventType.info.name());
        tracker.addToTimeline(customCategory, this.sampleTimeline.getData(), ErrorEventType.warning.name());
        tracker.addToTimeline(this.sampleTimeline.getCategory(), this.sampleTimeline.getData(), ErrorEventType.error.name());

        // get timeline
        ArrayList<Timeline> currentTimeline = tracker.getTimeline();
        assertEquals(maxTimeline, currentTimeline.size());  // two timeline events
        assertEquals(currentTimeline.get(0).getType(), ErrorEventType.info.name()); // Info type on first
        assertEquals(currentTimeline.get(1).getCategory(), customCategory); // Custom category on second
        assertNotEquals(currentTimeline.get(0).getCategory(), this.sampleTimeline.getCategory()); //category is different from sample category
        assertNotEquals(currentTimeline.get(1).getType(), this.sampleTimeline.getType()); //type is different from sample type
    }
    @Test
    public void itShouldAddTags() throws IOException {
        FyipeTracker tracker = new FyipeTracker(this.apiUrl, this.errorTrackerId, this.errorTrackerKey);
        Tag tag = new Tag("user-type", "customer");
        tracker.setTag(tag);
        ArrayList<Tag> currentTags = tracker.getTags();
        assertEquals(1, currentTags.size());
        assertEquals(tag.getKey(), currentTags.get(0).getKey());
    }
    @Test
    public void itShouldAddMultipleTags() throws IOException {
        FyipeTracker tracker = new FyipeTracker(this.apiUrl, this.errorTrackerId, this.errorTrackerKey);
        ArrayList<Tag> sampleTags = new ArrayList<Tag>();
        sampleTags.add(new Tag("Content", "Audio"));
        sampleTags.add(new Tag("Attribute", "Beautiful"));
        sampleTags.add(new Tag("platform", "iOS"));

        tracker.setTags(sampleTags);
        ArrayList<Tag> currentTags = tracker.getTags();

        assertEquals(sampleTags.size(), currentTags.size());
    }
    @Test
    public void itShouldOverwriteExistingKeysToAvoidDuplicateTags() throws IOException {
        FyipeTracker tracker = new FyipeTracker(this.apiUrl, this.errorTrackerId, this.errorTrackerKey);
        ArrayList<Tag> sampleTags = new ArrayList<Tag>();
        Tag tagA = new Tag("Content", "Audio");
        sampleTags.add(tagA);

        Tag tagB = new Tag("location", "Warsaw");
        sampleTags.add(tagB);

        Tag tagC = new Tag("Content", "Video"); // this exist so it should overwrite
        sampleTags.add(tagC);

        Tag tagD = new Tag("platform", "Electron Desktop");
        sampleTags.add(tagD);

        Tag tagE = new Tag("location", "Kent"); // this exist so it should overwrite
        sampleTags.add(tagE);

        tracker.setTags(sampleTags);
        ArrayList<Tag> currentTags = tracker.getTags();

        assertEquals(3, currentTags.size()); // only 3 unique tags
        assertEquals(tagC.getKey(), currentTags.get(0).getKey()); // content will be key
        assertEquals(tagC.getValue(), currentTags.get(0).getValue()); // video will be value
        assertEquals(tagA.getKey(), currentTags.get(0).getKey()); // content will be key
        assertNotEquals(tagA.getValue(), currentTags.get(0).getValue()); // audio wont be the value
    }
}
