import OneUptimeListener from './listener';
import Util from './util';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';

import { name, version } from '../package.json';

class ErrorTracker {
    MAX_ITEMS_ALLOWED_IN_STACK: $TSFixMe;
    apiUrl: URL;
    configKeys: $TSFixMe;
    errorTrackerId: $TSFixMe;
    errorTrackerKey: $TSFixMe;
    event: $TSFixMe;
    eventId: $TSFixMe;
    extras: $TSFixMe;
    fingerprint: $TSFixMe;
    isWindow: $TSFixMe;
    listenerObj: $TSFixMe;
    options: $TSFixMe;
    tags: $TSFixMe;
    utilObj: $TSFixMe;
    // constructor to set up global listeners
    constructor(
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
        // set up option
        this._setUpOptions(options);
        this._setEventId();
        this.isWindow = typeof window !== 'undefined';
        this.listenerObj = new OneUptimeListener(
            this.getEventId(),
            this.isWindow,
            this.options
        ); // Initialize Listener for timeline
        this.utilObj = new Util(this.options);
        // set up error listener
        if (this.isWindow) {
            this._setUpErrorListener();
        } else {
            this._setUpNodeErrorListener();
        }
    }
    _setErrorTrackerId(errorTrackerId: $TSFixMe): void {
        this.errorTrackerId = errorTrackerId;
    }
    _setErrorTrackerKey(errorTrackerKey: $TSFixMe): void {
        this.errorTrackerKey = errorTrackerKey;
    }
    _setApiUrl(apiUrl: URL): void {
        this.apiUrl = `${apiUrl}/error-tracker/${this.errorTrackerId}/track`;
    }
    _setUpOptions(options: $TSFixMe): void {
        for (const [key, value] of Object.entries(options)) {
            // proceed with current key if it is not in the config keys
            if (!this.configKeys.includes(key)) {
                // if key is in allowed options keys
                if (this.options[key]) {
                    // set max timeline properly after checking conditions
                    if (
                        key === 'maxTimeline' &&
                        (value > this.MAX_ITEMS_ALLOWED_IN_STACK || value < 1)
                    ) {
                        this.options[key] = this.MAX_ITEMS_ALLOWED_IN_STACK;
                    } else if (key === 'captureCodeSnippet') {
                        const isBoolean: $TSFixMe = typeof value === 'boolean'; // check if the passed value is a boolean
                        // set boolean value if boolean or set default `true` if annything other than boolean is passed
                        this.options[key] = isBoolean ? value : true;
                    } else {
                        this.options[key] = value;
                    }
                }
            }
        }
    }
    _setEventId(): void {
        this.eventId = uuidv4();
    }
    getEventId(): void {
        return this.eventId;
    }
    setTag(key: $TSFixMe, value: $TSFixMe): void {
        if (!(typeof key === 'string') || !(typeof value === 'string')) {
            return 'Invalid Tags type';
        }
        // get the index if the key exist already
        const index: $TSFixMe = this.tags.findIndex(
            (tag: $TSFixMe) => tag.key === key
        );
        if (index !== -1) {
            // replace value if it exist
            this.tags[index].value = value;
        } else {
            // push key and value if it doesnt
            this.tags = [...this.tags, { key, value }];
        }
    }
    // pass an array of tags
    setTags(tags: $TSFixMe): void {
        if (!Array.isArray(tags)) {
            return 'Invalid Tags type';
        }
        tags.forEach(element => {
            if (element.key && element.value) {
                this.setTag(element.key, element.value);
            }
        });
    }
    _getTags(): void {
        return this.tags;
    }
    setExtras(extras: $TSFixMe): void {
        extras.forEach((element: $TSFixMe) => {
            if (element.key && element.extra) {
                this.setExtra(element.key, element.extra);
            }
        });
    }

    setExtra(key: $TSFixMe, extra: $TSFixMe): void {
        this.extras = { ...this.extras, [key]: extra };
    }
    setFingerprint(keys: $TSFixMe): void {
        if (!(typeof keys === 'string') && !Array.isArray(keys)) {
            return 'Invalid Fingerprint Format';
        }
        this.fingerprint = keys ? (Array.isArray(keys) ? keys : [keys]) : [];
    }
    _getFingerprint(errorMessage: $TSFixMe): void {
        // if no fingerprint exist currently
        if (this.fingerprint.length < 1) {
            // set up finger print based on error since none exist
            this.setFingerprint(errorMessage);
        }
        return this.fingerprint;
    }
    // set up error listener
    _setUpErrorListener(): void {
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
            const substring: string = 'script error';
            if (string.indexOf(substring) > -1) {
                return; // third party error
            } else {
                // construct the error object
                const errorObj: $TSFixMe =
                    await this.utilObj._getErrorStackTrace(errorEvent);

                // set the a handled tag
                this.setTag('handled', 'false');
                // prepare to send to server
                this.prepareErrorObject('error', errorObj);

                // send to the server
                this.sendErrorEventToServer();
            }
        };
    }
    _setUpNodeErrorListener(): void {
        process
            .on('uncaughtException', err => {
                // display for the user
                //eslint-disable-next-line no-console
                console.info(`${err}`);
                // any uncaught error
                this._manageErrorNode(err);
            })
            .on('unhandledRejection', err => {
                // display this for the user
                //eslint-disable-next-line no-console
                console.info(`UnhandledPromiseRejectionWarning: ${err.stack}`);
                // any unhandled promise error
                this._manageErrorNode(err);
            });
    }
    async _manageErrorNode(error: $TSFixMe): void {
        // construct the error object
        const errorObj: $TSFixMe = await this.utilObj._getErrorStackTrace(
            error
        );

        // set the a handled tag
        this.setTag('handled', 'false');
        // prepare to send to server
        this.prepareErrorObject('error', errorObj);

        // send to the server
        return this.sendErrorEventToServer();
    }
    addToTimeline(category: $TSFixMe, content: $TSFixMe, type: $TSFixMe): void {
        const timeline: $TSFixMe = {
            category,
            data: {
                content,
            },
            type,
        };
        this.listenerObj.logCustomTimelineEvent(timeline);
    }
    getTimeline(): void {
        return this.listenerObj.getTimeline();
    }
    captureMessage(message: $TSFixMe): void {
        // set the a handled tag
        this.setTag('handled', 'true');
        this.prepareErrorObject('message', { message });

        // send to the server
        return this.sendErrorEventToServer();
    }
    async captureException(error: $TSFixMe): void {
        // construct the error object
        const errorObj: $TSFixMe = await this.utilObj._getErrorStackTrace(
            error
        );

        // set the a handled tag
        this.setTag('handled', 'true');

        this.prepareErrorObject('exception', errorObj);

        // send to the server
        return this.sendErrorEventToServer();
    }
    _setHost(): void {
        if (this.isWindow) {
            // Web apps
            this.setTag('url', window.location.origin);
        } else {
            // JS Backend
            // TODO create a way to get host on the backend
        }
    }
    prepareErrorObject(type: $TSFixMe, errorStackTrace: $TSFixMe): void {
        // log event
        const content: $TSFixMe = {
            message: errorStackTrace.message,
        };
        this.listenerObj.logErrorEvent(content, type);
        // set the host as a tag to be used later
        this._setHost();
        // get current timeline
        const timeline: $TSFixMe = this.getTimeline();
        // get device location and details
        const deviceDetails: $TSFixMe = this.utilObj._getUserDeviceDetails();
        const tags: $TSFixMe = this._getTags();
        const fingerprint: $TSFixMe = this._getFingerprint(
            errorStackTrace.message
        ); // default fingerprint will be the message from the error stacktrace
        // get event ID
        // Temporary display the state of the error stack, timeline and device details when an error occur
        // prepare the event so it can be sent to the server
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
    async sendErrorEventToServer(): void {
        let content: $TSFixMe;
        await this._makeApiRequest(this.event)
            .then(response => {
                content = response;
                // generate a new event Id
                this._setEventId();
                // clear the timeline after a successful call to the server
                this._clear(this.getEventId());
            })
            .catch((error: Error) => (content = error));
        return content;
    }
    _makeApiRequest(data: $TSFixMe): void {
        return new Promise((resolve, reject) => {
            axios
                .post(this.apiUrl, data)
                .then(res => {
                    resolve(res);
                })
                .catch(err => {
                    reject(err);
                });
        });
    }
    getCurrentEvent(): void {
        return this.event;
    }
    getSDKDetails(): void {
        return { name, version };
    }
    _clear(newEventId: $TSFixMe): void {
        // clear tags
        this.tags = [];
        // clear extras
        this.extras = [];
        // clear fingerprint
        this.fingerprint = [];
        // clear timeline
        this.listenerObj.clearTimeline(newEventId);
    }
}
export default ErrorTracker;
