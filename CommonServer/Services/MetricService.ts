import MetricSum from 'Model/AnalyticsModels/Metric';
import AnalyticsDatabaseService from './AnalyticsDatabaseService';
import ClickhouseDatabase from '../Infrastructure/ClickhouseDatabase';

export class MetricService extends AnalyticsDatabaseService<MetricSum> {
    public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
        super({ modelType: MetricSum, database: clickhouseDatabase });
    }
}

export default new MetricService();
