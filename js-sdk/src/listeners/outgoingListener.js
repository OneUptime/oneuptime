'use strict';
/* eslint-disable no-console */
/*eslint-disable no-unused-vars*/
const Http = require('http');
const Https = require('https');
const { v4: uuidv4 } = require('uuid');

class OutgoingListener {
    #start;
    #end;
    #createLog;
    constructor(start, end, createLog) {
        this.#start = start;
        this.#end = end;
        this.#createLog = createLog;
        this._setUpOutgoingListener();
    }
    _setUpOutgoingListener() {
        override(Http);
        override(Https);
        const _this = this;
        function override(module) {
            const original = module.request;
            function wrapper(outgoing) {
                // Store a call to the original in req
                const req = original.apply(this, arguments);
                const log = _this.#createLog(outgoing, 'outgoing');
                const emit = req.emit;
                req.apm = {};
                req.apm.uuid = uuidv4();
                log.type = 'outgoing';
                const result = _this.#start(req.apm.uuid, log);
                req.emit = (eventName, response) => {
                    switch (eventName) {
                        case 'response': {
                            response.on('end', () => {
                                _this.#end(req.apm.uuid, result, 'response');
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
}
export default OutgoingListener;
