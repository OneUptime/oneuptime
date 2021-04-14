/* eslint-disable no-console */
/*eslint-disable no-unused-vars*/
import Module from 'module';
const semver = require('semver');
import MongooseListener from './listeners/mongoose';
import IncomingListener from './listeners/incomingListener';
import OutgoingListener from './listeners/outgoingListener';
import DataStore from './utils/dataStore';
class PerformanceMonitor {
    #BASE_URL = 'http://localhost:3002/api'; // TODO proper base url config
    #isWindow;
    #options;
    #nodeVer;
    #nodeUse;
    #start;
    #end;
    #createLog;
    constructor(isWindow, options) {
        this.#options = options;
        this.#isWindow = isWindow;
        this.#nodeVer = process.versions.node;
        this.#createLog = require('./utils/helpers').createLog;
        if (semver.satisfies(this.#nodeVer, '>10.0.0')) {
            this.#nodeUse = true;
        } else {
            this.#nodeUse = false;
        }
        if (this.#nodeUse) {
            const { start, end } = require('./utils/perfMonitor');
            this.#start = start;
            this.#end = end;
        } else {
            const { start, end } = require('./utils/hrTime');
            this.#start = start;
            this.#end = end;
        }
        if (!this.#isWindow) {
            this._setUpOutgoingListener();
            this._setUpDataBaseListener();
            this._setUpIncomingListener();
        }
    }
    _setUpOutgoingListener() {
        return new OutgoingListener(this.#start, this.#end, this.#createLog);
    }
    _setUpDataBaseListener() {
        const load = Module._load;
        const _this = this;
        Module._load = function(request, parent) {
            const res = load.apply(this, arguments);
            if (request === 'mongoose') {
                const mongo = new MongooseListener(
                    _this.#start,
                    _this.#end,
                    _this.#createLog
                );
                return mongo._setUpMongooseListener(res);
            }
            return res;
        };
    }
    _setUpIncomingListener() {
        return new IncomingListener(this.#start, this.#end, this.#createLog);
    }
}
export default PerformanceMonitor;
