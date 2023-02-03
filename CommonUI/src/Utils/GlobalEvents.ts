import type { JSONObject } from 'Common/Types/JSON';

export default class GlobalEvents {
    public static addEventListener(
        name: string,
        eventFunction: Function
    ): void {
        window.addEventListener(name as any, eventFunction as any);
    }

    public static removeEventListener(
        name: string,
        eventFunction: Function
    ): void {
        window.removeEventListener(name as any, eventFunction as any);
    }

    public static dispatchEvent(
        name: string,
        data?: JSONObject | undefined
    ): void {
        // Create a custom event with data
        const event: CustomEvent = new CustomEvent(name, data || {});

        // Dispatch the event
        window.dispatchEvent(event);
    }
}
