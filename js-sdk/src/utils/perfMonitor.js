'use strict';
/* eslint-disable no-console */
/*eslint-disable no-unused-vars*/
import { performance, PerformanceObserver } from 'perf_hooks';
import DataStore from './dataStore';

const idStore = new DataStore();
const dataStore = new DataStore();

const obs = new PerformanceObserver((list, observer) => {
    const entry = list.getEntries()[0];
    const id = entry.name.slice(entry.name.indexOf('-') + 1);
    const originalValue = idStore.getValue(id);
    if (originalValue && originalValue !== undefined) {
        originalValue.duration = entry.duration;
        dataStore.setValue(id, originalValue);
        idStore.destroy(id);
    }
    if (dataStore.getAllValue().size > 2) {
        console.log('perfmonitor', dataStore.getAllValue());
    }
    performance.clearMarks();
    // observer.disconnect();
});
obs.observe({ entryTypes: ['measure'] });

const start = (id, log) => {
    idStore.setValue(id, log);
    return performance.mark(`start-${id}`);
};

const end = (id, result, type) => {
    performance.mark(`end-${id}`);
    return performance.measure(`${type}-${id}`, `start-${id}`, `end-${id}`);
};

export { start, end };
