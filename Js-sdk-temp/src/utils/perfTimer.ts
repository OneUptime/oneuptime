import { performance, PerformanceObserver } from 'perf_hooks';
import DataStore from './dataStore';
class PerfTimer {
    obs: $TSFixMe;
    private dataStore;
    private apiUrl;
    private appId;
    private appKey;
    constructor(apiUrl: URL, appId: $TSFixMe, appKey: $TSFixMe) {
        this.apiUrl = apiUrl;
        this.appId = appId;
        this.appKey = appKey;
        this.dataStore = new DataStore(this.apiUrl, this.appId, this.appKey);
        this.obs = new PerformanceObserver(list => {
            const entry = list.getEntries()[0];
            const id = entry.name.slice(entry.name.indexOf('-') + 1);
            const originalValue = this.dataStore.getValue(id);
            if (originalValue && originalValue !== undefined) {
                originalValue.duration = entry.duration;
                this.dataStore.setData(originalValue);
                this.dataStore.destroy(id);
            }
            performance.clearMarks();
            // observer.disconnect();
        });
        this.obs.observe({ entryTypes: ['measure'] });
    }

    start = (id: $TSFixMe, log: $TSFixMe) => {
        this.dataStore.setValue(id, log);
        return performance.mark(`start-${id}`);
    };

    end = (id: $TSFixMe, result: $TSFixMe, type: $TSFixMe) => {
        performance.mark(`end-${id}`);
        return performance.measure(`${type}-${id}`, `start-${id}`, `end-${id}`);
    };

    store = () => this.dataStore;
}
export default PerfTimer;
