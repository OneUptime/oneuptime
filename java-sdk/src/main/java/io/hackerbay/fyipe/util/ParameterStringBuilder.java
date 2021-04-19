package io.hackerbay.fyipe.util;

import com.google.gson.Gson;
import io.hackerbay.fyipe.model.ErrorEvent;
import io.hackerbay.fyipe.model.Log;

public class ParameterStringBuilder {
    public static String getRequestString(String applicationLogKey, String content, String logType, String [] tags) {
        Log log = new Log(applicationLogKey, logType, content, tags);
        String jsonBody = new Gson().toJson(log);
        return jsonBody;
    }
    public static String getErrorEventRequestString(ErrorEvent errorEvent) {
        String jsonBody = new Gson().toJson(errorEvent);
        return jsonBody;
    }
}
