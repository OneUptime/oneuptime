import CustomFieldType from "../../../../../Types/CustomField/CustomFieldType";
import DayOfWeek from "../../../../../Types/Day/DayOfWeek";
import EventInterval from "../../../../../Types/Events/EventInterval";
import { DEFAULT_ESCALATE_AFTER_IN_MINUTES } from "../../../../../Types/OnCallDutyPolicy/EscalationRuleDefaults";
import {
  TOOL_IMPORT_MAX_CUSTOM_FIELD_OPTIONS,
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
  formatTimeOfDay,
  getConcurrentLayerOrder,
  getNextDayOfWeek,
  parseTimeOfDay,
  toDayOfWeek,
  toEventInterval,
} from "../../../../../Types/ToolImport/ToolImportScheduleRules";
import {
  getEmptyToolImportSnapshot,
  ImportedIncidentCustomField,
  ImportedIncidentRole,
  ImportedIncidentRoleKind,
  ImportedIncidentSeverity,
  ImportedIncidentState,
  ImportedIncidentStateKind,
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
  ToolImportQuery,
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
 * INCIDENT.IO.
 *
 * Reads, with an API key from Settings > API keys (a key with only the
 * "view" roles is enough - an import never writes to incident.io), through
 * the public API documented at https://docs.incident.io/api-reference
 * (OpenAPI: https://api.incident.io/v1/openapiV3.json):
 *
 *   GET /v1/identity                       the key's account, and its roles
 *   GET /v2/users?page_size=&after=        people
 *   GET /v3/teams?page_size=&after=        teams with their members
 *   GET /v2/schedules?page_size=&after=    schedules with their rotations
 *   GET /v2/escalation_paths?page_size=&after=   escalation paths
 *   GET /v1/severities                     severities
 *   GET /v1/incident_statuses              incident statuses
 *   GET /v2/incident_roles                 incident roles
 *   GET /v2/custom_fields                  custom fields
 *   GET /v1/custom_field_options?custom_field_id=&page_size=&after=
 *   GET /v3/catalog_types                  the catalog types that are
 *   GET /v3/catalog_entries?catalog_type_id=&page_size=&after=   services
 *
 * Auth is `Authorization: Bearer <key>`. Lists are cursor paged: each page's
 * pagination_meta.after is the next page's `after`, until a page has none.
 *
 * How incident.io's ideas map:
 *  - A rotation is a layer. A rotation is kept in versions, each in effect
 *    from its effective_from: the version in effect now is brought over,
 *    and a change scheduled for later is noted. A rotation with several
 *    layers has that many people on call at once, taking the next people
 *    in its list each turn: each layer is brought over as a line of its own
 *    (Types/ToolImport/ToolImportScheduleRules.getConcurrentLayerOrder).
 *  - Working intervals are the rotation's restriction: the same hours every
 *    day are a daily window, anything else weekly windows.
 *  - An escalation path's level nodes are levels. A delay node adds to the
 *    wait before the next level; a repeat node repeats the policy; a branch
 *    on a condition brings over its first branch, with a note.
 */

const PAGE_SIZE: number = 100;
// The escalation paths list documents a maximum page size of 25.
const ESCALATION_PATH_PAGE_SIZE: number = 25;
const OPTION_PAGE_SIZE: number = 250;

const KEY_ADVICE: string =
  "Check that you copied the whole key, and that the key may view your organisation's data, schedules, on-call and catalog.";

export default class IncidentIoAdapter implements ToolImportAdapter {
  public source: ToolImportSource = ToolImportSource.IncidentIo;

  public async read(
    settings: ToolImportReadSettings,
    context: ToolImportReadContext,
  ): Promise<ToolImportSnapshot> {
    const client: ToolImportHttpClient = createToolImportClient({
      settings: settings,
      context: context,
    });

    const snapshot: ToolImportSnapshot = getEmptyToolImportSnapshot(
      ToolImportSource.IncidentIo,
    );
    const now: number = context.now ? context.now() : Date.now();

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
            now,
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

      await context.onProgress?.(ToolImportResourceKind.IncidentSeverity);
      snapshot.incidentSeverities =
        await readOptionalList<ImportedIncidentSeverity>({
          kind: ToolImportResourceKind.IncidentSeverity,
          notes: snapshot.notes,
          read: async (): Promise<Array<ImportedIncidentSeverity>> => {
            return await this.readSeverities(client);
          },
        });

      await context.onProgress?.(ToolImportResourceKind.IncidentState);
      snapshot.incidentStates = await readOptionalList<ImportedIncidentState>({
        kind: ToolImportResourceKind.IncidentState,
        notes: snapshot.notes,
        read: async (): Promise<Array<ImportedIncidentState>> => {
          return await this.readStatuses(client);
        },
      });

      await context.onProgress?.(ToolImportResourceKind.IncidentRole);
      snapshot.incidentRoles = await readOptionalList<ImportedIncidentRole>({
        kind: ToolImportResourceKind.IncidentRole,
        notes: snapshot.notes,
        read: async (): Promise<Array<ImportedIncidentRole>> => {
          return await this.readRoles(client);
        },
      });

      await context.onProgress?.(ToolImportResourceKind.IncidentCustomField);
      snapshot.incidentCustomFields =
        await readOptionalList<ImportedIncidentCustomField>({
          kind: ToolImportResourceKind.IncidentCustomField,
          notes: snapshot.notes,
          read: async (): Promise<Array<ImportedIncidentCustomField>> => {
            return await this.readCustomFields(client);
          },
        });
    } catch (error) {
      throw toFatalReadError({
        error: error,
        toolName: "incident.io",
        keyAdvice: KEY_ADVICE,
      });
    }

    const unreadable: number = snapshot.notes.filter(
      (note: ToolImportNote): boolean => {
        return note.code === ToolImportNoteCode.CouldNotRead;
      },
    ).length;

    if (unreadable >= 9) {
      throw new ToolImportReadError(
        `The API key could not read anything from incident.io. ${KEY_ADVICE}`,
      );
    }

    snapshot.readAt = new Date(
      context.now ? context.now() : Date.now(),
    ).toISOString();

    return snapshot;
  }

  /*
   * The organisation, from the dashboard address the identity endpoint
   * gives (https://app.incident.io/<organisation>), or the key's name. The
   * endpoint also checks the key, before anything else is read.
   */
  private async readAccountName(
    client: ToolImportHttpClient,
  ): Promise<string | undefined> {
    const identity: Record<string, unknown> = asRecord(
      asRecord(await client.getJson("/v1/identity"))["identity"],
    );

    const dashboardUrl: string = asString(identity["dashboard_url"]);

    if (dashboardUrl) {
      try {
        const organisation: string =
          new URL(dashboardUrl).pathname.split("/").filter(Boolean)[0] || "";

        if (organisation) {
          return cleanName(organisation, "");
        }
      } catch {
        // Not an address: fall back to the key's name.
      }
    }

    return cleanName(identity["name"], "") || undefined;
  }

  /*
   * Every record of a cursor-paged list: `field` of each page, following
   * pagination_meta.after until a page has none (or repeats itself). At most
   * TOOL_IMPORT_MAX_RECORDS_PER_KIND records; `hasMore` says when there were
   * more.
   */
  private async readPaged(data: {
    client: ToolImportHttpClient;
    path: string;
    field: string;
    pageSize: number;
    query?: ToolImportQuery | undefined;
  }): Promise<{ records: Array<unknown>; hasMore: boolean }> {
    const records: Array<unknown> = [];
    let after: string | undefined = undefined;
    const seenCursors: Set<string> = new Set<string>();

    for (;;) {
      const body: Record<string, unknown> = asRecord(
        await data.client.getJson(data.path, {
          ...(data.query || {}),
          page_size: data.pageSize,
          after: after,
        }),
      );

      const page: Array<unknown> = asArray(body[data.field]);
      records.push(...page);

      const next: string = asString(asRecord(body["pagination_meta"])["after"]);

      if (!next || page.length === 0 || seenCursors.has(next)) {
        return { records: records, hasMore: false };
      }

      if (records.length >= TOOL_IMPORT_MAX_RECORDS_PER_KIND) {
        return { records: records, hasMore: true };
      }

      seenCursors.add(next);
      after = next;
    }
  }

  private async readPeople(
    client: ToolImportHttpClient,
    notes: Array<ToolImportNote>,
  ): Promise<Array<ImportedPerson>> {
    const read: { records: Array<unknown>; hasMore: boolean } =
      await this.readPaged({
        client: client,
        path: "/v2/users",
        field: "users",
        pageSize: PAGE_SIZE,
      });

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
        name: cleanName(user["name"], email || sourceId),
        email: email,
        isActive: asBoolean(user["is_active"], true),
        notes: [],
      });
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
    peopleIndex: PeopleIndex,
    notes: Array<ToolImportNote>,
  ): Promise<Array<ImportedTeam>> {
    const read: { records: Array<unknown>; hasMore: boolean } =
      await this.readPaged({
        client: client,
        path: "/v3/teams",
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

      const members: Array<string> = [];

      for (const rawMember of asArray(team["members"])) {
        const member: Record<string, unknown> = asRecord(rawMember);
        const personId: string | null = peopleIndex.find({
          id: asString(member["id"]),
          email: asString(member["email"]),
        });

        if (personId) {
          members.push(personId);
        }
      }

      teams.push({
        sourceId: sourceId,
        name: cleanName(team["name"], sourceId),
        memberSourceIds: uniqueStrings(members),
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
    peopleIndex: PeopleIndex,
    notes: Array<ToolImportNote>,
    now: number,
  ): Promise<Array<ImportedSchedule>> {
    const read: { records: Array<unknown>; hasMore: boolean } =
      await this.readPaged({
        client: client,
        path: "/v2/schedules",
        field: "schedules",
        pageSize: PAGE_SIZE,
      });

    const schedules: Array<ImportedSchedule> = [];

    for (const raw of read.records) {
      const schedule: Record<string, unknown> = asRecord(raw);
      const sourceId: string = asString(schedule["id"]);

      if (!sourceId) {
        continue;
      }

      const scheduleNotes: Array<ToolImportNote> = [];
      const rotations: Array<ImportedRotation> = [];
      const versionsById: Map<string, Array<Record<string, unknown>>> = new Map<
        string,
        Array<Record<string, unknown>>
      >();

      for (const rawRotation of asArray(
        asRecord(schedule["config"])["rotations"],
      )) {
        const rotation: Record<string, unknown> = asRecord(rawRotation);
        const rotationId: string = asString(rotation["id"]);

        if (!rotationId) {
          continue;
        }

        const versions: Array<Record<string, unknown>> =
          versionsById.get(rotationId) || [];
        versions.push(rotation);
        versionsById.set(rotationId, versions);
      }

      for (const [rotationId, versions] of versionsById) {
        rotations.push(
          ...this.toRotations({
            rotationId: rotationId,
            versions: versions,
            peopleIndex: peopleIndex,
            now: now,
            scheduleNotes: scheduleNotes,
          }),
        );
      }

      schedules.push({
        sourceId: sourceId,
        name: cleanName(schedule["name"], sourceId),
        timezone: asString(schedule["timezone"]) || "UTC",
        isEnabled: true,
        ownerTeamSourceIds: uniqueStrings(
          asArray(schedule["team_ids"]).map((id: unknown): string => {
            return asString(id);
          }),
        ),
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
   * A rotation's version in effect now as one line of turns per layer.
   */
  private toRotations(data: {
    rotationId: string;
    versions: Array<Record<string, unknown>>;
    peopleIndex: PeopleIndex;
    now: number;
    scheduleNotes: Array<ToolImportNote>;
  }): Array<ImportedRotation> {
    const effectiveFrom: (version: Record<string, unknown>) => number = (
      version: Record<string, unknown>,
    ): number => {
      const time: string | null = cleanTime(version["effective_from"]);
      // A rotation's first version has no effective_from: it always applied.
      return time ? Date.parse(time) : Number.NEGATIVE_INFINITY;
    };

    const versions: Array<Record<string, unknown>> = [...data.versions].sort(
      (
        first: Record<string, unknown>,
        second: Record<string, unknown>,
      ): number => {
        return effectiveFrom(first) - effectiveFrom(second);
      },
    );

    const inEffect: Array<Record<string, unknown>> = versions.filter(
      (version: Record<string, unknown>): boolean => {
        return effectiveFrom(version) <= data.now;
      },
    );

    const current: Record<string, unknown> =
      inEffect[inEffect.length - 1] || versions[0]!;
    const name: string = cleanName(current["name"], data.rotationId);
    const notes: Array<ToolImportNote> = [];

    if (inEffect.length === 0) {
      notes.push(
        makeToolImportNote(ToolImportNoteCode.RotationNotStarted, {
          rotation: name,
          date: cleanTime(current["effective_from"]) || "",
        }),
      );
    }

    for (const later of versions) {
      if (later !== current && effectiveFrom(later) > effectiveFrom(current)) {
        notes.push(
          makeToolImportNote(ToolImportNoteCode.RotationScheduledChange, {
            rotation: name,
            date: cleanTime(later["effective_from"]) || "",
          }),
        );
      }
    }

    const startsAt: string | null = cleanTime(current["handover_start_at"]);

    if (!startsAt) {
      return [];
    }

    const handovers: Array<Record<string, unknown>> = asArray(
      current["handovers"],
    ).map((handover: unknown): Record<string, unknown> => {
      return asRecord(handover);
    });
    const firstHandover: Record<string, unknown> = handovers[0] || {};

    if (handovers.length > 1) {
      notes.push(
        makeToolImportNote(ToolImportNoteCode.RotationUnevenShifts, {
          rotation: name,
        }),
      );
    }

    const intervalType: EventInterval =
      toEventInterval(firstHandover["interval_type"]) || EventInterval.Week;
    const intervalCount: number = Math.max(
      1,
      Math.floor(asNumber(firstHandover["interval"]) || 1),
    );

    const people: Array<string> = [];

    for (const rawUser of asArray(current["users"])) {
      const user: Record<string, unknown> = asRecord(rawUser);
      const personId: string | null = data.peopleIndex.find({
        id: asString(user["id"]),
        email: asString(user["email"]),
      });

      if (personId) {
        people.push(personId);
      }
    }

    const restriction: ImportedRestriction | null = this.toRestriction(
      asArray(current["working_intervals"]).length > 0
        ? asArray(current["working_intervals"])
        : asArray(current["working_interval"]),
    );

    const layers: Array<Record<string, unknown>> = asArray(
      current["layers"],
    ).map((layer: unknown): Record<string, unknown> => {
      return asRecord(layer);
    });

    if (layers.length <= 1) {
      return [
        {
          key: data.rotationId,
          name: name,
          startsAt: startsAt,
          intervalType: intervalType,
          intervalCount: intervalCount,
          restriction: restriction,
          participantSourceIds: people,
          notes: notes,
        },
      ];
    }

    data.scheduleNotes.push(
      makeToolImportNote(ToolImportNoteCode.RotationLayers, {
        rotation: name,
        count: layers.length,
      }),
    );

    const rotations: Array<ImportedRotation> = [];

    layers.forEach((layer: Record<string, unknown>, index: number): void => {
      const order: Array<string> = getConcurrentLayerOrder({
        people: people,
        layerCount: layers.length,
        layerIndex: index,
      });

      if (order.length === 0) {
        return;
      }

      const layerName: string = cleanName(layer["name"], `Layer ${index + 1}`);

      rotations.push({
        key: `${data.rotationId}:${asString(layer["id"]) || index + 1}`,
        name: cleanName(`${name} (${layerName})`, name),
        startsAt: startsAt,
        intervalType: intervalType,
        intervalCount: intervalCount,
        restriction: restriction,
        participantSourceIds: order,
        notes: index === 0 ? notes : [],
      });
    });

    return rotations;
  }

  /*
   * Working intervals ({ weekday, start_time, end_time } each) as a
   * restriction: the same window on all seven days is a daily one, anything
   * else one weekly window per interval. An interval that ends before it
   * starts runs past midnight into the next day.
   */
  private toRestriction(intervals: Array<unknown>): ImportedRestriction | null {
    const windows: Array<ImportedWeeklyWindow> = [];

    for (const rawInterval of intervals) {
      const interval: Record<string, unknown> = asRecord(rawInterval);
      const day: DayOfWeek | null = toDayOfWeek(interval["weekday"]);
      const start: number | null = parseTimeOfDay(
        asString(interval["start_time"]),
      );
      const end: number | null = parseTimeOfDay(asString(interval["end_time"]));

      if (!day || start === null || end === null) {
        continue;
      }

      // Midnight, or an end before the start, is the next day's.
      const endsNextDay: boolean = end === 0 || end <= start;

      windows.push({
        startDay: day,
        startTime: formatTimeOfDay(start),
        endDay: endsNextDay ? getNextDayOfWeek(day) : day,
        endTime: formatTimeOfDay(end),
      });
    }

    if (windows.length === 0) {
      return null;
    }

    const first: ImportedWeeklyWindow = windows[0]!;
    const days: Set<DayOfWeek> = new Set<DayOfWeek>(
      windows.map((window: ImportedWeeklyWindow): DayOfWeek => {
        return window.startDay;
      }),
    );

    const isSameEveryDay: boolean =
      windows.length === 7 &&
      days.size === 7 &&
      windows.every((window: ImportedWeeklyWindow): boolean => {
        return (
          window.startTime === first.startTime &&
          window.endTime === first.endTime &&
          (window.endDay === window.startDay) ===
            (first.endDay === first.startDay)
        );
      });

    if (isSameEveryDay) {
      return {
        type: "Daily",
        startTime: first.startTime,
        endTime: first.endTime,
      };
    }

    return { type: "Weekly", windows: windows };
  }

  private async readPolicies(
    client: ToolImportHttpClient,
    peopleIndex: PeopleIndex,
    schedules: Array<ImportedSchedule>,
    notes: Array<ToolImportNote>,
  ): Promise<Array<ImportedPolicy>> {
    const read: { records: Array<unknown>; hasMore: boolean } =
      await this.readPaged({
        client: client,
        path: "/v2/escalation_paths",
        field: "escalation_paths",
        pageSize: ESCALATION_PATH_PAGE_SIZE,
      });

    const policies: Array<ImportedPolicy> = [];

    for (const raw of read.records) {
      const path: Record<string, unknown> = asRecord(raw);
      const sourceId: string = asString(path["id"]);

      if (!sourceId) {
        continue;
      }

      const policyNotes: Array<ToolImportNote> = [];
      const nodes: Array<unknown> = asArray(path["path"]);
      const isTemplated: boolean =
        asString(path["kind"]).toLowerCase() === "templated" ||
        (nodes.length === 0 && Boolean(asString(path["template_id"])));

      const flattened: FlattenedPath = isTemplated
        ? { levels: [], repeatTimes: 0 }
        : new PathFlattener({
            peopleIndex: peopleIndex,
            schedules: schedules,
            notes: policyNotes,
          }).flatten(nodes);

      policies.push({
        sourceId: sourceId,
        name: cleanName(path["name"], sourceId),
        ownerTeamSourceIds: uniqueStrings(
          asArray(path["team_ids"]).map((id: unknown): string => {
            return asString(id);
          }),
        ),
        levels: flattened.levels.slice(0, TOOL_IMPORT_MAX_LEVELS_PER_POLICY),
        repeatTimes: flattened.repeatTimes,
        isUnreadable: isTemplated,
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

  /*
   * Services are the catalog's entries of every catalog type incident.io
   * files under "service". An archived entry is left out.
   */
  private async readServices(
    client: ToolImportHttpClient,
    notes: Array<ToolImportNote>,
  ): Promise<Array<ImportedService>> {
    const types: Array<Record<string, unknown>> = asArray(
      asRecord(await client.getJson("/v3/catalog_types"))["catalog_types"],
    )
      .map((type: unknown): Record<string, unknown> => {
        return asRecord(type);
      })
      .filter((type: Record<string, unknown>): boolean => {
        return asArray(type["categories"]).some(
          (category: unknown): boolean => {
            return asString(category).toLowerCase() === "service";
          },
        );
      });

    const services: Array<ImportedService> = [];
    let hasMore: boolean = false;

    for (const type of types) {
      const typeId: string = asString(type["id"]);

      if (!typeId) {
        continue;
      }

      const read: { records: Array<unknown>; hasMore: boolean } =
        await this.readPaged({
          client: client,
          path: "/v3/catalog_entries",
          field: "catalog_entries",
          pageSize: OPTION_PAGE_SIZE,
          query: { catalog_type_id: typeId },
        });

      hasMore = hasMore || read.hasMore;

      for (const raw of read.records) {
        const entry: Record<string, unknown> = asRecord(raw);
        const sourceId: string = asString(entry["id"]);

        if (!sourceId || asString(entry["archived_at"])) {
          continue;
        }

        services.push({
          sourceId: sourceId,
          name: cleanName(entry["name"], sourceId),
          ownerTeamSourceIds: [],
          notes: [],
        });
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

  private async readSeverities(
    client: ToolImportHttpClient,
  ): Promise<Array<ImportedIncidentSeverity>> {
    const raws: Array<Record<string, unknown>> = asArray(
      asRecord(await client.getJson("/v1/severities"))["severities"],
    ).map((raw: unknown): Record<string, unknown> => {
      return asRecord(raw);
    });

    // incident.io ranks the least severe lowest; OneUptime orders the most severe first.
    const sorted: Array<Record<string, unknown>> = raws
      .filter((raw: Record<string, unknown>): boolean => {
        return Boolean(asString(raw["id"]));
      })
      .sort(
        (
          first: Record<string, unknown>,
          second: Record<string, unknown>,
        ): number => {
          return (
            (asNumber(second["rank"]) || 0) - (asNumber(first["rank"]) || 0)
          );
        },
      );

    return sorted.map(
      (
        severity: Record<string, unknown>,
        index: number,
      ): ImportedIncidentSeverity => {
        return {
          sourceId: asString(severity["id"]),
          name: cleanName(severity["name"], asString(severity["id"])),
          description: cleanDescription(severity["description"]),
          order: index + 1,
          notes: [],
        };
      },
    );
  }

  private async readStatuses(
    client: ToolImportHttpClient,
  ): Promise<Array<ImportedIncidentState>> {
    const raws: Array<Record<string, unknown>> = asArray(
      asRecord(await client.getJson("/v1/incident_statuses"))[
        "incident_statuses"
      ],
    )
      .map((raw: unknown): Record<string, unknown> => {
        return asRecord(raw);
      })
      .filter((raw: Record<string, unknown>): boolean => {
        return Boolean(asString(raw["id"]));
      })
      .sort(
        (
          first: Record<string, unknown>,
          second: Record<string, unknown>,
        ): number => {
          return (
            (asNumber(first["rank"]) || 0) - (asNumber(second["rank"]) || 0)
          );
        },
      );

    return raws.map(
      (
        status: Record<string, unknown>,
        index: number,
      ): ImportedIncidentState => {
        const category: string = asString(status["category"]).toLowerCase();

        return {
          sourceId: asString(status["id"]),
          name: cleanName(status["name"], asString(status["id"])),
          description: cleanDescription(status["description"]),
          kind: toStateKind(category),
          sourceCategory: category,
          order: index + 1,
          notes: [],
        };
      },
    );
  }

  private async readRoles(
    client: ToolImportHttpClient,
  ): Promise<Array<ImportedIncidentRole>> {
    return asArray(
      asRecord(await client.getJson("/v2/incident_roles"))["incident_roles"],
    )
      .map((raw: unknown): Record<string, unknown> => {
        return asRecord(raw);
      })
      .filter((raw: Record<string, unknown>): boolean => {
        return Boolean(asString(raw["id"]));
      })
      .map((role: Record<string, unknown>): ImportedIncidentRole => {
        const type: string = asString(role["role_type"]).toLowerCase();

        return {
          sourceId: asString(role["id"]),
          name: cleanName(role["name"], asString(role["id"])),
          description:
            cleanDescription(role["description"]) ||
            cleanDescription(role["instructions"]),
          kind:
            type === "lead"
              ? ImportedIncidentRoleKind.Lead
              : type === "reporter"
                ? ImportedIncidentRoleKind.Reporter
                : ImportedIncidentRoleKind.Custom,
          notes: [],
        };
      });
  }

  private async readCustomFields(
    client: ToolImportHttpClient,
  ): Promise<Array<ImportedIncidentCustomField>> {
    const raws: Array<Record<string, unknown>> = asArray(
      asRecord(await client.getJson("/v2/custom_fields"))["custom_fields"],
    )
      .map((raw: unknown): Record<string, unknown> => {
        return asRecord(raw);
      })
      .filter((raw: Record<string, unknown>): boolean => {
        return Boolean(asString(raw["id"]));
      });

    const fields: Array<ImportedIncidentCustomField> = [];

    for (const field of raws) {
      const sourceId: string = asString(field["id"]);
      const type: string = asString(field["field_type"]).toLowerCase();
      const isFromCatalog: boolean = Boolean(
        asString(field["catalog_type_id"]),
      );
      const fieldType: CustomFieldType | null = toCustomFieldType(type);
      const notes: Array<ToolImportNote> = [];
      let options: Array<string> = [];

      if (
        !isFromCatalog &&
        (fieldType === CustomFieldType.Dropdown ||
          fieldType === CustomFieldType.MultiSelectDropdown)
      ) {
        const read: { records: Array<unknown>; hasMore: boolean } =
          await this.readPaged({
            client: client,
            path: "/v1/custom_field_options",
            field: "custom_field_options",
            pageSize: OPTION_PAGE_SIZE,
            query: { custom_field_id: sourceId },
          });

        options = uniqueStrings(
          read.records
            .map((raw: unknown): Record<string, unknown> => {
              return asRecord(raw);
            })
            .sort(
              (
                first: Record<string, unknown>,
                second: Record<string, unknown>,
              ): number => {
                return (
                  (asNumber(first["sort_key"]) || 0) -
                  (asNumber(second["sort_key"]) || 0)
                );
              },
            )
            .map((option: Record<string, unknown>): string => {
              return asString(option["value"]);
            }),
        );

        if (options.length > TOOL_IMPORT_MAX_CUSTOM_FIELD_OPTIONS) {
          notes.push(
            makeToolImportNote(ToolImportNoteCode.CustomFieldOptionsTrimmed, {
              count: TOOL_IMPORT_MAX_CUSTOM_FIELD_OPTIONS,
            }),
          );
          options = options.slice(0, TOOL_IMPORT_MAX_CUSTOM_FIELD_OPTIONS);
        }
      }

      fields.push({
        sourceId: sourceId,
        name: cleanName(field["name"], sourceId),
        description: cleanDescription(field["description"]),
        fieldType: fieldType,
        options: options,
        isFromCatalog: isFromCatalog,
        notes: notes,
      });
    }

    return fields;
  }
}

export function toStateKind(category: string): ImportedIncidentStateKind {
  switch (category) {
    case "triage":
      return ImportedIncidentStateKind.Created;
    case "live":
    case "active":
    case "paused":
      return ImportedIncidentStateKind.InProgress;
    case "closed":
      return ImportedIncidentStateKind.Resolved;
    default:
      return ImportedIncidentStateKind.NotNeeded;
  }
}

export function toCustomFieldType(type: string): CustomFieldType | null {
  switch (type) {
    case "single_select":
      return CustomFieldType.Dropdown;
    case "multi_select":
      return CustomFieldType.MultiSelectDropdown;
    case "text":
    case "link":
      return CustomFieldType.Text;
    case "numeric":
      return CustomFieldType.Number;
    default:
      return null;
  }
}

interface FlattenedPath {
  levels: Array<ImportedPolicyLevel>;
  repeatTimes: number;
}

/*
 * An escalation path's nodes, in order, as levels. Branches are followed
 * into their first ("then") branch, so a path always becomes a straight
 * list of levels; everything that cannot be one is noted once.
 */
class PathFlattener {
  private peopleIndex: PeopleIndex;
  private schedules: Array<ImportedSchedule>;
  private notes: Array<ToolImportNote>;
  private noted: Set<string> = new Set<string>();
  private levels: Array<ImportedPolicyLevel> = [];
  private firstLevelNodeId: string | null = null;
  private repeatTimes: number = 0;
  private waitBeforeFirstLevelMinutes: number = 0;

  public constructor(data: {
    peopleIndex: PeopleIndex;
    schedules: Array<ImportedSchedule>;
    notes: Array<ToolImportNote>;
  }) {
    this.peopleIndex = data.peopleIndex;
    this.schedules = data.schedules;
    this.notes = data.notes;
  }

  public flatten(nodes: Array<unknown>): FlattenedPath {
    this.walk(nodes);

    if (this.waitBeforeFirstLevelMinutes > 0 && this.levels.length > 0) {
      this.notes.push(
        makeToolImportNote(ToolImportNoteCode.PolicyFirstStepWaits, {
          minutes: this.waitBeforeFirstLevelMinutes,
        }),
      );
    }

    return { levels: this.levels, repeatTimes: this.repeatTimes };
  }

  private note(
    code: ToolImportNoteCode,
    values?: Record<string, string | number>,
  ): void {
    const key: string = `${code}:${JSON.stringify(values || {})}`;

    if (!this.noted.has(key)) {
      this.noted.add(key);
      this.notes.push(makeToolImportNote(code, values));
    }
  }

  private walk(nodes: Array<unknown>): void {
    for (const rawNode of nodes) {
      const node: Record<string, unknown> = asRecord(rawNode);
      const type: string = asString(node["type"]).toLowerCase();

      if (type === "level") {
        this.addLevel(asString(node["id"]), asRecord(node["level"]));
      } else if (type === "delay") {
        const delay: Record<string, unknown> = asRecord(node["delay"]);
        const minutes: number = Math.ceil(
          Math.max(0, asNumber(delay["delay_seconds"]) || 0) / 60,
        );

        if (asString(delay["delay_interval_condition"])) {
          this.note(ToolImportNoteCode.PolicyWorkingHours);
        }

        const last: ImportedPolicyLevel | undefined =
          this.levels[this.levels.length - 1];

        if (last) {
          last.escalateAfterMinutes += minutes;
        } else {
          this.waitBeforeFirstLevelMinutes += minutes;
        }
      } else if (type === "notify_channel") {
        this.note(ToolImportNoteCode.PolicyChannelStep);
      } else if (type === "if_else") {
        const branch: Record<string, unknown> = asRecord(node["if_else"]);
        const condition: Record<string, unknown> = asRecord(
          asArray(branch["conditions"])[0],
        );
        const label: string =
          asString(asRecord(condition["subject"])["label"]) ||
          asString(asRecord(condition["subject"])["reference"]);

        this.note(ToolImportNoteCode.PolicyBranch, {
          condition: label || "a condition",
        });
        this.walk(asArray(branch["then_path"]));
      } else if (type === "repeat") {
        const repeat: Record<string, unknown> = asRecord(node["repeat"]);
        this.repeatTimes = Math.max(
          0,
          Math.floor(asNumber(repeat["repeat_times"]) || 0),
        );

        const toNode: string = asString(repeat["to_node"]);

        if (
          toNode &&
          this.firstLevelNodeId &&
          toNode !== this.firstLevelNodeId
        ) {
          this.note(ToolImportNoteCode.PolicyRepeatsFromLater);
        }

        // Nothing after a repeat node runs.
        return;
      } else if (type === "escalation_path") {
        this.note(ToolImportNoteCode.PolicyHandsOver);
      }
    }
  }

  private addLevel(nodeId: string, level: Record<string, unknown>): void {
    if (!this.firstLevelNodeId) {
      this.firstLevelNodeId = nodeId;
    }

    const ackSeconds: number | null = asNumber(level["time_to_ack_seconds"]);

    if (asString(level["time_to_ack_interval_condition"])) {
      this.note(ToolImportNoteCode.PolicyWorkingHours);
    }

    if (asBoolean(asRecord(level["round_robin_config"])["enabled"], false)) {
      this.note(ToolImportNoteCode.PolicyRoundRobin);
    }

    if ((asNumber(asRecord(level["retry_config"])["attempts"]) || 0) > 1) {
      this.note(ToolImportNoteCode.PolicyLevelRepeats);
    }

    const built: ImportedPolicyLevel = {
      escalateAfterMinutes:
        ackSeconds !== null && ackSeconds > 0
          ? Math.max(1, Math.ceil(ackSeconds / 60))
          : DEFAULT_ESCALATE_AFTER_IN_MINUTES,
      personSourceIds: [],
      teamSourceIds: [],
      scheduleSourceIds: [],
    };

    for (const rawTarget of asArray(level["targets"])) {
      const target: Record<string, unknown> = asRecord(rawTarget);
      const type: string = asString(target["type"]).toLowerCase();
      const id: string = asString(target["id"]);

      if (type === "user") {
        const personId: string | null = this.peopleIndex.find({
          id: id,
          email: "",
        });

        if (personId) {
          built.personSourceIds.push(personId);
        } else {
          this.note(ToolImportNoteCode.PolicyUnknownTarget);
        }
      } else if (type === "schedule") {
        this.addScheduleTarget(built, target);
      } else if (type === "slack_channel" || type === "msteams_channel") {
        this.note(ToolImportNoteCode.PolicyChannelStep);
      } else {
        this.note(ToolImportNoteCode.PolicyUnknownTarget);
      }
    }

    built.personSourceIds = uniqueStrings(built.personSourceIds);
    built.scheduleSourceIds = uniqueStrings(built.scheduleSourceIds);

    this.levels.push(built);
  }

  /*
   * A schedule target, by what it pages: whoever is on call (the schedule),
   * whoever is on call next (the schedule, noted), or everyone in it (those
   * people, by name).
   */
  private addScheduleTarget(
    level: ImportedPolicyLevel,
    target: Record<string, unknown>,
  ): void {
    const scheduleId: string = asString(target["id"]);
    const mode: string = asString(target["schedule_mode"]).toLowerCase();
    const rotaId: string = asString(target["selected_rota_id"]);
    const schedule: ImportedSchedule | undefined = this.schedules.find(
      (candidate: ImportedSchedule): boolean => {
        return candidate.sourceId === scheduleId;
      },
    );

    if (!scheduleId) {
      return;
    }

    if ((mode === "all_users" || mode === "all_users_for_rota") && schedule) {
      for (const rotation of schedule.rotations) {
        const rotationId: string = rotation.key.split(":")[0] || "";

        if (mode === "all_users" || rotationId === rotaId) {
          level.personSourceIds.push(...rotation.participantSourceIds);
        }
      }
      return;
    }

    if (mode === "next_on_call" || mode === "next_on_call_for_rota") {
      this.note(ToolImportNoteCode.PolicyNextOnCall);
    }

    level.scheduleSourceIds.push(scheduleId);
  }
}

// People by incident.io id, and by email for the places that name one by it.
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
