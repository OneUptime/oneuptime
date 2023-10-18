import Span from 'Model/AnalyticsModels/Span';
import AnalyticsDatabaseService from './AnalyticsDatabaseService';
import ClickhouseDatabase from '../Infrastructure/ClickhouseDatabase';

export class SpanService extends AnalyticsDatabaseService<Span> {
    public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
        super({ modelType: Span, database: clickhouseDatabase });
    }
}
export default new SpanService();
