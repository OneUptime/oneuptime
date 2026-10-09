import DayOfWeek from "../../../../../Types/Day/DayOfWeek";
import EventInterval from "../../../../../Types/Events/EventInterval";
import { DEFAULT_ESCALATE_AFTER_IN_MINUTES } from "../../../../../Types/OnCallDutyPolicy/EscalationRuleDefaults";
import { TOOL_IMPORT_MAX_LEVELS_PER_POLICY } from "../../../../../Types/ToolImport/ToolImportLimits";
import {
  makeToolImportNote,
  ToolImportNote,
  ToolImportNoteCode,
} from "../../../../../Types/ToolImport/ToolImportNote";
import ToolImportResourceKind from "../../../../../Types/ToolImport/ToolImportResourceKind";
import {
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
  cleanDescription,
  cleanEmail,
  cleanName,
  cleanTime,
  createToolImportClient,
  isListNotAvailable,
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

/*
 * SPLUNK ON-CALL (formerly VictorOps).
 *
 * Reads, with an API ID and a key from Integrations > API (a Read-only key
 * is enough - an import never writes to Splunk On-Call), through the public
 * API documented at https://portal.victorops.com/public/api-docs.html:
 *
 *   GET /api-public/v2/user                         people
 *   GET /api-public/v1/team                         teams
 *   GET /api-public/v1/team/{team}/members          a team's members
 *   GET /api-public/v1/teams/{team}/rotations       a team's rotations' ids
 *   GET /api-public/v2/team/{team}/rotations        a team's rotations, shifts
 *                                                   and who is on call
 *   GET /api-public/v1/policies                     escalation policies, with
 *                                                   their team
 *   GET /api-public/v1/policies/{policy}            a policy's steps
 *
 * Auth is two headers, `X-VO-Api-Id: <API ID>` and `X-VO-Api-Key: <key>`,
 * against api.victorops.com. Each endpoint answers at most twice a second,
 * so the read keeps to that pace (ToolImportCatalog). A key Splunk On-Call
 * refuses is answered 401 or 403.
 *
 * Splunk On-Call names people by their username, so a person's id here is
 * their username.
 *
 * How Splunk On-Call's ideas map:
 *  - A team's rotation is a schedule, owned by the team. Its shifts are its
 *    rotations: each hands over every `duration` days from its start, to
 *    its members in order, and is on call on the days and hours its masks
 *    say. Shifts of a rotation are on call at the same time, so shifts that
 *    overlap become schedules of their own (as every overlapping rotation
 *    does), and every policy that pages the rotation pages all of them.
 *  - Who is on call now comes over as it is: the turns are lined up so the
 *    person Splunk On-Call has on call in a shift is on call in the layer.
 *  - An escalation policy's steps are levels. A step's timeout is the wait
 *    before it, so it is the previous level's wait; steps with no wait
 *    between them page together.
 */

const KEY_ADVICE: string =
  "Check that you copied the API ID and the whole API key from Integrations > API in Splunk On-Call.";

// A shift mask's day flags.
const MASK_DAYS: Array<[string, DayOfWeek]> = [
  ["su", DayOfWeek.Sunday],
  ["m", DayOfWeek.Monday],
  ["t", DayOfWeek.Tuesday],
  ["w", DayOfWeek.Wednesday],
  ["th", DayOfWeek.Thursday],
  ["f", DayOfWeek.Friday],
  ["sa", DayOfWeek.Saturday],
];

// The masks a shift can carry (the API's own spelling of the third varies).
const MASK_FIELDS: Array<string> = ["mask", "mask2", "mask3", "mast3"];

interface TeamRead {
  team: ImportedTeam;
  rotationSlugsByGroupId: Map<string, string>;
}

export default class SplunkOnCallAdapter implements ToolImportAdapter {
  public source: ToolImportSource = ToolImportSource.SplunkOnCall;

  public async read(
    settings: ToolImportReadSettings,
    context: ToolImportReadContext,
  ): Promise<ToolImportSnapshot> {
    const client: ToolImportHttpClient = createToolImportClient({
      settings: settings,
      context: context,
    });

    const snapshot: ToolImportSnapshot = getEmptyToolImportSnapshot(
      ToolImportSource.SplunkOnCall,
    );
    const now: number = context.now ? context.now() : Date.now();

    try {
      await context.onProgress?.(ToolImportResourceKind.Person);
      // The first request checks the key: anything it refuses ends the read.
      snapshot.people = await this.readPeople(client, snapshot.notes);

      const peopleIndex: ToolImportPeopleIndex = new ToolImportPeopleIndex(
        snapshot.people,
      );

      await context.onProgress?.(ToolImportResourceKind.Team);
      const teams: Array<TeamRead> = await readOptionalList<TeamRead>({
        kind: ToolImportResourceKind.Team,
        notes: snapshot.notes,
        read: async (): Promise<Array<TeamRead>> => {
          return await this.readTeams(client, peopleIndex, snapshot.notes);
        },
      });

      snapshot.teams = teams.map((read: TeamRead): ImportedTeam => {
        return read.team;
      });

      await context.onProgress?.(ToolImportResourceKind.OnCallSchedule);
      snapshot.schedules = await readOptionalList<ImportedSchedule>({
        kind: ToolImportResourceKind.OnCallSchedule,
        notes: snapshot.notes,
        read: async (): Promise<Array<ImportedSchedule>> => {
          return await this.readSchedules({
            client: client,
            teams: teams,
            peopleIndex: peopleIndex,
            notes: snapshot.notes,
            now: now,
          });
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
        toolName: "Splunk On-Call",
        keyAdvice: KEY_ADVICE,
      });
    }

    snapshot.readAt = new Date(
      context.now ? context.now() : Date.now(),
    ).toISOString();

    return snapshot;
  }

  private async readPeople(
    client: ToolImportHttpClient,
    notes: Array<ToolImportNote>,
  ): Promise<Array<ImportedPerson>> {
    let body: Record<string, unknown>;

    try {
      body = asRecord(await client.getJson("/api-public/v2/user"));
    } catch (error) {
      /*
       * Splunk On-Call answers a key it does not know with a 403 as well as
       * a 401, and any key may read its people: on the first request either
       * one means the key was refused.
       */
      if (
        error instanceof ToolImportHttpError &&
        (error.kind === ToolImportHttpErrorKind.Unauthorized ||
          error.kind === ToolImportHttpErrorKind.Forbidden)
      ) {
        throw new ToolImportReadError(
          `Splunk On-Call did not accept the API ID and API key. ${KEY_ADVICE}`,
        );
      }

      throw error;
    }

    const people: Array<ImportedPerson> = [];

    for (const raw of flatten(asArray(body["users"]))) {
      const user: Record<string, unknown> = asRecord(raw);
      const username: string = asString(user["username"]);

      if (!username) {
        continue;
      }

      const email: string | null = cleanEmail(user["email"]);
      const fullName: string = [
        asString(user["firstName"]),
        asString(user["lastName"]),
      ]
        .filter(Boolean)
        .join(" ");

      people.push({
        sourceId: username,
        name: cleanName(fullName, email || username),
        email: email,
        isActive: true,
        notes: [],
      });
    }

    return capRecords({
      kind: ToolImportResourceKind.Person,
      records: people,
      notes: notes,
    });
  }

  private async readTeams(
    client: ToolImportHttpClient,
    peopleIndex: ToolImportPeopleIndex,
    notes: Array<ToolImportNote>,
  ): Promise<Array<TeamRead>> {
    const rawTeams: Array<unknown> = capRecords({
      kind: ToolImportResourceKind.Team,
      records: asArray(await client.getJson("/api-public/v1/team")),
      notes: notes,
    });

    const teams: Array<TeamRead> = [];

    for (const raw of rawTeams) {
      const team: Record<string, unknown> = asRecord(raw);
      const slug: string = asString(team["slug"]);

      if (!slug) {
        continue;
      }

      const members: Array<string> = [];

      for (const rawMember of await this.readTeamList(
        client,
        `/api-public/v1/team/${encodeURIComponent(slug)}/members`,
        "members",
      )) {
        const personId: string | null = peopleIndex.find({
          id: asString(asRecord(rawMember)["username"]),
        });

        if (personId) {
          members.push(personId);
        }
      }

      const rotationSlugsByGroupId: Map<string, string> = new Map<
        string,
        string
      >();

      for (const rawGroup of await this.readTeamList(
        client,
        `/api-public/v1/teams/${encodeURIComponent(slug)}/rotations`,
        "rotationGroups",
      )) {
        const group: Record<string, unknown> = asRecord(rawGroup);
        const groupId: string = asString(group["groupId"]);
        const groupSlug: string = asString(group["slug"]);

        if (groupId && groupSlug) {
          rotationSlugsByGroupId.set(groupId, groupSlug);
        }
      }

      teams.push({
        team: {
          sourceId: slug,
          name: cleanName(team["name"], slug),
          description: cleanDescription(team["description"]),
          memberSourceIds: uniqueStrings(members),
          notes: [],
        },
        rotationSlugsByGroupId: rotationSlugsByGroupId,
      });
    }

    return teams;
  }

  // A list under a team, or nothing for a team that is gone by now.
  private async readTeamList(
    client: ToolImportHttpClient,
    path: string,
    field: string,
  ): Promise<Array<unknown>> {
    try {
      return asArray(asRecord(await client.getJson(path))[field]);
    } catch (error) {
      if (isListNotAvailable(error)) {
        return [];
      }

      throw error;
    }
  }

  private async readSchedules(data: {
    client: ToolImportHttpClient;
    teams: Array<TeamRead>;
    peopleIndex: ToolImportPeopleIndex;
    notes: Array<ToolImportNote>;
    now: number;
  }): Promise<Array<ImportedSchedule>> {
    const schedules: Array<ImportedSchedule> = [];

    for (const teamRead of data.teams) {
      const teamSlug: string = teamRead.team.sourceId;

      for (const rawGroup of await this.readTeamList(
        data.client,
        `/api-public/v2/team/${encodeURIComponent(teamSlug)}/rotations`,
        "rotations",
      )) {
        const group: Record<string, unknown> = asRecord(rawGroup);
        const groupId: string = asString(group["groupId"]);

        if (!groupId) {
          continue;
        }

        schedules.push(
          this.toSchedule({
            group: group,
            sourceId:
              teamRead.rotationSlugsByGroupId.get(groupId) ||
              `${teamSlug}:${groupId}`,
            teamSlug: teamSlug,
            peopleIndex: data.peopleIndex,
            now: data.now,
          }),
        );
      }
    }

    return capRecords({
      kind: ToolImportResourceKind.OnCallSchedule,
      records: schedules,
      notes: data.notes,
    });
  }

  /*
   * A rotation as a schedule. Its time zone is its first shift's: a shift
   * kept in another zone has its hours moved into it.
   */
  private toSchedule(data: {
    group: Record<string, unknown>;
    sourceId: string;
    teamSlug: string;
    peopleIndex: ToolImportPeopleIndex;
    now: number;
  }): ImportedSchedule {
    const name: string = cleanName(data.group["label"], data.sourceId);
    const shifts: Array<Record<string, unknown>> = asArray(
      data.group["shifts"],
    ).map((shift: unknown): Record<string, unknown> => {
      return asRecord(shift);
    });

    const timezone: string =
      shifts
        .map((shift: Record<string, unknown>): string => {
          return asString(shift["timezone"]);
        })
        .find((zone: string): boolean => {
          return Boolean(resolveImportedTimezone(zone));
        }) || "UTC";

    const rotations: Array<ImportedRotation> = [];

    shifts.forEach((shift: Record<string, unknown>, index: number): void => {
      const rotation: ImportedRotation | null = this.toRotation({
        shift: shift,
        index: index,
        rotationName: name,
        scheduleTimezone: timezone,
        peopleIndex: data.peopleIndex,
        now: data.now,
      });

      if (rotation) {
        rotations.push(rotation);
      }
    });

    return {
      sourceId: data.sourceId,
      name: name,
      timezone: timezone,
      isEnabled: true,
      ownerTeamSourceIds: [data.teamSlug],
      rotations: rotations,
      notes: [],
    };
  }

  /*
   * One shift as a rotation: its members take `duration` days each from
   * its start, lined up so whoever Splunk On-Call has on call now is on call
   * in the layer too, on the days and hours its masks say.
   */
  private toRotation(data: {
    shift: Record<string, unknown>;
    index: number;
    rotationName: string;
    scheduleTimezone: string;
    peopleIndex: ToolImportPeopleIndex;
    now: number;
  }): ImportedRotation | null {
    const shift: Record<string, unknown> = data.shift;
    const name: string = cleanName(
      shift["label"],
      `${data.rotationName} ${data.index + 1}`,
    );
    const startsAt: string | null = toTime(shift["start"]);

    if (!startsAt) {
      return null;
    }

    const notes: Array<ToolImportNote> = [];
    const days: number = Math.max(
      1,
      Math.round(asNumber(shift["duration"]) || 7),
    );
    const turn: { intervalType: EventInterval; intervalCount: number } =
      days % 7 === 0
        ? { intervalType: EventInterval.Week, intervalCount: days / 7 }
        : { intervalType: EventInterval.Day, intervalCount: days };

    const members: Array<string> = [];

    for (const rawMember of asArray(shift["shiftMembers"])) {
      const personId: string | null = data.peopleIndex.find({
        id: asString(asRecord(rawMember)["username"]),
      });

      if (personId) {
        members.push(personId);
      }
    }

    let restriction: ImportedRestriction | null = toRestriction(shift);
    const shiftTimezone: string = asString(shift["timezone"]);

    /*
     * A daily hand-off counts the days the shift is on call, skipping the
     * rest (Monday to Friday hands over from Friday to Monday); a OneUptime
     * layer counts every day. With one member it makes no difference.
     */
    if (
      turn.intervalType === EventInterval.Day &&
      new Set(members).size > 1 &&
      getMaskDays(shift).size < 7
    ) {
      notes.push(
        makeToolImportNote(ToolImportNoteCode.RotationApproximated, {
          rotation: name,
        }),
      );
    }

    if (
      restriction &&
      shiftTimezone &&
      resolveImportedTimezone(shiftTimezone) &&
      resolveImportedTimezone(shiftTimezone) !==
        resolveImportedTimezone(data.scheduleTimezone)
    ) {
      const difference: { minutes: number; isConstant: boolean } =
        getTimezoneDifference({
          timezone: resolveImportedTimezone(data.scheduleTimezone)!,
          otherTimezone: resolveImportedTimezone(shiftTimezone)!,
          at: new Date(data.now),
        });

      restriction = shiftRestriction(restriction, difference.minutes);

      if (!difference.isConstant) {
        notes.push(
          makeToolImportNote(ToolImportNoteCode.RotationTimezoneConverted, {
            rotation: name,
            timezone: shiftTimezone,
          }),
        );
      }
    }

    return {
      key: asString(shift["shiftId"]) || `shift-${data.index + 1}`,
      name: name,
      startsAt: startsAt,
      intervalType: turn.intervalType,
      intervalCount: turn.intervalCount,
      restriction: restriction,
      participantSourceIds: lineUpWithWhoIsOnCall({
        members: members,
        startsAt: Date.parse(startsAt),
        turnMs: days * MINUTES_PER_DAY * 60 * 1000,
        current: asRecord(shift["current"]),
        peopleIndex: data.peopleIndex,
      }),
      notes: notes,
    };
  }

  private async readPolicies(
    client: ToolImportHttpClient,
    peopleIndex: ToolImportPeopleIndex,
    notes: Array<ToolImportNote>,
  ): Promise<Array<ImportedPolicy>> {
    const summaries: Array<unknown> = capRecords({
      kind: ToolImportResourceKind.OnCallPolicy,
      records: asArray(
        asRecord(await client.getJson("/api-public/v1/policies"))["policies"],
      ),
      notes: notes,
    });

    const policies: Array<ImportedPolicy> = [];

    for (const rawSummary of summaries) {
      const summary: Record<string, unknown> = asRecord(rawSummary);
      const slug: string = asString(asRecord(summary["policy"])["slug"]);

      if (!slug) {
        continue;
      }

      let detail: Record<string, unknown>;

      try {
        detail = asRecord(
          await client.getJson(
            `/api-public/v1/policies/${encodeURIComponent(slug)}`,
          ),
        );
      } catch (error) {
        // A policy that is gone by now is not brought over.
        if (isListNotAvailable(error)) {
          continue;
        }

        throw error;
      }

      const teamSlug: string = asString(asRecord(summary["team"])["slug"]);
      const policyNotes: Array<ToolImportNote> = [];

      policies.push({
        sourceId: slug,
        name: cleanName(
          detail["name"] || asRecord(summary["policy"])["name"],
          slug,
        ),
        ownerTeamSourceIds: teamSlug ? [teamSlug] : [],
        levels: toLevels({
          steps: asArray(detail["steps"]),
          peopleIndex: peopleIndex,
          notes: policyNotes,
        }),
        repeatTimes: 0,
        notes: policyNotes,
      });
    }

    return policies;
  }
}

// A list of lists, as the user list has been answered, made one list.
function flatten(values: Array<unknown>): Array<unknown> {
  return values.flatMap((value: unknown): Array<unknown> => {
    return Array.isArray(value) ? value : [value];
  });
}

// A time as an ISO string, from an ISO string or epoch milliseconds.
function toTime(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return new Date(value).toISOString();
  }

  return cleanTime(value);
}

/*
 * A shift's masks - each "on these days, during these hours" - as one
 * restriction, or none when they leave no hour out.
 */
export function toRestriction(
  shift: Record<string, unknown>,
): ImportedRestriction | null {
  const windows: Array<{
    day: DayOfWeek;
    startMinuteOfDay: number;
    durationMinutes: number;
  }> = [];
  let hasMask: boolean = false;

  for (const field of MASK_FIELDS) {
    const mask: Record<string, unknown> = asRecord(shift[field]);
    const dayFlags: Record<string, unknown> = asRecord(mask["day"]);

    if (Object.keys(dayFlags).length === 0) {
      continue;
    }

    hasMask = true;

    const times: Array<Record<string, unknown>> = asArray(mask["time"]).map(
      (time: unknown): Record<string, unknown> => {
        return asRecord(time);
      },
    );
    const ranges: Array<{ start: number; duration: number }> =
      times.length === 0
        ? [{ start: 0, duration: MINUTES_PER_DAY }]
        : times.map(
            (
              time: Record<string, unknown>,
            ): {
              start: number;
              duration: number;
            } => {
              const start: number = toMinuteOfDay(asRecord(time["start"]));
              let end: number = toMinuteOfDay(asRecord(time["end"]));

              // An end at or before the start runs into the next day.
              if (end <= start) {
                end += MINUTES_PER_DAY;
              }

              return { start: start, duration: end - start };
            },
          );

    for (const [flag, day] of MASK_DAYS) {
      if (dayFlags[flag] !== true) {
        continue;
      }

      for (const range of ranges) {
        windows.push({
          day: day,
          startMinuteOfDay: range.start,
          durationMinutes: range.duration,
        });
      }
    }
  }

  return hasMask ? buildRestrictionFromDayWindows(windows) : null;
}

/*
 * The days a shift's masks put it on call on (every day for a shift with no
 * mask: a 24/7 shift).
 */
export function getMaskDays(shift: Record<string, unknown>): Set<DayOfWeek> {
  const days: Set<DayOfWeek> = new Set<DayOfWeek>();
  let hasMask: boolean = false;

  for (const field of MASK_FIELDS) {
    const dayFlags: Record<string, unknown> = asRecord(
      asRecord(shift[field])["day"],
    );

    if (Object.keys(dayFlags).length === 0) {
      continue;
    }

    hasMask = true;

    for (const [flag, day] of MASK_DAYS) {
      if (dayFlags[flag] === true) {
        days.add(day);
      }
    }
  }

  return hasMask
    ? days
    : new Set<DayOfWeek>(
        MASK_DAYS.map((entry: [string, DayOfWeek]): DayOfWeek => {
          return entry[1];
        }),
      );
}

function toMinuteOfDay(time: Record<string, unknown>): number {
  const hour: number = Math.max(
    0,
    Math.min(24, Math.floor(asNumber(time["hour"]) || 0)),
  );
  const minute: number = Math.max(
    0,
    Math.min(59, Math.floor(asNumber(time["minute"]) || 0)),
  );

  return Math.min(MINUTES_PER_DAY, hour * 60 + minute);
}

/*
 * The members in the order that puts whoever Splunk On-Call has on call
 * now (the shift's current period) on call in a layer that starts at
 * `startsAt` and hands over every `turnMs`. With nobody on call now, or
 * somebody who is not a member, the order is the shift's own.
 */
export function lineUpWithWhoIsOnCall(data: {
  members: Array<string>;
  startsAt: number;
  turnMs: number;
  current: Record<string, unknown>;
  peopleIndex: ToolImportPeopleIndex;
}): Array<string> {
  const members: Array<string> = data.members;
  const onCall: string | null = data.peopleIndex.find({
    id: asString(data.current["username"]),
  });
  const currentIndex: number = onCall ? members.indexOf(onCall) : -1;
  const periodStart: string | null = toTime(data.current["start"]);
  const periodEnd: string | null = toTime(data.current["end"]);

  if (
    members.length < 2 ||
    currentIndex < 0 ||
    !periodStart ||
    !Number.isFinite(data.startsAt) ||
    data.turnMs <= 0
  ) {
    return members;
  }

  // The middle of the period is inside one turn, whatever its edges are.
  const at: number = periodEnd
    ? (Date.parse(periodStart) + Date.parse(periodEnd)) / 2
    : Date.parse(periodStart) + 60 * 1000;
  const turn: number = Math.floor((at - data.startsAt) / data.turnMs);
  const turnIndex: number =
    ((turn % members.length) + members.length) % members.length;
  // Rotate so the member at turnIndex is the one on call now.
  const shift: number =
    (((currentIndex - turnIndex) % members.length) + members.length) %
    members.length;

  return [...members.slice(shift), ...members.slice(0, shift)];
}

/*
 * A policy's steps as levels. Each step waits `timeout` minutes after the
 * one before it, so that is the previous level's wait; a step with no wait
 * pages together with the one before it.
 */
export function toLevels(data: {
  steps: Array<unknown>;
  peopleIndex: ToolImportPeopleIndex;
  notes: Array<ToolImportNote>;
}): Array<ImportedPolicyLevel> {
  const levels: Array<ImportedPolicyLevel> = [];
  const noted: Set<ToolImportNoteCode> = new Set<ToolImportNoteCode>();

  const note: (code: ToolImportNoteCode) => void = (
    code: ToolImportNoteCode,
  ): void => {
    if (!noted.has(code)) {
      noted.add(code);
      data.notes.push(makeToolImportNote(code));
    }
  };

  data.steps.forEach((rawStep: unknown, index: number): void => {
    const step: Record<string, unknown> = asRecord(rawStep);
    const timeout: number = Math.max(
      0,
      Math.ceil(asNumber(step["timeout"]) || 0),
    );

    if (index === 0 && timeout > 0) {
      data.notes.push(
        makeToolImportNote(ToolImportNoteCode.PolicyFirstStepWaits, {
          minutes: timeout,
        }),
      );
    }

    const previous: ImportedPolicyLevel | undefined = levels[levels.length - 1];
    let level: ImportedPolicyLevel;

    if (previous && timeout === 0) {
      level = previous;
    } else {
      if (previous) {
        previous.escalateAfterMinutes = timeout;
      }

      level = {
        escalateAfterMinutes: DEFAULT_ESCALATE_AFTER_IN_MINUTES,
        personSourceIds: [],
        teamSourceIds: [],
        scheduleSourceIds: [],
      };
      levels.push(level);
    }

    for (const rawEntry of asArray(step["entries"])) {
      const entry: Record<string, unknown> = asRecord(rawEntry);
      const type: string = asString(entry["executionType"]).toLowerCase();

      if (
        type === "rotation_group" ||
        type === "rotation_group_next" ||
        type === "rotation_group_previous"
      ) {
        const slug: string = asString(asRecord(entry["rotationGroup"])["slug"]);

        if (type !== "rotation_group") {
          note(ToolImportNoteCode.PolicyNextOnCall);
        }

        if (slug) {
          level.scheduleSourceIds.push(slug);
        }
      } else if (type === "user") {
        const personId: string | null = data.peopleIndex.find({
          id: asString(asRecord(entry["user"])["username"]),
        });

        if (personId) {
          level.personSourceIds.push(personId);
        } else {
          note(ToolImportNoteCode.PolicyUnknownTarget);
        }
      } else if (type === "email") {
        const personId: string | null = data.peopleIndex.find({
          email: asString(asRecord(entry["email"])["address"]),
        });

        if (personId) {
          level.personSourceIds.push(personId);
        } else {
          note(ToolImportNoteCode.PolicyEmailAddress);
        }
      } else if (type === "webhook") {
        note(ToolImportNoteCode.PolicyWebhookStep);
      } else if (type === "policy_routing") {
        note(ToolImportNoteCode.PolicyRunsAnotherPolicy);
      } else {
        note(ToolImportNoteCode.PolicyUnknownTarget);
      }
    }

    level.personSourceIds = uniqueStrings(level.personSourceIds);
    level.scheduleSourceIds = uniqueStrings(level.scheduleSourceIds);
  });

  return levels.slice(0, TOOL_IMPORT_MAX_LEVELS_PER_POLICY);
}
