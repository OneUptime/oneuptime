'use strict';
/* eslint-disable no-console */
/*eslint-disable no-unused-vars*/

class DataStore {
    #store;
    #incoming;
    #outgoing;
    #mongoose;
    constructor() {
        this.#store = new Map();
        this.#incoming = new Map();
        this.#outgoing = new Map();
        this.#mongoose = new Map();
    }
    mapValue(path, store, time) {
        //const date = new Date();
        // const minutes = date.getMinutes();
        if (store.has(path)) {
            const s = store.get(path);
            return {
                requests: s.requests + 1,
                avgTime: (s.avgTime * s.requests + time) / s.requests + 1,
            };
        } else {
            return { requests: 1, avgTime: time };
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

    getAllValue() {
        return this.#store;
    }
    clear() {
        return this.#store.clear();
    }
    async setValue(id, value) {
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
    async cleanup() {
        //send data to server
        this.clear();
        return {};
    }
}
export default DataStore;
