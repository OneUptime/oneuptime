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

    public static getSecondsTo(date: Date): number {
        const dif: number = date.getTime() - this.getCurrentDate().getTime();
        const Seconds_from_T1_to_T2: number = dif / 1000;
        return Math.abs(Seconds_from_T1_to_T2);
    }

    public static getSomeMinutesAgo(minutes: PositiveNumber | number): Date {
        if (!(minutes instanceof PositiveNumber)) {
            minutes = new PositiveNumber(minutes);
        }

        return this.getCurrentMomentDate()
            .add(-1 * minutes.toNumber(), 'minutes')
            .toDate();
    }

    public static getSecondsInDays(days: PositiveNumber | number): number {
        if (!(days instanceof PositiveNumber)) {
            days = new PositiveNumber(days);
        }
        return days.positiveNumber * 24 * 60 * 60;
    }

    public static getSomeHoursAgo(hours: PositiveNumber | number): Date {
        if (!(hours instanceof PositiveNumber)) {
            hours = new PositiveNumber(hours);
        }
        return this.getCurrentMomentDate()
            .add(-1 * hours.toNumber(), 'hours')
            .toDate();
    }

    public static getSomeDaysAgo(days: PositiveNumber | number): Date {
        if (!(days instanceof PositiveNumber)) {
            days = new PositiveNumber(days);
        }
        return this.getCurrentMomentDate()
            .add(-1 * days.toNumber(), 'days')
            .toDate();
    }

    public static getSomeSecondsAgo(seconds: PositiveNumber | number): Date {
        if (!(seconds instanceof PositiveNumber)) {
            seconds = new PositiveNumber(seconds);
        }

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

    public static getSomeMinutesAfter(minutes: PositiveNumber | number): Date {
        if (!(minutes instanceof PositiveNumber)) {
            minutes = new PositiveNumber(minutes);
        }

        return this.getCurrentMomentDate()
            .add(minutes.toNumber(), 'minutes')
            .toDate();
    }

    public static getSomeHoursAfter(hours: PositiveNumber | number): Date {
        if (!(hours instanceof PositiveNumber)) {
            hours = new PositiveNumber(hours);
        }
        return this.getCurrentMomentDate()
            .add(hours.toNumber(), 'hours')
            .toDate();
    }

    public static getSomeDaysAfter(days: PositiveNumber | number): Date {
        if (!(days instanceof PositiveNumber)) {
            days = new PositiveNumber(days);
        }

        return this.getCurrentMomentDate()
            .add(days.toNumber(), 'days')
            .toDate();
    }

    public static getSomeSecondsAfter(seconds: PositiveNumber | number): Date {
        if (!(seconds instanceof PositiveNumber)) {
            seconds = new PositiveNumber(seconds);
        }

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
        return this.getDateAsFormattedString(new Date());
    }

    public static getDateAsFormattedString(
        date: string | Date,
        onlyShowDate?: boolean
    ): string {
        let formatstring: string = 'MMMM Do YYYY, HH:MM:SS';

        if (onlyShowDate) {
            formatstring = 'MMMM Do YYYY';
        }

        return moment(date).format(formatstring);
    }

    public static getDateAsLocalFormattedString(
        date: string | Date,
        onlyShowDate?: boolean
    ): string {
        let formatstring: string = 'MMMM Do YYYY, HH:MM:SS';

        if (onlyShowDate) {
            formatstring = 'MMMM Do YYYY';
        }
        return moment(date).local().format(formatstring);
    }

    public static isInThePast(date: string | Date): boolean {
        return moment(date).isBefore(new Date());
    }

    public static isInTheFuture(date: string | Date): boolean {
        return moment(date).isAfter(new Date());
    }

    public static fromString(date: string): Date {
        return moment(date).toDate();
    }

    public static asDateForDatabaseQuery(date: string | Date): string {
        const formatstring: string = 'YYYY-MM-DD';
        return moment(date).local().format(formatstring);
    }
}
