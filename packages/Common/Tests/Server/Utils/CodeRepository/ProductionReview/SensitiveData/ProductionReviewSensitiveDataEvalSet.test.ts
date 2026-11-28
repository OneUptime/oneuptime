import {
  addedFile,
  EvalDiffFile,
  EvalExpectedPoint,
  PULL_REQUEST_EVAL_DIFFS,
  PullRequestEvalDiff,
} from "../../../../../../Server/Utils/AI/Eval/DataSecurity/PullRequestReviewEvalSet";
import {
  RecordedTelemetryLeakFinding,
  TELEMETRY_LEAK_EVAL_SET,
  TelemetryLeakEvalCase,
} from "../../../../../../Server/Utils/AI/Eval/DataSecurity/TelemetryLeakEvalSet";
import { DataStoreKind } from "../../../../../../Types/DataSecurity/DataStoreKind";
import { SensitiveDataCandidate } from "../../../../../../Server/Utils/CodeRepository/ProductionReview/SensitiveData/SensitiveDataCandidate";
import SensitiveDataRules, {
  SensitiveDataRulesResult,
} from "../../../../../../Server/Utils/CodeRepository/ProductionReview/SensitiveData/SensitiveDataRules";
import {
  INFRASTRUCTURE_LEAK_CHECK_IDS,
  PRODUCTION_REVIEW_LEAK_CHECK_IDS,
  SENSITIVE_DATA_LIMITS,
  SensitiveDataLeakKind,
  SensitiveDataSink,
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

    // Where a value goes, and the table a column is added to, where the diff says.
    const candidates: Array<SensitiveDataCandidate> = SensitiveDataRules.find({
      files: diff.files,
    }).candidates;

    for (const expected of diff.points) {
      if (expected.sink === undefined && expected.where === undefined) {
        continue;
      }

      const found: SensitiveDataCandidate | undefined = candidates.find(
        (candidate: SensitiveDataCandidate): boolean => {
          return (
            candidate.subject === expected.subject &&
            candidate.checkId === expected.checkId
          );
        },
      );

      expect({
        subject: expected.subject,
        sink: expected.sink === undefined ? undefined : found?.sink,
        where: expected.where === undefined ? undefined : found?.where,
      }).toEqual({
        subject: expected.subject,
        sink: expected.sink,
        where: expected.where,
      });
    }
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

/*
 * WHAT DATA SECURITY LOCATES AFTER IT SHIPS, A REVIEW CATCHES BEFORE
 * (#10778, with #10367): each leak of the eval set of recorded findings -
 * a span's and a log line's email, an email in twenty handlers, a key in
 * an exception's message, an email on a metric, a log line found by its
 * template, and a web application's browser log and session identified
 * by an email (#11395) - leads from its records to the line of code that
 * writes it.
 * Had that code come in a pull request, its review's rules would have
 * given a point on that line (or the lines of the call it starts), under
 * the same check and for the same kind of telemetry.
 */
describe("every leak Data Security locates in a service's code, the review of the pull request that added it catches", () => {
  const SINK_OF_STORE: Partial<Record<DataStoreKind, SensitiveDataSink>> = {
    [DataStoreKind.TelemetryLogs]: SensitiveDataSink.Log,
    [DataStoreKind.TelemetryTraces]: SensitiveDataSink.Span,
    [DataStoreKind.TelemetryExceptions]: SensitiveDataSink.Exception,
    [DataStoreKind.TelemetryMetrics]: SensitiveDataSink.Metric,
    [DataStoreKind.TelemetryAiConversations]: SensitiveDataSink.AiPrompt,
  };

  /*
   * A RUM application's session replays (#11395) hold its browser logs,
   * its browser spans and its sessions' details: a finding there is a
   * point of the sink its place is - a browser log's attribute a Log
   * point, a session's user a Session point - never of the store alone.
   */
  const SINK_OF_SESSION_REPLAY_PLACE: ReadonlyArray<
    [string, SensitiveDataSink]
  > = [
    ["logs.", SensitiveDataSink.Log],
    ["spans.", SensitiveDataSink.Span],
    ["sessions.", SensitiveDataSink.Session],
  ];

  function sinkOf(
    finding: RecordedTelemetryLeakFinding,
  ): SensitiveDataSink | undefined {
    if (finding.storeKind === DataStoreKind.TelemetrySessionReplays) {
      return SINK_OF_SESSION_REPLAY_PLACE.find(
        ([prefix]: [string, SensitiveDataSink]): boolean => {
          return finding.location.startsWith(prefix);
        },
      )?.[1];
    }

    return SINK_OF_STORE[finding.storeKind];
  }

  // The pull request that added the service's code: every file, every line.
  function addedFiles(evalCase: TelemetryLeakEvalCase): Array<EvalDiffFile> {
    return Object.entries(evalCase.files).map(
      ([path, text]: [string, string]): EvalDiffFile => {
        return addedFile(path, text.split("\n"));
      },
    );
  }

  // A point on a place's line, or a line of the call that starts there.
  function caughtAt(
    candidates: Array<SensitiveDataCandidate>,
    finding: RecordedTelemetryLeakFinding,
    place: { file: string; line: number },
  ): SensitiveDataCandidate | undefined {
    return candidates.find((candidate: SensitiveDataCandidate): boolean => {
      return (
        candidate.path === place.file &&
        candidate.line >= place.line &&
        candidate.line <= place.line + 3 &&
        candidate.checkId === finding.checkId &&
        candidate.sink !== undefined &&
        candidate.sink === sinkOf(finding)
      );
    });
  }

  test.each(
    TELEMETRY_LEAK_EVAL_SET.map(
      (evalCase: TelemetryLeakEvalCase): [string, TelemetryLeakEvalCase] => {
        return [evalCase.id, evalCase];
      },
    ),
  )("%s", (_id: string, evalCase: TelemetryLeakEvalCase) => {
    const result: SensitiveDataRulesResult = SensitiveDataRules.find({
      files: addedFiles(evalCase),
    });

    for (const finding of evalCase.findings) {
      const caught: Array<string> = finding.leadsTo
        .filter((place: { file: string; line: number }): boolean => {
          return Boolean(caughtAt(result.candidates, finding, place));
        })
        .map((place: { file: string; line: number }): string => {
          return `${place.file}:${place.line}`;
        });

      expect({
        finding: finding.findingId,
        isCaught: caught.length > 0,
      }).toEqual({ finding: finding.findingId, isCaught: true });
    }

    // Every place that writes it is a point, or counted past the review's limits.
    const writes: number = new Set<string>(
      evalCase.findings.flatMap(
        (finding: RecordedTelemetryLeakFinding): Array<string> => {
          return finding.leadsTo
            .filter((place: { file: string; line: number }): boolean => {
              // A metric's instrument is made on one line, and written on another.
              return !evalCase.files[place.file]
                ?.split("\n")
                [place.line - 1]?.includes("createCounter");
            })
            .map((place: { file: string; line: number }): string => {
              return `${place.file}:${place.line}`;
            });
        },
      ),
    ).size;

    expect(result.candidates.length + result.moreCount).toBeGreaterThanOrEqual(
      writes,
    );
  });

  test("a key in an exception's message: a secret, which can fail the check - the shape only the exceptions sink reads", () => {
    const evalCase: TelemetryLeakEvalCase = TELEMETRY_LEAK_EVAL_SET.find(
      (each: TelemetryLeakEvalCase): boolean => {
        return each.id === "api-key-in-an-exception-message";
      },
    )!;
    const result: SensitiveDataRulesResult = SensitiveDataRules.find({
      files: addedFiles(evalCase),
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      path: "src/payments.js",
      line: evalCase.findings[0]!.leadsTo[0]!.line,
      sink: SensitiveDataSink.Exception,
      checkId: "secrets-in-telemetry",
      subject: "apiKey",
      isBlocking: true,
      location: "message",
    });
  });

  function evalCaseOf(id: string): TelemetryLeakEvalCase {
    return TELEMETRY_LEAK_EVAL_SET.find(
      (each: TelemetryLeakEvalCase): boolean => {
        return each.id === id;
      },
    )!;
  }

  /*
   * A web application's front end (#11395): the two leaks Data Security
   * finds in a RUM application's session replays - a browser log's
   * attribute and a session identified by the customer's email - are a
   * Log point and a Session point on the very line, at the place the
   * session replays keep them.
   */
  test("a browser log's email: a Log point at the logger's line, under the key its browser log keeps it at", () => {
    const evalCase: TelemetryLeakEvalCase = evalCaseOf(
      "browser-log-email-found-through-a-source-map",
    );
    const finding: RecordedTelemetryLeakFinding = evalCase.findings[0]!;
    const result: SensitiveDataRulesResult = SensitiveDataRules.find({
      files: addedFiles(evalCase),
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      path: "src/checkout/payment.js",
      line: finding.leadsTo[0]!.line,
      sink: SensitiveDataSink.Log,
      checkId: "sensitive-data-in-telemetry",
      subject: "user.email",
      where: "logger.warn",
      isBlocking: false,
      location: "attributes.user.email",
    });
    // The browser log's attribute, as the session replay store's finding names it.
    expect(finding.location).toBe(`logs.${result.candidates[0]!.location}`);
  });

  test("a session identified by the customer's email: a Session point at the recorder's call, where the sessions keep their user", () => {
    const evalCase: TelemetryLeakEvalCase = evalCaseOf(
      "session-identified-by-the-customers-email",
    );
    const finding: RecordedTelemetryLeakFinding = evalCase.findings[0]!;
    const result: SensitiveDataRulesResult = SensitiveDataRules.find({
      files: addedFiles(evalCase),
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      path: "src/session.js",
      line: finding.leadsTo[0]!.line,
      sink: SensitiveDataSink.Session,
      checkId: "sensitive-data-in-telemetry",
      subject: "customer.email",
      where: "recorder.identify",
      isBlocking: false,
      location: finding.location,
      text: "Identifies a recorded session by an email address: `customer.email`, in `recorder.identify`.",
      fix: "Identify the session by an opaque id, such as the user's id, never by `customer.email`.",
    });
    // The recorder's own module, which only defines identify(), is no point.
    expect(
      result.candidates.filter((candidate: SensitiveDataCandidate): boolean => {
        return candidate.path === "src/recorder.js";
      }),
    ).toEqual([]);
  });

  /*
   * No false point: the fix a person would make - the case's solution,
   * which the code agent's benchmark checks - leaves the RUM cases with
   * none. The session is identified by the customer's id, and the browser
   * log keeps only the cart's total.
   */
  test.each([
    "browser-log-email-found-through-a-source-map",
    "session-identified-by-the-customers-email",
  ])("%s, fixed as a person would fix it, has no point", (id: string) => {
    const evalCase: TelemetryLeakEvalCase = evalCaseOf(id);

    expect(
      SensitiveDataRules.find({
        files: addedFiles({
          ...evalCase,
          files: { ...evalCase.files, ...evalCase.solution },
        }),
      }).candidates,
    ).toEqual([]);
  });
});
