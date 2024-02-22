export default class Clipboard {
    public static async copyToClipboard(text: string): Promise<void> {
        await navigator.clipboard?.writeText(text);
    }
}