import Log from 'Model/Models/Log';
import AnalyticsDatabaseService from './AnalyticsDatabaseService';
import ClickhouseDatabase from '../Infrastructure/ClickhouseDatabase';

export class Service extends AnalyticsDatabaseService<Log> {
    public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
        super({ modelType: Log, database: clickhouseDatabase });
    }
}
export default new Service();
