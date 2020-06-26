package test.java.com.hackerbay.fyipe;

import com.google.gson.JsonObject;
import main.java.com.hackerbay.fyipe.Logger;
import org.junit.Test;

import java.io.IOException;

import static org.junit.Assert.assertEquals;

public class LoggerTest {
    private final String apiUrl = "http://localhost:3002/api/";
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
    }

}
