import {
  DataSecurityIssueGroupCause,
  DataSecurityIssueGroupDraft,
  DataSecurityIssueGroupFacts,
  DataSecurityIssueGroupIssue,
  DataSecurityIssueGroupStore,
  DataSecurityIssueGroupTagRole,
  describeIssueGroupCause,
  getIssueGroupFactsOfStores,
  getIssueGroupNameFacts,
  groupIssuesByCause,
  readIssueGroupKeyPattern,
  withDeclaredCode,
} from "../../../Types/DataSecurity/DataSecurityIssueGroup";
import { describe, expect, test } from "@jest/globals";

/*
 * A GROUP AS SOME OF ITS STORES ALONE MAKE IT (#10739), AS DATA.
 *
 * A reader whose read of Data Security issues is held to labels reads a
 * group cut down to the stores they may read. Its facts are worked out
 * again from those stores alone (getIssueGroupFactsOfStores): the fact the
 * group is of stays - it is every store's - but what the stores all are,
 * the tags they all carry and the narrowest name pattern are theirs, and
 * the code the grouping found is left out. Nothing of a store left out may
 * reach them: not its name, its tags, its region, its account or the
 * repository a tag of its named.
 */

let next: number = 0;

function makeStore(
  store: Partial<DataSecurityIssueGroupStore> & { name: string },
): DataSecurityIssueGroupStore {
  next++;

  return {
    id: `store-${next}`,
    kind: "AWS S3 Bucket",
    provider: "aws",
    region: "us-east-1",
    accountNumber: "111122223333",
    tags: {},
    managedAsCode: null,
    ...store,
  };
}

// The one group these stores make, whole, as the grouping keeps it.
function groupOf(
  stores: Array<DataSecurityIssueGroupStore>,
  checkId: string = "access-not-logged",
): DataSecurityIssueGroupDraft {
  const drafts: Array<DataSecurityIssueGroupDraft> = groupIssuesByCause({
    issues: stores.map(
      (store: DataSecurityIssueGroupStore): DataSecurityIssueGroupIssue => {
        return {
          id: `issue-${store.id}`,
          checkId,
          dataStoreId: store.id,
        };
      },
    ),
    stores,
  });

  expect(drafts).toHaveLength(1);

  return drafts[0]!;
}

// Everything the facts say, as one text.
function textOf(facts: DataSecurityIssueGroupFacts): string {
  return JSON.stringify(facts).toLowerCase();
}

describe("the pattern a group's key was made with", () => {
  test.each([
    ["access-not-logged|aws|name:*-exports-*", "*-exports-*", "exports"],
    ["access-not-logged|aws|name:acme-*", "acme-*", "acme"],
    ["public-read|gcp|name:*_reports", "*_reports", "reports"],
  ])("%s reads as %s, of the word %s", (key: string, pattern: string, word: string) => {
    expect(readIssueGroupKeyPattern(key)).toEqual({ pattern, word });
  });

  test("a key of any other fact has none", () => {
    expect(
      readIssueGroupKeyPattern("access-not-logged|aws|tag:module=static-site"),
    ).toBeNull();
    expect(readIssueGroupKeyPattern("access-not-logged|aws|stack:web")).toBeNull();
    expect(readIssueGroupKeyPattern("")).toBeNull();
    expect(readIssueGroupKeyPattern(null)).toBeNull();
    expect(readIssueGroupKeyPattern("x|aws|name:*")).toBeNull();
  });
});

describe("a group of a module's tag, cut down", () => {
  const theirs: Array<DataSecurityIssueGroupStore> = [
    makeStore({
      name: "payments-site-a",
      region: "us-east-1",
      accountNumber: "111122223333",
      tags: { module: "static-site", component: "checkout", team: "payments" },
      managedAsCode: "Terraform",
    }),
    makeStore({
      name: "payments-site-b",
      region: "us-east-1",
      accountNumber: "111122223333",
      tags: { module: "static-site", component: "checkout", team: "payments" },
      managedAsCode: "Terraform",
    }),
  ];
  const others: Array<DataSecurityIssueGroupStore> = [
    makeStore({
      name: "marketing-launch-microsite",
      kind: "AWS S3 Bucket",
      region: "eu-west-3",
      accountNumber: "999988887777",
      tags: {
        module: "static-site",
        component: "campaigns",
        repository: "acme/marketing-sites",
      },
      managedAsCode: "Terraform",
    }),
  ];
  const whole: DataSecurityIssueGroupDraft = groupOf([...theirs, ...others]);
  const found: DataSecurityIssueGroupFacts = withDeclaredCode(whole.facts, {
    repositoryId: "repo-1",
    repositoryName: "acme/marketing-sites",
    paths: ["modules/static-site/main.tf"],
    codeKind: "Terraform",
    reason: "TagNamesRepository",
  });

  test("the whole group was found in a repository a store left out named, and spans two regions", () => {
    expect(found.cause).toBe(DataSecurityIssueGroupCause.DeclaredCode);
    expect(found.code?.repositoryName).toBe("acme/marketing-sites");
    expect(found.region).toBeUndefined();
    expect(found.accountNumber).toBeUndefined();
  });

  test("their part goes by the module, with no code the grouping found", () => {
    const cut: DataSecurityIssueGroupFacts = getIssueGroupFactsOfStores({
      facts: found,
      groupKey: whole.key,
      stores: theirs,
    });

    expect(cut.cause).toBe(DataSecurityIssueGroupCause.Tags);
    expect(cut.tag).toEqual(["module", "static-site"]);
    expect(cut.tagRole).toBe(DataSecurityIssueGroupTagRole.Module);
    expect(cut.code).toBeUndefined();
    expect(describeIssueGroupCause(cut)).toBe("the static-site module");
  });

  test("what their stores all are is worked out from their stores alone", () => {
    const cut: DataSecurityIssueGroupFacts = getIssueGroupFactsOfStores({
      facts: found,
      groupKey: whole.key,
      stores: theirs,
    });

    expect(cut.region).toBe("us-east-1");
    expect(cut.accountNumber).toBe("111122223333");
    expect(cut.storeKind).toBe("AWS S3 Bucket");
    expect(cut.managedAsCode).toBe("Terraform");
    // A tag only their stores share is theirs: the whole group did not share it.
    expect(cut.tags).toEqual([
      ["component", "checkout"],
      ["module", "static-site"],
    ]);
    expect(whole.facts.tags).toEqual([["module", "static-site"]]);
  });

  test("nothing of the store left out reaches them", () => {
    const cut: DataSecurityIssueGroupFacts = getIssueGroupFactsOfStores({
      facts: found,
      groupKey: whole.key,
      stores: theirs,
    });
    const said: string = textOf(cut);

    for (const leftOut of [
      "marketing-launch-microsite",
      "eu-west-3",
      "999988887777",
      "campaigns",
      "acme/marketing-sites",
      "modules/static-site/main.tf",
      "repo-1",
    ]) {
      expect(said).not.toContain(leftOut);
    }

    const nameFacts: string = getIssueGroupNameFacts({
      facts: cut,
      checkTitle: "Access is not logged",
      checkDescription: "Nobody can tell who read it.",
      issueCount: theirs.length,
    })
      .map((fact: { text: string }): string => {
        return fact.text;
      })
      .join("\n")
      .toLowerCase();

    expect(nameFacts).toContain("2 stores");
    expect(nameFacts).not.toContain("marketing");
    expect(nameFacts).not.toContain("eu-west-3");
  });

  test("their part of every store is the group as it is", () => {
    const cut: DataSecurityIssueGroupFacts = getIssueGroupFactsOfStores({
      facts: whole.facts,
      groupKey: whole.key,
      stores: [...theirs, ...others],
    });

    expect(cut).toEqual(whole.facts);
  });
});

describe("a group of a CloudFormation stack, cut down", () => {
  test("goes by its stack, the code found for it left out", () => {
    const stores: Array<DataSecurityIssueGroupStore> = [1, 2, 3].map(
      (index: number): DataSecurityIssueGroupStore => {
        return makeStore({
          name: `web-assets-${index}`,
          region: index === 3 ? "ap-south-1" : "us-east-1",
          tags: { "aws:cloudformation:stack-name": "web" },
          managedAsCode: 'CloudFormation stack "web"',
        });
      },
    );
    const whole: DataSecurityIssueGroupDraft = groupOf(stores);
    const found: DataSecurityIssueGroupFacts = withDeclaredCode(whole.facts, {
      repositoryId: "repo-2",
      repositoryName: "acme/stacks",
      paths: ["stacks/web.yaml"],
      codeKind: "CloudFormation",
      reason: "HasNamedFile",
    });
    const cut: DataSecurityIssueGroupFacts = getIssueGroupFactsOfStores({
      facts: found,
      groupKey: whole.key,
      stores: stores.slice(0, 2),
    });

    expect(found.cause).toBe(DataSecurityIssueGroupCause.DeclaredCode);
    expect(cut.cause).toBe(DataSecurityIssueGroupCause.Stack);
    expect(cut.stackName).toBe("web");
    expect(cut.code).toBeUndefined();
    expect(cut.region).toBe("us-east-1");
    expect(textOf(cut)).not.toContain("ap-south-1");
    expect(textOf(cut)).not.toContain("acme/stacks");
  });
});

describe("a group of the identity that created its stores, cut down", () => {
  test("keeps the identity, every store's, and their stores' own kind", () => {
    const stores: Array<DataSecurityIssueGroupStore> = [
      makeStore({ name: "alpha", creator: "role/terraform-ci" }),
      makeStore({ name: "bravo", creator: "role/terraform-ci" }),
      makeStore({
        name: "charlie",
        creator: "role/terraform-ci",
        kind: "AWS DynamoDB Table",
      }),
    ];
    const whole: DataSecurityIssueGroupDraft = groupOf(stores);
    const cut: DataSecurityIssueGroupFacts = getIssueGroupFactsOfStores({
      facts: whole.facts,
      groupKey: whole.key,
      stores: stores.slice(0, 2),
    });

    expect(whole.facts.storeKind).toBeUndefined();
    expect(cut.cause).toBe(DataSecurityIssueGroupCause.Creator);
    expect(cut.creator).toBe("role/terraform-ci");
    expect(cut.storeKind).toBe("AWS S3 Bucket");
    expect(textOf(cut)).not.toContain("dynamodb");
    expect(describeIssueGroupCause(cut)).toBe(
      "stores the terraform-ci role created",
    );
  });
});

describe("a group of a name pattern, cut down", () => {
  const theirs: Array<DataSecurityIssueGroupStore> = [
    makeStore({ name: "acme-exports-01" }),
    makeStore({ name: "acme-exports-02" }),
  ];
  const others: Array<DataSecurityIssueGroupStore> = [
    makeStore({ name: "billing-exports-eu" }),
  ];
  const whole: DataSecurityIssueGroupDraft = groupOf([...theirs, ...others]);

  test("the whole group's pattern is the one all its names share", () => {
    expect(whole.facts.pattern).toBe("*-exports-*");
  });

  test("their part is narrowed from their names alone, from the pattern the group was made with", () => {
    const cut: DataSecurityIssueGroupFacts = getIssueGroupFactsOfStores({
      facts: whole.facts,
      groupKey: whole.key,
      stores: theirs,
    });

    expect(cut.cause).toBe(DataSecurityIssueGroupCause.NamePattern);
    expect(cut.pattern).toBe("acme-exports-*");
    expect(textOf(cut)).not.toContain("billing");
  });

  test("with no key, from the pattern the facts keep", () => {
    const cut: DataSecurityIssueGroupFacts = getIssueGroupFactsOfStores({
      facts: whole.facts,
      stores: theirs,
    });

    expect(cut.pattern).toBe("acme-exports-*");
  });

  test("a part of one store keeps the pattern the group was made with: nothing narrower comes of one name", () => {
    const cut: DataSecurityIssueGroupFacts = getIssueGroupFactsOfStores({
      facts: whole.facts,
      groupKey: whole.key,
      stores: [theirs[0]!],
    });

    expect(cut.pattern).toBe("*-exports-*");
  });
});

describe("facts that say nothing to work from", () => {
  test("keep their fact alone, with nothing of any store", () => {
    const cut: DataSecurityIssueGroupFacts = getIssueGroupFactsOfStores({
      facts: {
        cause: DataSecurityIssueGroupCause.DeclaredCode,
        checkId: "public-read",
        code: {
          repositoryId: "repo-3",
          repositoryName: "acme/infra",
          paths: ["main.tf"],
          codeKind: "Terraform",
          reason: "HasNamedFile",
        },
        region: "us-east-1",
      },
      stores: [makeStore({ name: "a" }), makeStore({ name: "b" })],
    });

    expect(cut).toEqual({
      cause: DataSecurityIssueGroupCause.DeclaredCode,
      checkId: "public-read",
    });
  });
});
