import {
  findInfrastructureLeaks,
  getInfrastructureKind,
  INFRASTRUCTURE_RULES,
  InfrastructureCodeKind,
  readSetting,
} from "../../../../../../Server/Utils/CodeRepository/ProductionReview/SensitiveData/InfrastructureRules";
import { SensitiveDataCandidate } from "../../../../../../Server/Utils/CodeRepository/ProductionReview/SensitiveData/SensitiveDataCandidate";
import { readPatchLines } from "../../../../../../Server/Utils/CodeRepository/ProductionReview/SensitiveData/SensitiveDataPatch";
import {
  INFRASTRUCTURE_LEAK_CHECK_IDS,
  PUBLIC_STORE_CHECK_IDS,
  SensitiveDataLeakKind,
} from "../../../../../../Types/CodeRepository/ProductionReviewSensitiveData";
import { getDataSecurityCheck } from "../../../../../../Types/DataSecurity/DataSecurityCheckCatalog";
import DataSensitivity from "../../../../../../Types/DataSecurity/DataSensitivity";
import { fastestRun, FastestRun } from "../../../../../Helpers/FastestRun";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT A CHANGE'S INFRASTRUCTURE CODE DOES TO A STORE (#10376): one rule
 * for each Data Security check a file can show - a store made public, left
 * unencrypted, without backups or logging, its firewall open to the
 * internet, a snapshot shared - over Terraform, CloudFormation, Bicep, ARM,
 * Kubernetes, Pulumi and the CDK, each a point at the line that sets it,
 * with the setting's safe value as the change to suggest.
 */

function patchOf(lines: Array<string>, start: number = 1): string {
  return [
    `@@ -0,0 +${start},${lines.length} @@`,
    ...lines.map((line: string): string => {
      return `+${line}`;
    }),
  ].join("\n");
}

function leaksIn(
  path: string,
  lines: Array<string>,
): Array<SensitiveDataCandidate> {
  return findInfrastructureLeaks({
    path,
    lines: readPatchLines(patchOf(lines)),
  });
}

function checksIn(path: string, lines: Array<string>): Array<string> {
  return leaksIn(path, lines).map((leak: SensitiveDataCandidate): string => {
    return leak.checkId;
  });
}

function onlyLeak(path: string, lines: Array<string>): SensitiveDataCandidate {
  const leaks: Array<SensitiveDataCandidate> = leaksIn(path, lines);

  expect(leaks).toHaveLength(1);

  return leaks[0]!;
}

describe("a public-read bucket in Terraform", () => {
  const bucket: Array<string> = [
    'resource "aws_s3_bucket" "exports" {',
    '  bucket = "acme-card-exports"',
    '  acl    = "public-read"',
    "}",
  ];

  test("is a point at its line: readable by anyone, the store it names, the safe value", () => {
    const leak: SensitiveDataCandidate = onlyLeak("infra/s3.tf", bucket);

    expect(leak).toMatchObject({
      kind: SensitiveDataLeakKind.Infrastructure,
      checkId: "public-read",
      path: "infra/s3.tf",
      line: 3,
      subject: "acl",
      where: "aws_s3_bucket.exports",
      value: '"public-read"',
      sensitivity: DataSensitivity.Confidential,
      isBlocking: true,
      isStoreKnown: false,
      resourceType: "aws_s3_bucket",
      resourceNames: ["acme-card-exports"],
      suggestion: {
        startLine: 3,
        endLine: 3,
        original: ['  acl    = "public-read"'],
        replacement: ['  acl    = "private"'],
        isByAi: false,
      },
    });
    expect(leak.text).toBe(
      'Sets `acl` to `"public-read"` on `aws_s3_bucket.exports` in Terraform, which makes the store readable by anyone on the internet.',
    );
    expect(leak.fix.length).toBeGreaterThan(0);
  });

  test("marked not sensitive, it is none", () => {
    expect(
      leaksIn("infra/s3.tf", [
        'resource "aws_s3_bucket" "site" {',
        '  bucket = "acme-public-site"',
        "  # oneuptime:not-sensitive: the public website's assets",
        '  acl    = "public-read"',
        "}",
      ]),
    ).toEqual([]);
  });

  test("private, it is none", () => {
    expect(
      leaksIn("infra/s3.tf", [
        'resource "aws_s3_bucket" "exports" {',
        '  bucket = "acme-card-exports"',
        '  acl    = "private"',
        "}",
      ]),
    ).toEqual([]);
  });

  test("a line the change only shows is not its own", () => {
    expect(
      findInfrastructureLeaks({
        path: "infra/s3.tf",
        lines: readPatchLines(
          [
            "@@ -1,4 +1,4 @@",
            ' resource "aws_s3_bucket" "exports" {',
            '-  bucket = "acme-exports"',
            '+  bucket = "acme-card-exports"',
            '   acl    = "public-read"',
            " }",
          ].join("\n"),
        ),
      }),
    ).toEqual([]);
  });

  test("a resource that names its bucket by reference is about that bucket", () => {
    const leak: SensitiveDataCandidate = onlyLeak("infra/s3.tf", [
      'resource "aws_s3_bucket" "exports" {',
      '  bucket = "acme-card-exports"',
      "}",
      "",
      'resource "aws_s3_bucket_acl" "exports" {',
      "  bucket = aws_s3_bucket.exports.id",
      '  acl    = "public-read"',
      "}",
    ]);

    expect(leak.where).toBe("aws_s3_bucket_acl.exports");
    expect(leak.resourceNames).toEqual(["acme-card-exports"]);
  });
});

describe("each check a file can show", () => {
  test.each([
    [
      "public-write",
      "infra/s3.tf",
      [
        'resource "aws_s3_bucket_acl" "uploads" {',
        '  acl = "public-read-write"',
        "}",
      ],
    ],
    [
      "public-access-not-blocked",
      "infra/s3.tf",
      [
        'resource "aws_s3_bucket_public_access_block" "exports" {',
        "  block_public_acls       = false",
        "}",
      ],
    ],
    [
      "public-read",
      "infra/gcs.tf",
      [
        'resource "google_storage_bucket_iam_member" "exports" {',
        '  role   = "roles/storage.objectViewer"',
        '  member = "allUsers"',
        "}",
      ],
    ],
    [
      "internet-reachable",
      "infra/rds.tf",
      [
        'resource "aws_db_instance" "orders" {',
        "  publicly_accessible = true",
        "}",
      ],
    ],
    [
      "not-encrypted-at-rest",
      "infra/rds.tf",
      [
        'resource "aws_db_instance" "orders" {',
        "  storage_encrypted = false",
        "}",
      ],
    ],
    [
      "no-backups",
      "infra/rds.tf",
      [
        'resource "aws_db_instance" "orders" {',
        "  backup_retention_period = 0",
        "}",
      ],
    ],
    [
      "deletion-protection-off",
      "infra/rds.tf",
      [
        'resource "aws_db_instance" "orders" {',
        "  deletion_protection = false",
        "}",
      ],
    ],
    [
      "snapshot-public",
      "infra/rds.tf",
      [
        'resource "aws_db_snapshot" "nightly" {',
        '  shared_accounts = ["all"]',
        "}",
      ],
    ],
    [
      "access-not-logged",
      "infra/trail.tf",
      ['resource "aws_cloudtrail" "main" {', "  enable_logging = false", "}"],
    ],
    [
      "weak-tls",
      "infra/storage.tf",
      [
        'resource "azurerm_storage_account" "exports" {',
        '  min_tls_version = "TLS1_0"',
        "}",
      ],
    ],
    [
      "encryption-in-transit-not-enforced",
      "infra/storage.tf",
      [
        'resource "azurerm_storage_account" "exports" {',
        "  https_traffic_only_enabled = false",
        "}",
      ],
    ],
    [
      "public-access-not-blocked",
      "infra/storage.tf",
      [
        'resource "azurerm_storage_account" "exports" {',
        "  allow_nested_items_to_be_public = true",
        "}",
      ],
    ],
    [
      "open-to-all-addresses",
      "infra/firewall.tf",
      [
        'resource "aws_security_group_rule" "postgres" {',
        '  type        = "ingress"',
        "  from_port   = 5432",
        "  to_port     = 5432",
        '  cidr_blocks = ["0.0.0.0/0"]',
        "}",
      ],
    ],
  ])("%s: %s", (checkId: string, path: string, lines: Array<string>) => {
    expect(checksIn(path, lines)).toEqual([checkId]);
  });

  test("a web server's firewall open to the internet is how the web works: no point", () => {
    expect(
      checksIn("infra/firewall.tf", [
        'resource "aws_security_group_rule" "https" {',
        '  type        = "ingress"',
        "  from_port   = 443",
        "  to_port     = 443",
        '  cidr_blocks = ["0.0.0.0/0"]',
        "}",
      ]),
    ).toEqual([]);
  });

  test("CloudFormation", () => {
    expect(
      checksIn("templates/orders.yaml", [
        'AWSTemplateFormatVersion: "2010-09-09"',
        "Resources:",
        "  OrdersDb:",
        "    Type: AWS::RDS::DBInstance",
        "    Properties:",
        "      PubliclyAccessible: true",
        "      StorageEncrypted: false",
      ]),
    ).toEqual(["internet-reachable", "not-encrypted-at-rest"]);
  });

  test("Kubernetes: a database's Service on a load balancer", () => {
    expect(
      checksIn("deploy/postgres-service.yaml", [
        "apiVersion: v1",
        "kind: Service",
        "metadata:",
        "  name: postgres",
        "spec:",
        "  type: LoadBalancer",
        "  ports:",
        "    - port: 5432",
      ]),
    ).toEqual(["internet-reachable"]);
  });

  test("Kubernetes: a web Service on a load balancer is none", () => {
    expect(
      checksIn("deploy/web-service.yaml", [
        "apiVersion: v1",
        "kind: Service",
        "metadata:",
        "  name: web",
        "spec:",
        "  type: LoadBalancer",
        "  ports:",
        "    - port: 443",
      ]),
    ).toEqual([]);
  });

  test("Bicep", () => {
    expect(
      checksIn("infra/storage.bicep", [
        "resource exports 'Microsoft.Storage/storageAccounts@2023-01-01' = {",
        "  name: 'acmeexports'",
        "  properties: {",
        "    allowBlobPublicAccess: true",
        "  }",
        "}",
      ]),
    ).toEqual(["public-access-not-blocked"]);
  });

  test("Pulumi", () => {
    expect(
      checksIn("infra/index.ts", [
        'import * as aws from "@pulumi/aws";',
        "",
        'const exports = new aws.s3.Bucket("exports", {',
        '  acl: "public-read",',
        "});",
      ]),
    ).toEqual(["public-read"]);
  });

  test("the AWS CDK", () => {
    expect(
      checksIn("lib/storage-stack.ts", [
        'import * as s3 from "aws-cdk-lib/aws-s3";',
        "",
        'new s3.Bucket(this, "Exports", {',
        "  publicReadAccess: true,",
        "});",
      ]),
    ).toEqual(["public-read"]);
  });

  test("every check a rule names is a Data Security check of the catalog, and one a review points at", () => {
    for (const rule of INFRASTRUCTURE_RULES) {
      expect({
        checkId: rule.checkId,
        isCatalogs: Boolean(getDataSecurityCheck(rule.checkId)),
        isReviews: INFRASTRUCTURE_LEAK_CHECK_IDS.includes(rule.checkId),
      }).toEqual({ checkId: rule.checkId, isCatalogs: true, isReviews: true });
    }
  });

  test("only a store made public can fail the check", () => {
    const blocking: Set<string> = new Set<string>();

    for (const lines of [
      ['resource "aws_s3_bucket" "a" {', '  acl = "public-read"', "}"],
      ['resource "aws_db_instance" "b" {', "  storage_encrypted = false", "}"],
      [
        'resource "aws_db_instance" "c" {',
        "  backup_retention_period = 0",
        "}",
      ],
    ]) {
      for (const leak of leaksIn("infra/main.tf", lines)) {
        if (leak.isBlocking) {
          blocking.add(leak.checkId);
        }
      }
    }

    expect(
      Array.from(blocking).every((checkId: string): boolean => {
        return PUBLIC_STORE_CHECK_IDS.includes(checkId);
      }),
    ).toBe(true);
    expect(blocking.has("public-read")).toBe(true);
  });
});

describe("what is no infrastructure code", () => {
  test.each([
    [
      ".github/workflows/ci.yaml",
      ["on: push", "jobs:", "  build:", "    runs-on: ubuntu-latest"],
    ],
    ["config/app.json", ['{ "acl": "public-read" }']],
    ["src/upload.ts", ['const acl = "public-read";']],
  ])("%s", (path: string, lines: Array<string>) => {
    expect(
      getInfrastructureKind(path, readPatchLines(patchOf(lines))),
    ).toBeNull();
    expect(leaksIn(path, lines)).toEqual([]);
  });

  test.each([
    ["infra/main.tf", InfrastructureCodeKind.Terraform],
    ["infra/main.bicep", InfrastructureCodeKind.Bicep],
    ["Pulumi.prod.yaml", InfrastructureCodeKind.Pulumi],
  ])("%s is %s", (path: string, kind: InfrastructureCodeKind) => {
    expect(getInfrastructureKind(path, [])).toBe(kind);
  });
});

describe("a setting, as a line writes it", () => {
  test.each([
    ['  acl = "public-read"', "acl", "public-read"],
    ["  PubliclyAccessible: true", "publiclyaccessible", "true"],
    ["  publicReadAccess: true,", "publicreadaccess", "true"],
    ["    allowBlobPublicAccess: true", "allowblobpublicaccess", "true"],
    ['  "publicNetworkAccess": "Enabled",', "publicnetworkaccess", "enabled"],
  ])("%s", (line: string, key: string, value: string) => {
    expect(readSetting(line)).toMatchObject({ normalizedKey: key, value });
  });

  test("a line that sets nothing", () => {
    expect(readSetting("}")).toBeNull();
    expect(readSetting('resource "aws_s3_bucket" "a" {')).toBeNull();
  });
});

describe("time in line with the change, whatever it holds", () => {
  test.each([
    ["braces", "{".repeat(5000)],
    ["quotes", '"'.repeat(5000)],
    ["a long key", `${"a".repeat(5000)} = "public-read"`],
  ])("%s", (_what: string, line: string) => {
    const lines: Array<string> = ['resource "aws_s3_bucket" "a" {'];

    for (let index: number = 0; index < 1000; index++) {
      lines.push(line);
    }

    const run: FastestRun<number> = fastestRun({
      run: (): number => {
        return leaksIn("infra/main.tf", lines).length;
      },
      limitInMs: 3000,
    });

    expect(run.inMs).toBeLessThan(3000);
  });
});
