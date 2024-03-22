import MonitorMetricsByMinute from 'Model/AnalyticsModels/MonitorMetricsByMinute';
import AnalyticsDatabaseService from './AnalyticsDatabaseService';
import ClickhouseDatabase from '../Infrastructure/ClickhouseDatabase';

export class MonitorMetricsByMinuteService extends AnalyticsDatabaseService<MonitorMetricsByMinute> {
    public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
        super({
            modelType: MonitorMetricsByMinute,
            database: clickhouseDatabase,
        });
    }
}

export default new MonitorMetricsByMinuteService();
