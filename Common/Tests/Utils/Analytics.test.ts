import Analytics from '../../Utils/Analytics';
import Email from '../../Types/Email';
import { JSONObject } from '../../Types/JSON';
import posthog from 'posthog-js';

jest.mock('posthog-js', () => {
    return {
        init: jest.fn(),
        identify: jest.fn(),
        reset: jest.fn(),
        capture: jest.fn(),
    };
});

const apiHost: string = 'https://example.com';
const apiKey: string = 'your-api-key';

describe('Analytics Class', () => {
    afterEach(() => {
        jest.clearAllMocks();
    });

    it('should initialize the Analytics class', () => {
        const analytics: Analytics = new Analytics(apiHost, apiKey);

        expect(posthog.init).toHaveBeenCalledWith(apiKey, {
            api_host: apiHost,
            autocapture: false,
        });
        expect(analytics.isInitialized).toBe(true);
    });

    it('should not initialize if apiHost and apiKey are not provided', () => {
        const analytics: Analytics = new Analytics('', '');

        expect(posthog.init).not.toHaveBeenCalled();
        expect(analytics.isInitialized).toBe(false);
    });

    it('should authenticate a user', () => {
        const analytics: Analytics = new Analytics(apiHost, apiKey);
        const email: Email = new Email('test@example.com');

        analytics.userAuth(email);
        expect(posthog.identify).toHaveBeenCalledWith(email.toString());
    });

    it('should not authenticate a user if not initialized', () => {
        const analytics: Analytics = new Analytics('', '');
        const email: Email = new Email('test@example.com');

        analytics.userAuth(email);
        expect(posthog.identify).not.toHaveBeenCalled();
    });

    it('should reset the user session on logout', () => {
        const analytics: Analytics = new Analytics(apiHost, apiKey);

        analytics.logout();
        expect(posthog.reset).toHaveBeenCalled();
    });

    it('should not reset the user session if not initialized', () => {
        const analytics: Analytics = new Analytics('', '');

        analytics.logout();
        expect(posthog.reset).not.toHaveBeenCalled();
    });

    it('should capture an event with optional data', () => {
        const analytics: Analytics = new Analytics(apiHost, apiKey);
        const eventName: string = 'testEvent';
        const data: JSONObject = { key: 'value' };

        analytics.capture(eventName, data);
        expect(posthog.capture).toHaveBeenCalledWith(eventName, data);
    });

    it('should not capture an event if not initialized', () => {
        const analytics: Analytics = new Analytics('', '');

        analytics.capture('testEvent');
        expect(posthog.capture).not.toHaveBeenCalled();
    });
});
