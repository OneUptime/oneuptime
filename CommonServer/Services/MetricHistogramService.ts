import MetricHistogram from 'Model/AnalyticsModels/MetricHistogram';
import AnalyticsDatabaseService from './AnalyticsDatabaseService';
import ClickhouseDatabase from '../Infrastructure/ClickhouseDatabase';

export class MetricHistogramService extends AnalyticsDatabaseService<MetricHistogram> {
    public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
        super({ modelType: MetricHistogram, database: clickhouseDatabase });
    }
}

export default new MetricHistogramService();
