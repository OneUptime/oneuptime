import DatabaseProperty from "../Database/DatabaseProperty";
import OneUptimeDate from "../Date";
import DayOfWeek from "../Day/DayOfWeek";
import BadDataException from "../Exception/BadDataException";
import { JSONObject, ObjectType } from "../JSON";
import JSONFunctions from "../JSONFunctions";
import StartAndEndTime from "../Time/StartAndEndTime";
import { refusedValue } from "../../Utils/RefusedValue";
import { FindOperator } from "typeorm";

export enum RestrictionType {
  Daily = "Daily",
  Weekly = "Weekly",
  None = "None",
}

export interface WeeklyResctriction {
  startDay: DayOfWeek;
  endDay: DayOfWeek;
  startTime: Date;
  endTime: Date;
}

/*
 * THE KEY A RESTRICTION'S TYPE IS WRITTEN UNDER (#11269).
 *
 * It was spelled restictionType, without the second "r", and that was the
 * only spelling read: a client that sent the natural restrictionType had its
 * request accepted, and the layer stored with no type at all - which the
 * rotation engine reads as never on call, so nothing paged. Now:
 *
 *   - restrictionType is the key's name. It is what is stored.
 *   - restictionType, its older spelling, is read as well, and returned
 *     beside restrictionType in everything sent out (toJSON), so clients and
 *     Terraform configurations written against it keep working - Terraform
 *     compares a response with its configuration as a superset, so a
 *     configuration with either spelling matches a response with both.
 *   - a write must say which type it means (fromWrittenJSON): none, one the
 *     engine does not know, or the two spellings disagreeing, is refused
 *     with a message that names the key.
 */
export const RESTRICTION_TYPE_KEY: string = "restrictionType";
export const LEGACY_RESTRICTION_TYPE_KEY: string = "restictionType";

/*
 * THE OLDER SPELLING IN ANSWERS IS DEPRECATED (#11456).
 *
 * restictionType is sent beside restrictionType only so that clients and
 * Terraform configurations written against it keep working while they move
 * to restrictionType. Terraform compares a configuration with the answer as
 * a subset, so one written with restictionType fails every apply once an
 * answer leaves it out. It goes in three steps:
 *
 *   1. OneUptime 18.0.0 (now): deprecated, in the API reference and the
 *      On-Call Schedules docs. Answers carry both spellings, and writes read
 *      both.
 *   2. The Terraform provider's examples and its monitor-steps writer write
 *      restrictionType alone, and the provider reads a configuration's
 *      restictionType as restrictionType when it compares what it sent with
 *      what it reads back, so a configuration written with either applies
 *      against an answer with one.
 *   3. The first major version released on or after 1 June 2027, once step
 *      2 has shipped in an earlier release: answers stop carrying
 *      restictionType. Writes keep reading it for good, so old
 *      configurations still apply.
 *
 * Step 3 is taking LEGACY_RESTRICTION_TYPE_KEY out of this list: nothing
 * else writes it into an answer. RestrictionTypeSpellingsGuard (Common
 * Tests) holds every other file that names the older spelling to a list of
 * its own, each with why, so the removal knows all it touches.
 */
export const RESTRICTION_TYPE_KEYS_IN_ANSWERS: ReadonlyArray<string> = [
  RESTRICTION_TYPE_KEY,
  LEGACY_RESTRICTION_TYPE_KEY,
];

// The keys a restriction's value holds, as stored and as sent out.
export const RESTRICTION_TIMES_VALUE_KEYS: ReadonlyArray<string> = [
  RESTRICTION_TYPE_KEY,
  LEGACY_RESTRICTION_TYPE_KEY,
  "dayRestrictionTimes",
  "weeklyRestrictionTimes",
];

export interface RestrictionTimesData extends JSONObject {
  restrictionType: RestrictionType;
  dayRestrictionTimes: StartAndEndTime | null;
  weeklyRestrictionTimes: Array<WeeklyResctriction>;
}

export interface WrittenRestrictionTimesOptions {
  /*
   * The type the record holds now, for an update. A client that reads a
   * record gets both spellings back, and one that changes the spelling it
   * knows and sends the whole value back sends two that disagree: the one
   * that differs from this is the change.
   */
  currentType?: RestrictionType | null | undefined;
  // How the value is named in a refusal: "restrictionTimes" unless given.
  fieldName?: string | undefined;
}

const RESTRICTION_TYPES: ReadonlyArray<string> = Object.values(RestrictionType);

const SPELLED_TYPES: string =
  "None (on call around the clock), Daily or Weekly";

// A moment as the API writes one, with an example of its date.
const MOMENT_EXAMPLE: string = `{"_type": "DateTime", "value": "2026-01-05T09:00:00Z"}`;

// A moment's text opens with its calendar date: 2026-01-05...
const CALENDAR_DATE_FIRST: RegExp = /^\d{4}-\d{2}-\d{2}/;

export default class RestrictionTimes extends DatabaseProperty {
  private data: RestrictionTimesData =
    RestrictionTimes.getDefaultRestrictonTimeData();

  public get restrictionType(): RestrictionType {
    return this.data.restrictionType;
  }

  public set restrictionType(v: RestrictionType) {
    this.data.restrictionType = v;
  }

  /**
   * @deprecated The older spelling of restrictionType, kept so code written
   * against it keeps working (#11269). It reads and writes the same type.
   * Nothing outside Common reads it since #11457 (RestrictionTypeSpellingsGuard
   * holds it so); it goes with the older key in answers (#11456).
   */
  public get restictionType(): RestrictionType {
    return this.restrictionType;
  }

  /**
   * @deprecated See the getter.
   */
  public set restictionType(v: RestrictionType) {
    this.restrictionType = v;
  }

  // dayRestrictionTimes

  public get dayRestrictionTimes(): StartAndEndTime | null {
    return this.data.dayRestrictionTimes;
  }

  public set dayRestrictionTimes(v: StartAndEndTime | null) {
    this.data.dayRestrictionTimes = v;
  }

  // weeklyRestrictionTimes

  public get weeklyRestrictionTimes(): Array<WeeklyResctriction> {
    return this.data.weeklyRestrictionTimes;
  }

  public set weeklyRestrictionTimes(v: Array<WeeklyResctriction>) {
    this.data.weeklyRestrictionTimes = v;
  }

  public constructor() {
    super();

    this.data = RestrictionTimes.getDefaultRestrictonTimeData();
  }

  public static getDefaultRestrictonTimeData(): RestrictionTimesData {
    return {
      restrictionType: RestrictionType.None,
      dayRestrictionTimes: null,
      weeklyRestrictionTimes: [],
    };
  }

  public static getDefault(): RestrictionTimes {
    return new RestrictionTimes();
  }

  public static isRestrictionType(value: unknown): value is RestrictionType {
    return typeof value === "string" && RESTRICTION_TYPES.includes(value);
  }

  /*
   * What a client reading the restriction is sent: the type under each key
   * of RESTRICTION_TYPE_KEYS_IN_ANSWERS - its name, and while it is
   * deprecated its older spelling - so a reader of either finds it (#11269,
   * #11456).
   */
  public override toJSON(): JSONObject {
    const value: JSONObject = {};

    for (const key of RESTRICTION_TYPE_KEYS_IN_ANSWERS) {
      value[key] = this.restrictionType;
    }

    value["dayRestrictionTimes"] = this.dayRestrictionTimes;
    value["weeklyRestrictionTimes"] = this.weeklyRestrictionTimes;

    return JSONFunctions.serialize({
      _type: ObjectType.RestrictionTimes,
      value: value,
    });
  }

  // What is stored: the type under its name alone.
  public toDatabaseJSON(): JSONObject {
    return JSONFunctions.serialize({
      _type: ObjectType.RestrictionTimes,
      value: {
        [RESTRICTION_TYPE_KEY]: this.restrictionType,
        dayRestrictionTimes: this.dayRestrictionTimes,
        weeklyRestrictionTimes: this.weeklyRestrictionTimes,
      },
    });
  }

  /*
   * The type a restriction's value names: under its name, else under its
   * older spelling, else none - when neither holds a type there is.
   */
  public static readRestrictionType(
    value: JSONObject | null | undefined,
  ): RestrictionType | null {
    if (!value) {
      return null;
    }

    const named: unknown = value[RESTRICTION_TYPE_KEY];

    if (RestrictionTimes.isRestrictionType(named)) {
      return named;
    }

    const spelledBefore: unknown = value[LEGACY_RESTRICTION_TYPE_KEY];

    if (RestrictionTimes.isRestrictionType(spelledBefore)) {
      return spelledBefore;
    }

    return null;
  }

  /*
   * THE TYPE OF A STORED RESTRICTION THAT NAMES NONE (#11269).
   *
   * Before a write had to name its type, a layer could be stored without
   * one - its type under another key, or under none - and the engine put
   * nobody on call in it. Such a restriction is read for the hours it holds:
   * windows of the week make it Weekly, a window of the day that is open for
   * some time makes it Daily, and nothing usable makes it None - on call
   * around the clock, as a layer stored with no restriction at all is.
   * RepairScheduleLayerRestrictionTypes stores what this reads, once.
   */
  public static inferRestrictionType(
    value: JSONObject | null | undefined,
  ): RestrictionType {
    if (!value) {
      return RestrictionType.None;
    }

    const weekly: unknown = value["weeklyRestrictionTimes"];

    if (
      Array.isArray(weekly) &&
      weekly.some((window: unknown): boolean => {
        return RestrictionTimes.isUsableWeeklyWindow(window);
      })
    ) {
      return RestrictionType.Weekly;
    }

    const day: unknown = value["dayRestrictionTimes"];

    if (RestrictionTimes.isUsableDayWindow(day)) {
      return RestrictionType.Daily;
    }

    return RestrictionType.None;
  }

  /*
   * Read a restriction as it is stored or was sent: never refuses one for
   * its type (see inferRestrictionType). What a write may hold is
   * fromWrittenJSON's to say.
   */
  public static override fromJSON(
    json: JSONObject | RestrictionTimes,
  ): RestrictionTimes {
    if (json instanceof RestrictionTimes) {
      return json;
    }

    if (!json || json["_type"] !== ObjectType.RestrictionTimes) {
      throw new BadDataException("Invalid Restriction Times");
    }

    if (!json["value"]) {
      throw new BadDataException("Invalid Restriction Times");
    }

    const data: JSONObject = json["value"] as JSONObject;

    const restrictionTimes: RestrictionTimes = new RestrictionTimes();

    restrictionTimes.restrictionType =
      RestrictionTimes.readRestrictionType(data) ??
      RestrictionTimes.inferRestrictionType(data);

    restrictionTimes.dayRestrictionTimes = data[
      "dayRestrictionTimes"
    ] as StartAndEndTime | null;

    /*
     * Fall back to an empty ARRAY, not an object. `|| {}` produced a non-array
     * `{}` when the field was absent, which is truthy with an `undefined`
     * `.length`, so Layer.getEventsByWeeklyRestriction's
     * `!x || x.length === 0` guard passed through and `for (const w of {})`
     * threw "not iterable", aborting event expansion for the layer (audit F20).
     */
    const weeklyRestrictionTimes: Array<WeeklyResctriction> =
      (data["weeklyRestrictionTimes"] as Array<WeeklyResctriction>) || [];

    restrictionTimes.weeklyRestrictionTimes = weeklyRestrictionTimes;

    return restrictionTimes;
  }

  /*
   * A RESTRICTION AS A WRITE SENDS IT: WHAT IT MEANS, OR WHY NOT (#11269).
   *
   * Every way a write could leave a layer on call at no time without saying
   * so is refused here, with the key it is about:
   *
   *   - no type, under either spelling (another key's typo is named);
   *   - a type the engine does not know ("daily", "Always");
   *   - the two spellings naming different types, unless one of them is the
   *     record's type now (options.currentType): then the other is the
   *     change;
   *   - Daily without a window of the day, a window whose times are not
   *     dates and times (the "09:00" an old example showed), or one that
   *     opens and closes at the same time of day;
   *   - Weekly without its list of windows, or a window whose times are not
   *     dates and times, or that opens and closes at the same moment.
   *
   * What it returns is the restriction as it is stored: the type under its
   * name alone (toDatabaseJSON).
   */
  public static fromWrittenJSON(
    json: unknown,
    options?: WrittenRestrictionTimesOptions | undefined,
  ): RestrictionTimes {
    const field: string = options?.fieldName || "restrictionTimes";

    if (json instanceof RestrictionTimes) {
      if (!RestrictionTimes.isRestrictionType(json.restrictionType)) {
        throw new BadDataException(
          `${field} has no restriction type. Set ${RESTRICTION_TYPE_KEY} to ${SPELLED_TYPES}.`,
        );
      }

      RestrictionTimes.checkWindows(json.toDatabaseJSON()["value"], {
        field: field,
        type: json.restrictionType,
      });
      return json;
    }

    if (
      !json ||
      typeof json !== "object" ||
      Array.isArray(json) ||
      (json as JSONObject)["_type"] !== ObjectType.RestrictionTimes
    ) {
      throw new BadDataException(
        `${field} must be {"_type": "RestrictionTimes", "value": {"${RESTRICTION_TYPE_KEY}": "None"}}, with ${RESTRICTION_TYPE_KEY} ${SPELLED_TYPES}.`,
      );
    }

    const value: unknown = (json as JSONObject)["value"];

    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new BadDataException(
        `${field}.value must be an object with ${RESTRICTION_TYPE_KEY}: ${SPELLED_TYPES}.`,
      );
    }

    const type: RestrictionType = RestrictionTimes.readWrittenType(
      value as JSONObject,
      { field: field, currentType: options?.currentType },
    );

    RestrictionTimes.checkWindows(value as JSONObject, {
      field: field,
      type: type,
    });

    const restrictionTimes: RestrictionTimes = RestrictionTimes.fromJSON(
      json as JSONObject,
    );

    restrictionTimes.restrictionType = type;

    return restrictionTimes;
  }

  // The type a write names, or why it names none (fromWrittenJSON).
  private static readWrittenType(
    value: JSONObject,
    data: {
      field: string;
      currentType: RestrictionType | null | undefined;
    },
  ): RestrictionType {
    const named: unknown = value[RESTRICTION_TYPE_KEY];
    const spelledBefore: unknown = value[LEGACY_RESTRICTION_TYPE_KEY];
    const hasNamed: boolean = named !== undefined && named !== null;
    const hasSpelledBefore: boolean =
      spelledBefore !== undefined && spelledBefore !== null;

    if (!hasNamed && !hasSpelledBefore) {
      const unread: Array<string> = Object.keys(value).filter(
        (key: string): boolean => {
          return !RESTRICTION_TIMES_VALUE_KEYS.includes(key);
        },
      );

      throw new BadDataException(
        `${data.field}.value.${RESTRICTION_TYPE_KEY} is missing. Set it to ${SPELLED_TYPES}.` +
          (unread.length > 0
            ? ` ${unread
                .map((key: string): string => {
                  return `"${refusedValue(key)}"`;
                })
                .join(", ")} ${
                unread.length === 1 ? "is not a key" : "are not keys"
              } OneUptime reads: a restriction's keys are ${RESTRICTION_TYPE_KEY}, dayRestrictionTimes and weeklyRestrictionTimes.`
            : ""),
      );
    }

    for (const [key, candidate, isPresent] of [
      [RESTRICTION_TYPE_KEY, named, hasNamed],
      [LEGACY_RESTRICTION_TYPE_KEY, spelledBefore, hasSpelledBefore],
    ] as Array<[string, unknown, boolean]>) {
      if (isPresent && !RestrictionTimes.isRestrictionType(candidate)) {
        throw new BadDataException(
          `${data.field}.value.${key} is "${refusedValue(candidate)}", which is not a restriction type. Set it to ${SPELLED_TYPES}.`,
        );
      }
    }

    if (hasNamed && hasSpelledBefore && named !== spelledBefore) {
      /*
       * A client that read the record (both spellings, alike) and changed
       * the one it knows: the one still equal to the type now is stale.
       */
      if (data.currentType && spelledBefore === data.currentType) {
        return named as RestrictionType;
      }

      if (data.currentType && named === data.currentType) {
        return spelledBefore as RestrictionType;
      }

      throw new BadDataException(
        `${data.field}.value names two restriction types: ${RESTRICTION_TYPE_KEY} is "${String(named)}" and ${LEGACY_RESTRICTION_TYPE_KEY} is "${String(spelledBefore)}". Send ${RESTRICTION_TYPE_KEY} alone: ${LEGACY_RESTRICTION_TYPE_KEY} is its older spelling.`,
      );
    }

    return (hasNamed ? named : spelledBefore) as RestrictionType;
  }

  // The windows a write's type reads, checked (fromWrittenJSON).
  private static checkWindows(
    value: unknown,
    data: { field: string; type: RestrictionType },
  ): void {
    const restriction: JSONObject =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as JSONObject)
        : {};

    if (data.type === RestrictionType.Daily) {
      const day: unknown = restriction["dayRestrictionTimes"];

      if (!day || typeof day !== "object" || Array.isArray(day)) {
        throw new BadDataException(
          `A Daily restriction needs ${data.field}.value.dayRestrictionTimes: {"startTime": ..., "endTime": ...}, the window the layer is on call each day. For on call around the clock, set ${RESTRICTION_TYPE_KEY} to None.`,
        );
      }

      const start: Date = RestrictionTimes.readWrittenMoment(
        (day as JSONObject)["startTime"],
        `${data.field}.value.dayRestrictionTimes.startTime`,
      );
      const end: Date = RestrictionTimes.readWrittenMoment(
        (day as JSONObject)["endTime"],
        `${data.field}.value.dayRestrictionTimes.endTime`,
      );

      /*
       * Compared as UTC time of day, which is stable whatever the server's
       * zone (audit F22): a window open for no time pages nobody.
       */
      if (
        RestrictionTimes.getUtcSecondOfDay(start) ===
        RestrictionTimes.getUtcSecondOfDay(end)
      ) {
        throw new BadDataException(
          "Daily restriction 'From' and 'To' times cannot be the same. Choose a window with a positive duration, or set restrictions to None for 24/7 coverage.",
        );
      }

      return;
    }

    if (data.type === RestrictionType.Weekly) {
      const weekly: unknown = restriction["weeklyRestrictionTimes"];

      if (!Array.isArray(weekly)) {
        throw new BadDataException(
          `A Weekly restriction needs ${data.field}.value.weeklyRestrictionTimes: a list of windows, each {"startDay", "startTime", "endDay", "endTime"}. For on call around the clock, set ${RESTRICTION_TYPE_KEY} to None.`,
        );
      }

      weekly.forEach((window: unknown, index: number): void => {
        const name: string = `${data.field}.value.weeklyRestrictionTimes[${index}]`;

        if (!window || typeof window !== "object" || Array.isArray(window)) {
          throw new BadDataException(
            `${name} must be a window: {"startDay", "startTime", "endDay", "endTime"}.`,
          );
        }

        const start: Date = RestrictionTimes.readWrittenMoment(
          (window as JSONObject)["startTime"],
          `${name}.startTime`,
        );
        const end: Date = RestrictionTimes.readWrittenMoment(
          (window as JSONObject)["endTime"],
          `${name}.endTime`,
        );

        if (
          RestrictionTimes.getUtcSecondOfWeek(start) ===
          RestrictionTimes.getUtcSecondOfWeek(end)
        ) {
          throw new BadDataException(
            `${name} opens and closes at the same moment of the week, so it is never open. Give it an end after its start, or set ${RESTRICTION_TYPE_KEY} to None for on call around the clock.`,
          );
        }
      });
    }
  }

  /*
   * A moment of a written window: a date and time, as the API writes one -
   * {"_type": "DateTime", "value": "<ISO 8601>"}, the text alone, or a Date.
   * A time of day alone ("09:00") is refused: the engine reads the time of
   * day of a full date and time, in the schedule's time zone, and reads
   * nothing from "09:00".
   */
  private static readWrittenMoment(value: unknown, name: string): Date {
    const moment: Date | null = RestrictionTimes.readMoment(value);

    if (!moment) {
      throw new BadDataException(
        `${name} is ${
          value === undefined
            ? "missing"
            : `"${refusedValue(
                value && typeof value === "object"
                  ? JSON.stringify(value)
                  : value,
              )}", which is not a date and time`
        }. Write it as ${MOMENT_EXAMPLE}: only its time of day counts for a Daily window (its weekday as well for a Weekly one), read in the schedule's time zone.`,
      );
    }

    return moment;
  }

  // A moment as stored or written, or null when it is none.
  public static readMoment(value: unknown): Date | null {
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value;
    }

    let text: unknown = value;

    if (value && typeof value === "object" && !Array.isArray(value)) {
      const wrapped: JSONObject = value as JSONObject;

      if (wrapped["_type"] !== "DateTime" && wrapped["_type"] !== "Date") {
        return null;
      }

      text = wrapped["value"];
    }

    if (typeof text !== "string") {
      return null;
    }

    const trimmed: string = text.trim();

    // A calendar date first: "09:00" alone names no day to read a time on.
    if (!CALENDAR_DATE_FIRST.test(trimmed)) {
      return null;
    }

    try {
      const date: Date = OneUptimeDate.fromString(trimmed);
      return Number.isNaN(date.getTime()) ? null : date;
    } catch {
      return null;
    }
  }

  private static isUsableDayWindow(day: unknown): boolean {
    if (!day || typeof day !== "object" || Array.isArray(day)) {
      return false;
    }

    const start: Date | null = RestrictionTimes.readMoment(
      (day as JSONObject)["startTime"],
    );
    const end: Date | null = RestrictionTimes.readMoment(
      (day as JSONObject)["endTime"],
    );

    return (
      Boolean(start && end) &&
      RestrictionTimes.getUtcSecondOfDay(start!) !==
        RestrictionTimes.getUtcSecondOfDay(end!)
    );
  }

  private static isUsableWeeklyWindow(window: unknown): boolean {
    if (!window || typeof window !== "object" || Array.isArray(window)) {
      return false;
    }

    const start: Date | null = RestrictionTimes.readMoment(
      (window as JSONObject)["startTime"],
    );
    const end: Date | null = RestrictionTimes.readMoment(
      (window as JSONObject)["endTime"],
    );

    return (
      Boolean(start && end) &&
      RestrictionTimes.getUtcSecondOfWeek(start!) !==
        RestrictionTimes.getUtcSecondOfWeek(end!)
    );
  }

  private static getUtcSecondOfDay(date: Date): number {
    return (
      date.getUTCHours() * 3600 +
      date.getUTCMinutes() * 60 +
      date.getUTCSeconds()
    );
  }

  private static getUtcSecondOfWeek(date: Date): number {
    return date.getUTCDay() * 86400 + RestrictionTimes.getUtcSecondOfDay(date);
  }

  public removeAllRestrictions(): void {
    this.restrictionType = RestrictionType.None;
    this.dayRestrictionTimes = null;
    this.weeklyRestrictionTimes = [];
  }

  public addDefaultDailyRestriction(): void {
    this.restrictionType = RestrictionType.Daily;
    this.dayRestrictionTimes = {
      startTime: OneUptimeDate.getDateWithCustomTime({
        hours: 0,
        minutes: 0,
        seconds: 0,
      }),
      endTime: OneUptimeDate.getDateWithCustomTime({
        hours: 1,
        minutes: 0,
        seconds: 0,
      }),
    };
    this.weeklyRestrictionTimes = [];
  }

  public addDefaultWeeklyRestriction(): void {
    this.restrictionType = RestrictionType.Weekly;
    this.dayRestrictionTimes = null;
    this.weeklyRestrictionTimes = [
      RestrictionTimes.getDefaultWeeklyRestrictionTIme(),
    ];
  }

  public static getDefaultWeeklyRestrictionTIme(): WeeklyResctriction {
    const startDay: DayOfWeek = DayOfWeek.Sunday;
    const endDay: DayOfWeek = DayOfWeek.Monday;

    /*
     * Build the timestamps ON the named weekday. The rotation engine derives the
     * ENFORCED weekday purely from the timestamp (getDayOfWeek(startTime)), NOT
     * from startDay/endDay — so stamping TODAY's date (getDateWithCustomTime uses
     * the current date) made an untouched default enforce coverage on TODAY's
     * weekday while the dropdown still displayed Sunday -> Monday, i.e. the
     * displayed config never matched who was actually on call (audit M4).
     * moveDateToTheDayOfWeek keeps the time-of-day and moves to the target
     * weekday, so timestamp, dropdown enum, preview and summary all agree.
     */
    const now: Date = OneUptimeDate.getCurrentDate();

    const startTime: Date = OneUptimeDate.moveDateToTheDayOfWeek(
      OneUptimeDate.getDateWithCustomTime({ hours: 0, minutes: 0, seconds: 0 }),
      now,
      startDay,
    );

    const endTime: Date = OneUptimeDate.moveDateToTheDayOfWeek(
      OneUptimeDate.getDateWithCustomTime({ hours: 1, minutes: 0, seconds: 0 }),
      now,
      endDay,
    );

    return {
      startDay,
      endDay,
      startTime,
      endTime,
    };
  }

  /*
   * Stored with the type under its name alone (toDatabaseJSON). A value
   * that is not an instance - a write's JSON no service read - is stored as
   * it came; reading it reads either spelling.
   */
  protected static override toDatabase(
    value: RestrictionTimes | FindOperator<RestrictionTimes>,
  ): JSONObject | null {
    if (value && value instanceof RestrictionTimes) {
      return (value as RestrictionTimes).toDatabaseJSON();
    } else if (value) {
      return JSONFunctions.serialize(value as any);
    }

    return null;
  }

  protected static override fromDatabase(
    value: JSONObject,
  ): RestrictionTimes | null {
    if (value) {
      return RestrictionTimes.fromJSON(value);
    }

    return null;
  }
}
