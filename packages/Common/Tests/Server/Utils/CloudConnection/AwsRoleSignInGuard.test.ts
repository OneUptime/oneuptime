import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import * as AwsSts from "../../../../Server/Utils/CloudConnection/Aws/AwsSts";

/*
 * EVERY SIGN-IN TO A CUSTOMER'S AWS ROLE IS CHECKED FIRST (#10405).
 *
 * OneUptime's AWS identity may assume any role whose trust policy trusts
 * it. Only the check in AwsSts (probeRoleExternalId, which assumeRole makes
 * before it signs in) tells a role that holds OneUptime to the project's
 * external id from one that lets in any project that knows its ARN. So the
 * one sign-in is AwsSts.assumeRole, and this guard fails when:
 *
 *   1. any other file of the product asks STS for AssumeRole - the Query
 *      protocol's "AssumeRole" action, the SDKs' AssumeRoleCommand or
 *      fromTemporaryCredentials, Go's stscreds - but the two listed in
 *      SIGNS_IN_ITSELF, each with why it may;
 *   2. AwsSts lets its raw sign-in out: requestRoleSession is not exported,
 *      and is called by the check and by assumeRole alone, which checks
 *      before it signs in;
 *   3. anything but Cloud Connect's own sign-in takes OneUptime's own AWS
 *      credentials, which are what a role trusts (USES_ONEUPTIME_IDENTITY).
 *
 * A new caller - a project's Amazon SES role (#7378) - signs in with
 * AwsSts.assumeRole and its own connection id, and is listed in 3.
 */

const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
);
const STS_FILE: string =
  "packages/Common/Server/Utils/CloudConnection/Aws/AwsSts.ts";

// Where the product's code is, and what of it is not.
const SCAN_ROOTS: ReadonlyArray<string> = ["packages", "ee", "agents"];
const SKIPPED_FOLDERS: ReadonlySet<string> = new Set<string>([
  "node_modules",
  "build",
  "dist",
  "Tests",
  "__tests__",
  "__mocks__",
  "coverage",
  ".git",
  "vendor",
]);
const SCANNED_EXTENSIONS: ReadonlyArray<string> = [
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".go",
];
const TEST_FILE: RegExp = /(\.test|\.spec|_test)\.(tsx?|jsx?|go)$/;

// Asking STS for AssumeRole, every way the product's languages can.
const SIGN_IN_PATTERNS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: 'the "AssumeRole" action', pattern: /["'`]AssumeRole["'`]/ },
  { name: "AssumeRoleCommand", pattern: /\bAssumeRoleCommand\b/ },
  { name: "fromTemporaryCredentials", pattern: /\bfromTemporaryCredentials\b/ },
  { name: "stscreds", pattern: /\bstscreds\.\w*AssumeRole/ },
  {
    name: "an STS client's AssumeRole",
    pattern: /\.AssumeRole\(\s*(ctx|context)/,
  },
];

// The files that may ask STS for AssumeRole, and why.
const SIGNS_IN_ITSELF: Record<string, string> = {
  [STS_FILE]:
    "the one sign-in to a customer's role: assumeRole checks that the role requires the project's external id first",
  "agents/ResourceAIAgent/Executors/Cloud/AwsCredentials.ts":
    "the Infrastructure AI Agent runs in the customer's own account and signs in to that account's write role with its own task role, never OneUptime's identity: no other project can name the role it signs in to",
};

// The files that may take OneUptime's own AWS credentials, and why.
const USES_ONEUPTIME_IDENTITY: Record<string, string> = {
  "packages/Common/Server/Utils/CloudConnection/Aws/AwsServerIdentity.ts":
    "where the identity comes from, and who it is (sts:GetCallerIdentity)",
  "packages/Common/Server/Utils/CloudConnection/Aws/AwsCloudConnector.ts":
    "getCredentials signs in to a connection's role with it, through AwsSts.assumeRole",
};
const ONEUPTIME_IDENTITY_PATTERN: RegExp =
  /AwsServerIdentity\.getCredentials\(|AwsCloudConnector\.getServerCredentials\(/;

// A function's first line in AwsSts, and a call to its raw sign-in.
const FUNCTION_START: RegExp = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)\(/;
const RAW_SIGN_IN_CALL: RegExp = /\brequestRoleSession\(/;

function relative(file: string): string {
  return path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/");
}

function listSourceFiles(): Array<string> {
  const files: Array<string> = [];
  const walk: (folder: string) => void = (folder: string): void => {
    let entries: Array<fs.Dirent>;

    try {
      entries = fs.readdirSync(folder, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const full: string = path.join(folder, entry.name);

      if (entry.isDirectory()) {
        if (!SKIPPED_FOLDERS.has(entry.name)) {
          walk(full);
        }

        continue;
      }

      if (
        SCANNED_EXTENSIONS.includes(path.extname(entry.name)) &&
        !TEST_FILE.test(entry.name) &&
        !entry.name.endsWith(".d.ts")
      ) {
        files.push(full);
      }
    }
  };

  for (const root of SCAN_ROOTS) {
    walk(path.join(REPOSITORY_ROOT, root));
  }

  return files;
}

// Each file whose text matches, with the line and what matched.
function findings(
  files: Array<string>,
  patterns: ReadonlyArray<{ name: string; pattern: RegExp }>,
): Array<string> {
  const found: Array<string> = [];

  for (const file of files) {
    const text: string = fs.readFileSync(file, "utf8");

    if (
      !patterns.some((entry: { name: string; pattern: RegExp }): boolean => {
        return entry.pattern.test(text);
      })
    ) {
      continue;
    }

    text.split("\n").forEach((line: string, index: number) => {
      for (const entry of patterns) {
        if (entry.pattern.test(line)) {
          found.push(`${relative(file)}:${index + 1} (${entry.name})`);
        }
      }
    });
  }

  return found;
}

function fileOf(finding: string): string {
  return finding.split(":")[0] || "";
}

const SOURCE_FILES: Array<string> = listSourceFiles();

describe("the scan reads the product's code", () => {
  test("it reads every package, ee/ and the agents, and finds the sign-ins it knows of", () => {
    const scanned: Array<string> = SOURCE_FILES.map(relative);

    expect(scanned).toContain(STS_FILE);
    expect(scanned).toContain(
      "packages/Common/Server/Utils/CloudConnection/Aws/AwsCloudConnector.ts",
    );
    expect(
      scanned.some((file: string): boolean => {
        return file.startsWith("agents/");
      }),
    ).toBe(true);
    expect(
      scanned.some((file: string): boolean => {
        return file.includes("/Tests/") || TEST_FILE.test(file);
      }),
    ).toBe(false);

    expect(
      Array.from(
        new Set(findings(SOURCE_FILES, SIGN_IN_PATTERNS).map(fileOf)),
      ).sort(),
    ).toEqual(Object.keys(SIGNS_IN_ITSELF).sort());
  });

  test("each way of signing in is caught, and its look-alikes are not", () => {
    const caught: (line: string) => boolean = (line: string): boolean => {
      return SIGN_IN_PATTERNS.some(
        (entry: { name: string; pattern: RegExp }): boolean => {
          return entry.pattern.test(line);
        },
      );
    };

    for (const line of [
      'body: { Action: "AssumeRole", Version: "2011-06-15" }',
      "action: 'AssumeRole',",
      "const command = new AssumeRoleCommand({ RoleArn });",
      "credentials: fromTemporaryCredentials({ params: { RoleArn } }),",
      "provider := stscreds.NewAssumeRoleProvider(client, roleArn)",
      "out, err := svc.AssumeRole(ctx, &sts.AssumeRoleInput{})",
    ]) {
      expect(caught(line)).toBe(true);
    }

    for (const line of [
      // An IAM policy's action, a CloudTrail event's name in a list, the server's own web identity.
      'Action: "sts:AssumeRole",',
      'Action: "AssumeRoleWithWebIdentity",',
      "await assumeRole({ transport, credentials, roleArn });",
    ]) {
      expect(caught(line)).toBe(false);
    }
  });
});

describe("only AwsSts signs in to a customer's role", () => {
  test("no other file asks STS for AssumeRole", () => {
    const outside: Array<string> = findings(
      SOURCE_FILES,
      SIGN_IN_PATTERNS,
    ).filter((finding: string): boolean => {
      return !SIGNS_IN_ITSELF[fileOf(finding)];
    });

    /*
     * Sign in to a customer's role with AwsSts.assumeRole, which checks that
     * the role requires the project's external id before it signs in: a role
     * without the sts:ExternalId condition lets in any project that knows
     * its ARN (#10405).
     */
    expect(outside).toEqual([]);
  });

  test("its raw sign-in is not let out: not exported, and called by the check and by assumeRole alone", () => {
    const text: string = fs.readFileSync(
      path.join(REPOSITORY_ROOT, STS_FILE),
      "utf8",
    );

    expect(Object.keys(AwsSts)).not.toContain("requestRoleSession");
    expect(text).toMatch(/\nasync function requestRoleSession\(/);
    expect(text).not.toMatch(
      /export\s+(async\s+)?function\s+requestRoleSession/,
    );
    expect(text.match(/["'`]AssumeRole["'`]/g)).toHaveLength(1);

    // Where each call to it is: inside which function.
    const callers: Array<string> = [];
    let current: string = "";

    for (const line of text.split("\n")) {
      const opened: RegExpExecArray | null = FUNCTION_START.exec(line);

      if (opened) {
        current = opened[1]!;
        continue;
      }

      if (RAW_SIGN_IN_CALL.test(line)) {
        callers.push(current);
      }
    }

    expect(callers.sort()).toEqual(["assumeRole", "probeRoleExternalId"]);
  });

  test("assumeRole checks the role before it signs in with the project's external id", () => {
    const text: string = fs.readFileSync(
      path.join(REPOSITORY_ROOT, STS_FILE),
      "utf8",
    );
    const start: number = text.indexOf("export async function assumeRole(");
    const body: string = text.slice(start, text.indexOf("\n}\n", start));

    expect(start).toBeGreaterThan(0);
    expect(body.indexOf("probeRoleExternalId(")).toBeGreaterThan(0);
    expect(body.indexOf("probeRoleExternalId(")).toBeLessThan(
      body.indexOf("requestRoleSession("),
    );
    expect(body).toContain("getAwsExternalIdForProject(data.projectId)");
  });
});

describe("OneUptime's own AWS identity", () => {
  test("is taken only to sign in to a connection's role, and to say who it is", () => {
    const users: Array<string> = Array.from(
      new Set(
        findings(SOURCE_FILES, [
          { name: "OneUptime's identity", pattern: ONEUPTIME_IDENTITY_PATTERN },
        ]).map(fileOf),
      ),
    ).sort();

    /*
     * Anything new that signs in with OneUptime's identity signs in to a
     * customer's role with AwsSts.assumeRole, and is listed here with why.
     */
    expect(users).toEqual(Object.keys(USES_ONEUPTIME_IDENTITY).sort());
  });
});
