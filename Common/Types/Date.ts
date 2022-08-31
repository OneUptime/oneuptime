import PositiveNumber from './PositiveNumber';
import moment from 'moment';

export default class OneUptimeDate {
    public static getCurrentDate(): Date {
        return moment().toDate();
    }

    public static fromNow(date: Date): string {
        return moment(date).fromNow();
    }

    public static toString(date: Date): string {
        return date.toISOString();
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

    public static getSomeDaysAgoFromDate(
        date: Date,
        days: PositiveNumber | number
    ): Date {
        if (!(days instanceof PositiveNumber)) {
            days = new PositiveNumber(days);
        }
        return moment(date)
            .add(-1 * days.toNumber(), 'days')
            .toDate();
    }

    public static getSomeDaysAfterFromDate(
        date: Date,
        days: PositiveNumber | number
    ): Date {
        if (!(days instanceof PositiveNumber)) {
            days = new PositiveNumber(days);
        }
        return moment(date).add(Number(days.toNumber()), 'days').toDate();
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

    public static secondsToFormattedTimeString(seconds: number): string {
        return moment.utc(seconds * 1000).format('HH:mm:ss');
    }

    public static secondsToFormattedFriendlyTimeString(
        seconds: number
    ): string {
        const date: moment.Moment = moment.utc(seconds * 1000);
        const hours: string = date.format('HH');
        const mins: string = date.format('mm');
        const secs: string = date.format('ss');

        let text: string = '';
        let hasHours: boolean = false;
        let hasMins: boolean = false;
        if (hours !== '00') {
            hasHours = true;
            text += hours + ' hours';
        }

        if (mins !== '00' || hasHours) {
            hasMins = true;

            if (hasHours) {
                text += ', ';
            }

            text += mins + ' minutes';
        }

        if (!(hasHours && hasMins)) {
            text += secs + ' seconds. ';
        }

        return text;
    }

    public static getGreaterDate(a: Date, b: Date): Date {
        if (this.isAfter(a, b)) {
            return a;
        }

        return b;
    }

    public static getLesserDate(a: Date, b: Date): Date {
        if (this.isBefore(a, b)) {
            return a;
        }

        return b;
    }

    public static getSecondsBetweenDates(start: Date, end: Date): number {
        const duration: moment.Duration = moment.duration(
            moment(end).diff(moment(start))
        );
        return duration.asSeconds();
    }

    public static getSomeDaysAfterDate(
        date: Date,
        days: PositiveNumber | number
    ): Date {
        if (!(days instanceof PositiveNumber)) {
            days = new PositiveNumber(days);
        }

        return moment(date).add(days.toNumber(), 'days').toDate();
    }

    public static getSomeSecondsAfter(seconds: PositiveNumber | number): Date {
        if (!(seconds instanceof PositiveNumber)) {
            seconds = new PositiveNumber(seconds);
        }

        return this.getCurrentMomentDate()
            .add(seconds.toNumber(), 'seconds')
            .toDate();
    }

    public static getNumberOfDaysBetweenDates(
        startDate: Date,
        endDate: Date
    ): number {
        const a: moment.Moment = moment(startDate);
        const b: moment.Moment = moment(endDate);
        return b.diff(a, 'days');
    }

    public static getNumberOfDaysBetweenDatesInclusive(
        startDate: Date,
        endDate: Date
    ): number {
        return this.getNumberOfDaysBetweenDates(startDate, endDate) + 1;
    }

    public static momentToDate(moment: moment.Moment): Date {
        return moment.toDate();
    }

    public static getCurrentYear(): number {
        return moment().year();
    }

    public static getStartOfDay(date: Date): Date {
        return moment(date).startOf('day').toDate();
    }

    public static getEndOfDay(date: Date): Date {
        return moment(date).endOf('day').toDate();
    }

    public static isBetween(
        date: Date,
        startDate: Date,
        endDate: Date
    ): boolean {
        return moment(date).isBetween(startDate, endDate);
    }

    public static isAfter(date: Date, startDate: Date): boolean {
        return moment(date).isAfter(startDate);
    }

    public static isBefore(date: Date, endDate: Date): boolean {
        return moment(date).isBefore(endDate);
    }

    public static getCurrentDateAsFormattedString(): string {
        return this.getDateAsFormattedString(new Date());
    }

    public static getDateAsFormattedString(
        date: string | Date,
        onlyShowDate?: boolean
    ): string {
        let formatstring: string = 'MMMM Do YYYY, HH:mm';

        if (onlyShowDate) {
            formatstring = 'MMMM Do YYYY';
        }

        return moment(date).format(formatstring);
    }

    public static getDateAsLocalFormattedString(
        date: string | Date,
        onlyShowDate?: boolean
    ): string {
        let formatstring: string = 'MMMM Do YYYY, HH:mm';

        if (onlyShowDate) {
            formatstring = 'MMMM Do YYYY';
        }

        const momentDate: moment.Moment = moment(date).local();

        return momentDate.format(formatstring);
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
