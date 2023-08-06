import InBetween from './Database/InBetween';
import BadDataException from './Exception/BadDataException';
import { JSONObject, ObjectType } from './JSON';
import PositiveNumber from './PositiveNumber';
import moment from 'moment-timezone';

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
        date = this.fromString(date);
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

    public static timezoneOffsetDate(date: Date): Date {
        date = this.fromString(date);
        return this.addRemoveMinutes(date, date.getTimezoneOffset());
    }

    public static toDateTimeLocalString(date: Date): string {
        date = this.fromString(date);
        const ten: Function = (i: number): string => {
                return (i < 10 ? '0' : '') + i;
            },
            YYYY: number = date.getFullYear(),
            MM: number = ten(date.getMonth() + 1),
            DD: number = ten(date.getDate()),
            HH: number = ten(date.getHours()),
            II: number = ten(date.getMinutes()),
            SS: number = ten(date.getSeconds());

        return YYYY + '-' + MM + '-' + DD + 'T' + HH + ':' + II + ':' + SS;
    }

    public static fromJSON(json: JSONObject): Date {
        if (json['_type'] === ObjectType.DateTime) {
            return OneUptimeDate.fromString(json['value'] as string);
        }

        throw new BadDataException('Invalid JSON: ' + JSON.stringify(json));
    }

    public static toJSON(date: Date): JSONObject {
        return {
            _type: ObjectType.DateTime,
            value: OneUptimeDate.toString(date),
        };
    }

    public static addRemoveMinutes(date: Date, minutes: number): Date {
        date = this.fromString(date);
        return moment(date).add(minutes, 'minutes').toDate();
    }

    public static addRemoveSeconds(date: Date, seconds: number): Date {
        date = this.fromString(date);
        return moment(date).add(seconds, 'seconds').toDate();
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
        date = this.fromString(date);
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
        date = this.fromString(date);
        if (!(days instanceof PositiveNumber)) {
            days = new PositiveNumber(days);
        }
        return moment(date).add(Number(days.toNumber()), 'days').toDate();
    }

    public static getSomeDaysBeforeFromDate(
        date: Date,
        days: PositiveNumber | number
    ): Date {
        date = this.fromString(date);
        if (!(days instanceof PositiveNumber)) {
            days = new PositiveNumber(days);
        }
        return moment(date)
            .add(-1 * Number(days.toNumber()), 'days')
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

    public static secondsToFormattedTimeString(seconds: number): string {
        return moment.utc(seconds * 1000).format('HH:mm:ss');
    }

    public static toUnixTimestamp(date: Date): number {
        return Math.floor(date.getTime() / 1000);
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
        a = this.fromString(a);
        b = this.fromString(b);
        if (this.isAfter(a, b)) {
            return a;
        }

        return b;
    }

    public static getLesserDate(a: Date, b: Date): Date {
        a = this.fromString(a);
        b = this.fromString(b);
        if (this.isBefore(a, b)) {
            return a;
        }

        return b;
    }

    public static getSecondsBetweenDates(start: Date, end: Date): number {
        start = this.fromString(start);
        end = this.fromString(end);
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

    public static getNumberOfMinutesBetweenDates(
        startDate: Date,
        endDate: Date
    ): number {
        const a: moment.Moment = moment(startDate);
        const b: moment.Moment = moment(endDate);
        return b.diff(a, 'minutes');
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
        date = this.fromString(date);
        return moment(date).startOf('day').toDate();
    }

    public static getEndOfDay(date: Date): Date {
        date = this.fromString(date);
        return moment(date).endOf('day').toDate();
    }

    public static isBetween(
        date: Date,
        startDate: Date,
        endDate: Date
    ): boolean {
        date = this.fromString(date);
        startDate = this.fromString(startDate);
        endDate = this.fromString(endDate);
        return moment(date).isBetween(startDate, endDate);
    }

    public static isAfter(date: Date, startDate: Date): boolean {
        date = this.fromString(date);
        startDate = this.fromString(startDate);
        return moment(date).isAfter(startDate);
    }

    public static hasExpired(expirationDate: Date): boolean {
        expirationDate = this.fromString(expirationDate);
        return !moment(this.getCurrentDate()).isBefore(expirationDate);
    }

    public static isBefore(date: Date, endDate: Date): boolean {
        date = this.fromString(date);
        endDate = this.fromString(endDate);
        return moment(date).isBefore(endDate);
    }

    public static getCurrentDateAsFormattedString(): string {
        return this.getDateAsFormattedString(new Date());
    }

    public static getDateAsFormattedString(
        date: string | Date,
        onlyShowDate?: boolean
    ): string {
        date = this.fromString(date);

        let formatstring: string = 'MMM DD YYYY, HH:mm';

        if (onlyShowDate) {
            formatstring = 'MMM DD, YYYY';
        }

        return (
            moment(date).format(formatstring) +
            ' ' +
            (onlyShowDate ? '' : this.getCurrentTimezoneString())
        );
    }

    public static getDifferenceInMinutes(date: Date, date2: Date): number {
        date = this.fromString(date);
        date2 = this.fromString(date2);
        const minutes: number = moment(date).diff(moment(date2), 'minutes');

        if (minutes < 0) {
            return minutes * -1;
        }

        return minutes;
    }

    public static getDateAsFormattedArrayInMultipleTimezones(
        date: string | Date,
        onlyShowDate?: boolean
    ): Array<string> {
        date = this.fromString(date);

        let formatstring: string = 'MMM DD YYYY, HH:mm';

        if (onlyShowDate) {
            formatstring = 'MMM DD, YYYY';
        }

        // convert this date into GMT, EST, PST, IST, ACT with moment
        const timezoneDates: Array<string> = [];

        timezoneDates.push(
            moment(date).tz('UTC').format(formatstring) +
                ' ' +
                (onlyShowDate ? '' : 'GMT')
        );
        timezoneDates.push(
            moment(date).tz('America/New_York').format(formatstring) +
                ' ' +
                (onlyShowDate ? '' : 'EST')
        );
        timezoneDates.push(
            moment(date).tz('America/Los_Angeles').format(formatstring) +
                ' ' +
                (onlyShowDate ? '' : 'PST')
        );
        timezoneDates.push(
            moment(date).tz('Asia/Kolkata').format(formatstring) +
                ' ' +
                (onlyShowDate ? '' : 'IST')
        );
        timezoneDates.push(
            moment(date).tz('Australia/Sydney').format(formatstring) +
                ' ' +
                (onlyShowDate ? '' : 'AEST')
        );

        return timezoneDates;
    }

    public static getDateAsFormattedHTMLInMultipleTimezones(
        date: string | Date,
        onlyShowDate?: boolean
    ): string {
        return this.getDateAsFormattedArrayInMultipleTimezones(
            date,
            onlyShowDate
        ).join('<br/>');
    }

    public static getDateAsFormattedStringInMultipleTimezones(
        date: string | Date,
        onlyShowDate?: boolean
    ): string {
        return this.getDateAsFormattedArrayInMultipleTimezones(
            date,
            onlyShowDate
        ).join('\n');
    }

    public static getDateAsLocalFormattedString(
        date: string | Date,
        onlyShowDate?: boolean
    ): string {
        date = this.fromString(date);

        let formatstring: string = 'MMM DD YYYY, HH:mm';

        if (onlyShowDate) {
            formatstring = 'MMM DD, YYYY';
        }

        const momentDate: moment.Moment = moment(date).local();

        return (
            momentDate.format(formatstring) +
            ' ' +
            (onlyShowDate ? '' : this.getCurrentTimezoneString())
        );
    }

    public static getDayInSeconds(): number {
        return 24 * 60 * 60;
    }

    public static getCurrentTimezoneString(): string {
        return moment.tz(moment.tz.guess()).zoneAbbr();
    }

    public static getDateString(date: Date): string {
        date = this.fromString(date);
        return this.getDateAsLocalFormattedString(date, true);
    }

    public static isInThePast(date: string | Date): boolean {
        date = this.fromString(date);
        return moment(date).isBefore(new Date());
    }

    public static isInTheFuture(date: string | Date): boolean {
        date = this.fromString(date);
        return moment(date).isAfter(new Date());
    }

    public static fromString(date: string | JSONObject | Date): Date {
        if (date instanceof Date) {
            return date;
        }

        if (typeof date === 'string') {
            return moment(date).toDate();
        }

        if (
            date &&
            date['value'] &&
            typeof date['value'] === 'string' &&
            date['_type'] &&
            (date['_type'] === 'Date' || date['_type'] === 'DateTime')
        ) {
            return moment(date['value']).toDate();
        }

        throw new BadDataException('Invalid date');
    }

    public static asDateForDatabaseQuery(date: string | Date): string {
        date = this.fromString(date);
        const formatstring: string = 'YYYY-MM-DD';
        return moment(date).local().format(formatstring);
    }

    public static asFilterDateForDatabaseQuery(date: string | Date): InBetween {
        date = this.fromString(date);
        const formattedDate: Date = moment(date).toDate();
        return new InBetween(
            OneUptimeDate.getStartOfDay(formattedDate),
            OneUptimeDate.getEndOfDay(formattedDate)
        );
    }
}
