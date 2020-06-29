package test.java.com.hackerbay.fyipe.model;

public class SampleLog {
    private String page;
    private int time;
    private String name;

    public SampleLog(String page, int time, String name) {
        this.page = page;
        this.time = time;
        this.name = name;
    }

    @Override
    public String toString() {
        return "{" +
                "page='" + page + '\'' +
                ", time=" + time +
                ", name='" + name + '\'' +
                '}';
    }
}
