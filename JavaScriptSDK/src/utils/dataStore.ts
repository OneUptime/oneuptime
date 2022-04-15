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
    constructor(url: URL, appId: $TSFixMe, appKey: $TSFixMe) {
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
    public runCron(): void {
        return cron.schedule('*/5 * * * *', () => {
            this.sendData();
        });
    }
    public mapValue(
        path: $TSFixMe,
        store: $TSFixMe,
        time: $TSFixMe,
        method: $TSFixMe,
        errorCount: $TSFixMe
    ): void {
        if (store.has(path)) {
            const s: $TSFixMe = store.get(path);
            const avg: $TSFixMe = s.avgTime,
                rq = s.requests,
                ct = time;
            let avgTime: $TSFixMe = avg * rq + ct;
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
    public destroy(id: $TSFixMe): void {
        if (this.store.has(id)) {
            this.store.delete(id);
        }
    }

    public getValue(id: $TSFixMe): void {
        return this.store.get(id);
    }

    public getAllData(): void {
        return {
            incoming: this.incoming,
            outgoing: this.outgoing,
            mongoose: this.mongoose,
        };
    }
    public clear(): void {
        return this.store.clear();
    }
    public clearData(): void {
        this.incoming.clear();
        this.outgoing.clear();
        this.mongoose.clear();
        return {};
    }
    public setData(value: $TSFixMe): void {
        const type: $TSFixMe = value.type;
        const path: $TSFixMe = value.path;
        const time: $TSFixMe = value.duration;
        const method: $TSFixMe = value.method;
        const errorCount: $TSFixMe = value.errorCount || 0;
        let val: $TSFixMe = {};
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
    public setValue(id: $TSFixMe, value: $TSFixMe): void {
        return this.store.set(id, value);
    }
    public async sendData(): void {
        const data: $TSFixMe = {
            incoming: Object.fromEntries(this.incoming),

            outgoing: Object.fromEntries(this.outgoing),

            mongoose: Object.fromEntries(this.mongoose),
            sentAt: Date.now(),
        };
        await this._makeApiRequest(data);
        this.clearData();
    }
    public async processDataOnExit(): void {
        if (!this.sendingData) {
            this.sendingData = true;

            const data: $TSFixMe = {
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
    private _makeApiRequest(data: $TSFixMe): void {
        return new Promise((resolve: Function, reject: Function) => {
            axios
                .post(
                    `${this.apiUrl}/performanceMetric/${this.appId}/key/${this.appKey}`,
                    data
                )
                .then((res: $TSFixMe) => {
                    resolve(res);
                })
                .catch((err: $TSFixMe) => {
                    reject(err);
                });
        });
    }
}
export default DataStore;
