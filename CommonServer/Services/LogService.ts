import Log from 'Model/AnalyticsModels/Log';
import AnalyticsDatabaseService from './AnalyticsDatabaseService';
import ClickhouseDatabase from '../Infrastructure/ClickhouseDatabase';

export class LogService extends AnalyticsDatabaseService<Log> {
    public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
        super({ modelType: Log, database: clickhouseDatabase });
    }
}
export default new LogService();
