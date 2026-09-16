import AlertEpisodeFeedService from "../../../../Server/Services/AlertEpisodeFeedService";
import AlertEpisodePrivacyRuleEngineService from "../../../../Server/Services/AlertEpisodePrivacyRuleEngineService";
import AlertEpisodePrivacyRuleService from "../../../../Server/Services/AlertEpisodePrivacyRuleService";
import AlertEpisodeService from "../../../../Server/Services/AlertEpisodeService";
import AlertFeedService from "../../../../Server/Services/AlertFeedService";
import AlertPrivacyRuleEngineService from "../../../../Server/Services/AlertPrivacyRuleEngineService";
import AlertPrivacyRuleService from "../../../../Server/Services/AlertPrivacyRuleService";
import AlertService from "../../../../Server/Services/AlertService";
import IncidentEpisodeFeedService from "../../../../Server/Services/IncidentEpisodeFeedService";
import IncidentEpisodePrivacyRuleEngineService from "../../../../Server/Services/IncidentEpisodePrivacyRuleEngineService";
import IncidentEpisodePrivacyRuleService from "../../../../Server/Services/IncidentEpisodePrivacyRuleService";
import IncidentEpisodeService from "../../../../Server/Services/IncidentEpisodeService";
import IncidentFeedService from "../../../../Server/Services/IncidentFeedService";
import IncidentPrivacyRuleEngineService from "../../../../Server/Services/IncidentPrivacyRuleEngineService";
import IncidentPrivacyRuleService from "../../../../Server/Services/IncidentPrivacyRuleService";
import IncidentService from "../../../../Server/Services/IncidentService";
import MonitorService from "../../../../Server/Services/MonitorService";
import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../../Models/DatabaseModels/AlertEpisode";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../../Models/DatabaseModels/IncidentEpisode";
import Label from "../../../../Models/DatabaseModels/Label";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import ObjectID from "../../../../Types/ObjectID";
import {
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaOperator,
} from "../../../../Types/Rules/RuleCriteria";
import { MAX_RULES_EVALUATED_PER_PROJECT } from "../../../../Utils/Rules/RuleEngineLimits";
import {
  RuleApplicationResult,
  RuleApplicationResultUtil,
} from "../../../../Server/Utils/Rules/RuleRun/RuleApplication";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test - "Run now" for privacy rules.
 *
 * A privacy rule has no action of its own: any enabled rule that matches
 * marks the incident / alert / episode private. The create hook skips a
 * resource that is already private, because there is nothing left to do. A
 * run cannot skip it, because the person running the rule wants to know that
 * the rule covers it - so a run evaluates the match regardless and reports
 * "already private" as already applied, not as a non-match.
 *
 * Evaluation reads every matched field straight off the resource object, so
 * the columns a run reads (resourceSelectForRuleRun) have to name all of
 * them. A field missing from that select would make a run silently never
 * match on it, which is why every field below gets a run that matches on it
 * alone.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const RESOURCE_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);
const RULE_ID: ObjectID = new ObjectID("77777777-7777-4777-8777-777777777777");
const SEVERITY_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const OTHER_SEVERITY_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const LABEL_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const OTHER_LABEL_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const OTHER_MONITOR_ID: ObjectID = new ObjectID(
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
);

const RULE_NAME: string = "Keep customer data private";

// What every privacy resource looks like to these tests.
interface PrivateResource {
  id?: ObjectID | undefined;
  projectId?: ObjectID | undefined;
  isPrivate?: boolean | undefined;
}

type RuleFields = Record<string, unknown>;

// The run-facing surface all four engines share, erased of their model types.
interface PrivacyRuleRunEngine {
  ruleSelect: Record<string, unknown>;
  resourceSelectForRuleRun: Record<string, unknown>;
  applyRulesToExistingResource: (data: {
    resource: PrivateResource;
    rules: Array<RuleFields>;
    allowOwnerNotification: boolean;
  }) => Promise<RuleApplicationResult>;
}

interface EngineMocks {
  findRules: jest.SpyInstance;
  updateOneById: jest.SpyInstance;
  createFeedItem: jest.SpyInstance;
}

interface PrivacyEngineCase {
  name: string;
  engine: PrivacyRuleRunEngine;
  applyCreateHook: (resource: PrivateResource) => Promise<boolean>;
  mockServices: () => EngineMocks;
  // The key the feed item names the resource by.
  feedResourceIdKey: string;
  // Rule-side field names.
  titlePatternField: string;
  descriptionPatternField: string;
  labelsField: string;
  severitiesField: string;
  // Resource-side severity column.
  severityIdField: string;
  expectedResourceSelect: Record<string, unknown>;
}

function fakeLabel(id: ObjectID): Label {
  return { id: id, _id: id.toString() } as unknown as Label;
}

function idStub(id: ObjectID): { id: ObjectID; _id: string } {
  return { id: id, _id: id.toString() };
}

function fakeResource(
  engineCase: PrivacyEngineCase,
  overrides: Record<string, unknown> = {},
): PrivateResource {
  return {
    id: RESOURCE_ID,
    _id: RESOURCE_ID.toString(),
    projectId: PROJECT_ID,
    title: "Production API outage",
    description: "Customer checkout is unavailable",
    labels: [],
    [engineCase.severityIdField]: OTHER_SEVERITY_ID,
    ...overrides,
  } as unknown as PrivateResource;
}

function fakeRule(fields: RuleFields = {}): RuleFields {
  return {
    id: RULE_ID,
    _id: RULE_ID.toString(),
    name: RULE_NAME,
    ...fields,
  };
}

function titleRule(engineCase: PrivacyEngineCase): RuleFields {
  return fakeRule({ [engineCase.titlePatternField]: "^production" });
}

function nonMatchingTitleRule(engineCase: PrivacyEngineCase): RuleFields {
  return fakeRule({ [engineCase.titlePatternField]: "^staging" });
}

function run(
  engineCase: PrivacyEngineCase,
  resource: PrivateResource,
  rules: Array<RuleFields>,
): Promise<RuleApplicationResult> {
  return engineCase.engine.applyRulesToExistingResource({
    resource: resource,
    rules: rules,
    allowOwnerNotification: false,
  });
}

const engineCases: Array<PrivacyEngineCase> = [
  {
    name: "IncidentPrivacyRuleEngineService",
    engine: IncidentPrivacyRuleEngineService as unknown as PrivacyRuleRunEngine,
    applyCreateHook: (resource: PrivateResource): Promise<boolean> => {
      return IncidentPrivacyRuleEngineService.applyRulesToIncident(
        resource as unknown as Incident,
      );
    },
    mockServices: (): EngineMocks => {
      return {
        findRules: jest
          .spyOn(IncidentPrivacyRuleService, "findBy")
          .mockResolvedValue([]),
        updateOneById: jest
          .spyOn(IncidentService, "updateOneById")
          .mockResolvedValue(undefined as any),
        createFeedItem: jest
          .spyOn(IncidentFeedService, "createIncidentFeedItem")
          .mockResolvedValue(undefined as any),
      };
    },
    feedResourceIdKey: "incidentId",
    titlePatternField: "incidentTitlePattern",
    descriptionPatternField: "incidentDescriptionPattern",
    labelsField: "incidentLabels",
    severitiesField: "incidentSeverities",
    severityIdField: "incidentSeverityId",
    expectedResourceSelect: {
      _id: true,
      projectId: true,
      isPrivate: true,
      title: true,
      description: true,
      incidentSeverityId: true,
      monitors: { _id: true },
      labels: { _id: true },
    },
  },
  {
    name: "AlertPrivacyRuleEngineService",
    engine: AlertPrivacyRuleEngineService as unknown as PrivacyRuleRunEngine,
    applyCreateHook: (resource: PrivateResource): Promise<boolean> => {
      return AlertPrivacyRuleEngineService.applyRulesToAlert(
        resource as unknown as Alert,
      );
    },
    mockServices: (): EngineMocks => {
      return {
        findRules: jest
          .spyOn(AlertPrivacyRuleService, "findBy")
          .mockResolvedValue([]),
        updateOneById: jest
          .spyOn(AlertService, "updateOneById")
          .mockResolvedValue(undefined as any),
        createFeedItem: jest
          .spyOn(AlertFeedService, "createAlertFeedItem")
          .mockResolvedValue(undefined as any),
      };
    },
    feedResourceIdKey: "alertId",
    titlePatternField: "alertTitlePattern",
    descriptionPatternField: "alertDescriptionPattern",
    labelsField: "alertLabels",
    severitiesField: "alertSeverities",
    severityIdField: "alertSeverityId",
    expectedResourceSelect: {
      _id: true,
      projectId: true,
      isPrivate: true,
      title: true,
      description: true,
      alertSeverityId: true,
      monitorId: true,
      labels: { _id: true },
    },
  },
  {
    name: "IncidentEpisodePrivacyRuleEngineService",
    engine:
      IncidentEpisodePrivacyRuleEngineService as unknown as PrivacyRuleRunEngine,
    applyCreateHook: (resource: PrivateResource): Promise<boolean> => {
      return IncidentEpisodePrivacyRuleEngineService.applyRulesToEpisode(
        resource as unknown as IncidentEpisode,
      );
    },
    mockServices: (): EngineMocks => {
      return {
        findRules: jest
          .spyOn(IncidentEpisodePrivacyRuleService, "findBy")
          .mockResolvedValue([]),
        updateOneById: jest
          .spyOn(IncidentEpisodeService, "updateOneById")
          .mockResolvedValue(undefined as any),
        createFeedItem: jest
          .spyOn(IncidentEpisodeFeedService, "createIncidentEpisodeFeedItem")
          .mockResolvedValue(undefined as any),
      };
    },
    feedResourceIdKey: "incidentEpisodeId",
    titlePatternField: "episodeTitlePattern",
    descriptionPatternField: "episodeDescriptionPattern",
    labelsField: "episodeLabels",
    severitiesField: "incidentSeverities",
    severityIdField: "incidentSeverityId",
    expectedResourceSelect: {
      _id: true,
      projectId: true,
      isPrivate: true,
      title: true,
      description: true,
      incidentSeverityId: true,
      labels: { _id: true },
    },
  },
  {
    name: "AlertEpisodePrivacyRuleEngineService",
    engine:
      AlertEpisodePrivacyRuleEngineService as unknown as PrivacyRuleRunEngine,
    applyCreateHook: (resource: PrivateResource): Promise<boolean> => {
      return AlertEpisodePrivacyRuleEngineService.applyRulesToEpisode(
        resource as unknown as AlertEpisode,
      );
    },
    mockServices: (): EngineMocks => {
      return {
        findRules: jest
          .spyOn(AlertEpisodePrivacyRuleService, "findBy")
          .mockResolvedValue([]),
        updateOneById: jest
          .spyOn(AlertEpisodeService, "updateOneById")
          .mockResolvedValue(undefined as any),
        createFeedItem: jest
          .spyOn(AlertEpisodeFeedService, "createAlertEpisodeFeedItem")
          .mockResolvedValue(undefined as any),
      };
    },
    feedResourceIdKey: "alertEpisodeId",
    titlePatternField: "episodeTitlePattern",
    descriptionPatternField: "episodeDescriptionPattern",
    labelsField: "episodeLabels",
    severitiesField: "alertSeverities",
    severityIdField: "alertSeverityId",
    expectedResourceSelect: {
      _id: true,
      projectId: true,
      isPrivate: true,
      title: true,
      description: true,
      alertSeverityId: true,
      labels: { _id: true },
    },
  },
];

function silenceLogs(): void {
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
  jest.spyOn(console, "log").mockImplementation(() => {});
  jest.spyOn(console, "debug").mockImplementation(() => {});
  jest.spyOn(console, "info").mockImplementation(() => {});
}

describe.each(engineCases)(
  "$name rule run",
  (engineCase: PrivacyEngineCase) => {
    let mocks: EngineMocks;

    beforeEach(() => {
      silenceLogs();
      mocks = engineCase.mockServices();
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    describe("selects", () => {
      it("reads criteria as part of the rule select", () => {
        expect(engineCase.engine.ruleSelect["criteria"]).toBe(true);
        expect(engineCase.engine.ruleSelect["name"]).toBe(true);
      });

      it("names isPrivate and every field evaluation reads off the resource", () => {
        expect(engineCase.engine.resourceSelectForRuleRun).toEqual(
          engineCase.expectedResourceSelect,
        );
      });
    });

    describe("applyRulesToExistingResource", () => {
      it("marks a matching resource private and reports one update", async () => {
        const resource: PrivateResource = fakeResource(engineCase);

        const result: RuleApplicationResult = await run(engineCase, resource, [
          titleRule(engineCase),
        ]);

        expect(result).toEqual(RuleApplicationResultUtil.updated(1));
        expect(mocks.updateOneById).toHaveBeenCalledTimes(1);
        expect(mocks.updateOneById).toHaveBeenCalledWith({
          id: RESOURCE_ID,
          data: { isPrivate: true },
          props: { isRoot: true },
        });
        expect(resource.isPrivate).toBe(true);
      });

      it("writes a feed item naming the rule", async () => {
        await run(engineCase, fakeResource(engineCase), [
          titleRule(engineCase),
        ]);

        expect(mocks.createFeedItem).toHaveBeenCalledTimes(1);
        const feedItem: Record<string, unknown> = mocks.createFeedItem.mock
          .calls[0]![0] as Record<string, unknown>;
        expect(feedItem[engineCase.feedResourceIdKey]).toBe(RESOURCE_ID);
        expect(feedItem["projectId"]).toBe(PROJECT_ID);
        expect(feedItem["feedInfoInMarkdown"]).toContain(RULE_NAME);
      });

      // A run hands the engine its rule; it must not go and read the project's.
      it("evaluates only the rules it is given", async () => {
        await run(engineCase, fakeResource(engineCase), [
          titleRule(engineCase),
        ]);

        expect(mocks.findRules).not.toHaveBeenCalled();
      });

      it("reports an already-private matching resource as already applied, without writing", async () => {
        const resource: PrivateResource = fakeResource(engineCase, {
          isPrivate: true,
        });

        const result: RuleApplicationResult = await run(engineCase, resource, [
          titleRule(engineCase),
        ]);

        expect(result).toEqual(RuleApplicationResultUtil.alreadyApplied());
        expect(mocks.updateOneById).not.toHaveBeenCalled();
        expect(mocks.createFeedItem).not.toHaveBeenCalled();
        expect(resource.isPrivate).toBe(true);
      });

      /*
       * "Already private" is only reported for a resource the rule covers.
       * One the rule does not match is a non-match whatever its privacy.
       */
      it("reports an already-private resource the rule does not match as no match", async () => {
        const result: RuleApplicationResult = await run(
          engineCase,
          fakeResource(engineCase, { isPrivate: true }),
          [nonMatchingTitleRule(engineCase)],
        );

        expect(result).toEqual(RuleApplicationResultUtil.noMatch());
        expect(mocks.updateOneById).not.toHaveBeenCalled();
      });

      it("reports a resource the rule does not match as no match, without writing", async () => {
        const resource: PrivateResource = fakeResource(engineCase);

        const result: RuleApplicationResult = await run(engineCase, resource, [
          nonMatchingTitleRule(engineCase),
        ]);

        expect(result).toEqual(RuleApplicationResultUtil.noMatch());
        expect(mocks.updateOneById).not.toHaveBeenCalled();
        expect(mocks.createFeedItem).not.toHaveBeenCalled();
        expect(resource.isPrivate).toBeUndefined();
      });

      it("reports no match when given no rules", async () => {
        const result: RuleApplicationResult = await run(
          engineCase,
          fakeResource(engineCase),
          [],
        );

        expect(result).toEqual(RuleApplicationResultUtil.noMatch());
        expect(mocks.updateOneById).not.toHaveBeenCalled();
      });

      it("reports no match for a resource without an id", async () => {
        const result: RuleApplicationResult = await run(
          engineCase,
          fakeResource(engineCase, { id: undefined }),
          [titleRule(engineCase)],
        );

        expect(result).toEqual(RuleApplicationResultUtil.noMatch());
        expect(mocks.updateOneById).not.toHaveBeenCalled();
      });

      it("reports a failed write as failed instead of throwing", async () => {
        mocks.updateOneById.mockRejectedValue(new Error("connection reset"));
        const resource: PrivateResource = fakeResource(engineCase);

        const result: RuleApplicationResult = await run(engineCase, resource, [
          titleRule(engineCase),
        ]);

        expect(result).toEqual(RuleApplicationResultUtil.failed());
        expect(mocks.createFeedItem).not.toHaveBeenCalled();
        expect(resource.isPrivate).toBeUndefined();
      });

      // The resource did become private; a lost feed item does not undo that.
      it("still reports the update when only the feed item fails", async () => {
        mocks.createFeedItem.mockRejectedValue(new Error("feed down"));

        const result: RuleApplicationResult = await run(
          engineCase,
          fakeResource(engineCase),
          [titleRule(engineCase)],
        );

        expect(result).toEqual(RuleApplicationResultUtil.updated(1));
      });

      it("matches on the description pattern", async () => {
        const result: RuleApplicationResult = await run(
          engineCase,
          fakeResource(engineCase),
          [fakeRule({ [engineCase.descriptionPatternField]: "checkout" })],
        );

        expect(result).toEqual(RuleApplicationResultUtil.updated(1));
      });

      it("matches on severity", async () => {
        const rule: RuleFields = fakeRule({
          [engineCase.severitiesField]: [idStub(SEVERITY_ID)],
        });

        await expect(
          run(
            engineCase,
            fakeResource(engineCase, {
              [engineCase.severityIdField]: SEVERITY_ID,
            }),
            [rule],
          ),
        ).resolves.toEqual(RuleApplicationResultUtil.updated(1));

        await expect(
          run(engineCase, fakeResource(engineCase), [rule]),
        ).resolves.toEqual(RuleApplicationResultUtil.noMatch());
      });

      it("matches on labels", async () => {
        const rule: RuleFields = fakeRule({
          [engineCase.labelsField]: [fakeLabel(LABEL_ID)],
        });

        await expect(
          run(
            engineCase,
            fakeResource(engineCase, {
              labels: [fakeLabel(OTHER_LABEL_ID), fakeLabel(LABEL_ID)],
            }),
            [rule],
          ),
        ).resolves.toEqual(RuleApplicationResultUtil.updated(1));

        await expect(
          run(
            engineCase,
            fakeResource(engineCase, { labels: [fakeLabel(OTHER_LABEL_ID)] }),
            [rule],
          ),
        ).resolves.toEqual(RuleApplicationResultUtil.noMatch());
      });

      it("evaluates configurable criteria", async () => {
        const rule: RuleFields = fakeRule({
          // A stale legacy value criteria must override.
          [engineCase.titlePatternField]: "^staging",
          criteria: {
            schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
            filterCondition: FilterCondition.All,
            filters: [
              {
                field: engineCase.titlePatternField,
                operator: RuleCriteriaOperator.Contains,
                value: "api",
              },
              {
                field: engineCase.labelsField,
                operator: RuleCriteriaOperator.HasNoneOf,
                value: [OTHER_LABEL_ID.toString()],
              },
            ],
          },
        });

        await expect(
          run(engineCase, fakeResource(engineCase), [rule]),
        ).resolves.toEqual(RuleApplicationResultUtil.updated(1));

        await expect(
          run(
            engineCase,
            fakeResource(engineCase, { labels: [fakeLabel(OTHER_LABEL_ID)] }),
            [rule],
          ),
        ).resolves.toEqual(RuleApplicationResultUtil.noMatch());
      });
    });

    describe("create hook", () => {
      it("reads the project's enabled rules with the shared rule select", async () => {
        await engineCase.applyCreateHook(fakeResource(engineCase));

        expect(mocks.findRules).toHaveBeenCalledTimes(1);
        const findBy: Record<string, any> = mocks.findRules.mock
          .calls[0]![0] as Record<string, any>;
        expect(findBy["select"]).toBe(engineCase.engine.ruleSelect);
        expect(findBy["limit"]).toBe(MAX_RULES_EVALUATED_PER_PROJECT);
        expect(findBy["skip"]).toBe(0);
        expect(findBy["query"]["projectId"]).toBe(PROJECT_ID);
        expect(findBy["query"]["isEnabled"]).toBe(true);
      });

      it("returns true and marks the resource private when a rule matches", async () => {
        mocks.findRules.mockResolvedValue([titleRule(engineCase)]);
        const resource: PrivateResource = fakeResource(engineCase);

        await expect(engineCase.applyCreateHook(resource)).resolves.toBe(true);

        expect(mocks.updateOneById).toHaveBeenCalledWith({
          id: RESOURCE_ID,
          data: { isPrivate: true },
          props: { isRoot: true },
        });
        expect(resource.isPrivate).toBe(true);
        expect(mocks.createFeedItem).toHaveBeenCalledTimes(1);
      });

      it("returns false when no rule matches", async () => {
        mocks.findRules.mockResolvedValue([nonMatchingTitleRule(engineCase)]);

        await expect(
          engineCase.applyCreateHook(fakeResource(engineCase)),
        ).resolves.toBe(false);
        expect(mocks.updateOneById).not.toHaveBeenCalled();
      });

      it("returns false when the project has no enabled rules", async () => {
        await expect(
          engineCase.applyCreateHook(fakeResource(engineCase)),
        ).resolves.toBe(false);
        expect(mocks.updateOneById).not.toHaveBeenCalled();
      });

      it("skips an already-private resource without reading rules", async () => {
        mocks.findRules.mockResolvedValue([titleRule(engineCase)]);

        await expect(
          engineCase.applyCreateHook(
            fakeResource(engineCase, { isPrivate: true }),
          ),
        ).resolves.toBe(false);
        expect(mocks.findRules).not.toHaveBeenCalled();
        expect(mocks.updateOneById).not.toHaveBeenCalled();
      });

      it("returns false instead of throwing when the write fails", async () => {
        mocks.findRules.mockResolvedValue([titleRule(engineCase)]);
        mocks.updateOneById.mockRejectedValue(new Error("connection reset"));

        await expect(
          engineCase.applyCreateHook(fakeResource(engineCase)),
        ).resolves.toBe(false);
      });

      it("returns false instead of throwing when the rule read fails", async () => {
        mocks.findRules.mockRejectedValue(new Error("connection reset"));

        await expect(
          engineCase.applyCreateHook(fakeResource(engineCase)),
        ).resolves.toBe(false);
        expect(mocks.updateOneById).not.toHaveBeenCalled();
      });
    });
  },
);

/*
 * Incidents and alerts also match on their monitors. A run passes the
 * resource as read with resourceSelectForRuleRun, so the monitor ids have to
 * be on it; the monitor's own name and labels are re-read by id.
 */
describe("IncidentPrivacyRuleEngineService rule run - monitor criteria", () => {
  let updateOneById: jest.SpyInstance;

  beforeEach(() => {
    silenceLogs();
    updateOneById = jest
      .spyOn(IncidentService, "updateOneById")
      .mockResolvedValue(undefined as any);
    jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockResolvedValue(undefined as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function incident(monitorIds: Array<ObjectID>): Incident {
    return {
      id: RESOURCE_ID,
      _id: RESOURCE_ID.toString(),
      projectId: PROJECT_ID,
      title: "Production API outage",
      monitors: monitorIds.map((id: ObjectID) => {
        return { id: id, _id: id.toString() } as unknown as Monitor;
      }),
    } as unknown as Incident;
  }

  function runIncident(
    resource: Incident,
    rule: RuleFields,
  ): Promise<RuleApplicationResult> {
    return IncidentPrivacyRuleEngineService.applyRulesToExistingResource({
      resource: resource,
      rules: [fakeRule(rule) as never],
      allowOwnerNotification: false,
    });
  }

  it("matches a rule scoped to one of the incident's monitors", async () => {
    await expect(
      runIncident(incident([OTHER_MONITOR_ID, MONITOR_ID]), {
        monitors: [idStub(MONITOR_ID)],
      }),
    ).resolves.toEqual(RuleApplicationResultUtil.updated(1));
    expect(updateOneById).toHaveBeenCalledTimes(1);

    await expect(
      runIncident(incident([OTHER_MONITOR_ID]), {
        monitors: [idStub(MONITOR_ID)],
      }),
    ).resolves.toEqual(RuleApplicationResultUtil.noMatch());
  });

  it("matches a monitor-name rule through the incident's monitors", async () => {
    const findMonitor: jest.SpyInstance = jest
      .spyOn(MonitorService, "findOneById")
      .mockImplementation(async (data: any): Promise<any> => {
        return {
          id: data.id,
          name:
            data.id.toString() === MONITOR_ID.toString()
              ? "checkout-api"
              : "background-worker",
          labels: [],
        } as unknown as Monitor;
      });

    await expect(
      runIncident(incident([OTHER_MONITOR_ID, MONITOR_ID]), {
        monitorNamePattern: "checkout",
      }),
    ).resolves.toEqual(RuleApplicationResultUtil.updated(1));
    expect(findMonitor).toHaveBeenCalledTimes(2);

    await expect(
      runIncident(incident([OTHER_MONITOR_ID]), {
        monitorNamePattern: "checkout",
      }),
    ).resolves.toEqual(RuleApplicationResultUtil.noMatch());
  });

  it("does not match monitor criteria on an incident read without monitors", async () => {
    await expect(
      runIncident(incident([]), { monitors: [idStub(MONITOR_ID)] }),
    ).resolves.toEqual(RuleApplicationResultUtil.noMatch());
    expect(updateOneById).not.toHaveBeenCalled();
  });
});

describe("AlertPrivacyRuleEngineService rule run - monitor criteria", () => {
  let updateOneById: jest.SpyInstance;

  beforeEach(() => {
    silenceLogs();
    updateOneById = jest
      .spyOn(AlertService, "updateOneById")
      .mockResolvedValue(undefined as any);
    jest
      .spyOn(AlertFeedService, "createAlertFeedItem")
      .mockResolvedValue(undefined as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function alert(monitorId: ObjectID | undefined): Alert {
    return {
      id: RESOURCE_ID,
      _id: RESOURCE_ID.toString(),
      projectId: PROJECT_ID,
      title: "Production API failure",
      monitorId: monitorId,
    } as unknown as Alert;
  }

  function runAlert(
    resource: Alert,
    rule: RuleFields,
  ): Promise<RuleApplicationResult> {
    return AlertPrivacyRuleEngineService.applyRulesToExistingResource({
      resource: resource,
      rules: [fakeRule(rule) as never],
      allowOwnerNotification: false,
    });
  }

  it("matches a rule scoped to the alert's monitor", async () => {
    await expect(
      runAlert(alert(MONITOR_ID), { monitors: [idStub(MONITOR_ID)] }),
    ).resolves.toEqual(RuleApplicationResultUtil.updated(1));
    expect(updateOneById).toHaveBeenCalledTimes(1);

    await expect(
      runAlert(alert(OTHER_MONITOR_ID), { monitors: [idStub(MONITOR_ID)] }),
    ).resolves.toEqual(RuleApplicationResultUtil.noMatch());
  });

  it("matches a monitor-label rule through the alert's monitor", async () => {
    const findMonitor: jest.SpyInstance = jest
      .spyOn(MonitorService, "findOneById")
      .mockResolvedValue({
        id: MONITOR_ID,
        name: "checkout-api",
        labels: [fakeLabel(LABEL_ID)],
      } as unknown as Monitor);

    await expect(
      runAlert(alert(MONITOR_ID), { monitorLabels: [fakeLabel(LABEL_ID)] }),
    ).resolves.toEqual(RuleApplicationResultUtil.updated(1));
    expect(findMonitor.mock.calls[0]![0].id).toBe(MONITOR_ID);

    await expect(
      runAlert(alert(MONITOR_ID), {
        monitorLabels: [fakeLabel(OTHER_LABEL_ID)],
      }),
    ).resolves.toEqual(RuleApplicationResultUtil.noMatch());
  });

  it("does not match monitor criteria on an alert read without its monitor", async () => {
    const findMonitor: jest.SpyInstance = jest.spyOn(
      MonitorService,
      "findOneById",
    );

    await expect(
      runAlert(alert(undefined), { monitorNamePattern: "checkout" }),
    ).resolves.toEqual(RuleApplicationResultUtil.noMatch());
    expect(findMonitor).not.toHaveBeenCalled();
    expect(updateOneById).not.toHaveBeenCalled();
  });
});
