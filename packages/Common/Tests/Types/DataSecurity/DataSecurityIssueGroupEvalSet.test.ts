import {
  DataSecurityIssueGroupCause,
  DataSecurityIssueGroupDraft,
  DataSecurityIssueGroupIssue,
  DataSecurityIssueGroupStore,
  groupIssuesByCause,
} from "../../../Types/DataSecurity/DataSecurityIssueGroup";
import { describe, expect, test } from "@jest/globals";

/*
 * THE GROUPS A SET OF STORES SHOULD FORM (#10370): an eval set for the
 * grouping, which facts alone decide - no model is asked. Each case is a
 * project's stores and open issues, as the inventory and the change log
 * read them, and the groups a person would draw by hand: what made each
 * set of stores, and which stores share it. Every group is listed, so a
 * group that should not form - two stores that only look alike, one store
 * alone, the same tag on two clouds - fails its case.
 *
 * A case is added here whenever a project's grouping surprises someone:
 * the stores, the issues, and the groups it should have made.
 */

interface EvalStore {
  name: string;
  tags?: Record<string, string>;
  managedAsCode?: string | null;
  creator?: string | null;
  provider?: string;
  kind?: string;
  region?: string;
}

interface EvalGroup {
  cause: DataSecurityIssueGroupCause;
  // The stores whose issues it holds, by name.
  stores: Array<string>;
}

interface EvalCase {
  id: string;
  title: string;
  stores: Array<EvalStore>;
  // Each store's open issues, by check: one of the first check, unless listed.
  checks?: Record<string, Array<string>>;
  expect: Array<EvalGroup>;
}

const TERRAFORM: Record<string, string> = { "managed-by": "terraform" };

function buckets(
  names: Array<string>,
  store: Omit<EvalStore, "name"> = {},
): Array<EvalStore> {
  return names.map((name: string): EvalStore => {
    return { name, ...store };
  });
}

function numbered(prefix: string, count: number): Array<string> {
  return Array.from({ length: count }, (_value: unknown, index: number) => {
    return `${prefix}-${String(index + 1).padStart(2, "0")}`;
  });
}

const CASES: Array<EvalCase> = [
  {
    id: "one-module",
    title: "Forty buckets one Terraform module made, access logging off",
    stores: buckets(numbered("site-assets", 40), {
      tags: { module: "static-site", ...TERRAFORM },
      managedAsCode: "Terraform",
    }),
    expect: [
      {
        cause: DataSecurityIssueGroupCause.Tags,
        stores: numbered("site-assets", 40),
      },
    ],
  },
  {
    id: "two-modules",
    title: "Two modules' buckets fail the same check: two causes",
    stores: [
      ...buckets(["marketing-site", "docs-site", "blog-site"], {
        tags: { module: "static-site", ...TERRAFORM },
        managedAsCode: "Terraform",
      }),
      ...buckets(["avatars", "receipts", "attachments"], {
        tags: { module: "uploads", ...TERRAFORM },
        managedAsCode: "Terraform",
      }),
    ],
    expect: [
      {
        cause: DataSecurityIssueGroupCause.Tags,
        stores: ["blog-site", "docs-site", "marketing-site"],
      },
      {
        cause: DataSecurityIssueGroupCause.Tags,
        stores: ["attachments", "avatars", "receipts"],
      },
    ],
  },
  {
    id: "one-module-two-checks",
    title: "One module's mistakes on two checks: a group for each check",
    stores: buckets(["marketing-site", "docs-site", "blog-site"], {
      tags: { module: "static-site", ...TERRAFORM },
      managedAsCode: "Terraform",
    }),
    checks: {
      "marketing-site": ["access-not-logged", "public-read"],
      "docs-site": ["access-not-logged", "public-read"],
      "blog-site": ["access-not-logged", "public-read"],
    },
    expect: [
      {
        cause: DataSecurityIssueGroupCause.Tags,
        stores: ["blog-site", "docs-site", "marketing-site"],
      },
      {
        cause: DataSecurityIssueGroupCause.Tags,
        stores: ["blog-site", "docs-site", "marketing-site"],
      },
    ],
  },
  {
    id: "cloudformation-stack",
    title: "Five tables of one CloudFormation stack, recovery off",
    stores: buckets(["invoices", "payments", "refunds", "credits", "ledgers"], {
      kind: "AWS DynamoDB Table",
      tags: { "aws:cloudformation:stack-name": "billing-tables" },
      managedAsCode: 'CloudFormation stack "billing-tables"',
    }),
    expect: [
      {
        cause: DataSecurityIssueGroupCause.Stack,
        stores: ["credits", "invoices", "ledgers", "payments", "refunds"],
      },
    ],
  },
  {
    id: "one-role-in-the-console",
    title: "Buckets one role made in the console, with nothing else in common",
    stores: buckets(["q1-ledger", "partner-feed", "hr-archive", "audit-dump"], {
      creator: "role/export-job",
    }),
    expect: [
      {
        cause: DataSecurityIssueGroupCause.Creator,
        stores: ["audit-dump", "hr-archive", "partner-feed", "q1-ledger"],
      },
    ],
  },
  {
    id: "the-root-user",
    title: "Snapshots the account's root user made by hand",
    stores: buckets(["orders-2025-q4", "orders-2026-q1", "crm-final"], {
      kind: "AWS RDS Snapshot",
      creator: "root",
    }),
    expect: [
      {
        cause: DataSecurityIssueGroupCause.Creator,
        stores: ["crm-final", "orders-2025-q4", "orders-2026-q1"],
      },
    ],
  },
  {
    id: "named-alike",
    title: "Twelve buckets named alike, made by hand, nothing else known",
    stores: buckets(numbered("acme-exports", 12)),
    expect: [
      {
        cause: DataSecurityIssueGroupCause.NamePattern,
        stores: numbered("acme-exports", 12),
      },
    ],
  },
  {
    id: "a-component-tag",
    title: "Stores a component's tag names",
    stores: buckets(["thumbs", "originals", "previews"], {
      tags: { component: "media-pipeline" },
    }),
    expect: [
      {
        cause: DataSecurityIssueGroupCause.Tags,
        stores: ["originals", "previews", "thumbs"],
      },
    ],
  },
  {
    id: "the-stronger-fact-wins",
    title:
      "Buckets named alike, two of them made by a stack: the stack is the cause of those",
    stores: [
      ...buckets(["media-01", "media-02"], {
        tags: { stack: "web" },
      }),
      ...buckets(["media-03", "media-04", "media-05"]),
    ],
    expect: [
      {
        cause: DataSecurityIssueGroupCause.Tags,
        stores: ["media-01", "media-02"],
      },
      {
        cause: DataSecurityIssueGroupCause.NamePattern,
        stores: ["media-03", "media-04", "media-05"],
      },
    ],
  },
  {
    id: "nothing-shared",
    title: "Stores with nothing in common make no group",
    stores: buckets(["invoices", "team-photos", "legacy-backup", "tmp"]),
    expect: [],
  },
  {
    id: "generic-words",
    title: "Names alike only in words every account uses make no group",
    stores: buckets(["prod-bucket-1", "prod-bucket-2", "prod-bucket-3"]),
    expect: [],
  },
  {
    id: "one-store-alone",
    title: "One store a module made is no group: a group holds two issues",
    stores: [
      ...buckets(["marketing-site"], {
        tags: { module: "static-site", ...TERRAFORM },
        managedAsCode: "Terraform",
      }),
      ...buckets(["avatars"], {
        tags: { module: "uploads", ...TERRAFORM },
        managedAsCode: "Terraform",
      }),
    ],
    expect: [],
  },
  {
    id: "two-clouds",
    title: "One tag on two clouds: a group on each, never one across both",
    stores: [
      ...buckets(["aws-site-a", "aws-site-b"], {
        provider: "aws",
        tags: { module: "static-site" },
      }),
      ...buckets(["gcp-site-a", "gcp-site-b"], {
        provider: "gcp",
        kind: "Google Cloud Storage Bucket",
        tags: { module: "static-site" },
      }),
    ],
    expect: [
      {
        cause: DataSecurityIssueGroupCause.Tags,
        stores: ["aws-site-a", "aws-site-b"],
      },
      {
        cause: DataSecurityIssueGroupCause.Tags,
        stores: ["gcp-site-a", "gcp-site-b"],
      },
    ],
  },
];

// The case's stores and issues, as grouping reads them.
function read(testCase: EvalCase): {
  stores: Array<DataSecurityIssueGroupStore>;
  issues: Array<DataSecurityIssueGroupIssue>;
} {
  const stores: Array<DataSecurityIssueGroupStore> = testCase.stores.map(
    (store: EvalStore, index: number): DataSecurityIssueGroupStore => {
      return {
        id: `store-${index}`,
        name: store.name,
        kind: store.kind || "AWS S3 Bucket",
        provider: store.provider || "aws",
        region: store.region || "eu-west-1",
        accountNumber: "123456789012",
        tags: store.tags || {},
        managedAsCode: store.managedAsCode ?? null,
        creator: store.creator ?? null,
      };
    },
  );
  const issues: Array<DataSecurityIssueGroupIssue> = [];

  stores.forEach((store: DataSecurityIssueGroupStore): void => {
    for (const checkId of testCase.checks?.[store.name] || [
      "access-not-logged",
    ]) {
      issues.push({
        id: `issue-${issues.length}`,
        checkId,
        dataStoreId: store.id,
      });
    }
  });

  return { stores, issues };
}

// The groups, as names: what a person compares with what they drew.
function groupsOf(testCase: EvalCase): Array<EvalGroup> {
  const { stores, issues } = read(testCase);
  const nameOf: Map<string, string> = new Map(
    stores.map((store: DataSecurityIssueGroupStore): [string, string] => {
      return [store.id, store.name];
    }),
  );

  return groupIssuesByCause({ issues, stores })
    .map((draft: DataSecurityIssueGroupDraft): EvalGroup => {
      return {
        cause: draft.cause,
        stores: draft.dataStoreIds
          .map((id: string): string => {
            return nameOf.get(id) || id;
          })
          .sort(),
      };
    })
    .sort(byCauseThenStores);
}

function byCauseThenStores(left: EvalGroup, right: EvalGroup): number {
  return (
    left.cause.localeCompare(right.cause) ||
    left.stores.join(",").localeCompare(right.stores.join(","))
  );
}

describe("the groups a set of stores should form", () => {
  test.each(
    CASES.map((testCase: EvalCase): [string, EvalCase] => {
      return [`${testCase.id}: ${testCase.title}`, testCase];
    }),
  )("%s", (_name: string, testCase: EvalCase) => {
    expect(groupsOf(testCase)).toEqual(
      [...testCase.expect]
        .map((group: EvalGroup): EvalGroup => {
          return { ...group, stores: [...group.stores].sort() };
        })
        .sort(byCauseThenStores),
    );
  });

  test("every case is told apart: an id and a title of its own", () => {
    const ids: Array<string> = CASES.map((testCase: EvalCase): string => {
      return testCase.id;
    });

    expect(new Set(ids).size).toBe(ids.length);
    expect(CASES.length).toBeGreaterThanOrEqual(12);
  });

  test("an issue is in one group at most, whatever the case", () => {
    for (const testCase of CASES) {
      const { stores, issues } = read(testCase);
      const seen: Set<string> = new Set();

      for (const draft of groupIssuesByCause({ issues, stores })) {
        for (const issueId of draft.issueIds) {
          expect({
            case: testCase.id,
            issueId,
            twice: seen.has(issueId),
          }).toEqual({
            case: testCase.id,
            issueId,
            twice: false,
          });
          seen.add(issueId);
        }
      }
    }
  });
});
