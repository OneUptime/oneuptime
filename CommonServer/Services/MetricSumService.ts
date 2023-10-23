import MetricSum from 'Model/AnalyticsModels/MetricSum';
import AnalyticsDatabaseService from './AnalyticsDatabaseService';
import ClickhouseDatabase from '../Infrastructure/ClickhouseDatabase';

export class MetricSumService extends AnalyticsDatabaseService<MetricSum> {
    public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
        super({ modelType: MetricSum, database: clickhouseDatabase });
    }
}

export default new MetricSumService();
