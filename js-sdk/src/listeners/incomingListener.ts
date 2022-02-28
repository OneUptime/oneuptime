import Http from 'http';
import Https from 'https';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'uuid... Remove this comment to see the full error message
import { v4 as uuidv4 } from 'uuid';
import { getRoutes } from 'get-routes';
import UrlPattern from 'url-pattern';

class IncomingListener {
    private start;
    private end;
    private store;
    private app;
    // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'start' implicitly has an 'any' type.
    constructor(start, end, store, app) {
        this.start = start;
        this.end = end;
        this.store = store;
        this.app = app;
        this._setUpIncomingListener();
    }
    _setUpIncomingListener() {
        override(Http);
        override(Https);
        const _this = this;
        // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'module' implicitly has an 'any' type.
        function override(module) {
            const emit = module.Server.prototype.emit;
            // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'type' implicitly has an 'any' type.
            module.Server.prototype.emit = function(type, req, res) {
                if (type === 'request') {
                    const path = req.pathname || req.path || req.url || '/';
                    const method = req.method;
                    let finalPattern = path;

                    // this will only work with express application
                    if (_this.app && _this.app._router) {
                        const routes = getRoutes(_this.app);
                        for (const [key, value] of Object.entries(routes)) {
                            if (key === String(method).toLowerCase()) {
                                for (const val of value) {
                                    const pattern = new UrlPattern(val);

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
                    const result = _this.start(req.apm.uuid, {
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
                        }

                        _this.end(req.apm.uuid, result, 'request');
                    });
                }
                return emit.apply(this, arguments);
            };
        }
    }
}
export default IncomingListener;
