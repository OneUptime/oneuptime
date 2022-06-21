import PositiveNumber from './PositiveNumber';
import moment from 'moment';

export default class OneUptimeDate {
    public static getCurrentDate(): Date {
        return moment().toDate();
    }

    public static fromNow(date: Date): string { 
        return moment(date).fromNow();
    }

    public static getCurrentMomentDate(): moment.Moment {
        return moment();
    }

    public static getOneMinAgo(): Date {
        return this.getSomeMinutesAgo(new PositiveNumber(1));
    }

    public static getOneDayAgo(): Date {
        return this.getSomeDaysAgo(new PositiveNumber(1));
    }

    public static getSomeMinutesAgo(minutes: PositiveNumber): Date {
        return this.getCurrentMomentDate()
            .add(-1 * minutes.toNumber(), 'minutes')
            .toDate();
    }

    public static getSomeHoursAgo(hours: PositiveNumber): Date {
        return this.getCurrentMomentDate()
            .add(-1 * hours.toNumber(), 'hours')
            .toDate();
    }

    public static getSomeDaysAgo(days: PositiveNumber): Date {
        return this.getCurrentMomentDate()
            .add(-1 * days.toNumber(), 'days')
            .toDate();
    }

    public static getSomeSecondsAgo(seconds: PositiveNumber): Date {
        return this.getCurrentMomentDate()
            .add(-1 * seconds.toNumber(), 'seconds')
            .toDate();
    }

    public static getOneMinAfter(): Date {
        return this.getSomeMinutesAfter(new PositiveNumber(1));
    }

    public static getOneDayAfter(): Date {
        return this.getSomeDaysAfter(new PositiveNumber(1));
    }

    public static getSomeMinutesAfter(minutes: PositiveNumber): Date {
        return this.getCurrentMomentDate()
            .add(minutes.toNumber(), 'minutes')
            .toDate();
    }

    public static getSomeHoursAfter(hours: PositiveNumber): Date {
        return this.getCurrentMomentDate()
            .add(hours.toNumber(), 'hours')
            .toDate();
    }

    public static getSomeDaysAfter(days: PositiveNumber): Date {
        return this.getCurrentMomentDate()
            .add(days.toNumber(), 'days')
            .toDate();
    }

    public static getSomeSecondsAfter(seconds: PositiveNumber): Date {
        return this.getCurrentMomentDate()
            .add(seconds.toNumber(), 'seconds')
            .toDate();
    }

    public static momentToDate(moment: moment.Moment): Date {
        return moment.toDate();
    }

    public static getCurrentYear(): number {
        return moment().year();
    }

    public static getCurrentDateAsFormattedString(): string {
        return moment().format('MMMM Do YYYY, HH:MM:SS');
    }
}
