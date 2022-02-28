/*eslint-disable no-unused-vars*/
import Module from 'module';
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'semv... Remove this comment to see the full error message
import semver from 'semver';
import MongooseListener from './listeners/mongoose';
import IncomingListener from './listeners/incomingListener';
import OutgoingListener from './listeners/outgoingListener';
import PerfTimer from './utils/perfTimer';
import HrTimer from './utils/hrTimer';
class PerformanceTracker {
    private apiUrl;
    private appId;
    private appKey;
    private nodeVer;
    private nodeUse;
    private start;
    private end;
    private store;
    constructor({
        apiUrl,
        appId,
        appKey,
        trackIncomingRequest = true,
        trackOutgoingRequest = true,

        // express app instance
        app,
    }: $TSFixMe) {
        this.apiUrl = apiUrl;
        this.appId = appId;
        this.appKey = appKey;
        this.nodeVer = process.versions.node;
        if (semver.satisfies(this.nodeVer, '>10.0.0')) {
            this.nodeUse = true;
        } else {
            this.nodeUse = false;
        }
        if (this.nodeUse) {
            const perf = new PerfTimer(this.apiUrl, this.appId, this.appKey);
            const { start, end, store } = perf;
            this.start = start;
            this.end = end;
            this.store = store(); // returns the store instance
        } else {
            const hrt = new HrTimer(this.apiUrl, this.appId, this.appKey);
            const { start, end, store } = hrt;
            this.start = start;
            this.end = end;
            this.store = store(); // returns the store instance
        }

        if (trackIncomingRequest) {
            this._setUpIncomingListener(app);
        }
        if (trackOutgoingRequest) {
            this._setUpOutgoingListener();
        }

        // setup process handler here
        // listen for when the server is killed, terminated, unhandledRejection, or uncaughtException
        // send response back to our backend
        process.on('SIGINT', this._sendDataOnExit.bind(this));
        process.on('SIGTERM', this._sendDataOnExit.bind(this));
        process.on('SIGHUP', this._sendDataOnExit.bind(this));
        process.on('exit', this._sendDataOnExit.bind(this));
        process.on('unhandledRejection', this._sendDataOnExit.bind(this));
        process.on('uncaughtException', this._sendDataOnExit.bind(this));
    }
    async _sendDataOnExit() {
        await this.store.processDataOnExit();
    }
    _setUpOutgoingListener() {
        return new OutgoingListener(this.start, this.end, this.store);
    }
    setUpDataBaseListener() {
        // @ts-expect-error ts-migrate(2339) FIXME: Property '_load' does not exist on type 'typeof Mo... Remove this comment to see the full error message
        const load = Module._load;
        const _this = this;
        // @ts-expect-error ts-migrate(2339) FIXME: Property '_load' does not exist on type 'typeof Mo... Remove this comment to see the full error message
        Module._load = function(request: $TSFixMe, parent: $TSFixMe) {
            const res = load.apply(this, arguments);
            if (request === 'mongoose') {
                const mongo = new MongooseListener(_this.start, _this.end);
                return mongo._setUpMongooseListener(res);
            }
            return res;
        };
    }
    _setUpIncomingListener(app: $TSFixMe) {
        return new IncomingListener(this.start, this.end, this.store, app);
    }
}
export default PerformanceTracker;
