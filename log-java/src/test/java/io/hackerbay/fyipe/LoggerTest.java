package io.hackerbay.fyipe;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import io.hackerbay.fyipe.model.SampleComponent;
import io.hackerbay.fyipe.model.SampleLog;
import io.hackerbay.fyipe.model.SampleUser;
import io.hackerbay.fyipe.util.ApiRequest;
import org.junit.Before;
import org.junit.Test;

import java.io.IOException;
import java.util.Random;

import static org.junit.Assert.assertEquals;

public class LoggerTest {
    private final String apiUrl = "http://localhost:3002/api";
    private String applicationLogId = "";
    private String applicationLogKey = "";

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

        SampleComponent applicationLog = new SampleComponent("Application Log For Java Testing");
        response = apiRequest.makeApiRequest("/application-log/"+projectId+"/"+componentId+"/create", new Gson().toJson(applicationLog), token);
        this.applicationLogId = response.get("_id").getAsString();
        this.applicationLogKey = response.get("key").getAsString();
    }

    @Test
    public void itShouldRequestForApplicationLogKey() throws IOException {
        Logger logger = new Logger(this.apiUrl, this.applicationLogId, "");
        JsonObject response = logger.log("Just a content");
        assertEquals("Application Log Key is required.", response.get("message").getAsString());
    }
    @Test
    public void itShouldRequestForContent() throws IOException {
        Logger logger = new Logger(this.apiUrl, this.applicationLogId, this.applicationLogKey);
        JsonObject response = logger.log("");
        assertEquals("Content to be logged is required.", response.get("message").getAsString());
    }
    @Test
    public void itShouldRejectInvalidApplicationLog() throws IOException {
        Logger logger = new Logger(this.apiUrl, this.applicationLogId, "randomkey");
        JsonObject response = logger.log("content");
        assertEquals("Application Log does not exist.", response.get("message").getAsString());
    }
    @Test
    public void itShouldLogARequestOfTypeString() throws IOException {
        String contentToBeLogged = "I want to log this";
        Logger logger = new Logger(this.apiUrl, this.applicationLogId, this.applicationLogKey);
        JsonObject response = logger.log(contentToBeLogged);
        assertEquals(contentToBeLogged, response.get("content").getAsString());
        assertEquals("info", response.get("type").getAsString());
    }
    @Test
    public void itShouldLogARequestOfTypeObject() throws IOException {
        SampleLog contentToBeLogged = new SampleLog("Home Page", 50, "Travis");
        Logger logger = new Logger(this.apiUrl, this.applicationLogId, this.applicationLogKey);
        JsonObject response = logger.log(new Gson().toJson(contentToBeLogged));
        assertEquals(contentToBeLogged.getPage(), response.get("content").getAsJsonObject().get("page").getAsString());
        assertEquals(contentToBeLogged.getName(), response.get("content").getAsJsonObject().get("name").getAsString());
        assertEquals(contentToBeLogged.getTime(), response.get("content").getAsJsonObject().get("time").getAsInt());
        assertEquals("info", response.get("type").getAsString());
    }
    @Test
    public void itShouldLogARequestOfTypeObjectForError() throws IOException {
        SampleLog contentToBeLogged = new SampleLog("Home Page", 50, "Travis");
        Logger logger = new Logger(this.apiUrl, this.applicationLogId, this.applicationLogKey);
        JsonObject response = logger.error(new Gson().toJson(contentToBeLogged));
        assertEquals(contentToBeLogged.getPage(), response.get("content").getAsJsonObject().get("page").getAsString());
        assertEquals(contentToBeLogged.getName(), response.get("content").getAsJsonObject().get("name").getAsString());
        assertEquals(contentToBeLogged.getTime(), response.get("content").getAsJsonObject().get("time").getAsInt());
        assertEquals("error", response.get("type").getAsString());
    }
    @Test
    public void itShouldLogARequestOfTypeStringForWarning() throws IOException {
        String contentToBeLogged = "I want to log this";
        Logger logger = new Logger(this.apiUrl, this.applicationLogId, this.applicationLogKey);
        JsonObject response = logger.warning(contentToBeLogged);
        assertEquals(contentToBeLogged, response.get("content").getAsString());
        assertEquals("warning", response.get("type").getAsString());
    }
    @Test
    public void itShouldLogARequestOfTypeObjectForErrorWithATag() throws IOException {
        SampleLog contentToBeLogged = new SampleLog("Home Page", 50, "Travis");
        Logger logger = new Logger(this.apiUrl, this.applicationLogId, this.applicationLogKey);
        String [] tags = new String[1];
        tags[0] = "server";
        JsonObject response = logger.error(new Gson().toJson(contentToBeLogged), tags);
        assertEquals(contentToBeLogged.getPage(), response.get("content").getAsJsonObject().get("page").getAsString());
        assertEquals(contentToBeLogged.getName(), response.get("content").getAsJsonObject().get("name").getAsString());
        assertEquals(contentToBeLogged.getTime(), response.get("content").getAsJsonObject().get("time").getAsInt());
        assertEquals(tags[0], response.get("tags").getAsJsonArray().get(0).getAsString());
        assertEquals("error", response.get("type").getAsString());
    }
    @Test
    public void itShouldLogARequestOfTypeObjectForWarningWith3Tags() throws IOException {
        SampleLog contentToBeLogged = new SampleLog("Home Page", 50, "Travis");
        Logger logger = new Logger(this.apiUrl, this.applicationLogId, this.applicationLogKey);
        String [] tags = { "server", "content", "monitoring"};
        JsonObject response = logger.warning(new Gson().toJson(contentToBeLogged), tags);
        assertEquals(contentToBeLogged.getPage(), response.get("content").getAsJsonObject().get("page").getAsString());
        assertEquals(contentToBeLogged.getName(), response.get("content").getAsJsonObject().get("name").getAsString());
        assertEquals(contentToBeLogged.getTime(), response.get("content").getAsJsonObject().get("time").getAsInt());
        for (int i = 0; i < tags.length; i++) {
            assertEquals(tags[i], response.get("tags").getAsJsonArray().get(i).getAsString());
        }
        assertEquals("warning", response.get("type").getAsString());
    }

}
