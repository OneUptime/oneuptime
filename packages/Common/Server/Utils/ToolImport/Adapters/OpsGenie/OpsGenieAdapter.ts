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
  toDayOfWeek,
  toEventInterval,
  toTimeOfDay,
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
  ImportedWeeklyWindow,
  ToolImportSnapshot,
} from "../../../../../Types/ToolImport/ToolImportSnapshot";
import ToolImportSource from "../../../../../Types/ToolImport/ToolImportSource";
import ToolImportHttpClient, {
  ToolImportHttpError,
  ToolImportHttpErrorKind,
} from "../../ToolImportHttpClient";
import {
  asArray,
  asBoolean,
  asNumber,
  asRecord,
  asString,
  capRecords,
  cleanDescription,
  cleanEmail,
  cleanName,
  cleanTime,
  createToolImportClient,
  readOptionalList,
  toFatalReadError,
  uniqueStrings,
} from "../../ToolImportAdapterSupport";
import {
  ToolImportAdapter,
  ToolImportReadContext,
  ToolImportReadError,
  ToolImportReadSettings,
} from "../../Types";

/*
 * OPSGENIE.
 *
 * Reads, with a key from Opsgenie's API key management (Read and
 * Configuration access are enough - an import never writes to Opsgenie),
 * through the REST API documented at https://docs.opsgenie.com/docs/api-overview
 * and in Opsgenie's OpenAPI definition (github.com/opsgenie/opsgenie-oas):
 *
 *   GET /v2/account                       the account's name (optional)
 *   GET /v2/users?limit=&offset=          people, paged by offset
 *   GET /v2/teams                         teams (members when listed)
 *   GET /v2/teams/{id}?identifierType=id  a team's members, when the list
 *                                         leaves them out
 *   GET /v2/schedules?expand=rotation     schedules with their rotations
 *   GET /v2/schedules/{id}/rotations      a schedule's rotations, when the
 *                                         list leaves them out
 *   GET /v2/escalations                   escalation policies
 *   GET /v1/services?limit=&offset=       services, paged by offset
 *
 * Auth is `Authorization: GenieKey <key>` against api.opsgenie.com or, for
 * an account in Opsgenie's EU region, api.eu.opsgenie.com.
 *
 * How Opsgenie's ideas map:
 *  - A rotation is a layer: same start, same turn length (hourly, daily or
 *    weekly times `length`), same people in the same order, same time
 *    restriction (time-of-day is a daily window, weekday-and-time-of-day a
 *    set of weekly windows). "No one" turns, and turns taken by a team or an
 *    escalation, cannot be a layer's: they are left out, with a note.
 *  - An escalation's rules each page one recipient after a delay counted
 *    from when the alert was created. Rules with the same delay page
 *    together, so they become one level; the wait before the next level is
 *    the difference between the delays.
 */

const PAGE_SIZE: number = 100;

const KEY_ADVICE: string =
  "Check that you copied the whole key, that it is a key from API key management with Read and Configuration access, and that you picked the region your Opsgenie account is in.";

export default class OpsGenieAdapter implements ToolImportAdapter {
  public source: ToolImportSource = ToolImportSource.OpsGenie;

  public async read(
    settings: ToolImportReadSettings,
    context: ToolImportReadContext,
  ): Promise<ToolImportSnapshot> {
    const client: ToolImportHttpClient = createToolImportClient({
      settings: settings,
      context: context,
    });

    const snapshot: ToolImportSnapshot = getEmptyToolImportSnapshot(
      ToolImportSource.OpsGenie,
    );

    try {
      snapshot.accountName = await this.readAccountName(client);

      await context.onProgress?.(ToolImportResourceKind.Person);
      snapshot.people = await readOptionalList<ImportedPerson>({
        kind: ToolImportResourceKind.Person,
        notes: snapshot.notes,
        read: async (): Promise<Array<ImportedPerson>> => {
          return await this.readPeople(client, snapshot.notes);
        },
      });

      const peopleIndex: PeopleIndex = new PeopleIndex(snapshot.people);

      await context.onProgress?.(ToolImportResourceKind.Team);
      snapshot.teams = await readOptionalList<ImportedTeam>({
        kind: ToolImportResourceKind.Team,
        notes: snapshot.notes,
        read: async (): Promise<Array<ImportedTeam>> => {
          return await this.readTeams(client, peopleIndex, snapshot.notes);
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
            context,
          );
        },
      });

      await context.onProgress?.(ToolImportResourceKind.OnCallPolicy);
      snapshot.policies = await readOptionalList<ImportedPolicy>({
        kind: ToolImportResourceKind.OnCallPolicy,
        notes: snapshot.notes,
        read: async (): Promise<Array<ImportedPolicy>> => {
          return await this.readPolicies(
            client,
            peopleIndex,
            snapshot.schedules,
            snapshot.notes,
          );
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
        toolName: "Opsgenie",
        keyAdvice: KEY_ADVICE,
      });
    }

    const couldReadAnything: boolean =
      snapshot.notes.filter((note: ToolImportNote): boolean => {
        return note.code === ToolImportNoteCode.CouldNotRead;
      }).length < 5;

    if (!couldReadAnything) {
      throw new ToolImportReadError(
        `The API key could not read anything from Opsgenie. ${KEY_ADVICE}`,
      );
    }

    snapshot.readAt = new Date(
      context.now ? context.now() : Date.now(),
    ).toISOString();

    return snapshot;
  }

  private async readAccountName(
    client: ToolImportHttpClient,
  ): Promise<string | undefined> {
    try {
      const body: Record<string, unknown> = asRecord(
        await client.getJson("/v2/account"),
      );
      return cleanName(asRecord(body["data"])["name"], "") || undefined;
    } catch (error) {
      // The account's name is a nicety: a key without access to it still reads.
      if (
        error instanceof ToolImportHttpError &&
        (error.kind === ToolImportHttpErrorKind.Forbidden ||
          error.kind === ToolImportHttpErrorKind.NotFound ||
          error.kind === ToolImportHttpErrorKind.Rejected)
      ) {
        return undefined;
      }

      throw error;
    }
  }

  private async readPeople(
    client: ToolImportHttpClient,
    notes: Array<ToolImportNote>,
  ): Promise<Array<ImportedPerson>> {
    const people: Array<ImportedPerson> = [];
    let offset: number = 0;
    let hasMore: boolean = false;

    for (;;) {
      const body: Record<string, unknown> = asRecord(
        await client.getJson("/v2/users", {
          limit: PAGE_SIZE,
          offset: offset,
          sortField: "username",
          order: "asc",
        }),
      );

      const page: Array<unknown> = asArray(body["data"]);

      for (const raw of page) {
        const user: Record<string, unknown> = asRecord(raw);
        const sourceId: string = asString(user["id"]);

        if (!sourceId) {
          continue;
        }

        const email: string | null = cleanEmail(user["username"]);

        people.push({
          sourceId: sourceId,
          name: cleanName(user["fullName"], email || sourceId),
          email: email,
          isActive: !asBoolean(user["blocked"], false),
          notes: [],
        });
      }

      const total: number | null = asNumber(body["totalCount"]);
      const nextLink: string = asString(asRecord(body["paging"])["next"]);

      offset += page.length;

      const isLastPage: boolean =
        page.length < PAGE_SIZE ||
        (total !== null && offset >= total) ||
        (!nextLink && total === null);

      if (isLastPage) {
        break;
      }

      if (people.length >= TOOL_IMPORT_MAX_RECORDS_PER_KIND) {
        hasMore = true;
        break;
      }
    }

    return capRecords({
      kind: ToolImportResourceKind.Person,
      records: people,
      notes: notes,
      hasMore: hasMore,
    });
  }

  private async readTeams(
    client: ToolImportHttpClient,
    peopleIndex: PeopleIndex,
    notes: Array<ToolImportNote>,
  ): Promise<Array<ImportedTeam>> {
    const body: Record<string, unknown> = asRecord(
      await client.getJson("/v2/teams"),
    );

    const rawTeams: Array<unknown> = capRecords({
      kind: ToolImportResourceKind.Team,
      records: asArray(body["data"]),
      notes: notes,
    });

    const teams: Array<ImportedTeam> = [];

    for (const raw of rawTeams) {
      const team: Record<string, unknown> = asRecord(raw);
      const sourceId: string = asString(team["id"]);

      if (!sourceId) {
        continue;
      }

      let members: Array<unknown> | null = Array.isArray(team["members"])
        ? (team["members"] as Array<unknown>)
        : null;

      if (members === null) {
        /*
         * The list documents members, but in practice leaves them out:
         * one request per team reads them. A team that is gone by now is
         * simply left without members.
         */
        try {
          const detail: Record<string, unknown> = asRecord(
            asRecord(
              await client.getJson(
                `/v2/teams/${encodeURIComponent(sourceId)}`,
                { identifierType: "id" },
              ),
            )["data"],
          );
          members = asArray(detail["members"]);
        } catch (error) {
          if (
            error instanceof ToolImportHttpError &&
            (error.kind === ToolImportHttpErrorKind.NotFound ||
              error.kind === ToolImportHttpErrorKind.Forbidden)
          ) {
            members = [];
          } else {
            throw error;
          }
        }
      }

      const memberSourceIds: Array<string> = [];

      for (const rawMember of members) {
        const user: Record<string, unknown> = asRecord(
          asRecord(rawMember)["user"],
        );
        const personId: string | null = peopleIndex.find({
          id: asString(user["id"]),
          email: asString(user["username"]),
        });

        if (personId) {
          memberSourceIds.push(personId);
        }
      }

      teams.push({
        sourceId: sourceId,
        name: cleanName(team["name"], sourceId),
        description: cleanDescription(team["description"]),
        memberSourceIds: uniqueStrings(memberSourceIds),
        notes: [],
      });
    }

    return teams;
  }

  private async readSchedules(
    client: ToolImportHttpClient,
    peopleIndex: PeopleIndex,
    notes: Array<ToolImportNote>,
    context: ToolImportReadContext,
  ): Promise<Array<ImportedSchedule>> {
    const body: Record<string, unknown> = asRecord(
      await client.getJson("/v2/schedules", { expand: "rotation" }),
    );

    const rawSchedules: Array<unknown> = capRecords({
      kind: ToolImportResourceKind.OnCallSchedule,
      records: asArray(body["data"]),
      notes: notes,
    });

    const now: number = context.now ? context.now() : Date.now();
    const schedules: Array<ImportedSchedule> = [];

    for (const raw of rawSchedules) {
      const schedule: Record<string, unknown> = asRecord(raw);
      const sourceId: string = asString(schedule["id"]);

      if (!sourceId) {
        continue;
      }

      let rawRotations: Array<unknown> | null = Array.isArray(
        schedule["rotations"],
      )
        ? (schedule["rotations"] as Array<unknown>)
        : null;

      if (rawRotations === null) {
        try {
          rawRotations = asArray(
            asRecord(
              await client.getJson(
                `/v2/schedules/${encodeURIComponent(sourceId)}/rotations`,
                { scheduleIdentifierType: "id" },
              ),
            )["data"],
          );
        } catch (error) {
          if (
            error instanceof ToolImportHttpError &&
            (error.kind === ToolImportHttpErrorKind.NotFound ||
              error.kind === ToolImportHttpErrorKind.Forbidden)
          ) {
            rawRotations = [];
          } else {
            throw error;
          }
        }
      }

      const scheduleNotes: Array<ToolImportNote> = [];
      const rotations: Array<ImportedRotation> = [];

      rawRotations.forEach((rawRotation: unknown, index: number): void => {
        const rotation: ImportedRotation | null = this.toRotation({
          raw: asRecord(rawRotation),
          index: index,
          peopleIndex: peopleIndex,
          now: now,
          scheduleNotes: scheduleNotes,
        });

        if (rotation) {
          rotations.push(rotation);
        }
      });

      const ownerTeamId: string = asString(
        asRecord(schedule["ownerTeam"])["id"],
      );
      const isEnabled: boolean = asBoolean(schedule["enabled"], true);

      if (!isEnabled) {
        scheduleNotes.push(
          makeToolImportNote(ToolImportNoteCode.TurnedOffInSource),
        );
      }

      schedules.push({
        sourceId: sourceId,
        name: cleanName(schedule["name"], sourceId),
        description: cleanDescription(schedule["description"]),
        timezone: asString(schedule["timezone"]) || "UTC",
        isEnabled: isEnabled,
        ownerTeamSourceIds: ownerTeamId ? [ownerTeamId] : [],
        rotations: rotations,
        notes: scheduleNotes,
      });
    }

    return schedules;
  }

  /*
   * One Opsgenie rotation as a layer, or null when there is nothing to bring
   * over (it ended, or it has no start). What does not come over exactly is
   * noted on the rotation, or on the schedule when the rotation is left out.
   */
  private toRotation(data: {
    raw: Record<string, unknown>;
    index: number;
    peopleIndex: PeopleIndex;
    now: number;
    scheduleNotes: Array<ToolImportNote>;
  }): ImportedRotation | null {
    const raw: Record<string, unknown> = data.raw;
    const name: string = cleanName(raw["name"], `Rotation ${data.index + 1}`);
    const startsAt: string | null = cleanTime(raw["startDate"]);
    const endsAt: string | null = cleanTime(raw["endDate"]);

    if (!startsAt) {
      return null;
    }

    if (endsAt && Date.parse(endsAt) <= data.now) {
      data.scheduleNotes.push(
        makeToolImportNote(ToolImportNoteCode.RotationEnded, {
          rotation: name,
          date: endsAt,
        }),
      );
      return null;
    }

    const notes: Array<ToolImportNote> = [];

    if (endsAt) {
      notes.push(
        makeToolImportNote(ToolImportNoteCode.RotationEnds, {
          rotation: name,
          date: endsAt,
        }),
      );
    }

    const participants: Array<string> = [];
    let gaps: number = 0;
    let nonPeople: number = 0;

    for (const rawParticipant of asArray(raw["participants"])) {
      const participant: Record<string, unknown> = asRecord(rawParticipant);
      const type: string = asString(participant["type"]).toLowerCase();

      if (type === "user") {
        const personId: string | null = data.peopleIndex.find({
          id: asString(participant["id"]),
          email: asString(participant["username"]),
        });

        if (personId) {
          participants.push(personId);
        }
        continue;
      }

      if (type === "none") {
        gaps++;
        continue;
      }

      nonPeople++;
    }

    if (gaps > 0) {
      notes.push(
        makeToolImportNote(ToolImportNoteCode.RotationGaps, {
          rotation: name,
        }),
      );
    }

    if (nonPeople > 0) {
      notes.push(
        makeToolImportNote(ToolImportNoteCode.RotationNonPersonTurns, {
          rotation: name,
        }),
      );
    }

    const intervalType: EventInterval =
      toEventInterval(raw["type"]) || EventInterval.Week;
    const length: number = Math.max(
      1,
      Math.floor(asNumber(raw["length"]) || 1),
    );

    return {
      key: asString(raw["id"]) || `rotation-${data.index + 1}`,
      name: name,
      startsAt: startsAt,
      intervalType: intervalType,
      intervalCount: length,
      restriction: this.toRestriction(asRecord(raw["timeRestriction"])),
      participantSourceIds: participants,
      notes: notes,
    };
  }

  private toRestriction(
    timeRestriction: Record<string, unknown>,
  ): ImportedRestriction | null {
    const type: string = asString(timeRestriction["type"]).toLowerCase();

    if (type === "time-of-day") {
      // Documented as `restriction`; older answers carry `restrictions[0]`.
      const restriction: Record<string, unknown> = asRecord(
        timeRestriction["restriction"] ||
          asArray(timeRestriction["restrictions"])[0],
      );
      const startTime: string | null = toTimeOfDay(
        restriction["startHour"],
        restriction["startMin"],
      );
      const endTime: string | null = toTimeOfDay(
        restriction["endHour"],
        restriction["endMin"],
      );

      return startTime && endTime
        ? { type: "Daily", startTime: startTime, endTime: endTime }
        : null;
    }

    if (type === "weekday-and-time-of-day") {
      const windows: Array<ImportedWeeklyWindow> = [];

      for (const rawWindow of asArray(timeRestriction["restrictions"])) {
        const window: Record<string, unknown> = asRecord(rawWindow);
        const startDay: DayOfWeek | null = toDayOfWeek(window["startDay"]);
        const endDay: DayOfWeek | null = toDayOfWeek(window["endDay"]);
        const startTime: string | null = toTimeOfDay(
          window["startHour"],
          window["startMin"],
        );
        const endTime: string | null = toTimeOfDay(
          window["endHour"],
          window["endMin"],
        );

        if (startDay && endDay && startTime && endTime) {
          windows.push({
            startDay: startDay,
            startTime: startTime,
            endDay: endDay,
            endTime: endTime,
          });
        }
      }

      return windows.length > 0 ? { type: "Weekly", windows: windows } : null;
    }

    return null;
  }

  private async readPolicies(
    client: ToolImportHttpClient,
    peopleIndex: PeopleIndex,
    schedules: Array<ImportedSchedule>,
    notes: Array<ToolImportNote>,
  ): Promise<Array<ImportedPolicy>> {
    const body: Record<string, unknown> = asRecord(
      await client.getJson("/v2/escalations"),
    );

    const rawPolicies: Array<unknown> = capRecords({
      kind: ToolImportResourceKind.OnCallPolicy,
      records: asArray(body["data"]),
      notes: notes,
    });

    const policies: Array<ImportedPolicy> = [];

    for (const raw of rawPolicies) {
      const escalation: Record<string, unknown> = asRecord(raw);
      const sourceId: string = asString(escalation["id"]);

      if (!sourceId) {
        continue;
      }

      const policyNotes: Array<ToolImportNote> = [];
      const repeat: Record<string, unknown> = asRecord(escalation["repeat"]);
      const repeatTimes: number = Math.max(
        0,
        Math.floor(asNumber(repeat["count"]) || 0),
      );
      const repeatWaitMinutes: number | null = asNumber(repeat["waitInterval"]);

      const levels: Array<ImportedPolicyLevel> = this.toLevels({
        rules: asArray(escalation["rules"]),
        peopleIndex: peopleIndex,
        schedules: schedules,
        notes: policyNotes,
        lastLevelWaitMinutes:
          repeatTimes > 0 && repeatWaitMinutes && repeatWaitMinutes > 0
            ? Math.ceil(repeatWaitMinutes)
            : DEFAULT_ESCALATE_AFTER_IN_MINUTES,
      });

      const ownerTeamId: string = asString(
        asRecord(escalation["ownerTeam"])["id"],
      );

      policies.push({
        sourceId: sourceId,
        name: cleanName(escalation["name"], sourceId),
        description: cleanDescription(escalation["description"]),
        ownerTeamSourceIds: ownerTeamId ? [ownerTeamId] : [],
        levels: levels,
        repeatTimes: repeatTimes,
        notes: policyNotes,
      });
    }

    return policies;
  }

  /*
   * Opsgenie rules, each "page this recipient N minutes after the alert was
   * created", as OneUptime levels: rules with the same delay page together,
   * and each level waits until the next delay before the next level pages.
   */
  private toLevels(data: {
    rules: Array<unknown>;
    peopleIndex: PeopleIndex;
    schedules: Array<ImportedSchedule>;
    notes: Array<ToolImportNote>;
    lastLevelWaitMinutes: number;
  }): Array<ImportedPolicyLevel> {
    const byDelay: Map<number, ImportedPolicyLevel> = new Map<
      number,
      ImportedPolicyLevel
    >();
    const noted: Set<ToolImportNoteCode> = new Set<ToolImportNoteCode>();

    const note: (code: ToolImportNoteCode) => void = (
      code: ToolImportNoteCode,
    ): void => {
      if (!noted.has(code)) {
        noted.add(code);
        data.notes.push(makeToolImportNote(code));
      }
    };

    for (const rawRule of data.rules) {
      const rule: Record<string, unknown> = asRecord(rawRule);
      const delayMinutes: number = toMinutes(asRecord(rule["delay"]));
      const recipient: Record<string, unknown> = asRecord(rule["recipient"]);
      const type: string = asString(recipient["type"]).toLowerCase();
      const notifyType: string = asString(rule["notifyType"]).toLowerCase();

      if (asString(rule["condition"]).toLowerCase() === "if-not-closed") {
        note(ToolImportNoteCode.PolicyWaitsForClose);
      }

      const level: ImportedPolicyLevel = byDelay.get(delayMinutes) || {
        escalateAfterMinutes: 0,
        personSourceIds: [],
        teamSourceIds: [],
        scheduleSourceIds: [],
      };

      if (type === "user") {
        const personId: string | null = data.peopleIndex.find({
          id: asString(recipient["id"]),
          email: asString(recipient["username"]),
        });

        if (personId) {
          level.personSourceIds.push(personId);
        } else {
          note(ToolImportNoteCode.PolicyUnknownTarget);
        }
      } else if (type === "schedule") {
        const scheduleId: string = asString(recipient["id"]);
        const schedule: ImportedSchedule | undefined = data.schedules.find(
          (candidate: ImportedSchedule): boolean => {
            return candidate.sourceId === scheduleId;
          },
        );

        if (notifyType === "all" && schedule) {
          // Everyone who takes turns in the schedule, not only who is on now.
          for (const rotation of schedule.rotations) {
            level.personSourceIds.push(...rotation.participantSourceIds);
          }
        } else if (scheduleId) {
          if (notifyType === "next" || notifyType === "previous") {
            note(ToolImportNoteCode.PolicyNextOnCall);
          }
          level.scheduleSourceIds.push(scheduleId);
        }
      } else if (type === "team") {
        const teamId: string = asString(recipient["id"]);

        if (teamId) {
          if (notifyType === "admins") {
            note(ToolImportNoteCode.PolicyTeamAdmins);
          }
          level.teamSourceIds.push(teamId);
        }
      } else {
        note(ToolImportNoteCode.PolicyUnknownTarget);
      }

      byDelay.set(delayMinutes, level);
    }

    const delays: Array<number> = [...byDelay.keys()].sort(
      (first: number, second: number): number => {
        return first - second;
      },
    );

    if (delays.length > 0 && delays[0]! > 0) {
      data.notes.push(
        makeToolImportNote(ToolImportNoteCode.PolicyFirstStepWaits, {
          minutes: delays[0]!,
        }),
      );
    }

    const levels: Array<ImportedPolicyLevel> = delays.map(
      (delay: number, index: number): ImportedPolicyLevel => {
        const level: ImportedPolicyLevel = byDelay.get(delay)!;
        const nextDelay: number | undefined = delays[index + 1];

        return {
          escalateAfterMinutes:
            nextDelay !== undefined
              ? Math.max(1, nextDelay - delay)
              : data.lastLevelWaitMinutes,
          personSourceIds: uniqueStrings(level.personSourceIds),
          teamSourceIds: uniqueStrings(level.teamSourceIds),
          scheduleSourceIds: uniqueStrings(level.scheduleSourceIds),
        };
      },
    );

    return levels.slice(0, TOOL_IMPORT_MAX_LEVELS_PER_POLICY);
  }

  private async readServices(
    client: ToolImportHttpClient,
    notes: Array<ToolImportNote>,
  ): Promise<Array<ImportedService>> {
    const services: Array<ImportedService> = [];
    let offset: number = 0;
    let hasMore: boolean = false;

    for (;;) {
      const body: Record<string, unknown> = asRecord(
        await client.getJson("/v1/services", {
          limit: PAGE_SIZE,
          offset: offset,
        }),
      );

      const page: Array<unknown> = asArray(body["data"]);

      for (const raw of page) {
        const service: Record<string, unknown> = asRecord(raw);
        const sourceId: string = asString(service["id"]);

        if (!sourceId) {
          continue;
        }

        const teamId: string = asString(service["teamId"]);

        services.push({
          sourceId: sourceId,
          name: cleanName(service["name"], sourceId),
          description: cleanDescription(service["description"]),
          ownerTeamSourceIds: teamId ? [teamId] : [],
          notes: [],
        });
      }

      offset += page.length;

      const total: number | null = asNumber(body["totalCount"]);

      if (page.length < PAGE_SIZE || (total !== null && offset >= total)) {
        break;
      }

      if (services.length >= TOOL_IMPORT_MAX_RECORDS_PER_KIND) {
        hasMore = true;
        break;
      }
    }

    return capRecords({
      kind: ToolImportResourceKind.Service,
      records: services,
      notes: notes,
      hasMore: hasMore,
    });
  }
}

// Opsgenie's { timeAmount, timeUnit } as whole minutes, rounded up.
export function toMinutes(delay: Record<string, unknown>): number {
  const amount: number = Math.max(0, asNumber(delay["timeAmount"]) || 0);
  const unit: string = asString(delay["timeUnit"]).toLowerCase() || "minutes";

  const minutes: number =
    unit === "days"
      ? amount * 24 * 60
      : unit === "hours"
        ? amount * 60
        : unit === "seconds"
          ? amount / 60
          : unit === "miliseconds" || unit === "milliseconds"
            ? amount / 60000
            : unit === "micros" || unit === "nanos"
              ? 0
              : amount;

  return Math.ceil(minutes);
}

/*
 * People by Opsgenie id, and by email (Opsgenie's username) for the places
 * that name a person only by it.
 */
class PeopleIndex {
  private ids: Set<string> = new Set<string>();
  private byEmail: Map<string, string> = new Map<string, string>();

  public constructor(people: Array<ImportedPerson>) {
    for (const person of people) {
      this.ids.add(person.sourceId);

      if (person.email) {
        this.byEmail.set(person.email, person.sourceId);
      }
    }
  }

  public find(data: { id: string; email: string }): string | null {
    if (data.id && this.ids.has(data.id)) {
      return data.id;
    }

    const email: string | null = cleanEmail(data.email);

    return email ? this.byEmail.get(email) || null : null;
  }
}
