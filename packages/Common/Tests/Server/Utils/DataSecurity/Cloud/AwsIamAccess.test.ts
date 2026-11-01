import { describe, expect, test } from "@jest/globals";
import {
  CredentialReportUse,
  IamAuthorization,
  IamIdentity,
  IamIdentityKind,
  IamReach,
  IamStoreAccess,
  IamStoreTarget,
  MAX_IAM_ENTRIES_PER_STORE,
  buildIamAccessEntries,
  decodePolicyDocument,
  evaluateIdentityReach,
  isServiceLinkedRole,
  managedPolicyName,
  prepareIamIdentity,
  readAuthorizationDetails,
  readCredentialReport,
  readExternalTrusters,
  statementsOf,
  wildcardCoversEveryExtension,
  wildcardMatchesSomeExtension,
} from "../../../../../Server/Utils/DataSecurity/Cloud/Aws/AwsIamAccess";
import {
  DataStoreAccessEntry,
  DataStoreAccessLevel,
  DataStorePrincipalType,
  UNUSED_ACCESS_DAYS,
  isAccessUnused,
} from "../../../../../Types/DataSecurity/DataStoreAccess";
import { DataStoreKind } from "../../../../../Types/DataSecurity/DataStoreKind";
import { JSONObject } from "../../../../../Types/JSON";
import { FastestRun, fastestRun } from "../../../../Helpers/FastestRun";
import {
  FAKE_ACCOUNT_ID,
  FakeIam,
  iamAuthorizationDetailsXml,
} from "../../CloudConnection/FakeAwsApi";

/*
 * Who reaches a bucket or a table through IAM, decided as IAM decides it:
 * an identity's own policies - inline, attached and its groups' - at their
 * default version, an Allow that covers the call and no Deny without
 * conditions that takes it away, a permissions boundary that must allow it
 * too, a Resource naming part of a bucket. A role's trust policy adds the
 * accounts outside the connected ones that may become it, and anyone at
 * all when it trusts "*" unheld. A user's last use is the credential
 * report's; a role's is IAM's own. AWS's service-linked roles are left
 * out, and every listing is bounded.
 */

const NOW: Date = new Date("2026-10-27T12:00:00Z");
const OUTSIDE: string = "210987654321";
const PARTNER: string = "444455556666";
const BUCKET: IamStoreTarget = {
  kind: DataStoreKind.AwsS3Bucket,
  arn: "arn:aws:s3:::orders",
};
const OTHER_BUCKET: IamStoreTarget = {
  kind: DataStoreKind.AwsS3Bucket,
  arn: "arn:aws:s3:::orders-archive",
};
const TABLE: IamStoreTarget = {
  kind: DataStoreKind.AwsDynamoDbTable,
  arn: `arn:aws:dynamodb:us-east-1:${FAKE_ACCOUNT_ID}:table/customers`,
};

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 3600 * 1000);
}

function statement(effect: "Allow" | "Deny", fields: JSONObject): JSONObject {
  return { Effect: effect, ...fields };
}

function role(
  name: string,
  policies: Array<Array<JSONObject>>,
  extra: Partial<IamIdentity> = {},
): IamIdentity {
  return {
    kind: IamIdentityKind.Role,
    arn: `arn:aws:iam::${FAKE_ACCOUNT_ID}:role/${name}`,
    name,
    path: "/",
    policies: policies.map((statements: Array<JSONObject>, index: number) => {
      return {
        policy: { name: `policy-${index + 1}`, statements },
        via: `policy-${index + 1}`,
      };
    }),
    trustStatements: [],
    hasNoRecordedUse: false,
    ...extra,
  };
}

function reach(
  identity: IamIdentity,
  target: IamStoreTarget = BUCKET,
): IamReach | null {
  return evaluateIdentityReach(identity, target);
}

function levelOf(
  identity: IamIdentity,
  target: IamStoreTarget = BUCKET,
): DataStoreAccessLevel | null {
  return reach(identity, target)?.level || null;
}

const ADMINISTRATOR: Array<JSONObject> = [
  statement("Allow", { Action: "*", Resource: "*" }),
];

const S3_READ_ONLY: Array<JSONObject> = [
  statement("Allow", {
    Action: ["s3:Get*", "s3:List*", "s3:Describe*"],
    Resource: "*",
  }),
];

const POWER_USER: Array<JSONObject> = [
  statement("Allow", {
    NotAction: ["iam:*", "organizations:*", "account:*"],
    Resource: "*",
  }),
];

describe("IAM's wildcards against a prefix", () => {
  test("a pattern reaches a prefix when some value that starts with it matches", () => {
    const objects: string = "arn:aws:s3:::orders/";

    expect(wildcardMatchesSomeExtension("*", objects)).toBe(true);
    expect(wildcardMatchesSomeExtension("arn:aws:s3:::*", objects)).toBe(true);
    expect(wildcardMatchesSomeExtension("arn:aws:s3:::orders/*", objects)).toBe(
      true,
    );
    // Part of the bucket reaches it.
    expect(
      wildcardMatchesSomeExtension("arn:aws:s3:::orders/2026/*", objects),
    ).toBe(true);
    expect(
      wildcardMatchesSomeExtension("arn:aws:s3:::orders/report.csv", objects),
    ).toBe(true);
    expect(wildcardMatchesSomeExtension("ARN:AWS:S3:::ORD?RS/*", objects)).toBe(
      true,
    );
    // Another bucket whose name starts the same does not.
    expect(
      wildcardMatchesSomeExtension("arn:aws:s3:::orders-archive/*", objects),
    ).toBe(false);
    expect(wildcardMatchesSomeExtension("arn:aws:s3:::ord", objects)).toBe(
      false,
    );
    expect(
      wildcardMatchesSomeExtension("arn:aws:dynamodb:*:*:table/*", objects),
    ).toBe(false);
    // A star anywhere before the difference absorbs it.
    expect(
      wildcardMatchesSomeExtension("arn:*:s3:::x*", "arn:aws:s3:::y/"),
    ).toBe(true);
  });

  test("a pattern covers every value of a prefix only when it matches it and ends open", () => {
    const objects: string = "arn:aws:s3:::orders/";

    expect(wildcardCoversEveryExtension("arn:aws:s3:::orders/*", objects)).toBe(
      true,
    );
    expect(wildcardCoversEveryExtension("arn:aws:s3:::*", objects)).toBe(true);
    expect(wildcardCoversEveryExtension("*", objects)).toBe(true);
    expect(
      wildcardCoversEveryExtension("arn:aws:s3:::orders/secret/*", objects),
    ).toBe(false);
    expect(
      wildcardCoversEveryExtension("arn:aws:s3:::orders/report.csv", objects),
    ).toBe(false);
  });

  /*
   * The worst case of a backtracking match: a star, then a long run that
   * fails just before its end, against a value that keeps almost matching
   * it - every position of the value starts the run again. A policy is at
   * most 10,240 characters and a store's ARN a few hundred: this is the
   * most work one pattern can ask for, twice over.
   */
  test("the longest pattern a policy holds, against a value longer than any ARN, takes a moment", () => {
    const pattern: string = `*${"a".repeat(10_000)}b`;
    const value: string = "a".repeat(12_000);
    const timed: FastestRun<boolean> = fastestRun({
      run: (): boolean => {
        return wildcardMatchesSomeExtension(pattern, value);
      },
      limitInMs: 2000,
    });

    expect(timed.result).toBe(true);
    expect(timed.inMs).toBeLessThan(2000);
  });
});

describe("policy documents", () => {
  test("IAM's URL-encoded JSON, plain JSON, and anything else as nothing", () => {
    const document: JSONObject = {
      Version: "2012-10-17",
      Statement: [{ Effect: "Allow", Action: "s3:GetObject", Resource: "*" }],
    };

    expect(
      decodePolicyDocument(encodeURIComponent(JSON.stringify(document))),
    ).toEqual(document);
    expect(decodePolicyDocument(JSON.stringify(document))).toEqual(document);
    expect(decodePolicyDocument("")).toBeNull();
    expect(decodePolicyDocument("%E0%A4%A")).toBeNull();
    expect(decodePolicyDocument(encodeURIComponent("[1,2]"))).toBeNull();
    expect(decodePolicyDocument("not json")).toBeNull();
  });

  test("one statement or a list of them, each an object", () => {
    expect(
      statementsOf({ Statement: { Effect: "Allow", Action: "*" } }),
    ).toEqual([{ Effect: "Allow", Action: "*" }]);
    expect(
      statementsOf({ Statement: [{ Effect: "Deny" }, "x", null] }),
    ).toEqual([{ Effect: "Deny" }]);
    expect(statementsOf(null)).toEqual([]);
    expect(managedPolicyName("arn:aws:iam::aws:policy/ReadOnlyAccess")).toBe(
      "ReadOnlyAccess",
    );
  });
});

describe("reading the account's identities", () => {
  const iam: FakeIam = {
    users: [
      {
        name: "alice",
        groups: ["analysts"],
        inline: { "own-notes": { Statement: [] } },
      },
      { name: "bob", attached: ["arn:aws:iam::aws:policy/Unlisted"] },
    ],
    groups: [
      {
        name: "analysts",
        attached: ["arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess"],
        inline: {
          "reports-writer": {
            Statement: [
              {
                Effect: "Allow",
                Action: "s3:PutObject",
                Resource: "arn:aws:s3:::reports/*",
              },
            ],
          },
        },
      },
    ],
    roles: [
      {
        name: "exporter",
        trust: {
          Statement: [
            {
              Effect: "Allow",
              Principal: { AWS: `arn:aws:iam::${OUTSIDE}:root` },
              Action: "sts:AssumeRole",
            },
          ],
        },
        attached: [`arn:aws:iam::${FAKE_ACCOUNT_ID}:policy/exporter-access`],
        boundary: `arn:aws:iam::${FAKE_ACCOUNT_ID}:policy/boundary`,
        createDate: "2025-01-01T00:00:00Z",
        lastUsed: "2026-10-20T08:00:00Z",
      },
      {
        name: "forgotten",
        trust: { Statement: [] },
        createDate: "2025-02-01T00:00:00Z",
      },
      {
        name: "fresh",
        trust: { Statement: [] },
        createDate: "2026-10-20T00:00:00Z",
      },
    ],
    policies: [
      {
        arn: "arn:aws:iam::aws:policy/AmazonS3ReadOnlyAccess",
        document: { Statement: S3_READ_ONLY },
      },
      {
        arn: `arn:aws:iam::${FAKE_ACCOUNT_ID}:policy/exporter-access`,
        document: {
          Statement: [
            { Effect: "Allow", Action: "s3:GetObject", Resource: "*" },
          ],
        },
        // The version before the default: never the one read.
        olderDocument: {
          Statement: [{ Effect: "Allow", Action: "*", Resource: "*" }],
        },
      },
      {
        arn: `arn:aws:iam::${FAKE_ACCOUNT_ID}:policy/boundary`,
        document: {
          Statement: [{ Effect: "Allow", Action: "s3:*", Resource: "*" }],
        },
      },
    ],
  };

  function readAll(pageSize: number): IamAuthorization {
    const pages: Array<string> = [];

    for (let marker: number = 0; marker < 200; marker += pageSize) {
      const page: string = iamAuthorizationDetailsXml({
        iam,
        account: FAKE_ACCOUNT_ID,
        marker,
        maxItems: pageSize,
      });

      pages.push(page);

      if (!page.includes("<IsTruncated>true</IsTruncated>")) {
        break;
      }
    }

    return readAuthorizationDetails(pages, { now: NOW, complete: true });
  }

  function named(
    authorization: IamAuthorization,
    name: string,
  ): IamIdentity | undefined {
    return authorization.identities.find((identity: IamIdentity) => {
      return identity.name === name;
    });
  }

  test("users and roles, never a role an instance profile repeats inside one", () => {
    const authorization: IamAuthorization = readAll(100);

    expect(
      authorization.identities.map((identity: IamIdentity): string => {
        return `${identity.kind} ${identity.name} ${identity.arn}`;
      }),
    ).toEqual([
      `user alice arn:aws:iam::${FAKE_ACCOUNT_ID}:user/alice`,
      `user bob arn:aws:iam::${FAKE_ACCOUNT_ID}:user/bob`,
      `role exporter arn:aws:iam::${FAKE_ACCOUNT_ID}:role/exporter`,
      `role forgotten arn:aws:iam::${FAKE_ACCOUNT_ID}:role/forgotten`,
      `role fresh arn:aws:iam::${FAKE_ACCOUNT_ID}:role/fresh`,
    ]);
    expect(authorization.complete).toBe(true);
  });

  test("a user's policies: its own, and each of its groups' by the group's name", () => {
    const alice: IamIdentity = named(readAll(100), "alice")!;

    expect(
      alice.policies.map((entry: { via: string }): string => {
        return entry.via;
      }),
    ).toEqual([
      "inline policy own-notes",
      "group analysts: inline policy reports-writer",
      "group analysts: AmazonS3ReadOnlyAccess",
    ]);
  });

  test("a managed policy is read at its default version, and one the listing left out is named", () => {
    const authorization: IamAuthorization = readAll(100);
    const exporter: IamIdentity = named(authorization, "exporter")!;

    expect(exporter.policies[0]!.policy.statements).toEqual([
      { Effect: "Allow", Action: "s3:GetObject", Resource: "*" },
    ]);
    expect(authorization.unreadPolicyArns).toEqual([
      "arn:aws:iam::aws:policy/Unlisted",
    ]);
    expect(named(authorization, "bob")!.policies).toEqual([]);
  });

  test("a role's trust policy, boundary and last use", () => {
    const exporter: IamIdentity = named(readAll(100), "exporter")!;

    expect(exporter.trustStatements).toEqual([
      {
        Effect: "Allow",
        Principal: { AWS: `arn:aws:iam::${OUTSIDE}:root` },
        Action: "sts:AssumeRole",
      },
    ]);
    expect(exporter.boundary).toEqual([
      { Effect: "Allow", Action: "s3:*", Resource: "*" },
    ]);
    expect(exporter.lastUsedAt?.toISOString()).toBe("2026-10-20T08:00:00.000Z");
    expect(exporter.hasNoRecordedUse).toBe(false);
  });

  test("a role with no recorded use is unused once it is older than the unused period, not before", () => {
    const authorization: IamAuthorization = readAll(100);

    expect(named(authorization, "forgotten")!.hasNoRecordedUse).toBe(true);
    expect(named(authorization, "fresh")!.hasNoRecordedUse).toBe(false);
  });

  test("the same identities, whatever the page size", () => {
    const whole: IamAuthorization = readAll(100);

    for (const size of [1, 2, 3, 7]) {
      expect(readAll(size)).toEqual(whole);
    }
  });

  test("a listing cut short says so", () => {
    expect(
      readAuthorizationDetails([], { now: NOW, complete: false }).complete,
    ).toBe(false);
  });
});

describe("what an identity's policies let it do to a store", () => {
  test("Action * on * controls every bucket and table", () => {
    const admin: IamIdentity = role("admin", [ADMINISTRATOR]);

    expect(reach(admin)).toEqual({
      level: DataStoreAccessLevel.Admin,
      via: "policy-1",
      isConditional: false,
    });
    expect(levelOf(admin, TABLE)).toBe(DataStoreAccessLevel.Admin);
  });

  test("read-only S3 reads buckets and reaches no table", () => {
    const reader: IamIdentity = role("reader", [S3_READ_ONLY]);

    expect(levelOf(reader)).toBe(DataStoreAccessLevel.Read);
    expect(levelOf(reader, TABLE)).toBeNull();
  });

  test("NotAction allows everything it does not name: a power user controls the bucket", () => {
    expect(levelOf(role("power", [POWER_USER]))).toBe(
      DataStoreAccessLevel.Admin,
    );
    expect(
      levelOf(
        role("not-s3", [
          [statement("Allow", { NotAction: "s3:*", Resource: "*" })],
        ]),
      ),
    ).toBeNull();
  });

  test("the highest level any of its calls is allowed at: writing objects is Write", () => {
    expect(
      levelOf(
        role("uploader", [
          [
            statement("Allow", {
              Action: ["s3:PutObject", "s3:GetObject"],
              Resource: "arn:aws:s3:::orders/*",
            }),
          ],
        ]),
      ),
    ).toBe(DataStoreAccessLevel.Write);
  });

  test("a Resource that names part of a bucket reaches it, and not a bucket whose name starts the same", () => {
    const partial: IamIdentity = role("partial", [
      [
        statement("Allow", {
          Action: "s3:GetObject",
          Resource: "arn:aws:s3:::orders/2026/*",
        }),
      ],
    ]);

    expect(levelOf(partial)).toBe(DataStoreAccessLevel.Read);
    expect(levelOf(partial, OTHER_BUCKET)).toBeNull();

    const prefixed: IamIdentity = role("prefixed", [
      [
        statement("Allow", {
          Action: "s3:GetObject",
          Resource: "arn:aws:s3:::orders*",
        }),
      ],
    ]);

    expect(levelOf(prefixed)).toBe(DataStoreAccessLevel.Read);
    expect(levelOf(prefixed, OTHER_BUCKET)).toBe(DataStoreAccessLevel.Read);
  });

  test("a bucket-level grant controls the bucket itself, an object grant does not", () => {
    expect(
      levelOf(
        role("policy-writer", [
          [
            statement("Allow", {
              Action: "s3:PutBucketPolicy",
              Resource: "arn:aws:s3:::orders",
            }),
          ],
        ]),
      ),
    ).toBe(DataStoreAccessLevel.Admin);
    expect(
      levelOf(
        role("wrong-shape", [
          [
            statement("Allow", {
              Action: "s3:PutBucketPolicy",
              Resource: "arn:aws:s3:::orders/*",
            }),
          ],
        ]),
      ),
    ).toBeNull();
  });

  test("a Deny without conditions over every object takes the read away; one over part of it does not", () => {
    const deniedAll: IamIdentity = role("denied", [
      S3_READ_ONLY,
      [
        statement("Deny", {
          Action: "s3:*",
          Resource: ["arn:aws:s3:::orders", "arn:aws:s3:::orders/*"],
        }),
      ],
    ]);
    const deniedPart: IamIdentity = role("denied-part", [
      S3_READ_ONLY,
      [
        statement("Deny", {
          Action: "s3:GetObject",
          Resource: "arn:aws:s3:::orders/secret/*",
        }),
      ],
    ]);

    expect(levelOf(deniedAll)).toBeNull();
    expect(levelOf(deniedAll, OTHER_BUCKET)).toBe(DataStoreAccessLevel.Read);
    expect(levelOf(deniedPart)).toBe(DataStoreAccessLevel.Read);
  });

  test("a Deny held by conditions is not one OneUptime can evaluate: the read stays", () => {
    expect(
      levelOf(
        role("vpc-only", [
          S3_READ_ONLY,
          [
            statement("Deny", {
              Action: "s3:*",
              Resource: "*",
              Condition: { StringNotEquals: { "aws:SourceVpce": "vpce-1" } },
            }),
          ],
        ]),
      ),
    ).toBe(DataStoreAccessLevel.Read);
  });

  test("a Deny with NotResource takes away all but what it names", () => {
    const allButReports: IamIdentity = role("all-but-reports", [
      ADMINISTRATOR,
      [
        statement("Deny", {
          Action: "s3:*",
          NotResource: ["arn:aws:s3:::reports", "arn:aws:s3:::reports/*"],
        }),
      ],
    ]);

    expect(levelOf(allButReports)).toBeNull();
    expect(
      levelOf(allButReports, {
        kind: DataStoreKind.AwsS3Bucket,
        arn: "arn:aws:s3:::reports",
      }),
    ).toBe(DataStoreAccessLevel.Admin);
  });

  test("an Allow with NotResource allows all but what it names", () => {
    const allButOrders: IamIdentity = role("all-but-orders", [
      [
        statement("Allow", {
          Action: "s3:GetObject",
          NotResource: "arn:aws:s3:::orders/*",
        }),
      ],
    ]);

    expect(levelOf(allButOrders)).toBeNull();
    expect(levelOf(allButOrders, OTHER_BUCKET)).toBe(DataStoreAccessLevel.Read);
  });

  test("an Allow held by conditions still reaches the store, and says so; an unconditional one elsewhere wins", () => {
    const conditional: Array<JSONObject> = [
      statement("Allow", {
        Action: "s3:GetObject",
        Resource: "*",
        Condition: { Bool: { "aws:MultiFactorAuthPresent": "true" } },
      }),
    ];

    expect(reach(role("mfa", [conditional]))).toEqual({
      level: DataStoreAccessLevel.Read,
      via: "policy-1",
      isConditional: true,
    });
    expect(reach(role("both", [conditional, S3_READ_ONLY]))).toEqual({
      level: DataStoreAccessLevel.Read,
      via: "policy-2",
      isConditional: false,
    });
  });

  test("a permissions boundary allows only what it allows itself", () => {
    const bounded: IamIdentity = role("bounded", [ADMINISTRATOR], {
      boundary: [
        statement("Allow", {
          Action: "s3:GetObject",
          Resource: "*",
        }),
      ],
    });

    expect(levelOf(bounded)).toBe(DataStoreAccessLevel.Read);
    expect(levelOf(bounded, TABLE)).toBeNull();

    const unreadBoundary: IamIdentity = role("unread", [ADMINISTRATOR], {
      boundary: null,
    });

    expect(reach(unreadBoundary)).toEqual({
      level: DataStoreAccessLevel.Admin,
      via: "policy-1",
      isConditional: true,
    });
  });

  test("DynamoDB's calls on the table's ARN, its wildcards and its case", () => {
    expect(
      levelOf(
        role("table-reader", [
          [
            statement("Allow", {
              Action: ["DYNAMODB:query", "dynamodb:GetItem"],
              Resource: "arn:aws:dynamodb:*:*:table/customers",
            }),
          ],
        ]),
        TABLE,
      ),
    ).toBe(DataStoreAccessLevel.Read);
    expect(
      levelOf(
        role("other-table", [
          [
            statement("Allow", {
              Action: "dynamodb:*",
              Resource: "arn:aws:dynamodb:*:*:table/orders",
            }),
          ],
        ]),
        TABLE,
      ),
    ).toBeNull();
  });

  test("an identity whose policies never name the store's service is not evaluated against it", () => {
    const prepared: ReturnType<typeof prepareIamIdentity> = prepareIamIdentity(
      role("ec2-only", [
        [statement("Allow", { Action: "ec2:*", Resource: "*" })],
      ]),
    );

    expect(prepared.reachableKinds.size).toBe(0);
    expect(evaluateIdentityReach(prepared, BUCKET)).toBeNull();
    expect(
      evaluateIdentityReach(role("x", [ADMINISTRATOR]), {
        kind: DataStoreKind.AwsRdsInstance,
        arn: "arn:aws:rds:us-east-1:1:db:x",
      }),
    ).toBeNull();
  });
});

describe("who may assume a role", () => {
  function trusted(statements: Array<JSONObject>): IamIdentity {
    return role("shared", [ADMINISTRATOR], { trustStatements: statements });
  }

  function trusters(statements: Array<JSONObject>): Array<string> {
    return readExternalTrusters(trusted(statements), (account: string) => {
      return account === FAKE_ACCOUNT_ID || account === PARTNER;
    }).map((truster: { principal: string; isPublic: boolean }): string => {
      return `${truster.principal}${truster.isPublic ? " (public)" : ""}`;
    });
  }

  test("an account outside the connected ones, by its root, its id or one of its roles", () => {
    expect(
      trusters([
        statement("Allow", {
          Principal: {
            AWS: [
              `arn:aws:iam::${OUTSIDE}:root`,
              "999988887777",
              `arn:aws:iam::111122223333:role/partner-reader`,
            ],
          },
          Action: "sts:AssumeRole",
        }),
      ]),
    ).toEqual([
      `arn:aws:iam::${OUTSIDE}:root`,
      "999988887777",
      "arn:aws:iam::111122223333:role/partner-reader",
    ]);
  });

  test("the connected accounts, AWS services and identity providers are not outside", () => {
    expect(
      trusters([
        statement("Allow", {
          Principal: {
            AWS: [`arn:aws:iam::${PARTNER}:root`, FAKE_ACCOUNT_ID],
            Service: "ec2.amazonaws.com",
            Federated: "arn:aws:iam::123456789012:oidc-provider/github",
          },
          Action: ["sts:AssumeRole", "sts:AssumeRoleWithWebIdentity"],
        }),
      ]),
    ).toEqual([]);
  });

  test("anyone at all when it trusts * unheld; nobody new when a condition holds it to known callers", () => {
    expect(
      trusters([
        statement("Allow", { Principal: "*", Action: "sts:AssumeRole" }),
      ]),
    ).toEqual(["* (public)"]);
    expect(
      trusters([
        statement("Allow", {
          Principal: { AWS: "*" },
          Action: "sts:AssumeRole",
          Condition: { StringEquals: { "aws:PrincipalOrgID": "o-abc123" } },
        }),
      ]),
    ).toEqual([]);
  });

  test("a Deny, and an Allow of anything but becoming the role, let nobody in", () => {
    expect(
      trusters([
        statement("Deny", {
          Principal: { AWS: `arn:aws:iam::${OUTSIDE}:root` },
          Action: "sts:AssumeRole",
        }),
        statement("Allow", {
          Principal: { AWS: `arn:aws:iam::${OUTSIDE}:root` },
          Action: "sts:TagSession",
        }),
      ]),
    ).toEqual([]);
  });
});

describe("the access entries IAM adds to each store", () => {
  function authorization(identities: Array<IamIdentity>): IamAuthorization {
    return { identities, unreadPolicyArns: [], complete: true };
  }

  function entriesOf(
    access: Map<string, IamStoreAccess>,
    target: IamStoreTarget = BUCKET,
  ): Array<DataStoreAccessEntry> {
    return access.get(target.arn)?.entries || [];
  }

  function build(
    identities: Array<IamIdentity>,
    targets: Array<IamStoreTarget> = [BUCKET],
    userUses?: Map<string, CredentialReportUse>,
  ): Map<string, IamStoreAccess> {
    return buildIamAccessEntries({
      authorization: authorization(identities),
      targets,
      isInternalAccount: (account: string): boolean => {
        return account === FAKE_ACCOUNT_ID || account === PARTNER;
      },
      userUses,
      now: NOW,
    });
  }

  test("one entry per identity at its highest level, naming the policy, its last use and whether it went unused", () => {
    const access: Map<string, IamStoreAccess> = build([
      role("reader", [S3_READ_ONLY], { lastUsedAt: daysAgo(3) }),
      role("dormant", [ADMINISTRATOR], {
        lastUsedAt: daysAgo(UNUSED_ACCESS_DAYS + 1),
      }),
      role("never", [S3_READ_ONLY], { hasNoRecordedUse: true }),
    ]);

    expect(entriesOf(access)).toEqual([
      {
        principal: `arn:aws:iam::${FAKE_ACCOUNT_ID}:role/dormant`,
        principalName: "dormant",
        principalType: DataStorePrincipalType.Role,
        accessLevel: DataStoreAccessLevel.Admin,
        grantedVia: "IAM policy policy-1",
        isExternal: false,
        isPublic: false,
        lastUsedAt: daysAgo(UNUSED_ACCESS_DAYS + 1),
        isUnused: true,
      },
      {
        principal: `arn:aws:iam::${FAKE_ACCOUNT_ID}:role/never`,
        principalName: "never",
        principalType: DataStorePrincipalType.Role,
        accessLevel: DataStoreAccessLevel.Read,
        grantedVia: "IAM policy policy-1",
        isExternal: false,
        isPublic: false,
        lastUsedAt: undefined,
        isUnused: true,
      },
      {
        principal: `arn:aws:iam::${FAKE_ACCOUNT_ID}:role/reader`,
        principalName: "reader",
        principalType: DataStorePrincipalType.Role,
        accessLevel: DataStoreAccessLevel.Read,
        grantedVia: "IAM policy policy-1",
        isExternal: false,
        isPublic: false,
        lastUsedAt: daysAgo(3),
        isUnused: false,
      },
    ]);
  });

  test("a grant held by conditions says so where it is listed", () => {
    const access: Map<string, IamStoreAccess> = build([
      role("tagged", [
        [
          statement("Allow", {
            Action: "s3:GetObject",
            Resource: "*",
            Condition: { StringEquals: { "aws:ResourceTag/team": "data" } },
          }),
        ],
      ]),
    ]);

    expect(entriesOf(access)[0]!.grantedVia).toBe(
      "IAM policy policy-1, with conditions",
    );
  });

  test("a user's last use is the credential report's; unknown is never unused", () => {
    const alice: IamIdentity = {
      ...role("alice", [S3_READ_ONLY]),
      kind: IamIdentityKind.User,
      arn: `arn:aws:iam::${FAKE_ACCOUNT_ID}:user/alice`,
      // A user's own record says nothing of its use: the report does.
      lastUsedAt: daysAgo(1),
    };
    const carol: IamIdentity = {
      ...role("carol", [S3_READ_ONLY]),
      kind: IamIdentityKind.User,
      arn: `arn:aws:iam::${FAKE_ACCOUNT_ID}:user/carol`,
    };
    const uses: Map<string, CredentialReportUse> = new Map([
      [
        alice.arn,
        {
          lastUsedAt: daysAgo(UNUSED_ACCESS_DAYS + 30),
          hasNoRecordedUse: false,
        },
      ],
    ]);
    const entries: Array<DataStoreAccessEntry> = entriesOf(
      build([alice, carol], [BUCKET], uses),
    );

    expect(
      entries.map((entry: DataStoreAccessEntry): Array<unknown> => {
        return [
          entry.principalName,
          entry.principalType,
          entry.lastUsedAt?.toISOString() || null,
          entry.isUnused,
        ];
      }),
    ).toEqual([
      [
        "alice",
        DataStorePrincipalType.User,
        daysAgo(UNUSED_ACCESS_DAYS + 30).toISOString(),
        true,
      ],
      ["carol", DataStorePrincipalType.User, null, false],
    ]);
  });

  test("an account outside the connected ones that may assume a role reaches what the role reaches", () => {
    const exporter: IamIdentity = role("exporter", [S3_READ_ONLY], {
      trustStatements: [
        statement("Allow", {
          Principal: { AWS: `arn:aws:iam::${OUTSIDE}:root` },
          Action: "sts:AssumeRole",
        }),
      ],
    });
    const entries: Array<DataStoreAccessEntry> = entriesOf(build([exporter]));

    expect(entries[0]).toEqual({
      principal: `arn:aws:iam::${OUTSIDE}:root`,
      principalName: OUTSIDE,
      principalType: DataStorePrincipalType.Account,
      accessLevel: DataStoreAccessLevel.Read,
      grantedVia: "Can assume role exporter, whose IAM policy policy-1",
      isExternal: true,
      isPublic: false,
    });
    expect(entries[1]!.principalName).toBe("exporter");
  });

  test("a role any AWS account may assume makes what it reaches public", () => {
    const open: IamIdentity = role("open", [S3_READ_ONLY], {
      trustStatements: [
        statement("Allow", { Principal: { AWS: "*" }, Action: "sts:*" }),
      ],
    });

    expect(entriesOf(build([open]))[0]).toEqual(
      expect.objectContaining({
        principal: "*",
        principalName: "Any AWS account",
        principalType: DataStorePrincipalType.Public,
        isExternal: true,
        isPublic: true,
      }),
    );
  });

  test("AWS's service-linked roles and identities without policies are left out", () => {
    const linked: IamIdentity = role(
      "AWSServiceRoleForSupport",
      [ADMINISTRATOR],
      {
        path: "/aws-service-role/support.amazonaws.com/",
      },
    );

    expect(isServiceLinkedRole(linked)).toBe(true);
    expect(entriesOf(build([linked, role("empty", [])]))).toEqual([]);
  });

  test("the most public, then the most powerful first, and no more than the cap a store", () => {
    const many: Array<IamIdentity> = [];

    for (
      let index: number = 0;
      index < MAX_IAM_ENTRIES_PER_STORE + 5;
      index++
    ) {
      many.push(
        role(`reader-${String(index).padStart(3, "0")}`, [S3_READ_ONLY]),
      );
    }

    many.push(role("zz-admin", [ADMINISTRATOR]));

    const access: IamStoreAccess = build(many).get(BUCKET.arn)!;

    expect(access.entries).toHaveLength(MAX_IAM_ENTRIES_PER_STORE);
    expect(access.leftOut).toBe(6);
    expect(access.entries[0]!.principalName).toBe("zz-admin");
    expect(access.entries[1]!.principalName).toBe("reader-000");
  });

  test("each store gets its own entries; a store nothing reaches gets none", () => {
    const access: Map<string, IamStoreAccess> = build(
      [
        role("partial", [
          [
            statement("Allow", {
              Action: "s3:GetObject",
              Resource: "arn:aws:s3:::orders/*",
            }),
          ],
        ]),
      ],
      [BUCKET, OTHER_BUCKET, TABLE],
    );

    expect(entriesOf(access, BUCKET)).toHaveLength(1);
    expect(entriesOf(access, OTHER_BUCKET)).toEqual([]);
    expect(entriesOf(access, TABLE)).toEqual([]);
  });
});

describe("the credential report", () => {
  const HEADER: string =
    "user,arn,user_creation_time,password_enabled,password_last_used,password_last_changed,password_next_rotation,mfa_active,access_key_1_active,access_key_1_last_rotated,access_key_1_last_used_date,access_key_1_last_used_region,access_key_1_last_used_service,access_key_2_active,access_key_2_last_rotated,access_key_2_last_used_date,access_key_2_last_used_region,access_key_2_last_used_service,cert_1_active,cert_1_last_rotated,cert_2_active,cert_2_last_rotated";

  function row(cells: Record<string, string>): string {
    return HEADER.split(",")
      .map((column: string): string => {
        return cells[column] || "N/A";
      })
      .join(",");
  }

  test("each user's newest use of its password or keys; the root user is no IAM user", () => {
    const uses: Map<string, CredentialReportUse> = readCredentialReport(
      [
        HEADER,
        row({
          user: "<root_account>",
          arn: `arn:aws:iam::${FAKE_ACCOUNT_ID}:root`,
          password_last_used: "2026-10-26T10:00:00+00:00",
        }),
        row({
          user: "alice",
          arn: `arn:aws:iam::${FAKE_ACCOUNT_ID}:user/alice`,
          user_creation_time: "2024-01-01T00:00:00+00:00",
          password_last_used: "2026-01-02T00:00:00+00:00",
          access_key_1_last_used_date: "2026-10-01T00:00:00+00:00",
          access_key_2_last_used_date: "2025-05-01T00:00:00+00:00",
        }),
        row({
          user: "ci",
          arn: `arn:aws:iam::${FAKE_ACCOUNT_ID}:user/ci`,
          user_creation_time: "2025-01-01T00:00:00+00:00",
          password_last_used: "no_information",
        }),
        row({
          user: "new-hire",
          arn: `arn:aws:iam::${FAKE_ACCOUNT_ID}:user/new-hire`,
          user_creation_time: "2026-10-25T00:00:00+00:00",
        }),
        "",
      ].join("\n"),
      NOW,
    );

    expect(uses.has(`arn:aws:iam::${FAKE_ACCOUNT_ID}:root`)).toBe(false);
    expect(uses.get(`arn:aws:iam::${FAKE_ACCOUNT_ID}:user/alice`)).toEqual({
      lastUsedAt: new Date("2026-10-01T00:00:00Z"),
      hasNoRecordedUse: false,
    });
    expect(uses.get(`arn:aws:iam::${FAKE_ACCOUNT_ID}:user/ci`)).toEqual({
      lastUsedAt: undefined,
      hasNoRecordedUse: true,
    });
    expect(uses.get(`arn:aws:iam::${FAKE_ACCOUNT_ID}:user/new-hire`)).toEqual({
      lastUsedAt: undefined,
      hasNoRecordedUse: false,
    });
  });

  test("columns are found by their names, in any order; a report without an arn column says nothing", () => {
    const uses: Map<string, CredentialReportUse> = readCredentialReport(
      [
        "access_key_1_last_used_date,arn,user",
        `2026-10-20T00:00:00+00:00,arn:aws:iam::${FAKE_ACCOUNT_ID}:user/dee,dee`,
      ].join("\n"),
      NOW,
    );

    expect(
      uses.get(`arn:aws:iam::${FAKE_ACCOUNT_ID}:user/dee`)?.lastUsedAt,
    ).toEqual(new Date("2026-10-20T00:00:00Z"));
    expect(
      readCredentialReport("user,password_last_used\nx,N/A", NOW).size,
    ).toBe(0);
    expect(readCredentialReport("", NOW).size).toBe(0);
  });
});

describe("unused access", () => {
  test("used within the period is not unused; before it, or never since made, is", () => {
    expect(isAccessUnused({ lastUsedAt: daysAgo(1), now: NOW })).toBe(false);
    expect(
      isAccessUnused({ lastUsedAt: daysAgo(UNUSED_ACCESS_DAYS - 1), now: NOW }),
    ).toBe(false);
    expect(
      isAccessUnused({ lastUsedAt: daysAgo(UNUSED_ACCESS_DAYS + 1), now: NOW }),
    ).toBe(true);
    expect(isAccessUnused({ hasNoRecordedUse: true, now: NOW })).toBe(true);
    // Unknown is not unused: OneUptime does not guess.
    expect(isAccessUnused({ now: NOW })).toBe(false);
    expect(
      isAccessUnused({
        lastUsedAt: daysAgo(2),
        hasNoRecordedUse: true,
        now: NOW,
      }),
    ).toBe(false);
  });
});
