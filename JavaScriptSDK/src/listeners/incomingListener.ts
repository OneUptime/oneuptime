import Http from 'http';
import Https from 'https';

import { v4 as uuidv4 } from 'uuid';
import { getRoutes } from 'get-routes';
import UrlPattern from 'url-pattern';

class IncomingListener {
    private start;
    private end;
    private store;
    private app;

    constructor(start, end, store, app) {
        this.start = start;
        this.end = end;
        this.store = store;
        this.app = app;
        this._setUpIncomingListener();
    }
    _setUpIncomingListener(): void {
        override(Http);
        override(Https);

        function override(module): void {
            const emit: $TSFixMe = module.Server.prototype.emit;

            module.Server.prototype.emit = function (type, req, res): void {
                if (type === 'request') {
                    const path: $TSFixMe =
                        req.pathname || req.path || req.url || '/';
                    const method: $TSFixMe = req.method;
                    let finalPattern: $TSFixMe = path;

                    // this will only work with express application
                    if (this.app && this.app._router) {
                        const routes: $TSFixMe = getRoutes(this.app);
                        for (const [key, value] of Object.entries(routes)) {
                            if (key === String(method).toLowerCase()) {
                                for (const val of value) {
                                    const pattern: $TSFixMe = new UrlPattern(
                                        val
                                    );

                                    if (pattern.match(path)) {
                                        // path pattern found
                                        finalPattern = val;
                                        break;
                                    }
                                }
                            }
                        }
                    }

                    req.apm = {};
                    req.apm.uuid = uuidv4();
                    const result: $TSFixMe = this.start(req.apm.uuid, {
                        path: finalPattern,
                        type: 'incoming',
                        method,
                    });
                    res.on('finish', () => {
                        if (
                            res &&
                            res.statusCode &&
                            res.statusCode >= 400 &&
                            res.statusCode < 600
                        ) {
                            // error must have occurred
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
                        }

                        this.end(req.apm.uuid, result, 'request');
                    });
                }
                return emit.apply(this, arguments);
            };
        }
    }
}
export default IncomingListener;
