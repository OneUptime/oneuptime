import CronParser from 'cron-parser';

export default class CronTab {
    public static getNextExecutionTime(crontab: string): Date {
        const interval = CronParser.parseExpression(crontab);
        const nextExecutionTime = interval.next().toDate();
        return nextExecutionTime;
      }
}