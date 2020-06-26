package main.java.com.hackerbay.fyipe.model;

public class StringLog {
    private String content;
    private String applicationLogKey;
    private String type;

    public StringLog(String content, String applicationLogKey, String type) {
        this.content = content;
        this.applicationLogKey = applicationLogKey;
        this.type = type;
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

    @Override
    public String toString() {
        return "StringLog{" +
                "content='" + content + '\'' +
                ", applicationLogKey='" + applicationLogKey + '\'' +
                ", type='" + type + '\'' +
                '}';
    }
}
