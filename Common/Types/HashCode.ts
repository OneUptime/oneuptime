export default class HashCode {
    public static fromString(text: string): number {
        var hash = 0;
        for (var i = 0; i < text.length; i++) {
            var code = text.charCodeAt(i);
            hash = ((hash << 5) - hash) + code;
            hash = hash & hash; // Convert to 32bit integer
        }
        return hash;
    }
}