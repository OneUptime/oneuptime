import FyipeListiner from './listener';
import Util from './util';

class FyipeTracker {
    // constructor to set up global listeners
    #utilObj;
    #listenerObj;
    constructor() {
        this.#listenerObj = new FyipeListiner(); // Initialize Listener for timeline
        // set up error listener
        this._setUpErrorListener();
        this.#utilObj = new Util();
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
        // Temporary display the state of the error stack, timeline and device details when an error occur
        console.log({ timeline, errorStackTrace, deviceDetails });
    }
}
export default FyipeTracker;
