import BadDataException from 'Common/Types/Exception/BadDataException';
import CronParser, { CronExpression } from 'cron-parser';

export default class CronTab {
    public static getNextExecutionTime(crontab: string): Date {
        try {
            const interval: CronExpression =
                CronParser.parseExpression(crontab);
            const nextExecutionTime: Date = interval.next().toDate();
            return nextExecutionTime;
        } catch (error) {
            throw new BadDataException(`Invalid cron expression: ${crontab}`);
        }
    }
}
