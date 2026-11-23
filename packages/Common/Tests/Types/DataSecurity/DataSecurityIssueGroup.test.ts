import {
  DataSecurityIssueGroupCause,
  DataSecurityIssueGroupDraft,
  DataSecurityIssueGroupFacts,
  DataSecurityIssueGroupIssue,
  DataSecurityIssueGroupNameFact,
  DataSecurityIssueGroupStore,
  DataSecurityIssueGroupTagRole,
  ISSUE_GROUP_CAUSE_WORDS,
  describeIssueGroupCause,
  getCauseTagRole,
  getIssueGroupCauseWords,
  getIssueGroupKey,
  getIssueGroupNameFacts,
  getIssueGroupNameFactsHash,
  getIssueGroupOriginName,
  getNamePatternCandidates,
  getStoreCauseCandidates,
  groupIssuesByCause,
  holdIssueGroupNameToFacts,
  isGroupByCauseOnByDefault,
  matchesNamePattern,
  normalizeCreatorIdentity,
  readDataSecurityIssueGroupFacts,
  refineNamePattern,
  withDeclaredCode,
} from "../../../Types/DataSecurity/DataSecurityIssueGroup";
import { describe, expect, test } from "@jest/globals";

/*
 * ISSUES ONE MISTAKE MADE (#10370): the facts decide a group, strongest
 * first; a group needs two issues and an issue is in one group at most;
 * a group keeps its issues while their stores share its fact; and the name
 * OneUptime AI gives it is held to the facts it was told.
 */

const BUCKET: string = "AWS S3 Bucket";

function store(
  id: string,
  name: string,
  extra?: Partial<DataSecurityIssueGroupStore>,
): DataSecurityIssueGroupStore {
  return {
    id,
    name,
    kind: BUCKET,
    provider: "aws",
    region: "us-east-1",
    accountNumber: "111122223333",
    tags: {},
    managedAsCode: null,
    ...extra,
  };
}

function issue(
  id: string,
  dataStoreId: string,
  checkId: string = "access-not-logged",
  groupKey?: string,
): DataSecurityIssueGroupIssue {
  return { id, checkId, dataStoreId, ...(groupKey ? { groupKey } : {}) };
}

// A store and its issue, numbered: store-N, issue-N.
function numbered(
  count: number,
  make: (index: number) => DataSecurityIssueGroupStore,
  checkId: string = "access-not-logged",
): {
  stores: Array<DataSecurityIssueGroupStore>;
  issues: Array<DataSecurityIssueGroupIssue>;
} {
  const stores: Array<DataSecurityIssueGroupStore> = [];
  const issues: Array<DataSecurityIssueGroupIssue> = [];

  for (let index: number = 1; index <= count; index++) {
    const made: DataSecurityIssueGroupStore = make(index);

    stores.push(made);
    issues.push(issue(`issue-${made.id}`, made.id, checkId));
  }

  return { stores, issues };
}

function pad(index: number): string {
  return String(index).padStart(2, "0");
}

describe("grouping from each fact", () => {
  test("forty buckets one Terraform module made, tagged module=static-site, are one group of the module", () => {
    const { stores, issues } = numbered(40, (index: number) => {
      return store(`s${index}`, `site-${index}-assets`, {
        tags: { module: "static-site", "managed-by": "terraform" },
        managedAsCode: "Terraform",
      });
    });

    const groups: Array<DataSecurityIssueGroupDraft> = groupIssuesByCause({
      issues,
      stores,
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]!.cause).toBe(DataSecurityIssueGroupCause.Tags);
    expect(groups[0]!.issueIds).toHaveLength(40);
    expect(groups[0]!.declaredAsCodeCount).toBe(40);
    expect(groups[0]!.facts.tag).toEqual(["module", "static-site"]);
    expect(groups[0]!.facts.tagRole).toBe(DataSecurityIssueGroupTagRole.Module);
    expect(groups[0]!.facts.managedAsCode).toBe("Terraform");
    expect(groups[0]!.facts.storeKind).toBe(BUCKET);
    expect(groups[0]!.facts.region).toBe("us-east-1");
    expect(groups[0]!.key).toBe(
      getIssueGroupKey({
        checkId: "access-not-logged",
        provider: "aws",
        originKey: "tag:module=static-site",
      }),
    );
  });

  test("the CloudFormation stack's own tag groups what the stack made", () => {
    const { stores, issues } = numbered(3, (index: number) => {
      return store(`s${index}`, `web-${index}`, {
        tags: { "aws:cloudformation:stack-name": "web" },
        managedAsCode: 'CloudFormation stack "web"',
      });
    });

    const [group] = groupIssuesByCause({ issues, stores });

    expect(group!.cause).toBe(DataSecurityIssueGroupCause.Stack);
    expect(group!.facts.stackName).toBe("web");
    expect(group!.facts.managedAsCode).toBe('CloudFormation stack "web"');
    expect(getIssueGroupOriginName(group!.facts)).toBe("web");
  });

  test("a tag set: stores tagged module=static-site and stack=web share both, the module first", () => {
    const { stores, issues } = numbered(4, (index: number) => {
      return store(`s${index}`, `site-${index}`, {
        tags: { module: "static-site", stack: "web", env: "prod" },
      });
    });

    const [group] = groupIssuesByCause({ issues, stores });

    expect(group!.cause).toBe(DataSecurityIssueGroupCause.Tags);
    expect(group!.facts.tag).toEqual(["module", "static-site"]);
    expect(group!.facts.tags).toEqual([
      ["module", "static-site"],
      ["stack", "web"],
    ]);
  });

  test("a stack tag a person wrote and a component tag each group too", () => {
    const stacked: {
      stores: Array<DataSecurityIssueGroupStore>;
      issues: Array<DataSecurityIssueGroupIssue>;
    } = numbered(2, (index: number) => {
      return store(`a${index}`, `a${index}`, { tags: { Stack: "billing" } });
    });
    const components: {
      stores: Array<DataSecurityIssueGroupStore>;
      issues: Array<DataSecurityIssueGroupIssue>;
    } = numbered(2, (index: number) => {
      return store(`b${index}`, `b${index}`, {
        tags: { component: "uploads" },
      });
    });

    const groups: Array<DataSecurityIssueGroupDraft> = groupIssuesByCause({
      issues: [...stacked.issues, ...components.issues],
      stores: [...stacked.stores, ...components.stores],
    });

    expect(
      groups
        .map((group: DataSecurityIssueGroupDraft) => {
          return [group.facts.tagRole, group.facts.tag];
        })
        .sort(),
    ).toEqual(
      [
        [DataSecurityIssueGroupTagRole.Component, ["component", "uploads"]],
        [DataSecurityIssueGroupTagRole.Stack, ["Stack", "billing"]],
      ].sort(),
    );
  });

  test("twelve console-made buckets one identity created are one group of that identity", () => {
    const { stores, issues } = numbered(
      12,
      (index: number) => {
        return store(`s${index}`, `bucket${index}x`, {
          creator: normalizeCreatorIdentity(
            "arn:aws:iam::111122223333:user/alice",
          ),
        });
      },
      "public-access-not-blocked",
    );

    const [group] = groupIssuesByCause({ issues, stores });

    expect(group!.cause).toBe(DataSecurityIssueGroupCause.Creator);
    expect(group!.facts.creator).toBe("user/alice");
    expect(group!.issueIds).toHaveLength(12);
    expect(group!.declaredAsCodeCount).toBe(0);
    expect(group!.facts.managedAsCode).toBeUndefined();
  });

  test("a name pattern groups what is named alike, narrowed to the words all share", () => {
    const { stores, issues } = numbered(12, (index: number) => {
      return store(`s${index}`, `acme-exports-${pad(index)}`);
    });

    const [group] = groupIssuesByCause({ issues, stores });

    expect(group!.cause).toBe(DataSecurityIssueGroupCause.NamePattern);
    expect(group!.facts.pattern).toBe("acme-exports-*");
    expect(group!.issueIds).toHaveLength(12);
  });

  test("a name pattern in the middle of names that differ around it", () => {
    const names: Array<string> = [
      "billing-exports-eu",
      "acme-exports-2023",
      "hr-exports-q1",
    ];
    const stores: Array<DataSecurityIssueGroupStore> = names.map(
      (name: string, index: number) => {
        return store(`s${index}`, name);
      },
    );

    const [group] = groupIssuesByCause({
      issues: stores.map((made: DataSecurityIssueGroupStore) => {
        return issue(`issue-${made.id}`, made.id);
      }),
      stores,
    });

    expect(group!.facts.pattern).toBe("*-exports-*");
    expect(group!.issueIds).toHaveLength(3);
  });

  test("the code that declares them makes a module's group a group of that code", () => {
    const { stores, issues } = numbered(5, (index: number) => {
      return store(`s${index}`, `site-${index}`, {
        tags: { module: "static-site" },
        managedAsCode: "Terraform",
      });
    });
    const [group] = groupIssuesByCause({ issues, stores });
    const facts: DataSecurityIssueGroupFacts = withDeclaredCode(group!.facts, {
      repositoryId: "repo-1",
      repositoryName: "acme/infra",
      paths: ["modules/static-site/main.tf"],
      codeKind: "Terraform",
      reason: "has-named-file",
    });

    expect(facts.cause).toBe(DataSecurityIssueGroupCause.DeclaredCode);
    expect(facts.code?.paths).toEqual(["modules/static-site/main.tf"]);

    // A repository only a tag names is where the pull request goes, not a cause.
    expect(
      withDeclaredCode(group!.facts, {
        repositoryId: "repo-1",
        repositoryName: "acme/infra",
        paths: [],
        codeKind: "Terraform",
        reason: "named-by-tag",
      }).cause,
    ).toBe(DataSecurityIssueGroupCause.Tags);
    expect(withDeclaredCode(group!.facts, null)).toEqual(group!.facts);
  });
});

describe("what decides between facts", () => {
  test("the stack's own tag beats a tag a person wrote, which beats the identity, which beats a name", () => {
    const stores: Array<DataSecurityIssueGroupStore> = [
      store("a", "acme-exports-1", {
        tags: { "aws:cloudformation:stack-name": "web", module: "site" },
        creator: "role/ci",
      }),
      store("b", "acme-exports-2", {
        tags: { "aws:cloudformation:stack-name": "web", module: "site" },
        creator: "role/ci",
      }),
    ];

    expect(
      getStoreCauseCandidates(stores[0]!).map(
        (candidate: { cause: DataSecurityIssueGroupCause }) => {
          return candidate.cause;
        },
      ),
    ).toEqual([
      DataSecurityIssueGroupCause.Stack,
      DataSecurityIssueGroupCause.Tags,
      DataSecurityIssueGroupCause.Creator,
      DataSecurityIssueGroupCause.NamePattern,
      DataSecurityIssueGroupCause.NamePattern,
    ]);

    const [group] = groupIssuesByCause({
      issues: [issue("ia", "a"), issue("ib", "b")],
      stores,
    });

    expect(group!.cause).toBe(DataSecurityIssueGroupCause.Stack);
  });

  test("a stronger fact takes its stores first, and the rest still group by a weaker one", () => {
    const stores: Array<DataSecurityIssueGroupStore> = [];

    for (let index: number = 1; index <= 6; index++) {
      stores.push(
        store(`s${index}`, `acme-exports-${index}`, {
          tags: index <= 3 ? { module: "exports" } : {},
        }),
      );
    }

    const groups: Array<DataSecurityIssueGroupDraft> = groupIssuesByCause({
      issues: stores.map((made: DataSecurityIssueGroupStore) => {
        return issue(`i-${made.id}`, made.id);
      }),
      stores,
    });

    expect(
      groups.map((group: DataSecurityIssueGroupDraft) => {
        return [group.cause, group.dataStoreIds];
      }),
    ).toEqual([
      [DataSecurityIssueGroupCause.Tags, ["s1", "s2", "s3"]],
      [DataSecurityIssueGroupCause.NamePattern, ["s4", "s5", "s6"]],
    ]);
  });

  test("of two facts as strong, the one more stores share", () => {
    const stores: Array<DataSecurityIssueGroupStore> = [
      store("a", "a", { tags: { component: "one", blueprint: "big" } }),
      store("b", "b", { tags: { component: "two", blueprint: "big" } }),
      store("c", "c", { tags: { component: "one", blueprint: "big" } }),
    ];

    const groups: Array<DataSecurityIssueGroupDraft> = groupIssuesByCause({
      issues: stores.map((made: DataSecurityIssueGroupStore) => {
        return issue(`i-${made.id}`, made.id);
      }),
      stores,
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]!.facts.tag).toEqual(["blueprint", "big"]);
    expect(groups[0]!.issueIds).toHaveLength(3);
  });

  test("an issue is in one group at most, whatever it shares", () => {
    const stores: Array<DataSecurityIssueGroupStore> = [];

    for (let index: number = 1; index <= 8; index++) {
      stores.push(
        store(`s${index}`, `acme-exports-${index}`, {
          tags: { module: index % 2 === 0 ? "even" : "odd" },
          creator: "role/ci",
        }),
      );
    }

    const groups: Array<DataSecurityIssueGroupDraft> = groupIssuesByCause({
      issues: stores.map((made: DataSecurityIssueGroupStore) => {
        return issue(`i-${made.id}`, made.id);
      }),
      stores,
    });
    const all: Array<string> = groups.flatMap(
      (group: DataSecurityIssueGroupDraft) => {
        return group.issueIds;
      },
    );

    expect(all).toHaveLength(8);
    expect(new Set(all).size).toBe(8);
    expect(groups).toHaveLength(2);
  });
});

describe("what never groups", () => {
  test("one issue is no group", () => {
    expect(
      groupIssuesByCause({
        issues: [issue("i1", "s1")],
        stores: [store("s1", "a", { tags: { module: "x" } })],
      }),
    ).toEqual([]);
  });

  test("issues of different checks never share a group", () => {
    const stores: Array<DataSecurityIssueGroupStore> = [
      store("s1", "one", { tags: { module: "site" } }),
      store("s2", "two", { tags: { module: "site" } }),
    ];

    expect(
      groupIssuesByCause({
        issues: [
          issue("i1", "s1", "access-not-logged"),
          issue("i2", "s2", "public-access-not-blocked"),
        ],
        stores,
      }),
    ).toEqual([]);
  });

  test("stores of different clouds never share a group", () => {
    const stores: Array<DataSecurityIssueGroupStore> = [
      store("s1", "one", { tags: { module: "site" } }),
      store("s2", "two", {
        tags: { module: "site" },
        provider: "gcp",
        kind: "Google Cloud Storage Bucket",
      }),
    ];

    expect(
      groupIssuesByCause({
        issues: [issue("i1", "s1"), issue("i2", "s2")],
        stores,
      }),
    ).toEqual([]);
  });

  test("a tag the stores merely share - an environment, a team, an owner - says nothing of what made them", () => {
    const { stores, issues } = numbered(10, (index: number) => {
      return store(`s${index}`, `x${index}`, {
        tags: {
          env: "prod",
          team: "payments",
          owner: "alice",
          "cost-center": "42",
        },
      });
    });

    expect(groupIssuesByCause({ issues, stores })).toEqual([]);
  });

  test("names alike only in words that say nothing - an environment, a kind of store, a hash - are no pattern", () => {
    const names: Array<string> = [
      "prod-data-1",
      "prod-data-2",
      "logs-backup-us-east-1",
      "logs-backup-us-west-2",
      "bucket-9f3ab2c7d1",
      "bucket-0c1d2e3f4a",
      "exports",
      "exports",
    ];
    const stores: Array<DataSecurityIssueGroupStore> = names.map(
      (name: string, index: number) => {
        return store(`s${index}`, name);
      },
    );

    expect(
      groupIssuesByCause({
        issues: stores.map((made: DataSecurityIssueGroupStore) => {
          return issue(`i-${made.id}`, made.id);
        }),
        stores,
      }),
    ).toEqual([]);
  });

  test("an issue of a store grouping cannot read is left out", () => {
    expect(
      groupIssuesByCause({
        issues: [issue("i1", "missing"), issue("i2", "also-missing")],
        stores: [],
      }),
    ).toEqual([]);
  });
});

describe("a group follows its issues", () => {
  const key: string = getIssueGroupKey({
    checkId: "access-not-logged",
    provider: "aws",
    originKey: "tag:module=static-site",
  });

  test("an issue already in a group stays in it while its store shares the group's fact, even when a stronger fact appears", () => {
    const stores: Array<DataSecurityIssueGroupStore> = [
      store("s1", "a", {
        tags: { module: "static-site", "aws:cloudformation:stack-name": "x" },
      }),
      store("s2", "b", {
        tags: { module: "static-site", "aws:cloudformation:stack-name": "x" },
      }),
    ];

    const [group] = groupIssuesByCause({
      issues: [
        issue("i1", "s1", "access-not-logged", key),
        issue("i2", "s2", "access-not-logged", key),
      ],
      stores,
    });

    expect(group!.key).toBe(key);
    expect(group!.cause).toBe(DataSecurityIssueGroupCause.Tags);
  });

  test("a group an issue stays in is kept however few of its issues are open, and a new one joins it", () => {
    const groups: Array<DataSecurityIssueGroupDraft> = groupIssuesByCause({
      issues: [issue("i1", "s1", "access-not-logged", key), issue("i2", "s2")],
      stores: [
        store("s1", "a", { tags: { module: "static-site" } }),
        store("s2", "b", { tags: { module: "static-site" } }),
      ],
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]!.key).toBe(key);
    expect(groups[0]!.issueIds.sort()).toEqual(["i1", "i2"]);

    const alone: Array<DataSecurityIssueGroupDraft> = groupIssuesByCause({
      issues: [issue("i1", "s1", "access-not-logged", key)],
      stores: [store("s1", "a", { tags: { module: "static-site" } })],
    });

    expect(alone).toHaveLength(1);
    expect(alone[0]!.issueIds).toEqual(["i1"]);
  });

  test("an issue whose store no longer shares the group's fact leaves it, and can join another", () => {
    const groups: Array<DataSecurityIssueGroupDraft> = groupIssuesByCause({
      issues: [issue("i1", "s1", "access-not-logged", key), issue("i2", "s2")],
      stores: [
        // Its module tag was changed.
        store("s1", "a", { tags: { module: "uploads" } }),
        store("s2", "b", { tags: { module: "uploads" } }),
      ],
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]!.facts.tag).toEqual(["module", "uploads"]);
    expect(groups[0]!.issueIds.sort()).toEqual(["i1", "i2"]);
  });

  test("the same issues group the same way however they are listed", () => {
    const { stores, issues } = numbered(9, (index: number) => {
      return store(`s${index}`, `acme-exports-${index}`, {
        tags: index <= 4 ? { module: "a" } : { component: "b" },
      });
    });
    const forwards: Array<DataSecurityIssueGroupDraft> = groupIssuesByCause({
      issues,
      stores,
    });
    const backwards: Array<DataSecurityIssueGroupDraft> = groupIssuesByCause({
      issues: [...issues].reverse(),
      stores: [...stores].reverse(),
    });

    expect(backwards).toEqual(forwards);
  });
});

describe("name patterns", () => {
  test("each distinctive word of a name is a pattern", () => {
    expect(getNamePatternCandidates("acme-exports-2023")).toEqual([
      { pattern: "acme-*", word: "acme" },
      { pattern: "*-exports-*", word: "exports" },
    ]);
    expect(getNamePatternCandidates("orders_archive.v2")).toEqual([
      { pattern: "orders_*", word: "orders" },
      { pattern: "*_archive.*", word: "archive" },
    ]);
    expect(getNamePatternCandidates("exports")).toEqual([]);
    expect(getNamePatternCandidates("prod-data")).toEqual([]);
  });

  test("a pattern is narrowed only to what every name shares, and keeps its word", () => {
    expect(
      refineNamePattern(
        ["acme-exports-01", "acme-exports-02"],
        "*-exports-*",
        "exports",
      ),
    ).toBe("acme-exports-*");
    expect(
      refineNamePattern(
        ["a-exports-eu", "b-exports-eu"],
        "*-exports-*",
        "exports",
      ),
    ).toBe("*-exports-eu");
    expect(
      refineNamePattern(
        ["billing-exports-eu", "acme-exports-01"],
        "*-exports-*",
        "exports",
      ),
    ).toBe("*-exports-*");
    // Narrowing that loses the word it was grouped by is no narrowing.
    expect(
      refineNamePattern(
        ["team-a-exports", "team-b-exports"],
        "*-exports",
        "exports",
      ),
    ).toBe("team-*-exports");
  });

  test("a name matches a pattern as a person reads it", () => {
    expect(matchesNamePattern("acme-exports-01", "acme-exports-*")).toBe(true);
    expect(matchesNamePattern("ACME-Exports-01", "acme-exports-*")).toBe(true);
    expect(matchesNamePattern("acme-uploads-01", "acme-exports-*")).toBe(false);
    expect(matchesNamePattern("x.y", "x.*")).toBe(true);
    expect(matchesNamePattern("xay", "x.*")).toBe(false);
  });
});

describe("the identity that created a store", () => {
  test.each([
    [
      "arn:aws:sts::111122223333:assumed-role/terraform-ci/run-4512",
      "role/terraform-ci",
    ],
    ["arn:aws:iam::111122223333:role/ci/terraform-ci", "role/terraform-ci"],
    ["arn:aws:iam::111122223333:user/Alice", "user/alice"],
    ["arn:aws:iam::111122223333:root", "root"],
    [
      "deploy@acme.iam.gserviceaccount.com",
      "deploy@acme.iam.gserviceaccount.com",
    ],
    ["  ", null],
    [null, null],
  ])("%s reads as %s", (actor: string | null, expected: string | null) => {
    expect(normalizeCreatorIdentity(actor)).toBe(expected);
  });

  test("every session of one role is the same identity", () => {
    expect(
      normalizeCreatorIdentity(
        "arn:aws:sts::111122223333:assumed-role/terraform-ci/run-1",
      ),
    ).toBe(
      normalizeCreatorIdentity(
        "arn:aws:sts::111122223333:assumed-role/terraform-ci/run-2",
      ),
    );
  });
});

describe("the tags that name what made a store", () => {
  test.each([
    ["module", DataSecurityIssueGroupTagRole.Module],
    ["Terraform_Module", DataSecurityIssueGroupTagRole.Module],
    ["tf:module", DataSecurityIssueGroupTagRole.Module],
    ["stack", DataSecurityIssueGroupTagRole.Stack],
    ["stack_name", DataSecurityIssueGroupTagRole.Stack],
    ["component", DataSecurityIssueGroupTagRole.Component],
    ["env", null],
    ["team", null],
    ["owner", null],
    ["managed-by", null],
    ["aws:cloudformation:stack-name", null],
  ])("%s is %s", (key: string, role: DataSecurityIssueGroupTagRole | null) => {
    expect(getCauseTagRole(key)).toBe(role);
  });
});

describe("what a group's cause is called with none of OneUptime AI's words", () => {
  const base: DataSecurityIssueGroupFacts = {
    cause: DataSecurityIssueGroupCause.Tags,
    checkId: "access-not-logged",
  };

  test.each([
    [
      {
        ...base,
        tag: ["module", "static-site"],
        tagRole: DataSecurityIssueGroupTagRole.Module,
      },
      "the static-site module",
      ISSUE_GROUP_CAUSE_WORDS.module,
    ],
    [
      { ...base, cause: DataSecurityIssueGroupCause.Stack, stackName: "web" },
      "the CloudFormation stack web",
      ISSUE_GROUP_CAUSE_WORDS.cloudFormationStack,
    ],
    [
      {
        ...base,
        tag: ["stack", "web"],
        tagRole: DataSecurityIssueGroupTagRole.Stack,
      },
      "the web stack",
      ISSUE_GROUP_CAUSE_WORDS.stack,
    ],
    [
      {
        ...base,
        tag: ["component", "uploads"],
        tagRole: DataSecurityIssueGroupTagRole.Component,
      },
      "stores tagged component=uploads",
      ISSUE_GROUP_CAUSE_WORDS.tag,
    ],
    [
      {
        ...base,
        cause: DataSecurityIssueGroupCause.Creator,
        creator: "role/terraform-ci",
      },
      "stores the terraform-ci role created",
      ISSUE_GROUP_CAUSE_WORDS.creatorRole,
    ],
    [
      {
        ...base,
        cause: DataSecurityIssueGroupCause.Creator,
        creator: "user/alice",
      },
      "stores alice created",
      ISSUE_GROUP_CAUSE_WORDS.creator,
    ],
    [
      { ...base, cause: DataSecurityIssueGroupCause.Creator, creator: "root" },
      "stores the account's root user created",
      ISSUE_GROUP_CAUSE_WORDS.creatorRoot,
    ],
    [
      {
        ...base,
        cause: DataSecurityIssueGroupCause.NamePattern,
        pattern: "*-exports-*",
      },
      "stores named *-exports-*",
      ISSUE_GROUP_CAUSE_WORDS.pattern,
    ],
  ])("%o is %s", (facts: unknown, english: string, key: string): void => {
    expect(describeIssueGroupCause(facts as DataSecurityIssueGroupFacts)).toBe(
      english,
    );
    expect(
      getIssueGroupCauseWords(facts as DataSecurityIssueGroupFacts).key,
    ).toBe(key);
  });
});

describe("the name OneUptime AI gives a group is held to its facts", () => {
  const facts: DataSecurityIssueGroupFacts = {
    cause: DataSecurityIssueGroupCause.Tags,
    checkId: "access-not-logged",
    tag: ["module", "static-site"],
    tagRole: DataSecurityIssueGroupTagRole.Module,
    storeKind: BUCKET,
    managedAsCode: "Terraform",
  };
  const nameFacts: Array<DataSecurityIssueGroupNameFact> =
    getIssueGroupNameFacts({
      facts,
      checkTitle: "Nobody would know who read it",
      checkDescription:
        "Reads of the store are not logged: no access logs, no data-access audit logs.",
      issueCount: 40,
    });
  const storeNames: Array<string> = ["site-1-assets", "marketing"];

  function hold(
    name: unknown,
    cited: Array<string> = ["F1", "F2"],
  ): string | null {
    return holdIssueGroupNameToFacts({
      answer: { name: name as string, facts: cited },
      facts: nameFacts,
      storeNames,
    });
  }

  test("the facts it is told: what made the stores, what is wrong, what they are - never a store's name", () => {
    expect(
      nameFacts.map((fact: DataSecurityIssueGroupNameFact) => {
        return fact.id;
      }),
    ).toEqual(["F1", "F2", "F3"]);
    expect(nameFacts[0]!.text).toContain("static-site");
    expect(nameFacts[2]!.text).toBe(
      "40 stores, AWS S3 Bucket, declared by Terraform",
    );
    expect(JSON.stringify(nameFacts)).not.toContain("site-1-assets");
  });

  test("a sentence that rests on its facts is kept, without its full stop", () => {
    expect(hold("the static-site module turns off access logs.")).toBe(
      "the static-site module turns off access logs",
    );
    expect(hold("the static-site module leaves 40 buckets unlogged")).toBe(
      "the static-site module leaves 40 buckets unlogged",
    );
    // In the project's language: German.
    expect(hold("das Modul static-site schaltet Zugriffsprotokolle ab")).toBe(
      "das Modul static-site schaltet Zugriffsprotokolle ab",
    );
  });

  test("a name, an id or a number the facts do not hold is dropped", () => {
    // A module it made up.
    expect(hold("the static-web module turns off access logs")).toBeNull();
    // A count it made up.
    expect(
      hold("the static-site module leaves 39 buckets unlogged"),
    ).toBeNull();
    // A repository nobody told it.
    expect(hold("acme/infra turns off access logs")).toBeNull();
  });

  test("it never names one of the group's stores, whatever its words", () => {
    expect(hold("site-1-assets and others turn off access logs")).toBeNull();
    expect(hold("the marketing buckets turn off access logs")).toBeNull();
  });

  test("it rests on the cause's fact, and only on facts it was given", () => {
    expect(
      hold("the static-site module turns off access logs", ["F2"]),
    ).toBeNull();
    expect(
      hold("the static-site module turns off access logs", ["F1", "F9"]),
    ).toBeNull();
    expect(hold("the static-site module turns off access logs", [])).toBeNull();
  });

  test("a link, Markdown, a line too short or too long is dropped", () => {
    expect(hold("see https://example.com for the module")).toBeNull();
    expect(hold("**the static-site module** turns off logs")).toBeNull();
    expect(hold("`static-site` turns off logs")).toBeNull();
    expect(hold("logs")).toBeNull();
    expect(hold(`the static-site module ${"is wrong ".repeat(30)}`)).toBeNull();
    expect(hold(42)).toBeNull();
    expect(
      holdIssueGroupNameToFacts({ answer: null, facts: nameFacts }),
    ).toBeNull();
  });

  test("a pattern the facts hold may be said as it is", () => {
    const patternFacts: Array<DataSecurityIssueGroupNameFact> =
      getIssueGroupNameFacts({
        facts: {
          cause: DataSecurityIssueGroupCause.NamePattern,
          checkId: "public-access-not-blocked",
          pattern: "*-exports-*",
        },
        checkTitle: "Public access is not blocked",
        checkDescription: "S3 Block Public Access is not fully on.",
        issueCount: 12,
      });

    expect(
      holdIssueGroupNameToFacts({
        answer: {
          name: "buckets named *-exports-* leave Block Public Access off",
          facts: ["F1", "F2"],
        },
        facts: patternFacts,
      }),
    ).toBe("buckets named *-exports-* leave Block Public Access off");
  });
});

describe("what a name rests on", () => {
  const facts: DataSecurityIssueGroupFacts = {
    cause: DataSecurityIssueGroupCause.Tags,
    checkId: "access-not-logged",
    tag: ["module", "static-site"],
    tagRole: DataSecurityIssueGroupTagRole.Module,
    region: "us-east-1",
  };

  test("it changes with the cause, the language and the code - never with a region or a count", () => {
    const hash: string = getIssueGroupNameFactsHash(facts, "en");

    expect(getIssueGroupNameFactsHash({ ...facts }, "en")).toBe(hash);
    expect(
      getIssueGroupNameFactsHash({ ...facts, region: "eu-west-1" }, "en"),
    ).toBe(hash);
    expect(getIssueGroupNameFactsHash(facts, "de")).not.toBe(hash);
    expect(
      getIssueGroupNameFactsHash(
        { ...facts, tag: ["module", "uploads"] },
        "en",
      ),
    ).not.toBe(hash);
    expect(
      getIssueGroupNameFactsHash(
        withDeclaredCode(facts, {
          repositoryId: "r",
          repositoryName: "acme/infra",
          paths: ["modules/static-site"],
          codeKind: "Terraform",
          reason: "has-named-file",
        }),
        "en",
      ),
    ).not.toBe(hash);
  });
});

describe("a group's facts as stored", () => {
  test("they read back as they were kept", () => {
    const facts: DataSecurityIssueGroupFacts = withDeclaredCode(
      {
        cause: DataSecurityIssueGroupCause.Tags,
        checkId: "access-not-logged",
        tag: ["module", "static-site"],
        tagRole: DataSecurityIssueGroupTagRole.Module,
        tags: [["module", "static-site"]],
        storeKind: BUCKET,
        provider: "aws",
        region: "us-east-1",
        accountNumber: "111122223333",
        managedAsCode: "Terraform",
      },
      {
        repositoryId: "repo",
        repositoryName: "acme/infra",
        paths: ["modules/static-site"],
        codeKind: "Terraform",
        reason: "has-named-file",
      },
    );

    expect(
      readDataSecurityIssueGroupFacts(JSON.parse(JSON.stringify(facts))),
    ).toEqual(facts);
  });

  test("what this build cannot read is no facts, and a stray value is left out", () => {
    expect(readDataSecurityIssueGroupFacts(null)).toBeNull();
    expect(readDataSecurityIssueGroupFacts([])).toBeNull();
    expect(
      readDataSecurityIssueGroupFacts({ cause: "Guess", checkId: "x" }),
    ).toBeNull();
    expect(
      readDataSecurityIssueGroupFacts({
        cause: DataSecurityIssueGroupCause.Creator,
        checkId: "x",
        creator: 42,
        tag: ["only-one"],
        tagRole: "Owner",
      }),
    ).toEqual({ cause: DataSecurityIssueGroupCause.Creator, checkId: "x" });
  });
});

describe("Group by cause starts on", () => {
  test("once the project has a group of five issues or more", () => {
    expect(isGroupByCauseOnByDefault(0)).toBe(false);
    expect(isGroupByCauseOnByDefault(4)).toBe(false);
    expect(isGroupByCauseOnByDefault(5)).toBe(true);
    expect(isGroupByCauseOnByDefault(40)).toBe(true);
  });
});
