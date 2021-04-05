/* eslint-disable no-console */
/*eslint-disable no-unused-vars*/
import Module from 'module';
import FyipeTimelineManager from './timelineManager';
import Util from './util';
import Http from 'http';
import Https from 'https';
import mongooseListener from './utils/mongoose';

class PerformanceMonitor {
    #BASE_URL = 'http://localhost:3002/api'; // TODO proper base url config
    #timelineObj;
    #currentEventId;
    #utilObj;
    #isWindow;
    #options;
    constructor(eventId, isWindow, options) {
        this.#options = options;
        this.#isWindow = isWindow;
        this.#timelineObj = new FyipeTimelineManager(options);
        this.#utilObj = new Util();
        this.#currentEventId = eventId;

        if (!this.#isWindow) {
            this._setUpHttpsListener();
            this._setUpDataBaseListener();
            this._setUpIncomingListener();
        }
    }
    _setUpHttpsListener() {
        override(Http);
        override(Https);
        const _this = this;
        function override(module) {
            const original = module.request;
            function wrapper(outgoing) {
                // Store a call to the original in req
                const req = original.apply(this, arguments);
                const emit = req.emit;
                const startHrTime = process.hrtime();
                req.emit = function(eventName, response) {
                    switch (eventName) {
                        case 'response': {
                            response.on('end', () => {
                                const elapsedHrTime = process.hrtime(
                                    startHrTime
                                );
                                const elapsedTimeInMs =
                                    elapsedHrTime[0] * 1000 +
                                    elapsedHrTime[1] / 1e6;
                                console.log('outgoing', elapsedTimeInMs);
                            });
                        }
                    }
                    return emit.apply(this, arguments);
                };
                // return the original call
                return req;
            }
            module.request = wrapper;
        }
    }
    _logHttpRequestEvent(content, type) {
        const timelineObj = {
            category: type, // HTTP
            data: {
                content,
            },
            type,
            eventId: this.#currentEventId,
        };
        // add timeline to the stack
        this.#timelineObj.addToTimeline(timelineObj);
    }
    _setUpDataBaseListener() {
        const load = Module._load;
        Module._load = function(request, parent) {
            const res = load.apply(this, arguments);
            if (request === 'mongoose') {
                return mongooseListener(res);
            }
            return res;
        };
    }
    _setUpIncomingListener() {
        return require('./utils/incomingListener');
    }
}
export default PerformanceMonitor;
