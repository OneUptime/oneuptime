package io.hackerbay.oneuptime.model;

public class TrackerOption {
    private int maxTimeline;
    /* Capture Code snippet feature is not available for now because the sdk cant
       read through the byte code generated for the application when the stack trace happens */
    private Boolean captureCodeSnippet;


    public TrackerOption(int maxTimeline) {
        this.maxTimeline = maxTimeline;
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
