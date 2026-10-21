import DayOfWeek from "../../../../../Types/Day/DayOfWeek";
import EventInterval from "../../../../../Types/Events/EventInterval";
import { DEFAULT_ESCALATE_AFTER_IN_MINUTES } from "../../../../../Types/OnCallDutyPolicy/EscalationRuleDefaults";
import {
  TOOL_IMPORT_MAX_LEVELS_PER_POLICY,
  TOOL_IMPORT_MAX_RECORDS_PER_KIND,
} from "../../../../../Types/ToolImport/ToolImportLimits";
import {
  makeToolImportNote,
  ToolImportNote,
  ToolImportNoteCode,
} from "../../../../../Types/ToolImport/ToolImportNote";
import ToolImportResourceKind from "../../../../../Types/ToolImport/ToolImportResourceKind";
import {
  ALL_DAYS_OF_WEEK,
  buildRestrictionFromDayWindows,
  getTimezoneDifference,
  MINUTES_PER_DAY,
  resolveImportedTimezone,
  shiftRestriction,
} from "../../../../../Types/ToolImport/ToolImportScheduleRules";
import {
  getEmptyToolImportSnapshot,
  ImportedPerson,
  ImportedPolicy,
  ImportedPolicyLevel,
  ImportedRestriction,
  ImportedRotation,
  ImportedSchedule,
  ImportedTeam,
  ToolImportSnapshot,
} from "../../../../../Types/ToolImport/ToolImportSnapshot";
import ToolImportSource from "../../../../../Types/ToolImport/ToolImportSource";
import ToolImportHttpClient, {
  ToolImportHttpError,
  ToolImportHttpErrorKind,
} from "../../ToolImportHttpClient";
import {
  asArray,
  asNumber,
  asRecord,
  asString,
  capRecords,
  cleanEmail,
  cleanName,
  createToolImportClient,
  readOptionalList,
  toFatalReadError,
  ToolImportPeopleIndex,
  uniqueStrings,
} from "../../ToolImportAdapterSupport";
import {
  ToolImportAdapter,
  ToolImportReadContext,
  ToolImportReadError,
  ToolImportReadSettings,
} from "../../Types";
import moment from "moment-timezone";

/*
 * GRAFANA ONCALL (Grafana Cloud IRM, or a self-hosted Grafana OnCall).
 *
 * Reads, with an OnCall API token (an import never writes to Grafana
 * OnCall), through the HTTP API documented at
 * https://grafana.com/docs/oncall/latest/oncall-api-reference/, at the
 * OnCall API URL the person copies from Grafana OnCall's settings:
 *
 *   GET {url}/api/v1/users/?page=&perpage=                  people, and their teams
 *   GET {url}/api/v1/teams/?page=&perpage=                  teams
 *   GET {url}/api/v1/schedules/?page=&perpage=              schedules
 *   GET {url}/api/v1/on_call_shifts/?page=&perpage=         every schedule's rotations
 *   GET {url}/api/v1/escalation_chains/?page=&perpage=      escalation chains
 *   GET {url}/api/v1/escalation_policies/?page=&perpage=    every chain's steps
 *
 * Auth is `Authorization: <token>`. The address is the person's own (Grafana
 * Cloud's is like https://oncall-prod-us-central-0.grafana.net/oncall), so
 * every request goes through OneUptime's egress guard
 * (createToolImportAddressTransport). Grafana OnCall allows 300 requests per
 * token in five minutes, so the read keeps to one a second. It answers a
 * token it does not know with a 403 ("Invalid token.").
 *
 * How Grafana OnCall's ideas map:
 *  - A web or calendar schedule's rotations (on-call shifts) are layers. A
 *    rotation's layer priority (`level`) decides who is on call where
 *    rotations overlap: a higher level wins, and rotations of one level are
 *    on call together - which is how the rotations come over (precedence).
 *  - A rotation hands over to its next group of people at each recurrence
 *    (`frequency` times `interval`), from the first one at or after its
 *    rotation start, and each recurrence lasts `duration` seconds: that is
 *    the layer's turn and, when it is shorter than the turn, its daily or
 *    weekly hours. A group of several people on call together becomes one
 *    layer per place in the group, as other tools' rotations with several
 *    people on call at once do.
 *  - Times are kept in the rotation's time zone (UTC for a rotation made in
 *    Grafana's web UI, the schedule's for one made through the API), and
 *    come over in the schedule's.
 *  - A schedule read from an iCal link has no rotations to read: it comes
 *    over without layers. One-off shifts and overrides do not come over.
 *  - An escalation chain is a policy, and its steps are levels: the steps
 *    between two waits page together, and a wait is the level's wait.
 */

const PAGE_SIZE: number = 100;

const KEY_ADVICE: string =
  "Check that you copied the whole API key (the API token from Grafana OnCall's settings, not a service account token) and the OnCall API URL shown next to it.";

// Grafana OnCall's day names (iCal's).
const ICAL_DAYS: Record<string, DayOfWeek> = {
  SU: DayOfWeek.Sunday,
  MO: DayOfWeek.Monday,
  TU: DayOfWeek.Tuesday,
  WE: DayOfWeek.Wednesday,
  TH: DayOfWeek.Thursday,
  FR: DayOfWeek.Friday,
  SA: DayOfWeek.Saturday,
};

// How Grafana OnCall writes a rotation's times: no zone, the shift's zone.
const NAIVE_TIME_FORMAT: string = "YYYY-MM-DDTHH:mm:ss";

const NAIVE_TIME_FORMATS: Array<string> = [
  NAIVE_TIME_FORMAT,
  "YYYY-MM-DDTHH:mm",
  "YYYY-MM-DD HH:mm:ss",
];

// How many times a chain repeats from the start at most (Grafana's limit).
const GRAFANA_MAX_REPEATS: number = 5;

export default class GrafanaOnCallAdapter implements ToolImportAdapter {
  public source: ToolImportSource = ToolImportSource.GrafanaOnCall;

  public async read(
    settings: ToolImportReadSettings,
    context: ToolImportReadContext,
  ): Promise<ToolImportSnapshot> {
    const client: ToolImportHttpClient = createToolImportClient({
      settings: settings,
      context: context,
    });

    const snapshot: ToolImportSnapshot = getEmptyToolImportSnapshot(
      ToolImportSource.GrafanaOnCall,
    );
    const now: number = context.now ? context.now() : Date.now();
    const membersByTeam: Map<string, Array<string>> = new Map<
      string,
      Array<string>
    >();

    snapshot.accountName = toAccountName(settings.apiUrl);

    try {
      await context.onProgress?.(ToolImportResourceKind.Person);
      // The first request checks the token: anything it refuses ends the read.
      snapshot.people = await this.readPeople(
        client,
        membersByTeam,
        snapshot.notes,
      );

      const peopleIndex: ToolImportPeopleIndex = new ToolImportPeopleIndex(
        snapshot.people,
      );

      await context.onProgress?.(ToolImportResourceKind.Team);
      snapshot.teams = await readOptionalList<ImportedTeam>({
        kind: ToolImportResourceKind.Team,
        notes: snapshot.notes,
        read: async (): Promise<Array<ImportedTeam>> => {
          return await this.readTeams(client, membersByTeam, snapshot.notes);
        },
      });

      await context.onProgress?.(ToolImportResourceKind.OnCallSchedule);
      snapshot.schedules = await readOptionalList<ImportedSchedule>({
        kind: ToolImportResourceKind.OnCallSchedule,
        notes: snapshot.notes,
        read: async (): Promise<Array<ImportedSchedule>> => {
          return await this.readSchedules(
            client,
            peopleIndex,
            snapshot.notes,
            now,
          );
        },
      });

      await context.onProgress?.(ToolImportResourceKind.OnCallPolicy);
      snapshot.policies = await readOptionalList<ImportedPolicy>({
        kind: ToolImportResourceKind.OnCallPolicy,
        notes: snapshot.notes,
        read: async (): Promise<Array<ImportedPolicy>> => {
          return await this.readPolicies(client, peopleIndex, snapshot.notes);
        },
      });
    } catch (error) {
      throw toFatalReadError({
        error: error,
        toolName: "Grafana OnCall",
        keyAdvice: KEY_ADVICE,
      });
    }

    snapshot.readAt = new Date(
      context.now ? context.now() : Date.now(),
    ).toISOString();

    return snapshot;
  }

  /*
   * Every record of a page-numbered list: `results` of each page, page by
   * page until one says there is no next. At most
   * TOOL_IMPORT_MAX_RECORDS_PER_KIND records; `hasMore` says when there were
   * more. The `next` link a page carries is never followed: the next page
   * is asked for by its number, at the address the person gave.
   */
  private async readPaged(
    client: ToolImportHttpClient,
    path: string,
  ): Promise<{ records: Array<unknown>; hasMore: boolean }> {
    const records: Array<unknown> = [];

    for (let page: number = 1; ; page++) {
      const body: Record<string, unknown> = asRecord(
        await client.getJson(path, { page: page, perpage: PAGE_SIZE }),
      );

      const results: Array<unknown> = asArray(body["results"]);
      records.push(...results);

      const totalPages: number | null = asNumber(body["total_pages"]);
      const hasNext: boolean =
        results.length > 0 &&
        Boolean(asString(body["next"])) &&
        (totalPages === null || page < totalPages);

      if (!hasNext) {
        return { records: records, hasMore: false };
      }

      if (records.length >= TOOL_IMPORT_MAX_RECORDS_PER_KIND) {
        return { records: records, hasMore: true };
      }
    }
  }

  private async readPeople(
    client: ToolImportHttpClient,
    membersByTeam: Map<string, Array<string>>,
    notes: Array<ToolImportNote>,
  ): Promise<Array<ImportedPerson>> {
    let read: { records: Array<unknown>; hasMore: boolean };

    try {
      read = await this.readPaged(client, "/api/v1/users/");
    } catch (error) {
      /*
       * Grafana OnCall answers a token it does not know with a 403, and
       * any token may read its people: on the first request either refusal
       * means the token was refused.
       */
      if (
        error instanceof ToolImportHttpError &&
        (error.kind === ToolImportHttpErrorKind.Unauthorized ||
          error.kind === ToolImportHttpErrorKind.Forbidden)
      ) {
        throw new ToolImportReadError(
          `Grafana OnCall did not accept the API key. ${KEY_ADVICE}`,
        );
      }

      throw error;
    }

    const people: Array<ImportedPerson> = [];

    for (const raw of read.records) {
      const user: Record<string, unknown> = asRecord(raw);
      const sourceId: string = asString(user["id"]);

      if (!sourceId) {
        continue;
      }

      const email: string | null = cleanEmail(user["email"]);

      people.push({
        sourceId: sourceId,
        name: cleanName(user["name"] || user["username"], email || sourceId),
        email: email,
        isActive: true,
        notes: [],
      });

      for (const rawTeam of asArray(user["teams"])) {
        const teamId: string = asString(rawTeam);

        if (teamId) {
          const members: Array<string> = membersByTeam.get(teamId) || [];
          members.push(sourceId);
          membersByTeam.set(teamId, members);
        }
      }
    }

    return capRecords({
      kind: ToolImportResourceKind.Person,
      records: people,
      notes: notes,
      hasMore: read.hasMore,
    });
  }

  private async readTeams(
    client: ToolImportHttpClient,
    membersByTeam: Map<string, Array<string>>,
    notes: Array<ToolImportNote>,
  ): Promise<Array<ImportedTeam>> {
    const read: { records: Array<unknown>; hasMore: boolean } =
      await this.readPaged(client, "/api/v1/teams/");

    const teams: Array<ImportedTeam> = [];

    for (const raw of read.records) {
      const team: Record<string, unknown> = asRecord(raw);
      const sourceId: string = asString(team["id"]);

      if (!sourceId) {
        continue;
      }

      teams.push({
        sourceId: sourceId,
        name: cleanName(team["name"], sourceId),
        memberSourceIds: uniqueStrings(membersByTeam.get(sourceId) || []),
        notes: [],
      });
    }

    return capRecords({
      kind: ToolImportResourceKind.Team,
      records: teams,
      notes: notes,
      hasMore: read.hasMore,
    });
  }

  private async readSchedules(
    client: ToolImportHttpClient,
    peopleIndex: ToolImportPeopleIndex,
    notes: Array<ToolImportNote>,
    now: number,
  ): Promise<Array<ImportedSchedule>> {
    const read: { records: Array<unknown>; hasMore: boolean } =
      await this.readPaged(client, "/api/v1/schedules/");

    const rawSchedules: Array<Record<string, unknown>> = read.records
      .map((raw: unknown): Record<string, unknown> => {
        return asRecord(raw);
      })
      .filter((schedule: Record<string, unknown>): boolean => {
        return Boolean(asString(schedule["id"]));
      });

    const hasRotations: boolean = rawSchedules.some(
      (schedule: Record<string, unknown>): boolean => {
        return asString(schedule["type"]).toLowerCase() !== "ical";
      },
    );

    // Every rotation of every schedule, in one list.
    const shifts: Array<Record<string, unknown>> = hasRotations
      ? (await this.readPaged(client, "/api/v1/on_call_shifts/")).records.map(
          (raw: unknown): Record<string, unknown> => {
            return asRecord(raw);
          },
        )
      : [];

    const schedules: Array<ImportedSchedule> = rawSchedules.map(
      (schedule: Record<string, unknown>): ImportedSchedule => {
        return this.toSchedule({
          schedule: schedule,
          shifts: shifts,
          peopleIndex: peopleIndex,
          now: now,
        });
      },
    );

    return capRecords({
      kind: ToolImportResourceKind.OnCallSchedule,
      records: schedules,
      notes: notes,
      hasMore: read.hasMore,
    });
  }

  private toSchedule(data: {
    schedule: Record<string, unknown>;
    shifts: Array<Record<string, unknown>>;
    peopleIndex: ToolImportPeopleIndex;
    now: number;
  }): ImportedSchedule {
    const schedule: Record<string, unknown> = data.schedule;
    const sourceId: string = asString(schedule["id"]);
    const type: string = asString(schedule["type"]).toLowerCase();
    const timezone: string =
      resolveImportedTimezone(asString(schedule["time_zone"])) || "UTC";
    const teamId: string = asString(schedule["team_id"]);
    const scheduleNotes: Array<ToolImportNote> = [];
    const rotations: Array<ImportedRotation> = [];

    if (type === "ical") {
      scheduleNotes.push(
        makeToolImportNote(ToolImportNoteCode.ScheduleFromCalendarLink),
      );
    } else {
      const shiftIds: Set<string> = new Set<string>(
        asArray(schedule["shifts"]).map((id: unknown): string => {
          return asString(id);
        }),
      );

      const ownShifts: Array<Record<string, unknown>> = data.shifts.filter(
        (shift: Record<string, unknown>): boolean => {
          return (
            shiftIds.has(asString(shift["id"])) ||
            asString(shift["schedule"]) === sourceId
          );
        },
      );

      ownShifts.forEach(
        (shift: Record<string, unknown>, index: number): void => {
          rotations.push(
            ...toRotations({
              shift: shift,
              index: index,
              // A web schedule's rotations keep UTC; an API schedule's, its zone.
              defaultTimezone: type === "calendar" ? timezone : "UTC",
              scheduleTimezone: timezone,
              peopleIndex: data.peopleIndex,
              now: data.now,
              scheduleNotes: scheduleNotes,
            }),
          );
        },
      );
    }

    return {
      sourceId: sourceId,
      name: cleanName(schedule["name"], sourceId),
      timezone: timezone,
      isEnabled: true,
      ownerTeamSourceIds: teamId ? [teamId] : [],
      rotations: rotations,
      notes: scheduleNotes,
    };
  }

  private async readPolicies(
    client: ToolImportHttpClient,
    peopleIndex: ToolImportPeopleIndex,
    notes: Array<ToolImportNote>,
  ): Promise<Array<ImportedPolicy>> {
    const chains: { records: Array<unknown>; hasMore: boolean } =
      await this.readPaged(client, "/api/v1/escalation_chains/");

    const rawChains: Array<Record<string, unknown>> = chains.records
      .map((raw: unknown): Record<string, unknown> => {
        return asRecord(raw);
      })
      .filter((chain: Record<string, unknown>): boolean => {
        return Boolean(asString(chain["id"]));
      });

    const steps: Array<Record<string, unknown>> =
      rawChains.length > 0
        ? (
            await this.readPaged(client, "/api/v1/escalation_policies/")
          ).records.map((raw: unknown): Record<string, unknown> => {
            return asRecord(raw);
          })
        : [];

    const policies: Array<ImportedPolicy> = rawChains.map(
      (chain: Record<string, unknown>): ImportedPolicy => {
        const sourceId: string = asString(chain["id"]);
        const teamId: string = asString(chain["team_id"]);
        const policyNotes: Array<ToolImportNote> = [];

        const chainSteps: Array<Record<string, unknown>> = steps
          .filter((step: Record<string, unknown>): boolean => {
            return asString(step["escalation_chain_id"]) === sourceId;
          })
          .sort(
            (
              first: Record<string, unknown>,
              second: Record<string, unknown>,
            ): number => {
              return (
                (asNumber(first["position"]) || 0) -
                (asNumber(second["position"]) || 0)
              );
            },
          );

        const flattened: {
          levels: Array<ImportedPolicyLevel>;
          repeatTimes: number;
        } = toLevels({
          steps: chainSteps,
          peopleIndex: peopleIndex,
          notes: policyNotes,
        });

        return {
          sourceId: sourceId,
          name: cleanName(chain["name"], sourceId),
          ownerTeamSourceIds: teamId ? [teamId] : [],
          levels: flattened.levels,
          repeatTimes: flattened.repeatTimes,
          notes: policyNotes,
        };
      },
    );

    return capRecords({
      kind: ToolImportResourceKind.OnCallPolicy,
      records: policies,
      notes: notes,
      hasMore: chains.hasMore,
    });
  }
}

// A Grafana OnCall time ("2026-01-05T09:00:00", no zone) in `timezone`.
export function parseGrafanaTime(
  value: unknown,
  timezone: string,
): moment.Moment | null {
  const text: string = asString(value);

  if (!text) {
    return null;
  }

  const parsed: moment.Moment = moment.tz(
    text,
    NAIVE_TIME_FORMATS,
    true,
    timezone,
  );

  if (parsed.isValid()) {
    return parsed;
  }

  // A time that names its zone (an offset or "Z") is that instant.
  const instant: number = Date.parse(text);

  return Number.isFinite(instant) ? moment.tz(instant, timezone) : null;
}

interface RotationPattern {
  intervalType: EventInterval;
  intervalCount: number;
  // In the rotation's own time zone's wall-clock time.
  restriction: ImportedRestriction | null;
  // Whether OneUptime hands over exactly when Grafana OnCall does.
  isTurnExact: boolean;
  // Whether the restriction is exactly the hours the rotation is on call.
  isRestrictionExact: boolean;
}

const FREQUENCY_UNITS: Record<string, EventInterval> = {
  hourly: EventInterval.Hour,
  daily: EventInterval.Day,
  weekly: EventInterval.Week,
  monthly: EventInterval.Month,
};

// The shortest each unit can be: a recurrence this long or longer never ends.
const UNIT_MINUTES: Record<string, number> = {
  hourly: 60,
  daily: MINUTES_PER_DAY,
  weekly: 7 * MINUTES_PER_DAY,
  // A month is at least 28 days.
  monthly: 28 * MINUTES_PER_DAY,
};

/*
 * The longest each unit can be, give or take a daylight saving hour: dividing
 * by it never counts more turns than have passed.
 */
const LONGEST_UNIT_MINUTES: Record<string, number> = {
  hourly: 60,
  daily: MINUTES_PER_DAY + 60,
  weekly: 7 * MINUTES_PER_DAY + 60,
  monthly: 31 * MINUTES_PER_DAY + 60,
};

/*
 * When a rotation is on call and how often it hands over, from its
 * recurrence: `frequency` times `interval`, on the days `by_day` names (if
 * any), each recurrence lasting `durationMinutes` from the time of day it
 * starts at.
 */
export function toRotationPattern(data: {
  frequency: string;
  interval: number;
  byDay: Array<string>;
  hasCalendarRules: boolean;
  start: moment.Moment;
  durationMinutes: number;
  groupCount: number;
}): RotationPattern {
  const frequency: string =
    data.frequency in FREQUENCY_UNITS ? data.frequency : "weekly";
  const unit: EventInterval = FREQUENCY_UNITS[frequency]!;
  const interval: number = Math.max(1, Math.floor(data.interval) || 1);
  const days: Array<DayOfWeek> = uniqueStrings(
    data.byDay.map((day: string): string => {
      return ICAL_DAYS[day.trim().toUpperCase()] || "";
    }),
  ) as Array<DayOfWeek>;
  const startMinuteOfDay: number =
    data.start.hours() * 60 + data.start.minutes();
  const startDay: DayOfWeek = ALL_DAYS_OF_WEEK[data.start.day()]!;
  const turnMinutes: number = UNIT_MINUTES[frequency]! * interval;
  const isAlwaysOn: boolean = data.durationMinutes >= turnMinutes;

  const windowsOn: (
    onDays: ReadonlyArray<DayOfWeek>,
  ) => ImportedRestriction | null = (
    onDays: ReadonlyArray<DayOfWeek>,
  ): ImportedRestriction | null => {
    return buildRestrictionFromDayWindows(
      onDays.map((day: DayOfWeek) => {
        return {
          day: day,
          startMinuteOfDay: startMinuteOfDay,
          durationMinutes: data.durationMinutes,
        };
      }),
    );
  };

  const pattern: RotationPattern = {
    intervalType: unit,
    intervalCount: interval,
    restriction: null,
    isTurnExact: !data.hasCalendarRules,
    isRestrictionExact: !data.hasCalendarRules,
  };

  if (frequency === "daily") {
    if (days.length > 0) {
      // On the days named; the group hands over each of those days only.
      pattern.restriction = windowsOn(days);
      pattern.isTurnExact = pattern.isTurnExact && days.length === 7;
      pattern.isRestrictionExact = pattern.isRestrictionExact && interval === 1;
    } else if (!isAlwaysOn) {
      pattern.restriction = windowsOn(ALL_DAYS_OF_WEEK);
      // Every few days is not a daily window.
      pattern.isRestrictionExact = pattern.isRestrictionExact && interval === 1;
    }
  } else if (frequency === "weekly") {
    if (days.length > 0) {
      pattern.restriction = windowsOn(days);
      pattern.isRestrictionExact = pattern.isRestrictionExact && interval === 1;
    } else if (!isAlwaysOn) {
      pattern.restriction = windowsOn([startDay]);
      pattern.isRestrictionExact = pattern.isRestrictionExact && interval === 1;
    }
  } else if (!isAlwaysOn) {
    // Hours within an hour, or days within a month, are not a day's window.
    pattern.isRestrictionExact = false;
  }

  // With one group, whoever hands over to whom, the same people are on call.
  if (data.groupCount <= 1) {
    pattern.isTurnExact = true;
  }

  return pattern;
}

/*
 * The first recurrence a rotation's first group is on call in: the first
 * at or after its rotation start - or under way then, as Grafana OnCall
 * counts a rotation edited in its web UI. Recurrences are `interval`
 * frequency units apart from its start, in its time zone.
 */
export function getFirstTurnStart(data: {
  start: moment.Moment;
  rotationStart: moment.Moment;
  frequency: string;
  interval: number;
  durationMinutes: number;
}): moment.Moment {
  if (!data.rotationStart.isAfter(data.start)) {
    return data.start.clone();
  }

  const unit: moment.unitOfTime.DurationConstructor =
    data.frequency === "hourly"
      ? "hours"
      : data.frequency === "daily"
        ? "days"
        : data.frequency === "monthly"
          ? "months"
          : "weeks";
  const interval: number = Math.max(1, Math.floor(data.interval) || 1);
  const longestTurnMinutes: number =
    (LONGEST_UNIT_MINUTES[data.frequency] || LONGEST_UNIT_MINUTES["weekly"]!) *
    interval;
  const behindMinutes: number = data.rotationStart.diff(data.start, "minutes");
  // Start a turn or two short of it, then step forward.
  let turns: number = Math.max(
    0,
    Math.floor(behindMinutes / longestTurnMinutes) - 2,
  );

  for (let step: number = 0; step < 100000; step++) {
    const candidate: moment.Moment = data.start
      .clone()
      .add(turns * interval, unit);

    if (
      candidate
        .clone()
        .add(data.durationMinutes, "minutes")
        .isAfter(data.rotationStart)
    ) {
      return candidate;
    }

    turns++;
  }

  return data.rotationStart.clone();
}

/*
 * One Grafana OnCall rotation as the layers it becomes: one for a rotation
 * of one person at a time, one per place in its groups when several are on
 * call together. Overrides and one-off shifts become none.
 */
export function toRotations(data: {
  shift: Record<string, unknown>;
  index: number;
  defaultTimezone: string;
  scheduleTimezone: string;
  peopleIndex: ToolImportPeopleIndex;
  now: number;
  scheduleNotes: Array<ToolImportNote>;
}): Array<ImportedRotation> {
  const shift: Record<string, unknown> = data.shift;
  const type: string = asString(shift["type"]).toLowerCase();
  const name: string = cleanName(shift["name"], `Rotation ${data.index + 1}`);

  if (type === "single_event") {
    data.scheduleNotes.push(
      makeToolImportNote(ToolImportNoteCode.RotationOneOff, { rotation: name }),
    );
    return [];
  }

  if (type !== "rolling_users" && type !== "recurrent_event") {
    // Overrides are not brought over, as no tool's are.
    return [];
  }

  const timezone: string =
    resolveImportedTimezone(asString(shift["time_zone"])) ||
    data.defaultTimezone;
  const start: moment.Moment | null = parseGrafanaTime(
    shift["start"],
    timezone,
  );
  const durationMinutes: number = Math.max(
    0,
    (asNumber(shift["duration"]) || 0) / 60,
  );

  if (!start || durationMinutes <= 0) {
    return [];
  }

  const until: moment.Moment | null = parseGrafanaTime(
    shift["until"],
    timezone,
  );

  if (until && until.valueOf() <= data.now) {
    data.scheduleNotes.push(
      makeToolImportNote(ToolImportNoteCode.RotationEnded, {
        rotation: name,
        date: until.toISOString(),
      }),
    );
    return [];
  }

  const notes: Array<ToolImportNote> = [];

  if (until) {
    notes.push(
      makeToolImportNote(ToolImportNoteCode.RotationEnds, {
        rotation: name,
        date: until.toISOString(),
      }),
    );
  }

  // The groups that take turns, each everyone on call in a turn.
  const rawGroups: Array<Array<unknown>> =
    type === "rolling_users"
      ? asArray(shift["rolling_users"]).map(
          (group: unknown): Array<unknown> => {
            return asArray(group);
          },
        )
      : [asArray(shift["users"])];

  const startIndex: number = Math.max(
    0,
    Math.floor(asNumber(shift["start_rotation_from_user_index"]) || 0),
  );
  const orderedGroups: Array<Array<unknown>> =
    rawGroups.length > 0
      ? [
          ...rawGroups.slice(startIndex % rawGroups.length),
          ...rawGroups.slice(0, startIndex % rawGroups.length),
        ]
      : [];

  let hasGaps: boolean = false;
  const groups: Array<Array<string>> = [];

  for (const rawGroup of orderedGroups) {
    const group: Array<string> = uniqueStrings(
      rawGroup
        .map((id: unknown): string | null => {
          return data.peopleIndex.find({ id: asString(id) });
        })
        .filter((id: string | null): id is string => {
          return Boolean(id);
        }),
    );

    if (group.length === 0) {
      hasGaps = true;
      continue;
    }

    groups.push(group);
  }

  if (hasGaps) {
    notes.push(
      makeToolImportNote(ToolImportNoteCode.RotationGaps, { rotation: name }),
    );
  }

  if (groups.length === 0) {
    data.scheduleNotes.push(
      makeToolImportNote(ToolImportNoteCode.RotationNobody, { rotation: name }),
    );
    return [];
  }

  const frequency: string = asString(shift["frequency"]).toLowerCase();
  const interval: number = Math.max(
    1,
    Math.floor(asNumber(shift["interval"]) || 1),
  );
  const pattern: RotationPattern = toRotationPattern({
    frequency: frequency,
    interval: interval,
    byDay: asArray(shift["by_day"]).map((day: unknown): string => {
      return asString(day);
    }),
    hasCalendarRules:
      asArray(shift["by_month"]).length > 0 ||
      asArray(shift["by_monthday"]).length > 0,
    start: start,
    durationMinutes: durationMinutes,
    groupCount: groups.length,
  });

  if (!pattern.isTurnExact || !pattern.isRestrictionExact) {
    notes.push(
      makeToolImportNote(ToolImportNoteCode.RotationApproximated, {
        rotation: name,
      }),
    );
  }

  let restriction: ImportedRestriction | null = pattern.restriction;

  if (restriction && timezone !== data.scheduleTimezone) {
    const difference: { minutes: number; isConstant: boolean } =
      getTimezoneDifference({
        timezone: data.scheduleTimezone,
        otherTimezone: timezone,
        at: new Date(data.now),
      });

    restriction = shiftRestriction(restriction, difference.minutes);

    if (!difference.isConstant) {
      notes.push(
        makeToolImportNote(ToolImportNoteCode.RotationTimezoneConverted, {
          rotation: name,
          timezone: timezone,
        }),
      );
    }
  }

  const rotationStart: moment.Moment =
    parseGrafanaTime(shift["rotation_start"], timezone) || start;
  const startsAt: string = (
    type === "rolling_users"
      ? getFirstTurnStart({
          start: start,
          rotationStart: rotationStart,
          frequency: frequency,
          interval: interval,
          durationMinutes: durationMinutes,
        })
      : start
  ).toISOString();

  // One layer per place in the groups, each with whoever stands there.
  const places: number = Math.max(
    ...groups.map((group: Array<string>): number => {
      return group.length;
    }),
  );

  if (places > 1) {
    data.scheduleNotes.push(
      makeToolImportNote(ToolImportNoteCode.RotationLayers, {
        rotation: name,
        count: places,
      }),
    );
  }

  const shiftId: string = asString(shift["id"]) || `rotation-${data.index + 1}`;
  const precedence: number = Math.floor(asNumber(shift["level"]) || 0);
  const rotations: Array<ImportedRotation> = [];

  for (let place: number = 0; place < places; place++) {
    const line: Array<string> = groups
      .map((group: Array<string>): string | undefined => {
        return group[place];
      })
      .filter((id: string | undefined): id is string => {
        return Boolean(id);
      });

    if (line.length === 0) {
      continue;
    }

    rotations.push({
      key: places > 1 ? `${shiftId}:${place + 1}` : shiftId,
      name: places > 1 ? cleanName(`${name} (${place + 1})`, name) : name,
      startsAt: startsAt,
      intervalType: pattern.intervalType,
      intervalCount: pattern.intervalCount,
      restriction: restriction,
      participantSourceIds: line,
      precedence: precedence,
      notes: place === 0 ? notes : [],
    });
  }

  return rotations;
}

/*
 * A chain's steps, in order, as levels: the people, teams and schedules
 * steps page between two waits page together, and a wait is the wait of
 * the level before it. Everything that cannot be a level is noted once.
 */
export function toLevels(data: {
  steps: Array<Record<string, unknown>>;
  peopleIndex: ToolImportPeopleIndex;
  notes: Array<ToolImportNote>;
}): { levels: Array<ImportedPolicyLevel>; repeatTimes: number } {
  const levels: Array<ImportedPolicyLevel> = [];
  const noted: Set<ToolImportNoteCode> = new Set<ToolImportNoteCode>();
  let waitBeforeFirstLevel: number = 0;
  let waitSinceLastLevel: number = 0;
  let repeatTimes: number = 0;

  const note: (code: ToolImportNoteCode) => void = (
    code: ToolImportNoteCode,
  ): void => {
    if (!noted.has(code)) {
      noted.add(code);
      data.notes.push(makeToolImportNote(code));
    }
  };

  // The level a paging step adds to: the open one, or a new one after a wait.
  const levelToPage: () => ImportedPolicyLevel = (): ImportedPolicyLevel => {
    const last: ImportedPolicyLevel | undefined = levels[levels.length - 1];

    if (last && waitSinceLastLevel === 0) {
      return last;
    }

    if (last) {
      last.escalateAfterMinutes = waitSinceLastLevel;
    }

    waitSinceLastLevel = 0;

    const level: ImportedPolicyLevel = {
      escalateAfterMinutes: DEFAULT_ESCALATE_AFTER_IN_MINUTES,
      personSourceIds: [],
      teamSourceIds: [],
      scheduleSourceIds: [],
    };
    levels.push(level);
    return level;
  };

  for (const step of data.steps) {
    const type: string = asString(step["type"]).toLowerCase();

    if (type === "wait") {
      const minutes: number = Math.max(
        1,
        Math.ceil((asNumber(step["duration"]) || 60) / 60),
      );

      if (levels.length === 0) {
        waitBeforeFirstLevel += minutes;
      } else {
        waitSinceLastLevel += minutes;
      }
      continue;
    }

    if (type === "notify_persons" || type === "notify_person_next_each_time") {
      const ids: Array<unknown> = asArray(
        type === "notify_persons"
          ? step["persons_to_notify"]
          : step["persons_to_notify_next_each_time"],
      );

      if (type === "notify_person_next_each_time") {
        note(ToolImportNoteCode.PolicyRoundRobin);
      }

      const level: ImportedPolicyLevel = levelToPage();

      for (const id of ids) {
        const personId: string | null = data.peopleIndex.find({
          id: asString(id),
        });

        if (personId) {
          level.personSourceIds.push(personId);
        } else {
          note(ToolImportNoteCode.PolicyUnknownTarget);
        }
      }
      continue;
    }

    if (type === "notify_on_call_from_schedule") {
      const scheduleId: string = asString(step["notify_on_call_from_schedule"]);

      if (scheduleId) {
        levelToPage().scheduleSourceIds.push(scheduleId);
      }
      continue;
    }

    if (type === "notify_team_members") {
      const teamId: string = asString(step["team_to_notify"]);

      if (teamId) {
        levelToPage().teamSourceIds.push(teamId);
      }
      continue;
    }

    if (type === "repeat_escalation") {
      repeatTimes = GRAFANA_MAX_REPEATS;
      // Nothing after a repeat runs.
      break;
    }

    if (type === "resolve") {
      note(ToolImportNoteCode.PolicyResolvesAlert);
      // Nothing after the alert is resolved runs.
      break;
    }

    switch (type) {
      case "notify_user_group":
        note(ToolImportNoteCode.PolicyUserGroup);
        break;
      case "notify_whole_channel":
        note(ToolImportNoteCode.PolicyChannelStep);
        break;
      case "trigger_webhook":
        note(ToolImportNoteCode.PolicyWebhookStep);
        break;
      case "notify_if_time_from_to":
      case "notify_if_num_alerts_in_window":
        note(ToolImportNoteCode.PolicyConditionalStep);
        break;
      case "declare_incident":
        note(ToolImportNoteCode.PolicyDeclaresIncident);
        break;
      default:
        note(ToolImportNoteCode.PolicyUnknownTarget);
    }
  }

  const last: ImportedPolicyLevel | undefined = levels[levels.length - 1];

  if (last && waitSinceLastLevel > 0) {
    last.escalateAfterMinutes = waitSinceLastLevel;
  }

  if (waitBeforeFirstLevel > 0 && levels.length > 0) {
    data.notes.push(
      makeToolImportNote(ToolImportNoteCode.PolicyFirstStepWaits, {
        minutes: waitBeforeFirstLevel,
      }),
    );
  }

  for (const level of levels) {
    level.personSourceIds = uniqueStrings(level.personSourceIds);
    level.teamSourceIds = uniqueStrings(level.teamSourceIds);
    level.scheduleSourceIds = uniqueStrings(level.scheduleSourceIds);
  }

  return {
    levels: levels.slice(0, TOOL_IMPORT_MAX_LEVELS_PER_POLICY),
    repeatTimes: levels.length > 0 ? repeatTimes : 0,
  };
}

/*
 * What the history calls the account: the host of a self-hosted install's
 * address. Grafana Cloud's OnCall hosts are shared by many stacks, so they
 * name nobody's.
 */
export function toAccountName(apiUrl: unknown): string | undefined {
  try {
    const hostname: string = new URL(asString(apiUrl)).hostname.toLowerCase();

    return hostname && !hostname.endsWith(".grafana.net")
      ? cleanName(hostname, "") || undefined
      : undefined;
  } catch {
    return undefined;
  }
}
