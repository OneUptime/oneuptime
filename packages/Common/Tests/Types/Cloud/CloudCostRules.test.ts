import { describe, expect, test } from "@jest/globals";
import {
  CLOUD_COST_MAX_CONDITIONS_PER_RULE,
  CLOUD_COST_MAX_RULES_PER_GROUP,
  CLOUD_COST_MAX_VALUES_PER_CONDITION,
  CloudCostFacts,
  CloudCostPartPlacement,
  CloudCostRule,
  CloudCostRuleCondition,
  CloudCostRuleField,
  CloudCostRuleOperator,
  findCloudCostGroupsThatNeverMatch,
  getCloudCostRuleFields,
  getCloudCostRuleIds,
  getCloudCostRulesProblem,
  makeCloudCostRule,
  matchesCloudCostCondition,
  matchesCloudCostRules,
  placeCloudCost,
  readCloudCostRules,
  ruleCovers,
  rulesAskAboutOwners,
} from "../../../Types/Cloud/CloudCostRules";
import BadDataException from "../../../Types/Exception/BadDataException";

/*
 * THE RULES A COST GROUP SORTS SPEND BY (#11006): read and checked as the
 * server keeps them, matched as the allocation matches them - the first
 * group whose rules match takes a cost, a resource owned by several teams
 * split evenly between them - and the groups an earlier group already
 * takes everything from, found from the rules alone.
 */

const ACCOUNT_A: string = "0192f1a0-0000-7000-8000-0000000000a1";
const ACCOUNT_B: string = "0192f1a0-0000-7000-8000-0000000000b2";
const PAYMENTS: string = "0192f1a0-0000-7000-8000-00000000aa01";
const SEARCH: string = "0192f1a0-0000-7000-8000-00000000aa02";
const PLATFORM: string = "0192f1a0-0000-7000-8000-00000000aa03";
const PRODUCTION: string = "0192f1a0-0000-7000-8000-00000000bb01";
const ENVIRONMENT: string = "0192f1a0-0000-7000-8000-00000000cc01";

function condition(
  field: CloudCostRuleField,
  operator: CloudCostRuleOperator,
  values: Array<string>,
  key?: string,
): CloudCostRuleCondition {
  return { field, operator, values, ...(key ? { key } : {}) };
}

function rule(...conditions: Array<CloudCostRuleCondition>): CloudCostRule {
  return { conditions };
}

function cost(overrides: Partial<CloudCostFacts> = {}): CloudCostFacts {
  return {
    cloudAccountId: ACCOUNT_A,
    provider: "aws",
    service: "Amazon Elastic Compute Cloud - Compute",
    region: "us-east-1",
    resourceId: "i-0abc",
    tags: {},
    ...overrides,
  };
}

function part(
  overrides: Partial<CloudCostFacts> = {},
  ownerTeamId: string = "",
): CloudCostFacts & { ownerTeamId: string } {
  return { ...cost(overrides), ownerTeamId };
}

function problem(value: unknown): string {
  try {
    readCloudCostRules(value);
  } catch (err) {
    expect(err).toBeInstanceOf(BadDataException);
    return (err as Error).message;
  }

  throw new Error("The rules were read without a problem.");
}

describe("reading a group's rules", () => {
  test("no rules is a group that takes nothing yet", () => {
    expect(readCloudCostRules(undefined)).toEqual([]);
    expect(readCloudCostRules(null)).toEqual([]);
    expect(readCloudCostRules([])).toEqual([]);
  });

  test("the issue's Payments group reads as written", () => {
    const rules: Array<CloudCostRule> = readCloudCostRules([
      {
        conditions: [
          { field: "tag", key: " team ", operator: "is", values: ["payments"] },
        ],
      },
      {
        conditions: [{ field: "account", operator: "is", values: [ACCOUNT_A] }],
      },
      {
        conditions: [
          {
            field: "ownerTeam",
            operator: "is",
            values: [PAYMENTS.toUpperCase()],
          },
        ],
      },
    ]);

    expect(rules).toEqual([
      rule(
        condition(
          CloudCostRuleField.Tag,
          CloudCostRuleOperator.Is,
          ["payments"],
          "team",
        ),
      ),
      rule(
        condition(CloudCostRuleField.Account, CloudCostRuleOperator.Is, [
          ACCOUNT_A,
        ]),
      ),
      rule(
        condition(CloudCostRuleField.OwnerTeam, CloudCostRuleOperator.Is, [
          PAYMENTS,
        ]),
      ),
    ]);
  });

  test("values are trimmed and kept once, whatever their case", () => {
    const rules: Array<CloudCostRule> = readCloudCostRules([
      {
        conditions: [
          {
            field: "service",
            operator: "contains",
            values: [" EC2 ", "ec2", "S3", 3],
          },
        ],
      },
    ]);

    expect(rules[0]!.conditions[0]!.values).toEqual(["EC2", "S3", "3"]);
  });

  test("a tag's existence asks for no values", () => {
    expect(
      readCloudCostRules([
        {
          conditions: [
            {
              field: "tag",
              key: "team",
              operator: "exists",
              values: ["ignored"],
            },
          ],
        },
      ]),
    ).toEqual([
      rule(
        condition(
          CloudCostRuleField.Tag,
          CloudCostRuleOperator.Exists,
          [],
          "team",
        ),
      ),
    ]);
  });

  test("a Region or a resource may be empty: a global service, a cost billed to no resource", () => {
    expect(
      readCloudCostRules([
        { conditions: [{ field: "region", operator: "is", values: [""] }] },
        { conditions: [{ field: "resource", operator: "is", values: [" "] }] },
      ]).map((entry: CloudCostRule) => {
        return entry.conditions[0]!.values;
      }),
    ).toEqual([[""], [""]]);

    expect(
      problem([
        { conditions: [{ field: "service", operator: "is", values: [""] }] },
      ]),
    ).toBe("Rule 1, condition 1 has an empty value.");
  });

  test("a cloud is aws, azure or gcp, kept in lower case", () => {
    expect(
      readCloudCostRules([
        {
          conditions: [{ field: "provider", operator: "is", values: ["AWS"] }],
        },
      ])[0]!.conditions[0]!.values,
    ).toEqual(["aws"]);
    expect(
      problem([
        {
          conditions: [
            { field: "provider", operator: "is", values: ["oracle"] },
          ],
        },
      ]),
    ).toBe("Rule 1, condition 1: the cloud is aws, azure or gcp.");
  });

  test("each refusal says what to fix", () => {
    expect(problem("tag team")).toBe(
      "A cost group's rules must be a list. Send each rule as an object with its conditions.",
    );
    expect(problem([{}])).toBe(
      "Rule 1 must be an object with a list of conditions.",
    );
    expect(problem([{ conditions: [] }])).toBe(
      "Rule 1 has no conditions. Add a condition, or remove the rule.",
    );
    expect(
      problem([
        { conditions: [{ field: "service", operator: "is", values: ["a"] }] },
        { conditions: [{ field: "colour", operator: "is", values: ["red"] }] },
      ]),
    ).toContain("Rule 2, condition 1 has no field OneUptime knows.");
    expect(
      problem([
        {
          conditions: [
            { field: "account", operator: "contains", values: ["1"] },
          ],
        },
      ]),
    ).toBe(
      "Rule 1, condition 1 cannot use that operator on account. Use one of: is, isNot.",
    );
    expect(
      problem([
        { conditions: [{ field: "tag", operator: "is", values: ["a"] }] },
      ]),
    ).toBe("Rule 1, condition 1 needs the tag's key.");
    expect(
      problem([
        { conditions: [{ field: "service", operator: "is", values: [] }] },
      ]),
    ).toBe("Rule 1, condition 1 needs at least one value.");
    expect(
      problem([
        {
          conditions: [
            { field: "ownerTeam", operator: "is", values: ["Payments"] },
          ],
        },
      ]),
    ).toBe(
      "Rule 1, condition 1 has a value that is not an ID. Pick the ownerTeam from the list.",
    );
    expect(
      problem([
        {
          conditions: [
            { field: "service", operator: "is", values: [{ a: 1 }] },
          ],
        },
      ]),
    ).toBe("Rule 1, condition 1 has a value that is not text.");
    expect(
      problem([
        {
          conditions: [
            {
              field: "tag",
              key: "k".repeat(129),
              operator: "is",
              values: ["a"],
            },
          ],
        },
      ]),
    ).toBe("Rule 1, condition 1: a tag's key is at most 128 characters.");
    expect(
      problem([
        {
          conditions: [
            {
              field: "tag",
              key: "team",
              operator: "is",
              values: ["v".repeat(257)],
            },
          ],
        },
      ]),
    ).toBe("Rule 1, condition 1 has a value longer than 256 characters.");
  });

  test("a group's rules, conditions and values are bounded", () => {
    const one: unknown = {
      conditions: [{ field: "service", operator: "is", values: ["a"] }],
    };

    expect(
      problem(new Array(CLOUD_COST_MAX_RULES_PER_GROUP + 1).fill(one)),
    ).toContain(`at most ${CLOUD_COST_MAX_RULES_PER_GROUP} rules`);
    expect(
      problem([
        {
          conditions: new Array(CLOUD_COST_MAX_CONDITIONS_PER_RULE + 1).fill({
            field: "service",
            operator: "is",
            values: ["a"],
          }),
        },
      ]),
    ).toContain(`at most ${CLOUD_COST_MAX_CONDITIONS_PER_RULE} conditions`);
    expect(
      problem([
        {
          conditions: [
            {
              field: "service",
              operator: "is",
              values: Array.from(
                { length: CLOUD_COST_MAX_VALUES_PER_CONDITION + 1 },
                (_value: unknown, index: number): string => {
                  return `service ${index}`;
                },
              ),
            },
          ],
        },
      ]),
    ).toContain(`at most ${CLOUD_COST_MAX_VALUES_PER_CONDITION} values`);
    expect(
      readCloudCostRules(new Array(CLOUD_COST_MAX_RULES_PER_GROUP).fill(one)),
    ).toHaveLength(CLOUD_COST_MAX_RULES_PER_GROUP);
  });

  test("the form's check says the server's words", () => {
    expect(getCloudCostRulesProblem([{ conditions: [] }])).toBe(
      "Rule 1 has no conditions. Add a condition, or remove the rule.",
    );
    expect(getCloudCostRulesProblem([])).toBeNull();
  });
});

describe("matching one condition", () => {
  test("is and is not compare whole values, whatever their case", () => {
    const is: CloudCostRuleCondition = condition(
      CloudCostRuleField.Service,
      CloudCostRuleOperator.Is,
      ["amazon elastic compute cloud - compute", "Amazon S3"],
    );

    expect(matchesCloudCostCondition(part(), is)).toBe(true);
    expect(
      matchesCloudCostCondition(part({ service: "Amazon S3 Glacier" }), is),
    ).toBe(false);
    expect(
      matchesCloudCostCondition(part({ service: "Amazon S3 Glacier" }), {
        ...is,
        operator: CloudCostRuleOperator.IsNot,
      }),
    ).toBe(true);
  });

  test("contains, starts with and ends with read the text", () => {
    const facts: CloudCostFacts & { ownerTeamId: string } = part({
      region: "europe-west1",
    });

    expect(
      matchesCloudCostCondition(
        facts,
        condition(CloudCostRuleField.Region, CloudCostRuleOperator.Contains, [
          "WEST",
        ]),
      ),
    ).toBe(true);
    expect(
      matchesCloudCostCondition(
        facts,
        condition(
          CloudCostRuleField.Region,
          CloudCostRuleOperator.DoesNotContain,
          ["west", "east"],
        ),
      ),
    ).toBe(false);
    expect(
      matchesCloudCostCondition(
        facts,
        condition(CloudCostRuleField.Region, CloudCostRuleOperator.StartsWith, [
          "us-",
          "europe-",
        ]),
      ),
    ).toBe(true);
    expect(
      matchesCloudCostCondition(
        facts,
        condition(CloudCostRuleField.Region, CloudCostRuleOperator.EndsWith, [
          "1",
        ]),
      ),
    ).toBe(true);
    expect(
      matchesCloudCostCondition(
        facts,
        condition(CloudCostRuleField.Region, CloudCostRuleOperator.EndsWith, [
          "2",
        ]),
      ),
    ).toBe(false);
  });

  test("a tag is read by its key as written, its value whatever its case", () => {
    const tagged: CloudCostFacts & { ownerTeamId: string } = part({
      tags: { team: "Payments", Team: "search" },
    });

    expect(
      matchesCloudCostCondition(
        tagged,
        condition(
          CloudCostRuleField.Tag,
          CloudCostRuleOperator.Is,
          ["payments"],
          "team",
        ),
      ),
    ).toBe(true);
    expect(
      matchesCloudCostCondition(
        tagged,
        condition(
          CloudCostRuleField.Tag,
          CloudCostRuleOperator.Is,
          ["payments"],
          "Team",
        ),
      ),
    ).toBe(false);
    expect(
      matchesCloudCostCondition(
        tagged,
        condition(
          CloudCostRuleField.Tag,
          CloudCostRuleOperator.Exists,
          [],
          "team",
        ),
      ),
    ).toBe(true);
    expect(
      matchesCloudCostCondition(
        tagged,
        condition(
          CloudCostRuleField.Tag,
          CloudCostRuleOperator.DoesNotExist,
          [],
          "env",
        ),
      ),
    ).toBe(true);
    // A tag carried empty is not carried.
    expect(
      matchesCloudCostCondition(
        part({ tags: { env: "" } }),
        condition(
          CloudCostRuleField.Tag,
          CloudCostRuleOperator.Exists,
          [],
          "env",
        ),
      ),
    ).toBe(false);
    // A cost without the tag is "not payments".
    expect(
      matchesCloudCostCondition(
        part(),
        condition(
          CloudCostRuleField.Tag,
          CloudCostRuleOperator.IsNot,
          ["payments"],
          "team",
        ),
      ),
    ).toBe(true);
  });

  test("labels are the resource's and its account's, any of them", () => {
    const labelled: CloudCostFacts & { ownerTeamId: string } = part({
      labelIds: [PRODUCTION.toUpperCase()],
    });

    expect(
      matchesCloudCostCondition(
        labelled,
        condition(CloudCostRuleField.Label, CloudCostRuleOperator.Is, [
          PRODUCTION,
        ]),
      ),
    ).toBe(true);
    expect(
      matchesCloudCostCondition(
        part(),
        condition(CloudCostRuleField.Label, CloudCostRuleOperator.IsNot, [
          PRODUCTION,
        ]),
      ),
    ).toBe(true);
  });

  test("an App Platforms environment, an owner team and an account", () => {
    expect(
      matchesCloudCostCondition(
        part({ environmentIds: [ENVIRONMENT] }),
        condition(CloudCostRuleField.Environment, CloudCostRuleOperator.Is, [
          ENVIRONMENT,
        ]),
      ),
    ).toBe(true);
    expect(
      matchesCloudCostCondition(
        part({}, PAYMENTS),
        condition(CloudCostRuleField.OwnerTeam, CloudCostRuleOperator.Is, [
          PAYMENTS,
        ]),
      ),
    ).toBe(true);
    expect(
      matchesCloudCostCondition(
        part({}, ""),
        condition(CloudCostRuleField.OwnerTeam, CloudCostRuleOperator.IsNot, [
          PAYMENTS,
        ]),
      ),
    ).toBe(true);
    expect(
      matchesCloudCostCondition(
        part({ cloudAccountId: ACCOUNT_B.toUpperCase() }),
        condition(CloudCostRuleField.Account, CloudCostRuleOperator.Is, [
          ACCOUNT_B,
        ]),
      ),
    ).toBe(true);
  });

  test("a stored cost is never a Kubernetes namespace's; a namespace's part is", () => {
    const namespaced: CloudCostRuleCondition = condition(
      CloudCostRuleField.KubernetesNamespace,
      CloudCostRuleOperator.StartsWith,
      ["payments-"],
    );

    expect(matchesCloudCostCondition(part(), namespaced)).toBe(false);
    expect(
      matchesCloudCostCondition(
        part({ kubernetesNamespace: "payments-api" }),
        namespaced,
      ),
    ).toBe(true);
  });
});

describe("rules: any rule, all of its conditions", () => {
  test("a rule needs all of its conditions; a group any of its rules", () => {
    const rules: Array<CloudCostRule> = [
      rule(
        condition(CloudCostRuleField.Service, CloudCostRuleOperator.Contains, [
          "compute",
        ]),
        condition(CloudCostRuleField.Region, CloudCostRuleOperator.Is, [
          "eu-west-1",
        ]),
      ),
      rule(
        condition(CloudCostRuleField.Account, CloudCostRuleOperator.Is, [
          ACCOUNT_B,
        ]),
      ),
    ];

    expect(matchesCloudCostRules(part(), rules)).toBe(false);
    expect(matchesCloudCostRules(part({ region: "eu-west-1" }), rules)).toBe(
      true,
    );
    expect(
      matchesCloudCostRules(part({ cloudAccountId: ACCOUNT_B }), rules),
    ).toBe(true);
    expect(matchesCloudCostRules(part(), [])).toBe(false);
    expect(matchesCloudCostRules(part(), [rule()])).toBe(false);
  });
});

describe("where a cost goes in a view", () => {
  const byTeam: Array<{ rules: Array<CloudCostRule> }> = [
    // By tag.
    {
      rules: [
        rule(
          condition(
            CloudCostRuleField.Tag,
            CloudCostRuleOperator.Is,
            ["payments"],
            "team",
          ),
        ),
      ],
    },
    // By account.
    {
      rules: [
        rule(
          condition(CloudCostRuleField.Account, CloudCostRuleOperator.Is, [
            ACCOUNT_B,
          ]),
        ),
      ],
    },
    // By owner team.
    {
      rules: [
        rule(
          condition(CloudCostRuleField.OwnerTeam, CloudCostRuleOperator.Is, [
            SEARCH,
          ]),
        ),
      ],
    },
  ];

  function placed(facts: CloudCostFacts): Array<[number, number]> {
    return placeCloudCost({ groups: byTeam, facts }).map(
      (entry: CloudCostPartPlacement): [number, number] => {
        return [entry.groupIndex, entry.share];
      },
    );
  }

  test("the first group that matches takes it: nothing counts twice", () => {
    // Tagged payments AND in account B: the tag group comes first.
    expect(
      placed(cost({ tags: { team: "payments" }, cloudAccountId: ACCOUNT_B })),
    ).toEqual([[0, 1]]);
    expect(placed(cost({ cloudAccountId: ACCOUNT_B }))).toEqual([[1, 1]]);
    expect(placed(cost({ ownerTeamIds: [SEARCH] }))).toEqual([[2, 1]]);
    // Nothing matches: unallocated.
    expect(placed(cost())).toEqual([[-1, 1]]);
  });

  test("a resource with several owner teams is split evenly between them", () => {
    // Search's half to Search; Payments has no owner group, so its half is unallocated.
    expect(placed(cost({ ownerTeamIds: [PAYMENTS, SEARCH] }))).toEqual([
      [-1, 0.5],
      [2, 0.5],
    ]);
    // A rule above that asks nothing of owners takes both halves: the whole cost.
    expect(
      placed(
        cost({ ownerTeamIds: [PAYMENTS, SEARCH], tags: { team: "payments" } }),
      ),
    ).toEqual([
      [0, 0.5],
      [0, 0.5],
    ]);
    // Three owners, each a third; the same team twice counts once.
    const thirds: Array<CloudCostPartPlacement> = placeCloudCost({
      groups: byTeam,
      facts: cost({
        ownerTeamIds: [PAYMENTS, SEARCH, PLATFORM, SEARCH.toUpperCase()],
      }),
    });
    expect(thirds).toHaveLength(3);
    expect(
      thirds.reduce((sum: number, entry: CloudCostPartPlacement): number => {
        return sum + entry.share;
      }, 0),
    ).toBeCloseTo(1, 10);
  });

  test("whether a view's rules ask about owners, and what they read", () => {
    expect(rulesAskAboutOwners(byTeam)).toBe(true);
    expect(rulesAskAboutOwners(byTeam.slice(0, 2))).toBe(false);
    expect(Array.from(getCloudCostRuleFields(byTeam)).sort()).toEqual(
      [
        CloudCostRuleField.Account,
        CloudCostRuleField.OwnerTeam,
        CloudCostRuleField.Tag,
      ].sort(),
    );
    expect(getCloudCostRuleIds(byTeam, CloudCostRuleField.OwnerTeam)).toEqual([
      SEARCH,
    ]);
  });
});

describe("groups an earlier group takes everything from", () => {
  const services: (
    operator: CloudCostRuleOperator,
    values: Array<string>,
  ) => CloudCostRuleCondition = (
    operator: CloudCostRuleOperator,
    values: Array<string>,
  ): CloudCostRuleCondition => {
    return condition(CloudCostRuleField.Service, operator, values);
  };

  test("an earlier rule covers a narrower one", () => {
    expect(
      ruleCovers(
        rule(services(CloudCostRuleOperator.Is, ["EC2", "S3"])),
        rule(
          services(CloudCostRuleOperator.Is, ["ec2"]),
          condition(CloudCostRuleField.Region, CloudCostRuleOperator.Is, [
            "eu-west-1",
          ]),
        ),
      ),
    ).toBe(true);
    expect(
      ruleCovers(
        rule(
          condition(
            CloudCostRuleField.Tag,
            CloudCostRuleOperator.Exists,
            [],
            "team",
          ),
        ),
        rule(
          condition(
            CloudCostRuleField.Tag,
            CloudCostRuleOperator.Is,
            ["payments"],
            "team",
          ),
        ),
      ),
    ).toBe(true);
    expect(
      ruleCovers(
        rule(services(CloudCostRuleOperator.Contains, ["amazon"])),
        rule(services(CloudCostRuleOperator.Is, ["Amazon S3"])),
      ),
    ).toBe(true);
    expect(
      ruleCovers(
        rule(services(CloudCostRuleOperator.Contains, ["ec2"])),
        rule(services(CloudCostRuleOperator.StartsWith, ["ec2-"])),
      ),
    ).toBe(true);
    expect(
      ruleCovers(
        rule(services(CloudCostRuleOperator.IsNot, ["S3"])),
        rule(services(CloudCostRuleOperator.Is, ["EC2"])),
      ),
    ).toBe(true);
    // A tag "is empty" is a tag not carried.
    expect(
      ruleCovers(
        rule(
          condition(
            CloudCostRuleField.Tag,
            CloudCostRuleOperator.DoesNotExist,
            [],
            "team",
          ),
        ),
        rule(
          condition(
            CloudCostRuleField.Tag,
            CloudCostRuleOperator.Is,
            [""],
            "team",
          ),
        ),
      ),
    ).toBe(true);
  });

  test("it never claims more than the conditions say", () => {
    // Another tag's key.
    expect(
      ruleCovers(
        rule(
          condition(
            CloudCostRuleField.Tag,
            CloudCostRuleOperator.Exists,
            [],
            "team",
          ),
        ),
        rule(
          condition(
            CloudCostRuleField.Tag,
            CloudCostRuleOperator.Is,
            ["a"],
            "env",
          ),
        ),
      ),
    ).toBe(false);
    // A value the earlier rule does not name.
    expect(
      ruleCovers(
        rule(services(CloudCostRuleOperator.Is, ["EC2"])),
        rule(services(CloudCostRuleOperator.Is, ["EC2", "S3"])),
      ),
    ).toBe(false);
    // An earlier rule with a condition the later one says nothing of.
    expect(
      ruleCovers(
        rule(
          services(CloudCostRuleOperator.Is, ["EC2"]),
          condition(CloudCostRuleField.Region, CloudCostRuleOperator.Is, [
            "us-east-1",
          ]),
        ),
        rule(services(CloudCostRuleOperator.Is, ["EC2"])),
      ),
    ).toBe(false);
    expect(
      ruleCovers(rule(), rule(services(CloudCostRuleOperator.Is, ["EC2"]))),
    ).toBe(false);
  });

  test("a group whose every rule an earlier group covers is named, with the group that covers it", () => {
    const groups: Array<{ rules: Array<CloudCostRule> }> = [
      { rules: [rule(services(CloudCostRuleOperator.Contains, ["compute"]))] },
      {
        rules: [
          rule(services(CloudCostRuleOperator.Is, ["Amazon S3"])),
          rule(
            condition(CloudCostRuleField.Account, CloudCostRuleOperator.Is, [
              ACCOUNT_A,
            ]),
          ),
        ],
      },
      {
        rules: [
          rule(services(CloudCostRuleOperator.Is, ["Compute Engine"])),
          rule(services(CloudCostRuleOperator.Is, ["Amazon S3"])),
        ],
      },
      // No rules: takes nothing, but is no one's shadow.
      { rules: [] },
    ];

    expect(findCloudCostGroupsThatNeverMatch(groups)).toEqual([
      { groupIndex: 2, coveredByGroupIndex: 0 },
    ]);
  });
});

test("a rule started from an unallocated service, tag value or team", () => {
  expect(
    makeCloudCostRule({
      field: CloudCostRuleField.Tag,
      key: "team",
      value: "search",
    }),
  ).toEqual(
    rule(
      condition(
        CloudCostRuleField.Tag,
        CloudCostRuleOperator.Is,
        ["search"],
        "team",
      ),
    ),
  );
  expect(
    makeCloudCostRule({
      field: CloudCostRuleField.Service,
      value: "Amazon S3",
    }),
  ).toEqual(
    rule(
      condition(CloudCostRuleField.Service, CloudCostRuleOperator.Is, [
        "Amazon S3",
      ]),
    ),
  );
  // What it makes reads back as itself.
  expect(
    readCloudCostRules([
      makeCloudCostRule({ field: CloudCostRuleField.OwnerTeam, value: SEARCH }),
    ]),
  ).toEqual([
    rule(
      condition(CloudCostRuleField.OwnerTeam, CloudCostRuleOperator.Is, [
        SEARCH,
      ]),
    ),
  ]);
});
