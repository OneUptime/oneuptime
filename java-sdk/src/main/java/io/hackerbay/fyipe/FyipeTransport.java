package io.hackerbay.fyipe;

import com.google.gson.JsonObject;
import io.hackerbay.fyipe.util.ResponseBuilder;

import java.io.IOException;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

public class FyipeTransport {
    private String apiUrl;

    public FyipeTransport(String apiUrl) {
        this.apiUrl = apiUrl;
    }

    public JsonObject sendErrorEventToServer(String event) throws IOException {
        JsonObject response = this.makeApiRequest(event);
        return response;
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
}
