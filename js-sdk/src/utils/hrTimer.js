'use strict';
/* eslint-disable no-console */
/*eslint-disable no-unused-vars*/
import DataStore from './dataStore';
class HrTimer {
    #dataStore;
    #apiUrl;
    #appId;
    constructor(apiUrl, appId) {
        this.#apiUrl = apiUrl;
        this.#appId = appId;
        this.#dataStore = new DataStore(this.#apiUrl, this.#appId);
    }

    start = (id, log) => {
        this.#dataStore.setValue(id, log);
        return process.hrtime();
    };

    end = (id, startHrTime, type) => {
        let elapsedHrTime = process.hrtime(startHrTime);
        elapsedHrTime = elapsedHrTime[0] * 1000 + elapsedHrTime[1] / 1e6;
        const originalValue = this.#dataStore.getValue(id);
        if (originalValue && originalValue !== undefined) {
            originalValue.duration = elapsedHrTime;
            this.#dataStore.setData(id, originalValue);
            this.#dataStore.destroy(id);
        }
        return;
    };
}
export default HrTimer;
