import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import StatusPageMonitorRule from "../../../Models/DatabaseModels/StatusPageMonitorRule";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import MonitorService from "../../../Server/Services/MonitorService";
import StatusPageMonitorRuleEngineService, {
  StatusPageMonitorRuleSyncResult,
} from "../../../Server/Services/StatusPageMonitorRuleEngineService";
import StatusPageMonitorRuleService from "../../../Server/Services/StatusPageMonitorRuleService";
import StatusPageResourceService from "../../../Server/Services/StatusPageResourceService";
import ObjectID from "../../../Types/ObjectID";
import UptimePrecision from "../../../Types/StatusPage/UptimePrecision";
import { describe, expect, it, beforeEach, afterEach } from "@jest/globals";

/*
 * Contract under test - status page monitor rules.
 *
 * A status page can say "show every monitor labelled Production in the Core
 * Platform group" instead of picking monitors one at a time and typing a
 * display name for each. That promise has two halves, and both have to hold
 * or the page quietly shows the wrong thing:
 *
 *   - a monitor that starts matching is added to the group the rule names,
 *     and a monitor that stops matching is removed again (whether the rule
 *     moved or the monitor did);
 *
 *   - a resource a human added by hand is never touched. It is not adopted
 *     into the rule when it happens to match, and - the case that would
 *     actually lose someone's configuration - it is never removed when it
 *     stops matching, or when the rule is deleted outright.
 *
 * StatusPageResource.statusPageMonitorRuleId is what the second half rests
 * on, so most of what follows is about that boundary. The other thing worth
 * pinning down is that a monitor already on the page is never added twice,
 * because that is the failure a public page shows to customers.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const GROUP_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const OTHER_GROUP_ID: ObjectID = new ObjectID(
  "45454545-4545-4545-8545-454545454545",
);
const RULE_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OTHER_RULE_ID: ObjectID = new ObjectID(
  "1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a",
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
const RESOURCE_A_ID: ObjectID = new ObjectID(
  "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1",
);
const RESOURCE_B_ID: ObjectID = new ObjectID(
  "b1b1b1b1-b1b1-4b1b-8b1b-b1b1b1b1b1b1",
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

function fakeLabel(id: ObjectID): Label {
  return { id: id, _id: id.toString() } as unknown as Label;
}

function fakeMonitor(
  id: ObjectID,
  fields?: {
    name?: string | undefined;
    description?: string | undefined;
    labels?: Array<ObjectID> | undefined;
    projectId?: ObjectID | null | undefined;
  },
): Monitor {
  return {
    id: id,
    _id: id.toString(),
    projectId: fields?.projectId === undefined ? PROJECT_ID : fields.projectId,
    name: fields?.name === undefined ? "API Monitor" : fields.name,
    description: fields?.description,
    labels: (fields?.labels || []).map(fakeLabel),
  } as unknown as Monitor;
}

function fakeRule(fields?: {
  id?: ObjectID | undefined;
  projectId?: ObjectID | null | undefined;
  statusPageId?: ObjectID | null | undefined;
  statusPageGroupId?: ObjectID | undefined;
  isEnabled?: boolean | undefined;
  monitorLabels?: Array<ObjectID> | undefined;
  monitorNamePattern?: string | undefined;
  monitorDescriptionPattern?: string | undefined;
  showCurrentStatus?: boolean | undefined;
  showUptimePercent?: boolean | undefined;
  showStatusHistoryChart?: boolean | undefined;
  uptimePercentPrecision?: UptimePrecision | undefined;
}): StatusPageMonitorRule {
  const id: ObjectID = fields?.id || RULE_ID;

  return {
    id: id,
    _id: id.toString(),
    projectId: fields?.projectId === undefined ? PROJECT_ID : fields.projectId,
    statusPageId:
      fields?.statusPageId === undefined ? STATUS_PAGE_ID : fields.statusPageId,
    statusPageGroupId: fields?.statusPageGroupId,
    isEnabled: fields?.isEnabled === undefined ? true : fields.isEnabled,
    monitorLabels: (fields?.monitorLabels || []).map(fakeLabel),
    monitorNamePattern: fields?.monitorNamePattern,
    monitorDescriptionPattern: fields?.monitorDescriptionPattern,
    showCurrentStatus: fields?.showCurrentStatus,
    showUptimePercent: fields?.showUptimePercent,
    showStatusHistoryChart: fields?.showStatusHistoryChart,
    uptimePercentPrecision: fields?.uptimePercentPrecision,
  } as unknown as StatusPageMonitorRule;
}

function fakeResource(fields: {
  id: ObjectID;
  monitorId: ObjectID;
  statusPageMonitorRuleId?: ObjectID | undefined;
  statusPageGroupId?: ObjectID | undefined;
  showCurrentStatus?: boolean | undefined;
  showUptimePercent?: boolean | undefined;
  showStatusHistoryChart?: boolean | undefined;
  uptimePercentPrecision?: UptimePrecision | undefined;
}): StatusPageResource {
  return {
    id: fields.id,
    _id: fields.id.toString(),
    monitorId: fields.monitorId,
    statusPageMonitorRuleId: fields.statusPageMonitorRuleId,
    statusPageGroupId: fields.statusPageGroupId,
    showCurrentStatus: fields.showCurrentStatus,
    showUptimePercent: fields.showUptimePercent,
    showStatusHistoryChart: fields.showStatusHistoryChart,
    uptimePercentPrecision: fields.uptimePercentPrecision,
  } as unknown as StatusPageResource;
}

/** The resource the engine handed to StatusPageResourceService.create. */
function createdResource(
  createSpy: jest.SpyInstance,
  callIndex: number = 0,
): StatusPageResource {
  const call: { data: StatusPageResource } = createSpy.mock.calls[
    callIndex
  ]![0] as { data: StatusPageResource };

  return call.data;
}

describe("StatusPageMonitorRuleEngineService.doesMonitorMatchRule", () => {
  it("matches a monitor carrying any one of the rule's labels", () => {
    expect(
      StatusPageMonitorRuleEngineService.doesMonitorMatchRule({
        monitor: fakeMonitor(MONITOR_A_ID, {
          labels: [LABEL_STAGING_ID, LABEL_TIER1_ID],
        }),
        rule: fakeRule({
          monitorLabels: [LABEL_PRODUCTION_ID, LABEL_TIER1_ID],
        }),
      }),
    ).toBe(true);
  });

  it("rejects a monitor carrying none of them", () => {
    expect(
      StatusPageMonitorRuleEngineService.doesMonitorMatchRule({
        monitor: fakeMonitor(MONITOR_A_ID, { labels: [LABEL_STAGING_ID] }),
        rule: fakeRule({ monitorLabels: [LABEL_PRODUCTION_ID] }),
      }),
    ).toBe(false);
  });

  it("rejects an unlabelled monitor against a label rule", () => {
    expect(
      StatusPageMonitorRuleEngineService.doesMonitorMatchRule({
        monitor: fakeMonitor(MONITOR_A_ID, { labels: [] }),
        rule: fakeRule({ monitorLabels: [LABEL_PRODUCTION_ID] }),
      }),
    ).toBe(false);
  });

  it("matches the name pattern case-insensitively", () => {
    expect(
      StatusPageMonitorRuleEngineService.doesMonitorMatchRule({
        monitor: fakeMonitor(MONITOR_A_ID, { name: "API Gateway" }),
        rule: fakeRule({ monitorNamePattern: "^api" }),
      }),
    ).toBe(true);
  });

  it("treats the name pattern as a regex, not a substring", () => {
    expect(
      StatusPageMonitorRuleEngineService.doesMonitorMatchRule({
        monitor: fakeMonitor(MONITOR_A_ID, { name: "internal-api" }),
        rule: fakeRule({ monitorNamePattern: "^api" }),
      }),
    ).toBe(false);
  });

  it("matches the description pattern", () => {
    expect(
      StatusPageMonitorRuleEngineService.doesMonitorMatchRule({
        monitor: fakeMonitor(MONITOR_A_ID, {
          description: "Customer facing checkout flow",
        }),
        rule: fakeRule({ monitorDescriptionPattern: "customer facing" }),
      }),
    ).toBe(true);
  });

  it("rejects a monitor with no description against a description rule", () => {
    expect(
      StatusPageMonitorRuleEngineService.doesMonitorMatchRule({
        monitor: fakeMonitor(MONITOR_A_ID, { description: undefined }),
        rule: fakeRule({ monitorDescriptionPattern: "tier-1" }),
      }),
    ).toBe(false);
  });

  it("ANDs the criteria - passing the labels is not enough if the name fails", () => {
    expect(
      StatusPageMonitorRuleEngineService.doesMonitorMatchRule({
        monitor: fakeMonitor(MONITOR_A_ID, {
          name: "worker-queue",
          labels: [LABEL_PRODUCTION_ID],
        }),
        rule: fakeRule({
          monitorLabels: [LABEL_PRODUCTION_ID],
          monitorNamePattern: "^api",
        }),
      }),
    ).toBe(false);
  });

  it("matches when every specified criterion passes", () => {
    expect(
      StatusPageMonitorRuleEngineService.doesMonitorMatchRule({
        monitor: fakeMonitor(MONITOR_A_ID, {
          name: "api-checkout",
          description: "tier-1 service",
          labels: [LABEL_PRODUCTION_ID],
        }),
        rule: fakeRule({
          monitorLabels: [LABEL_PRODUCTION_ID],
          monitorNamePattern: "^api",
          monitorDescriptionPattern: "tier-1",
        }),
      }),
    ).toBe(true);
  });

  it("matches everything when the name pattern is .* - the documented escape hatch", () => {
    expect(
      StatusPageMonitorRuleEngineService.doesMonitorMatchRule({
        monitor: fakeMonitor(MONITOR_A_ID, { name: "anything at all" }),
        rule: fakeRule({ monitorNamePattern: ".*" }),
      }),
    ).toBe(true);
  });

  /*
   * The safety property: an empty form must not put every monitor in the
   * project on a public status page.
   */
  it("matches nothing when the rule has no criteria at all", () => {
    expect(
      StatusPageMonitorRuleEngineService.doesMonitorMatchRule({
        monitor: fakeMonitor(MONITOR_A_ID, {
          name: "api",
          labels: [LABEL_PRODUCTION_ID],
        }),
        rule: fakeRule({}),
      }),
    ).toBe(false);
  });

  it("matches nothing rather than throwing when the pattern is not a valid regex", () => {
    expect(
      StatusPageMonitorRuleEngineService.doesMonitorMatchRule({
        monitor: fakeMonitor(MONITOR_A_ID, { name: "api" }),
        rule: fakeRule({ monitorNamePattern: "([unclosed" }),
      }),
    ).toBe(false);
  });

  /*
   * #2940. `*api*` throws "Nothing to repeat" as a regex, so a private regex
   * test here would give the user a rule that silently matches nothing. The
   * shared RulePatternMatchUtil falls back to a wildcard glob, which is what
   * the sibling network device rules do and what people actually type.
   */
  it("matches a `*` wildcard glob, not just a regex", () => {
    expect(
      StatusPageMonitorRuleEngineService.doesMonitorMatchRule({
        monitor: fakeMonitor(MONITOR_A_ID, { name: "prod-checkout-api" }),
        rule: fakeRule({ monitorNamePattern: "*checkout*" }),
      }),
    ).toBe(true);
  });

  it("does not match a glob that the name fails", () => {
    expect(
      StatusPageMonitorRuleEngineService.doesMonitorMatchRule({
        monitor: fakeMonitor(MONITOR_A_ID, { name: "prod-worker" }),
        rule: fakeRule({ monitorNamePattern: "*checkout*" }),
      }),
    ).toBe(false);
  });

  it("matches a glob case-insensitively", () => {
    expect(
      StatusPageMonitorRuleEngineService.doesMonitorMatchRule({
        monitor: fakeMonitor(MONITOR_A_ID, { name: "Prod-Checkout-API" }),
        rule: fakeRule({ monitorNamePattern: "*checkout*" }),
      }),
    ).toBe(true);
  });

  /*
   * The glob is anchored to the whole name, unlike the (unanchored) regex
   * attempt - `*gateway` means "ends with gateway", not "contains it".
   */
  it("anchors a glob to the whole name", () => {
    expect(
      StatusPageMonitorRuleEngineService.doesMonitorMatchRule({
        monitor: fakeMonitor(MONITOR_A_ID, { name: "prod-api-gateway" }),
        rule: fakeRule({ monitorNamePattern: "*gateway" }),
      }),
    ).toBe(true);

    expect(
      StatusPageMonitorRuleEngineService.doesMonitorMatchRule({
        monitor: fakeMonitor(MONITOR_A_ID, { name: "gateway-prod" }),
        rule: fakeRule({ monitorNamePattern: "*gateway" }),
      }),
    ).toBe(false);
  });

  it("applies the glob fallback to the description pattern too", () => {
    expect(
      StatusPageMonitorRuleEngineService.doesMonitorMatchRule({
        monitor: fakeMonitor(MONITOR_A_ID, {
          description: "customer facing tier-1 service",
        }),
        rule: fakeRule({ monitorDescriptionPattern: "*tier-1*" }),
      }),
    ).toBe(true);
  });

  /*
   * A pattern is a superset: anything that matched as a regex before still
   * matches, and the glob only ever adds. `.*` must not start behaving like a
   * literal glob.
   */
  it("still prefers regex semantics for a pattern that is valid as both", () => {
    expect(
      StatusPageMonitorRuleEngineService.doesMonitorMatchRule({
        monitor: fakeMonitor(MONITOR_A_ID, { name: "anything" }),
        rule: fakeRule({ monitorNamePattern: ".*" }),
      }),
    ).toBe(true);
  });
});

describe("StatusPageMonitorRuleEngineService.syncResourcesForRule", () => {
  let ruleFindOneByIdSpy: jest.SpyInstance;
  let monitorFindBySpy: jest.SpyInstance;
  let resourceFindBySpy: jest.SpyInstance;
  let resourceCreateSpy: jest.SpyInstance;
  let resourceDeleteSpy: jest.SpyInstance;
  let resourceUpdateSpy: jest.SpyInstance;

  beforeEach(() => {
    ruleFindOneByIdSpy = jest.spyOn(
      StatusPageMonitorRuleService,
      "findOneById",
    );
    monitorFindBySpy = jest.spyOn(MonitorService, "findBy");
    resourceFindBySpy = jest
      .spyOn(StatusPageResourceService, "findBy")
      .mockResolvedValue([]);
    resourceCreateSpy = jest
      .spyOn(StatusPageResourceService, "create")
      .mockResolvedValue(new StatusPageResource());
    resourceDeleteSpy = jest
      .spyOn(StatusPageResourceService, "deleteOneById")
      .mockResolvedValue(1);
    resourceUpdateSpy = jest
      .spyOn(StatusPageResourceService, "updateOneById")
      .mockResolvedValue(1);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("adds every monitor in the project that the rule matches", async () => {
    ruleFindOneByIdSpy.mockResolvedValue(
      fakeRule({ monitorLabels: [LABEL_PRODUCTION_ID] }),
    );
    monitorFindBySpy.mockResolvedValue([
      fakeMonitor(MONITOR_A_ID, { labels: [LABEL_PRODUCTION_ID] }),
      fakeMonitor(MONITOR_B_ID, { labels: [LABEL_PRODUCTION_ID] }),
    ]);

    const result: StatusPageMonitorRuleSyncResult =
      await StatusPageMonitorRuleEngineService.syncResourcesForRule({
        statusPageMonitorRuleId: RULE_ID,
      });

    expect(resourceCreateSpy).toHaveBeenCalledTimes(2);
    expect(result.monitorIdsAdded.sort()).toEqual(
      [MONITOR_A_ID.toString(), MONITOR_B_ID.toString()].sort(),
    );
    expect(result.statusPageResourceIdsRemoved).toEqual([]);
  });

  it("puts them in the group the rule names - the whole point of asking", async () => {
    ruleFindOneByIdSpy.mockResolvedValue(
      fakeRule({
        monitorLabels: [LABEL_PRODUCTION_ID],
        statusPageGroupId: GROUP_ID,
      }),
    );
    monitorFindBySpy.mockResolvedValue([
      fakeMonitor(MONITOR_A_ID, { labels: [LABEL_PRODUCTION_ID] }),
    ]);

    await StatusPageMonitorRuleEngineService.syncResourcesForRule({
      statusPageMonitorRuleId: RULE_ID,
    });

    expect(createdResource(resourceCreateSpy).statusPageGroupId).toEqual(
      GROUP_ID,
    );
  });

  it("leaves the group empty when the rule names none, so the resource lands ungrouped", async () => {
    ruleFindOneByIdSpy.mockResolvedValue(
      fakeRule({ monitorLabels: [LABEL_PRODUCTION_ID] }),
    );
    monitorFindBySpy.mockResolvedValue([
      fakeMonitor(MONITOR_A_ID, { labels: [LABEL_PRODUCTION_ID] }),
    ]);

    await StatusPageMonitorRuleEngineService.syncResourcesForRule({
      statusPageMonitorRuleId: RULE_ID,
    });

    expect(
      createdResource(resourceCreateSpy).statusPageGroupId,
    ).toBeUndefined();
  });

  it("stamps the rule on what it creates so it can undo it later", async () => {
    ruleFindOneByIdSpy.mockResolvedValue(
      fakeRule({ monitorLabels: [LABEL_PRODUCTION_ID] }),
    );
    monitorFindBySpy.mockResolvedValue([
      fakeMonitor(MONITOR_A_ID, { labels: [LABEL_PRODUCTION_ID] }),
    ]);

    await StatusPageMonitorRuleEngineService.syncResourcesForRule({
      statusPageMonitorRuleId: RULE_ID,
    });

    expect(createdResource(resourceCreateSpy).statusPageMonitorRuleId).toEqual(
      RULE_ID,
    );
  });

  it("names the resource after the monitor, so nobody has to type one", async () => {
    ruleFindOneByIdSpy.mockResolvedValue(
      fakeRule({ monitorLabels: [LABEL_PRODUCTION_ID] }),
    );
    monitorFindBySpy.mockResolvedValue([
      fakeMonitor(MONITOR_A_ID, {
        name: "Checkout API",
        labels: [LABEL_PRODUCTION_ID],
      }),
    ]);

    await StatusPageMonitorRuleEngineService.syncResourcesForRule({
      statusPageMonitorRuleId: RULE_ID,
    });

    expect(createdResource(resourceCreateSpy).displayName).toBe("Checkout API");
  });

  it("copies the rule's display options onto every resource it creates", async () => {
    ruleFindOneByIdSpy.mockResolvedValue(
      fakeRule({
        monitorLabels: [LABEL_PRODUCTION_ID],
        showCurrentStatus: false,
        showUptimePercent: true,
        showStatusHistoryChart: false,
        uptimePercentPrecision: UptimePrecision.THREE_DECIMAL,
      }),
    );
    monitorFindBySpy.mockResolvedValue([
      fakeMonitor(MONITOR_A_ID, { labels: [LABEL_PRODUCTION_ID] }),
    ]);

    await StatusPageMonitorRuleEngineService.syncResourcesForRule({
      statusPageMonitorRuleId: RULE_ID,
    });

    const resource: StatusPageResource = createdResource(resourceCreateSpy);

    expect(resource.showCurrentStatus).toBe(false);
    expect(resource.showUptimePercent).toBe(true);
    expect(resource.showStatusHistoryChart).toBe(false);
    expect(resource.uptimePercentPrecision).toBe(UptimePrecision.THREE_DECIMAL);
  });

  it("writes as root - the rule is server-side and must not need a caller's permissions", async () => {
    ruleFindOneByIdSpy.mockResolvedValue(
      fakeRule({ monitorLabels: [LABEL_PRODUCTION_ID] }),
    );
    monitorFindBySpy.mockResolvedValue([
      fakeMonitor(MONITOR_A_ID, { labels: [LABEL_PRODUCTION_ID] }),
    ]);

    await StatusPageMonitorRuleEngineService.syncResourcesForRule({
      statusPageMonitorRuleId: RULE_ID,
    });

    const call: { props: { isRoot: boolean } } = resourceCreateSpy.mock
      .calls[0]![0] as { props: { isRoot: boolean } };

    expect(call.props.isRoot).toBe(true);
  });

  it("applies the regex in memory, so a Postgres-only pattern cannot leak a monitor onto the page", async () => {
    ruleFindOneByIdSpy.mockResolvedValue(
      fakeRule({
        monitorLabels: [LABEL_PRODUCTION_ID],
        monitorNamePattern: "^api",
      }),
    );
    // The label query is what the database narrows; the name still has to hold.
    monitorFindBySpy.mockResolvedValue([
      fakeMonitor(MONITOR_A_ID, {
        name: "api-checkout",
        labels: [LABEL_PRODUCTION_ID],
      }),
      fakeMonitor(MONITOR_B_ID, {
        name: "worker-queue",
        labels: [LABEL_PRODUCTION_ID],
      }),
    ]);

    const result: StatusPageMonitorRuleSyncResult =
      await StatusPageMonitorRuleEngineService.syncResourcesForRule({
        statusPageMonitorRuleId: RULE_ID,
      });

    expect(result.monitorIdsAdded).toEqual([MONITOR_A_ID.toString()]);
  });

  it("does not add a monitor that is already on the page - no duplicates for customers to see", async () => {
    ruleFindOneByIdSpy.mockResolvedValue(
      fakeRule({ monitorLabels: [LABEL_PRODUCTION_ID] }),
    );
    monitorFindBySpy.mockResolvedValue([
      fakeMonitor(MONITOR_A_ID, { labels: [LABEL_PRODUCTION_ID] }),
    ]);
    resourceFindBySpy.mockResolvedValue([
      fakeResource({ id: RESOURCE_A_ID, monitorId: MONITOR_A_ID }),
    ]);

    const result: StatusPageMonitorRuleSyncResult =
      await StatusPageMonitorRuleEngineService.syncResourcesForRule({
        statusPageMonitorRuleId: RULE_ID,
      });

    expect(resourceCreateSpy).not.toHaveBeenCalled();
    expect(result.monitorIdsAdded).toEqual([]);
  });

  it("removes a resource it owns once the monitor stops matching", async () => {
    ruleFindOneByIdSpy.mockResolvedValue(
      fakeRule({ monitorLabels: [LABEL_PRODUCTION_ID] }),
    );
    monitorFindBySpy.mockResolvedValue([]);
    resourceFindBySpy.mockResolvedValue([
      fakeResource({
        id: RESOURCE_A_ID,
        monitorId: MONITOR_A_ID,
        statusPageMonitorRuleId: RULE_ID,
      }),
    ]);

    const result: StatusPageMonitorRuleSyncResult =
      await StatusPageMonitorRuleEngineService.syncResourcesForRule({
        statusPageMonitorRuleId: RULE_ID,
      });

    expect(resourceDeleteSpy).toHaveBeenCalledTimes(1);
    expect(result.statusPageResourceIdsRemoved).toEqual([
      RESOURCE_A_ID.toString(),
    ]);
  });

  /*
   * The configuration-losing case. A resource with no rule stamped on it was
   * added by a person, and no rule evaluation may ever remove it.
   */
  it("never removes a resource a human added, even when it no longer matches", async () => {
    ruleFindOneByIdSpy.mockResolvedValue(
      fakeRule({ monitorLabels: [LABEL_PRODUCTION_ID] }),
    );
    monitorFindBySpy.mockResolvedValue([]);
    resourceFindBySpy.mockResolvedValue([
      fakeResource({ id: RESOURCE_A_ID, monitorId: MONITOR_A_ID }),
    ]);

    const result: StatusPageMonitorRuleSyncResult =
      await StatusPageMonitorRuleEngineService.syncResourcesForRule({
        statusPageMonitorRuleId: RULE_ID,
      });

    expect(resourceDeleteSpy).not.toHaveBeenCalled();
    expect(result.statusPageResourceIdsRemoved).toEqual([]);
  });

  it("never removes a resource another rule owns", async () => {
    ruleFindOneByIdSpy.mockResolvedValue(
      fakeRule({ monitorLabels: [LABEL_PRODUCTION_ID] }),
    );
    monitorFindBySpy.mockResolvedValue([]);
    resourceFindBySpy.mockResolvedValue([
      fakeResource({
        id: RESOURCE_B_ID,
        monitorId: MONITOR_B_ID,
        statusPageMonitorRuleId: OTHER_RULE_ID,
      }),
    ]);

    await StatusPageMonitorRuleEngineService.syncResourcesForRule({
      statusPageMonitorRuleId: RULE_ID,
    });

    expect(resourceDeleteSpy).not.toHaveBeenCalled();
  });

  it("does not adopt a manual resource it happens to match, so a later label change leaves it alone", async () => {
    ruleFindOneByIdSpy.mockResolvedValue(
      fakeRule({ monitorLabels: [LABEL_PRODUCTION_ID] }),
    );
    monitorFindBySpy.mockResolvedValue([
      fakeMonitor(MONITOR_A_ID, { labels: [LABEL_PRODUCTION_ID] }),
    ]);
    resourceFindBySpy.mockResolvedValue([
      fakeResource({ id: RESOURCE_A_ID, monitorId: MONITOR_A_ID }),
    ]);

    await StatusPageMonitorRuleEngineService.syncResourcesForRule({
      statusPageMonitorRuleId: RULE_ID,
    });

    // Nothing created and nothing stamped: the resource is still manual.
    expect(resourceCreateSpy).not.toHaveBeenCalled();
    expect(resourceDeleteSpy).not.toHaveBeenCalled();
  });

  /*
   * Editing "Add Monitors To Group" has to move the monitors the rule already
   * added. A rule that only applied its new group to monitors it adds in
   * FUTURE would make the edit look like it silently did nothing — the user
   * changed the one field the whole feature is about and the page did not
   * move.
   */
  it("re-homes the resources it owns when the rule's group changes", async () => {
    ruleFindOneByIdSpy.mockResolvedValue(
      fakeRule({
        monitorLabels: [LABEL_PRODUCTION_ID],
        statusPageGroupId: OTHER_GROUP_ID,
      }),
    );
    monitorFindBySpy.mockResolvedValue([
      fakeMonitor(MONITOR_A_ID, { labels: [LABEL_PRODUCTION_ID] }),
    ]);
    resourceFindBySpy.mockResolvedValue([
      fakeResource({
        id: RESOURCE_A_ID,
        monitorId: MONITOR_A_ID,
        statusPageMonitorRuleId: RULE_ID,
        statusPageGroupId: GROUP_ID,
      }),
    ]);

    const result: StatusPageMonitorRuleSyncResult =
      await StatusPageMonitorRuleEngineService.syncResourcesForRule({
        statusPageMonitorRuleId: RULE_ID,
      });

    expect(resourceUpdateSpy).toHaveBeenCalledTimes(1);
    const call: { id: ObjectID; data: { statusPageGroupId: ObjectID } } =
      resourceUpdateSpy.mock.calls[0]![0] as {
        id: ObjectID;
        data: { statusPageGroupId: ObjectID };
      };
    expect(call.id).toEqual(RESOURCE_A_ID);
    expect(call.data.statusPageGroupId).toEqual(OTHER_GROUP_ID);
    expect(result.statusPageResourceIdsUpdated).toEqual([
      RESOURCE_A_ID.toString(),
    ]);
  });

  it("moves them back to ungrouped when the rule's group is cleared", async () => {
    ruleFindOneByIdSpy.mockResolvedValue(
      fakeRule({ monitorLabels: [LABEL_PRODUCTION_ID] }),
    );
    monitorFindBySpy.mockResolvedValue([
      fakeMonitor(MONITOR_A_ID, { labels: [LABEL_PRODUCTION_ID] }),
    ]);
    resourceFindBySpy.mockResolvedValue([
      fakeResource({
        id: RESOURCE_A_ID,
        monitorId: MONITOR_A_ID,
        statusPageMonitorRuleId: RULE_ID,
        statusPageGroupId: GROUP_ID,
      }),
    ]);

    await StatusPageMonitorRuleEngineService.syncResourcesForRule({
      statusPageMonitorRuleId: RULE_ID,
    });

    const call: { data: { statusPageGroupId: ObjectID | null } } =
      resourceUpdateSpy.mock.calls[0]![0] as {
        data: { statusPageGroupId: ObjectID | null };
      };
    expect(call.data.statusPageGroupId).toBeNull();
  });

  it("re-applies the rule's display options to the resources it owns", async () => {
    ruleFindOneByIdSpy.mockResolvedValue(
      fakeRule({
        monitorLabels: [LABEL_PRODUCTION_ID],
        showUptimePercent: false,
        uptimePercentPrecision: UptimePrecision.TWO_DECIMAL,
      }),
    );
    monitorFindBySpy.mockResolvedValue([
      fakeMonitor(MONITOR_A_ID, { labels: [LABEL_PRODUCTION_ID] }),
    ]);
    resourceFindBySpy.mockResolvedValue([
      fakeResource({
        id: RESOURCE_A_ID,
        monitorId: MONITOR_A_ID,
        statusPageMonitorRuleId: RULE_ID,
        showUptimePercent: true,
        uptimePercentPrecision: UptimePrecision.ONE_DECIMAL,
      }),
    ]);

    await StatusPageMonitorRuleEngineService.syncResourcesForRule({
      statusPageMonitorRuleId: RULE_ID,
    });

    const call: {
      data: {
        showUptimePercent: boolean;
        uptimePercentPrecision: UptimePrecision;
      };
    } = resourceUpdateSpy.mock.calls[0]![0] as {
      data: {
        showUptimePercent: boolean;
        uptimePercentPrecision: UptimePrecision;
      };
    };
    expect(call.data.showUptimePercent).toBe(false);
    expect(call.data.uptimePercentPrecision).toBe(UptimePrecision.TWO_DECIMAL);
  });

  /*
   * Re-running an unchanged rule is the common case (any monitor edit can
   * trigger it), so it must not write.
   */
  it("writes nothing when the resources it owns already agree with the rule", async () => {
    ruleFindOneByIdSpy.mockResolvedValue(
      fakeRule({
        monitorLabels: [LABEL_PRODUCTION_ID],
        statusPageGroupId: GROUP_ID,
      }),
    );
    monitorFindBySpy.mockResolvedValue([
      fakeMonitor(MONITOR_A_ID, { labels: [LABEL_PRODUCTION_ID] }),
    ]);
    resourceFindBySpy.mockResolvedValue([
      fakeResource({
        id: RESOURCE_A_ID,
        monitorId: MONITOR_A_ID,
        statusPageMonitorRuleId: RULE_ID,
        statusPageGroupId: GROUP_ID,
        showCurrentStatus: true,
        showUptimePercent: true,
        showStatusHistoryChart: true,
      }),
    ]);

    const result: StatusPageMonitorRuleSyncResult =
      await StatusPageMonitorRuleEngineService.syncResourcesForRule({
        statusPageMonitorRuleId: RULE_ID,
      });

    expect(resourceUpdateSpy).not.toHaveBeenCalled();
    expect(result.statusPageResourceIdsUpdated).toEqual([]);
  });

  it("never re-homes a resource a human added, however far it has drifted", async () => {
    ruleFindOneByIdSpy.mockResolvedValue(
      fakeRule({
        monitorLabels: [LABEL_PRODUCTION_ID],
        statusPageGroupId: OTHER_GROUP_ID,
      }),
    );
    monitorFindBySpy.mockResolvedValue([
      fakeMonitor(MONITOR_A_ID, { labels: [LABEL_PRODUCTION_ID] }),
    ]);
    resourceFindBySpy.mockResolvedValue([
      fakeResource({
        id: RESOURCE_A_ID,
        monitorId: MONITOR_A_ID,
        statusPageGroupId: GROUP_ID,
      }),
    ]);

    await StatusPageMonitorRuleEngineService.syncResourcesForRule({
      statusPageMonitorRuleId: RULE_ID,
    });

    expect(resourceUpdateSpy).not.toHaveBeenCalled();
  });

  it("never re-homes a resource another rule owns", async () => {
    ruleFindOneByIdSpy.mockResolvedValue(
      fakeRule({
        monitorLabels: [LABEL_PRODUCTION_ID],
        statusPageGroupId: OTHER_GROUP_ID,
      }),
    );
    monitorFindBySpy.mockResolvedValue([
      fakeMonitor(MONITOR_A_ID, { labels: [LABEL_PRODUCTION_ID] }),
    ]);
    resourceFindBySpy.mockResolvedValue([
      fakeResource({
        id: RESOURCE_A_ID,
        monitorId: MONITOR_A_ID,
        statusPageMonitorRuleId: OTHER_RULE_ID,
        statusPageGroupId: GROUP_ID,
      }),
    ]);

    await StatusPageMonitorRuleEngineService.syncResourcesForRule({
      statusPageMonitorRuleId: RULE_ID,
    });

    expect(resourceUpdateSpy).not.toHaveBeenCalled();
  });

  it("does not reconcile a resource whose monitor the rule has stopped claiming - it deletes it", async () => {
    ruleFindOneByIdSpy.mockResolvedValue(
      fakeRule({
        monitorLabels: [LABEL_PRODUCTION_ID],
        statusPageGroupId: OTHER_GROUP_ID,
      }),
    );
    monitorFindBySpy.mockResolvedValue([]);
    resourceFindBySpy.mockResolvedValue([
      fakeResource({
        id: RESOURCE_A_ID,
        monitorId: MONITOR_A_ID,
        statusPageMonitorRuleId: RULE_ID,
        statusPageGroupId: GROUP_ID,
      }),
    ]);

    await StatusPageMonitorRuleEngineService.syncResourcesForRule({
      statusPageMonitorRuleId: RULE_ID,
    });

    expect(resourceUpdateSpy).not.toHaveBeenCalled();
    expect(resourceDeleteSpy).toHaveBeenCalledTimes(1);
  });

  /*
   * Narrowing one rule must not take a monitor off the page that a different
   * rule on the same page still claims. The rule-side pass only knows its own
   * rule, so it hands each released monitor to the monitor-side pass, which
   * consults every rule.
   */
  it("hands a released monitor to another rule that still claims it", async () => {
    ruleFindOneByIdSpy.mockResolvedValue(
      fakeRule({ monitorLabels: [LABEL_TIER1_ID] }),
    );
    monitorFindBySpy.mockResolvedValue([]);
    resourceFindBySpy.mockResolvedValue([
      fakeResource({
        id: RESOURCE_A_ID,
        monitorId: MONITOR_A_ID,
        statusPageMonitorRuleId: RULE_ID,
      }),
    ]);

    const syncRulesForMonitorSpy: jest.SpyInstance = jest
      .spyOn(StatusPageMonitorRuleEngineService, "syncRulesForMonitor")
      .mockResolvedValue([]);

    await StatusPageMonitorRuleEngineService.syncResourcesForRule({
      statusPageMonitorRuleId: RULE_ID,
    });

    expect(syncRulesForMonitorSpy).toHaveBeenCalledTimes(1);
    const call: { monitorId: ObjectID } = syncRulesForMonitorSpy.mock
      .calls[0]![0] as { monitorId: ObjectID };
    expect(call.monitorId.toString()).toBe(MONITOR_A_ID.toString());
  });

  it("does not re-home monitors it did not release", async () => {
    ruleFindOneByIdSpy.mockResolvedValue(
      fakeRule({ monitorLabels: [LABEL_PRODUCTION_ID] }),
    );
    monitorFindBySpy.mockResolvedValue([
      fakeMonitor(MONITOR_A_ID, { labels: [LABEL_PRODUCTION_ID] }),
    ]);

    const syncRulesForMonitorSpy: jest.SpyInstance = jest
      .spyOn(StatusPageMonitorRuleEngineService, "syncRulesForMonitor")
      .mockResolvedValue([]);

    await StatusPageMonitorRuleEngineService.syncResourcesForRule({
      statusPageMonitorRuleId: RULE_ID,
    });

    expect(syncRulesForMonitorSpy).not.toHaveBeenCalled();
  });

  it("still reports its own removal when the hand-off fails", async () => {
    ruleFindOneByIdSpy.mockResolvedValue(
      fakeRule({ monitorLabels: [LABEL_TIER1_ID] }),
    );
    monitorFindBySpy.mockResolvedValue([]);
    resourceFindBySpy.mockResolvedValue([
      fakeResource({
        id: RESOURCE_A_ID,
        monitorId: MONITOR_A_ID,
        statusPageMonitorRuleId: RULE_ID,
      }),
    ]);
    jest
      .spyOn(StatusPageMonitorRuleEngineService, "syncRulesForMonitor")
      .mockRejectedValue(new Error("db down"));

    const result: StatusPageMonitorRuleSyncResult =
      await StatusPageMonitorRuleEngineService.syncResourcesForRule({
        statusPageMonitorRuleId: RULE_ID,
      });

    expect(result.statusPageResourceIdsRemoved).toEqual([
      RESOURCE_A_ID.toString(),
    ]);
  });

  it("adds and removes in the same pass, so a re-pointed rule fully re-derives the page", async () => {
    ruleFindOneByIdSpy.mockResolvedValue(
      fakeRule({ monitorLabels: [LABEL_TIER1_ID] }),
    );
    monitorFindBySpy.mockResolvedValue([
      fakeMonitor(MONITOR_B_ID, { labels: [LABEL_TIER1_ID] }),
    ]);
    resourceFindBySpy.mockResolvedValue([
      fakeResource({
        id: RESOURCE_A_ID,
        monitorId: MONITOR_A_ID,
        statusPageMonitorRuleId: RULE_ID,
      }),
    ]);

    const result: StatusPageMonitorRuleSyncResult =
      await StatusPageMonitorRuleEngineService.syncResourcesForRule({
        statusPageMonitorRuleId: RULE_ID,
      });

    expect(result.monitorIdsAdded).toEqual([MONITOR_B_ID.toString()]);
    expect(result.statusPageResourceIdsRemoved).toEqual([
      RESOURCE_A_ID.toString(),
    ]);
  });

  /*
   * Disabling is the reversible half of deleting. If it left the resources
   * behind, the toggle would not mean anything.
   */
  it("removes everything it added when the rule is disabled", async () => {
    ruleFindOneByIdSpy.mockResolvedValue(
      fakeRule({ monitorLabels: [LABEL_PRODUCTION_ID], isEnabled: false }),
    );
    resourceFindBySpy.mockResolvedValue([
      fakeResource({
        id: RESOURCE_A_ID,
        monitorId: MONITOR_A_ID,
        statusPageMonitorRuleId: RULE_ID,
      }),
    ]);

    const result: StatusPageMonitorRuleSyncResult =
      await StatusPageMonitorRuleEngineService.syncResourcesForRule({
        statusPageMonitorRuleId: RULE_ID,
      });

    expect(monitorFindBySpy).not.toHaveBeenCalled();
    expect(result.statusPageResourceIdsRemoved).toEqual([
      RESOURCE_A_ID.toString(),
    ]);
  });

  it("still leaves manual resources alone when the rule is disabled", async () => {
    ruleFindOneByIdSpy.mockResolvedValue(
      fakeRule({ monitorLabels: [LABEL_PRODUCTION_ID], isEnabled: false }),
    );
    resourceFindBySpy.mockResolvedValue([
      fakeResource({ id: RESOURCE_A_ID, monitorId: MONITOR_A_ID }),
    ]);

    await StatusPageMonitorRuleEngineService.syncResourcesForRule({
      statusPageMonitorRuleId: RULE_ID,
    });

    expect(resourceDeleteSpy).not.toHaveBeenCalled();
  });

  it("scopes the monitor search to the rule's own project", async () => {
    ruleFindOneByIdSpy.mockResolvedValue(
      fakeRule({ monitorLabels: [LABEL_PRODUCTION_ID] }),
    );
    monitorFindBySpy.mockResolvedValue([]);

    await StatusPageMonitorRuleEngineService.syncResourcesForRule({
      statusPageMonitorRuleId: RULE_ID,
    });

    const call: { query: { projectId: ObjectID } } = monitorFindBySpy.mock
      .calls[0]![0] as { query: { projectId: ObjectID } };

    expect(call.query.projectId).toEqual(PROJECT_ID);
  });

  it("reads only this status page's resources, not the whole project's", async () => {
    ruleFindOneByIdSpy.mockResolvedValue(
      fakeRule({ monitorLabels: [LABEL_PRODUCTION_ID] }),
    );
    monitorFindBySpy.mockResolvedValue([]);

    await StatusPageMonitorRuleEngineService.syncResourcesForRule({
      statusPageMonitorRuleId: RULE_ID,
    });

    const call: { query: { statusPageId: ObjectID } } = resourceFindBySpy.mock
      .calls[0]![0] as { query: { statusPageId: ObjectID } };

    expect(call.query.statusPageId).toEqual(STATUS_PAGE_ID);
  });

  it("does nothing for a rule that no longer exists", async () => {
    ruleFindOneByIdSpy.mockResolvedValue(null);

    const result: StatusPageMonitorRuleSyncResult =
      await StatusPageMonitorRuleEngineService.syncResourcesForRule({
        statusPageMonitorRuleId: RULE_ID,
      });

    expect(result).toEqual({
      monitorIdsAdded: [],
      statusPageResourceIdsRemoved: [],
      statusPageResourceIdsUpdated: [],
      monitorIdsReleased: [],
    });
    expect(resourceCreateSpy).not.toHaveBeenCalled();
    expect(resourceDeleteSpy).not.toHaveBeenCalled();
  });

  it("does nothing for a rule with no criteria, rather than adding the whole project", async () => {
    ruleFindOneByIdSpy.mockResolvedValue(fakeRule({}));

    const result: StatusPageMonitorRuleSyncResult =
      await StatusPageMonitorRuleEngineService.syncResourcesForRule({
        statusPageMonitorRuleId: RULE_ID,
      });

    expect(monitorFindBySpy).not.toHaveBeenCalled();
    expect(result.monitorIdsAdded).toEqual([]);
  });

  /*
   * A rule can lose its last criterion without anyone editing it: its only
   * criterion was a label, and deleting that label cascaded the join row away.
   * The rule then claims nothing, and what it had added has to go — otherwise
   * the page keeps monitors that no surviving configuration explains.
   */
  it("removes what it owns once it has been left with no criteria at all", async () => {
    ruleFindOneByIdSpy.mockResolvedValue(fakeRule({}));
    resourceFindBySpy.mockResolvedValue([
      fakeResource({
        id: RESOURCE_A_ID,
        monitorId: MONITOR_A_ID,
        statusPageMonitorRuleId: RULE_ID,
      }),
    ]);

    const result: StatusPageMonitorRuleSyncResult =
      await StatusPageMonitorRuleEngineService.syncResourcesForRule({
        statusPageMonitorRuleId: RULE_ID,
      });

    expect(result.statusPageResourceIdsRemoved).toEqual([
      RESOURCE_A_ID.toString(),
    ]);
  });

  it("still spares manual resources when it has been left with no criteria", async () => {
    ruleFindOneByIdSpy.mockResolvedValue(fakeRule({}));
    resourceFindBySpy.mockResolvedValue([
      fakeResource({ id: RESOURCE_A_ID, monitorId: MONITOR_A_ID }),
    ]);

    await StatusPageMonitorRuleEngineService.syncResourcesForRule({
      statusPageMonitorRuleId: RULE_ID,
    });

    expect(resourceDeleteSpy).not.toHaveBeenCalled();
  });

  it("stamps the project and the status page on what it creates", async () => {
    ruleFindOneByIdSpy.mockResolvedValue(
      fakeRule({ monitorLabels: [LABEL_PRODUCTION_ID] }),
    );
    monitorFindBySpy.mockResolvedValue([
      fakeMonitor(MONITOR_A_ID, { labels: [LABEL_PRODUCTION_ID] }),
    ]);

    await StatusPageMonitorRuleEngineService.syncResourcesForRule({
      statusPageMonitorRuleId: RULE_ID,
    });

    const resource: StatusPageResource = createdResource(resourceCreateSpy);

    expect(resource.projectId).toEqual(PROJECT_ID);
    expect(resource.statusPageId).toEqual(STATUS_PAGE_ID);
    expect(resource.monitorId).toEqual(MONITOR_A_ID);
  });

  it("defaults the display options to on when the rule sets none", async () => {
    ruleFindOneByIdSpy.mockResolvedValue(
      fakeRule({ monitorLabels: [LABEL_PRODUCTION_ID] }),
    );
    monitorFindBySpy.mockResolvedValue([
      fakeMonitor(MONITOR_A_ID, { labels: [LABEL_PRODUCTION_ID] }),
    ]);

    await StatusPageMonitorRuleEngineService.syncResourcesForRule({
      statusPageMonitorRuleId: RULE_ID,
    });

    const resource: StatusPageResource = createdResource(resourceCreateSpy);

    expect(resource.showCurrentStatus).toBe(true);
    expect(resource.showUptimePercent).toBe(true);
    expect(resource.showStatusHistoryChart).toBe(true);
    // Left unset rather than written as null, so the column default applies.
    expect(resource.uptimePercentPrecision).toBeUndefined();
  });

  /*
   * The label filter is the one criterion the database can evaluate, so it is
   * pushed into the query. A pattern-only rule must not send an empty `labels`
   * key, which would ask for monitors carrying no labels at all.
   */
  it("pushes the label filter into the monitor query when the rule names labels", async () => {
    ruleFindOneByIdSpy.mockResolvedValue(
      fakeRule({ monitorLabels: [LABEL_PRODUCTION_ID, LABEL_TIER1_ID] }),
    );
    monitorFindBySpy.mockResolvedValue([]);

    await StatusPageMonitorRuleEngineService.syncResourcesForRule({
      statusPageMonitorRuleId: RULE_ID,
    });

    const call: { query: { labels?: Array<ObjectID> } } = monitorFindBySpy.mock
      .calls[0]![0] as { query: { labels?: Array<ObjectID> } };

    expect(
      (call.query.labels || []).map((id: ObjectID) => {
        return id.toString();
      }),
    ).toEqual([LABEL_PRODUCTION_ID.toString(), LABEL_TIER1_ID.toString()]);
  });

  it("sends no labels key at all for a pattern-only rule", async () => {
    ruleFindOneByIdSpy.mockResolvedValue(
      fakeRule({ monitorNamePattern: "^api" }),
    );
    monitorFindBySpy.mockResolvedValue([]);

    await StatusPageMonitorRuleEngineService.syncResourcesForRule({
      statusPageMonitorRuleId: RULE_ID,
    });

    const call: { query: Record<string, unknown> } = monitorFindBySpy.mock
      .calls[0]![0] as { query: Record<string, unknown> };

    expect("labels" in call.query).toBe(false);
  });
});

describe("StatusPageMonitorRuleEngineService.syncRulesForMonitor", () => {
  let monitorFindOneByIdSpy: jest.SpyInstance;
  let ruleFindBySpy: jest.SpyInstance;
  let resourceFindBySpy: jest.SpyInstance;
  let resourceCreateSpy: jest.SpyInstance;
  let resourceDeleteSpy: jest.SpyInstance;
  let resourceUpdateSpy: jest.SpyInstance;

  beforeEach(() => {
    monitorFindOneByIdSpy = jest.spyOn(MonitorService, "findOneById");
    ruleFindBySpy = jest.spyOn(StatusPageMonitorRuleService, "findBy");
    resourceFindBySpy = jest
      .spyOn(StatusPageResourceService, "findBy")
      .mockResolvedValue([]);
    resourceCreateSpy = jest
      .spyOn(StatusPageResourceService, "create")
      .mockResolvedValue(new StatusPageResource());
    resourceDeleteSpy = jest
      .spyOn(StatusPageResourceService, "deleteOneById")
      .mockResolvedValue(1);
    resourceUpdateSpy = jest
      .spyOn(StatusPageResourceService, "updateOneById")
      .mockResolvedValue(1);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * Reconciling belongs to the rule-side path only. Nothing about the rule
   * moved here, so quietly reverting a per-resource tweak because somebody
   * relabelled an unrelated monitor would be a surprise with no cause the
   * user could see.
   */
  it("does not re-home drifted resources - only a rule edit does that", async () => {
    monitorFindOneByIdSpy.mockResolvedValue(
      fakeMonitor(MONITOR_A_ID, { labels: [LABEL_PRODUCTION_ID] }),
    );
    ruleFindBySpy.mockResolvedValue([
      fakeRule({
        monitorLabels: [LABEL_PRODUCTION_ID],
        statusPageGroupId: OTHER_GROUP_ID,
      }),
    ]);
    resourceFindBySpy.mockResolvedValue([
      fakeResource({
        id: RESOURCE_A_ID,
        monitorId: MONITOR_A_ID,
        statusPageMonitorRuleId: RULE_ID,
        statusPageGroupId: GROUP_ID,
      }),
    ]);

    await StatusPageMonitorRuleEngineService.syncRulesForMonitor({
      monitorId: MONITOR_A_ID,
    });

    expect(resourceUpdateSpy).not.toHaveBeenCalled();
  });

  /*
   * Two rules on one page can match the same monitor; only the first creates
   * the resource, so the page shows it once. When the monitor stops matching
   * the OWNING rule but still matches the other, the monitor must stay on the
   * page — and must do so whichever order the rules come back in, because
   * findBy gives no ordering guarantee.
   *
   * Interleaving adds and removes made this order-dependent: evaluate the
   * still-matching rule first and it skips the add (the monitor is still on
   * the page), then the owning rule deletes and the monitor silently
   * disappears from a public status page.
   */
  it("keeps a monitor on the page when one rule releases it and another still claims it", async () => {
    monitorFindOneByIdSpy.mockResolvedValue(
      fakeMonitor(MONITOR_A_ID, { labels: [LABEL_TIER1_ID] }),
    );

    // RULE_ID owns the resource but no longer matches. OTHER_RULE_ID matches.
    ruleFindBySpy.mockResolvedValue([
      fakeRule({ monitorLabels: [LABEL_PRODUCTION_ID] }),
      fakeRule({ id: OTHER_RULE_ID, monitorLabels: [LABEL_TIER1_ID] }),
    ]);

    /*
     * The page as each pass reads it: the resource is there until the removal
     * pass deletes it, and gone afterwards.
     */
    let isOnPage: boolean = true;
    resourceFindBySpy.mockImplementation(() => {
      return Promise.resolve(
        isOnPage
          ? [
              fakeResource({
                id: RESOURCE_A_ID,
                monitorId: MONITOR_A_ID,
                statusPageMonitorRuleId: RULE_ID,
              }),
            ]
          : [],
      );
    });
    resourceDeleteSpy.mockImplementation(() => {
      isOnPage = false;
      return Promise.resolve(1);
    });

    await StatusPageMonitorRuleEngineService.syncRulesForMonitor({
      monitorId: MONITOR_A_ID,
    });

    expect(resourceDeleteSpy).toHaveBeenCalledTimes(1);
    expect(resourceCreateSpy).toHaveBeenCalledTimes(1);
    expect(createdResource(resourceCreateSpy).statusPageMonitorRuleId).toEqual(
      OTHER_RULE_ID,
    );
  });

  it("holds that guarantee whichever order the rules come back in", async () => {
    monitorFindOneByIdSpy.mockResolvedValue(
      fakeMonitor(MONITOR_A_ID, { labels: [LABEL_TIER1_ID] }),
    );

    // Same as above, with the still-matching rule evaluated FIRST.
    ruleFindBySpy.mockResolvedValue([
      fakeRule({ id: OTHER_RULE_ID, monitorLabels: [LABEL_TIER1_ID] }),
      fakeRule({ monitorLabels: [LABEL_PRODUCTION_ID] }),
    ]);

    let isOnPage: boolean = true;
    resourceFindBySpy.mockImplementation(() => {
      return Promise.resolve(
        isOnPage
          ? [
              fakeResource({
                id: RESOURCE_A_ID,
                monitorId: MONITOR_A_ID,
                statusPageMonitorRuleId: RULE_ID,
              }),
            ]
          : [],
      );
    });
    resourceDeleteSpy.mockImplementation(() => {
      isOnPage = false;
      return Promise.resolve(1);
    });

    await StatusPageMonitorRuleEngineService.syncRulesForMonitor({
      monitorId: MONITOR_A_ID,
    });

    expect(resourceCreateSpy).toHaveBeenCalledTimes(1);
    expect(createdResource(resourceCreateSpy).statusPageMonitorRuleId).toEqual(
      OTHER_RULE_ID,
    );
  });

  it("adds the monitor to every status page whose rule it now matches", async () => {
    monitorFindOneByIdSpy.mockResolvedValue(
      fakeMonitor(MONITOR_A_ID, { labels: [LABEL_PRODUCTION_ID] }),
    );
    ruleFindBySpy.mockResolvedValue([
      fakeRule({ monitorLabels: [LABEL_PRODUCTION_ID] }),
      fakeRule({
        id: OTHER_RULE_ID,
        monitorLabels: [LABEL_PRODUCTION_ID],
        statusPageGroupId: GROUP_ID,
      }),
    ]);

    const results: Array<StatusPageMonitorRuleSyncResult> =
      await StatusPageMonitorRuleEngineService.syncRulesForMonitor({
        monitorId: MONITOR_A_ID,
      });

    expect(resourceCreateSpy).toHaveBeenCalledTimes(2);
    expect(results).toHaveLength(2);
  });

  it("only considers enabled rules", async () => {
    monitorFindOneByIdSpy.mockResolvedValue(
      fakeMonitor(MONITOR_A_ID, { labels: [LABEL_PRODUCTION_ID] }),
    );
    ruleFindBySpy.mockResolvedValue([]);

    await StatusPageMonitorRuleEngineService.syncRulesForMonitor({
      monitorId: MONITOR_A_ID,
    });

    const call: { query: { isEnabled: boolean } } = ruleFindBySpy.mock
      .calls[0]![0] as { query: { isEnabled: boolean } };

    expect(call.query.isEnabled).toBe(true);
  });

  it("removes the monitor from a page once it stops matching that page's rule", async () => {
    monitorFindOneByIdSpy.mockResolvedValue(
      fakeMonitor(MONITOR_A_ID, { labels: [LABEL_STAGING_ID] }),
    );
    ruleFindBySpy.mockResolvedValue([
      fakeRule({ monitorLabels: [LABEL_PRODUCTION_ID] }),
    ]);
    resourceFindBySpy.mockResolvedValue([
      fakeResource({
        id: RESOURCE_A_ID,
        monitorId: MONITOR_A_ID,
        statusPageMonitorRuleId: RULE_ID,
      }),
    ]);

    const results: Array<StatusPageMonitorRuleSyncResult> =
      await StatusPageMonitorRuleEngineService.syncRulesForMonitor({
        monitorId: MONITOR_A_ID,
      });

    expect(results[0]!.statusPageResourceIdsRemoved).toEqual([
      RESOURCE_A_ID.toString(),
    ]);
  });

  /*
   * The monitor-side path knows about one monitor. Every other monitor the
   * rule owns is somebody else's business and must survive untouched.
   */
  it("leaves the rule's other monitors alone", async () => {
    monitorFindOneByIdSpy.mockResolvedValue(
      fakeMonitor(MONITOR_A_ID, { labels: [LABEL_STAGING_ID] }),
    );
    ruleFindBySpy.mockResolvedValue([
      fakeRule({ monitorLabels: [LABEL_PRODUCTION_ID] }),
    ]);
    resourceFindBySpy.mockResolvedValue([
      fakeResource({
        id: RESOURCE_A_ID,
        monitorId: MONITOR_A_ID,
        statusPageMonitorRuleId: RULE_ID,
      }),
      fakeResource({
        id: RESOURCE_B_ID,
        monitorId: MONITOR_B_ID,
        statusPageMonitorRuleId: RULE_ID,
      }),
    ]);

    await StatusPageMonitorRuleEngineService.syncRulesForMonitor({
      monitorId: MONITOR_A_ID,
    });

    expect(resourceDeleteSpy).toHaveBeenCalledTimes(1);
    const call: { id: ObjectID } = resourceDeleteSpy.mock.calls[0]![0] as {
      id: ObjectID;
    };
    expect(call.id).toEqual(RESOURCE_A_ID);
  });

  it("still refuses to remove the monitor's manual resource", async () => {
    monitorFindOneByIdSpy.mockResolvedValue(
      fakeMonitor(MONITOR_A_ID, { labels: [LABEL_STAGING_ID] }),
    );
    ruleFindBySpy.mockResolvedValue([
      fakeRule({ monitorLabels: [LABEL_PRODUCTION_ID] }),
    ]);
    resourceFindBySpy.mockResolvedValue([
      fakeResource({ id: RESOURCE_A_ID, monitorId: MONITOR_A_ID }),
    ]);

    await StatusPageMonitorRuleEngineService.syncRulesForMonitor({
      monitorId: MONITOR_A_ID,
    });

    expect(resourceDeleteSpy).not.toHaveBeenCalled();
  });

  it("reports nothing for rules that were already in the right state", async () => {
    monitorFindOneByIdSpy.mockResolvedValue(
      fakeMonitor(MONITOR_C_ID, { labels: [LABEL_STAGING_ID] }),
    );
    ruleFindBySpy.mockResolvedValue([
      fakeRule({ monitorLabels: [LABEL_PRODUCTION_ID] }),
    ]);

    const results: Array<StatusPageMonitorRuleSyncResult> =
      await StatusPageMonitorRuleEngineService.syncRulesForMonitor({
        monitorId: MONITOR_C_ID,
      });

    expect(results).toEqual([]);
  });

  it("keeps going after one rule fails - the monitor has already changed", async () => {
    monitorFindOneByIdSpy.mockResolvedValue(
      fakeMonitor(MONITOR_A_ID, { labels: [LABEL_PRODUCTION_ID] }),
    );
    ruleFindBySpy.mockResolvedValue([
      fakeRule({ monitorLabels: [LABEL_PRODUCTION_ID] }),
      fakeRule({ id: OTHER_RULE_ID, monitorLabels: [LABEL_PRODUCTION_ID] }),
    ]);
    resourceCreateSpy
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValueOnce(new StatusPageResource());

    const results: Array<StatusPageMonitorRuleSyncResult> =
      await StatusPageMonitorRuleEngineService.syncRulesForMonitor({
        monitorId: MONITOR_A_ID,
      });

    expect(results).toHaveLength(1);
    expect(results[0]!.monitorIdsAdded).toEqual([MONITOR_A_ID.toString()]);
  });

  it("does nothing for a monitor that no longer exists", async () => {
    monitorFindOneByIdSpy.mockResolvedValue(null);

    const results: Array<StatusPageMonitorRuleSyncResult> =
      await StatusPageMonitorRuleEngineService.syncRulesForMonitor({
        monitorId: MONITOR_A_ID,
      });

    expect(results).toEqual([]);
    expect(ruleFindBySpy).not.toHaveBeenCalled();
  });

  it("falls back to the caller's project id when the monitor row does not carry one", async () => {
    monitorFindOneByIdSpy.mockResolvedValue(
      fakeMonitor(MONITOR_A_ID, {
        projectId: null,
        labels: [LABEL_PRODUCTION_ID],
      }),
    );
    ruleFindBySpy.mockResolvedValue([]);

    await StatusPageMonitorRuleEngineService.syncRulesForMonitor({
      monitorId: MONITOR_A_ID,
      projectId: PROJECT_ID,
    });

    const call: { query: { projectId: ObjectID } } = ruleFindBySpy.mock
      .calls[0]![0] as { query: { projectId: ObjectID } };

    expect(call.query.projectId).toEqual(PROJECT_ID);
  });

  /*
   * Two rules on one page both wanting the same monitor is ordinary
   * configuration (a broad rule and a narrow one). The page must list it once.
   */
  it("gives a monitor exactly one resource when two rules on the same page match it", async () => {
    monitorFindOneByIdSpy.mockResolvedValue(
      fakeMonitor(MONITOR_A_ID, {
        labels: [LABEL_PRODUCTION_ID, LABEL_TIER1_ID],
      }),
    );
    ruleFindBySpy.mockResolvedValue([
      fakeRule({ monitorLabels: [LABEL_PRODUCTION_ID] }),
      fakeRule({ id: OTHER_RULE_ID, monitorLabels: [LABEL_TIER1_ID] }),
    ]);

    // Once the first rule creates the resource, the page has it.
    let created: Array<StatusPageResource> = [];
    resourceFindBySpy.mockImplementation(() => {
      return Promise.resolve(created);
    });
    resourceCreateSpy.mockImplementation(() => {
      created = [
        fakeResource({
          id: RESOURCE_A_ID,
          monitorId: MONITOR_A_ID,
          statusPageMonitorRuleId: RULE_ID,
        }),
      ];
      return Promise.resolve(new StatusPageResource());
    });

    await StatusPageMonitorRuleEngineService.syncRulesForMonitor({
      monitorId: MONITOR_A_ID,
    });

    expect(resourceCreateSpy).toHaveBeenCalledTimes(1);
  });

  it("skips a rule row that came back without a status page", async () => {
    monitorFindOneByIdSpy.mockResolvedValue(
      fakeMonitor(MONITOR_A_ID, { labels: [LABEL_PRODUCTION_ID] }),
    );
    ruleFindBySpy.mockResolvedValue([
      fakeRule({
        statusPageId: null,
        monitorLabels: [LABEL_PRODUCTION_ID],
      }),
    ]);

    const results: Array<StatusPageMonitorRuleSyncResult> =
      await StatusPageMonitorRuleEngineService.syncRulesForMonitor({
        monitorId: MONITOR_A_ID,
      });

    expect(results).toEqual([]);
    expect(resourceCreateSpy).not.toHaveBeenCalled();
  });

  it("does nothing when no project id can be resolved at all", async () => {
    monitorFindOneByIdSpy.mockResolvedValue(
      fakeMonitor(MONITOR_A_ID, { projectId: null }),
    );

    const results: Array<StatusPageMonitorRuleSyncResult> =
      await StatusPageMonitorRuleEngineService.syncRulesForMonitor({
        monitorId: MONITOR_A_ID,
      });

    expect(results).toEqual([]);
    expect(ruleFindBySpy).not.toHaveBeenCalled();
  });
});

describe("StatusPageMonitorRuleEngineService.removeResourcesAddedByRule", () => {
  let resourceFindBySpy: jest.SpyInstance;
  let resourceDeleteSpy: jest.SpyInstance;

  beforeEach(() => {
    resourceFindBySpy = jest.spyOn(StatusPageResourceService, "findBy");
    resourceDeleteSpy = jest
      .spyOn(StatusPageResourceService, "deleteOneById")
      .mockResolvedValue(1);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("deletes every resource the rule added", async () => {
    resourceFindBySpy.mockResolvedValue([
      fakeResource({
        id: RESOURCE_A_ID,
        monitorId: MONITOR_A_ID,
        statusPageMonitorRuleId: RULE_ID,
      }),
      fakeResource({
        id: RESOURCE_B_ID,
        monitorId: MONITOR_B_ID,
        statusPageMonitorRuleId: RULE_ID,
      }),
    ]);

    const removed: Array<string> =
      await StatusPageMonitorRuleEngineService.removeResourcesAddedByRule({
        statusPageMonitorRuleId: RULE_ID,
      });

    expect(resourceDeleteSpy).toHaveBeenCalledTimes(2);
    expect(removed.sort()).toEqual(
      [RESOURCE_A_ID.toString(), RESOURCE_B_ID.toString()].sort(),
    );
  });

  it("asks only for resources stamped with this rule, so manual ones are never in range", async () => {
    resourceFindBySpy.mockResolvedValue([]);

    await StatusPageMonitorRuleEngineService.removeResourcesAddedByRule({
      statusPageMonitorRuleId: RULE_ID,
    });

    const call: { query: { statusPageMonitorRuleId: ObjectID } } =
      resourceFindBySpy.mock.calls[0]![0] as {
        query: { statusPageMonitorRuleId: ObjectID };
      };

    expect(call.query.statusPageMonitorRuleId).toEqual(RULE_ID);
  });

  it("returns an empty list when the rule added nothing", async () => {
    resourceFindBySpy.mockResolvedValue([]);

    const removed: Array<string> =
      await StatusPageMonitorRuleEngineService.removeResourcesAddedByRule({
        statusPageMonitorRuleId: RULE_ID,
      });

    expect(removed).toEqual([]);
    expect(resourceDeleteSpy).not.toHaveBeenCalled();
  });
});
