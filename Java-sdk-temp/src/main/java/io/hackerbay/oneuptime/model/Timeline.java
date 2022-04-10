package io.hackerbay.oneuptime.model;

import com.google.gson.JsonObject;

public class Timeline {
    private String category;
    private JsonObject data;
    private String type;
    private long time;
    private String eventId;

    public Timeline(String category, JsonObject data, String type) {
        this.category = category;
        this.data = data;
        this.type = type;
    }

    public String getCategory() {
        return category;
    }

    public void setCategory(String category) {
        this.category = category;
    }

    public JsonObject getData() {
        return data;
    }

    public void setData(JsonObject data) {
        this.data = data;
    }

    public String getType() {
        return type;
    }

    public void setType(String type) {
        this.type = type;
    }

    public long getTime() {
        return time;
    }

    public void setTime(long time) {
        this.time = time;
    }

    public String getEventId() {
        return eventId;
    }

    public void setEventId(String eventId) {
        this.eventId = eventId;
    }

    @Override
    public String toString() {
        return "Timeline{" +
                "category='" + category + '\'' +
                ", data=" + data +
                ", type='" + type + '\'' +
                ", time=" + time +
                ", eventId='" + eventId + '\'' +
                '}';
    }
}
