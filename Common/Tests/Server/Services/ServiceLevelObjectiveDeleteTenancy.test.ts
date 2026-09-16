/*
 * `jest` is the global (as in ServiceLevelObjectiveService.test.ts), not the
 * @jest/globals export: that export's SpiedFunction type does not accept what
 * jest.spyOn returns with this repo's jest-mock version.
 */
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it, and DatabaseService imports it.
 */
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import Alert from "../../../Models/DatabaseModels/Alert";
import AlertStateTimeline from "../../../Models/DatabaseModels/AlertStateTimeline";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentStateTimeline from "../../../Models/DatabaseModels/IncidentStateTimeline";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import ServiceLevelObjectiveBurnRateRule from "../../../Models/DatabaseModels/ServiceLevelObjectiveBurnRateRule";
import AlertService from "../../../Server/Services/AlertService";
import AlertStateTimelineService from "../../../Server/Services/AlertStateTimelineService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentStateTimelineService from "../../../Server/Services/IncidentStateTimelineService";
import ServiceLevelObjectiveService, {
  SLO_DISABLED_OR_DELETED_ROOT_CAUSE,
} from "../../../Server/Services/ServiceLevelObjectiveService";
import ServiceLevelObjectiveBurnRateRuleService from "../../../Server/Services/ServiceLevelObjectiveBurnRateRuleService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import FindBy from "../../../Server/Types/Database/FindBy";
import logger from "../../../Server/Utils/Logger";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";

/*
 * Contract under test: deleting an SLO, or one of its burn rate rules,
 * resolves what the removed rules left open - and only for rows the delete
 * really removed.
 *
 * DatabaseService runs onBeforeDelete BEFORE it applies the caller's delete
 * permissions, and the CRUD API passes a raw id. Both hooks used to resolve
 * open burn rate alerts and incidents right there, as root, for whatever the
 * raw query matched. So a project admin who sent DELETE for another
 * project's SLO or rule id deleted nothing, yet closed that project's alerts
 * and incidents - and with them, its on-call escalations.
 *
 * These tests drive the real path the CRUD API takes - deleteOneById, the
 * real permission pipeline, _deleteBy's ordering, both hooks - over an
 * in-memory table, and watch the writes that matter: the resolved state
 * timeline rows. What they pin:
 *
 *   - naming another project's row deletes nothing, resolves nothing,
 *     describes nothing, and never even reads that row;
 *   - deleting your own row still resolves every open output, strictly after
 *     the row is gone (for an SLO, after Postgres has cascaded its rules away);
 *   - a delete that fails resolves nothing.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
const SLO_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OTHER_SLO_ID: ObjectID = new ObjectID(
  "1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a",
);
const RULE_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const SECOND_RULE_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const OTHER_RULE_ID: ObjectID = new ObjectID(
  "3b3b3b3b-3b3b-4b3b-8b3b-3b3b3b3b3b3b",
);
const USER_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");
const ALERT_ID: ObjectID = new ObjectID("a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1");
const SECOND_ALERT_ID: ObjectID = new ObjectID(
  "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2",
);
const OTHER_ALERT_ID: ObjectID = new ObjectID(
  "a9a9a9a9-a9a9-4a9a-8a9a-a9a9a9a9a9a9",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1",
);
const OTHER_INCIDENT_ID: ObjectID = new ObjectID(
  "b9b9b9b9-b9b9-4b9b-8b9b-b9b9b9b9b9b9",
);
const RESOLVED_ALERT_STATE_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const RESOLVED_INCIDENT_STATE_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);

const RULE_DELETED_ROOT_CAUSE: string =
  "Auto-resolved because the SLO burn rate rule that created it was deleted.";

// An open Alert or Incident, found by project and fingerprint like the real query.
interface OpenRecord {
  id: ObjectID;
  projectId: ObjectID;
  fingerprint: string;
  resolved: boolean;
}

interface FakeFindBy {
  query: Record<string, unknown>;
  props: DatabaseCommonInteractionProps;
}

interface FindableService {
  _findBy: (findBy: FakeFindBy) => Promise<Array<unknown>>;
}

interface FakeRepository {
  delete: (query: Record<string, unknown>) => Promise<{ affected: number }>;
}

interface RepositoryOwner {
  getRepository: () => FakeRepository;
}

interface TriggerOwner {
  onTriggerWorkflow: () => Promise<void>;
  onTriggerRealtime: () => Promise<void>;
}

interface CarriedDelete {
  deleteBy: { props: Record<string, unknown> };
  carryForward: Record<string, Array<unknown>> | null;
}

interface DeleteSuccessHook {
  onDeleteSuccess: (
    onDelete: CarriedDelete,
    deletedIds: Array<ObjectID>,
  ) => Promise<unknown>;
}

interface RemovedFeedWriter {
  writeBurnRateRuleRemovedFeed: (data: {
    itemsToDelete: Array<ServiceLevelObjectiveBurnRateRule>;
  }) => Promise<void>;
}

interface AuditLogRecorder {
  recordDelete: () => Promise<void>;
}

interface ResolveCall {
  serviceLevelObjectiveId: ObjectID;
  burnRateRuleId: ObjectID;
  projectId: ObjectID;
  rootCause?: string | undefined;
}

let events: Array<string> = [];
let sloRows: Array<ServiceLevelObjective> = [];
let ruleRows: Array<ServiceLevelObjectiveBurnRateRule> = [];
let alerts: Array<OpenRecord> = [];
let incidents: Array<OpenRecord> = [];
let alertTimelines: Array<AlertStateTimeline> = [];
let incidentTimelines: Array<IncidentStateTimeline> = [];
let repositoryFailure: Error | null = null;
let alertFindBySpy: jest.SpyInstance;
let feedWriterSpy: jest.SpyInstance;
let clearStateSpy: jest.SpyInstance;

function fingerprintOf(sloId: ObjectID, ruleId: ObjectID): string {
  return `slo:${sloId.toString()}:burn-rule:${ruleId.toString()}`;
}

function sloRow(id: ObjectID, projectId: ObjectID): ServiceLevelObjective {
  const slo: ServiceLevelObjective = new ServiceLevelObjective(id);
  slo.projectId = projectId;
  slo.name = "Checkout availability";
  return slo;
}

function ruleRow(
  id: ObjectID,
  sloId: ObjectID,
  projectId: ObjectID,
): ServiceLevelObjectiveBurnRateRule {
  const rule: ServiceLevelObjectiveBurnRateRule =
    new ServiceLevelObjectiveBurnRateRule(id);
  rule.projectId = projectId;
  rule.serviceLevelObjectiveId = sloId;
  rule.name = "Fast burn";
  return rule;
}

function openRecord(data: {
  id: ObjectID;
  projectId: ObjectID;
  sloId: ObjectID;
  ruleId: ObjectID;
}): OpenRecord {
  return {
    id: data.id,
    projectId: data.projectId,
    fingerprint: fingerprintOf(data.sloId, data.ruleId),
    resolved: false,
  };
}

function isOpen(records: Array<OpenRecord>, id: ObjectID): boolean {
  return records.some((record: OpenRecord): boolean => {
    return record.id.toString() === id.toString() && !record.resolved;
  });
}

/*
 * A project admin of PROJECT_ID and nothing else - the props the CRUD API
 * builds for a signed-in user who is not a master admin (never isRoot).
 */
function projectAdminProps(): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: [
      {
        _type: "UserPermission",
        permission: Permission.ProjectAdmin,
        labelIds: [],
        isBlockPermission: false,
      },
    ],
  };

  return {
    userId: USER_ID,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: tenantPermission,
    },
  };
}

/*
 * Plain equality on the columns these paths filter on. Anything else - a find
 * operator above all - throws, so a query this fake cannot really answer fails
 * the test instead of silently matching every row.
 */
function matchesQuery(row: unknown, query: Record<string, unknown>): boolean {
  for (const key of Object.keys(query)) {
    const expected: unknown = query[key];

    if (!(typeof expected === "string" || expected instanceof ObjectID)) {
      throw new Error(
        `The fake table cannot filter "${key}" on ${String(expected)}.`,
      );
    }

    const actual: unknown = (row as Record<string, unknown>)[key];

    if (actual === undefined || actual === null) {
      return false;
    }

    if (String(actual).toLowerCase() !== expected.toString().toLowerCase()) {
      return false;
    }
  }

  return true;
}

// The ids QueryHelper.any binds - it builds a TypeORM Raw with named parameters.
function boundIds(operator: unknown): Array<string> {
  const parameters: Record<string, unknown> =
    (operator as { objectLiteralParameters?: Record<string, unknown> })
      ?.objectLiteralParameters || {};

  const ids: Array<string> = [];

  for (const value of Object.values(parameters)) {
    for (const id of Array.isArray(value) ? value : [value]) {
      ids.push(String(id).toLowerCase());
    }
  }

  return ids;
}

/*
 * Stands in for the service's database: every read (the hooks' own, and the
 * permission-checked one inside _deleteBy) is answered from `rows`, and the
 * final delete removes by the ids _deleteBy binds.
 */
function installFakeTable(data: {
  service: unknown;
  table: string;
  rows: () => Array<unknown>;
  remove: (ids: Array<string>) => number;
}): void {
  jest
    .spyOn(data.service as unknown as FindableService, "_findBy")
    .mockImplementation((findBy: FakeFindBy): Promise<Array<unknown>> => {
      /*
       * Every read on these paths is root. A non-root read here would skip
       * the read permissions this fake stands in for, so it fails loudly.
       */
      if (!findBy.props.isRoot) {
        return Promise.reject(
          new Error("The fake table only serves root reads."),
        );
      }

      return Promise.resolve(
        data.rows().filter((row: unknown): boolean => {
          return matchesQuery(row, findBy.query);
        }),
      );
    });

  const repository: FakeRepository = {
    delete: (query: Record<string, unknown>): Promise<{ affected: number }> => {
      if (repositoryFailure) {
        return Promise.reject(repositoryFailure);
      }

      const ids: Array<string> = boundIds(query["_id"]);

      events.push(`delete ${data.table} ${ids.join(",")}`);

      return Promise.resolve({ affected: data.remove(ids) });
    },
  };

  jest
    .spyOn(data.service as unknown as RepositoryOwner, "getRepository")
    .mockReturnValue(repository);

  jest
    .spyOn(data.service as unknown as TriggerOwner, "onTriggerWorkflow")
    .mockResolvedValue(undefined);

  jest
    .spyOn(data.service as unknown as TriggerOwner, "onTriggerRealtime")
    .mockResolvedValue(undefined);
}

function openRecordsFor(
  records: Array<OpenRecord>,
  query: Record<string, unknown>,
): Array<OpenRecord> {
  return records.filter((record: OpenRecord): boolean => {
    return (
      !record.resolved &&
      record.projectId.toString() === String(query["projectId"]) &&
      record.fingerprint === query["seriesFingerprint"]
    );
  });
}

function markResolved(
  records: Array<OpenRecord>,
  id: ObjectID | undefined,
): void {
  for (const record of records) {
    if (id && record.id.toString() === id.toString()) {
      record.resolved = true;
    }
  }
}

function spyOnDeleteSuccess(service: unknown): jest.SpyInstance {
  // Calls through: the real hook runs, the spy only records what it was given.
  return jest.spyOn(service as unknown as DeleteSuccessHook, "onDeleteSuccess");
}

function callHook(
  service: unknown,
  name: string,
  ...args: Array<unknown>
): Promise<unknown> {
  const members: Record<
    string,
    (...memberArgs: Array<unknown>) => Promise<unknown>
  > = service as unknown as Record<
    string,
    (...memberArgs: Array<unknown>) => Promise<unknown>
  >;

  return members[name]!.apply(service, args);
}

beforeEach(() => {
  events = [];
  repositoryFailure = null;
  alertTimelines = [];
  incidentTimelines = [];

  sloRows = [
    sloRow(SLO_ID, PROJECT_ID),
    sloRow(OTHER_SLO_ID, OTHER_PROJECT_ID),
  ];

  ruleRows = [
    ruleRow(RULE_ID, SLO_ID, PROJECT_ID),
    ruleRow(SECOND_RULE_ID, SLO_ID, PROJECT_ID),
    ruleRow(OTHER_RULE_ID, OTHER_SLO_ID, OTHER_PROJECT_ID),
  ];

  alerts = [
    openRecord({
      id: ALERT_ID,
      projectId: PROJECT_ID,
      sloId: SLO_ID,
      ruleId: RULE_ID,
    }),
    openRecord({
      id: SECOND_ALERT_ID,
      projectId: PROJECT_ID,
      sloId: SLO_ID,
      ruleId: SECOND_RULE_ID,
    }),
    openRecord({
      id: OTHER_ALERT_ID,
      projectId: OTHER_PROJECT_ID,
      sloId: OTHER_SLO_ID,
      ruleId: OTHER_RULE_ID,
    }),
  ];

  incidents = [
    openRecord({
      id: INCIDENT_ID,
      projectId: PROJECT_ID,
      sloId: SLO_ID,
      ruleId: RULE_ID,
    }),
    openRecord({
      id: OTHER_INCIDENT_ID,
      projectId: OTHER_PROJECT_ID,
      sloId: OTHER_SLO_ID,
      ruleId: OTHER_RULE_ID,
    }),
  ];

  installFakeTable({
    service: ServiceLevelObjectiveService,
    table: "slo",
    rows: (): Array<unknown> => {
      return sloRows;
    },
    remove: (ids: Array<string>): number => {
      const before: number = sloRows.length;

      sloRows = sloRows.filter((slo: ServiceLevelObjective): boolean => {
        return !ids.includes(slo.id!.toString());
      });

      // ON DELETE CASCADE: Postgres removes the SLO's rules, with no hook.
      ruleRows = ruleRows.filter(
        (rule: ServiceLevelObjectiveBurnRateRule): boolean => {
          return !ids.includes(rule.serviceLevelObjectiveId!.toString());
        },
      );

      return before - sloRows.length;
    },
  });

  installFakeTable({
    service: ServiceLevelObjectiveBurnRateRuleService,
    table: "rule",
    rows: (): Array<unknown> => {
      return ruleRows;
    },
    remove: (ids: Array<string>): number => {
      const before: number = ruleRows.length;

      ruleRows = ruleRows.filter(
        (rule: ServiceLevelObjectiveBurnRateRule): boolean => {
          return !ids.includes(rule.id!.toString());
        },
      );

      return before - ruleRows.length;
    },
  });

  /*
   * Required lazily, exactly as DatabaseService does, so this suite does not
   * pull the analytics service into the import order above.
   */
  const auditLogService: AuditLogRecorder =
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    require("../../../Server/Services/AuditLogService").default;

  jest.spyOn(auditLogService, "recordDelete").mockResolvedValue(undefined);

  alertFindBySpy = jest
    .spyOn(AlertService, "findBy")
    .mockImplementation((findBy: FindBy<Alert>): Promise<Array<Alert>> => {
      return Promise.resolve(
        openRecordsFor(
          alerts,
          findBy.query as unknown as Record<string, unknown>,
        ).map((record: OpenRecord): Alert => {
          const alert: Alert = new Alert(record.id);
          alert.projectId = record.projectId;
          return alert;
        }),
      );
    });

  jest
    .spyOn(IncidentService, "findBy")
    .mockImplementation(
      (findBy: FindBy<Incident>): Promise<Array<Incident>> => {
        return Promise.resolve(
          openRecordsFor(
            incidents,
            findBy.query as unknown as Record<string, unknown>,
          ).map((record: OpenRecord): Incident => {
            const incident: Incident = new Incident(record.id);
            incident.projectId = record.projectId;
            return incident;
          }),
        );
      },
    );

  jest
    .spyOn(AlertStateTimelineService, "getResolvedStateIdForProject")
    .mockResolvedValue(RESOLVED_ALERT_STATE_ID);

  jest
    .spyOn(IncidentStateTimelineService, "getResolvedStateIdForProject")
    .mockResolvedValue(RESOLVED_INCIDENT_STATE_ID);

  jest
    .spyOn(AlertStateTimelineService, "create")
    .mockImplementation(
      (createBy: CreateBy<AlertStateTimeline>): Promise<AlertStateTimeline> => {
        events.push(`resolve alert ${createBy.data.alertId?.toString()}`);
        alertTimelines.push(createBy.data);
        markResolved(alerts, createBy.data.alertId);
        return Promise.resolve(createBy.data);
      },
    );

  jest
    .spyOn(IncidentStateTimelineService, "create")
    .mockImplementation(
      (
        createBy: CreateBy<IncidentStateTimeline>,
      ): Promise<IncidentStateTimeline> => {
        events.push(`resolve incident ${createBy.data.incidentId?.toString()}`);
        incidentTimelines.push(createBy.data);
        markResolved(incidents, createBy.data.incidentId);
        return Promise.resolve(createBy.data);
      },
    );

  feedWriterSpy = jest
    .spyOn(
      ServiceLevelObjectiveBurnRateRuleService as unknown as RemovedFeedWriter,
      "writeBurnRateRuleRemovedFeed",
    )
    .mockResolvedValue(undefined);

  clearStateSpy = jest
    .spyOn(
      ServiceLevelObjectiveBurnRateRuleService,
      "clearOpenOutputStateForRule",
    )
    .mockResolvedValue(undefined);

  jest.spyOn(logger, "error").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Deleting a burn rate rule by id, the way the CRUD API does", () => {
  test("a project admin who names another project's rule deletes nothing, resolves nothing, describes nothing, and never reads that rule", async () => {
    const deleteSuccessSpy: jest.SpyInstance = spyOnDeleteSuccess(
      ServiceLevelObjectiveBurnRateRuleService,
    );

    const deleted: number =
      await ServiceLevelObjectiveBurnRateRuleService.deleteOneById({
        id: OTHER_RULE_ID,
        props: projectAdminProps(),
      });

    expect(deleted).toBe(0);

    // No delete, and not one resolved state timeline row anywhere.
    expect(events).toEqual([]);
    expect(alertTimelines).toEqual([]);
    expect(incidentTimelines).toEqual([]);
    expect(isOpen(alerts, OTHER_ALERT_ID)).toBe(true);
    expect(isOpen(incidents, OTHER_INCIDENT_ID)).toBe(true);
    expect(alertFindBySpy).not.toHaveBeenCalled();
    expect(feedWriterSpy).not.toHaveBeenCalled();

    // The other project's rule still exists.
    expect(
      ruleRows.map((rule: ServiceLevelObjectiveBurnRateRule): string => {
        return rule.id!.toString();
      }),
    ).toContain(OTHER_RULE_ID.toString());

    /*
     * The before-delete read was pinned to the caller's project, so the other
     * project's rule never even reached the carry-forward.
     */
    expect(deleteSuccessSpy).toHaveBeenCalledTimes(1);

    const hookCall: [CarriedDelete, Array<ObjectID>] = deleteSuccessSpy.mock
      .calls[0] as [CarriedDelete, Array<ObjectID>];
    const onDelete: CarriedDelete = hookCall[0];
    const deletedIds: Array<ObjectID> = hookCall[1];

    expect(onDelete.carryForward!["itemsToDelete"]).toEqual([]);
    expect(deletedIds).toEqual([]);
  });

  test("the same admin deleting their own rule resolves its open alert and incident only after the row is gone, and describes it", async () => {
    const deleted: number =
      await ServiceLevelObjectiveBurnRateRuleService.deleteOneById({
        id: RULE_ID,
        props: projectAdminProps(),
      });

    expect(deleted).toBe(1);

    expect(events).toEqual([
      `delete rule ${RULE_ID.toString()}`,
      `resolve alert ${ALERT_ID.toString()}`,
      `resolve incident ${INCIDENT_ID.toString()}`,
    ]);

    expect(alertTimelines).toHaveLength(1);
    expect(alertTimelines[0]!.rootCause).toBe(RULE_DELETED_ROOT_CAUSE);
    expect(alertTimelines[0]!.alertStateId?.toString()).toBe(
      RESOLVED_ALERT_STATE_ID.toString(),
    );
    expect(alertTimelines[0]!.projectId?.toString()).toBe(
      PROJECT_ID.toString(),
    );
    expect(incidentTimelines).toHaveLength(1);
    expect(incidentTimelines[0]!.rootCause).toBe(RULE_DELETED_ROOT_CAUSE);

    // The sibling rule's alert and the other project's records stay open.
    expect(isOpen(alerts, SECOND_ALERT_ID)).toBe(true);
    expect(isOpen(alerts, OTHER_ALERT_ID)).toBe(true);
    expect(isOpen(incidents, OTHER_INCIDENT_ID)).toBe(true);

    expect(feedWriterSpy).toHaveBeenCalledTimes(1);

    const described: Array<ServiceLevelObjectiveBurnRateRule> = (
      feedWriterSpy.mock.calls[0]![0] as {
        itemsToDelete: Array<ServiceLevelObjectiveBurnRateRule>;
      }
    ).itemsToDelete;

    expect(
      described.map((rule: ServiceLevelObjectiveBurnRateRule): string => {
        return rule.id!.toString();
      }),
    ).toEqual([RULE_ID.toString()]);

    expect(logger.error).not.toHaveBeenCalled();
  });

  test("a rule delete that fails resolves nothing - the rule still stands behind its records", async () => {
    repositoryFailure = new Error("connection reset");

    await expect(
      ServiceLevelObjectiveBurnRateRuleService.deleteOneById({
        id: RULE_ID,
        props: projectAdminProps(),
      }),
    ).rejects.toThrow();

    expect(events).toEqual([]);
    expect(alertTimelines).toEqual([]);
    expect(incidentTimelines).toEqual([]);
    expect(isOpen(alerts, ALERT_ID)).toBe(true);
    expect(isOpen(incidents, INCIDENT_ID)).toBe(true);
    expect(feedWriterSpy).not.toHaveBeenCalled();
  });

  test("a root automation deleting by query, with no tenant, still resolves what every removed rule opened", async () => {
    const deleted: number =
      await ServiceLevelObjectiveBurnRateRuleService.deleteBy({
        query: { serviceLevelObjectiveId: SLO_ID },
        props: { isRoot: true },
        limit: LIMIT_MAX,
        skip: 0,
      });

    expect(deleted).toBe(2);

    expect(events).toEqual([
      `delete rule ${RULE_ID.toString()},${SECOND_RULE_ID.toString()}`,
      `resolve alert ${ALERT_ID.toString()}`,
      `resolve incident ${INCIDENT_ID.toString()}`,
      `resolve alert ${SECOND_ALERT_ID.toString()}`,
    ]);

    expect(isOpen(alerts, OTHER_ALERT_ID)).toBe(true);
    expect(isOpen(incidents, OTHER_INCIDENT_ID)).toBe(true);
  });
});

describe("Deleting an SLO by id, the way the CRUD API does", () => {
  test("a project admin who names another project's SLO deletes nothing, resolves nothing, and never reads that SLO or its rules", async () => {
    const deleteSuccessSpy: jest.SpyInstance = spyOnDeleteSuccess(
      ServiceLevelObjectiveService,
    );

    const deleted: number = await ServiceLevelObjectiveService.deleteOneById({
      id: OTHER_SLO_ID,
      props: projectAdminProps(),
    });

    expect(deleted).toBe(0);

    expect(events).toEqual([]);
    expect(alertTimelines).toEqual([]);
    expect(incidentTimelines).toEqual([]);
    expect(isOpen(alerts, OTHER_ALERT_ID)).toBe(true);
    expect(isOpen(incidents, OTHER_INCIDENT_ID)).toBe(true);
    expect(alertFindBySpy).not.toHaveBeenCalled();

    // The other project's SLO, and the rules under it, still exist.
    expect(sloRows).toHaveLength(2);
    expect(ruleRows).toHaveLength(3);

    const hookCall: [CarriedDelete, Array<ObjectID>] = deleteSuccessSpy.mock
      .calls[0] as [CarriedDelete, Array<ObjectID>];
    const onDelete: CarriedDelete = hookCall[0];
    const deletedIds: Array<ObjectID> = hookCall[1];

    expect(onDelete.carryForward!["itemsToDelete"]).toEqual([]);
    expect(onDelete.carryForward!["burnRateRules"]).toEqual([]);
    expect(deletedIds).toEqual([]);
  });

  test("the same admin deleting their own SLO resolves what each of its rules left open, after Postgres has cascaded the rules away", async () => {
    const deleted: number = await ServiceLevelObjectiveService.deleteOneById({
      id: SLO_ID,
      props: projectAdminProps(),
    });

    expect(deleted).toBe(1);

    // The rules are gone before anything is resolved: the resolve never needs them.
    expect(
      ruleRows.filter((rule: ServiceLevelObjectiveBurnRateRule): boolean => {
        return rule.serviceLevelObjectiveId!.toString() === SLO_ID.toString();
      }),
    ).toEqual([]);

    expect(events).toEqual([
      `delete slo ${SLO_ID.toString()}`,
      `resolve alert ${ALERT_ID.toString()}`,
      `resolve incident ${INCIDENT_ID.toString()}`,
      `resolve alert ${SECOND_ALERT_ID.toString()}`,
    ]);

    for (const timeline of [...alertTimelines, ...incidentTimelines]) {
      expect(timeline.rootCause).toBe(SLO_DISABLED_OR_DELETED_ROOT_CAUSE);
    }

    expect(isOpen(alerts, OTHER_ALERT_ID)).toBe(true);
    expect(isOpen(incidents, OTHER_INCIDENT_ID)).toBe(true);

    // There are no rule rows left to clear lifecycle columns on.
    expect(clearStateSpy).not.toHaveBeenCalled();

    expect(logger.error).not.toHaveBeenCalled();
  });

  test("an SLO delete that fails resolves nothing - the SLO still stands behind its records", async () => {
    repositoryFailure = new Error("connection reset");

    await expect(
      ServiceLevelObjectiveService.deleteOneById({
        id: SLO_ID,
        props: projectAdminProps(),
      }),
    ).rejects.toThrow();

    expect(events).toEqual([]);
    expect(alertTimelines).toEqual([]);
    expect(incidentTimelines).toEqual([]);
    expect(isOpen(alerts, ALERT_ID)).toBe(true);
    expect(isOpen(alerts, SECOND_ALERT_ID)).toBe(true);
    expect(isOpen(incidents, INCIDENT_ID)).toBe(true);
    expect(ruleRows).toHaveLength(3);
  });
});

describe("ServiceLevelObjectiveService.onDeleteSuccess", () => {
  let resolveSpy: jest.SpyInstance;

  beforeEach(() => {
    resolveSpy = jest
      .spyOn(
        ServiceLevelObjectiveBurnRateRuleService,
        "resolveOpenAlertsAndIncidentsForRule",
      )
      .mockResolvedValue(undefined);
  });

  test("resolves only the rules of SLOs the delete really removed, matching ids in any case", async () => {
    const onDelete: CarriedDelete = {
      deleteBy: { props: {} },
      carryForward: {
        itemsToDelete: [
          sloRow(SLO_ID, PROJECT_ID),
          sloRow(OTHER_SLO_ID, OTHER_PROJECT_ID),
        ],
        burnRateRules: [
          ruleRow(RULE_ID, SLO_ID, PROJECT_ID),
          ruleRow(OTHER_RULE_ID, OTHER_SLO_ID, OTHER_PROJECT_ID),
        ],
      },
    };

    await expect(
      callHook(ServiceLevelObjectiveService, "onDeleteSuccess", onDelete, [
        new ObjectID(SLO_ID.toString().toUpperCase()),
      ]),
    ).resolves.toBe(onDelete);

    expect(resolveSpy).toHaveBeenCalledTimes(1);

    const call: ResolveCall = resolveSpy.mock.calls[0]![0] as ResolveCall;

    expect(call.serviceLevelObjectiveId.toString()).toBe(SLO_ID.toString());
    expect(call.burnRateRuleId.toString()).toBe(RULE_ID.toString());
    expect(call.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(call.rootCause).toBe(SLO_DISABLED_OR_DELETED_ROOT_CAUSE);
  });

  test("skips an SLO row without a project, and a rule without an id", async () => {
    const withoutProject: ServiceLevelObjective = new ServiceLevelObjective(
      SLO_ID,
    );
    const ruleWithoutId: ServiceLevelObjectiveBurnRateRule =
      new ServiceLevelObjectiveBurnRateRule();
    ruleWithoutId.serviceLevelObjectiveId = OTHER_SLO_ID;
    ruleWithoutId.projectId = PROJECT_ID;

    await callHook(
      ServiceLevelObjectiveService,
      "onDeleteSuccess",
      {
        deleteBy: { props: {} },
        carryForward: {
          itemsToDelete: [withoutProject, sloRow(OTHER_SLO_ID, PROJECT_ID)],
          burnRateRules: [ruleRow(RULE_ID, SLO_ID, PROJECT_ID), ruleWithoutId],
        },
      },
      [SLO_ID, OTHER_SLO_ID],
    );

    expect(resolveSpy).not.toHaveBeenCalled();
  });

  /*
   * The rule-level resolve rethrows its first failure. By now the SLO is
   * gone, so failing the request would report an error for a delete that
   * happened - and giving up would strand the next rule's records.
   */
  test("a rule that will not resolve neither fails the request nor costs the next rule its resolve", async () => {
    resolveSpy
      .mockRejectedValueOnce(new Error("alert service down"))
      .mockResolvedValueOnce(undefined);

    const onDelete: CarriedDelete = {
      deleteBy: { props: {} },
      carryForward: {
        itemsToDelete: [sloRow(SLO_ID, PROJECT_ID)],
        burnRateRules: [
          ruleRow(RULE_ID, SLO_ID, PROJECT_ID),
          ruleRow(SECOND_RULE_ID, SLO_ID, PROJECT_ID),
        ],
      },
    };

    await expect(
      callHook(ServiceLevelObjectiveService, "onDeleteSuccess", onDelete, [
        SLO_ID,
      ]),
    ).resolves.toBe(onDelete);

    expect(resolveSpy).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  test("a delete that carried nothing forward resolves nothing", async () => {
    const onDelete: CarriedDelete = {
      deleteBy: { props: {} },
      carryForward: null,
    };

    await expect(
      callHook(ServiceLevelObjectiveService, "onDeleteSuccess", onDelete, [
        SLO_ID,
      ]),
    ).resolves.toBe(onDelete);

    expect(resolveSpy).not.toHaveBeenCalled();
  });
});

describe("ServiceLevelObjectiveBurnRateRuleService.onDeleteSuccess", () => {
  let resolveSpy: jest.SpyInstance;

  beforeEach(() => {
    resolveSpy = jest
      .spyOn(
        ServiceLevelObjectiveBurnRateRuleService,
        "resolveOpenAlertsAndIncidentsForRule",
      )
      .mockResolvedValue(undefined);
  });

  test("resolves only the rules the delete really removed, with the rule-deleted root cause", async () => {
    await callHook(
      ServiceLevelObjectiveBurnRateRuleService,
      "onDeleteSuccess",
      {
        deleteBy: { props: {} },
        carryForward: {
          itemsToDelete: [
            ruleRow(RULE_ID, SLO_ID, PROJECT_ID),
            ruleRow(OTHER_RULE_ID, OTHER_SLO_ID, OTHER_PROJECT_ID),
          ],
        },
      },
      [RULE_ID],
    );

    expect(resolveSpy).toHaveBeenCalledTimes(1);

    const call: ResolveCall = resolveSpy.mock.calls[0]![0] as ResolveCall;

    expect(call.serviceLevelObjectiveId.toString()).toBe(SLO_ID.toString());
    expect(call.burnRateRuleId.toString()).toBe(RULE_ID.toString());
    expect(call.projectId.toString()).toBe(PROJECT_ID.toString());
    expect(call.rootCause).toBe(RULE_DELETED_ROOT_CAUSE);
  });

  test("skips rows missing the project or SLO a fingerprint needs", async () => {
    const withoutProject: ServiceLevelObjectiveBurnRateRule =
      new ServiceLevelObjectiveBurnRateRule(RULE_ID);
    withoutProject.serviceLevelObjectiveId = SLO_ID;

    const withoutSlo: ServiceLevelObjectiveBurnRateRule =
      new ServiceLevelObjectiveBurnRateRule(SECOND_RULE_ID);
    withoutSlo.projectId = PROJECT_ID;

    await callHook(
      ServiceLevelObjectiveBurnRateRuleService,
      "onDeleteSuccess",
      {
        deleteBy: { props: {} },
        carryForward: { itemsToDelete: [withoutProject, withoutSlo] },
      },
      [RULE_ID, SECOND_RULE_ID],
    );

    expect(resolveSpy).not.toHaveBeenCalled();
  });

  test("a rule that will not resolve neither fails the request nor costs the next rule its resolve, and both are still described", async () => {
    resolveSpy
      .mockRejectedValueOnce(new Error("alert service down"))
      .mockResolvedValueOnce(undefined);

    const onDelete: CarriedDelete = {
      deleteBy: { props: {} },
      carryForward: {
        itemsToDelete: [
          ruleRow(RULE_ID, SLO_ID, PROJECT_ID),
          ruleRow(SECOND_RULE_ID, SLO_ID, PROJECT_ID),
        ],
      },
    };

    await expect(
      callHook(
        ServiceLevelObjectiveBurnRateRuleService,
        "onDeleteSuccess",
        onDelete,
        [RULE_ID, SECOND_RULE_ID],
      ),
    ).resolves.toBe(onDelete);

    expect(resolveSpy).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(feedWriterSpy).toHaveBeenCalledTimes(1);
    expect(
      (
        feedWriterSpy.mock.calls[0]![0] as {
          itemsToDelete: Array<unknown>;
        }
      ).itemsToDelete,
    ).toHaveLength(2);
  });
});
