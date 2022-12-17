import { JSONObject } from "Common/Types/JSON";

export default class GlobalEvents {
    public static addEventListener(name: string, eventFunction: Function) {
        window.addEventListener(name as any, eventFunction as any);
    }

    public static removeEventListener(name: string, eventFunction: Function) {
        window.removeEventListener(name as any, eventFunction as any);
    }

    public static dispatchEvent(name: string, data?: JSONObject | undefined) {

        // Create a custom event with data
        var event = new CustomEvent(name, data || {});

        // Dispatch the event
        window.dispatchEvent(event);
    }
}