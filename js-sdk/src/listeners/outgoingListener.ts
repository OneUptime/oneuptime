import Http from 'http';
import Https from 'https';

import { v4 as uuidv4 } from 'uuid';

class OutgoingListener {
    private start;
    private end;
    private store;

    constructor(start, end, store) {
        this.start = start;
        this.end = end;
        this.store = store;
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
                const result = _this.start(req.apm.uuid, {
                    path: `${protocol}//${host}${path}`, // store full path for outgoing requests
                    type: 'outgoing',
                    method,
                });

                req.emit = function (eventName, response) {
                    switch (eventName) {
                        case 'response': {
                            response.on('end', () => {
                                _this.end(req.apm.uuid, result, 'response');
                            });
                            break;
                        }
                        case 'error': {
                            const originalValue = _this.store.getValue(
                                req.apm.uuid
                            );
                            if (originalValue && originalValue !== undefined) {
                                originalValue.errorCount = 1;
                                _this.store.setValue(
                                    req.apm.uuid,
                                    originalValue
                                );
                            }
                            _this.end(req.apm.uuid, result, 'response');
                            break;
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
