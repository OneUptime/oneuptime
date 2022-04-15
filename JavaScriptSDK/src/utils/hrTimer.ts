import DataStore from './dataStore';
class HrTimer {
    private dataStore;
    private apiUrl;
    private appId;
    private appKey;
    constructor(apiUrl: URL, appId: $TSFixMe, appKey: $TSFixMe) {
        this.apiUrl = apiUrl;
        this.appId = appId;
        this.appKey = appKey;
        this.dataStore = new DataStore(this.apiUrl, this.appId, this.appKey);
    }

    start = (id: $TSFixMe, log: $TSFixMe): void => {
        this.dataStore.setValue(id, log);
        return process.hrtime();
    };

    end = (id: $TSFixMe, startHrTime: $TSFixMe): void => {
        let elapsedHrTime: $TSFixMe = process.hrtime(startHrTime);

        elapsedHrTime = elapsedHrTime[0] * 1000 + elapsedHrTime[1] / 1e6;
        const originalValue: $TSFixMe = this.dataStore.getValue(id);
        if (originalValue && originalValue !== undefined) {
            originalValue.duration = elapsedHrTime;

            this.dataStore.setData(id, originalValue);
            this.dataStore.destroy(id);
        }
        return;
    };

    store = (): void => {
        return this.dataStore;
    };
}
export default HrTimer;
