import DayOfWeek from "../../../../../Types/Day/DayOfWeek";
import { DEFAULT_ESCALATE_AFTER_IN_MINUTES } from "../../../../../Types/OnCallDutyPolicy/EscalationRuleDefaults";
import { TOOL_IMPORT_MAX_LEVELS_PER_POLICY } from "../../../../../Types/ToolImport/ToolImportLimits";
import {
  makeToolImportNote,
  ToolImportNote,
  ToolImportNoteCode,
} from "../../../../../Types/ToolImport/ToolImportNote";
import ToolImportResourceKind from "../../../../../Types/ToolImport/ToolImportResourceKind";
import {
  ALL_DAYS_OF_WEEK,
  buildRestrictionFromDayWindows,
  parseTimeOfDay,
  SECONDS_PER_WEEK,
  toTurnInterval,
} from "../../../../../Types/ToolImport/ToolImportScheduleRules";
import {
  getEmptyToolImportSnapshot,
  ImportedPerson,
  ImportedPolicy,
  ImportedPolicyLevel,
  ImportedRestriction,
  ImportedRotation,
  ImportedSchedule,
  ImportedService,
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
  readOffsetPaged,
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
 * PAGERDUTY.
 *
 * Reads, with a REST API key from Integrations > Developer Tools > API
 * Access Keys (a Read-only API Key is enough - an import never writes to
 * PagerDuty), through PagerDuty's REST API v2, documented at
 * https://developer.pagerduty.com/api-reference and in its OpenAPI
 * definition (github.com/PagerDuty/api-schema):
 *
 *   GET /users?limit=&offset=              people, with the teams each is on
 *   GET /teams?limit=&offset=              teams
 *   GET /schedules?include[]=schedule_layers&limit=&offset=
 *                                          schedules, with their layers
 *   GET /schedules/{id}                    a schedule's layers, when the list
 *                                          leaves them out
 *   GET /v3/schedules?limit=1              whether there are shift-based
 *                                          schedules (only noted)
 *   GET /escalation_policies?limit=&offset=   policies, their rules and targets
 *   GET /services?limit=&offset=           services
 *
 * Auth is `Authorization: Token token=<key>`, with the version header
 * `Accept: application/vnd.pagerduty+json;version=2`, against
 * api.pagerduty.com or, for an account in PagerDuty's EU region,
 * api.eu.pagerduty.com. Lists are offset paged: `limit` and `offset` in,
 * `more` out.
 *
 * How PagerDuty's ideas map:
 *  - A schedule's layers override one another: where a higher layer has
 *    someone on call, nobody below it is. A OneUptime schedule's layers work
 *    the same way, first layer first, so a PagerDuty schedule stays one
 *    schedule with its layers in PagerDuty's order (the API lists the
 *    highest layer first). A layer that has ended is left out.
 *  - A layer's turns count from its rotation_virtual_start, each
 *    rotation_turn_length_seconds long: the OneUptime layer starts there,
 *    so the same person is on call now. Its time-of-day and time-of-week
 *    restrictions are its restriction, in the schedule's time zone.
 *  - An escalation policy's rules are levels: each pages its users and
 *    schedules, and waits escalation_delay_in_minutes before the next.
 *    num_loops is how many times the policy repeats.
 *  - Shift-based schedules (PagerDuty's newer v3 schedules) are not read
 *    yet: the preview says the account has some, and a rule that pages one
 *    says that part is left out.
 */

const PAGE_SIZE: number = 100;

const KEY_ADVICE: string =
  "Check that you copied the whole key, that it is a REST API key from Integrations > API Access Keys and not an integration key, and that you picked the region your PagerDuty account is in.";

// PagerDuty's day numbers (ISO 8601: Monday is 1, Sunday is 7).
const ISO_DAYS: Record<number, DayOfWeek> = {
  1: DayOfWeek.Monday,
  2: DayOfWeek.Tuesday,
  3: DayOfWeek.Wednesday,
  4: DayOfWeek.Thursday,
  5: DayOfWeek.Friday,
  6: DayOfWeek.Saturday,
  7: DayOfWeek.Sunday,
  0: DayOfWeek.Sunday,
};

interface PeopleRead {
  people: Array<ImportedPerson>;
  // Team id -> the ids of the people on it, from each person's teams.
  membersByTeam: Map<string, Array<string>>;
  accountName?: string | undefined;
}

export default class PagerDutyAdapter implements ToolImportAdapter {
  public source: ToolImportSource = ToolImportSource.PagerDuty;

  public async read(
    settings: ToolImportReadSettings,
    context: ToolImportReadContext,
  ): Promise<ToolImportSnapshot> {
    const client: ToolImportHttpClient = createToolImportClient({
      settings: settings,
      context: context,
    });

    const snapshot: ToolImportSnapshot = getEmptyToolImportSnapshot(
      ToolImportSource.PagerDuty,
    );
    const now: number = context.now ? context.now() : Date.now();
    let membersByTeam: Map<string, Array<string>> = new Map<
      string,
      Array<string>
    >();

    try {
      await context.onProgress?.(ToolImportResourceKind.Person);
      snapshot.people = await readOptionalList<ImportedPerson>({
        kind: ToolImportResourceKind.Person,
        notes: snapshot.notes,
        read: async (): Promise<Array<ImportedPerson>> => {
          const read: PeopleRead = await this.readPeople(
            client,
            snapshot.notes,
          );
          membersByTeam = read.membersByTeam;
          snapshot.accountName = read.accountName;
          return read.people;
        },
      });

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

      if (await this.hasShiftBasedSchedules(client)) {
        snapshot.notes.push(
          makeToolImportNote(ToolImportNoteCode.ShiftBasedSchedulesNotRead),
        );
      }

      await context.onProgress?.(ToolImportResourceKind.OnCallPolicy);
      snapshot.policies = await readOptionalList<ImportedPolicy>({
        kind: ToolImportResourceKind.OnCallPolicy,
        notes: snapshot.notes,
        read: async (): Promise<Array<ImportedPolicy>> => {
          return await this.readPolicies(client, peopleIndex, snapshot.notes);
        },
      });

      await context.onProgress?.(ToolImportResourceKind.Service);
      snapshot.services = await readOptionalList<ImportedService>({
        kind: ToolImportResourceKind.Service,
        notes: snapshot.notes,
        read: async (): Promise<Array<ImportedService>> => {
          return await this.readServices(client, snapshot.notes);
        },
      });
    } catch (error) {
      throw toFatalReadError({
        error: error,
        toolName: "PagerDuty",
        keyAdvice: KEY_ADVICE,
      });
    }

    const unreadable: number = snapshot.notes.filter(
      (note: ToolImportNote): boolean => {
        return note.code === ToolImportNoteCode.CouldNotRead;
      },
    ).length;

    if (unreadable >= 5) {
      throw new ToolImportReadError(
        `The API key could not read anything from PagerDuty. ${KEY_ADVICE}`,
      );
    }

    snapshot.readAt = new Date(
      context.now ? context.now() : Date.now(),
    ).toISOString();

    return snapshot;
  }

  private async readPeople(
    client: ToolImportHttpClient,
    notes: Array<ToolImportNote>,
  ): Promise<PeopleRead> {
    const read: { records: Array<unknown>; hasMore: boolean } =
      await readOffsetPaged({
        client: client,
        path: "/users",
        field: "users",
        pageSize: PAGE_SIZE,
      });

    const people: Array<ImportedPerson> = [];
    const membersByTeam: Map<string, Array<string>> = new Map<
      string,
      Array<string>
    >();
    let accountName: string | undefined = undefined;

    for (const raw of read.records) {
      const user: Record<string, unknown> = asRecord(raw);
      const sourceId: string = asString(user["id"]);

      if (!sourceId) {
        continue;
      }

      const email: string | null = cleanEmail(user["email"]);

      people.push({
        sourceId: sourceId,
        name: cleanName(user["name"], email || sourceId),
        email: email,
        isActive: true,
        notes: [],
      });

      for (const rawTeam of asArray(user["teams"])) {
        const teamId: string = asString(asRecord(rawTeam)["id"]);

        if (teamId) {
          const members: Array<string> = membersByTeam.get(teamId) || [];
          members.push(sourceId);
          membersByTeam.set(teamId, members);
        }
      }

      accountName = accountName || toAccountName(user["html_url"]);
    }

    return {
      people: capRecords({
        kind: ToolImportResourceKind.Person,
        records: people,
        notes: notes,
        hasMore: read.hasMore,
      }),
      membersByTeam: membersByTeam,
      accountName: accountName,
    };
  }

  private async readTeams(
    client: ToolImportHttpClient,
    membersByTeam: Map<string, Array<string>>,
    notes: Array<ToolImportNote>,
  ): Promise<Array<ImportedTeam>> {
    const read: { records: Array<unknown>; hasMore: boolean } =
      await readOffsetPaged({
        client: client,
        path: "/teams",
        field: "teams",
        pageSize: PAGE_SIZE,
      });

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
        description: cleanDescription(team["description"]),
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
      await readOffsetPaged({
        client: client,
        path: "/schedules",
        field: "schedules",
        pageSize: PAGE_SIZE,
        query: { "include[]": ["schedule_layers"] },
      });

    const schedules: Array<ImportedSchedule> = [];

    for (const raw of read.records) {
      let schedule: Record<string, unknown> = asRecord(raw);
      const sourceId: string = asString(schedule["id"]);

      if (!sourceId) {
        continue;
      }

      if (!Array.isArray(schedule["schedule_layers"])) {
        /*
         * The list can leave the layers out: one request per schedule reads
         * them. A schedule that is gone by now is left without layers.
         */
        try {
          schedule = {
            ...schedule,
            ...asRecord(
              asRecord(
                await client.getJson(
                  `/schedules/${encodeURIComponent(sourceId)}`,
                ),
              )["schedule"],
            ),
          };
        } catch (error) {
          if (!isListNotAvailable(error)) {
            throw error;
          }
        }
      }

      const scheduleNotes: Array<ToolImportNote> = [];
      const layers: Array<unknown> = asArray(schedule["schedule_layers"]);
      const rotations: Array<ImportedRotation> = [];

      layers.forEach((rawLayer: unknown, index: number): void => {
        const rotation: ImportedRotation | null = this.toRotation({
          layer: asRecord(rawLayer),
          index: index,
          layerCount: layers.length,
          peopleIndex: peopleIndex,
          now: now,
          scheduleNotes: scheduleNotes,
        });

        if (rotation) {
          rotations.push(rotation);
        }
      });

      schedules.push({
        sourceId: sourceId,
        name: cleanName(schedule["name"], sourceId),
        description: cleanDescription(schedule["description"]),
        timezone: asString(schedule["time_zone"]) || "UTC",
        isEnabled: true,
        ownerTeamSourceIds: referenceIds(schedule["teams"]),
        rotations: rotations,
        notes: scheduleNotes,
      });
    }

    return capRecords({
      kind: ToolImportResourceKind.OnCallSchedule,
      records: schedules,
      notes: notes,
      hasMore: read.hasMore,
    });
  }

  /*
   * One PagerDuty schedule layer as a rotation, or null when there is
   * nothing to bring over (it ended, or it has no start). The API lists the
   * highest layer first, so the first layer listed outranks the rest.
   */
  private toRotation(data: {
    layer: Record<string, unknown>;
    index: number;
    layerCount: number;
    peopleIndex: ToolImportPeopleIndex;
    now: number;
    scheduleNotes: Array<ToolImportNote>;
  }): ImportedRotation | null {
    const layer: Record<string, unknown> = data.layer;
    // PagerDuty names its layers "Layer 1" (the lowest) and up.
    const name: string = cleanName(
      layer["name"],
      `Layer ${data.layerCount - data.index}`,
    );
    const start: string | null = cleanTime(layer["start"]);
    const end: string | null = cleanTime(layer["end"]);
    const virtualStart: string | null =
      cleanTime(layer["rotation_virtual_start"]) || start;

    if (!virtualStart) {
      return null;
    }

    if (end && Date.parse(end) <= data.now) {
      data.scheduleNotes.push(
        makeToolImportNote(ToolImportNoteCode.RotationEnded, {
          rotation: name,
          date: end,
        }),
      );
      return null;
    }

    const notes: Array<ToolImportNote> = [];

    if (end) {
      notes.push(
        makeToolImportNote(ToolImportNoteCode.RotationEnds, {
          rotation: name,
          date: end,
        }),
      );
    }

    const turnSeconds: number =
      asNumber(layer["rotation_turn_length_seconds"]) || SECONDS_PER_WEEK;
    const turn: {
      intervalType: ImportedRotation["intervalType"];
      intervalCount: number;
      isExact: boolean;
    } = toTurnInterval(turnSeconds);

    const participants: Array<string> = [];

    for (const rawUser of asArray(layer["users"])) {
      const personId: string | null = data.peopleIndex.find({
        id: asString(asRecord(asRecord(rawUser)["user"])["id"]),
      });

      if (personId) {
        participants.push(personId);
      }
    }

    let startsAt: string = virtualStart;
    let order: Array<string> = participants;
    let isExact: boolean = turn.isExact;

    if (start && Date.parse(start) > data.now) {
      /*
       * A layer that takes over later starts then, with whoever PagerDuty
       * puts on call at that moment: its turns still count from the virtual
       * start, so the hand-offs match only when the start falls on one.
       */
      notes.push(
        makeToolImportNote(ToolImportNoteCode.RotationNotStarted, {
          rotation: name,
          date: start,
        }),
      );

      const turnMs: number = turnSeconds * 1000;
      const elapsedMs: number = Date.parse(start) - Date.parse(virtualStart);

      if (turnMs > 0 && elapsedMs > 0 && participants.length > 0) {
        const turnsBefore: number = Math.floor(elapsedMs / turnMs);
        const first: number = turnsBefore % participants.length;
        order = [...participants.slice(first), ...participants.slice(0, first)];
        isExact = isExact && elapsedMs % turnMs === 0;
      }

      startsAt = start;
    }

    if (!isExact) {
      notes.push(
        makeToolImportNote(ToolImportNoteCode.RotationApproximated, {
          rotation: name,
        }),
      );
    }

    return {
      key: asString(layer["id"]) || `layer-${data.index + 1}`,
      name: name,
      startsAt: startsAt,
      intervalType: turn.intervalType,
      intervalCount: turn.intervalCount,
      restriction: toRestriction(asArray(layer["restrictions"])),
      participantSourceIds: order,
      precedence: data.layerCount - data.index,
      notes: notes,
    };
  }

  /*
   * Whether the account has shift-based schedules, which this import does
   * not read: an account without them, or a key that may not see them,
   * has none to tell about.
   */
  private async hasShiftBasedSchedules(
    client: ToolImportHttpClient,
  ): Promise<boolean> {
    try {
      const body: Record<string, unknown> = asRecord(
        await client.getJson("/v3/schedules", { limit: 1, offset: 0 }),
      );

      return asArray(body["schedules"]).length > 0;
    } catch (error) {
      if (
        error instanceof ToolImportHttpError &&
        (isListNotAvailable(error) ||
          error.kind === ToolImportHttpErrorKind.Rejected)
      ) {
        return false;
      }

      throw error;
    }
  }

  private async readPolicies(
    client: ToolImportHttpClient,
    peopleIndex: ToolImportPeopleIndex,
    notes: Array<ToolImportNote>,
  ): Promise<Array<ImportedPolicy>> {
    const read: { records: Array<unknown>; hasMore: boolean } =
      await readOffsetPaged({
        client: client,
        path: "/escalation_policies",
        field: "escalation_policies",
        pageSize: PAGE_SIZE,
      });

    const policies: Array<ImportedPolicy> = [];

    for (const raw of read.records) {
      const policy: Record<string, unknown> = asRecord(raw);
      const sourceId: string = asString(policy["id"]);

      if (!sourceId) {
        continue;
      }

      const policyNotes: Array<ToolImportNote> = [];
      const noted: Set<ToolImportNoteCode> = new Set<ToolImportNoteCode>();

      const note: (code: ToolImportNoteCode) => void = (
        code: ToolImportNoteCode,
      ): void => {
        if (!noted.has(code)) {
          noted.add(code);
          policyNotes.push(makeToolImportNote(code));
        }
      };

      const levels: Array<ImportedPolicyLevel> = asArray(
        policy["escalation_rules"],
      ).map((rawRule: unknown): ImportedPolicyLevel => {
        const rule: Record<string, unknown> = asRecord(rawRule);
        const delay: number | null = asNumber(
          rule["escalation_delay_in_minutes"],
        );
        const strategy: string = (
          asString(rule["escalation_rule_assignment_strategy"]) ||
          asString(
            asRecord(rule["escalation_rule_assignment_strategy"])["type"],
          )
        ).toLowerCase();

        if (strategy === "round_robin") {
          note(ToolImportNoteCode.PolicyRoundRobin);
        }

        const level: ImportedPolicyLevel = {
          escalateAfterMinutes:
            delay !== null && delay > 0
              ? Math.ceil(delay)
              : DEFAULT_ESCALATE_AFTER_IN_MINUTES,
          personSourceIds: [],
          teamSourceIds: [],
          scheduleSourceIds: [],
        };

        for (const rawTarget of asArray(rule["targets"])) {
          const target: Record<string, unknown> = asRecord(rawTarget);
          const type: string = asString(target["type"])
            .toLowerCase()
            .replace("_reference", "");
          const id: string = asString(target["id"]);

          if (type === "user") {
            const personId: string | null = peopleIndex.find({ id: id });

            if (personId) {
              level.personSourceIds.push(personId);
            } else {
              note(ToolImportNoteCode.PolicyUnknownTarget);
            }
          } else if (type === "schedule") {
            if (id) {
              level.scheduleSourceIds.push(id);
            }
          } else if (type === "schedule_v3") {
            note(ToolImportNoteCode.PolicyScheduleNotRead);
          } else {
            note(ToolImportNoteCode.PolicyUnknownTarget);
          }
        }

        level.personSourceIds = uniqueStrings(level.personSourceIds);
        level.scheduleSourceIds = uniqueStrings(level.scheduleSourceIds);

        return level;
      });

      policies.push({
        sourceId: sourceId,
        name: cleanName(policy["name"], sourceId),
        description: cleanDescription(policy["description"]),
        ownerTeamSourceIds: referenceIds(policy["teams"]),
        levels: levels.slice(0, TOOL_IMPORT_MAX_LEVELS_PER_POLICY),
        repeatTimes: Math.max(
          0,
          Math.floor(asNumber(policy["num_loops"]) || 0),
        ),
        notes: policyNotes,
      });
    }

    return capRecords({
      kind: ToolImportResourceKind.OnCallPolicy,
      records: policies,
      notes: notes,
      hasMore: read.hasMore,
    });
  }

  private async readServices(
    client: ToolImportHttpClient,
    notes: Array<ToolImportNote>,
  ): Promise<Array<ImportedService>> {
    const read: { records: Array<unknown>; hasMore: boolean } =
      await readOffsetPaged({
        client: client,
        path: "/services",
        field: "services",
        pageSize: PAGE_SIZE,
      });

    const services: Array<ImportedService> = [];

    for (const raw of read.records) {
      const service: Record<string, unknown> = asRecord(raw);
      const sourceId: string = asString(service["id"]);

      if (!sourceId) {
        continue;
      }

      const isEnabled: boolean =
        asString(service["status"]).toLowerCase() !== "disabled";

      services.push({
        sourceId: sourceId,
        name: cleanName(service["name"], sourceId),
        description: cleanDescription(service["description"]),
        ownerTeamSourceIds: referenceIds(service["teams"]),
        isEnabled: isEnabled,
        notes: isEnabled
          ? []
          : [makeToolImportNote(ToolImportNoteCode.TurnedOffInSource)],
      });
    }

    return capRecords({
      kind: ToolImportResourceKind.Service,
      records: services,
      notes: notes,
      hasMore: read.hasMore,
    });
  }
}

/*
 * A layer's restrictions - each a time of day (every day) or a time of week
 * (from a day, for so many seconds) - as one restriction in the schedule's
 * time zone, or none.
 */
export function toRestriction(
  restrictions: Array<unknown>,
): ImportedRestriction | null {
  const windows: Array<{
    day: DayOfWeek;
    startMinuteOfDay: number;
    durationMinutes: number;
  }> = [];

  for (const rawRestriction of restrictions) {
    const restriction: Record<string, unknown> = asRecord(rawRestriction);
    const type: string = asString(restriction["type"]).toLowerCase();
    const start: number | null = parseTimeOfDay(
      asString(restriction["start_time_of_day"]),
    );
    const durationSeconds: number | null = asNumber(
      restriction["duration_seconds"],
    );

    if (start === null || !durationSeconds || durationSeconds <= 0) {
      continue;
    }

    const durationMinutes: number = durationSeconds / 60;

    if (type === "daily_restriction") {
      for (const day of ALL_DAYS_OF_WEEK) {
        windows.push({
          day: day,
          startMinuteOfDay: start,
          durationMinutes: durationMinutes,
        });
      }
      continue;
    }

    if (type === "weekly_restriction") {
      const day: DayOfWeek | undefined =
        ISO_DAYS[asNumber(restriction["start_day_of_week"]) ?? -1];

      if (day) {
        windows.push({
          day: day,
          startMinuteOfDay: start,
          durationMinutes: durationMinutes,
        });
      }
    }
  }

  return buildRestrictionFromDayWindows(windows);
}

// The ids of a list of references ({ id, type, summary }).
function referenceIds(value: unknown): Array<string> {
  return uniqueStrings(
    asArray(value).map((reference: unknown): string => {
      return asString(asRecord(reference)["id"]);
    }),
  );
}

/*
 * The account's name from a PagerDuty web address
 * ("https://acme.pagerduty.com/users/P1", "https://acme.eu.pagerduty.com/..."):
 * its subdomain.
 */
export function toAccountName(htmlUrl: unknown): string | undefined {
  const text: string = asString(htmlUrl);

  if (!text) {
    return undefined;
  }

  try {
    const hostname: string = new URL(text).hostname.toLowerCase();

    if (!hostname.endsWith(".pagerduty.com")) {
      return undefined;
    }

    const subdomain: string = hostname.split(".")[0] || "";

    return subdomain && subdomain !== "api" && subdomain !== "app"
      ? cleanName(subdomain, "")
      : undefined;
  } catch {
    return undefined;
  }
}
