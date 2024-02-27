import { JSONObject } from 'Common/Types/JSON';

export default class GlobalEvents {
    public static addEventListener(
        name: string,
        eventFunction: (this: Window, ev: WindowEventMap) => any
    ): void {
        window.addEventListener(name as any, eventFunction);
    }

    public static removeEventListener(
        name: string,
        eventFunction: (this: Window, ev: WindowEventMap) => any
    ): void {
        window.removeEventListener(name as any, eventFunction);
    }

    public static dispatchEvent(
        name: string,
        data?: JSONObject | undefined
    ): void {
        // Create a custom event with data
        const event: CustomEvent = new CustomEvent(name, {
            detail: data || {},
        });

        // Dispatch the event
        window.dispatchEvent(event);
    }
}
