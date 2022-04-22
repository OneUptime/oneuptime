import { performance, PerformanceObserver } from 'perf_hooks';
import DataStore from './dataStore';
class PerfTimer {
    private obs: $TSFixMe;
    private dataStore;
    private apiUrl;
    private appId;
    private appKey;
    public constructor(apiUrl: URL, appId: $TSFixMe, appKey: $TSFixMe) {
        this.apiUrl = apiUrl;
        this.appId = appId;
        this.appKey = appKey;
        this.dataStore = new DataStore(this.apiUrl, this.appId, this.appKey);
        this.obs = new PerformanceObserver((list: $TSFixMe) => {
            const entry: $TSFixMe = list.getEntries()[0];
            const id: $TSFixMe = entry.name.slice(entry.name.indexOf('-') + 1);
            const originalValue: $TSFixMe = this.dataStore.getValue(id);
            if (originalValue && originalValue !== undefined) {
                originalValue.duration = entry.duration;
                this.dataStore.setData(originalValue);
                this.dataStore.destroy(id);
            }
            performance.clearMarks();
            // Observer.disconnect();
        });
        this.obs.observe({ entryTypes: ['measure'] });
    }

    public start(id: $TSFixMe, log: $TSFixMe): void {
        this.dataStore.setValue(id, log);
        return performance.mark(`start-${id}`);
    }

    public end(id: $TSFixMe, result: $TSFixMe, type: $TSFixMe): void {
        performance.mark(`end-${id}`);
        return performance.measure(`${type}-${id}`, `start-${id}`, `end-${id}`);
    }

    public store(): void {
        return this.dataStore;
    }
}
export default PerfTimer;
