import OneUptimeListener from './listener';
import Util from './util';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';

import { name, version } from '../package.json';

class ErrorTracker {
    private MAX_ITEMS_ALLOWED_IN_STACK: $TSFixMe;
    private apiUrl: URL;
    private configKeys: $TSFixMe;
    private errorTrackerId: $TSFixMe;
    private errorTrackerKey: $TSFixMe;
    private event: $TSFixMe;
    private eventId: $TSFixMe;
    private extras: $TSFixMe;
    private fingerprint: $TSFixMe;
    private isWindow: $TSFixMe;
    private listenerObj: $TSFixMe;
    private options: $TSFixMe;
    private tags: $TSFixMe;
    private utilObj: $TSFixMe;
    // Constructor to set up global listeners
    public constructor(
        apiUrl: URL,
        errorTrackerId: $TSFixMe,
        errorTrackerKey: $TSFixMe,
        options = {}
    ) {
        this._setErrorTrackerId(errorTrackerId);
        this._setApiUrl(apiUrl);
        this._setErrorTrackerKey(errorTrackerKey);
        this.tags = [];
        this.extras = [];
        this.isWindow = false;
        this.fingerprint = [];
        this.options = {
            maxTimeline: 5,
            captureCodeSnippet: true,
        };
        this.MAX_ITEMS_ALLOWED_IN_STACK = 100;
        this.configKeys = ['baseUrl'];
        // Set up option
        this._setUpOptions(options);
        this._setEventId();
        this.isWindow = typeof window !== 'undefined';
        this.listenerObj = new OneUptimeListener(
            this.getEventId(),
            this.isWindow,
            this.options
        ); // Initialize Listener for timeline
        this.utilObj = new Util(this.options);
        // Set up error listener
        if (this.isWindow) {
            this._setUpErrorListener();
        } else {
            this._setUpNodeErrorListener();
        }
    }
    private _setErrorTrackerId(errorTrackerId: $TSFixMe): void {
        this.errorTrackerId = errorTrackerId;
    }
    private _setErrorTrackerKey(errorTrackerKey: $TSFixMe): void {
        this.errorTrackerKey = errorTrackerKey;
    }
    private _setApiUrl(apiUrl: URL): void {
        this.apiUrl = `${apiUrl}/error-tracker/${this.errorTrackerId}/track`;
    }
    private _setUpOptions(options: $TSFixMe): void {
        for (const [key, value] of Object.entries(options)) {
            // Proceed with current key if it is not in the config keys
            if (!this.configKeys.includes(key)) {
                // If key is in allowed options keys
                if (this.options[key]) {
                    // Set max timeline properly after checking conditions
                    if (
                        key === 'maxTimeline' &&
                        (value > this.MAX_ITEMS_ALLOWED_IN_STACK || value < 1)
                    ) {
                        this.options[key] = this.MAX_ITEMS_ALLOWED_IN_STACK;
                    } else if (key === 'captureCodeSnippet') {
                        const isBoolean: $TSFixMe = typeof value === 'boolean'; // Check if the passed value is a boolean
                        // Set boolean value if boolean or set default `true` if annything other than boolean is passed
                        this.options[key] = isBoolean ? value : true;
                    } else {
                        this.options[key] = value;
                    }
                }
            }
        }
    }
    private _setEventId(): void {
        this.eventId = uuidv4();
    }
    public getEventId(): void {
        return this.eventId;
    }
    public setTag(key: $TSFixMe, value: $TSFixMe): void {
        if (!(typeof key === 'string') || !(typeof value === 'string')) {
            return 'Invalid Tags type';
        }
        // Get the index if the key exist already
        const index: $TSFixMe = this.tags.findIndex((tag: $TSFixMe) => {
            return tag.key === key;
        });
        if (index !== -1) {
            // Replace value if it exist
            this.tags[index].value = value;
        } else {
            // Push key and value if it doesnt
            this.tags = [...this.tags, { key, value }];
        }
    }
    // Pass an array of tags
    public setTags(tags: $TSFixMe): void {
        if (!Array.isArray(tags)) {
            return 'Invalid Tags type';
        }
        tags.forEach((element: $TSFixMe) => {
            if (element.key && element.value) {
                this.setTag(element.key, element.value);
            }
        });
    }
    private _getTags(): void {
        return this.tags;
    }
    public setExtras(extras: $TSFixMe): void {
        extras.forEach((element: $TSFixMe) => {
            if (element.key && element.extra) {
                this.setExtra(element.key, element.extra);
            }
        });
    }

    public setExtra(key: $TSFixMe, extra: $TSFixMe): void {
        this.extras = { ...this.extras, [key]: extra };
    }
    public setFingerprint(keys: $TSFixMe): void {
        if (!(typeof keys === 'string') && !Array.isArray(keys)) {
            return 'Invalid Fingerprint Format';
        }
        this.fingerprint = keys ? (Array.isArray(keys) ? keys : [keys]) : [];
    }
    private _getFingerprint(errorMessage: $TSFixMe): void {
        // If no fingerprint exist currently
        if (this.fingerprint.length < 1) {
            // Set up finger print based on error since none exist
            this.setFingerprint(errorMessage);
        }
        return this.fingerprint;
    }
    // Set up error listener
    private _setUpErrorListener(): void {
        window.onerror = async function (
            message,
            file,
            line,
            col,
            error
        ): void {
            const errorEvent: $TSFixMe = { message, file, line, col, error };

            const string: $TSFixMe = errorEvent.message
                ? errorEvent.message.toLowerCase()
                : errorEvent.toLowerCase();
            const substring = 'script error';
            if (string.indexOf(substring) > -1) {
                return; // Third party error
            }
            // Construct the error object
            const errorObj: $TSFixMe = await this.utilObj._getErrorStackTrace(
                errorEvent
            );

            // Set the a handled tag
            this.setTag('handled', 'false');
            // Prepare to send to server
            this.prepareErrorObject('error', errorObj);

            // Send to the server
            this.sendErrorEventToServer();
        };
    }
    private _setUpNodeErrorListener(): void {
        process
            .on('uncaughtException', (err: $TSFixMe) => {
                // Display for the user
                //eslint-disable-next-line no-console
                console.info(`${err}`);
                // Any uncaught error
                this._manageErrorNode(err);
            })
            .on('unhandledRejection', (err: $TSFixMe) => {
                // Display this for the user
                //eslint-disable-next-line no-console
                console.info(`UnhandledPromiseRejectionWarning: ${err.stack}`);
                // Any unhandled promise error
                this._manageErrorNode(err);
            });
    }
    private async _manageErrorNode(error: $TSFixMe): void {
        // Construct the error object
        const errorObj: $TSFixMe = await this.utilObj._getErrorStackTrace(
            error
        );

        // Set the a handled tag
        this.setTag('handled', 'false');
        // Prepare to send to server
        this.prepareErrorObject('error', errorObj);

        // Send to the server
        return this.sendErrorEventToServer();
    }
    public addToTimeline(
        category: $TSFixMe,
        content: $TSFixMe,
        type: $TSFixMe
    ): void {
        const timeline: $TSFixMe = {
            category,
            data: {
                content,
            },
            type,
        };
        this.listenerObj.logCustomTimelineEvent(timeline);
    }
    public getTimeline(): void {
        return this.listenerObj.getTimeline();
    }
    public captureMessage(message: $TSFixMe): void {
        // Set the a handled tag
        this.setTag('handled', 'true');
        this.prepareErrorObject('message', { message });

        // Send to the server
        return this.sendErrorEventToServer();
    }
    public async captureException(error: $TSFixMe): void {
        // Construct the error object
        const errorObj: $TSFixMe = await this.utilObj._getErrorStackTrace(
            error
        );

        // Set the a handled tag
        this.setTag('handled', 'true');

        this.prepareErrorObject('exception', errorObj);

        // Send to the server
        return this.sendErrorEventToServer();
    }
    private _setHost(): void {
        if (this.isWindow) {
            // Web apps
            this.setTag('url', window.location.origin);
        } else {
            /*
             * JS Backend
             * TODO create a way to get host on the backend
             */
        }
    }
    public prepareErrorObject(type: $TSFixMe, errorStackTrace: $TSFixMe): void {
        // Log event
        const content: $TSFixMe = {
            message: errorStackTrace.message,
        };
        this.listenerObj.logErrorEvent(content, type);
        // Set the host as a tag to be used later
        this._setHost();
        // Get current timeline
        const timeline: $TSFixMe = this.getTimeline();
        // Get device location and details
        const deviceDetails: $TSFixMe = this.utilObj._getUserDeviceDetails();
        const tags: $TSFixMe = this._getTags();
        const fingerprint: $TSFixMe = this._getFingerprint(
            errorStackTrace.message
        ); // Default fingerprint will be the message from the error stacktrace
        /*
         * Get event ID
         * Temporary display the state of the error stack, timeline and device details when an error occur
         * Prepare the event so it can be sent to the server
         */
        this.event = {
            type,
            timeline,
            exception: errorStackTrace,
            deviceDetails,
            eventId: this.getEventId(),
            tags,
            fingerprint,
            errorTrackerKey: this.errorTrackerKey,
            sdk: this.getSDKDetails(),
        };
    }
    public async sendErrorEventToServer(): void {
        let content: $TSFixMe;
        await this._makeApiRequest(this.event)
            .then((response: $TSFixMe) => {
                content = response;
                // Generate a new event Id
                this._setEventId();
                // Clear the timeline after a successful call to the server
                this._clear(this.getEventId());
            })
            .catch((error: Error) => {
                return (content = error);
            });
        return content;
    }
    private _makeApiRequest(data: $TSFixMe): void {
        return new Promise((resolve: Function, reject: Function) => {
            axios
                .post(this.apiUrl, data)
                .then((res: $TSFixMe) => {
                    resolve(res);
                })
                .catch((err: $TSFixMe) => {
                    reject(err);
                });
        });
    }
    public getCurrentEvent(): void {
        return this.event;
    }
    public getSDKDetails(): void {
        return { name, version };
    }
    private _clear(newEventId: $TSFixMe): void {
        // Clear tags
        this.tags = [];
        // Clear extras
        this.extras = [];
        // Clear fingerprint
        this.fingerprint = [];
        // Clear timeline
        this.listenerObj.clearTimeline(newEventId);
    }
}
export default ErrorTracker;
