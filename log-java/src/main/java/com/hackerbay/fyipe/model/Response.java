package main.java.com.hackerbay.fyipe.model;

public class Response {
    private String _id;
    private String type;
    private String createdAt;

    public String get_id() {
        return _id;
    }

    public void set_id(String _id) {
        this._id = _id;
    }

    public String getType() {
        return type;
    }

    public void setType(String type) {
        this.type = type;
    }

    public String getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(String createdAt) {
        this.createdAt = createdAt;
    }

    @Override
    public String toString() {
        return "Response{" +
                "_id='" + _id + '\'' +
                ", type='" + type + '\'' +
                ", createdAt='" + createdAt + '\'' +
                '}';
    }
}
