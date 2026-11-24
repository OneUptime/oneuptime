import { describe, expect, test } from "@jest/globals";
import { isDataSecurityAiCodeRequest } from "../../../../../../Server/Utils/AI/DataSecurity/DataSecurityAiInput";
import {
  LocatedTelemetryLeakEvalCase,
  RecordedTelemetryLeakFinding,
  TELEMETRY_LEAK_EVAL_SET,
  TelemetryLeakEvalCase,
  buildTelemetryLeakEvalRequest,
  fakeStripeLiveKey,
  findPlaceInFiles,
  locateTelemetryLeakEvalCase,
} from "../../../../../../Server/Utils/AI/Eval/DataSecurity/TelemetryLeakEvalSet";
import { DataStoreKind } from "../../../../../../Types/DataSecurity/DataStoreKind";
import {
  MAX_CALL_SITE_PLACES,
  TelemetryLeakFixLeak,
  TelemetryLeakFixStrategy,
  TelemetryLeakPlace,
} from "../../../../../../Types/DataSecurity/TelemetryLeakFix";
import { DataSecurityTelemetryFixRepositoryChoice } from "../../../../../../Types/DataSecurity/DataSecurityApiTypes";

/*
 * THE EVAL SET OF RECORDED TELEMETRY LEAKS, EACH WITH THE FILE AND LINE IT
 * SHOULD LEAD TO (#10367) - THE LOCATOR'S OWN SUITE.
 *
 * Each case's records, read as the product reads them, placed in the
 * case's repository by the product's own chooser and decided, lead to the
 * file and line each finding should lead to: by the file and line the
 * records name, or - where they name none - by what the agent searches
 * for, a template's words, a metric's name, the key. None of the values
 * the records hold reaches the request the builder makes, and each case
 * is decided the way it should be: a few places fixed where they are
 * written, twenty with one redaction step.
 */

const CASES: Array<[string, TelemetryLeakEvalCase]> =
  TELEMETRY_LEAK_EVAL_SET.map(
    (testCase: TelemetryLeakEvalCase): [string, TelemetryLeakEvalCase] => {
      return [testCase.id, testCase];
    },
  );

// Where each leak of a located case leads, the first place that finds a line.
function leadsOf(
  located: LocatedTelemetryLeakEvalCase,
  testCase: TelemetryLeakEvalCase,
): Map<string, Array<{ file: string; line: number }>> {
  const leads: Map<string, Array<{ file: string; line: number }>> = new Map();

  for (const leak of located.decision.leaks) {
    const found: Array<{ file: string; line: number }> = [];

    for (const place of leak.places) {
      const at: { file: string; line: number } | null = findPlaceInFiles({
        place,
        key: leak.key,
        files: testCase.files,
      });

      if (at) {
        found.push(at);
      }
    }

    if (found.length === 0) {
      // A leak whose records name nothing is looked for by its key.
      const byKey: { file: string; line: number } | null = findPlaceInFiles({
        place: { recordCount: 0 },
        key: leak.key,
        files: testCase.files,
      });

      if (byKey) {
        found.push(byKey);
      }
    }

    leads.set(leak.findingId || "", found);
  }

  return leads;
}

describe("the set", () => {
  test("holds the issue's two scenarios, a secret in an exception, a metric and a log line with no code location", () => {
    expect(
      TELEMETRY_LEAK_EVAL_SET.map((testCase: TelemetryLeakEvalCase) => {
        return testCase.id;
      }),
    ).toEqual(
      expect.arrayContaining([
        "user-email-on-a-span-and-in-a-log-line",
        "customer-email-in-twenty-places",
        "api-key-in-an-exception-message",
        "user-email-on-a-metric",
        "email-in-a-log-line-with-no-code-location",
      ]),
    );
  });

  test("covers every signal a service's leaks are found in that its records name a place by", () => {
    const kinds: Set<DataStoreKind> = new Set(
      TELEMETRY_LEAK_EVAL_SET.flatMap((testCase: TelemetryLeakEvalCase) => {
        return testCase.findings.map(
          (finding: RecordedTelemetryLeakFinding): DataStoreKind => {
            return finding.storeKind;
          },
        );
      }),
    );

    for (const kind of [
      DataStoreKind.TelemetryTraces,
      DataStoreKind.TelemetryLogs,
      DataStoreKind.TelemetryExceptions,
      DataStoreKind.TelemetryMetrics,
    ]) {
      expect(kinds.has(kind)).toBe(true);
    }
  });

  test("writes no secret whole: the key is put together where it is used", () => {
    expect(fakeStripeLiveKey().startsWith("sk_live_")).toBe(true);
    expect(JSON.stringify(TELEMETRY_LEAK_EVAL_SET)).toContain(
      fakeStripeLiveKey(),
    );
  });
});

describe.each(CASES)("%s", (_id: string, testCase: TelemetryLeakEvalCase) => {
  test("its records lead to the file and line each finding should lead to", async () => {
    const located: LocatedTelemetryLeakEvalCase =
      await locateTelemetryLeakEvalCase(testCase);
    const leads: Map<string, Array<{ file: string; line: number }>> = leadsOf(
      located,
      testCase,
    );

    for (const finding of testCase.findings) {
      const found: Array<{ file: string; line: number }> =
        leads.get(finding.findingId) || [];

      expect({ finding: finding.findingId, found: found.length > 0 }).toEqual({
        finding: finding.findingId,
        found: true,
      });
      // Its first lead is one of the places that writes it.
      expect(finding.leadsTo).toContainEqual(found[0]);
    }
  });

  test("is placed in its repository, and decided as it should be", async () => {
    const located: LocatedTelemetryLeakEvalCase =
      await locateTelemetryLeakEvalCase(testCase);

    expect(located.group.repository).not.toBeNull();
    expect([
      DataSecurityTelemetryFixRepositoryChoice.StackTrace,
      DataSecurityTelemetryFixRepositoryChoice.NameMatch,
      DataSecurityTelemetryFixRepositoryChoice.OnlyRepository,
    ]).toContain(located.group.choice);
    expect(located.decision.strategy).toBe(testCase.expectStrategy);
    expect(located.decision.leaks).toHaveLength(testCase.findings.length);
  });

  test("none of the values its records hold reaches the request, which the builder made", async () => {
    const located: LocatedTelemetryLeakEvalCase =
      await locateTelemetryLeakEvalCase(testCase);
    const sent: Array<string> = [
      located.request.text,
      buildTelemetryLeakEvalRequest(testCase).text,
      JSON.stringify(located.decision.leaks),
    ];

    expect(isDataSecurityAiCodeRequest(located.request)).toBe(true);

    for (const finding of testCase.findings) {
      for (const value of finding.values) {
        for (const text of sent) {
          expect({ value, sent: text.includes(value) }).toEqual({
            value,
            sent: false,
          });
        }
      }
    }
  });

  test("the request names each file its records name, as the repository holds it", async () => {
    const located: LocatedTelemetryLeakEvalCase =
      await locateTelemetryLeakEvalCase(testCase);

    for (const leak of located.decision.leaks) {
      for (const place of leak.places) {
        if (place.filePath) {
          expect(Object.keys(testCase.files)).toContain(place.filePath);
          expect(located.request.text).toContain(place.filePath);
        }
      }
    }
  });
});

describe("the issue's two scenarios", () => {
  function caseOf(id: string): TelemetryLeakEvalCase {
    return TELEMETRY_LEAK_EVAL_SET.find(
      (testCase: TelemetryLeakEvalCase): boolean => {
        return testCase.id === id;
      },
    )!;
  }

  test("a span's and a log line's user.email: one request, both leaks, each fixed where it is written", async () => {
    const located: LocatedTelemetryLeakEvalCase =
      await locateTelemetryLeakEvalCase(
        caseOf("user-email-on-a-span-and-in-a-log-line"),
      );

    expect(located.decision.strategy).toBe(TelemetryLeakFixStrategy.CallSites);
    expect(
      located.decision.leaks.map((leak: TelemetryLeakFixLeak) => {
        return leak.issueId;
      }),
    ).toEqual([
      "15000000-0000-4000-8000-000000000101",
      "15000000-0000-4000-8000-000000000102",
    ]);
    expect(located.startFiles).toEqual(["src/signup.js"]);

    // The log line is handed as its template, never as it was logged.
    const templates: Array<string> = located.decision.leaks.flatMap(
      (leak: TelemetryLeakFixLeak) => {
        return leak.places
          .map((place: TelemetryLeakPlace): string => {
            return place.template || "";
          })
          .filter(Boolean);
      },
    );

    expect(templates).toEqual(["User <Email address> signed up"]);
  });

  test("customer.email in twenty places: one redaction step for its key, not twenty edits", async () => {
    const located: LocatedTelemetryLeakEvalCase =
      await locateTelemetryLeakEvalCase(
        caseOf("customer-email-in-twenty-places"),
      );

    expect(located.decision.strategy).toBe(
      TelemetryLeakFixStrategy.RedactionStep,
    );
    // Each leak's first few places are read: more than a handful either way.
    expect(located.decision.placeCount).toBeGreaterThan(MAX_CALL_SITE_PLACES);
    expect(located.decision.redactionKeys).toEqual(["customer.email"]);
    expect(located.request.text).toContain("redaction step");
  });
});

describe("a template's words, looked for in a repository's files", () => {
  const FILES: Record<string, string> = {
    "src/signup.ts": [
      "logger.info(`(beta) signed up: ${user.email} at ${now}`);",
      'logger.info("User " + user.email + " signed up");',
    ].join("\n"),
  };

  function lineOf(template: string): number | null {
    return (
      findPlaceInFiles({
        place: { template, recordCount: 1 },
        files: FILES,
      })?.line || null
    );
  }

  test("finds the line holding its words in order, with anything between them", () => {
    expect(lineOf("User <Email address> signed up")).toBe(2);
  });

  test("reads each word as written, never as a pattern", () => {
    // "(beta)" and "up:" hold a pattern's characters; they are read as text.
    expect(lineOf("(beta) signed up: <Email address> at <Date>")).toBe(1);
  });

  test("finds nothing for the same words out of order", () => {
    expect(lineOf("signed up <Email address> User")).toBeNull();
  });
});
