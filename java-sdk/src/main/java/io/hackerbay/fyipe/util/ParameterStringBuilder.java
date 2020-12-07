package io.hackerbay.fyipe.util;

import com.google.gson.Gson;
import io.hackerbay.fyipe.model.StringLog;

public class ParameterStringBuilder {
    public static String getRequestString(String applicationLogKey, String content, String logType, String [] tags) {
        StringLog log = new StringLog(applicationLogKey, logType, content, tags);
        String jsonBody = new Gson().toJson(log);
        return jsonBody;
    }
}
