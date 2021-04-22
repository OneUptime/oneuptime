/* eslint-disable no-console */
/*eslint-disable no-unused-vars*/
import Module from 'module';
const semver = require('semver');
import MongooseListener from './listeners/mongoose';
import IncomingListener from './listeners/incomingListener';
import OutgoingListener from './listeners/outgoingListener';
import PerfTimer from './utils/perfTimer';
import HrTimer from './utils/hrTimer';
class PerformanceTracker {
    #apiUrl;
    #appId;
    #appKey;
    #nodeVer;
    #nodeUse;
    #start;
    #end;
    constructor({ apiUrl, appId, appKey }) {
        this.#apiUrl = apiUrl;
        this.#appId = appId;
        this.#appKey = appKey;
        this.#nodeVer = process.versions.node;
        if (semver.satisfies(this.#nodeVer, '>10.0.0')) {
            this.#nodeUse = true;
        } else {
            this.#nodeUse = false;
        }
        if (this.#nodeUse) {
            const perf = new PerfTimer(this.#apiUrl, this.#appId, this.#appKey);
            const { start, end } = perf;
            this.#start = start;
            this.#end = end;
        } else {
            const hrt = new HrTimer(this.#apiUrl, this.#appId, this.#appKey);
            const { start, end } = hrt;
            this.#start = start;
            this.#end = end;
        }
    }
    setUpOutgoingListener() {
        return new OutgoingListener(this.#start, this.#end);
    }
    setUpDataBaseListener() {
        const load = Module._load;
        const _this = this;
        Module._load = function(request, parent) {
            const res = load.apply(this, arguments);
            if (request === 'mongoose') {
                const mongo = new MongooseListener(_this.#start, _this.#end);
                return mongo._setUpMongooseListener(res);
            }
            return res;
        };
    }
    setUpIncomingListener() {
        return new IncomingListener(this.#start, this.#end);
    }
}
export default PerformanceTracker;
