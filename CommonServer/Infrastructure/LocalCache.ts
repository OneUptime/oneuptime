import Dictionary from 'Common/Types/Dictionary';

export default abstract class LocalCache {
    private static cache: Dictionary<string> = {};

    public static set(key: string, value: string): void {
        this.cache[key] = value;
    }

    public static get(key: string): string {
        return this.cache[key] as string;
    }

    public static hasValue(key: string): boolean {
        return !!this.cache[key];
    }
}
