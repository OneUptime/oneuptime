package com.hackerbay.fyipe.util;

import com.google.gson.Gson;
import com.hackerbay.fyipe.model.StringLog;

public class ParameterStringBuilder {
    public static String getRequestString(String applicationLogKey, String content, String logType) {
        StringLog log = new StringLog(applicationLogKey, logType, content);
        String jsonBody = new Gson().toJson(log);
        return jsonBody;
    }
}
