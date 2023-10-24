import MetricGauge from 'Model/AnalyticsModels/MetricGauge';
import AnalyticsDatabaseService from './AnalyticsDatabaseService';
import ClickhouseDatabase from '../Infrastructure/ClickhouseDatabase';

export class MetricGaugeService extends AnalyticsDatabaseService<MetricGauge> {
    public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
        super({ modelType: MetricGauge, database: clickhouseDatabase });
    }
}

export default new MetricGaugeService();
