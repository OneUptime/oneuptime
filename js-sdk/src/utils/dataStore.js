'use strict';
/* eslint-disable no-console */
/*eslint-disable no-unused-vars*/
import axios from 'axios';
const cron = require('node-cron');
class DataStore {
    #store;
    #incoming;
    #outgoing;
    #mongoose;
    #apiUrl;
    #appId;
    #appKey;
    constructor(url, appId, appKey) {
        this.#apiUrl = url;
        this.#appId = appId;
        this.#appKey = appKey;
        this.#store = new Map();
        this.#incoming = new Map();
        this.#outgoing = new Map();
        this.#mongoose = new Map();
        this.runCron();
    }
    runCron() {
        const _this = this;
        return cron.schedule('5 * * * *', () => {
            _this.sendData();
        });
    }
    mapValue(path, store, time) {
        if (store.has(path)) {
            const s = store.get(path);
            return {
                requests: s.requests + 1,
                avgTime: (s.avgTime * s.requests + time) / s.requests + 1,
                maxTime: s.maxTime < time ? time : s.maxTime,
            };
        } else {
            return { requests: 1, avgTime: time, maxTime: time };
        }
    }
    destroy(id) {
        if (this.#store.has(id)) {
            this.#store.delete(id);
        }
    }

    getValue(id) {
        return this.#store.get(id);
    }

    getAllData() {
        return {
            incoming: this.#incoming,
            outgoing: this.#outgoing,
            mongoose: this.#mongoose,
        };
    }
    clear() {
        return this.#store.clear();
    }
    clearData() {
        this.#incoming.clear();
        this.#outgoing.clear();
        this.#mongoose.clear();
        return {};
    }
    setData(value) {
        const type = value.type;
        const path = value.path;
        const time = value.duration;
        let val = {};
        if (type === 'incoming') {
            val = this.mapValue(path, this.#incoming, time);
            return this.#incoming.set(path, val);
        } else if (type === 'outgoing') {
            val = this.mapValue(path, this.#outgoing, time);
            return this.#outgoing.set(path, val);
        } else if (type === 'mongoose') {
            val = this.mapValue(path, this.#mongoose, time);
            return this.#mongoose.set(path, val);
        }
    }
    setValue(id, value) {
        return this.#store.set(id, value);
    }
    async sendData() {
        const data = {
            incoming: Object.fromEntries(this.#incoming),
            outgoing: Object.fromEntries(this.#outgoing),
            mongoose: Object.fromEntries(this.#mongoose),
            sentAt: Date.now(),
        };
        await this._makeApiRequest(data);
        this.clearData();
    }
    _makeApiRequest(data) {
        console.log(data);
        return new Promise((resolve, reject) => {
            axios
                .post(`${this.#apiUrl}/${this.#appId}`, data)
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
