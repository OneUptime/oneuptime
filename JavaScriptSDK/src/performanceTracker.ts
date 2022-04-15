import Module from 'module';

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
    public constructor({
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
            const perf: $TSFixMe = new PerfTimer(
                this.apiUrl,
                this.appId,
                this.appKey
            );
            const { start, end, store } = perf;
            this.start = start;
            this.end = end;
            this.store = store(); // returns the store instance
        } else {
            const hrt: $TSFixMe = new HrTimer(
                this.apiUrl,
                this.appId,
                this.appKey
            );
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
    async _sendDataOnExit(): void {
        await this.store.processDataOnExit();
    }
private _setUpOutgoingListener(): void {
        return new OutgoingListener(this.start, this.end, this.store);
    }
    setUpDataBaseListener(): void {
        const load: $TSFixMe = Module._load;

        Module._load = function (request: $TSFixMe): void {
            const res: $TSFixMe = load.apply(this, arguments);
            if (request === 'mongoose') {
                const mongo: $TSFixMe = new MongooseListener(
                    this.start,
                    this.end
                );
                return mongo._setUpMongooseListener(res);
            }
            return res;
        };
    }
private _setUpIncomingListener(app: $TSFixMe): void {
        return new IncomingListener(this.start, this.end, this.store, app);
    }
}
export default PerformanceTracker;
