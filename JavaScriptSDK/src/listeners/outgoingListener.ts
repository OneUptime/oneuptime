import Http from 'http';
import Https from 'https';

import { v4 as uuidv4 } from 'uuid';

class OutgoingListener {
    private start;
    private end;
    private store;

    public constructor(start, end, store) {
        this.start = start;
        this.end = end;
        this.store = store;
        this._setUpOutgoingListener();
    }
    private _setUpOutgoingListener(): void {
        override(Http);
        override(Https);

        function override(module: $TSFixMe): void {
            const original: $TSFixMe = module.request;

            function wrapper(outgoing: $TSFixMe): void {
                // Store a call to the original in req

                const req: $TSFixMe = original.apply(this, arguments);

                const host: $TSFixMe = outgoing.host || outgoing.hostname;
                const protocol: $TSFixMe = outgoing.protocol;
                const path: $TSFixMe =
                    outgoing.pathname || outgoing.path || outgoing.url || '/';
                const method: $TSFixMe = outgoing.method;

                const emit: $TSFixMe = req.emit;
                req.apm = {};
                req.apm.uuid = uuidv4();
                const result: $TSFixMe = this.start(req.apm.uuid, {
                    path: `${protocol}//${host}${path}`, // store full path for outgoing requests
                    type: 'outgoing',
                    method,
                });

                req.emit = function (eventName, response): void {
                    switch (eventName) {
                        case 'response': {
                            response.on('end', () => {
                                this.end(req.apm.uuid, result, 'response');
                            });
                            break;
                        }
                        case 'error': {
                            const originalValue: $TSFixMe = this.store.getValue(
                                req.apm.uuid
                            );
                            if (originalValue && originalValue !== undefined) {
                                originalValue.errorCount = 1;
                                this.store.setValue(
                                    req.apm.uuid,
                                    originalValue
                                );
                            }
                            this.end(req.apm.uuid, result, 'response');
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
