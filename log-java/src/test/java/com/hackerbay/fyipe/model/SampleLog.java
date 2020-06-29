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

    public String getPage() {
        return page;
    }

    public void setPage(String page) {
        this.page = page;
    }

    public int getTime() {
        return time;
    }

    public void setTime(int time) {
        this.time = time;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
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
