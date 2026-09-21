/*
 * `jest` is the global (as in ServiceLevelObjectiveService.test.ts), not the
 * @jest/globals export: that export's SpiedFunction type does not accept what
 * jest.spyOn returns with this repo's jest-mock version.
 */
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import Label from "../../../Models/DatabaseModels/Label";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import { ServiceLevelObjectiveFeedEventType } from "../../../Models/DatabaseModels/ServiceLevelObjectiveFeed";
import ServiceLevelObjectiveLabelRule from "../../../Models/DatabaseModels/ServiceLevelObjectiveLabelRule";
import ServiceLevelObjectiveOwnerRule from "../../../Models/DatabaseModels/ServiceLevelObjectiveOwnerRule";
import ServiceLevelObjectiveOwnerTeam from "../../../Models/DatabaseModels/ServiceLevelObjectiveOwnerTeam";
import ServiceLevelObjectiveOwnerUser from "../../../Models/DatabaseModels/ServiceLevelObjectiveOwnerUser";
import ServiceLevelObjectiveFeedService from "../../../Server/Services/ServiceLevelObjectiveFeedService";
import ServiceLevelObjectiveLabelRuleEngineService from "../../../Server/Services/ServiceLevelObjectiveLabelRuleEngineService";
import ServiceLevelObjectiveLabelRuleService from "../../../Server/Services/ServiceLevelObjectiveLabelRuleService";
import ServiceLevelObjectiveOwnerRuleEngineService from "../../../Server/Services/ServiceLevelObjectiveOwnerRuleEngineService";
import ServiceLevelObjectiveOwnerRuleService from "../../../Server/Services/ServiceLevelObjectiveOwnerRuleService";
import ServiceLevelObjectiveOwnerTeamService from "../../../Server/Services/ServiceLevelObjectiveOwnerTeamService";
import ServiceLevelObjectiveOwnerUserService from "../../../Server/Services/ServiceLevelObjectiveOwnerUserService";
import ServiceLevelObjectiveService from "../../../Server/Services/ServiceLevelObjectiveService";
import logger from "../../../Server/Utils/Logger";
import {
  RuleApplicationResult,
  RuleApplicationResultUtil,
} from "../../../Server/Utils/Rules/RuleRun/RuleApplication";
import { Purple500 } from "../../../Types/BrandColors";
import BadDataException from "../../../Types/Exception/BadDataException";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import ObjectID from "../../../Types/ObjectID";
import RuleCriteria, {
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaFilter,
  RuleCriteriaOperator,
} from "../../../Types/Rules/RuleCriteria";
import { MAX_RULES_EVALUATED_PER_PROJECT } from "../../../Utils/Rules/RuleEngineLimits";

/*
 * SLO label and owner rules - what is specific to SLOs.
 *
 * LabelRuleEnginesGroupBRun / OwnerRuleEnginesGroupBRun already hold both
 * engines to the contract every label and owner engine shares (selects, dedupe,
 * already-applied, failures as results). This suite covers what the SLO
 * engines add on top of it:
 *
 *   - matching on everything an SLO rule offers: its labels (any-of), its
 *     name and description, regexes AND '*' wildcards - the syntax the SLO
 *     monitor rules take - and configurable criteria;
 *   - the SLO feed: which rules changed the SLO, with every rule name escaped
 *     (the feed renders markdown without safe mode), and a feed failure never
 *     turning an SLO the rules DID change into a failed one;
 *   - owners go through the SLO owner services, which refuse a user who left
 *     the project: that owner is skipped, the rest are still added, and a run
 *     whose every owner was refused says so instead of "already applied";
 *   - who is notified: the rule's Notify Owners, and the run's own opt-in.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const SLO_ID: ObjectID = new ObjectID("cccccccc-cccc-4ccc-8ccc-cccccccccccc");
const RULE_ID: ObjectID = new ObjectID("77777777-7777-4777-8777-777777777777");
const OTHER_RULE_ID: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888888",
);
const LABEL_PRODUCTION: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const LABEL_CHECKOUT: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const LABEL_STAGING: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const USER_A: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");
const USER_B: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");
const TEAM_A: ObjectID = new ObjectID("99999999-9999-4999-8999-999999999999");

const SLO_NAME: string = "Checkout API availability";
const SLO_DESCRIPTION: string = "Customer-facing checkout, tier 1";
const SLO_LINK: string =
  "[SLO Checkout API availability](https://oneuptime.test/dashboard/p/slos/s)";

type AsyncSpy = jest.SpyInstance;

function label(id: ObjectID): Label {
  const result: Label = new Label();
  result.id = id;
  return result;
}

function ref(id: ObjectID): { id: ObjectID; _id: string } {
  return { id: id, _id: id.toString() };
}

// The SLO a run hands the engine: resourceSelectForRuleRun is ids only.
function runTarget(): ServiceLevelObjective {
  const slo: ServiceLevelObjective = new ServiceLevelObjective();
  slo.id = SLO_ID;
  slo.projectId = PROJECT_ID;
  return slo;
}

// The SLO the engine reads back.
function sloDetails(
  data: {
    labels?: Array<ObjectID> | undefined;
    description?: string | undefined;
    name?: string | undefined;
  } = {},
): ServiceLevelObjective {
  const slo: ServiceLevelObjective = new ServiceLevelObjective();
  slo.id = SLO_ID;
  slo.projectId = PROJECT_ID;
  slo.name = data.name === undefined ? SLO_NAME : data.name;
  slo.description =
    data.description === undefined ? SLO_DESCRIPTION : data.description;
  slo.labels = (data.labels || []).map(label);
  return slo;
}

function criteria(
  filters: Array<RuleCriteriaFilter>,
  filterCondition: FilterCondition = FilterCondition.All,
): RuleCriteria {
  return {
    schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
    filterCondition: filterCondition,
    filters: filters,
  };
}

interface MatchFields {
  id?: ObjectID | undefined;
  name?: string | undefined;
  namePattern?: string | undefined;
  descriptionPattern?: string | undefined;
  sloLabels?: Array<ObjectID> | undefined;
  criteria?: RuleCriteria | undefined;
}

// Unset fields stay undefined, which the model's own typing does not allow.
function setFields(
  model: ServiceLevelObjectiveLabelRule | ServiceLevelObjectiveOwnerRule,
  fields: Record<string, unknown>,
): void {
  Object.assign(model as unknown as Record<string, unknown>, fields);
}

function applyMatchFields(
  rule: ServiceLevelObjectiveLabelRule | ServiceLevelObjectiveOwnerRule,
  data: MatchFields,
): void {
  setFields(rule, {
    id: data.id || RULE_ID,
    name: data.name === undefined ? "Tag checkout SLOs" : data.name,
    projectId: PROJECT_ID,
    serviceLevelObjectiveNamePattern: data.namePattern,
    serviceLevelObjectiveDescriptionPattern: data.descriptionPattern,
    serviceLevelObjectiveLabels: data.sloLabels
      ? data.sloLabels.map(label)
      : undefined,
    criteria: data.criteria,
  });
}

function labelRule(
  data: MatchFields & { labelsToAdd?: Array<ObjectID> | undefined },
): ServiceLevelObjectiveLabelRule {
  const rule: ServiceLevelObjectiveLabelRule =
    new ServiceLevelObjectiveLabelRule();
  applyMatchFields(rule, data);
  rule.labelsToAdd = (data.labelsToAdd || [LABEL_CHECKOUT]).map(label);
  return rule;
}

function ownerRule(
  data: MatchFields & {
    users?: Array<ObjectID> | undefined;
    teams?: Array<ObjectID> | undefined;
    notifyOwners?: boolean | undefined;
  },
): ServiceLevelObjectiveOwnerRule {
  const rule: ServiceLevelObjectiveOwnerRule =
    new ServiceLevelObjectiveOwnerRule();
  applyMatchFields(rule, data);
  setFields(rule, {
    notifyOwners: data.notifyOwners,
    ownerUsers: (data.users || []).map(ref),
    ownerTeams: (data.teams || []).map(ref),
  });
  return rule;
}

interface FeedPayload {
  serviceLevelObjectiveId: ObjectID;
  projectId: ObjectID;
  serviceLevelObjectiveFeedEventType: ServiceLevelObjectiveFeedEventType;
  feedInfoInMarkdown: string;
  moreInformationInMarkdown?: string | undefined;
  displayColor?: unknown;
  userId?: ObjectID | undefined;
}

let errorSpy: AsyncSpy;
let warnSpy: AsyncSpy;
let linkSpy: AsyncSpy;
let feedSpy: AsyncSpy;
let findSloSpy: AsyncSpy;

function feedPayloads(): Array<FeedPayload> {
  return feedSpy.mock.calls.map((call: Array<unknown>): FeedPayload => {
    return call[0] as FeedPayload;
  });
}

beforeEach(() => {
  errorSpy = jest.spyOn(logger, "error").mockImplementation(() => {});
  warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => {});
  jest.spyOn(logger, "debug").mockImplementation(() => {});
  linkSpy = jest
    .spyOn(ServiceLevelObjectiveService, "getSloMarkdownLink")
    .mockResolvedValue(SLO_LINK);
  feedSpy = jest
    .spyOn(
      ServiceLevelObjectiveFeedService,
      "createServiceLevelObjectiveFeedItem",
    )
    .mockResolvedValue(undefined);
  findSloSpy = jest
    .spyOn(ServiceLevelObjectiveService, "findOneById")
    .mockResolvedValue(sloDetails());
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("ServiceLevelObjectiveLabelRuleEngineService", () => {
  interface LabelWrite {
    relation: string;
    sloId: string;
    labelIds: Array<string>;
  }

  let writes: Array<LabelWrite>;

  beforeEach(() => {
    writes = [];
    let pendingRelation: string = "";
    let pendingSloId: string = "";

    const builder: Record<string, unknown> = {};
    Object.assign(builder, {
      createQueryBuilder: () => {
        return builder;
      },
      relation: (_target: unknown, relation: string) => {
        pendingRelation = relation;
        return builder;
      },
      of: (sloId: string) => {
        pendingSloId = sloId;
        return builder;
      },
      add: async (labelIds: Array<string>) => {
        writes.push({
          relation: pendingRelation,
          sloId: pendingSloId,
          labelIds: [...labelIds],
        });
      },
    });

    jest
      .spyOn(ServiceLevelObjectiveService, "getRepository")
      .mockReturnValue(builder as never);
  });

  function run(
    rules: Array<ServiceLevelObjectiveLabelRule>,
    slo: ServiceLevelObjective = runTarget(),
  ): Promise<RuleApplicationResult> {
    return ServiceLevelObjectiveLabelRuleEngineService.applyRulesToExistingResource(
      { resource: slo, rules: rules, allowOwnerNotification: false },
    );
  }

  describe("matching", () => {
    it("matches the SLO name as a case-insensitive regex", async () => {
      const result: RuleApplicationResult = await run([
        labelRule({ namePattern: "^CHECKOUT api" }),
      ]);

      expect(result).toEqual(RuleApplicationResultUtil.updated(1));
      expect(writes).toEqual([
        {
          relation: "labels",
          sloId: SLO_ID.toString(),
          labelIds: [LABEL_CHECKOUT.toString()],
        },
      ]);
    });

    // The syntax the SLO monitor rules take, and the one the docs show.
    it("matches a '*' wildcard pattern, which is not a valid regex", async () => {
      expect(await run([labelRule({ namePattern: "*checkout*" })])).toEqual(
        RuleApplicationResultUtil.updated(1),
      );
      expect(await run([labelRule({ namePattern: "*payments*" })])).toEqual(
        RuleApplicationResultUtil.noMatch(),
      );
    });

    it("matches the SLO description", async () => {
      expect(await run([labelRule({ descriptionPattern: "tier 1$" })])).toEqual(
        RuleApplicationResultUtil.updated(1),
      );
      expect(await run([labelRule({ descriptionPattern: "tier 2" })])).toEqual(
        RuleApplicationResultUtil.noMatch(),
      );
    });

    it("never matches a description pattern against an SLO without a description", async () => {
      findSloSpy.mockResolvedValue(sloDetails({ description: "" }));

      expect(await run([labelRule({ descriptionPattern: ".*" })])).toEqual(
        RuleApplicationResultUtil.noMatch(),
      );
      expect(writes).toHaveLength(0);
    });

    it("requires every legacy criterion that is set", async () => {
      expect(
        await run([
          labelRule({
            namePattern: "checkout",
            descriptionPattern: "internal only",
          }),
        ]),
      ).toEqual(RuleApplicationResultUtil.noMatch());
    });

    it("matches the SLO's labels as any-of", async () => {
      findSloSpy.mockResolvedValue(sloDetails({ labels: [LABEL_PRODUCTION] }));

      expect(
        await run([
          labelRule({ sloLabels: [LABEL_STAGING, LABEL_PRODUCTION] }),
        ]),
      ).toEqual(RuleApplicationResultUtil.updated(1));
      expect(await run([labelRule({ sloLabels: [LABEL_STAGING] })])).toEqual(
        RuleApplicationResultUtil.noMatch(),
      );
    });

    it("does not match a label prerequisite for an SLO with no labels", async () => {
      expect(await run([labelRule({ sloLabels: [LABEL_PRODUCTION] })])).toEqual(
        RuleApplicationResultUtil.noMatch(),
      );
    });

    // A rule with no criteria at all matches every SLO, like every label rule.
    it("matches every SLO when the rule sets no criteria", async () => {
      expect(await run([labelRule({})])).toEqual(
        RuleApplicationResultUtil.updated(1),
      );
    });

    /*
     * SloRulePatternValidator refuses such a pattern on save; a rule written
     * before that check must quietly match nothing, and say why in the logs.
     */
    it("never matches an unsupported pattern, and warns about it", async () => {
      const result: RuleApplicationResult = await run([
        labelRule({ namePattern: "checkout-(01" }),
      ]);

      expect(result).toEqual(RuleApplicationResultUtil.noMatch());
      expect(writes).toHaveLength(0);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("checkout-(01"),
      );
    });

    it("evaluates configurable criteria on the SLO's labels", async () => {
      findSloSpy.mockResolvedValue(
        sloDetails({ labels: [LABEL_PRODUCTION, LABEL_CHECKOUT] }),
      );

      const hasAll: RuleCriteria = criteria([
        {
          field: "serviceLevelObjectiveLabels",
          operator: RuleCriteriaOperator.HasAllOf,
          value: [LABEL_PRODUCTION.toString(), LABEL_CHECKOUT.toString()],
        },
      ]);
      const hasNone: RuleCriteria = criteria([
        {
          field: "serviceLevelObjectiveLabels",
          operator: RuleCriteriaOperator.HasNoneOf,
          value: [LABEL_PRODUCTION.toString()],
        },
      ]);

      expect(
        await run([
          labelRule({ criteria: hasAll, labelsToAdd: [LABEL_STAGING] }),
        ]),
      ).toEqual(RuleApplicationResultUtil.updated(1));
      expect(
        await run([
          labelRule({ criteria: hasNone, labelsToAdd: [LABEL_STAGING] }),
        ]),
      ).toEqual(RuleApplicationResultUtil.noMatch());
    });

    it("combines criteria with Match any", async () => {
      const anyOf: RuleCriteria = criteria(
        [
          {
            field: "serviceLevelObjectiveNamePattern",
            operator: RuleCriteriaOperator.StartsWith,
            value: "Payments",
          },
          {
            field: "serviceLevelObjectiveDescriptionPattern",
            operator: RuleCriteriaOperator.Contains,
            value: "checkout",
          },
        ],
        FilterCondition.Any,
      );

      expect(await run([labelRule({ criteria: anyOf })])).toEqual(
        RuleApplicationResultUtil.updated(1),
      );
    });

    it("matches a wildcard through configurable criteria too", async () => {
      const wildcard: RuleCriteria = criteria([
        {
          field: "serviceLevelObjectiveNamePattern",
          operator: RuleCriteriaOperator.MatchesPattern,
          value: "*api*",
        },
      ]);

      expect(await run([labelRule({ criteria: wildcard })])).toEqual(
        RuleApplicationResultUtil.updated(1),
      );
    });

    // Criteria take over from the legacy columns entirely.
    it("ignores stale legacy columns once the rule has criteria", async () => {
      const onName: RuleCriteria = criteria([
        {
          field: "serviceLevelObjectiveNamePattern",
          operator: RuleCriteriaOperator.Contains,
          value: "payments",
        },
      ]);

      expect(
        await run([labelRule({ namePattern: "checkout", criteria: onName })]),
      ).toEqual(RuleApplicationResultUtil.noMatch());
    });
  });

  describe("applying", () => {
    it("attaches the union of every matching rule's labels, once each", async () => {
      const result: RuleApplicationResult = await run([
        labelRule({
          namePattern: "checkout",
          labelsToAdd: [LABEL_CHECKOUT, LABEL_PRODUCTION],
        }),
        labelRule({
          id: OTHER_RULE_ID,
          descriptionPattern: "tier 1",
          labelsToAdd: [LABEL_PRODUCTION],
        }),
        labelRule({
          id: new ObjectID("abababab-abab-4bab-8bab-abababababab"),
          namePattern: "^payments",
          labelsToAdd: [LABEL_STAGING],
        }),
      ]);

      expect(result).toEqual(RuleApplicationResultUtil.updated(2));
      expect(writes).toHaveLength(1);
      expect([...writes[0]!.labelIds].sort()).toEqual(
        [LABEL_CHECKOUT.toString(), LABEL_PRODUCTION.toString()].sort(),
      );
    });

    // Re-read, not trusted from the caller: a run only names the SLO.
    it("re-reads the SLO's name, description and labels as root", async () => {
      await run([labelRule({ namePattern: "checkout" })]);

      expect(findSloSpy).toHaveBeenCalledWith({
        id: SLO_ID,
        select: { name: true, description: true, labels: { _id: true } },
        props: { isRoot: true },
      });
    });

    it("writes the merged labels back onto the SLO it was handed", async () => {
      findSloSpy.mockResolvedValue(sloDetails({ labels: [LABEL_PRODUCTION] }));
      const slo: ServiceLevelObjective = runTarget();

      await run([labelRule({ namePattern: "checkout" })], slo);

      expect(
        (slo.labels || []).map((item: Label) => {
          return item.id!.toString();
        }),
      ).toEqual([LABEL_PRODUCTION.toString(), LABEL_CHECKOUT.toString()]);
    });

    it("reports no match without a read for an SLO that has since been deleted", async () => {
      findSloSpy.mockResolvedValue(null);

      expect(await run([labelRule({ namePattern: "checkout" })])).toEqual(
        RuleApplicationResultUtil.noMatch(),
      );
      expect(writes).toHaveLength(0);
      expect(feedSpy).not.toHaveBeenCalled();
    });
  });

  describe("feed item", () => {
    it("records which rules attached how many labels, on the SLO's feed", async () => {
      await run([
        labelRule({
          namePattern: "checkout",
          labelsToAdd: [LABEL_CHECKOUT, LABEL_PRODUCTION],
        }),
      ]);

      expect(feedPayloads()).toHaveLength(1);
      const payload: FeedPayload = feedPayloads()[0]!;

      expect(payload.serviceLevelObjectiveId.toString()).toBe(
        SLO_ID.toString(),
      );
      expect(payload.projectId.toString()).toBe(PROJECT_ID.toString());
      expect(payload.serviceLevelObjectiveFeedEventType).toBe(
        ServiceLevelObjectiveFeedEventType.LabelRuleExecuted,
      );
      expect(payload.displayColor).toBe(Purple500);
      expect(payload.feedInfoInMarkdown).toBe(
        `🏷️ 2 label(s) were attached to ${SLO_LINK} by label rule.`,
      );
      expect(payload.moreInformationInMarkdown).toBe(
        "**Label rules that matched**: **Tag checkout SLOs**",
      );
      // Rules act on their own, never in anybody's name.
      expect(payload.userId).toBeUndefined();
    });

    // The link reuses the name the engine just read instead of reading again.
    it("builds the SLO link from the SLO it re-read", async () => {
      await run([labelRule({ namePattern: "checkout" })]);

      expect(linkSpy).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        sloId: SLO_ID,
        sloName: SLO_NAME,
      });
    });

    it("names every rule that added a label, and only those", async () => {
      await run([
        labelRule({ name: "First", namePattern: "checkout" }),
        labelRule({
          id: OTHER_RULE_ID,
          name: "Second",
          namePattern: "checkout",
          labelsToAdd: [LABEL_PRODUCTION],
        }),
        // Matches, but has nothing to add.
        labelRule({
          id: new ObjectID("abababab-abab-4bab-8bab-abababababab"),
          name: "Empty",
          namePattern: "checkout",
          labelsToAdd: [],
        }),
      ]);

      const payload: FeedPayload = feedPayloads()[0]!;
      expect(payload.feedInfoInMarkdown).toContain("by label rules.");
      expect(payload.moreInformationInMarkdown).toBe(
        "**Label rules that matched**: **First**, **Second**",
      );
    });

    // The feed renders markdown without safe mode, and a rule name is typed by a user.
    it("escapes rule names", async () => {
      await run([
        labelRule({
          name: "![x](https://tracker.example/p.png) **bold**",
          namePattern: "checkout",
        }),
      ]);

      const more: string = feedPayloads()[0]!.moreInformationInMarkdown!;
      expect(more).toBe(
        "**Label rules that matched**: **\\!\\[x\\]\\(https://tracker.example/p.png\\) \\*\\*bold\\*\\***",
      );
      expect(more).not.toContain("![x](");
    });

    it("records nothing when every label was already there", async () => {
      findSloSpy.mockResolvedValue(sloDetails({ labels: [LABEL_CHECKOUT] }));

      expect(await run([labelRule({ namePattern: "checkout" })])).toEqual(
        RuleApplicationResultUtil.alreadyApplied(),
      );
      expect(feedSpy).not.toHaveBeenCalled();
    });

    /*
     * The labels are attached before the feed item is written: a failing feed
     * must not make a run report an SLO it changed as one it failed on.
     */
    it("still reports the SLO as updated when the feed item cannot be written", async () => {
      linkSpy.mockRejectedValue(new Error("database is down"));

      const result: RuleApplicationResult = await run([
        labelRule({ namePattern: "checkout" }),
      ]);

      expect(result).toEqual(RuleApplicationResultUtil.updated(1));
      expect(writes).toHaveLength(1);
      expect(feedSpy).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(String(errorSpy.mock.calls[0]![0])).toContain(
        "label rule feed item",
      );
    });
  });

  describe("create hook", () => {
    it("evaluates the project's enabled rules, bounded, as root", async () => {
      const findRules: AsyncSpy = jest
        .spyOn(ServiceLevelObjectiveLabelRuleService, "findBy")
        .mockResolvedValue([labelRule({ namePattern: "checkout" })]);

      await ServiceLevelObjectiveLabelRuleEngineService.applyRulesToServiceLevelObjective(
        runTarget(),
      );

      expect(findRules).toHaveBeenCalledWith({
        query: { projectId: PROJECT_ID, isEnabled: true },
        props: { isRoot: true },
        select: ServiceLevelObjectiveLabelRuleEngineService.ruleSelect,
        limit: MAX_RULES_EVALUATED_PER_PROJECT,
        skip: 0,
      });
      expect(writes).toHaveLength(1);
    });

    it("reads nothing for an SLO without an id or project", async () => {
      const findRules: AsyncSpy = jest
        .spyOn(ServiceLevelObjectiveLabelRuleService, "findBy")
        .mockResolvedValue([]);

      await ServiceLevelObjectiveLabelRuleEngineService.applyRulesToServiceLevelObjective(
        new ServiceLevelObjective(),
      );

      expect(findRules).not.toHaveBeenCalled();
    });

    it("never throws into the create, and logs why", async () => {
      jest
        .spyOn(ServiceLevelObjectiveLabelRuleService, "findBy")
        .mockRejectedValue(new Error("database is down"));

      await expect(
        ServiceLevelObjectiveLabelRuleEngineService.applyRulesToServiceLevelObjective(
          runTarget(),
        ),
      ).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });
  });
});

describe("ServiceLevelObjectiveOwnerRuleEngineService", () => {
  interface OwnerWrite {
    kind: "user" | "team";
    ownerId: string;
    serviceLevelObjectiveId: string;
    projectId: string;
    isOwnerNotified: boolean | undefined;
    props: Record<string, unknown>;
  }

  let ownerWrites: Array<OwnerWrite>;
  let existingUserIds: Array<ObjectID>;
  let existingTeamIds: Array<ObjectID>;
  let userCreate: AsyncSpy;
  let teamCreate: AsyncSpy;

  beforeEach(() => {
    ownerWrites = [];
    existingUserIds = [];
    existingTeamIds = [];

    jest
      .spyOn(ServiceLevelObjectiveOwnerUserService, "findBy")
      .mockImplementation((async () => {
        return existingUserIds.map((id: ObjectID) => {
          const row: ServiceLevelObjectiveOwnerUser =
            new ServiceLevelObjectiveOwnerUser();
          row.userId = id;
          return row;
        });
      }) as never);
    jest
      .spyOn(ServiceLevelObjectiveOwnerTeamService, "findBy")
      .mockImplementation((async () => {
        return existingTeamIds.map((id: ObjectID) => {
          const row: ServiceLevelObjectiveOwnerTeam =
            new ServiceLevelObjectiveOwnerTeam();
          row.teamId = id;
          return row;
        });
      }) as never);

    userCreate = jest
      .spyOn(ServiceLevelObjectiveOwnerUserService, "create")
      .mockImplementation((async (data: {
        data: ServiceLevelObjectiveOwnerUser;
        props: Record<string, unknown>;
      }) => {
        ownerWrites.push({
          kind: "user",
          ownerId: data.data.userId!.toString(),
          serviceLevelObjectiveId:
            data.data.serviceLevelObjectiveId!.toString(),
          projectId: data.data.projectId!.toString(),
          isOwnerNotified: data.data.isOwnerNotified,
          props: data.props,
        });
        return data.data;
      }) as never);
    teamCreate = jest
      .spyOn(ServiceLevelObjectiveOwnerTeamService, "create")
      .mockImplementation((async (data: {
        data: ServiceLevelObjectiveOwnerTeam;
        props: Record<string, unknown>;
      }) => {
        ownerWrites.push({
          kind: "team",
          ownerId: data.data.teamId!.toString(),
          serviceLevelObjectiveId:
            data.data.serviceLevelObjectiveId!.toString(),
          projectId: data.data.projectId!.toString(),
          isOwnerNotified: data.data.isOwnerNotified,
          props: data.props,
        });
        return data.data;
      }) as never);
  });

  function run(
    rules: Array<ServiceLevelObjectiveOwnerRule>,
    allowOwnerNotification: boolean = true,
  ): Promise<RuleApplicationResult> {
    return ServiceLevelObjectiveOwnerRuleEngineService.applyRulesToExistingResource(
      {
        resource: runTarget(),
        rules: rules,
        allowOwnerNotification: allowOwnerNotification,
      },
    );
  }

  // The same refusal SloOwnerReferenceValidator gives a user outside the project.
  function refuseUser(userId: ObjectID): void {
    userCreate.mockImplementation((async (data: {
      data: ServiceLevelObjectiveOwnerUser;
      props: Record<string, unknown>;
    }) => {
      if (data.data.userId!.toString() === userId.toString()) {
        throw new BadDataException(
          `This SLO owner user names a user who is not a member of this project: "${userId.toString()}". Please pick a user from this project and try again.`,
        );
      }

      ownerWrites.push({
        kind: "user",
        ownerId: data.data.userId!.toString(),
        serviceLevelObjectiveId: data.data.serviceLevelObjectiveId!.toString(),
        projectId: data.data.projectId!.toString(),
        isOwnerNotified: data.data.isOwnerNotified,
        props: data.props,
      });
      return data.data;
    }) as never);
  }

  describe("adding owners", () => {
    it("adds the rule's users and teams to the SLO, as root", async () => {
      const result: RuleApplicationResult = await run([
        ownerRule({
          namePattern: "checkout",
          users: [USER_A, USER_B],
          teams: [TEAM_A],
        }),
      ]);

      expect(result).toEqual(RuleApplicationResultUtil.updated(3));
      expect(
        ownerWrites.map((write: OwnerWrite) => {
          return [write.kind, write.ownerId];
        }),
      ).toEqual([
        ["user", USER_A.toString()],
        ["user", USER_B.toString()],
        ["team", TEAM_A.toString()],
      ]);

      for (const write of ownerWrites) {
        expect(write.serviceLevelObjectiveId).toBe(SLO_ID.toString());
        expect(write.projectId).toBe(PROJECT_ID.toString());
        expect(write.props).toEqual({ isRoot: true });
      }
    });

    it("skips owners the SLO already has", async () => {
      existingUserIds = [USER_A];
      existingTeamIds = [TEAM_A];

      const result: RuleApplicationResult = await run([
        ownerRule({
          namePattern: "checkout",
          users: [USER_A, USER_B],
          teams: [TEAM_A],
        }),
      ]);

      expect(result).toEqual(RuleApplicationResultUtil.updated(1));
      expect(
        ownerWrites.map((write: OwnerWrite) => {
          return write.ownerId;
        }),
      ).toEqual([USER_B.toString()]);
    });

    it("reports already applied when every owner is already there", async () => {
      existingUserIds = [USER_A];

      expect(
        await run([ownerRule({ namePattern: "checkout", users: [USER_A] })]),
      ).toEqual(RuleApplicationResultUtil.alreadyApplied());
      expect(ownerWrites).toHaveLength(0);
      expect(feedSpy).not.toHaveBeenCalled();
    });

    // Two rules naming the same owner add one row, not two.
    it("adds an owner two matching rules share only once", async () => {
      const result: RuleApplicationResult = await run([
        ownerRule({ namePattern: "checkout", users: [USER_A] }),
        ownerRule({
          id: OTHER_RULE_ID,
          descriptionPattern: "tier 1",
          users: [USER_A],
        }),
      ]);

      expect(result).toEqual(RuleApplicationResultUtil.updated(1));
      expect(ownerWrites).toHaveLength(1);
    });

    it("adds nothing for a rule that does not match", async () => {
      expect(
        await run([ownerRule({ namePattern: "^payments", users: [USER_A] })]),
      ).toEqual(RuleApplicationResultUtil.noMatch());
      expect(ownerWrites).toHaveLength(0);
    });

    // Lost a race with another writer: the unique index says it is already there.
    it("treats a unique-index rejection as an owner already added", async () => {
      userCreate.mockRejectedValue(
        Object.assign(new Error("duplicate key value"), {
          postgresErrorCode: "23505",
        }),
      );

      expect(
        await run([ownerRule({ namePattern: "checkout", users: [USER_A] })]),
      ).toEqual(RuleApplicationResultUtil.alreadyApplied());
      expect(errorSpy).not.toHaveBeenCalled();
    });
  });

  describe("owners the SLO owner services refuse", () => {
    it("skips a user who is no longer a project member and still adds the rest", async () => {
      refuseUser(USER_A);

      const result: RuleApplicationResult = await run([
        ownerRule({
          namePattern: "checkout",
          users: [USER_A, USER_B],
          teams: [TEAM_A],
        }),
      ]);

      expect(result).toEqual(RuleApplicationResultUtil.updated(2));
      expect(
        ownerWrites.map((write: OwnerWrite) => {
          return write.ownerId;
        }),
      ).toEqual([USER_B.toString(), TEAM_A.toString()]);
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(String(warnSpy.mock.calls[0]![0])).toContain(
        "not a member of this project",
      );
      expect(errorSpy).not.toHaveBeenCalled();
    });

    /*
     * Nothing was added, so "already applied" would claim the SLO has owners
     * it does not. The run counts it as an SLO it could not update.
     */
    it("reports the SLO as failed when every owner was refused", async () => {
      refuseUser(USER_A);

      expect(
        await run([ownerRule({ namePattern: "checkout", users: [USER_A] })]),
      ).toEqual(RuleApplicationResultUtil.failed());
      expect(ownerWrites).toHaveLength(0);
      expect(feedSpy).not.toHaveBeenCalled();
    });

    it("reports any other write failure as failed, and logs it", async () => {
      teamCreate.mockRejectedValue(new Error("database is down"));

      expect(
        await run([ownerRule({ namePattern: "checkout", teams: [TEAM_A] })]),
      ).toEqual(RuleApplicationResultUtil.failed());
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  describe("notifications", () => {
    /*
     * isOwnerNotified is "the owner-added job already told them": false means
     * the job will notify, true means the owner is added silently.
     */
    function notifiedByOwner(): Record<string, boolean | undefined> {
      const result: Record<string, boolean | undefined> = {};

      for (const write of ownerWrites) {
        result[write.ownerId] = write.isOwnerNotified;
      }

      return result;
    }

    it("leaves owners to be notified when the rule asks for it (the default)", async () => {
      await run([
        ownerRule({
          namePattern: "checkout",
          users: [USER_A],
          teams: [TEAM_A],
        }),
      ]);

      expect(notifiedByOwner()).toEqual({
        [USER_A.toString()]: false,
        [TEAM_A.toString()]: false,
      });
    });

    it("adds owners silently when the rule turns Notify Owners off", async () => {
      await run([
        ownerRule({
          namePattern: "checkout",
          users: [USER_A],
          teams: [TEAM_A],
          notifyOwners: false,
        }),
      ]);

      expect(notifiedByOwner()).toEqual({
        [USER_A.toString()]: true,
        [TEAM_A.toString()]: true,
      });
    });

    // A run over every SLO in the project notifies nobody unless asked to.
    it("adds owners silently in a run that did not opt in, whatever the rule says", async () => {
      await run(
        [
          ownerRule({
            namePattern: "checkout",
            users: [USER_A],
            notifyOwners: true,
          }),
        ],
        false,
      );

      expect(notifiedByOwner()).toEqual({ [USER_A.toString()]: true });
    });

    it("notifies an owner once when a notifying and a silent rule both name them", async () => {
      await run([
        ownerRule({
          namePattern: "checkout",
          users: [USER_A],
          notifyOwners: false,
        }),
        ownerRule({
          id: OTHER_RULE_ID,
          namePattern: "checkout",
          users: [USER_A],
          notifyOwners: true,
        }),
      ]);

      expect(ownerWrites).toHaveLength(1);
      expect(notifiedByOwner()).toEqual({ [USER_A.toString()]: false });
    });
  });

  describe("feed item", () => {
    it("records which rules added owners, on the SLO's feed", async () => {
      await run([
        ownerRule({
          name: "Checkout team owns checkout SLOs",
          namePattern: "checkout",
          teams: [TEAM_A],
        }),
      ]);

      expect(feedPayloads()).toHaveLength(1);
      const payload: FeedPayload = feedPayloads()[0]!;

      expect(payload.serviceLevelObjectiveId.toString()).toBe(
        SLO_ID.toString(),
      );
      expect(payload.serviceLevelObjectiveFeedEventType).toBe(
        ServiceLevelObjectiveFeedEventType.OwnerRuleExecuted,
      );
      expect(payload.displayColor).toBe(Purple500);
      expect(payload.feedInfoInMarkdown).toBe(
        `👥 Owners were added to ${SLO_LINK} by 1 owner rule.`,
      );
      expect(payload.moreInformationInMarkdown).toBe(
        "**Owner rules that matched**: **Checkout team owns checkout SLOs**",
      );
      expect(payload.userId).toBeUndefined();
    });

    it("counts and escapes every rule that named an owner", async () => {
      await run([
        ownerRule({ name: "[a](b)", namePattern: "checkout", users: [USER_A] }),
        ownerRule({
          id: OTHER_RULE_ID,
          name: "Plain",
          namePattern: "checkout",
          users: [USER_B],
        }),
      ]);

      const payload: FeedPayload = feedPayloads()[0]!;
      expect(payload.feedInfoInMarkdown).toContain("by 2 owner rules.");
      expect(payload.moreInformationInMarkdown).toBe(
        "**Owner rules that matched**: **\\[a\\]\\(b\\)**, **Plain**",
      );
    });

    it("still reports the SLO as updated when the feed item cannot be written", async () => {
      linkSpy.mockRejectedValue(new Error("database is down"));

      expect(
        await run([ownerRule({ namePattern: "checkout", users: [USER_A] })]),
      ).toEqual(RuleApplicationResultUtil.updated(1));
      expect(ownerWrites).toHaveLength(1);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(String(errorSpy.mock.calls[0]![0])).toContain(
        "owner rule feed item",
      );
    });
  });

  describe("matching", () => {
    it("matches the SLO's labels, name and description like the label rules", async () => {
      findSloSpy.mockResolvedValue(sloDetails({ labels: [LABEL_PRODUCTION] }));

      expect(
        await run([
          ownerRule({
            sloLabels: [LABEL_PRODUCTION],
            namePattern: "*checkout*",
            descriptionPattern: "tier 1",
            users: [USER_A],
          }),
        ]),
      ).toEqual(RuleApplicationResultUtil.updated(1));
    });

    it("never matches an unsupported pattern, and warns about it", async () => {
      expect(
        await run([ownerRule({ namePattern: "[unclosed", users: [USER_A] })]),
      ).toEqual(RuleApplicationResultUtil.noMatch());
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("[unclosed"),
      );
    });

    it("evaluates configurable criteria", async () => {
      const onDescription: RuleCriteria = criteria([
        {
          field: "serviceLevelObjectiveDescriptionPattern",
          operator: RuleCriteriaOperator.DoesNotContain,
          value: "internal",
        },
      ]);

      expect(
        await run([ownerRule({ criteria: onDescription, users: [USER_A] })]),
      ).toEqual(RuleApplicationResultUtil.updated(1));
    });
  });

  describe("create hook", () => {
    it("evaluates the project's enabled rules and notifies the owners it adds", async () => {
      const findRules: AsyncSpy = jest
        .spyOn(ServiceLevelObjectiveOwnerRuleService, "findBy")
        .mockResolvedValue([
          ownerRule({ namePattern: "checkout", users: [USER_A] }),
        ]);

      await ServiceLevelObjectiveOwnerRuleEngineService.applyRulesToServiceLevelObjective(
        runTarget(),
      );

      expect(findRules).toHaveBeenCalledWith({
        query: { projectId: PROJECT_ID, isEnabled: true },
        props: { isRoot: true },
        select: ServiceLevelObjectiveOwnerRuleEngineService.ruleSelect,
        limit: MAX_RULES_EVALUATED_PER_PROJECT,
        skip: 0,
      });
      expect(ownerWrites).toHaveLength(1);
      // A create is not a bulk run: the rule's own Notify Owners decides.
      expect(ownerWrites[0]!.isOwnerNotified).toBe(false);
    });

    it("never throws into the create, and logs why", async () => {
      jest
        .spyOn(ServiceLevelObjectiveOwnerRuleService, "findBy")
        .mockRejectedValue(new Error("database is down"));

      await expect(
        ServiceLevelObjectiveOwnerRuleEngineService.applyRulesToServiceLevelObjective(
          runTarget(),
        ),
      ).resolves.toBeUndefined();
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });
  });
});
