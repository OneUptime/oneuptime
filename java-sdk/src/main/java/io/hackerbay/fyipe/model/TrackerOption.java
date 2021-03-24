package io.hackerbay.fyipe.model;

public class TrackerOption {
    private int maxTimeline;
    private Boolean captureCodeSnippet;


    public TrackerOption(int maxTimeline, Boolean captureCodeSnippet) {
        this.maxTimeline = maxTimeline;
        this.captureCodeSnippet = captureCodeSnippet;
    }

    public int getMaxTimeline() {
        return maxTimeline;
    }

    public void setMaxTimeline(int maxTimeline) {
        this.maxTimeline = maxTimeline;
    }

    public Boolean getCaptureCodeSnippet() {
        return captureCodeSnippet;
    }

    public void setCaptureCodeSnippet(Boolean captureCodeSnippet) {
        this.captureCodeSnippet = captureCodeSnippet;
    }

    @Override
    public String toString() {
        return "TrackerOption{" +
                "maxTimeline=" + maxTimeline +
                ", captureCodeSnippet=" + captureCodeSnippet +
                '}';
    }
}
