package io.hackerbay.fyipe;

import com.google.gson.JsonObject;
import io.hackerbay.fyipe.util.ParameterStringBuilder;
import io.hackerbay.fyipe.util.ResponseBuilder;

import java.io.*;
import java.net.HttpURLConnection;
import java.net.URL;

public class Logger {
    private String apiUrl;
    private final String applicationLogId;
    private final String applicationLogKey;

    public Logger(String apiUrl, String applicationLogId, String applicationLogKey) {
        this.applicationLogId = applicationLogId;
        this.setApiUrl(apiUrl);
        this.applicationLogKey = applicationLogKey;
    }

    private void setApiUrl(String apiUrl){
        this.apiUrl = apiUrl + "/application-log/" + this.applicationLogId + "/log";
    }

    private JsonObject makeApiRequest(String jsonBody) throws IOException {

        URL url = new URL(this.apiUrl);
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setRequestMethod("POST");
        connection.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
        connection.setDoOutput(true);

        try (OutputStream outputStream = connection.getOutputStream()) {
            outputStream.write(jsonBody.getBytes());
            outputStream.flush();
        }

        return ResponseBuilder.getFullResponse(connection);
    }
    public JsonObject log(String content) throws IOException {
        String [] tags = new String[1];
        return log(content,tags);
    }
    public JsonObject log(String content, String [] tags) throws IOException {
        String body = ParameterStringBuilder.getRequestString(this.applicationLogKey, content, "info", tags);
        return this.makeApiRequest(body);
    }
    public JsonObject error(String content) throws IOException {
        String [] tags = new String[1];
        return error(content,tags);
    }
    public JsonObject error(String content, String [] tags) throws IOException {
        String body = ParameterStringBuilder.getRequestString(this.applicationLogKey, content, "error", tags);
        return this.makeApiRequest(body);
    }
    public JsonObject warning(String content) throws IOException {
        String [] tags = new String[1];
        return warning(content,tags);
    }
    public JsonObject warning(String content, String [] tags) throws IOException {
        String body = ParameterStringBuilder.getRequestString(this.applicationLogKey, content, "warning", tags);
        return this.makeApiRequest(body);
    }
}
