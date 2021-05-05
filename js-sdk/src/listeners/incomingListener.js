'use strict';
/* eslint-disable no-console */
/*eslint-disable no-unused-vars*/
const Http = require('http');
const Https = require('https');
const { v4: uuidv4 } = require('uuid');
const { getRoutes } = require('get-routes');
const UrlPattern = require('url-pattern');

class IncomingListener {
    #start;
    #end;
    #store;
    #app;
    constructor(start, end, store, app) {
        this.#start = start;
        this.#end = end;
        this.#store = store;
        this.#app = app;
        this._setUpIncomingListener();
    }
    _setUpIncomingListener() {
        override(Http);
        override(Https);
        const _this = this;
        function override(module) {
            const emit = module.Server.prototype.emit;
            module.Server.prototype.emit = function(type, req, res) {
                if (type === 'request') {
                    const path = req.pathname || req.path || req.url || '/';
                    const method = req.method;

                    // this will only work with express application
                    if (_this.#app._router) {
                        const routes = getRoutes(_this.#app);
                        for (const [key, value] of Object.entries(routes)) {
                            if (key === String(method).toLowerCase()) {
                                for (const val of value) {
                                    const pattern = new UrlPattern(val);

                                    if (pattern.match(path)) {
                                        // path pattern found
                                        req.apm = {};
                                        req.apm.uuid = uuidv4();
                                        const result = _this.#start(
                                            req.apm.uuid,
                                            {
                                                path: val,
                                                type: 'incoming',
                                                method,
                                            }
                                        );
                                        res.on('finish', () => {
                                            if (
                                                res &&
                                                res.statusCode &&
                                                res.statusCode >= 400 &&
                                                res.statusCode < 600
                                            ) {
                                                // error must have occurred
                                                const originalValue = _this.#store.getValue(
                                                    req.apm.uuid
                                                );
                                                if (
                                                    originalValue &&
                                                    originalValue !== undefined
                                                ) {
                                                    originalValue.errorCount = 1;
                                                    _this.#store.setValue(
                                                        req.apm.uuid,
                                                        originalValue
                                                    );
                                                }
                                            }

                                            _this.#end(
                                                req.apm.uuid,
                                                result,
                                                'request'
                                            );
                                        });

                                        break;
                                    }
                                }
                            }
                        }
                    }
                }
                return emit.apply(this, arguments);
            };
        }
    }
}
export default IncomingListener;
