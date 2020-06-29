package test.java.com.hackerbay.fyipe;

import com.google.gson.Gson;
import com.google.gson.JsonObject;
import main.java.com.hackerbay.fyipe.Logger;
import org.junit.Test;
import test.java.com.hackerbay.fyipe.model.SampleLog;

import java.io.IOException;

import static org.junit.Assert.assertEquals;

public class LoggerTest {
    private final String apiUrl = "http://localhost:3002/api";
    private final String applicationLogId = "5ee92d5023cc0e359d45a95a";
    private final String applicationLogKey = "a3c4eb43-4a9c-426c-a8f1-e9e1a33af05f";

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

}
