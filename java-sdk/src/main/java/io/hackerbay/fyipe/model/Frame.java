package io.hackerbay.fyipe.model;

public class Frame {
    private String methodName;
    private String lineNumber;
    private String fileName;

    public Frame(String methodName, String lineNumber, String fileName) {
        this.methodName = methodName;
        this.lineNumber = lineNumber;
        this.fileName = fileName;
    }

    @Override
    public String toString() {
        return "Frame{" +
                "methodName='" + methodName + '\'' +
                ", lineNumber='" + lineNumber + '\'' +
                ", fileName='" + fileName + '\'' +
                '}';
    }
}
