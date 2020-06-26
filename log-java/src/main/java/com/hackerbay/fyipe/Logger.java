package main.java.com.hackerbay.fyipe;

import com.google.gson.JsonObject;
import main.java.com.hackerbay.fyipe.util.ParameterStringBuilder;
import main.java.com.hackerbay.fyipe.util.ResponseBuilder;

import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;

public class Logger {
    private String apiUrl, applicationLogId, applicationLogKey;

    public Logger(String apiUrl, String applicationLogId, String applicationLogKey) {
        this.applicationLogId = applicationLogId;
        this.setApiUrl(apiUrl);
        this.applicationLogKey = applicationLogKey;
    }

    private void setApiUrl(String apiUrl){
        this.apiUrl = apiUrl + "application-log/" + this.applicationLogId + "/log";
    }

    private JsonObject makeApiRequest(String jsonBody) throws IOException {

        URL url = new URL(this.apiUrl);
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setRequestMethod("POST");
        connection.setRequestProperty("Content-Type", "application/json");
        connection.setDoOutput(true);

        try (OutputStream outputStream = connection.getOutputStream()) {
            outputStream.write(jsonBody.getBytes());
            outputStream.flush();
        }

        JsonObject response = ResponseBuilder.getFullResponse(connection);
        return response;
    }
    public JsonObject log(String content) throws IOException {
        String body = ParameterStringBuilder.getRequestString(this.applicationLogKey, content, "info");
        return this.makeApiRequest(body);
    }
}
