package io.hackerbay.fyipe.model;

import java.util.ArrayList;

public class StackTrace {
    private String type;
    private String message;
    private int lineNumber;
    private ArrayList<Frame> stackTraceFrame;


    public StackTrace(String message) {
        this.message = message;
    }
    public StackTrace(String type, String message, int lineNumber) {
        this.type = type;
        this.message = message;
        this.lineNumber = lineNumber;
    }

    public void setStackTraceFrame(ArrayList<Frame> stackTraceFrame) {
        this.stackTraceFrame = stackTraceFrame;
    }

    public String getMessage() {
        return message;
    }

    @Override
    public String toString() {
        return "StackTrace{" +
                "type='" + type + '\'' +
                ", message='" + message + '\'' +
                ", lineNumber=" + lineNumber +
                ", stackTraceFrame=" + stackTraceFrame +
                '}';
    }
}
