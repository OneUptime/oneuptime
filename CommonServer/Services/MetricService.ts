import Metric from 'Model/AnalyticsModels/Metric';
import AnalyticsDatabaseService from './AnalyticsDatabaseService';
import ClickhouseDatabase from '../Infrastructure/ClickhouseDatabase';

export class MetricService extends AnalyticsDatabaseService<Metric> {
    public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
        super({ modelType: Metric, database: clickhouseDatabase });
    }
}
export default new MetricService();
