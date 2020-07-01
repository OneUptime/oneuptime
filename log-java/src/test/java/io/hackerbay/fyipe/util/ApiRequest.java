package com.hackerbay.fyipe.util;

import com.google.gson.JsonObject;

import java.io.IOException;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;

public class ApiRequest {
    private final String apiUrl;

    public ApiRequest(String apiUrl) {
        this.apiUrl = apiUrl;
    }

    public JsonObject makeApiRequest(String endpoint, String jsonBody, String token) throws IOException {

        URL url = new URL(this.apiUrl + endpoint);
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setRequestMethod("POST");
        connection.setRequestProperty("Content-Type", "application/json; charset=UTF-8");
        connection.setRequestProperty("Authorization", "Basic "+token);
        connection.setDoOutput(true);

        try (OutputStream outputStream = connection.getOutputStream()) {
            outputStream.write(jsonBody.getBytes());
            outputStream.flush();
        }

        return ResponseBuilder.getFullResponse(connection);
    }
}
