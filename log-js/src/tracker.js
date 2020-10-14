import FyipeListiner from './listener';
import Util from './util';
import uuid from 'js-uuid';

class FyipeTracker {
    // constructor to set up global listeners
    #utilObj;
    #listenerObj;
    #eventId;
    constructor() {
        this._setEventId();
        this.#listenerObj = new FyipeListiner(this.getEventId()); // Initialize Listener for timeline
        // set up error listener
        this._setUpErrorListener();
        this.#utilObj = new Util();
    }
    _setEventId() {
        this.#eventId = uuid.v4();
    }
    getEventId() {
        return this.#eventId;
    }
    // set up error listener
    _setUpErrorListener() {
        const _this = this;
        window.onerror = function(msg, file, line, col, error) {
            const errorEvent = { msg, file, line, col, error };

            const string = errorEvent.msg
                ? errorEvent.msg.toLowerCase()
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
                _this.prepareErrorObject(errorObj);
            }
        };
    }
    prepareErrorObject(errorStackTrace) {
        // get current timeline
        const timeline = this.#listenerObj.getTimeline();
        const deviceDetails = this.#utilObj._getUserDeviceDetails();
        // get event ID
        // Temporary display the state of the error stack, timeline and device details when an error occur
        console.log({ timeline, errorStackTrace, deviceDetails, eventId: this.getEventId() });

        // generate a new event Id
        this._setEventId();
        // clear the timeline after a successful call to the server
        this.#listenerObj.clearTimeline(this.getEventId());
    }
}
export default FyipeTracker;
