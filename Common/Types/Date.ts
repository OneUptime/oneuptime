import InBetween from "./BaseDatabase/InBetween";
import DayOfWeek, { DayOfWeekUtil } from "./Day/DayOfWeek";
import BadDataException from "./Exception/BadDataException";
import { JSONObject, ObjectType } from "./JSON";
import PositiveNumber from "./PositiveNumber";
import moment from "moment-timezone";
import Timezone from "./Timezone";
import Zod, { ZodSchema } from "../Utils/Schema/Zod";

export const Moment: typeof moment = moment;

export default class OneUptimeDate {
  // get date time from unix timestamp

  public static getSchema(): ZodSchema {
    return Zod.object({
      _type: Zod.literal(ObjectType.DateTime),
      value: Zod.string().openapi({
        type: "string",
        example: "2023-10-01T12:00:00Z",
      }),
    }).openapi({
      type: "object",
      description: "A date time object.",
      example: {
        _type: ObjectType.DateTime,
        value: "2023-10-01T12:00:00Z",
      },
    });
  }

  public static getHoursAndMinutesFromMinutes(minutes: number): string {
    const hours: number = Math.floor(minutes / 60);
    const mins: number = minutes % 60;

    let formattedString: string = "";

    if (hours > 0) {
      formattedString += hours + " hours ";
    }

    if (mins > 0) {
      formattedString += mins + " minutes";
    }

    return formattedString.trim() || "0 minutes";
  }

  public static fromUnixTimestamp(timestamp: number): Date {
    return new Date(timestamp * 1000);
  }

  public static getStartOfTheWeek(date: Date): Date {
    date = this.fromString(date);
    return moment(date).startOf("week").toDate();
  }

  public static getEndOfTheWeek(date: Date): Date {
    date = this.fromString(date);
    return moment(date).endOf("week").toDate();
  }

  public static getInBetweenDatesAsFormattedString(
    inBetween: InBetween<Date>,
  ): string {
    return (
      this.getDateAsFormattedString(inBetween.startValue) +
      " - " +
      this.getDateAsFormattedString(inBetween.endValue)
    );
  }
  public static convertMinutesToMilliseconds(minutes: number): number {
    return minutes * 60 * 1000;
  }

  public static getNanoSecondsFromSeconds(seconds: number): number {
    return seconds * 1000 * 1000 * 1000;
  }

  public static now(): Date {
    return this.getCurrentDate();
  }

  public static getDateFromYYYYMMDD(
    year: string,
    month: string,
    day: string,
  ): Date {
    return moment(`${year}-${month}-${day}`).toDate();
  }

  public getMicroSecondsFromSeconds(seconds: number): number {
    return seconds * 1000 * 1000;
  }

  public getMilliSecondsFromSeconds(seconds: number): number {
    return seconds * 1000;
  }

  public static getCurrentDateAsUnixNano(): number {
    return this.toUnixNano(this.getCurrentDate());
  }

  public static toUnixNano(date: Date): number {
    return date.getTime() * 1000000;
  }

  public static getLocalHourAndMinuteFromDate(date: Date | string): string {
    date = this.fromString(date);
    return moment(date).format("HH:mm");
  }

  public static getMillisecondsBetweenTwoUnixNanoDates(
    startDate: number,
    endDate: number,
  ): number {
    return endDate - startDate;
  }

  public static moveDateToTheDayOfWeek(
    date: Date,
    moveToWeek: Date,
    dayOfWeek: DayOfWeek,
  ): Date {
    // date will be moved to the week of "moveToWeek" and then to the day of week "dayOfWeek"

    date = this.fromString(date);
    date = this.keepTimeButMoveDay(date, moveToWeek);

    // now move the date to the day of week

    const dateDayOfWeek: DayOfWeek = this.getDayOfWeek(date);

    if (dateDayOfWeek === dayOfWeek) {
      return date;
    }

    const numberOfDayOfWeek: number =
      DayOfWeekUtil.getNumberOfDayOfWeek(dayOfWeek);

    const dateDayOfWeekNumber: number =
      DayOfWeekUtil.getNumberOfDayOfWeek(dateDayOfWeek);

    const difference: number = numberOfDayOfWeek - dateDayOfWeekNumber;

    if (difference === 0) {
      return date;
    }

    return this.addRemoveDays(date, difference);
  }

  public static getDayOfTheWeekIndex(date: Date): number {
    date = this.fromString(date);
    return moment(date).weekday();
  }

  public static isOverlapping(
    start: Date,
    end: Date,
    start1: Date,
    end1: Date,
  ): unknown {
    start = this.fromString(start);
    end = this.fromString(end);
    start1 = this.fromString(start1);
    end1 = this.fromString(end1);

    let isOverlapping: boolean =
      moment(start).isBetween(start1, end1) ||
      moment(end).isBetween(start1, end1) ||
      moment(start).isSame(start1) ||
      moment(end).isSame(end1);

    if (!isOverlapping) {
      // check if the start1 and end1 are in between start and end

      isOverlapping =
        moment(start1).isBetween(start, end) ||
        moment(end1).isBetween(start, end) ||
        moment(start1).isSame(start) ||
        moment(end1).isSame(end);
    }

    return isOverlapping;
  }

  public static getCurrentDate(): Date {
    return moment().toDate();
  }

  public static fromNow(date: Date): string {
    return moment(date).fromNow();
  }

  public static differenceBetweenTwoDatesAsFromattedString(
    date1: Date,
    date2: Date,
  ): string {
    const seconds: number = this.getSecondsBetweenTwoDates(date1, date2);
    return this.secondsToFormattedFriendlyTimeString(seconds);
  }

  public static toTimeString(
    date: Date | string,
    use12HourFormat?: boolean,
  ): string {
    if (typeof date === "string") {
      date = this.fromString(date);
    }

    const format: "hh:mm A" | "HH:mm" =
      use12HourFormat || this.getUserPrefers12HourFormat()
        ? "hh:mm A"
        : "HH:mm";
    return moment(date).format(format);
  }

  public static isSame(date1: Date, date2: Date): boolean {
    date1 = this.fromString(date1);
    date2 = this.fromString(date2);
    return moment(date1).isSame(date2);
  }

  public static getDaysBetweenTwoDates(startDate: Date, endDate: Date): number {
    startDate = this.fromString(startDate);
    endDate = this.fromString(endDate);
    return moment(endDate).diff(moment(startDate), "days");
  }

  public static getDaysBetweenTwoDatesInclusive(
    startDate: Date,
    endDate: Date,
  ): number {
    return this.getDaysBetweenTwoDates(startDate, endDate) + 1;
  }

  public static getHoursBetweenTwoDates(
    startDate: Date,
    endDate: Date,
  ): number {
    startDate = this.fromString(startDate);
    endDate = this.fromString(endDate);
    return moment(endDate).diff(moment(startDate), "hours");
  }

  public static getHoursBetweenTwoDatesInclusive(
    startDate: Date,
    endDate: Date,
  ): number {
    return this.getHoursBetweenTwoDates(startDate, endDate) + 1;
  }

  public static getMinutesBetweenTwoDates(
    startDate: Date,
    endDate: Date,
  ): number {
    startDate = this.fromString(startDate);
    endDate = this.fromString(endDate);
    return moment(endDate).diff(moment(startDate), "minutes");
  }

  public static getMinutesBetweenTwoDatesInclusive(
    startDate: Date,
    endDate: Date,
  ): number {
    return this.getMinutesBetweenTwoDates(startDate, endDate) + 1;
  }

  public static getSecondsBetweenTwoDates(
    startDate: Date,
    endDate: Date,
  ): number {
    startDate = this.fromString(startDate);
    endDate = this.fromString(endDate);
    return moment(endDate).diff(moment(startDate), "seconds");
  }

  public static getSecondsBetweenTwoDatesInclusive(
    startDate: Date,
    endDate: Date,
  ): number {
    return this.getSecondsBetweenTwoDates(startDate, endDate) + 1;
  }

  public static getWeeksBetweenTwoDates(
    startDate: Date,
    endDate: Date,
  ): number {
    startDate = this.fromString(startDate);
    endDate = this.fromString(endDate);
    return moment(endDate).diff(moment(startDate), "weeks");
  }

  public static getWeeksBetweenTwoDatesInclusive(
    startDate: Date,
    endDate: Date,
  ): number {
    return this.getWeeksBetweenTwoDates(startDate, endDate) + 1;
  }

  public static getMonthsBetweenTwoDates(
    startDate: Date,
    endDate: Date,
  ): number {
    startDate = this.fromString(startDate);
    endDate = this.fromString(endDate);
    return moment(endDate).diff(moment(startDate), "months");
  }

  public static getMonthsBetweenTwoDatesInclusive(
    startDate: Date,
    endDate: Date,
  ): number {
    return this.getMonthsBetweenTwoDates(startDate, endDate) + 1;
  }

  public static getYearsBetweenTwoDates(
    startDate: Date,
    endDate: Date,
  ): number {
    startDate = this.fromString(startDate);
    endDate = this.fromString(endDate);
    return moment(endDate).diff(moment(startDate), "years");
  }

  public static getYearsBetweenTwoDatesInclusive(
    startDate: Date,
    endDate: Date,
  ): number {
    return this.getYearsBetweenTwoDates(startDate, endDate) + 1;
  }

  public static toString(date: Date | undefined): string {
    if (!date) {
      return "";
    }

    date = this.fromString(date);

    return date.toISOString();
  }

  public static getCurrentMomentDate(): moment.Moment {
    return moment();
  }

  public static keepTimeButMoveDay(keepTimeFor: Date, moveDayTo: Date): Date {
    keepTimeFor = this.fromString(keepTimeFor);
    moveDayTo = this.fromString(moveDayTo);
    return moment(moveDayTo)
      .set({
        hour: keepTimeFor.getHours(),
        minute: keepTimeFor.getMinutes(),
        second: keepTimeFor.getSeconds(),
        millisecond: keepTimeFor.getMilliseconds(),
      })
      .toDate();
  }

  public static getOneMinAgo(): Date {
    return this.getSomeMinutesAgo(new PositiveNumber(1));
  }

  public static getOneDayAgo(): Date {
    return this.getSomeDaysAgo(new PositiveNumber(1));
  }

  public static fromUnixNano(timestamp: number): Date {
    return moment(timestamp / 1000000).toDate();
  }

  public static parseRfc5424Timestamp(value: string): Date | undefined {
    if (!value || typeof value !== "string") {
      return undefined;
    }

    const parsed: moment.Moment = Moment(value, Moment.ISO_8601, true);

    if (!parsed.isValid()) {
      return undefined;
    }

    return parsed.toDate();
  }

  public static parseRfc3164Timestamp(value: string): Date | undefined {
    if (!value || typeof value !== "string") {
      return undefined;
    }

    const normalized: string = value.replace(/\s+/g, " ").trim();

    if (!normalized) {
      return undefined;
    }

    const currentYear: number = this.getCurrentYear();

    let parsed: moment.Moment = Moment(
      `${normalized} ${currentYear}`,
      "MMM D HH:mm:ss YYYY",
      true,
    );

    if (!parsed.isValid()) {
      return undefined;
    }

    const now: moment.Moment = Moment();

    if (parsed.isAfter(now.clone().add(1, "months"))) {
      parsed = parsed.subtract(1, "years");
    } else if (parsed.isBefore(now.clone().subtract(11, "months"))) {
      parsed = parsed.add(1, "years");
    }

    return parsed.toDate();
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
      .add(-1 * minutes.toNumber(), "minutes")
      .toDate();
  }

  public static timezoneOffsetDate(date: Date): Date {
    date = this.fromString(date);
    return this.addRemoveMinutes(date, date.getTimezoneOffset());
  }

  public static toDateTimeLocalString(date: Date): string {
    date = this.fromString(date);

    type TenFunction = (i: number) => string;

    const ten: TenFunction = (i: number): string => {
        return (i < 10 ? "0" : "") + i;
      },
      YYYY: number = date.getFullYear(),
      MM: string = ten(date.getMonth() + 1),
      DD: string = ten(date.getDate()),
      HH: string = ten(date.getHours()),
      II: string = ten(date.getMinutes()),
      SS: string = ten(date.getSeconds());

    return YYYY + "-" + MM + "-" + DD + "T" + HH + ":" + II + ":" + SS;
  }

  public static fromJSON(json: JSONObject): Date {
    if (json["_type"] === ObjectType.DateTime) {
      return OneUptimeDate.fromString(json["value"] as string);
    }

    throw new BadDataException("Invalid JSON: " + JSON.stringify(json));
  }

  public static toJSON(date: Date): JSONObject {
    return {
      _type: ObjectType.DateTime,
      value: OneUptimeDate.toString(date),
    };
  }

  public static areOnTheSameDay(date1: Date, date2: Date): boolean {
    date1 = this.fromString(date1);
    date2 = this.fromString(date2);
    return moment(date1).isSame(date2, "day");
  }

  public static areOnTheSameMonth(date1: Date, date2: Date): boolean {
    date1 = this.fromString(date1);
    date2 = this.fromString(date2);
    return moment(date1).isSame(date2, "month");
  }

  public static areOnTheSameYear(date1: Date, date2: Date): boolean {
    date1 = this.fromString(date1);
    date2 = this.fromString(date2);
    return moment(date1).isSame(date2, "year");
  }

  public static areOnTheSameHour(date1: Date, date2: Date): boolean {
    date1 = this.fromString(date1);
    date2 = this.fromString(date2);
    return moment(date1).isSame(date2, "hour");
  }

  public static areOnTheSameMinute(date1: Date, date2: Date): boolean {
    date1 = this.fromString(date1);
    date2 = this.fromString(date2);
    return moment(date1).isSame(date2, "minute");
  }

  public static areOnTheSameSecond(date1: Date, date2: Date): boolean {
    date1 = this.fromString(date1);
    date2 = this.fromString(date2);
    return moment(date1).isSame(date2, "second");
  }

  public static areOnTheSameWeek(date1: Date, date2: Date): boolean {
    date1 = this.fromString(date1);
    date2 = this.fromString(date2);
    return moment(date1).isSame(date2, "week");
  }

  public static addRemoveMinutes(date: Date, minutes: number): Date {
    date = this.fromString(date);
    return moment(date).add(minutes, "minutes").toDate();
  }

  public static addRemoveDays(date: Date, days: number): Date {
    date = this.fromString(date);
    return moment(date).add(days, "days").toDate();
  }

  public static addRemoveHours(date: Date, hours: number): Date {
    date = this.fromString(date);
    return moment(date).add(hours, "hours").toDate();
  }

  public static addRemoveYears(date: Date, years: number): Date {
    date = this.fromString(date);
    return moment(date).add(years, "years").toDate();
  }

  public static addRemoveMonths(date: Date, months: number): Date {
    date = this.fromString(date);
    return moment(date).add(months, "months").toDate();
  }

  public static addRemoveWeeks(date: Date, weeks: number): Date {
    date = this.fromString(date);
    return moment(date).add(weeks, "weeks").toDate();
  }

  public static addRemoveSeconds(date: Date, seconds: number): Date {
    date = this.fromString(date);
    return moment(date).add(seconds, "seconds").toDate();
  }

  public static getSecondsInDays(days: PositiveNumber | number): number {
    if (!(days instanceof PositiveNumber)) {
      days = new PositiveNumber(days);
    }
    return days.positiveNumber * 24 * 60 * 60;
  }

  public static getMillisecondsInDays(days: PositiveNumber | number): number {
    return this.getSecondsInDays(days) * 1000;
  }

  public static getSomeHoursAgo(hours: PositiveNumber | number): Date {
    if (!(hours instanceof PositiveNumber)) {
      hours = new PositiveNumber(hours);
    }
    return this.getCurrentMomentDate()
      .add(-1 * hours.toNumber(), "hours")
      .toDate();
  }

  public static getSomeDaysAgo(days: PositiveNumber | number): Date {
    if (!(days instanceof PositiveNumber)) {
      days = new PositiveNumber(days);
    }
    return this.getCurrentMomentDate()
      .add(-1 * days.toNumber(), "days")
      .toDate();
  }

  public static getSomeDaysAgoFromDate(
    date: Date,
    days: PositiveNumber | number,
  ): Date {
    date = this.fromString(date);
    if (!(days instanceof PositiveNumber)) {
      days = new PositiveNumber(days);
    }
    return moment(date)
      .add(-1 * days.toNumber(), "days")
      .toDate();
  }

  public static getSomeDaysAfterFromDate(
    date: Date,
    days: PositiveNumber | number,
  ): Date {
    date = this.fromString(date);
    if (!(days instanceof PositiveNumber)) {
      days = new PositiveNumber(days);
    }
    return moment(date).add(Number(days.toNumber()), "days").toDate();
  }

  public static getSomeDaysBeforeFromDate(
    date: Date,
    days: PositiveNumber | number,
  ): Date {
    date = this.fromString(date);
    if (!(days instanceof PositiveNumber)) {
      days = new PositiveNumber(days);
    }
    return moment(date)
      .add(-1 * Number(days.toNumber()), "days")
      .toDate();
  }

  public static getSomeSecondsAgo(seconds: PositiveNumber | number): Date {
    if (!(seconds instanceof PositiveNumber)) {
      seconds = new PositiveNumber(seconds);
    }

    return this.getCurrentMomentDate()
      .add(-1 * seconds.toNumber(), "seconds")
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
      .add(minutes.toNumber(), "minutes")
      .toDate();
  }

  public static getSomeHoursAfter(hours: PositiveNumber | number): Date {
    if (!(hours instanceof PositiveNumber)) {
      hours = new PositiveNumber(hours);
    }
    return this.getCurrentMomentDate().add(hours.toNumber(), "hours").toDate();
  }

  public static getSomeDaysAfter(days: PositiveNumber | number): Date {
    if (!(days instanceof PositiveNumber)) {
      days = new PositiveNumber(days);
    }

    return this.getCurrentMomentDate().add(days.toNumber(), "days").toDate();
  }

  public static secondsToFormattedTimeString(seconds: number): string {
    return moment.utc(seconds * 1000).format("HH:mm:ss");
  }

  public static toUnixTimestamp(date: Date): number {
    return Math.floor(date.getTime() / 1000);
  }

  public static secondsToFormattedFriendlyTimeString(seconds: number): string {
    const startDate: moment.Moment = moment.utc(0);
    const date: moment.Moment = moment.utc(seconds * 1000);

    // get the difference between the two dates as friendly formatted string

    let formattedString: string = "";

    // years between two dates
    const years: number = date.diff(startDate, "years");

    if (years > 0) {
      let text: string = "years ";
      if (years === 1) {
        text = "year ";
      }

      // add years to start date
      startDate.add(years, "years");

      formattedString += years + " " + text;
    }

    const months: number = date.diff(startDate, "months");

    if (months > 0) {
      let text: string = "months ";

      if (months === 1) {
        text = "month ";
      }

      // add months to start date
      startDate.add(months, "months");

      formattedString += months + " " + text;
    }

    const days: number = date.diff(startDate, "days");

    if (days > 0) {
      let text: string = "days ";

      if (days === 1) {
        text = "day ";
      }

      // add days to start date
      startDate.add(days, "days");

      formattedString += days + " " + text;
    }

    const hours: number = date.diff(startDate, "hours");

    if (hours > 0) {
      let text: string = "hours ";

      if (hours === 1) {
        text = "hour ";
      }

      // add hours to start date
      startDate.add(hours, "hours");

      formattedString += hours + " " + text;
    }

    const minutes: number = date.diff(startDate, "minutes");

    if (minutes > 0) {
      let text: string = "mins ";

      if (minutes === 1) {
        text = "min ";
      }

      // add minutes to start date
      startDate.add(minutes, "minutes");

      formattedString += minutes + " " + text;
    }

    const secondsLeft: number = date.diff(startDate, "seconds");

    if (secondsLeft > 0) {
      let text: string = "secs ";

      if (secondsLeft === 1) {
        text = "sec ";
      }

      // add seconds to start date
      startDate.add(secondsLeft, "seconds");

      formattedString += secondsLeft + " " + text;
    }

    return formattedString.trim();
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
      moment(end).diff(moment(start)),
    );
    return duration.asSeconds();
  }

  public static getSomeDaysAfterDate(
    date: Date,
    days: PositiveNumber | number,
  ): Date {
    if (!(days instanceof PositiveNumber)) {
      days = new PositiveNumber(days);
    }

    return moment(date).add(days.toNumber(), "days").toDate();
  }

  public static getSomeSecondsAfter(seconds: PositiveNumber | number): Date {
    if (!(seconds instanceof PositiveNumber)) {
      seconds = new PositiveNumber(seconds);
    }

    return this.getCurrentMomentDate()
      .add(seconds.toNumber(), "seconds")
      .toDate();
  }

  public static getNumberOfDaysBetweenDates(
    startDate: Date,
    endDate: Date,
  ): number {
    const a: moment.Moment = moment(startDate);
    const b: moment.Moment = moment(endDate);
    return b.diff(a, "days");
  }

  public static getNumberOfMinutesBetweenDates(
    startDate: Date,
    endDate: Date,
  ): number {
    const a: moment.Moment = moment(startDate);
    const b: moment.Moment = moment(endDate);
    return b.diff(a, "minutes");
  }

  public static getNumberOfDaysBetweenDatesInclusive(
    startDate: Date,
    endDate: Date,
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
    return moment(date).startOf("day").toDate();
  }

  public static getEndOfDay(date: Date): Date {
    date = this.fromString(date);
    return moment(date).endOf("day").toDate();
  }

  public static isBetween(date: Date, startDate: Date, endDate: Date): boolean {
    date = this.fromString(date);
    startDate = this.fromString(startDate);
    endDate = this.fromString(endDate);
    return moment(date).isBetween(startDate, endDate);
  }

  public static isAfter(date: Date, startDate: Date): boolean {
    date = this.fromString(date);
    startDate = this.fromString(startDate);
    return moment(date).isAfter(startDate, "seconds");
  }

  public static isOnOrAfter(date: Date, startDate: Date): boolean {
    date = this.fromString(date);
    startDate = this.fromString(startDate);
    return moment(date).isSameOrAfter(startDate, "seconds");
  }

  public static getDayOfWeek(date: Date): DayOfWeek {
    const dayOfWeek: number = this.geyDayOfWeekAsNumber(date);

    if (dayOfWeek === 1) {
      return DayOfWeek.Monday;
    } else if (dayOfWeek === 2) {
      return DayOfWeek.Tuesday;
    } else if (dayOfWeek === 3) {
      return DayOfWeek.Wednesday;
    } else if (dayOfWeek === 4) {
      return DayOfWeek.Thursday;
    } else if (dayOfWeek === 5) {
      return DayOfWeek.Friday;
    } else if (dayOfWeek === 6) {
      return DayOfWeek.Saturday;
    } else if (dayOfWeek === 7) {
      return DayOfWeek.Sunday;
    }

    throw new BadDataException("Invalid day of week");
  }

  public static geyDayOfWeekAsNumber(date: Date): number {
    date = this.fromString(date);
    return moment(date).isoWeekday();
  }

  public static isOnOrBefore(date: Date, endDate: Date): boolean {
    date = this.fromString(date);
    endDate = this.fromString(endDate);

    return moment(date).isSameOrBefore(endDate, "seconds");
  }

  public static isEqualBySeconds(date: Date, startDate: Date): boolean {
    date = this.fromString(date);
    startDate = this.fromString(startDate);
    return moment(date).isSame(startDate, "seconds");
  }

  public static hasExpired(expirationDate: Date): boolean {
    expirationDate = this.fromString(expirationDate);
    return !moment(this.getCurrentDate()).isBefore(expirationDate, "seconds");
  }

  public static isBefore(date: Date, endDate: Date): boolean {
    date = this.fromString(date);
    endDate = this.fromString(endDate);
    return moment(date).isBefore(endDate, "seconds");
  }

  public static getCurrentDateAsFormattedString(options?: {
    onlyShowDate?: boolean;
    showSeconds?: boolean;
    use12HourFormat?: boolean;
  }): string {
    return this.getDateAsFormattedString(new Date(), options);
  }

  public static getUserPrefers12HourFormat(): boolean {
    if (typeof window === "undefined") {
      // Server-side: default to 12-hour format for user-friendly display
      return true;
    }

    // Client-side: detect user's preferred time format from browser locale
    const testDate: Date = new Date();
    const timeString: string = testDate.toLocaleTimeString();
    return (
      timeString.toLowerCase().includes("am") ||
      timeString.toLowerCase().includes("pm")
    );
  }

  public static getDateAsUserFriendlyFormattedString(
    date: string | Date,
    options?: {
      onlyShowDate?: boolean;
      showSeconds?: boolean;
    },
  ): string {
    return this.getDateAsFormattedString(date, {
      ...options,
      use12HourFormat: this.getUserPrefers12HourFormat(),
    });
  }

  public static getDateAsUserFriendlyLocalFormattedString(
    date: string | Date,
    onlyShowDate?: boolean,
    showSeconds?: boolean,
  ): string {
    return this.getDateAsLocalFormattedString(
      date,
      onlyShowDate,
      this.getUserPrefers12HourFormat(),
      showSeconds,
    );
  }

  public static getDateAsFormattedString(
    date: string | Date,
    options?: {
      onlyShowDate?: boolean;
      showSeconds?: boolean;
      use12HourFormat?: boolean;
    },
  ): string {
    date = this.fromString(date);

    let formatstring: string = "MMM DD YYYY, HH:mm";

    if (options?.use12HourFormat) {
      formatstring = "MMM DD YYYY, hh:mm A";
    }

    if (options?.showSeconds) {
      if (options?.use12HourFormat) {
        formatstring = "MMM DD YYYY, hh:mm:ss A";
      } else {
        formatstring = "MMM DD YYYY, HH:mm:ss";
      }
    }

    if (options?.onlyShowDate) {
      formatstring = "MMM DD, YYYY";
    }

    return (
      moment(date).format(formatstring) +
      " " +
      (options?.onlyShowDate ? "" : this.getCurrentTimezoneString())
    );
  }

  public static getDifferenceInMinutes(date: Date, date2: Date): number {
    date = this.fromString(date);
    date2 = this.fromString(date2);
    const minutes: number = moment(date).diff(moment(date2), "minutes");

    if (minutes < 0) {
      return minutes * -1;
    }

    return minutes;
  }

  public static getDifferenceInSeconds(date: Date, date2: Date): number {
    date = this.fromString(date);
    date2 = this.fromString(date2);
    const seconds: number = moment(date).diff(moment(date2), "seconds");

    if (seconds < 0) {
      return seconds * -1;
    }

    return seconds;
  }

  public static getDifferenceInMonths(date: Date, date2: Date): number {
    date = this.fromString(date);
    date2 = this.fromString(date2);
    const months: number = moment(date).diff(moment(date2), "months");

    if (months < 0) {
      return months * -1;
    }

    return months;
  }

  public static convertSecondsToDaysHoursMinutesAndSeconds(
    seconds: number,
  ): string {
    // should output 2 days, 3 hours, 4 minutes and 5 seconds. If the days are 0, it should not show the days. If the hours are 0, it should not show the hours. If the minutes are 0, it should not show the minutes. If the seconds are 0, it should not show the seconds.

    const days: number = Math.floor(seconds / (24 * 60 * 60));
    const hours: number = Math.floor((seconds % (24 * 60 * 60)) / (60 * 60));
    const minutes: number = Math.floor((seconds % (60 * 60)) / 60);
    const secs: number = seconds % 60;

    let formattedString: string = "";

    if (days > 0) {
      formattedString += days + " days";
    }

    if (hours > 0) {
      if (formattedString.length > 0) {
        formattedString += ", ";
      }

      formattedString += hours + " hours";
    }

    if (minutes > 0) {
      if (formattedString.length > 0) {
        formattedString += ", ";
      }

      formattedString += minutes + " minutes";
    }

    if (secs > 0) {
      if (formattedString.length > 0) {
        formattedString += ", ";
      }

      formattedString += secs + " seconds";
    }

    return formattedString;
  }

  public static convertMinutesToDaysHoursAndMinutes(minutes: number): string {
    // should output 2 days, 3 hours and 4 minutes. If the days are 0, it should not show the days. If the hours are 0, it should not show the hours. If the minutes are 0, it should not show the minutes.

    const days: number = Math.floor(minutes / (24 * 60));
    const hours: number = Math.floor((minutes % (24 * 60)) / 60);
    const mins: number = minutes % 60;

    let formattedString: string = "";

    if (days > 0) {
      formattedString += days + " days";
    }

    if (hours > 0) {
      if (formattedString.length > 0) {
        formattedString += ", ";
      }

      formattedString += hours + " hours";
    }

    if (mins >= 0) {
      if (formattedString.length > 0) {
        formattedString += ", ";
      }

      formattedString += mins + " minutes";
    }

    return formattedString;
  }

  public static getHumanizedDurationFromNanoseconds(data: {
    nanoseconds: number;
    maxParts?: number;
  }): string {
    let { nanoseconds } = data;
    const maxParts: number = data.maxParts ?? 2;

    if (!Number.isFinite(nanoseconds)) {
      return "-";
    }

    if (nanoseconds === 0) {
      return "0 ms";
    }

    const sign: string = nanoseconds < 0 ? "-" : "";
    nanoseconds = Math.abs(nanoseconds);

    if (nanoseconds < 1000) {
      return sign + Math.round(nanoseconds).toString() + " ns";
    }

    const microseconds: number = nanoseconds / 1000;
    if (microseconds < 1000) {
      return sign + OneUptimeDate.formatDurationValue(microseconds) + " μs";
    }

    const milliseconds: number = nanoseconds / 1000000;
    if (milliseconds < 1000) {
      return sign + OneUptimeDate.formatDurationValue(milliseconds) + " ms";
    }

    const seconds: number = nanoseconds / 1000000000;

    if (seconds < 60) {
      return sign + OneUptimeDate.formatDurationValue(seconds) + " s";
    }

    const units: Array<{ label: string; seconds: number }> = [
      { label: "d", seconds: 86400 },
      { label: "h", seconds: 3600 },
      { label: "m", seconds: 60 },
      { label: "s", seconds: 1 },
    ];

    let remainingSeconds: number = Math.floor(seconds);
    const parts: string[] = [];

    for (const unit of units) {
      if (parts.length >= maxParts) {
        break;
      }

      if (remainingSeconds < unit.seconds) {
        continue;
      }

      const value: number = Math.floor(remainingSeconds / unit.seconds);

      if (value > 0) {
        parts.push(`${value}${unit.label}`);
        remainingSeconds -= value * unit.seconds;
      }
    }

    const fractionalSeconds: number = seconds - Math.floor(seconds);
    const leftoverSeconds: number = remainingSeconds + fractionalSeconds;

    if (leftoverSeconds > 0) {
      if (parts.length === 0) {
        parts.push(`${OneUptimeDate.formatDurationValue(leftoverSeconds)}s`);
      } else if (parts[parts.length - 1]?.endsWith("s")) {
        const numericValue: number = parseFloat(
          parts[parts.length - 1]!.slice(0, -1),
        );
        const updatedSeconds: number = numericValue + leftoverSeconds;
        parts[parts.length - 1] =
          `${OneUptimeDate.formatDurationValue(updatedSeconds)}s`;
      } else if (parts.length < maxParts) {
        parts.push(`${OneUptimeDate.formatDurationValue(leftoverSeconds)}s`);
      }
    }

    if (parts.length === 0) {
      return sign + OneUptimeDate.formatDurationValue(seconds) + " s";
    }

    const trimmedParts: string[] = parts.slice(0, maxParts);

    if (sign) {
      trimmedParts[0] = sign + trimmedParts[0];
    }

    return trimmedParts.join(" ");
  }

  private static formatDurationValue(value: number): string {
    const abs: number = Math.abs(value);

    if (abs >= 100) {
      return Math.round(value).toString();
    }

    const decimalPlaces: number = 2;
    const fixed: string = value.toFixed(decimalPlaces);
    return fixed.replace(/\.0+$/, "").replace(/(\.\d*?[1-9])0+$/, "$1");
  }

  public static getGmtOffsetByTimezone(timezone: Timezone): number {
    return moment.tz(timezone).utcOffset();
  }

  public static getGmtOffsetFriendlyStringByTimezone(
    timezone: Timezone,
  ): string {
    const offset: number = this.getGmtOffsetByTimezone(timezone);
    return this.getGmtOffsetFriendlyString(offset) + " " + timezone;
  }

  public static isValidDateString(date: string): boolean {
    return moment(date).isValid();
  }

  public static getGmtOffsetFriendlyString(offset: number): string {
    const hours: number = Math.abs(offset) / 60;
    const minutes: number = Math.abs(offset) % 60;

    let formattedString: string = "GMT";

    if (offset < 0) {
      formattedString += "-";
    } else {
      formattedString += "+";
    }

    // remove decimals from hours
    formattedString += Math.floor(hours);

    if (minutes > 0) {
      formattedString += ":" + minutes;
    }

    return formattedString;
  }

  public static getDateAsFormattedArrayInMultipleTimezones(data: {
    date: string | Date;
    onlyShowDate?: boolean | undefined;
    timezones?: Array<Timezone> | undefined;
    use12HourFormat?: boolean | undefined;
  }): Array<string> {
    let date: string | Date = data.date;
    const onlyShowDate: boolean | undefined = data.onlyShowDate;
    let timezones: Array<Timezone> | undefined = data.timezones;
    const use12HourFormat: boolean =
      data.use12HourFormat ?? this.getUserPrefers12HourFormat();

    date = this.fromString(date);

    let formatstring: string = "MMM DD YYYY, HH:mm";

    if (use12HourFormat) {
      formatstring = "MMM DD YYYY, hh:mm A";
    }

    if (onlyShowDate) {
      formatstring = "MMM DD, YYYY";
    }

    // convert this date into GMT, EST, PST, IST, ACT with moment
    const timezoneDates: Array<string> = [];

    if (!timezones || timezones.length === 0) {
      timezones = [
        Timezone.UTC,
        Timezone.EST,
        Timezone.AmericaLos_Angeles,
        Timezone.AsiaKolkata,
        Timezone.AustraliaSydney,
      ]; // default timezones.
    }

    for (let i: number = 0; i < timezones.length; i++) {
      timezoneDates.push(
        moment(date)
          .tz(timezones[i] as string)
          .format(formatstring) +
          " " +
          (onlyShowDate
            ? ""
            : this.getZoneAbbrByTimezone(timezones[i] as Timezone)),
      );
    }

    return timezoneDates;
  }

  public static getDateAsFormattedHTMLInMultipleTimezones(data: {
    date: string | Date;
    onlyShowDate?: boolean;
    timezones?: Array<Timezone> | undefined; // if this is skipped, then it will show the default timezones in the order of UTC, EST, PST, IST, ACT
    use12HourFormat?: boolean | undefined;
  }): string {
    const date: string | Date = data.date;
    const onlyShowDate: boolean | undefined = data.onlyShowDate;
    const timezones: Array<Timezone> | undefined = data.timezones;
    const use12HourFormat: boolean | undefined = data.use12HourFormat;

    return this.getDateAsFormattedArrayInMultipleTimezones({
      date,
      onlyShowDate,
      timezones,
      use12HourFormat,
    }).join("<br/>");
  }

  public static getDateAsFormattedStringInMultipleTimezones(data: {
    date: string | Date;
    onlyShowDate?: boolean | undefined;
    timezones?: Array<Timezone> | undefined; // if this is skipped, then it will show the default timezones in the order of UTC, EST, PST, IST, ACT
    use12HourFormat?: boolean | undefined;
  }): string {
    const date: string | Date = data.date;
    const onlyShowDate: boolean | undefined = data.onlyShowDate;
    const timezones: Array<Timezone> | undefined = data.timezones;
    const use12HourFormat: boolean | undefined = data.use12HourFormat;

    return this.getDateAsFormattedArrayInMultipleTimezones({
      date,
      onlyShowDate,
      timezones,
      use12HourFormat,
    }).join("\n");
  }

  public static getDateAsLocalFormattedString(
    date: string | Date,
    onlyShowDate?: boolean,
    use12HourFormat?: boolean,
    showSeconds?: boolean,
  ): string {
    date = this.fromString(date);

    let formatstring: string = "MMM DD YYYY, HH:mm";

    if (use12HourFormat) {
      formatstring = "MMM DD YYYY, hh:mm A";
    }

    if (showSeconds) {
      if (use12HourFormat) {
        formatstring = "MMM DD YYYY, hh:mm:ss A";
      } else {
        formatstring = "MMM DD YYYY, HH:mm:ss";
      }
    }

    if (onlyShowDate) {
      formatstring = "MMM DD, YYYY";
    }

    const momentDate: moment.Moment = moment(date).local();

    return (
      momentDate.format(formatstring) +
      " " +
      (onlyShowDate ? "" : this.getCurrentTimezoneString())
    ).trim();
  }

  public static getDayInSeconds(days?: number | undefined): number {
    if (!days) {
      days = 1;
    }
    return 24 * 60 * 60 * days;
  }

  public static getCurrentTimezoneString(): string {
    return this.getZoneAbbrByTimezone(this.getCurrentTimezone());
  }

  public static getZoneAbbrByTimezone(timezone: Timezone): string {
    let zoneAbbr: string = moment.tz(timezone).zoneAbbr();

    if (zoneAbbr.startsWith("+") || zoneAbbr.startsWith("-")) {
      zoneAbbr = "GMT" + zoneAbbr;
    }

    return zoneAbbr;
  }

  public static getCurrentTimezone(): Timezone {
    return moment.tz.guess() as Timezone;
  }

  public static getDateString(date: Date): string {
    date = this.fromString(date);
    return this.getDateAsLocalFormattedString(date, true);
  }

  public static isInThePast(date: string | Date): boolean {
    date = this.fromString(date);
    return moment(date).isBefore(new Date(), "seconds");
  }

  public static isInTheFuture(date: string | Date): boolean {
    date = this.fromString(date);
    return moment(date).isAfter(new Date(), "seconds");
  }

  public static fromString(date: string | JSONObject | Date): Date {
    if (date instanceof Date) {
      return date;
    }

    if (typeof date === "string") {
      return moment(date).toDate();
    }

    if (
      date &&
      date["value"] &&
      typeof date["value"] === "string" &&
      date["_type"] &&
      (date["_type"] === "Date" || date["_type"] === "DateTime")
    ) {
      return moment(date["value"]).toDate();
    }

    throw new BadDataException("Invalid date: " + date?.toString());
  }

  public static asDateForDatabaseQuery(date: string | Date): string {
    date = this.fromString(date);
    const formatstring: string = "YYYY-MM-DD";
    return moment(date).local().format(formatstring);
  }

  public static asFilterDateForDatabaseQuery(
    date: string | Date,
  ): InBetween<Date> {
    date = this.fromString(date);
    const formattedDate: Date = moment(date).toDate();
    return new InBetween(
      OneUptimeDate.getStartOfDay(formattedDate),
      OneUptimeDate.getEndOfDay(formattedDate),
    );
  }

  public static getDateWithCustomTime(data: {
    hours: number;
    minutes: number;
    seconds: number;
  }): Date {
    const hour: number = data.hours;
    const minutes: number = data.minutes;
    const seconds: number = data.seconds;

    //validate the hour
    if (hour < 0 || hour > 23) {
      throw new BadDataException("Invalid hour");
    }

    //validate the minutes
    if (minutes < 0 || minutes > 59) {
      throw new BadDataException("Invalid minutes");
    }

    //validate the seconds
    if (seconds < 0 || seconds > 59) {
      throw new BadDataException("Invalid seconds");
    }

    const date: Date = OneUptimeDate.getCurrentDate();

    date.setHours(hour);
    date.setMinutes(minutes);
    date.setSeconds(seconds);

    return date;
  }

  public static toDatabaseDate(date: Date): string {
    date = this.fromString(date);
    return moment(date).format("YYYY-MM-DD HH:mm:ss");
  }

  public static resetSecondsAndMilliseconds(date: Date): Date {
    date = this.fromString(date);
    date.setSeconds(0);
    date.setMilliseconds(0);
    return date;
  }

  public static toClickhouseDateTime(date: Date | string): string {
    const parsedDate: Date = this.fromString(date);
    return moment(parsedDate).utc().format("YYYY-MM-DD HH:mm:ss");
  }
}
