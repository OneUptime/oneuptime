'use strict';
/* eslint-disable no-console */
/*eslint-disable no-unused-vars*/
import DataStore from './dataStore';

const idStore = new DataStore();
const dataStore = new DataStore();
const start = (id, log) => {
    idStore.setValue(id, log);
    return process.hrtime();
};

const end = (id, startHrTime, type) => {
    let elapsedHrTime = process.hrtime(startHrTime);
    elapsedHrTime = elapsedHrTime[0] * 1000 + elapsedHrTime[1] / 1e6;
    const originalValue = idStore.getValue(id);
    if (originalValue && originalValue !== undefined) {
        originalValue.duration = elapsedHrTime;
        dataStore.setValue(id, originalValue);
        idStore.destroy(id);
    }
    return;
};

export { start, end };
