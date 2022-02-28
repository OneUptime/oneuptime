import Http from 'http';
import Https from 'https';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'uuid... Remove this comment to see the full error message
import { v4 as uuidv4 } from 'uuid';

class OutgoingListener {
    private start;
    private end;
    private store;
    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'start' implicitly has an 'any' type.
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
        // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'module' implicitly has an 'any' type.
        function override(module) {
            const original = module.request;
            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'outgoing' implicitly has an 'any' type.
            function wrapper(outgoing) {
                // Store a call to the original in req
                // @ts-expect-error ts-migrate(2683) FIXME: 'this' implicitly has type 'any' because it does n... Remove this comment to see the full error message
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
                // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'eventName' implicitly has an 'any' type... Remove this comment to see the full error message
                req.emit = function(eventName, response) {
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
