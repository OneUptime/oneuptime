import DataStore from './dataStore';
class HrTimer {
    private dataStore;
    private apiUrl;
    private appId;
    private appKey;
    constructor(apiUrl: $TSFixMe, appId: $TSFixMe, appKey: $TSFixMe) {
        this.apiUrl = apiUrl;
        this.appId = appId;
        this.appKey = appKey;
        this.dataStore = new DataStore(this.apiUrl, this.appId, this.appKey);
    }

    start = (id: $TSFixMe, log: $TSFixMe) => {
        this.dataStore.setValue(id, log);
        return process.hrtime();
    };

    end = (id: $TSFixMe, startHrTime: $TSFixMe, type: $TSFixMe) => {
        let elapsedHrTime = process.hrtime(startHrTime);
        // @ts-expect-error ts-migrate(2322) FIXME: Type 'number' is not assignable to type '[number, ... Remove this comment to see the full error message
        elapsedHrTime = elapsedHrTime[0] * 1000 + elapsedHrTime[1] / 1e6;
        const originalValue = this.dataStore.getValue(id);
        if (originalValue && originalValue !== undefined) {
            originalValue.duration = elapsedHrTime;
            // @ts-expect-error ts-migrate(2554) FIXME: Expected 1 arguments, but got 2.
            this.dataStore.setData(id, originalValue);
            this.dataStore.destroy(id);
        }
        return;
    };

    store = () => this.dataStore;
}
export default HrTimer;
