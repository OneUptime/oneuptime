import Dictionary from 'Common/Types/Dictionary';

export default abstract class LocalCache {
    private static cache: Dictionary<string> = {};

    static set(key: string, value: string): void {
        this.cache[key] = value;
    }

    static get(key: string): string {
        return this.cache[key] as string;
    }

    static hasValue(key: string): boolean {
        return !!this.cache[key];
    }
}
