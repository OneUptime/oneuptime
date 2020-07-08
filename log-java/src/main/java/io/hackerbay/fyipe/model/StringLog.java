package io.hackerbay.fyipe.model;

import java.util.Arrays;

public class StringLog {
    private String content;
    private String applicationLogKey;
    private String type;
    private String [] tags;

    public StringLog(String applicationLogKey, String type, String content, String[] tags) {
        this.content = content;
        this.applicationLogKey = applicationLogKey;
        this.type = type;
        this.tags = tags;
    }

    public String getContent() {
        return content;
    }

    public void setContent(String content) {
        this.content = content;
    }

    public String getApplicationLogKey() {
        return applicationLogKey;
    }

    public void setApplicationLogKey(String applicationLogKey) {
        this.applicationLogKey = applicationLogKey;
    }

    public String getType() {
        return type;
    }

    public void setType(String type) {
        this.type = type;
    }

    public String[] getTags() {
        return tags;
    }

    public void setTags(String[] tags) {
        this.tags = tags;
    }

    @Override
    public String toString() {
        return "StringLog{" +
                "content='" + content + '\'' +
                ", applicationLogKey='" + applicationLogKey + '\'' +
                ", type='" + type + '\'' +
                ", tags=" + Arrays.toString(tags) +
                '}';
    }
}
