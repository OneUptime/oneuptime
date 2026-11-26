import {
  EvalExpectedPoint,
  PULL_REQUEST_EVAL_DIFFS,
  PullRequestEvalDiff,
} from "../../../../../../Server/Utils/AI/Eval/DataSecurity/PullRequestReviewEvalSet";
import { SensitiveDataCandidate } from "../../../../../../Server/Utils/CodeRepository/ProductionReview/SensitiveData/SensitiveDataCandidate";
import SensitiveDataRules, {
  SensitiveDataRulesResult,
} from "../../../../../../Server/Utils/CodeRepository/ProductionReview/SensitiveData/SensitiveDataRules";
import {
  INFRASTRUCTURE_LEAK_CHECK_IDS,
  PRODUCTION_REVIEW_LEAK_CHECK_IDS,
  SENSITIVE_DATA_LIMITS,
  SensitiveDataLeakKind,
} from "../../../../../../Types/CodeRepository/ProductionReviewSensitiveData";
import { getDataSecurityCheck } from "../../../../../../Types/DataSecurity/DataSecurityCheckCatalog";
import DataSensitivity from "../../../../../../Types/DataSecurity/DataSensitivity";
import { describe, expect, test } from "@jest/globals";

/*
 * THE RULES OVER RECORDED DIFFS (#10376): every pull request of the eval
 * set (PullRequestReviewEvalSet) gets exactly the points it says - each by
 * the name its rule reads, its check, and whether it can fail the check -
 * and no other. A rule that finds one point more, or one fewer, fails here
 * before a team sees it on a pull request.
 */

interface PointOf {
  subject: string;
  checkId: string;
  isBlocking: boolean;
}

function pointsOf(diff: PullRequestEvalDiff): Array<PointOf> {
  const result: SensitiveDataRulesResult = SensitiveDataRules.find({
    files: diff.files,
  });

  return result.candidates.map((candidate: SensitiveDataCandidate): PointOf => {
    return {
      subject: candidate.subject,
      checkId: candidate.checkId,
      isBlocking: candidate.isBlocking,
    };
  });
}

function sorted(points: Array<PointOf>): Array<PointOf> {
  return [...points].sort((a: PointOf, b: PointOf): number => {
    return `${a.checkId}:${a.subject}`.localeCompare(
      `${b.checkId}:${b.subject}`,
    );
  });
}

describe("every diff of the eval set gets exactly its points", () => {
  test.each(
    PULL_REQUEST_EVAL_DIFFS.map(
      (diff: PullRequestEvalDiff): [string, PullRequestEvalDiff] => {
        return [diff.id, diff];
      },
    ),
  )("%s", (_id: string, diff: PullRequestEvalDiff) => {
    expect(sorted(pointsOf(diff))).toEqual(
      sorted(
        diff.points.map((point: EvalExpectedPoint): PointOf => {
          return {
            subject: point.subject,
            checkId: point.checkId,
            isBlocking: point.isBlocking,
          };
        }),
      ),
    );
  });
});

describe("the eval set itself", () => {
  test("each diff has its own id", () => {
    const ids: Array<string> = PULL_REQUEST_EVAL_DIFFS.map(
      (diff: PullRequestEvalDiff): string => {
        return diff.id;
      },
    );

    expect(new Set<string>(ids).size).toBe(ids.length);
  });

  test("every check a diff expects is a Data Security check a review can point at", () => {
    for (const diff of PULL_REQUEST_EVAL_DIFFS) {
      for (const point of diff.points) {
        expect({
          id: diff.id,
          checkId: point.checkId,
          isCatalogs: Boolean(getDataSecurityCheck(point.checkId)),
          isReviews: PRODUCTION_REVIEW_LEAK_CHECK_IDS.includes(point.checkId),
        }).toEqual({
          id: diff.id,
          checkId: point.checkId,
          isCatalogs: true,
          isReviews: true,
        });
      }
    }
  });

  test("it holds each kind of change, and diffs with no point at all", () => {
    const kinds: Set<SensitiveDataLeakKind> = new Set<SensitiveDataLeakKind>();

    for (const diff of PULL_REQUEST_EVAL_DIFFS) {
      const result: SensitiveDataRulesResult = SensitiveDataRules.find({
        files: diff.files,
      });

      for (const candidate of result.candidates) {
        kinds.add(candidate.kind);
      }
    }

    expect(Array.from(kinds).sort()).toEqual(
      [
        SensitiveDataLeakKind.Infrastructure,
        SensitiveDataLeakKind.Migration,
        SensitiveDataLeakKind.Telemetry,
      ].sort(),
    );
    expect(
      PULL_REQUEST_EVAL_DIFFS.filter((diff: PullRequestEvalDiff): boolean => {
        return diff.points.length === 0;
      }).length,
    ).toBeGreaterThanOrEqual(4);
  });

  test("the issue's own scenarios are in it", () => {
    const ids: Array<string> = PULL_REQUEST_EVAL_DIFFS.map(
      (diff: PullRequestEvalDiff): string => {
        return diff.id;
      },
    );

    expect(ids).toEqual(
      expect.arrayContaining([
        "log-email-on-signup",
        "terraform-public-bucket",
        "migration-customer-ssn",
        "migration-password-hash-with-bcrypt",
      ]),
    );
  });
});

describe("what a point says, for the issue's scenarios", () => {
  function only(id: string): SensitiveDataCandidate {
    const diff: PullRequestEvalDiff | undefined = PULL_REQUEST_EVAL_DIFFS.find(
      (each: PullRequestEvalDiff): boolean => {
        return each.id === id;
      },
    );
    const result: SensitiveDataRulesResult = SensitiveDataRules.find({
      files: diff!.files,
    });

    expect(result.candidates).toHaveLength(1);

    return result.candidates[0]!;
  }

  test('logger.info("signup", { email }): an email address, written to a log, at its line', () => {
    const point: SensitiveDataCandidate = only("log-email-on-signup");

    expect(point).toMatchObject({
      kind: SensitiveDataLeakKind.Telemetry,
      checkId: "sensitive-data-in-telemetry",
      path: "services/checkout/src/signup.ts",
      line: 11,
      subject: "email",
      isBlocking: false,
    });
    expect(point.text).toContain("an email address");
    expect(point.text).toContain("to a log");
    expect(point.fix.length).toBeGreaterThan(0);
    // The change the fix suggests: the line without the email.
    expect(point.suggestion).toBeDefined();
    expect(point.suggestion!.original).toEqual([
      '  logger.info("signup", { email });',
    ]);
    expect(point.suggestion!.replacement.join("\n")).not.toContain("email }");
  });

  test("a public-read bucket in Terraform: the store readable by anyone, which can fail the check", () => {
    const point: SensitiveDataCandidate = only("terraform-public-bucket");

    expect(point.kind).toBe(SensitiveDataLeakKind.Infrastructure);
    expect(INFRASTRUCTURE_LEAK_CHECK_IDS).toContain(point.checkId);
    expect(point.checkId).toBe("public-read");
    expect(point.isBlocking).toBe(true);
    expect(point.text).toContain("readable by anyone");
    // What the store is, as the code names it - never one OneUptime knows.
    expect(point.isStoreKnown).toBe(false);
    expect(point.suggestion).toBeDefined();
    expect(point.suggestion!.replacement.join("\n")).toContain("private");
  });

  test("a migration adding customer_ssn: a column for a US Social Security number", () => {
    const point: SensitiveDataCandidate = only("migration-customer-ssn");

    expect(point).toMatchObject({
      kind: SensitiveDataLeakKind.Migration,
      checkId: "new-personal-data-column",
      subject: "customer_ssn",
      isBlocking: false,
    });
    expect(point.text).toContain("US Social Security number");
  });

  test("a migration adding password_hash beside bcrypt: no point at all", () => {
    const diff: PullRequestEvalDiff | undefined = PULL_REQUEST_EVAL_DIFFS.find(
      (each: PullRequestEvalDiff): boolean => {
        return each.id === "migration-password-hash-with-bcrypt";
      },
    );

    expect(diff!.points).toEqual([]);
    expect(SensitiveDataRules.find({ files: diff!.files }).candidates).toEqual(
      [],
    );
  });
});

describe("what the rules read, and how much", () => {
  const signup: PullRequestEvalDiff = PULL_REQUEST_EVAL_DIFFS.find(
    (each: PullRequestEvalDiff): boolean => {
      return each.id === "log-email-on-signup";
    },
  )!;

  test("a removed file, a file with no patch and a dependency's copy are not read", () => {
    const file: PullRequestEvalDiff["files"][number] = signup.files[0]!;

    expect(
      SensitiveDataRules.find({
        files: [
          { ...file, status: "removed" },
          { ...file, patch: null },
          { ...file, filename: "node_modules/acme/src/signup.ts" },
          { ...file, filename: "vendor/acme/signup.ts" },
        ],
      }).candidates,
    ).toEqual([]);
  });

  test("a test's code is read for what it opens to the world, never for what it logs", () => {
    const file: PullRequestEvalDiff["files"][number] = signup.files[0]!;
    const bucket: PullRequestEvalDiff = PULL_REQUEST_EVAL_DIFFS.find(
      (each: PullRequestEvalDiff): boolean => {
        return each.id === "terraform-public-bucket";
      },
    )!;

    expect(
      SensitiveDataRules.find({
        files: [{ ...file, filename: "services/checkout/test/signup.test.ts" }],
      }).candidates,
    ).toEqual([]);
    expect(
      SensitiveDataRules.find({
        files: bucket.files.map(
          (
            each: PullRequestEvalDiff["files"][number],
          ): PullRequestEvalDiff["files"][number] => {
            return { ...each, filename: `test/fixtures/${each.filename}` };
          },
        ),
      }).candidates.length,
    ).toBeGreaterThan(0);
  });

  test("a file of another language than code is read for no telemetry write", () => {
    const file: PullRequestEvalDiff["files"][number] = signup.files[0]!;

    expect(
      SensitiveDataRules.find({
        files: [{ ...file, filename: "docs/signup.md" }],
      }).candidates,
    ).toEqual([]);
  });

  test("a few points a file, and a few in all: the rest is counted", () => {
    const lines: Array<string> = [];

    for (let index: number = 0; index < 8; index++) {
      lines.push(`logger.info("step", { email${index}: email });`);
    }

    const files: Array<PullRequestEvalDiff["files"][number]> = [];

    for (let file: number = 0; file < 5; file++) {
      files.push({
        filename: `src/step${file}.ts`,
        status: "added",
        patch: [
          `@@ -0,0 +1,${lines.length} @@`,
          ...lines.map((line: string): string => {
            return `+${line}`;
          }),
        ].join("\n"),
      });
    }

    const result: SensitiveDataRulesResult = SensitiveDataRules.find({
      files,
    });

    expect(result.candidates).toHaveLength(SENSITIVE_DATA_LIMITS.maxPoints);
    expect(result.candidates.length + result.moreCount).toBe(5 * 8);
  });

  test("what can fail the check comes first", () => {
    const login: PullRequestEvalDiff = PULL_REQUEST_EVAL_DIFFS.find(
      (each: PullRequestEvalDiff): boolean => {
        return each.id === "log-password-on-login";
      },
    )!;
    const result: SensitiveDataRulesResult = SensitiveDataRules.find({
      files: [...signup.files, ...login.files],
    });

    expect(
      result.candidates.map((candidate: SensitiveDataCandidate): boolean => {
        return candidate.isBlocking;
      }),
    ).toEqual([true, false]);
  });

  test("a project's own data type is read too", () => {
    const result: SensitiveDataRulesResult = SensitiveDataRules.find({
      files: [
        {
          filename: "src/loyalty.ts",
          status: "added",
          patch: '@@ -0,0 +1,1 @@\n+logger.info("joined", { loyaltyNumber });',
        },
      ],
      projectTypes: [
        {
          id: "custom:1111",
          name: "Loyalty member number",
          sensitivity: DataSensitivity.Restricted,
          nameHints: ["loyalty number"],
        },
      ],
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]!.text).toContain("loyalty member number");
  });
});
