import CronParser, { CronExpression } from 'cron-parser';

export default class CronTab {
    public static getNextExecutionTime(crontab: string): Date {
        const interval: CronExpression = CronParser.parseExpression(crontab);
        const nextExecutionTime: Date = interval.next().toDate();
        return nextExecutionTime;
    }
}
