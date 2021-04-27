'use strict';
/* eslint-disable no-console */
/*eslint-disable no-unused-vars*/
const Http = require('http');
const Https = require('https');
const { v4: uuidv4 } = require('uuid');

class OutgoingListener {
    #start;
    #end;
    constructor(start, end) {
        this.#start = start;
        this.#end = end;
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

                const host = outgoing.host || outgoing.hostname;
                const protocol = outgoing.protocol;
                const path =
                    outgoing.pathname || outgoing.path || outgoing.url || '/';
                const method = outgoing.method;

                const emit = req.emit;
                req.apm = {};
                req.apm.uuid = uuidv4();
                const result = _this.#start(req.apm.uuid, {
                    path: `${protocol}//${host}${path}`, // store full path for outgoing requests
                    type: 'outgoing',
                    method,
                });
                req.emit = function(eventName, response) {
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
