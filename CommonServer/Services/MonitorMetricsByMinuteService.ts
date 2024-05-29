import ClickhouseDatabase from '../Infrastructure/ClickhouseDatabase';
import AnalyticsDatabaseService from './AnalyticsDatabaseService';
import MonitorMetricsByMinute from 'Model/AnalyticsModels/MonitorMetricsByMinute';

export class MonitorMetricsByMinuteService extends AnalyticsDatabaseService<MonitorMetricsByMinute> {
    public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
        super({
            modelType: MonitorMetricsByMinute,
            database: clickhouseDatabase,
        });
    }
}

export default new MonitorMetricsByMinuteService();
