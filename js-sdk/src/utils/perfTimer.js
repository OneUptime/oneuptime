'use strict';
/* eslint-disable no-console */
/*eslint-disable no-unused-vars*/
import { performance, PerformanceObserver } from 'perf_hooks';
import DataStore from './dataStore';
class PerfTimer {
    #dataStore;
    #apiUrl;
    #appId;
    constructor(apiUrl, appId) {
        this.#apiUrl = apiUrl;
        this.#appId = appId;
        this.#dataStore = new DataStore(this.#apiUrl, this.#appId);
        this.obs = new PerformanceObserver((list, observer) => {
            const entry = list.getEntries()[0];
            const id = entry.name.slice(entry.name.indexOf('-') + 1);
            const originalValue = this.#dataStore.getValue(id);
            if (originalValue && originalValue !== undefined) {
                originalValue.duration = entry.duration;
                this.#dataStore.setData(originalValue);
                this.#dataStore.destroy(id);
            }
            performance.clearMarks();
            // observer.disconnect();
        });
        this.obs.observe({ entryTypes: ['measure'] });
    }

    start = (id, log) => {
        this.#dataStore.setValue(id, log);
        return performance.mark(`start-${id}`);
    };

    end = (id, result, type) => {
        performance.mark(`end-${id}`);
        return performance.measure(`${type}-${id}`, `start-${id}`, `end-${id}`);
    };
}
export default PerfTimer;
