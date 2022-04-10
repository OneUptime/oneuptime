package io.hackerbay.oneuptime.model;

public class SDK {
    private String name;
    private String version;

    public SDK(String name, String version) {
        this.name = name;
        this.version = version;
    }

    public String getName() {
        return name;
    }

    public String getVersion() {
        return version;
    }

    @Override
    public String toString() {
        return "SDK{" +
                "name='" + name + '\'' +
                ", version='" + version + '\'' +
                '}';
    }
}
