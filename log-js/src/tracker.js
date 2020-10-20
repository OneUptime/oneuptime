import FyipeListiner from './listener';
import Util from './util';
import { v4 as uuidv4 } from 'uuid';

class FyipeTracker {
    // constructor to set up global listeners
    #utilObj;
    #listenerObj;
    #eventId;
    #tags = [];
    #extras = [];
    #isWindow = false;
    #fingerprint = [];
    #options = {
        maxTimeline: 5,
    };
    #MAX_ITEMS_ALLOWED_IN_STACK = 100;
    #configKeys = ['baseUrl'];
    #event;
    constructor(options) {
        // set up option
        this._setUpOptions(options);
        this._setEventId();
        this.#isWindow = typeof window !== 'undefined';
        this.#listenerObj = new FyipeListiner(
            this.getEventId(),
            this.#isWindow,
            this.#options
        ); // Initialize Listener for timeline
        this.#utilObj = new Util();
        // set up error listener
        if (this.#isWindow) {
            this._setUpErrorListener();
        } else {
            this._setUpNodeErrorListener();
        }
    }
    _setUpOptions(options) {
        for (const [key, value] of Object.entries(options)) {
            // proceed with current key if it is not in the config keys
            if (!this.#configKeys.includes(key)) {
                if (this.#options[key]) {
                    // set max timeline properly
                    if (
                        key === 'maxTimeline' &&
                        value > this.#MAX_ITEMS_ALLOWED_IN_STACK
                    ) {
                        this.#options[key] = this.#MAX_ITEMS_ALLOWED_IN_STACK;
                    } else {
                        this.#options[key] = value;
                    }
                }
            }
        }
    }
    _setEventId() {
        this.#eventId = uuidv4();
    }
    getEventId() {
        return this.#eventId;
    }
    setTag(key, value) {
        this.#tags = { ...this.#tags, [key]: value };
    }
    // pass an array of tags
    setTags(tags) {
        tags.forEach(element => {
            if (element.key && element.value) {
                this.setTag(element.key, element.value);
            }
        });
    }
    _getTags() {
        return this.#tags;
    }
    setExtras(extras) {
        extras.forEach(element => {
            if (element.key && element.extra) {
                this.setExtra(element.key, element.extra);
            }
        });
    }

    setExtra(key, extra) {
        this.#extras = { ...this.#extras, [key]: extra };
    }
    setFingerprint(keys) {
        this.#fingerprint = keys ? (Array.isArray(keys) ? keys : [keys]) : [];
    }
    _getFingerprint(errorMessage) {
        // if no fingerprint exist currently
        if (this.#fingerprint.length < 1) {
            // set up finger print based on error since none exist
            this.setFingerprint(errorMessage);
        }
        return this.#fingerprint;
    }
    // set up error listener
    _setUpErrorListener() {
        const _this = this;
        window.onerror = function(message, file, line, col, error) {
            const errorEvent = { message, file, line, col, error };

            const string = errorEvent.message
                ? errorEvent.message.toLowerCase()
                : errorEvent.toLowerCase();
            const substring = 'script error';
            if (string.indexOf(substring) > -1) {
                return; // third party error
            } else {
                // construct the error object
                const errorObj = _this.#utilObj._getErrorStackTrace(errorEvent);

                // log error event
                const content = {
                    message: errorObj.message,
                };
                _this.#listenerObj.logErrorEvent(content);

                // get device location and details
                // prepare to send to server
                _this.prepareErrorObject('error', errorObj);
            }
        };
    }
    _setUpNodeErrorListener() {
        const _this = this;
        process
            .on('uncaughtException', err => {
                // display for the user
                // eslint-disable-next-line no-console
                console.log(`${err}`);
                // any uncaught error
                _this._manageErrorNode(err);
            })
            .on('unhandledRejection', err => {
                // display this for the user
                // eslint-disable-next-line no-console
                console.log(`UnhandledPromiseRejectionWarning: ${err.stack}`);
                // any unhandled promise error
                _this._manageErrorNode(err);
            });
    }
    _manageErrorNode(error) {
        // construct the error object
        const errorObj = this.#utilObj._getErrorStackTrace(error);

        // log error event
        const content = {
            message: errorObj.message,
        };
        this.#listenerObj.logErrorEvent(content);
        // prepare to send to server
        this.prepareErrorObject('error', errorObj);
    }
    addToTimeline(category, content, type) {
        const timeline = {
            category,
            data: {
                content,
            },
            type,
        };
        this.#listenerObj.logCustomTimelineEvent(timeline);
    }
    getTimeline() {
        return this.#listenerObj.getTimeline();
    }
    captureMessage(message) {
        this.prepareErrorObject('message', { message });
    }
    captureException(error) {
        // construct the error object
        const errorObj = this.#utilObj._getErrorStackTrace(error);
        this.prepareErrorObject('exception', errorObj);
    }
    prepareErrorObject(type, errorStackTrace) {
        // get current timeline
        const timeline = this.getTimeline();
        const deviceDetails = this.#utilObj._getUserDeviceDetails();
        const tags = this._getTags();
        const fingerprint = this._getFingerprint(errorStackTrace.message); // default fingerprint will be the message from the error stacktrace
        // get event ID
        // Temporary display the state of the error stack, timeline and device details when an error occur
        this.#event = {
            type,
            timeline,
            exception: errorStackTrace,
            deviceDetails,
            eventId: this.getEventId(),
            tags,
            fingerprint,
        };
        console.log(event);

        // generate a new event Id
        this._setEventId();
        // clear the timeline after a successful call to the server
        this._clear(this.getEventId());
    }
    getCurrentEvent() {
        return this.#event;
    }
    _clear(newEventId) {
        // clear tags
        this.#tags = [];
        // clear extras
        this.#extras = [];
        // clear fingerprint
        this.#fingerprint = [];
        // clear timeline
        this.#listenerObj.clearTimeline(newEventId);
    }
}
export default FyipeTracker;
