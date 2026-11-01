import CloudResourceFeedService from "../../../../Server/Services/CloudResourceFeedService";
import CloudResourceLabelRuleEngineService from "../../../../Server/Services/CloudResourceLabelRuleEngineService";
import CloudResourceLabelRuleService from "../../../../Server/Services/CloudResourceLabelRuleService";
import CloudResourceOwnerRuleEngineService from "../../../../Server/Services/CloudResourceOwnerRuleEngineService";
import CloudResourceOwnerRuleService from "../../../../Server/Services/CloudResourceOwnerRuleService";
import CloudResourceService from "../../../../Server/Services/CloudResourceService";
import logger from "../../../../Server/Utils/Logger";
import OwnerRuleAssignment from "../../../../Server/Utils/Rules/OwnerRuleAssignment";
import CloudResource from "../../../../Models/DatabaseModels/CloudResource";
import CloudResourceLabelRule from "../../../../Models/DatabaseModels/CloudResourceLabelRule";
import CloudResourceOwnerRule from "../../../../Models/DatabaseModels/CloudResourceOwnerRule";
import CloudResourceOwnerUser from "../../../../Models/DatabaseModels/CloudResourceOwnerUser";
import Label from "../../../../Models/DatabaseModels/Label";
import User from "../../../../Models/DatabaseModels/User";
import BadDataException from "../../../../Types/Exception/BadDataException";
import {
  CloudResourceKind,
  assertCloudRuleKind,
  doesCloudRuleApplyToKind,
} from "../../../../Types/Cloud/CloudResourceKind";
import ObjectID from "../../../../Types/ObjectID";
import FeedMarkdown from "../../../../Utils/Markdown/FeedMarkdown";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import { stubProjectDirectory } from "../../TestingUtils/ProjectDirectory";

/*
 * Cloud and App Platforms became two products over one CloudResource
 * table, and each product's owner and label rules are its own: a rule
 * names the kind of row it is for - App Platforms' environments or Cloud's
 * resources - and changes no row of the other kind. A rule made before the
 * split names neither and keeps applying to both, as it always did. The
 * engines are run here over one resource of each kind with three rules,
 * one of each, and the rule services refuse a kind that is neither.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const RESOURCE_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);
// The label or owner each rule adds, so a write says which rule matched.
const ENVIRONMENT_RULE_TARGET: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const RESOURCE_RULE_TARGET: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const BOTH_RULE_TARGET: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

type RuleKind = CloudResourceKind | undefined;

const RULES: Array<{ name: string; kind: RuleKind; target: ObjectID }> = [
  {
    name: "App Platforms rule",
    kind: CloudResourceKind.Environment,
    target: ENVIRONMENT_RULE_TARGET,
  },
  {
    name: "Cloud rule",
    kind: CloudResourceKind.Resource,
    target: RESOURCE_RULE_TARGET,
  },
  // Made before the two products split: for both.
  { name: "Rule for both", kind: undefined, target: BOTH_RULE_TARGET },
];

function cloudResource(): CloudResource {
  const resource: CloudResource = new CloudResource();
  resource.id = RESOURCE_ID;
  resource._id = RESOURCE_ID.toString();
  resource.projectId = PROJECT_ID;
  return resource;
}

// What the engines re-read of the row: a name every rule's pattern matches.
function details(rowKind: string | undefined): CloudResource {
  const resource: CloudResource = cloudResource();
  resource.name = "checkout · us-east-1";
  resource.labels = [];
  if (rowKind !== undefined) {
    resource.cloudResourceKind = rowKind as CloudResourceKind;
  }
  return resource;
}

function labelRules(): Array<CloudResourceLabelRule> {
  return RULES.map(
    (rule: { name: string; kind: RuleKind; target: ObjectID }) => {
      const labelRule: CloudResourceLabelRule = new CloudResourceLabelRule();
      labelRule.id = ObjectID.generate();
      labelRule.name = rule.name;
      labelRule.nameRegexPattern = "checkout";
      if (rule.kind) {
        labelRule.cloudResourceKind = rule.kind;
      }
      const label: Label = new Label();
      label.id = rule.target;
      label._id = rule.target.toString();
      labelRule.labelsToAdd = [label];
      return labelRule;
    },
  );
}

function ownerRules(): Array<CloudResourceOwnerRule> {
  return RULES.map(
    (rule: { name: string; kind: RuleKind; target: ObjectID }) => {
      const ownerRule: CloudResourceOwnerRule = new CloudResourceOwnerRule();
      ownerRule.id = ObjectID.generate();
      ownerRule.name = rule.name;
      ownerRule.nameRegexPattern = "checkout";
      ownerRule.notifyOwners = false;
      if (rule.kind) {
        ownerRule.cloudResourceKind = rule.kind;
      }
      const user: User = new User();
      user.id = rule.target;
      user._id = rule.target.toString();
      ownerRule.ownerUsers = [user];
      ownerRule.ownerTeams = [];
      return ownerRule;
    },
  );
}

// Which rules each kind of row takes, by the label or owner they add.
const EXPECTED: Array<[string, string | undefined, Array<string>]> = [
  [
    "an environment (App Platforms)",
    CloudResourceKind.Environment,
    [ENVIRONMENT_RULE_TARGET.toString(), BOTH_RULE_TARGET.toString()],
  ],
  [
    "a resource (Cloud)",
    CloudResourceKind.Resource,
    [RESOURCE_RULE_TARGET.toString(), BOTH_RULE_TARGET.toString()],
  ],
  [
    "a row written before resources existed, naming no kind",
    undefined,
    [ENVIRONMENT_RULE_TARGET.toString(), BOTH_RULE_TARGET.toString()],
  ],
];

beforeEach(() => {
  stubProjectDirectory({});
  jest.spyOn(logger, "error").mockImplementation(() => {});
  jest.spyOn(logger, "warn").mockImplementation(() => {});
  jest.spyOn(logger, "debug").mockImplementation(() => {});
  jest
    .spyOn(CloudResourceService, "getCloudResourceMarkdownLink")
    .mockResolvedValue(
      FeedMarkdown.asMarkdown("[checkout](/dashboard/app-platforms/x)"),
    );
  jest
    .spyOn(CloudResourceFeedService, "createCloudResourceFeedItem")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("which rules a row takes", () => {
  it.each([
    [CloudResourceKind.Environment, CloudResourceKind.Environment, true],
    [CloudResourceKind.Environment, CloudResourceKind.Resource, false],
    [CloudResourceKind.Resource, CloudResourceKind.Resource, true],
    [CloudResourceKind.Resource, CloudResourceKind.Environment, false],
    [undefined, CloudResourceKind.Environment, true],
    [undefined, CloudResourceKind.Resource, true],
    ["", CloudResourceKind.Resource, true],
    [null, CloudResourceKind.Resource, true],
    // A row that names no kind is an environment.
    [CloudResourceKind.Environment, undefined, true],
    [CloudResourceKind.Resource, null, false],
  ])(
    "a rule for %j and a row of kind %j: %j",
    (
      ruleKind: string | null | undefined,
      rowKind: string | null | undefined,
      applies: boolean,
    ) => {
      expect(doesCloudRuleApplyToKind({ ruleKind, rowKind })).toBe(applies);
    },
  );
});

describe("CloudResourceLabelRuleEngineService over each kind of row", () => {
  it.each(EXPECTED)(
    "%s gets its own product's rules' labels and the old rule's",
    async (
      _name: string,
      rowKind: string | undefined,
      expected: Array<string>,
    ) => {
      const writes: Array<Array<string>> = [];
      const builder: Record<string, unknown> = {};
      Object.assign(builder, {
        createQueryBuilder: () => {
          return builder;
        },
        relation: () => {
          return builder;
        },
        of: () => {
          return builder;
        },
        add: async (labelIds: Array<string>): Promise<void> => {
          writes.push([...labelIds]);
        },
      });
      jest
        .spyOn(CloudResourceService, "getRepository")
        .mockReturnValue(builder as never);
      const findResource: SpyInstance<typeof CloudResourceService.findOneById> =
        jest
          .spyOn(CloudResourceService, "findOneById")
          .mockResolvedValue(details(rowKind));

      await CloudResourceLabelRuleEngineService.applyRulesToExistingResource({
        resource: cloudResource(),
        rules: labelRules(),
        allowOwnerNotification: false,
      });

      // The row's kind is read with it, so the rules can be told apart.
      expect(
        (findResource.mock.calls[0]![0] as { select: Record<string, unknown> })
          .select["cloudResourceKind"],
      ).toBe(true);
      expect(writes.flat().sort()).toEqual([...expected].sort());
    },
  );

  it("a run of one product's rules over the other's row matches nothing", async () => {
    jest
      .spyOn(CloudResourceService, "findOneById")
      .mockResolvedValue(details(CloudResourceKind.Resource));

    const result: unknown =
      await CloudResourceLabelRuleEngineService.applyRulesToExistingResource({
        resource: cloudResource(),
        rules: labelRules().filter((rule: CloudResourceLabelRule) => {
          return rule.cloudResourceKind === CloudResourceKind.Environment;
        }),
        allowOwnerNotification: false,
      });

    expect(result).toMatchObject({ matched: false });
  });

  it("reads each rule's kind with it", () => {
    expect(CloudResourceLabelRuleEngineService.ruleSelect).toMatchObject({
      cloudResourceKind: true,
    });
  });
});

describe("CloudResourceOwnerRuleEngineService over each kind of row", () => {
  it.each(EXPECTED)(
    "%s gets its own product's rules' owners and the old rule's",
    async (
      _name: string,
      rowKind: string | undefined,
      expected: Array<string>,
    ) => {
      const added: Array<string> = [];
      jest
        .spyOn(CloudResourceService, "findOneById")
        .mockResolvedValue(details(rowKind));
      jest
        .spyOn(OwnerRuleAssignment, "getOwnersNotYetAssigned")
        .mockImplementation((async (data: {
          userIds: Array<string>;
          teamIds: Array<string>;
        }) => {
          return {
            userIds: data.userIds.map((id: string) => {
              return new ObjectID(id);
            }),
            teamIds: [],
          };
        }) as never);
      jest
        .spyOn(OwnerRuleAssignment, "createOwner")
        .mockImplementation((async (data: {
          owner: CloudResourceOwnerUser;
        }) => {
          added.push(data.owner.userId!.toString());
          return true;
        }) as never);

      await CloudResourceOwnerRuleEngineService.applyRulesToExistingResource({
        resource: cloudResource(),
        rules: ownerRules(),
        allowOwnerNotification: false,
      });

      expect(added.sort()).toEqual([...expected].sort());
    },
  );

  it("reads each rule's kind with it", () => {
    expect(CloudResourceOwnerRuleEngineService.ruleSelect).toMatchObject({
      cloudResourceKind: true,
    });
  });
});

describe("the kind a rule may be written for", () => {
  it.each([undefined, null, "", "environment", "resource"])(
    "%j is accepted",
    (value: unknown) => {
      expect(() => {
        return assertCloudRuleKind(value);
      }).not.toThrow();
    },
  );

  it.each(["Environment", "resources", "environment ", "vm", 1, true])(
    "%j is refused, saying what is accepted",
    (value: unknown) => {
      expect(() => {
        return assertCloudRuleKind(value);
      }).toThrow(BadDataException);
      expect(() => {
        return assertCloudRuleKind(value);
      }).toThrow(/"environment".*"resource".*both/);
    },
  );

  /*
   * Whoever writes the rule - the Dashboard, the API, Terraform, a workflow
   * - goes through the rule services, which check the kind before anything
   * else is checked or written.
   */
  it.each([
    ["CloudResourceOwnerRuleService", CloudResourceOwnerRuleService],
    ["CloudResourceLabelRuleService", CloudResourceLabelRuleService],
  ])(
    "%s refuses a rule for neither kind, on create and update",
    async (_name: string, service: unknown) => {
      const hooks: {
        checkCreateBeforeReferences: (data: unknown) => Promise<unknown>;
        checkUpdateBeforeReferences: (data: unknown) => Promise<unknown>;
      } = service as never;

      await expect(
        hooks.checkCreateBeforeReferences({
          data: { cloudResourceKind: "vm" },
          props: { isRoot: true },
        }),
      ).rejects.toThrow(BadDataException);
      await expect(
        hooks.checkUpdateBeforeReferences({
          query: {},
          data: { cloudResourceKind: "Resource" },
          props: { isRoot: true },
        }),
      ).rejects.toThrow(BadDataException);
    },
  );
});
