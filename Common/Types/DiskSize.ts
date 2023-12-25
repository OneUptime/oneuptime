export default class DiskSize {
    public static byteSizeToGB(byteSize: number): number {
        return byteSize / 1024 / 1024 / 1024;
    }

    public static byteSizeToMB(byteSize: number): number {
        return byteSize / 1024 / 1024;
    }

    public static byteSizeToKB(byteSize: number): number {
        return byteSize / 1024;
    }
}