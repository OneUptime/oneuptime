import ClickhouseDatabase from '../Infrastructure/ClickhouseDatabase';
import AnalyticsDatabaseService from './AnalyticsDatabaseService';
import MetricSum from 'Model/AnalyticsModels/Metric';

export class MetricService extends AnalyticsDatabaseService<MetricSum> {
    public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
        super({ modelType: MetricSum, database: clickhouseDatabase });
    }
}

export default new MetricService();
