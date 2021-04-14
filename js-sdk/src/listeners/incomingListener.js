'use strict';
/* eslint-disable no-console */
/*eslint-disable no-unused-vars*/
const Http = require('http');
const Https = require('https');
const { v4: uuidv4 } = require('uuid');

class IncomingListener {
    #start;
    #end;
    #createLog;
    constructor(start, end, createLog) {
        this.#start = start;
        this.#end = end;
        this.#createLog = createLog;
        this._setUpIncomingListener();
    }
    _setUpIncomingListener() {
        override(Http);
        override(Https);
        const _this = this;
        function override(module) {
            const emit = module.Server.prototype.emit;
            module.Server.prototype.emit = function(type) {
                if (type === 'request') {
                    const [req, res] = [arguments[1], arguments[2]];
                    const log = _this.#createLog(req, 'incoming');
                    req.apm = {};
                    req.apm.uuid = uuidv4();
                    log.type = 'incoming';
                    const result = _this.#start(req.apm.uuid, log);
                    res.on('finish', () => {
                        _this.#end(req.apm.uuid, result, 'request');
                    });
                }
                return emit.apply(this, arguments);
            };
        }
    }
}
export default IncomingListener;
