package io.hackerbay.fyipe;

import io.hackerbay.fyipe.model.TrackerOption;

import java.util.UUID;
enum ErrorEventType {
    error,
    info,
    warning
}
enum ErrorObjectType {
    message,
    error,
    exception
}
public class Util {
    private TrackerOption options;

    
    public Util(TrackerOption options) {
        this.options = options;
    }
    public String generateV4EventId() {
        UUID uuid = UUID.randomUUID();
        return uuid.toString();
    }
    
}
