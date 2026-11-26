/* eslint-disable @typescript-eslint/no-explicit-any */
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

import XcpNgPoolLabelRuleEngineService from "../../../Server/Services/XcpNgPoolLabelRuleEngineService";
import XcpNgPoolLabelRuleService from "../../../Server/Services/XcpNgPoolLabelRuleService";
import XcpNgPoolOwnerRuleEngineService from "../../../Server/Services/XcpNgPoolOwnerRuleEngineService";
import XcpNgPoolOwnerRuleService from "../../../Server/Services/XcpNgPoolOwnerRuleService";
import XcpNgPoolOwnerTeamService from "../../../Server/Services/XcpNgPoolOwnerTeamService";
import XcpNgPoolOwnerUserService from "../../../Server/Services/XcpNgPoolOwnerUserService";
import XcpNgPoolService from "../../../Server/Services/XcpNgPoolService";
import XcpNgPoolFeedService from "../../../Server/Services/XcpNgPoolFeedService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import logger from "../../../Server/Utils/Logger";
import {
  RuleApplicationResult,
  RuleApplicationResultUtil,
} from "../../../Server/Utils/Rules/RuleRun/RuleApplication";
import Label from "../../../Models/DatabaseModels/Label";
import XcpNgPool from "../../../Models/DatabaseModels/XcpNgPool";
import { XcpNgPoolFeedEventType } from "../../../Models/DatabaseModels/XcpNgPoolFeed";
import XcpNgPoolLabelRule from "../../../Models/DatabaseModels/XcpNgPoolLabelRule";
import XcpNgPoolOwnerRule from "../../../Models/DatabaseModels/XcpNgPoolOwnerRule";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import ObjectID from "../../../Types/ObjectID";
import RuleCriteria, {
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaOperator,
} from "../../../Types/Rules/RuleCriteria";
import { MAX_RULES_EVALUATED_PER_PROJECT } from "../../../Utils/Rules/RuleEngineLimits";
import { getJestSpyOn } from "../../Spy";

import FeedMarkdown from "../../../Utils/Markdown/FeedMarkdown";
/*
 * The XCP-ng pool label and owner rule engines.
 *
 * Mechanical copies of the Proxmox cluster engines, pinned on their own so the
 * XCP-ng parts cannot drift:
 *   - the criteria fields are xcpNgPoolLabels / xcpNgPoolNamePattern /
 *     xcpNgPoolDescriptionPattern, both as legacy columns and as
 *     configurable criteria, matched case-insensitively;
 *   - "Run now" (applyRulesToExistingResource) reports what it did and never
 *     throws; the create hook never throws either;
 *   - labels are added once, only when missing, and synced in memory so the
 *     owner engine that runs next can match on them;
 *   - owners are never duplicated, are notified only when both the rule and
 *     the run allow it, and every change is explained in the pool's feed.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const POOL_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const RULE_ID: ObjectID = new ObjectID("77777777-7777-4777-8777-777777777777");
const LABEL_A: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const LABEL_B: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const USER_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");
const USER_2_ID: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888888",
);
const TEAM_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");

function ref<T>(id: ObjectID): T {
  return { id: id, _id: id.toString() } as unknown as T;
}

// The pool as a run (or the create hook) hands it over: ids only.
function target(): XcpNgPool {
  return {
    id: POOL_ID,
    _id: POOL_ID.toString(),
    projectId: PROJECT_ID,
  } as unknown as XcpNgPool;
}

// The row the engines re-read to match on.
function details(
  overrides: {
    name?: string;
    description?: string;
    labels?: Array<ObjectID>;
  } = {},
): XcpNgPool {
  return {
    id: POOL_ID,
    _id: POOL_ID.toString(),
    projectId: PROJECT_ID,
    name: overrides.name ?? "xcp-prod-01",
    description: overrides.description ?? "Tier-1 XCP-ng pool in DC1",
    labels: (overrides.labels || []).map((id: ObjectID) => {
      return ref<Label>(id);
    }),
  } as unknown as XcpNgPool;
}

function criteria(
  field: string,
  operator: RuleCriteriaOperator,
  value: any,
): RuleCriteria {
  return {
    schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
    filterCondition: FilterCondition.All,
    filters: [{ field: field, operator: operator, value: value }],
  };
}

function labelRule(
  data: {
    name?: string;
    namePattern?: string;
    descriptionPattern?: string;
    matchLabels?: Array<ObjectID>;
    labelsToAdd?: Array<ObjectID>;
    criteria?: RuleCriteria;
  } = {},
): XcpNgPoolLabelRule {
  return {
    id: RULE_ID,
    _id: RULE_ID.toString(),
    name: data.name ?? "Tag production pools",
    criteria: data.criteria,
    xcpNgPoolNamePattern: data.namePattern,
    xcpNgPoolDescriptionPattern: data.descriptionPattern,
    xcpNgPoolLabels: (data.matchLabels || []).map((id: ObjectID) => {
      return ref<Label>(id);
    }),
    labelsToAdd: (data.labelsToAdd || [LABEL_A]).map((id: ObjectID) => {
      return ref<Label>(id);
    }),
  } as unknown as XcpNgPoolLabelRule;
}

function ownerRule(
  data: {
    name?: string;
    namePattern?: string;
    notifyOwners?: boolean;
    criteria?: RuleCriteria;
    users?: Array<ObjectID>;
    teams?: Array<ObjectID>;
  } = {},
): XcpNgPoolOwnerRule {
  return {
    id: RULE_ID,
    _id: RULE_ID.toString(),
    projectId: PROJECT_ID,
    name: data.name ?? "Virtualization team owns prod",
    criteria: data.criteria,
    notifyOwners: data.notifyOwners,
    xcpNgPoolNamePattern: data.namePattern ?? "^xcp-prod-",
    ownerUsers: (data.users || [USER_ID]).map((id: ObjectID) => {
      return ref(id);
    }),
    ownerTeams: (data.teams || [TEAM_ID]).map((id: ObjectID) => {
      return ref(id);
    }),
  } as unknown as XcpNgPoolOwnerRule;
}

let errorSpy: jest.SpyInstance;
let warnSpy: jest.SpyInstance;
let feedSpy: jest.SpyInstance;

beforeEach(() => {
  errorSpy = jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined as never;
  });
  warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => {
    return undefined as never;
  });
  jest.spyOn(logger, "debug").mockImplementation(() => {
    return undefined as never;
  });
  feedSpy = getJestSpyOn(
    XcpNgPoolFeedService,
    "createXcpNgPoolFeedItem",
  ).mockResolvedValue(undefined);
  getJestSpyOn(XcpNgPoolService, "getXcpNgPoolMarkdownLink").mockResolvedValue(
    FeedMarkdown.asMarkdown(
      "[XCP-ng Pool xcp-prod-01](https://example.com/xcp-ng/1)",
    ),
  );
  // The labels and teams the rules name are the project's.
  stubProjectDirectory({});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("XcpNgPoolLabelRuleEngineService", () => {
  let findDetails: jest.SpyInstance;
  let findRules: jest.SpyInstance;
  let writes: Array<{
    entity: unknown;
    relation: string;
    of: string;
    ids: Array<string>;
  }>;

  function arrange(
    data: {
      details?: XcpNgPool | null;
      rules?: Array<XcpNgPoolLabelRule>;
      failWrite?: boolean;
    } = {},
  ): void {
    writes = [];
    let entity: unknown = null;
    let relation: string = "";
    let of: string = "";
    const builder: any = {
      createQueryBuilder: () => {
        return builder;
      },
      relation: (target: unknown, name: string) => {
        entity = target;
        relation = name;
        return builder;
      },
      of: (id: string) => {
        of = id;
        return builder;
      },
      add: async (ids: Array<string>) => {
        if (data.failWrite) {
          throw new Error("duplicate key value violates unique constraint");
        }
        writes.push({ entity, relation, of, ids: [...ids] });
      },
    };
    getJestSpyOn(XcpNgPoolService, "getRepository").mockReturnValue(builder);
    findDetails = getJestSpyOn(
      XcpNgPoolService,
      "findOneById",
    ).mockResolvedValue(data.details === undefined ? details() : data.details);
    findRules = getJestSpyOn(
      XcpNgPoolLabelRuleService,
      "findBy",
    ).mockResolvedValue(data.rules || []);
  }

  function run(
    rules: Array<XcpNgPoolLabelRule>,
  ): Promise<RuleApplicationResult> {
    return XcpNgPoolLabelRuleEngineService.applyRulesToExistingResource({
      resource: target(),
      rules: rules,
      allowOwnerNotification: false,
    });
  }

  test("reads the XCP-ng pool criteria fields - criteria included", () => {
    expect(XcpNgPoolLabelRuleEngineService.ruleSelect).toEqual({
      _id: true,
      name: true,
      criteria: true,
      xcpNgPoolLabels: { _id: true },
      xcpNgPoolNamePattern: true,
      xcpNgPoolDescriptionPattern: true,
      labelsToAdd: { _id: true },
    });
    expect(XcpNgPoolLabelRuleEngineService.resourceSelectForRuleRun).toEqual({
      _id: true,
      projectId: true,
    });
  });

  test("on create: reads the project's enabled rules, capped, and applies them", async () => {
    arrange({ rules: [labelRule({ namePattern: "^xcp-prod-" })] });
    const resource: XcpNgPool = target();

    await XcpNgPoolLabelRuleEngineService.applyRulesToXcpNgPool(resource);

    const findBy: any = findRules.mock.calls[0]![0];
    expect(findBy.query.projectId).toBe(PROJECT_ID);
    expect(findBy.query.isEnabled).toBe(true);
    expect(findBy.limit).toBe(MAX_RULES_EVALUATED_PER_PROJECT);
    expect(findBy.skip).toBe(0);
    expect(findBy.select).toBe(XcpNgPoolLabelRuleEngineService.ruleSelect);
    expect(findBy.props.isRoot).toBe(true);

    expect(writes).toEqual([
      {
        entity: XcpNgPool,
        relation: "labels",
        of: POOL_ID.toString(),
        ids: [LABEL_A.toString()],
      },
    ]);
    // Synced in memory, so the owner engine that runs next can match on it.
    expect(
      (resource.labels || []).map((label: Label) => {
        return label.id!.toString();
      }),
    ).toEqual([LABEL_A.toString()]);
  });

  test("re-reads exactly the columns evaluation matches on", async () => {
    arrange();

    await run([labelRule({ namePattern: "xcp" })]);

    const reRead: any = findDetails.mock.calls[0]![0];
    expect(reRead.id).toBe(POOL_ID);
    expect(reRead.select).toEqual({
      name: true,
      description: true,
      labels: { _id: true },
    });
    expect(reRead.props).toEqual({ isRoot: true });
  });

  test("on create with no rules: no re-read, no write", async () => {
    arrange({ rules: [] });

    await XcpNgPoolLabelRuleEngineService.applyRulesToXcpNgPool(target());

    expect(findDetails).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });

  test("a pool without an id or project is never evaluated", async () => {
    arrange({ rules: [labelRule()] });

    await XcpNgPoolLabelRuleEngineService.applyRulesToXcpNgPool({
      projectId: PROJECT_ID,
    } as unknown as XcpNgPool);

    expect(findRules).not.toHaveBeenCalled();
    await expect(
      XcpNgPoolLabelRuleEngineService.applyRulesToExistingResource({
        resource: { id: POOL_ID } as unknown as XcpNgPool,
        rules: [labelRule()],
        allowOwnerNotification: false,
      }),
    ).resolves.toEqual(RuleApplicationResultUtil.noMatch());
  });

  test.each([
    ["^xcp-prod-", "xcp-prod-01", true],
    ["XCP-PROD", "xcp-prod-01", true],
    ["-01$", "xcp-prod-01", true],
    ["^xcp-dr-", "xcp-prod-01", false],
    ["xenserver", "xcp-prod-01", false],
  ])(
    "name pattern %p against a pool named %p matches: %p",
    async (pattern: string, name: string, matches: boolean) => {
      arrange({ details: details({ name }) });

      const result: RuleApplicationResult = await run([
        labelRule({ namePattern: pattern }),
      ]);

      expect(result).toEqual(
        matches
          ? RuleApplicationResultUtil.updated(1)
          : RuleApplicationResultUtil.noMatch(),
      );
    },
  );

  test("a description pattern matches case-insensitively", async () => {
    arrange();
    await expect(
      run([labelRule({ descriptionPattern: "tier-1 xcp-ng pool" })]),
    ).resolves.toEqual(RuleApplicationResultUtil.updated(1));
  });

  test("a description pattern never matches a pool without a description", async () => {
    arrange({ details: details({ description: "" }) });

    await expect(
      run([labelRule({ descriptionPattern: ".*" })]),
    ).resolves.toEqual(RuleApplicationResultUtil.noMatch());
  });

  test("name and description patterns must both match", async () => {
    arrange();
    await expect(
      run([
        labelRule({ namePattern: "^xcp-prod-", descriptionPattern: "DC2" }),
      ]),
    ).resolves.toEqual(RuleApplicationResultUtil.noMatch());
  });

  test("a label prerequisite: any one matching label is enough, none is no match", async () => {
    arrange({ details: details({ labels: [LABEL_B] }) });
    await expect(
      run([
        labelRule({
          matchLabels: [LABEL_A, LABEL_B],
          labelsToAdd: [LABEL_A],
        }),
      ]),
    ).resolves.toEqual(RuleApplicationResultUtil.updated(1));

    arrange({ details: details({ labels: [] }) });
    await expect(
      run([labelRule({ matchLabels: [LABEL_B], labelsToAdd: [LABEL_A] })]),
    ).resolves.toEqual(RuleApplicationResultUtil.noMatch());
  });

  test("an invalid regex never matches and never throws", async () => {
    arrange();

    await expect(run([labelRule({ namePattern: "([" })])).resolves.toEqual(
      RuleApplicationResultUtil.noMatch(),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Invalid regex in XCP-ng pool label rule"),
    );
  });

  test("a rule with no condition at all matches every pool", async () => {
    arrange();
    await expect(run([labelRule({})])).resolves.toEqual(
      RuleApplicationResultUtil.updated(1),
    );
  });

  test("configurable criteria on the name field", async () => {
    arrange();
    await expect(
      run([
        labelRule({
          criteria: criteria(
            "xcpNgPoolNamePattern",
            RuleCriteriaOperator.Contains,
            "prod",
          ),
        }),
      ]),
    ).resolves.toEqual(RuleApplicationResultUtil.updated(1));

    arrange();
    await expect(
      run([
        labelRule({
          criteria: criteria(
            "xcpNgPoolNamePattern",
            RuleCriteriaOperator.StartsWith,
            "xcp-dr",
          ),
        }),
      ]),
    ).resolves.toEqual(RuleApplicationResultUtil.noMatch());
  });

  test("configurable criteria take over from stale legacy columns", async () => {
    arrange();

    const result: RuleApplicationResult = await run([
      labelRule({
        namePattern: "^never-matches$",
        criteria: criteria(
          "xcpNgPoolDescriptionPattern",
          RuleCriteriaOperator.Contains,
          "DC1",
        ),
      }),
    ]);

    expect(result).toEqual(RuleApplicationResultUtil.updated(1));
  });

  test("criteria on a field the XCP-ng pool rules do not have never match", async () => {
    arrange();

    await expect(
      run([
        labelRule({
          criteria: criteria(
            "cephClusterNamePattern",
            RuleCriteriaOperator.Contains,
            "prod",
          ),
        }),
      ]),
    ).resolves.toEqual(RuleApplicationResultUtil.noMatch());
  });

  test("only missing labels are added", async () => {
    arrange({ details: details({ labels: [LABEL_A] }) });

    const result: RuleApplicationResult = await run([
      labelRule({ namePattern: "xcp", labelsToAdd: [LABEL_A, LABEL_B] }),
    ]);

    expect(result).toEqual(RuleApplicationResultUtil.updated(1));
    expect(writes[0]!.ids).toEqual([LABEL_B.toString()]);
  });

  test("the union of every matching rule's labels lands in one write", async () => {
    arrange({
      rules: [
        labelRule({ namePattern: "xcp", labelsToAdd: [LABEL_A] }),
        labelRule({
          descriptionPattern: "DC1",
          labelsToAdd: [LABEL_A, LABEL_B],
        }),
        labelRule({ namePattern: "^xcp-dr-", labelsToAdd: [LABEL_B] }),
      ],
    });

    await XcpNgPoolLabelRuleEngineService.applyRulesToXcpNgPool(target());

    expect(writes).toHaveLength(1);
    expect(writes[0]!.ids).toEqual([LABEL_A.toString(), LABEL_B.toString()]);
  });

  test("records which rules attached labels in the pool's feed", async () => {
    arrange();

    await run([
      labelRule({ name: "Prod pools", namePattern: "xcp" }),
      labelRule({ name: "DC1 pools", descriptionPattern: "DC1" }),
    ]);

    expect(feedSpy).toHaveBeenCalledTimes(1);
    const feed: any = feedSpy.mock.calls[0]![0];
    expect(feed.xcpNgPoolId).toBe(POOL_ID);
    expect(feed.projectId).toBe(PROJECT_ID);
    expect(feed.xcpNgPoolFeedEventType).toBe(
      XcpNgPoolFeedEventType.LabelRuleExecuted,
    );
    expect(feed.feedInfoInMarkdown).toContain("1 label(s) were attached to");
    expect(feed.feedInfoInMarkdown).toContain("[XCP-ng Pool xcp-prod-01]");
    expect(feed.feedInfoInMarkdown).toContain("by label rules.");
    expect(feed.moreInformationInMarkdown).toBe(
      "**Label rules that matched**: `Prod pools`, `DC1 pools`",
    );
  });

  test("every label already present: matched, nothing written, no feed item", async () => {
    arrange({ details: details({ labels: [LABEL_A] }) });

    await expect(run([labelRule({ namePattern: "xcp" })])).resolves.toEqual(
      RuleApplicationResultUtil.alreadyApplied(),
    );
    expect(writes).toHaveLength(0);
    expect(feedSpy).not.toHaveBeenCalled();
  });

  test("a matching rule that adds no labels is already applied", async () => {
    arrange();

    await expect(
      run([labelRule({ namePattern: "xcp", labelsToAdd: [] })]),
    ).resolves.toEqual(RuleApplicationResultUtil.alreadyApplied());
  });

  test("a pool deleted before its turn is no match", async () => {
    arrange({ details: null });

    await expect(run([labelRule({ namePattern: "xcp" })])).resolves.toEqual(
      RuleApplicationResultUtil.noMatch(),
    );
  });

  test("a failed write is reported as failed, not thrown", async () => {
    arrange({ failWrite: true });

    await expect(run([labelRule({ namePattern: "xcp" })])).resolves.toEqual(
      RuleApplicationResultUtil.failed(),
    );
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(feedSpy).not.toHaveBeenCalled();
  });

  test("the create hook swallows failures - a label never breaks a create", async () => {
    arrange({
      rules: [labelRule({ namePattern: "xcp" })],
      failWrite: true,
    });

    await expect(
      XcpNgPoolLabelRuleEngineService.applyRulesToXcpNgPool(target()),
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});

describe("XcpNgPoolOwnerRuleEngineService", () => {
  let findRules: jest.SpyInstance;
  let createOwnerUser: jest.SpyInstance;
  let createOwnerTeam: jest.SpyInstance;
  let ownerUserRead: jest.SpyInstance;
  let isMember: jest.SpyInstance;

  function arrange(
    data: {
      rules?: Array<XcpNgPoolOwnerRule>;
      details?: XcpNgPool | null;
      assignedUserIds?: Array<ObjectID>;
      assignedTeamIds?: Array<ObjectID>;
    } = {},
  ): void {
    findRules = getJestSpyOn(
      XcpNgPoolOwnerRuleService,
      "findBy",
    ).mockResolvedValue(data.rules || []);
    getJestSpyOn(XcpNgPoolService, "findOneById").mockResolvedValue(
      data.details === undefined ? details() : data.details,
    );
    const rows: (column: string, ids: Array<ObjectID>) => Array<any> = (
      column: string,
      ids: Array<ObjectID>,
    ): Array<any> => {
      return ids.map((id: ObjectID) => {
        return {
          getColumnValue: (key: string) => {
            return key === column ? id : undefined;
          },
        };
      });
    };
    ownerUserRead = getJestSpyOn(
      XcpNgPoolOwnerUserService,
      "findBy",
    ).mockResolvedValue(rows("userId", data.assignedUserIds || []));
    getJestSpyOn(XcpNgPoolOwnerTeamService, "findBy").mockResolvedValue(
      rows("teamId", data.assignedTeamIds || []),
    );
    createOwnerUser = getJestSpyOn(
      XcpNgPoolOwnerUserService,
      "create",
    ).mockResolvedValue({});
    createOwnerTeam = getJestSpyOn(
      XcpNgPoolOwnerTeamService,
      "create",
    ).mockResolvedValue({});
    isMember = getJestSpyOn(
      TeamMemberService,
      "isUserMemberOfProject",
    ).mockResolvedValue(true);
  }

  function run(
    rules: Array<XcpNgPoolOwnerRule>,
    allowOwnerNotification: boolean = true,
  ): Promise<RuleApplicationResult> {
    return XcpNgPoolOwnerRuleEngineService.applyRulesToExistingResource({
      resource: target(),
      rules: rules,
      allowOwnerNotification,
    });
  }

  test("reads the XCP-ng pool criteria fields and the owners to add", () => {
    expect(XcpNgPoolOwnerRuleEngineService.ruleSelect).toEqual({
      _id: true,
      name: true,
      criteria: true,
      notifyOwners: true,
      xcpNgPoolLabels: { _id: true },
      xcpNgPoolNamePattern: true,
      xcpNgPoolDescriptionPattern: true,
      ownerUsers: { _id: true },
      ownerTeams: { _id: true },
    });
    expect(XcpNgPoolOwnerRuleEngineService.resourceSelectForRuleRun).toEqual({
      _id: true,
      projectId: true,
    });
  });

  test("on create: adds the matching rule's owners to this pool, to be notified", async () => {
    arrange({ rules: [ownerRule()] });

    await XcpNgPoolOwnerRuleEngineService.applyRulesToXcpNgPool(target());

    const findBy: any = findRules.mock.calls[0]![0];
    expect(findBy.query.projectId).toBe(PROJECT_ID);
    expect(findBy.query.isEnabled).toBe(true);
    expect(findBy.limit).toBe(MAX_RULES_EVALUATED_PER_PROJECT);
    expect(findBy.select).toBe(XcpNgPoolOwnerRuleEngineService.ruleSelect);
    expect(findBy.props.isRoot).toBe(true);

    const user: any = createOwnerUser.mock.calls[0]![0];
    expect(user.data.xcpNgPoolId).toBe(POOL_ID);
    expect(user.data.projectId).toBe(PROJECT_ID);
    expect(user.data.userId.toString()).toBe(USER_ID.toString());
    // Not yet notified - the notifier picks it up.
    expect(user.data.isOwnerNotified).toBe(false);
    expect(user.props).toEqual({ isRoot: true });

    const team: any = createOwnerTeam.mock.calls[0]![0];
    expect(team.data.xcpNgPoolId).toBe(POOL_ID);
    expect(team.data.teamId.toString()).toBe(TEAM_ID.toString());
    expect(team.data.isOwnerNotified).toBe(false);
  });

  test("looks up existing owners by xcpNgPoolId and never duplicates one", async () => {
    arrange({ assignedUserIds: [USER_ID] });

    const result: RuleApplicationResult = await run([ownerRule()]);

    expect(ownerUserRead.mock.calls[0]![0].query.xcpNgPoolId).toBe(POOL_ID);
    expect(createOwnerUser).not.toHaveBeenCalled();
    expect(createOwnerTeam).toHaveBeenCalledTimes(1);
    expect(result).toEqual(RuleApplicationResultUtil.updated(1));
  });

  test("every owner already there: matched, nothing added, no feed item", async () => {
    arrange({ assignedUserIds: [USER_ID], assignedTeamIds: [TEAM_ID] });

    await expect(run([ownerRule()])).resolves.toEqual(
      RuleApplicationResultUtil.alreadyApplied(),
    );
    expect(createOwnerUser).not.toHaveBeenCalled();
    expect(createOwnerTeam).not.toHaveBeenCalled();
    expect(feedSpy).not.toHaveBeenCalled();
  });

  test("a run that does not allow notifications adds owners silently", async () => {
    arrange();

    await run([ownerRule({ notifyOwners: true })], false);

    expect(createOwnerUser.mock.calls[0]![0].data.isOwnerNotified).toBe(true);
    expect(createOwnerTeam.mock.calls[0]![0].data.isOwnerNotified).toBe(true);
  });

  test("a rule with notifications off adds owners silently even when the run allows them", async () => {
    arrange();

    await run([ownerRule({ notifyOwners: false })]);

    expect(createOwnerUser.mock.calls[0]![0].data.isOwnerNotified).toBe(true);
  });

  test("an owner two matching rules disagree about is added once, and notified", async () => {
    arrange();

    await run([
      ownerRule({ notifyOwners: false, teams: [] }),
      ownerRule({ notifyOwners: true, teams: [] }),
    ]);

    expect(createOwnerUser).toHaveBeenCalledTimes(1);
    expect(createOwnerUser.mock.calls[0]![0].data.isOwnerNotified).toBe(false);
  });

  test("a name pattern that names another pool adds nobody", async () => {
    arrange({ details: details({ name: "xcp-dr-01" }) });

    await expect(run([ownerRule()])).resolves.toEqual(
      RuleApplicationResultUtil.noMatch(),
    );
    expect(createOwnerUser).not.toHaveBeenCalled();
    expect(feedSpy).not.toHaveBeenCalled();
  });

  test("label criteria see the pool's labels", async () => {
    arrange({ details: details({ labels: [LABEL_A] }) });

    await expect(
      run([
        ownerRule({
          namePattern: "",
          criteria: criteria("xcpNgPoolLabels", RuleCriteriaOperator.HasAllOf, [
            LABEL_A.toString(),
          ]),
        }),
      ]),
    ).resolves.toEqual(RuleApplicationResultUtil.updated(2));
  });

  /*
   * Nobody was added, and the pool does not have the rule's owner: a run
   * counts it as one it could not update, never "already applied" (#9933).
   */
  test("a user who has left the project is not made an owner", async () => {
    arrange();
    isMember.mockResolvedValue(false);

    await expect(run([ownerRule({ teams: [] })])).resolves.toEqual(
      RuleApplicationResultUtil.failed(),
    );
    expect(createOwnerUser).not.toHaveBeenCalled();
  });

  test("an owner insert that lost a race to the unique index is not counted", async () => {
    arrange();
    createOwnerUser.mockRejectedValue(
      Object.assign(new Error("duplicate key value"), { code: "23505" }),
    );

    await expect(run([ownerRule()])).resolves.toEqual(
      RuleApplicationResultUtil.updated(1),
    );
  });

  test("records which rules added owners in the pool's feed", async () => {
    arrange();

    await run([
      ownerRule({
        name: "Virtualization on-call",
        users: [USER_ID, USER_2_ID],
      }),
    ]);

    expect(feedSpy).toHaveBeenCalledTimes(1);
    const feed: any = feedSpy.mock.calls[0]![0];
    expect(feed.xcpNgPoolId).toBe(POOL_ID);
    expect(feed.xcpNgPoolFeedEventType).toBe(
      XcpNgPoolFeedEventType.OwnerRuleExecuted,
    );
    expect(feed.feedInfoInMarkdown).toContain("Owners were added to");
    expect(feed.feedInfoInMarkdown).toContain("by 1 owner rule.");
    expect(feed.moreInformationInMarkdown).toBe(
      "**Owner rules that matched**: `Virtualization on-call`",
    );
  });

  test("a matching rule with no owners is already applied", async () => {
    arrange();

    await expect(run([ownerRule({ users: [], teams: [] })])).resolves.toEqual(
      RuleApplicationResultUtil.alreadyApplied(),
    );
    expect(createOwnerUser).not.toHaveBeenCalled();
  });

  test("a pool deleted before its turn is no match", async () => {
    arrange({ details: null });

    await expect(run([ownerRule()])).resolves.toEqual(
      RuleApplicationResultUtil.noMatch(),
    );
  });

  test("a failing re-read is reported as failed, never thrown", async () => {
    arrange();
    getJestSpyOn(XcpNgPoolService, "findOneById").mockRejectedValue(
      new Error("database is down"),
    );

    await expect(run([ownerRule()])).resolves.toEqual(
      RuleApplicationResultUtil.failed(),
    );
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  test("an invalid regex never matches and never throws", async () => {
    arrange();

    await expect(run([ownerRule({ namePattern: "([" })])).resolves.toEqual(
      RuleApplicationResultUtil.noMatch(),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Invalid regex in XCP-ng pool owner rule"),
    );
  });

  test("the create hook never throws", async () => {
    arrange({ rules: [ownerRule()] });
    createOwnerTeam.mockRejectedValue(new Error("connection terminated"));

    await expect(
      XcpNgPoolOwnerRuleEngineService.applyRulesToXcpNgPool(target()),
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
  });

  test("on create with no rules: nothing is read or written", async () => {
    arrange({ rules: [] });

    await XcpNgPoolOwnerRuleEngineService.applyRulesToXcpNgPool(target());

    expect(XcpNgPoolService.findOneById).not.toHaveBeenCalled();
    expect(createOwnerUser).not.toHaveBeenCalled();
  });
});
