import axios from 'axios';

import cron from 'node-cron';
class DataStore {
    private store;
    private incoming;
    private outgoing;
    private mongoose;
    private apiUrl;
    private appId;
    private appKey;
    private sendingData;
    constructor(url: string, appId: $TSFixMe, appKey: $TSFixMe) {
        this.apiUrl = url;
        this.appId = appId;
        this.appKey = appKey;
        this.store = new Map();
        this.incoming = new Map();
        this.outgoing = new Map();
        this.mongoose = new Map();
        this.sendingData = false;
        this.runCron();
    }
    runCron() {
        const _this = this;
        return cron.schedule('*/5 * * * *', () => {
            _this.sendData();
        });
    }
    mapValue(
        path: $TSFixMe,
        store: $TSFixMe,
        time: $TSFixMe,
        method: $TSFixMe,
        errorCount: $TSFixMe
    ) {
        if (store.has(path)) {
            const s = store.get(path);
            const avg = s.avgTime,
                rq = s.requests,
                ct = time;
            let avgTime = avg * rq + ct;
            avgTime = avgTime / (rq + 1);
            return {
                requests: s.requests + 1,
                avgTime: avgTime,
                maxTime: s.maxTime < time ? time : s.maxTime,
                method: s.method,
                errorCount: s.errorCount + errorCount,
            };
        } else {
            return {
                requests: 1,
                avgTime: time,
                maxTime: time,
                method,
                errorCount,
            };
        }
    }
    destroy(id: $TSFixMe) {
        if (this.store.has(id)) {
            this.store.delete(id);
        }
    }

    getValue(id: $TSFixMe) {
        return this.store.get(id);
    }

    getAllData() {
        return {
            incoming: this.incoming,
            outgoing: this.outgoing,
            mongoose: this.mongoose,
        };
    }
    clear() {
        return this.store.clear();
    }
    clearData() {
        this.incoming.clear();
        this.outgoing.clear();
        this.mongoose.clear();
        return {};
    }
    setData(value: $TSFixMe) {
        const type = value.type;
        const path = value.path;
        const time = value.duration;
        const method = value.method;
        const errorCount = value.errorCount || 0;
        let val = {};
        if (type === 'incoming') {
            val = this.mapValue(path, this.incoming, time, method, errorCount);
            return this.incoming.set(path, val);
        } else if (type === 'outgoing') {
            val = this.mapValue(path, this.outgoing, time, method, errorCount);
            return this.outgoing.set(path, val);
        } else if (type === 'mongoose') {
            val = this.mapValue(path, this.mongoose, time);
            return this.mongoose.set(path, val);
        }
    }
    setValue(id: $TSFixMe, value: $TSFixMe) {
        return this.store.set(id, value);
    }
    async sendData() {
        const data = {
            incoming: Object.fromEntries(this.incoming),

            outgoing: Object.fromEntries(this.outgoing),

            mongoose: Object.fromEntries(this.mongoose),
            sentAt: Date.now(),
        };
        await this._makeApiRequest(data);
        this.clearData();
    }
    async processDataOnExit() {
        if (!this.sendingData) {
            this.sendingData = true;

            const data = {
                incoming: Object.fromEntries(this.incoming),

                outgoing: Object.fromEntries(this.outgoing),

                mongoose: Object.fromEntries(this.mongoose),
                sentAt: Date.now(),
            };
            await this._makeApiRequest(data);
            this.clearData();
            process.exit(1);
        }
    }
    _makeApiRequest(data: $TSFixMe) {
        return new Promise((resolve, reject) => {
            axios
                .post(
                    `${this.apiUrl}/performanceMetric/${this.appId}/key/${this.appKey}`,
                    data
                )
                .then(res => {
                    resolve(res);
                })
                .catch(err => {
                    reject(err);
                });
        });
    }
}
export default DataStore;
