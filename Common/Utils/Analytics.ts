import Email from '../Types/Email';
import { JSONObject } from '../Types/JSON';
import posthog from 'posthog-js';

export default class Analytics {
    public constructor(apiHost: string, apiKey: string) {
        posthog.init(apiKey, { api_host: apiHost });
    }

    public userAuth(email: Email): void {
        posthog.identify(email.toString());
    }

    public capture(eventName: string, data: JSONObject): void {
        posthog.capture(eventName, data);
    }
}
