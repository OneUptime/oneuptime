import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import { ServiceLevelObjectiveFeedEventType } from "../../../Models/DatabaseModels/ServiceLevelObjectiveFeed";
import ServiceLevelObjectiveMonitorRule from "../../../Models/DatabaseModels/ServiceLevelObjectiveMonitorRule";
import MonitorService from "../../../Server/Services/MonitorService";
import ServiceLevelObjectiveFeedService from "../../../Server/Services/ServiceLevelObjectiveFeedService";
import ServiceLevelObjectiveMonitorRuleEngineService, {
  SloMonitorSyncResult,
} from "../../../Server/Services/ServiceLevelObjectiveMonitorRuleEngineService";
import ServiceLevelObjectiveMonitorRuleService from "../../../Server/Services/ServiceLevelObjectiveMonitorRuleService";
import ServiceLevelObjectiveService from "../../../Server/Services/ServiceLevelObjectiveService";
import logger from "../../../Server/Utils/Logger";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import ObjectID from "../../../Types/ObjectID";
import RuleCriteria, {
  RULE_CRITERIA_LEGACY_NEVER_MATCH_PATTERN,
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaFilter,
  RuleCriteriaOperator,
} from "../../../Types/Rules/RuleCriteria";
import { MAX_RULES_EVALUATED_PER_PROJECT } from "../../../Utils/Rules/RuleEngineLimits";
import { describe, expect, it, beforeEach, afterEach } from "@jest/globals";

/*
 * Contract under test - SLO monitor rules.
 *
 * An SLO can carry any number of ServiceLevelObjectiveMonitorRule rows
 * ("every monitor labelled Production", "every monitor named api-*") instead
 * of naming monitors one by one. Membership is a UNION: a monitor belongs to
 * the SLO while at least one ENABLED rule of that SLO matches it. That promise
 * has two halves, and both have to hold or the SLO quietly measures the wrong
 * thing:
 *
 *   - a monitor that starts matching gets attached (whether a rule moved or
 *     the monitor did), and a monitor no enabled rule matches any more gets
 *     detached again;
 *
 *   - a monitor a human attached by hand is never touched. It is not adopted
 *     when it happens to match, and - the case that would actually lose
 *     someone's configuration - it is never detached when it stops matching,
 *     or when every rule is deleted outright.
 *
 * The second half is what ServiceLevelObjective.autoAddedMonitors exists for.
 * Every write is also told to the SLO's feed, without a user, because nobody
 * clicked anything - a rule reacted.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "23232323-2323-4323-8323-232323232323",
);
const SLO_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OTHER_SLO_ID: ObjectID = new ObjectID(
  "1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a",
);
const RULE_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const OTHER_RULE_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const MONITOR_A_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const MONITOR_B_ID: ObjectID = new ObjectID(
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
);
const MONITOR_C_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);
const LABEL_PRODUCTION_ID: ObjectID = new ObjectID(
  "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
);
const LABEL_TIER1_ID: ObjectID = new ObjectID(
  "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
);
const LABEL_STAGING_ID: ObjectID = new ObjectID(
  "ffffffff-ffff-4fff-8fff-ffffffffffff",
);

const SLO_LINK: string = "[SLO Checkout](https://oneuptime.test/slos/1)";

function fakeLabel(id: ObjectID): Label {
  return { id: id, _id: id.toString() } as unknown as Label;
}

function fakeMonitor(
  id: ObjectID,
  fields?: {
    name?: string | undefined;
    description?: string | undefined;
    labelIds?: Array<ObjectID> | undefined;
    projectId?: ObjectID | null | undefined;
  },
): Monitor {
  return {
    id: id,
    _id: id.toString(),
    projectId: fields?.projectId === undefined ? PROJECT_ID : fields.projectId,
    name: fields?.name === undefined ? `Monitor ${id.toString()}` : fields.name,
    description: fields?.description,
    labels: (fields?.labelIds || []).map(fakeLabel),
  } as unknown as Monitor;
}

function fakeSlo(fields: {
  id?: ObjectID | undefined;
  projectId?: ObjectID | null | undefined;
  monitors?: Array<ObjectID> | undefined;
  autoAddedMonitors?: Array<ObjectID> | undefined;
}): ServiceLevelObjective {
  const id: ObjectID = fields.id || SLO_ID;

  return {
    id: id,
    _id: id.toString(),
    name: "Checkout",
    projectId:
      fields.projectId === undefined ? PROJECT_ID : fields.projectId || null,
    monitors: (fields.monitors || []).map((monitorId: ObjectID) => {
      return fakeMonitor(monitorId);
    }),
    autoAddedMonitors: (fields.autoAddedMonitors || []).map(
      (monitorId: ObjectID) => {
        return fakeMonitor(monitorId);
      },
    ),
  } as unknown as ServiceLevelObjective;
}

function fakeRule(fields: {
  id?: ObjectID | undefined;
  serviceLevelObjectiveId?: ObjectID | undefined;
  labelIds?: Array<ObjectID> | undefined;
  monitorNamePattern?: string | undefined;
  monitorDescriptionPattern?: string | undefined;
  criteria?: RuleCriteria | null | undefined;
  isEnabled?: boolean | undefined;
}): ServiceLevelObjectiveMonitorRule {
  const id: ObjectID = fields.id || RULE_ID;

  return {
    id: id,
    _id: id.toString(),
    projectId: PROJECT_ID,
    serviceLevelObjectiveId: fields.serviceLevelObjectiveId || SLO_ID,
    isEnabled: fields.isEnabled === undefined ? true : fields.isEnabled,
    monitorLabels: (fields.labelIds || []).map(fakeLabel),
    monitorNamePattern: fields.monitorNamePattern,
    monitorDescriptionPattern: fields.monitorDescriptionPattern,
    criteria: fields.criteria,
  } as unknown as ServiceLevelObjectiveMonitorRule;
}

function criteria(
  filterCondition: FilterCondition,
  filters: Array<RuleCriteriaFilter>,
): RuleCriteria {
  return {
    schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
    filterCondition: filterCondition,
    filters: filters,
  };
}

/**
 * The ids the engine wrote to one of the two monitor relations, sorted so
 * assertions do not depend on Set iteration order.
 */
function writtenIds(
  updateOneByIdSpy: jest.SpyInstance,
  relation: "monitors" | "autoAddedMonitors",
  callIndex: number = 0,
): Array<string> {
  const call: { data: Record<string, Array<Monitor>> } = updateOneByIdSpy.mock
    .calls[callIndex]![0] as {
    data: Record<string, Array<Monitor>>;
  };

  return (call.data[relation] || [])
    .map((monitor: Monitor) => {
      return monitor.id?.toString() || "";
    })
    .sort();
}

function sortedIds(ids: Array<ObjectID>): Array<string> {
  return ids
    .map((id: ObjectID) => {
      return id.toString();
    })
    .sort();
}

interface FeedCall {
  serviceLevelObjectiveId: ObjectID;
  projectId: ObjectID;
  serviceLevelObjectiveFeedEventType: ServiceLevelObjectiveFeedEventType;
  feedInfoInMarkdown: string;
  moreInformationInMarkdown?: string | undefined;
  userId?: ObjectID | undefined;
}

function feedCalls(feedSpy: jest.SpyInstance): Array<FeedCall> {
  return feedSpy.mock.calls.map((call: Array<unknown>) => {
    return call[0] as FeedCall;
  });
}

interface SyncSpies {
  sloFindOneById: jest.SpyInstance;
  sloFindBy: jest.SpyInstance;
  sloUpdateOneById: jest.SpyInstance;
  ruleFindBy: jest.SpyInstance;
  monitorFindBy: jest.SpyInstance;
  monitorFindOneById: jest.SpyInstance;
  feed: jest.SpyInstance;
  markdownLink: jest.SpyInstance;
}

function installSpies(): SyncSpies {
  return {
    sloFindOneById: jest.spyOn(ServiceLevelObjectiveService, "findOneById"),
    sloFindBy: jest
      .spyOn(ServiceLevelObjectiveService, "findBy")
      .mockResolvedValue([]),
    sloUpdateOneById: jest
      .spyOn(ServiceLevelObjectiveService, "updateOneById")
      .mockResolvedValue(1),
    ruleFindBy: jest
      .spyOn(ServiceLevelObjectiveMonitorRuleService, "findBy")
      .mockResolvedValue([]),
    monitorFindBy: jest.spyOn(MonitorService, "findBy").mockResolvedValue([]),
    monitorFindOneById: jest.spyOn(MonitorService, "findOneById"),
    feed: jest
      .spyOn(
        ServiceLevelObjectiveFeedService,
        "createServiceLevelObjectiveFeedItem",
      )
      .mockResolvedValue(undefined),
    markdownLink: jest
      .spyOn(ServiceLevelObjectiveService, "getSloMarkdownLink")
      .mockResolvedValue(SLO_LINK),
  };
}

type SloFindByImplementation = (args: {
  query: Record<string, unknown>;
}) => Promise<Array<ServiceLevelObjective>>;

/*
 * syncSlosForMonitor asks ServiceLevelObjectiveService.findBy two different
 * questions - "which SLOs still record this monitor as rule-attached" (by
 * relation) and "give me these SLOs" (by id). Answer each separately.
 */
function answerSloReads(data: {
  holdingAutoAddedMonitor?: Array<ServiceLevelObjective> | undefined;
  byId: Array<ServiceLevelObjective>;
}): SloFindByImplementation {
  return (args: {
    query: Record<string, unknown>;
  }): Promise<Array<ServiceLevelObjective>> => {
    if (args.query["autoAddedMonitors"] !== undefined) {
      return Promise.resolve(data.holdingAutoAddedMonitor || []);
    }

    return Promise.resolve(data.byId);
  };
}

async function syncSlo(): Promise<SloMonitorSyncResult> {
  return await ServiceLevelObjectiveMonitorRuleEngineService.syncMonitorsForSlo(
    {
      serviceLevelObjectiveId: SLO_ID,
    },
  );
}

describe("ServiceLevelObjectiveMonitorRuleEngineService.syncMonitorsForSlo", () => {
  let spies: SyncSpies;

  beforeEach(() => {
    spies = installSpies();
    spies.sloFindOneById.mockResolvedValue(fakeSlo({}));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("attaches every monitor an enabled rule's labels match", async () => {
    spies.ruleFindBy.mockResolvedValue([
      fakeRule({ labelIds: [LABEL_PRODUCTION_ID] }),
    ]);
    spies.monitorFindBy.mockResolvedValue([
      fakeMonitor(MONITOR_A_ID, { labelIds: [LABEL_PRODUCTION_ID] }),
      fakeMonitor(MONITOR_B_ID, { labelIds: [LABEL_PRODUCTION_ID] }),
    ]);

    const result: SloMonitorSyncResult = await syncSlo();

    expect(spies.sloUpdateOneById).toHaveBeenCalledTimes(1);
    expect(
      (spies.sloUpdateOneById.mock.calls[0]![0] as { id: ObjectID }).id,
    ).toBe(SLO_ID);
    expect(writtenIds(spies.sloUpdateOneById, "monitors")).toEqual(
      sortedIds([MONITOR_A_ID, MONITOR_B_ID]),
    );
    expect(result.monitorIdsAdded.sort()).toEqual(
      sortedIds([MONITOR_A_ID, MONITOR_B_ID]),
    );
    expect(result.monitorIdsRemoved).toEqual([]);
  });

  it("records what it attached in autoAddedMonitors so it can undo it later", async () => {
    spies.ruleFindBy.mockResolvedValue([
      fakeRule({ labelIds: [LABEL_PRODUCTION_ID] }),
    ]);
    spies.monitorFindBy.mockResolvedValue([
      fakeMonitor(MONITOR_A_ID, { labelIds: [LABEL_PRODUCTION_ID] }),
    ]);

    await syncSlo();

    expect(writtenIds(spies.sloUpdateOneById, "autoAddedMonitors")).toEqual([
      MONITOR_A_ID.toString(),
    ]);
  });

  it("writes as root - rules are server-side and must never trip the manual-add guard", async () => {
    spies.ruleFindBy.mockResolvedValue([
      fakeRule({ labelIds: [LABEL_PRODUCTION_ID] }),
    ]);
    spies.monitorFindBy.mockResolvedValue([
      fakeMonitor(MONITOR_A_ID, { labelIds: [LABEL_PRODUCTION_ID] }),
    ]);

    await syncSlo();

    expect(
      (spies.sloUpdateOneById.mock.calls[0]![0] as { props: unknown }).props,
    ).toEqual({ isRoot: true });
  });

  it("reads only the SLO's enabled rules, pinned to its project, with criteria selected", async () => {
    await syncSlo();

    expect(spies.ruleFindBy).toHaveBeenCalledTimes(1);

    const call: {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      limit: number;
      skip: number;
      props: unknown;
    } = spies.ruleFindBy.mock.calls[0]![0] as {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      limit: number;
      skip: number;
      props: unknown;
    };

    expect(call.query).toEqual({
      projectId: PROJECT_ID,
      serviceLevelObjectiveId: SLO_ID,
      isEnabled: true,
    });
    expect(call.select["criteria"]).toBe(true);
    expect(call.select["monitorLabels"]).toEqual({ _id: true });
    expect(call.select["monitorNamePattern"]).toBe(true);
    expect(call.select["monitorDescriptionPattern"]).toBe(true);
    expect(call.limit).toBe(MAX_RULES_EVALUATED_PER_PROJECT);
    expect(call.skip).toBe(0);
    expect(call.props).toEqual({ isRoot: true });
  });

  it("keeps membership in sync whatever the SLO's own state - it reads the SLO by id alone", async () => {
    spies.ruleFindBy.mockResolvedValue([
      fakeRule({ monitorNamePattern: ".*" }),
    ]);
    spies.monitorFindBy.mockResolvedValue([fakeMonitor(MONITOR_A_ID)]);

    await syncSlo();

    const select: Record<string, unknown> = (
      spies.sloFindOneById.mock.calls[0]![0] as {
        select: Record<string, unknown>;
      }
    ).select;

    // Disabled and archived SLOs are skipped by the worker, never here.
    expect(select["isEnabled"]).toBeUndefined();
    expect(select["isArchived"]).toBeUndefined();
    expect(spies.sloUpdateOneById).toHaveBeenCalledTimes(1);
  });

  it("unions the matches of every enabled rule on the SLO", async () => {
    spies.ruleFindBy.mockResolvedValue([
      fakeRule({ id: RULE_ID, labelIds: [LABEL_PRODUCTION_ID] }),
      fakeRule({ id: OTHER_RULE_ID, monitorNamePattern: "^payments-" }),
    ]);
    spies.monitorFindBy.mockResolvedValue([
      fakeMonitor(MONITOR_A_ID, {
        name: "checkout-web",
        labelIds: [LABEL_PRODUCTION_ID],
      }),
      fakeMonitor(MONITOR_B_ID, { name: "payments-api" }),
      fakeMonitor(MONITOR_C_ID, {
        name: "search",
        labelIds: [LABEL_STAGING_ID],
      }),
    ]);

    await syncSlo();

    expect(writtenIds(spies.sloUpdateOneById, "monitors")).toEqual(
      sortedIds([MONITOR_A_ID, MONITOR_B_ID]),
    );
  });

  it("attaches a monitor two rules both match exactly once", async () => {
    spies.ruleFindBy.mockResolvedValue([
      fakeRule({ id: RULE_ID, labelIds: [LABEL_PRODUCTION_ID] }),
      fakeRule({ id: OTHER_RULE_ID, monitorNamePattern: "api" }),
    ]);
    spies.monitorFindBy.mockResolvedValue([
      fakeMonitor(MONITOR_A_ID, {
        name: "api",
        labelIds: [LABEL_PRODUCTION_ID],
      }),
    ]);

    const result: SloMonitorSyncResult = await syncSlo();

    expect(result.monitorIdsAdded).toEqual([MONITOR_A_ID.toString()]);
    expect(writtenIds(spies.sloUpdateOneById, "monitors")).toEqual([
      MONITOR_A_ID.toString(),
    ]);
  });

  it("matches a legacy rule's label criterion on ANY of its labels", async () => {
    spies.ruleFindBy.mockResolvedValue([
      fakeRule({ labelIds: [LABEL_PRODUCTION_ID, LABEL_TIER1_ID] }),
    ]);
    spies.monitorFindBy.mockResolvedValue([
      fakeMonitor(MONITOR_A_ID, { labelIds: [LABEL_TIER1_ID] }),
    ]);

    await syncSlo();

    expect(writtenIds(spies.sloUpdateOneById, "monitors")).toEqual([
      MONITOR_A_ID.toString(),
    ]);
  });

  it("ANDs a legacy rule's criteria: the label and the name pattern must both hold", async () => {
    spies.ruleFindBy.mockResolvedValue([
      fakeRule({
        labelIds: [LABEL_PRODUCTION_ID],
        monitorNamePattern: "^api-",
      }),
    ]);
    spies.monitorFindBy.mockResolvedValue([
      fakeMonitor(MONITOR_A_ID, {
        name: "api-gateway",
        labelIds: [LABEL_PRODUCTION_ID],
      }),
      fakeMonitor(MONITOR_B_ID, {
        name: "web",
        labelIds: [LABEL_PRODUCTION_ID],
      }),
    ]);

    await syncSlo();

    expect(writtenIds(spies.sloUpdateOneById, "monitors")).toEqual([
      MONITOR_A_ID.toString(),
    ]);
  });

  it("pushes the union of every rule's labels into the monitor query when all rules are legacy label rules", async () => {
    spies.ruleFindBy.mockResolvedValue([
      fakeRule({ id: RULE_ID, labelIds: [LABEL_PRODUCTION_ID] }),
      fakeRule({
        id: OTHER_RULE_ID,
        labelIds: [LABEL_TIER1_ID, LABEL_PRODUCTION_ID],
        monitorNamePattern: "^api-",
      }),
    ]);

    await syncSlo();

    const query: Record<string, unknown> = (
      spies.monitorFindBy.mock.calls[0]![0] as {
        query: Record<string, unknown>;
      }
    ).query;

    expect(query["projectId"]).toBe(PROJECT_ID);
    expect(sortedIds(query["labels"] as Array<ObjectID>)).toEqual(
      sortedIds([LABEL_PRODUCTION_ID, LABEL_TIER1_ID]),
    );
  });

  it("reads every project monitor when a rule could match a monitor with no labels", async () => {
    spies.ruleFindBy.mockResolvedValue([
      fakeRule({ id: RULE_ID, labelIds: [LABEL_PRODUCTION_ID] }),
      fakeRule({ id: OTHER_RULE_ID, monitorNamePattern: "^api-" }),
    ]);

    await syncSlo();

    const call: {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      props: unknown;
    } = spies.monitorFindBy.mock.calls[0]![0] as {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      props: unknown;
    };

    expect(call.query).toEqual({ projectId: PROJECT_ID });
    expect(call.select).toEqual({
      _id: true,
      name: true,
      description: true,
      labels: { _id: true },
    });
    expect(call.props).toEqual({ isRoot: true });
  });

  it("never pre-filters by label for a criteria rule, even one about labels", async () => {
    spies.ruleFindBy.mockResolvedValue([
      fakeRule({
        labelIds: [LABEL_PRODUCTION_ID],
        criteria: criteria(FilterCondition.All, [
          {
            field: "monitorLabels",
            operator: RuleCriteriaOperator.HasNoneOf,
            value: [LABEL_STAGING_ID.toString()],
          },
        ]),
      }),
    ]);

    await syncSlo();

    expect(
      (
        spies.monitorFindBy.mock.calls[0]![0] as {
          query: Record<string, unknown>;
        }
      ).query,
    ).toEqual({ projectId: PROJECT_ID });
  });

  it("gives back every rule-attached monitor once no enabled rule is left, and keeps the manual ones", async () => {
    spies.sloFindOneById.mockResolvedValue(
      fakeSlo({
        monitors: [MONITOR_A_ID, MONITOR_B_ID, MONITOR_C_ID],
        autoAddedMonitors: [MONITOR_A_ID, MONITOR_B_ID],
      }),
    );
    spies.ruleFindBy.mockResolvedValue([]);

    const result: SloMonitorSyncResult = await syncSlo();

    // Nothing can match, so there is no reason to read the project's monitors.
    expect(
      spies.monitorFindBy.mock.calls.filter((call: Array<unknown>) => {
        return (
          (call[0] as { select: Record<string, unknown> }).select[
            "description"
          ] === true
        );
      }),
    ).toHaveLength(0);
    expect(writtenIds(spies.sloUpdateOneById, "monitors")).toEqual([
      MONITOR_C_ID.toString(),
    ]);
    expect(writtenIds(spies.sloUpdateOneById, "autoAddedMonitors")).toEqual([]);
    expect(result.monitorIdsRemoved.sort()).toEqual(
      sortedIds([MONITOR_A_ID, MONITOR_B_ID]),
    );
  });

  it("matches nothing for an enabled rule with no criteria at all", async () => {
    spies.sloFindOneById.mockResolvedValue(
      fakeSlo({
        monitors: [MONITOR_A_ID],
        autoAddedMonitors: [MONITOR_A_ID],
      }),
    );
    spies.ruleFindBy.mockResolvedValue([fakeRule({})]);

    await syncSlo();

    expect(spies.monitorFindBy).not.toHaveBeenCalledWith(
      expect.objectContaining({ query: { projectId: PROJECT_ID } }),
    );
    expect(writtenIds(spies.sloUpdateOneById, "monitors")).toEqual([]);
  });

  it("leaves a hand-attached monitor out of autoAddedMonitors even when a rule matches it", async () => {
    spies.sloFindOneById.mockResolvedValue(
      fakeSlo({ monitors: [MONITOR_A_ID] }),
    );
    spies.ruleFindBy.mockResolvedValue([
      fakeRule({ labelIds: [LABEL_PRODUCTION_ID] }),
    ]);
    spies.monitorFindBy.mockResolvedValue([
      fakeMonitor(MONITOR_A_ID, { labelIds: [LABEL_PRODUCTION_ID] }),
      fakeMonitor(MONITOR_B_ID, { labelIds: [LABEL_PRODUCTION_ID] }),
    ]);

    const result: SloMonitorSyncResult = await syncSlo();

    expect(writtenIds(spies.sloUpdateOneById, "autoAddedMonitors")).toEqual([
      MONITOR_B_ID.toString(),
    ]);
    expect(result.monitorIdsAdded).toEqual([MONITOR_B_ID.toString()]);
  });

  it("detaches a monitor a rule attached once no rule matches it", async () => {
    spies.sloFindOneById.mockResolvedValue(
      fakeSlo({
        monitors: [MONITOR_A_ID, MONITOR_B_ID],
        autoAddedMonitors: [MONITOR_A_ID, MONITOR_B_ID],
      }),
    );
    spies.ruleFindBy.mockResolvedValue([
      fakeRule({ labelIds: [LABEL_PRODUCTION_ID] }),
    ]);
    spies.monitorFindBy.mockResolvedValue([
      fakeMonitor(MONITOR_A_ID, { labelIds: [LABEL_PRODUCTION_ID] }),
    ]);

    const result: SloMonitorSyncResult = await syncSlo();

    expect(writtenIds(spies.sloUpdateOneById, "monitors")).toEqual([
      MONITOR_A_ID.toString(),
    ]);
    expect(result.monitorIdsRemoved).toEqual([MONITOR_B_ID.toString()]);
  });

  it("never detaches a hand-attached monitor, however badly it fails every rule", async () => {
    spies.sloFindOneById.mockResolvedValue(
      fakeSlo({
        monitors: [MONITOR_A_ID, MONITOR_B_ID],
        autoAddedMonitors: [MONITOR_A_ID],
      }),
    );
    spies.ruleFindBy.mockResolvedValue([
      fakeRule({ monitorNamePattern: "^nothing-matches$" }),
    ]);
    spies.monitorFindBy.mockResolvedValue([
      fakeMonitor(MONITOR_A_ID),
      fakeMonitor(MONITOR_B_ID),
    ]);

    await syncSlo();

    expect(writtenIds(spies.sloUpdateOneById, "monitors")).toEqual([
      MONITOR_B_ID.toString(),
    ]);
  });

  it("writes nothing when the rules already agree with the SLO", async () => {
    spies.sloFindOneById.mockResolvedValue(
      fakeSlo({
        monitors: [MONITOR_A_ID, MONITOR_B_ID],
        autoAddedMonitors: [MONITOR_A_ID],
      }),
    );
    spies.ruleFindBy.mockResolvedValue([
      fakeRule({ labelIds: [LABEL_PRODUCTION_ID] }),
    ]);
    spies.monitorFindBy.mockResolvedValue([
      fakeMonitor(MONITOR_A_ID, { labelIds: [LABEL_PRODUCTION_ID] }),
    ]);

    const result: SloMonitorSyncResult = await syncSlo();

    expect(spies.sloUpdateOneById).not.toHaveBeenCalled();
    expect(spies.feed).not.toHaveBeenCalled();
    expect(result).toEqual({ monitorIdsAdded: [], monitorIdsRemoved: [] });
  });

  it("re-attaches a monitor that is recorded as rule-attached but has gone missing from the list", async () => {
    spies.sloFindOneById.mockResolvedValue(
      fakeSlo({ monitors: [], autoAddedMonitors: [MONITOR_A_ID] }),
    );
    spies.ruleFindBy.mockResolvedValue([
      fakeRule({ labelIds: [LABEL_PRODUCTION_ID] }),
    ]);
    spies.monitorFindBy.mockResolvedValue([
      fakeMonitor(MONITOR_A_ID, { labelIds: [LABEL_PRODUCTION_ID] }),
    ]);

    await syncSlo();

    expect(writtenIds(spies.sloUpdateOneById, "monitors")).toEqual([
      MONITOR_A_ID.toString(),
    ]);
  });

  it("does nothing for an SLO it cannot read", async () => {
    spies.sloFindOneById.mockResolvedValue(null);

    await expect(syncSlo()).resolves.toEqual({
      monitorIdsAdded: [],
      monitorIdsRemoved: [],
    });
    expect(spies.ruleFindBy).not.toHaveBeenCalled();
    expect(spies.sloUpdateOneById).not.toHaveBeenCalled();
  });

  it("does nothing for an SLO with no project - there is no tenant to scope the lookups to", async () => {
    spies.sloFindOneById.mockResolvedValue(fakeSlo({ projectId: null }));

    await syncSlo();

    expect(spies.ruleFindBy).not.toHaveBeenCalled();
    expect(spies.monitorFindBy).not.toHaveBeenCalled();
  });

  it("says so when the rule read hits the per-project ceiling", async () => {
    const errorSpy: jest.SpyInstance = jest
      .spyOn(logger, "error")
      .mockImplementation(() => {
        return undefined as never;
      });

    spies.ruleFindBy.mockResolvedValue(
      Array.from({ length: MAX_RULES_EVALUATED_PER_PROJECT }, () => {
        return fakeRule({});
      }),
    );

    await syncSlo();

    const messages: Array<string> = errorSpy.mock.calls.map(
      (call: Array<unknown>) => {
        return String(call[0]);
      },
    );

    expect(
      messages.some((message: string) => {
        return message.includes("ServiceLevelObjectiveMonitorRule");
      }),
    ).toBe(true);
  });
});

describe("ServiceLevelObjectiveMonitorRuleEngineService - membership feed items", () => {
  let spies: SyncSpies;

  beforeEach(() => {
    spies = installSpies();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("posts MonitorsAttached naming the monitor, with no acting user", async () => {
    spies.sloFindOneById.mockResolvedValue(fakeSlo({}));
    spies.ruleFindBy.mockResolvedValue([
      fakeRule({ monitorNamePattern: "api" }),
    ]);
    spies.monitorFindBy.mockResolvedValue([
      fakeMonitor(MONITOR_A_ID, { name: "API Gateway" }),
    ]);

    await syncSlo();

    const calls: Array<FeedCall> = feedCalls(spies.feed);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.serviceLevelObjectiveFeedEventType).toBe(
      ServiceLevelObjectiveFeedEventType.MonitorsAttached,
    );
    expect(calls[0]!.serviceLevelObjectiveId).toBe(SLO_ID);
    expect(calls[0]!.projectId).toBe(PROJECT_ID);
    expect(calls[0]!.userId).toBeUndefined();
    expect(calls[0]!.feedInfoInMarkdown).toContain("**API Gateway**");
    expect(calls[0]!.feedInfoInMarkdown).toContain(SLO_LINK);
    // A single monitor is fully described by the sentence.
    expect(calls[0]!.moreInformationInMarkdown).toBeUndefined();
    expect(spies.markdownLink).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      sloId: SLO_ID,
      sloName: "Checkout",
    });
  });

  it("posts MonitorsDetached for monitors the rules let go, looking up names it does not hold", async () => {
    spies.sloFindOneById.mockResolvedValue(
      fakeSlo({
        monitors: [MONITOR_A_ID, MONITOR_B_ID],
        autoAddedMonitors: [MONITOR_A_ID, MONITOR_B_ID],
      }),
    );
    spies.ruleFindBy.mockResolvedValue([]);
    spies.monitorFindBy.mockResolvedValue([
      fakeMonitor(MONITOR_A_ID, { name: "Checkout API" }),
      fakeMonitor(MONITOR_B_ID, { name: "Cart API" }),
    ]);

    await syncSlo();

    const calls: Array<FeedCall> = feedCalls(spies.feed);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.serviceLevelObjectiveFeedEventType).toBe(
      ServiceLevelObjectiveFeedEventType.MonitorsDetached,
    );
    expect(calls[0]!.feedInfoInMarkdown).toContain("detached 2 monitors");
    // Sorted by name so the same set always reads the same way.
    expect(calls[0]!.feedInfoInMarkdown).toContain(
      "**Cart API** and **Checkout API**",
    );

    const nameLookup: { query: Record<string, unknown>; props: unknown } = spies
      .monitorFindBy.mock.calls[0]![0] as {
      query: Record<string, unknown>;
      props: unknown;
    };

    expect(JSON.stringify(nameLookup.query["_id"])).toContain(
      MONITOR_A_ID.toString(),
    );
    expect(nameLookup.props).toEqual({ isRoot: true });
  });

  it("posts both items when one sync attaches and detaches", async () => {
    spies.sloFindOneById.mockResolvedValue(
      fakeSlo({
        monitors: [MONITOR_A_ID],
        autoAddedMonitors: [MONITOR_A_ID],
      }),
    );
    spies.ruleFindBy.mockResolvedValue([
      fakeRule({ monitorNamePattern: "^new-" }),
    ]);
    spies.monitorFindBy.mockImplementation(((args: {
      select: Record<string, unknown>;
    }): Promise<Array<Monitor>> => {
      if (args.select["description"]) {
        return Promise.resolve([
          fakeMonitor(MONITOR_A_ID, { name: "old-api" }),
          fakeMonitor(MONITOR_B_ID, { name: "new-api" }),
        ]);
      }

      return Promise.resolve([fakeMonitor(MONITOR_A_ID, { name: "old-api" })]);
    }) as never);

    await syncSlo();

    expect(
      feedCalls(spies.feed).map((call: FeedCall) => {
        return call.serviceLevelObjectiveFeedEventType;
      }),
    ).toEqual([
      ServiceLevelObjectiveFeedEventType.MonitorsAttached,
      ServiceLevelObjectiveFeedEventType.MonitorsDetached,
    ]);
  });

  it("escapes monitor names so a name cannot rewrite the markdown around it", async () => {
    spies.sloFindOneById.mockResolvedValue(fakeSlo({}));
    spies.ruleFindBy.mockResolvedValue([
      fakeRule({ monitorNamePattern: ".*" }),
    ]);
    spies.monitorFindBy.mockResolvedValue([
      fakeMonitor(MONITOR_A_ID, { name: "x](https://evil.test) ![p](y)" }),
    ]);

    await syncSlo();

    const text: string = feedCalls(spies.feed)[0]!.feedInfoInMarkdown;

    expect(text).toContain("x\\]\\(https://evil.test\\) \\!\\[p\\]\\(y\\)");
    expect(text).not.toContain("](https://evil.test)");
  });

  it("names a handful in the sentence and lists a bounded page in more information", async () => {
    const monitors: Array<Monitor> = Array.from(
      { length: 60 },
      (_value: unknown, index: number) => {
        const suffix: string = index.toString().padStart(12, "0");

        return fakeMonitor(new ObjectID(`abababab-abab-4bab-8bab-${suffix}`), {
          name: `monitor-${index.toString().padStart(2, "0")}`,
        });
      },
    );

    spies.sloFindOneById.mockResolvedValue(fakeSlo({}));
    spies.ruleFindBy.mockResolvedValue([
      fakeRule({ monitorNamePattern: "^monitor-" }),
    ]);
    spies.monitorFindBy.mockResolvedValue(monitors);

    await syncSlo();

    const call: FeedCall = feedCalls(spies.feed)[0]!;

    expect(call.feedInfoInMarkdown).toContain("attached 60 monitors");
    expect(call.feedInfoInMarkdown).toContain("and 55 more");
    expect(call.feedInfoInMarkdown).toContain("**monitor\\-00**");

    const bullets: Array<string> = (call.moreInformationInMarkdown || "")
      .split("\n")
      .filter((line: string) => {
        return line.startsWith("- ");
      });

    expect(call.moreInformationInMarkdown).toContain(
      "**Monitors attached (60)**",
    );
    // 50 named, then one line counting the rest.
    expect(bullets).toHaveLength(51);
    expect(bullets[bullets.length - 1]).toBe("- …and 10 more not listed here.");
  });

  it("does not report a stale bookkeeping entry as a detached monitor", async () => {
    spies.sloFindOneById.mockResolvedValue(
      fakeSlo({ monitors: [], autoAddedMonitors: [MONITOR_A_ID] }),
    );
    spies.ruleFindBy.mockResolvedValue([]);

    await syncSlo();

    // The bookkeeping is repaired...
    expect(spies.sloUpdateOneById).toHaveBeenCalledTimes(1);
    // ...but nothing a reader could see was detached.
    expect(spies.feed).not.toHaveBeenCalled();
  });

  it("never lets a failed feed post fail the sync that already saved", async () => {
    spies.sloFindOneById.mockResolvedValue(fakeSlo({}));
    spies.ruleFindBy.mockResolvedValue([
      fakeRule({ monitorNamePattern: ".*" }),
    ]);
    spies.monitorFindBy.mockResolvedValue([fakeMonitor(MONITOR_A_ID)]);
    spies.markdownLink.mockRejectedValue(new Error("config down"));
    jest.spyOn(logger, "error").mockImplementation(() => {
      return undefined as never;
    });

    await expect(syncSlo()).resolves.toEqual({
      monitorIdsAdded: [MONITOR_A_ID.toString()],
      monitorIdsRemoved: [],
    });
  });
});

describe("ServiceLevelObjectiveMonitorRuleEngineService.syncSlosForMonitor", () => {
  let spies: SyncSpies;

  beforeEach(() => {
    spies = installSpies();
    spies.monitorFindOneById.mockResolvedValue(
      fakeMonitor(MONITOR_A_ID, {
        name: "api-gateway",
        labelIds: [LABEL_PRODUCTION_ID],
      }),
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function syncMonitor(
    projectId?: ObjectID | undefined,
  ): Promise<Array<SloMonitorSyncResult>> {
    return await ServiceLevelObjectiveMonitorRuleEngineService.syncSlosForMonitor(
      {
        monitorId: MONITOR_A_ID,
        projectId: projectId,
      },
    );
  }

  it("attaches the monitor to an SLO whose enabled rule its labels satisfy", async () => {
    spies.ruleFindBy.mockResolvedValue([
      fakeRule({ labelIds: [LABEL_PRODUCTION_ID] }),
    ]);
    spies.sloFindBy.mockImplementation(
      answerSloReads({ byId: [fakeSlo({})] }) as never,
    );

    const results: Array<SloMonitorSyncResult> = await syncMonitor();

    expect(writtenIds(spies.sloUpdateOneById, "monitors")).toEqual([
      MONITOR_A_ID.toString(),
    ]);
    expect(writtenIds(spies.sloUpdateOneById, "autoAddedMonitors")).toEqual([
      MONITOR_A_ID.toString(),
    ]);
    expect(results).toHaveLength(1);
  });

  it("attaches on a name match too - a rename can pull a monitor in", async () => {
    spies.ruleFindBy.mockResolvedValue([
      fakeRule({ monitorNamePattern: "*gateway*" }),
    ]);
    spies.sloFindBy.mockImplementation(
      answerSloReads({ byId: [fakeSlo({})] }) as never,
    );

    await syncMonitor();

    expect(writtenIds(spies.sloUpdateOneById, "monitors")).toEqual([
      MONITOR_A_ID.toString(),
    ]);
  });

  it("detaches the monitor once no enabled rule of the SLO matches it", async () => {
    spies.monitorFindOneById.mockResolvedValue(
      fakeMonitor(MONITOR_A_ID, { name: "renamed", labelIds: [] }),
    );
    spies.ruleFindBy.mockResolvedValue([
      fakeRule({ labelIds: [LABEL_PRODUCTION_ID] }),
    ]);
    spies.sloFindBy.mockImplementation(
      answerSloReads({
        byId: [
          fakeSlo({
            monitors: [MONITOR_A_ID],
            autoAddedMonitors: [MONITOR_A_ID],
          }),
        ],
      }) as never,
    );

    await syncMonitor();

    expect(writtenIds(spies.sloUpdateOneById, "monitors")).toEqual([]);
    expect(writtenIds(spies.sloUpdateOneById, "autoAddedMonitors")).toEqual([]);
  });

  it("keeps the monitor while another rule of the same SLO still matches it", async () => {
    spies.ruleFindBy.mockResolvedValue([
      fakeRule({ id: RULE_ID, labelIds: [LABEL_STAGING_ID] }),
      fakeRule({ id: OTHER_RULE_ID, monitorNamePattern: "^api-" }),
    ]);
    spies.sloFindBy.mockImplementation(
      answerSloReads({
        byId: [
          fakeSlo({
            monitors: [MONITOR_A_ID],
            autoAddedMonitors: [MONITOR_A_ID],
          }),
        ],
      }) as never,
    );

    const results: Array<SloMonitorSyncResult> = await syncMonitor();

    expect(spies.sloUpdateOneById).not.toHaveBeenCalled();
    expect(results).toEqual([]);
  });

  it("leaves the other monitors an SLO's rules attached exactly where they are", async () => {
    spies.monitorFindOneById.mockResolvedValue(
      fakeMonitor(MONITOR_A_ID, { name: "renamed", labelIds: [] }),
    );
    spies.ruleFindBy.mockResolvedValue([
      fakeRule({ labelIds: [LABEL_PRODUCTION_ID] }),
    ]);
    spies.sloFindBy.mockImplementation(
      answerSloReads({
        byId: [
          fakeSlo({
            monitors: [MONITOR_A_ID, MONITOR_B_ID],
            autoAddedMonitors: [MONITOR_A_ID, MONITOR_B_ID],
          }),
        ],
      }) as never,
    );

    await syncMonitor();

    expect(writtenIds(spies.sloUpdateOneById, "monitors")).toEqual([
      MONITOR_B_ID.toString(),
    ]);
    expect(writtenIds(spies.sloUpdateOneById, "autoAddedMonitors")).toEqual([
      MONITOR_B_ID.toString(),
    ]);
  });

  it("releases the monitor from an SLO with no enabled rule left that still records it", async () => {
    spies.ruleFindBy.mockResolvedValue([]);
    spies.sloFindBy.mockImplementation(
      answerSloReads({
        holdingAutoAddedMonitor: [fakeSlo({ id: OTHER_SLO_ID })],
        byId: [
          fakeSlo({
            id: OTHER_SLO_ID,
            monitors: [MONITOR_A_ID],
            autoAddedMonitors: [MONITOR_A_ID],
          }),
        ],
      }) as never,
    );

    await syncMonitor();

    const holderLookup: { query: Record<string, unknown>; select: unknown } =
      spies.sloFindBy.mock.calls[0]![0] as {
        query: Record<string, unknown>;
        select: unknown;
      };

    expect(holderLookup.query["projectId"]).toBe(PROJECT_ID);
    expect(holderLookup.query["autoAddedMonitors"]).toEqual([MONITOR_A_ID]);
    // Ids only: a relation filter can narrow the relation rows it returns.
    expect(holderLookup.select).toEqual({ _id: true });
    expect(writtenIds(spies.sloUpdateOneById, "monitors")).toEqual([]);
  });

  it("never touches an SLO with no enabled rule that does not hold the monitor", async () => {
    spies.ruleFindBy.mockResolvedValue([]);
    spies.sloFindBy.mockImplementation(answerSloReads({ byId: [] }) as never);

    const results: Array<SloMonitorSyncResult> = await syncMonitor();

    // Only the holder lookup - with no candidates, no SLO is read at all.
    expect(spies.sloFindBy).toHaveBeenCalledTimes(1);
    expect(spies.sloUpdateOneById).not.toHaveBeenCalled();
    expect(results).toEqual([]);
  });

  it("reads the candidate SLOs by id, pinned to the monitor's project", async () => {
    spies.ruleFindBy.mockResolvedValue([
      fakeRule({ serviceLevelObjectiveId: SLO_ID, labelIds: [LABEL_TIER1_ID] }),
      fakeRule({
        id: OTHER_RULE_ID,
        serviceLevelObjectiveId: OTHER_SLO_ID,
        labelIds: [LABEL_TIER1_ID],
      }),
    ]);
    spies.sloFindBy.mockImplementation(answerSloReads({ byId: [] }) as never);

    await syncMonitor();

    const read: { query: Record<string, unknown>; props: unknown } = spies
      .sloFindBy.mock.calls[1]![0] as {
      query: Record<string, unknown>;
      props: unknown;
    };

    expect(read.query["projectId"]).toBe(PROJECT_ID);
    expect(JSON.stringify(read.query["_id"])).toContain(SLO_ID.toString());
    expect(JSON.stringify(read.query["_id"])).toContain(
      OTHER_SLO_ID.toString(),
    );
    expect(read.props).toEqual({ isRoot: true });
  });

  it("does not detach a monitor a human attached to a rule-driven SLO", async () => {
    spies.monitorFindOneById.mockResolvedValue(
      fakeMonitor(MONITOR_A_ID, { name: "renamed", labelIds: [] }),
    );
    spies.ruleFindBy.mockResolvedValue([
      fakeRule({ labelIds: [LABEL_PRODUCTION_ID] }),
    ]);
    spies.sloFindBy.mockImplementation(
      answerSloReads({
        byId: [fakeSlo({ monitors: [MONITOR_A_ID], autoAddedMonitors: [] })],
      }) as never,
    );

    await syncMonitor();

    expect(spies.sloUpdateOneById).not.toHaveBeenCalled();
  });

  it("does not adopt a hand-attached monitor into the rules when it starts matching", async () => {
    spies.ruleFindBy.mockResolvedValue([
      fakeRule({ labelIds: [LABEL_PRODUCTION_ID] }),
    ]);
    spies.sloFindBy.mockImplementation(
      answerSloReads({
        byId: [fakeSlo({ monitors: [MONITOR_A_ID], autoAddedMonitors: [] })],
      }) as never,
    );

    await syncMonitor();

    expect(spies.sloUpdateOneById).not.toHaveBeenCalled();
  });

  it("applies the rules of every SLO in the project, not just the first that matches", async () => {
    spies.ruleFindBy.mockResolvedValue([
      fakeRule({
        serviceLevelObjectiveId: SLO_ID,
        labelIds: [LABEL_PRODUCTION_ID],
      }),
      fakeRule({
        id: OTHER_RULE_ID,
        serviceLevelObjectiveId: OTHER_SLO_ID,
        monitorNamePattern: "^api-",
      }),
    ]);
    spies.sloFindBy.mockImplementation(
      answerSloReads({
        byId: [fakeSlo({ id: SLO_ID }), fakeSlo({ id: OTHER_SLO_ID })],
      }) as never,
    );

    const results: Array<SloMonitorSyncResult> = await syncMonitor();

    expect(spies.sloUpdateOneById).toHaveBeenCalledTimes(2);
    expect(results).toHaveLength(2);
  });

  it("an SLO's rules decide only that SLO - another SLO's rule never attaches to it", async () => {
    spies.ruleFindBy.mockResolvedValue([
      fakeRule({
        serviceLevelObjectiveId: OTHER_SLO_ID,
        labelIds: [LABEL_PRODUCTION_ID],
      }),
    ]);
    spies.sloFindBy.mockImplementation(
      answerSloReads({
        byId: [fakeSlo({ id: SLO_ID }), fakeSlo({ id: OTHER_SLO_ID })],
      }) as never,
    );

    await syncMonitor();

    expect(spies.sloUpdateOneById).toHaveBeenCalledTimes(1);
    expect(
      (spies.sloUpdateOneById.mock.calls[0]![0] as { id: ObjectID }).id,
    ).toBe(OTHER_SLO_ID);
  });

  it("carries on with the remaining SLOs when one of them fails to write", async () => {
    jest.spyOn(logger, "error").mockImplementation(() => {
      return undefined as never;
    });
    spies.ruleFindBy.mockResolvedValue([
      fakeRule({
        serviceLevelObjectiveId: SLO_ID,
        labelIds: [LABEL_PRODUCTION_ID],
      }),
      fakeRule({
        id: OTHER_RULE_ID,
        serviceLevelObjectiveId: OTHER_SLO_ID,
        labelIds: [LABEL_PRODUCTION_ID],
      }),
    ]);
    spies.sloFindBy.mockImplementation(
      answerSloReads({
        byId: [fakeSlo({ id: SLO_ID }), fakeSlo({ id: OTHER_SLO_ID })],
      }) as never,
    );
    spies.sloUpdateOneById
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValueOnce(1);

    const results: Array<SloMonitorSyncResult> = await syncMonitor();

    expect(spies.sloUpdateOneById).toHaveBeenCalledTimes(2);
    expect(results).toHaveLength(1);
  });

  it("reads the project's enabled rules once, as root, with criteria selected", async () => {
    await syncMonitor();

    expect(spies.ruleFindBy).toHaveBeenCalledTimes(1);

    const call: {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      limit: number;
      props: unknown;
    } = spies.ruleFindBy.mock.calls[0]![0] as {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      limit: number;
      props: unknown;
    };

    expect(call.query).toEqual({ projectId: PROJECT_ID, isEnabled: true });
    expect(call.select["criteria"]).toBe(true);
    expect(call.limit).toBe(MAX_RULES_EVALUATED_PER_PROJECT);
    expect(call.props).toEqual({ isRoot: true });
  });

  it("reads the monitor's name and description, not only its labels", async () => {
    await syncMonitor();

    expect(
      (
        spies.monitorFindOneById.mock.calls[0]![0] as {
          select: Record<string, unknown>;
        }
      ).select,
    ).toEqual({
      _id: true,
      projectId: true,
      name: true,
      description: true,
      labels: { _id: true },
    });
  });

  it("falls back to the caller's project when the monitor row does not carry one", async () => {
    spies.monitorFindOneById.mockResolvedValue(
      fakeMonitor(MONITOR_A_ID, { projectId: null }),
    );

    await syncMonitor(OTHER_PROJECT_ID);

    expect(
      (
        spies.ruleFindBy.mock.calls[0]![0] as {
          query: Record<string, unknown>;
        }
      ).query["projectId"],
    ).toBe(OTHER_PROJECT_ID);
  });

  it("does nothing for a monitor that no longer exists", async () => {
    spies.monitorFindOneById.mockResolvedValue(null);

    await expect(syncMonitor()).resolves.toEqual([]);
    expect(spies.ruleFindBy).not.toHaveBeenCalled();
  });

  it("does nothing when no project can be determined at all", async () => {
    spies.monitorFindOneById.mockResolvedValue(
      fakeMonitor(MONITOR_A_ID, { projectId: null }),
    );

    await expect(syncMonitor()).resolves.toEqual([]);
    expect(spies.ruleFindBy).not.toHaveBeenCalled();
  });
});

describe("ServiceLevelObjectiveMonitorRuleEngineService.doesMonitorMatchRule", () => {
  const monitor: Monitor = fakeMonitor(MONITOR_A_ID, {
    name: "API-Gateway-Prod",
    description: "Customer facing tier-1 edge",
    labelIds: [LABEL_PRODUCTION_ID, LABEL_TIER1_ID],
  });

  const cases: Array<{
    label: string;
    rule: ServiceLevelObjectiveMonitorRule;
    expected: boolean;
  }> = [
    {
      label: "a rule with no criteria matches nothing",
      rule: fakeRule({}),
      expected: false,
    },
    {
      label: "a name regex matches case-insensitively",
      rule: fakeRule({ monitorNamePattern: "^api-gateway" }),
      expected: true,
    },
    {
      label: "a * glob matches (#2940), it is not silently an invalid regex",
      rule: fakeRule({ monitorNamePattern: "*gateway*" }),
      expected: true,
    },
    {
      label: "a description pattern matches the description",
      rule: fakeRule({ monitorDescriptionPattern: "tier-1" }),
      expected: true,
    },
    {
      label: "a description pattern that does not match fails the rule",
      rule: fakeRule({ monitorDescriptionPattern: "internal only" }),
      expected: false,
    },
    {
      label: "labels match on any of the rule's labels",
      rule: fakeRule({ labelIds: [LABEL_STAGING_ID, LABEL_TIER1_ID] }),
      expected: true,
    },
    {
      label: "labels the monitor does not carry fail the rule",
      rule: fakeRule({ labelIds: [LABEL_STAGING_ID] }),
      expected: false,
    },
    {
      label: "legacy criteria AND together",
      rule: fakeRule({
        labelIds: [LABEL_PRODUCTION_ID],
        monitorNamePattern: "^web-",
      }),
      expected: false,
    },
    {
      label: "criteria All needs every filter",
      rule: fakeRule({
        criteria: criteria(FilterCondition.All, [
          {
            field: "monitorNamePattern",
            operator: RuleCriteriaOperator.StartsWith,
            value: "api",
          },
          {
            field: "monitorDescriptionPattern",
            operator: RuleCriteriaOperator.Contains,
            value: "internal",
          },
        ]),
      }),
      expected: false,
    },
    {
      label: "criteria Any needs one filter",
      rule: fakeRule({
        criteria: criteria(FilterCondition.Any, [
          {
            field: "monitorNamePattern",
            operator: RuleCriteriaOperator.StartsWith,
            value: "web",
          },
          {
            field: "monitorDescriptionPattern",
            operator: RuleCriteriaOperator.Contains,
            value: "customer facing",
          },
        ]),
      }),
      expected: true,
    },
    {
      label: "criteria HasAnyOf matches a carried label",
      rule: fakeRule({
        criteria: criteria(FilterCondition.All, [
          {
            field: "monitorLabels",
            operator: RuleCriteriaOperator.HasAnyOf,
            value: [LABEL_STAGING_ID.toString(), LABEL_TIER1_ID.toString()],
          },
        ]),
      }),
      expected: true,
    },
    {
      label: "criteria HasAllOf needs every label",
      rule: fakeRule({
        criteria: criteria(FilterCondition.All, [
          {
            field: "monitorLabels",
            operator: RuleCriteriaOperator.HasAllOf,
            value: [
              LABEL_PRODUCTION_ID.toString(),
              LABEL_STAGING_ID.toString(),
            ],
          },
        ]),
      }),
      expected: false,
    },
    {
      label: "criteria HasNoneOf excludes a labelled monitor",
      rule: fakeRule({
        criteria: criteria(FilterCondition.All, [
          {
            field: "monitorLabels",
            operator: RuleCriteriaOperator.HasNoneOf,
            value: [LABEL_TIER1_ID.toString()],
          },
        ]),
      }),
      expected: false,
    },
    {
      label: "criteria HasNoneOf keeps a monitor without those labels",
      rule: fakeRule({
        criteria: criteria(FilterCondition.All, [
          {
            field: "monitorLabels",
            operator: RuleCriteriaOperator.HasNoneOf,
            value: [LABEL_STAGING_ID.toString()],
          },
        ]),
      }),
      expected: true,
    },
    {
      label: "criteria DoesNotMatchPattern inverts the pattern",
      rule: fakeRule({
        criteria: criteria(FilterCondition.All, [
          {
            field: "monitorNamePattern",
            operator: RuleCriteriaOperator.DoesNotMatchPattern,
            value: "-prod$",
          },
        ]),
      }),
      expected: false,
    },
    {
      label:
        "criteria win over the legacy shadow a criteria save leaves behind",
      rule: fakeRule({
        monitorNamePattern: RULE_CRITERIA_LEGACY_NEVER_MATCH_PATTERN,
        criteria: criteria(FilterCondition.All, [
          {
            field: "monitorNamePattern",
            operator: RuleCriteriaOperator.EndsWith,
            value: "prod",
          },
        ]),
      }),
      expected: true,
    },
    {
      label: "invalid criteria fail closed",
      rule: fakeRule({
        criteria: {
          schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
          filterCondition: FilterCondition.All,
          filters: [
            {
              field: "monitorLabels",
              operator: RuleCriteriaOperator.HasAnyOf,
              value: "not-an-array",
            },
          ],
        },
      }),
      expected: false,
    },
    {
      label: "a filter on a field the rule does not own matches nothing",
      rule: fakeRule({
        criteria: criteria(FilterCondition.All, [
          {
            field: "monitorType",
            operator: RuleCriteriaOperator.Equals,
            value: "API",
          },
        ]),
      }),
      expected: false,
    },
    {
      label: "criteria with no filters match nothing",
      rule: fakeRule({ criteria: criteria(FilterCondition.All, []) }),
      expected: false,
    },
  ];

  for (const testCase of cases) {
    it(testCase.label, () => {
      expect(
        ServiceLevelObjectiveMonitorRuleEngineService.doesMonitorMatchRule({
          monitor: monitor,
          rule: testCase.rule,
        }),
      ).toBe(testCase.expected);
    });
  }
});
