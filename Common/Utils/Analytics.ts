import type Email from '../Types/Email';
import type { JSONObject } from '../Types/JSON';
import posthog from 'posthog-js';

export default class Analytics {
    private _isInitialized: boolean = false;
    public get isInitialized(): boolean {
        return this._isInitialized;
    }
    public set isInitialized(v: boolean) {
        this._isInitialized = v;
    }

    public constructor(apiHost: string, apiKey: string) {
        if (apiHost && apiKey) {
            posthog.init(apiKey, { api_host: apiHost, autocapture: false });
            this.isInitialized = true;
        }
    }

    public userAuth(email: Email): void {
        if (!this.isInitialized) {
            return;
        }
        posthog.identify(email.toString());
    }

    public logout(): void {
        if (!this.isInitialized) {
            return;
        }
        posthog.reset();
    }

    public capture(eventName: string, data?: JSONObject): void {
        if (!this.isInitialized) {
            return;
        }

        posthog.capture(eventName, data);
    }
}
