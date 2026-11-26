/*
 * ---------------------------------------------------------------------------
 * The reviewer-facing copy at the bottom of every AI pull request body.
 *
 * Fix PRs now open READY FOR REVIEW rather than as drafts, which makes one
 * sentence in every recipe's PR body a lie and an impossible instruction:
 * "opened as a draft … then mark the pull request ready for review". The PR
 * already is; there is no button left to press.
 *
 * The rest of that sentence was never about the draft flag and must survive
 * the change intact — a human reviews this diff, and nothing merges by
 * itself. Dropping it while removing the word "draft" would turn a
 * copy cleanup into a quiet weakening of the review posture, which is exactly
 * the mistake these tests exist to catch.
 *
 * Every recipe is covered, because the sentence is duplicated per handler
 * rather than shared — one missed handler keeps shipping the stale
 * instruction on real pull requests.
 * ---------------------------------------------------------------------------
 */

import ExceptionPullRequestTaskHandler from "../../TaskHandlers/ExceptionPullRequestTaskHandler";
import FixExceptionTaskHandler from "../../TaskHandlers/FixExceptionTaskHandler";
import FixFromIncidentTaskHandler from "../../TaskHandlers/FixFromIncidentTaskHandler";
import FixInfrastructureCodeTaskHandler from "../../TaskHandlers/FixInfrastructureCodeTaskHandler";
import FixPerformanceTaskHandler from "../../TaskHandlers/FixPerformanceTaskHandler";
import FixSensitiveDataInTelemetryTaskHandler from "../../TaskHandlers/FixSensitiveDataInTelemetryTaskHandler";
import ImproveExceptionHandlingTaskHandler from "../../TaskHandlers/ImproveExceptionHandlingTaskHandler";
import ImproveInstrumentationTaskHandler from "../../TaskHandlers/ImproveInstrumentationTaskHandler";
import ImproveLoggingTaskHandler from "../../TaskHandlers/ImproveLoggingTaskHandler";
import ImproveTracingTaskHandler from "../../TaskHandlers/ImproveTracingTaskHandler";
import SubjectPullRequestTaskHandler from "../../TaskHandlers/SubjectPullRequestTaskHandler";
import WriteRegressionTestTaskHandler from "../../TaskHandlers/WriteRegressionTestTaskHandler";
import PullRequestCreator from "../../Utils/PullRequestCreator";
import { ExceptionDetails, SubjectTaskDetails } from "../../Utils/BackendAPI";
import {
  TelemetryLeakFixStrategy,
  TelemetryLeakHandling,
  TelemetryLeakSignal,
} from "Common/Types/DataSecurity/TelemetryLeakFix";
import fs from "fs";
import path from "path";

const AGENT_SUMMARY: string =
  "Added a null guard before reading cart.id and a regression test.";

const exceptionDetails: ExceptionDetails = {
  exception: {
    id: "exception-id",
    message: "TypeError: cannot read property 'id' of undefined",
    stackTrace: "at Checkout.process (src/checkout.ts:42:11)",
    exceptionType: "TypeError",
    fingerprint: "fingerprint",
  },
  service: {
    id: "service-id",
    name: "checkout",
    description: "",
  },
};

const subjectDetails: SubjectTaskDetails = {
  subjectType: "incident",
  subjectTitle: "Checkout latency spike",
  analysisMarkdown: "## Analysis\n\nThe cart lookup is unbatched.",
  serviceName: "checkout",
  subjectIsPrivate: false,
  repositories: [],
  resolutionError: null,
  traceId: null,
  performanceFindings: [],
  spanSummaries: [],
};

/*
 * The Data Security recipes write their body from a context of their own,
 * which the task's record carries. Each is given every part its body can
 * show - a cause, its code, issue links, a secret to rotate - so every line
 * a reviewer could read is held to the assertions below.
 */
const infrastructureFixDetails: SubjectTaskDetails = {
  ...subjectDetails,
  subjectType: "infrastructure",
  subjectTitle: "Turn on access logging in the static-site module",
  analysisMarkdown: "Change the module's setting so every store passes.",
  serviceName: null,
  infrastructureFix: {
    groupId: "group-id",
    checkId: "access-not-logged",
    title: "Turn on access logging in the static-site module",
    cause: "the static-site module",
    request: "Change the module's setting so every store passes.",
    codeKind: "Terraform",
    paths: ["modules/static-site/main.tf"],
    stores: [
      {
        name: "site-assets",
        kind: "AWS S3 Bucket",
        region: "eu-west-1",
        issueId: "issue-id",
        issueUrl:
          "https://oneuptime.example/dashboard/p/data-security/issues/issue-id",
      },
      {
        name: "docs-assets",
        kind: "AWS S3 Bucket",
        region: "eu-west-1",
        issueId: "second-issue-id",
        issueUrl:
          "https://oneuptime.example/dashboard/p/data-security/issues/second-issue-id",
      },
    ],
    storeCount: 2,
    issuesUrl: "https://oneuptime.example/dashboard/p/data-security/issues",
  },
};

const telemetryLeakFixDetails: SubjectTaskDetails = {
  ...subjectDetails,
  subjectType: "service",
  subjectTitle: "Stop checkout writing sensitive data to its telemetry",
  analysisMarkdown:
    'Stop the service "checkout" writing sensitive data to its telemetry.',
  telemetryLeakFix: {
    serviceId: "service-id",
    serviceName: "checkout",
    title: "Stop checkout writing sensitive data to its telemetry",
    request:
      'Stop the service "checkout" writing sensitive data to its telemetry.',
    strategy: TelemetryLeakFixStrategy.CallSites,
    placeCount: 1,
    leaks: [
      {
        issueId: "issue-id",
        dataStoreId: "data-store-id",
        checkId: "sensitive-data-in-telemetry",
        signal: TelemetryLeakSignal.Spans,
        dataTypeId: "api-key",
        dataTypeName: "API key",
        isSecret: true,
        location: "attributes.payment.api_key",
        key: "payment.api_key",
        isMaskedByScrubRule: false,
        handling: TelemetryLeakHandling.CallSite,
        places: [
          {
            filePath: "src/checkout.ts",
            lineNumber: 42,
            functionName: "process",
            recordCount: 3,
          },
        ],
      },
    ],
    issues: [
      {
        issueId: "issue-id",
        title: "Sensitive data is reaching your telemetry",
        checkId: "sensitive-data-in-telemetry",
        signal: TelemetryLeakSignal.Spans,
        issueUrl:
          "https://oneuptime.example/dashboard/p/data-security/issues/issue-id",
      },
    ],
    redactionKeys: [],
    redactionDataTypes: [],
    startFiles: ["src/checkout.ts"],
    hasSecrets: true,
    issuesUrl: "https://oneuptime.example/dashboard/p/data-security/issues",
  },
};

/*
 * buildPullRequestBody is `protected` — it is an extension point for the
 * recipes, not part of the public handler surface. These are the typed seams
 * for reading it back without widening the real classes.
 */
interface ExceptionBodySeam {
  buildPullRequestBody: (
    details: ExceptionDetails,
    agentSummary: string,
  ) => string;
}

interface SubjectBodySeam {
  buildPullRequestBody: (
    details: SubjectTaskDetails,
    agentSummary: string,
  ) => string;
}

function exceptionBody(handler: ExceptionPullRequestTaskHandler): string {
  return (handler as unknown as ExceptionBodySeam).buildPullRequestBody(
    exceptionDetails,
    AGENT_SUMMARY,
  );
}

function subjectBody(
  handler: SubjectPullRequestTaskHandler,
  details: SubjectTaskDetails = subjectDetails,
): string {
  return (handler as unknown as SubjectBodySeam).buildPullRequestBody(
    details,
    AGENT_SUMMARY,
  );
}

// Every PR body the Runner can produce, by the recipe that produces it.
const BODIES: Array<{ recipe: string; body: string }> = [
  {
    recipe: "FixException",
    body: exceptionBody(new FixExceptionTaskHandler()),
  },
  {
    recipe: "ImproveExceptionHandling",
    body: exceptionBody(new ImproveExceptionHandlingTaskHandler()),
  },
  {
    recipe: "WriteRegressionTest",
    body: exceptionBody(new WriteRegressionTestTaskHandler()),
  },
  {
    recipe: "FixFromIncident",
    body: subjectBody(new FixFromIncidentTaskHandler()),
  },
  {
    recipe: "FixPerformance",
    body: subjectBody(new FixPerformanceTaskHandler()),
  },
  {
    recipe: "ImproveInstrumentation",
    body: subjectBody(new ImproveInstrumentationTaskHandler()),
  },
  {
    recipe: "ImproveLogging",
    body: subjectBody(new ImproveLoggingTaskHandler()),
  },
  {
    recipe: "ImproveTracing",
    body: subjectBody(new ImproveTracingTaskHandler()),
  },
  {
    recipe: "FixInfrastructureCode",
    body: subjectBody(
      new FixInfrastructureCodeTaskHandler(),
      infrastructureFixDetails,
    ),
  },
  {
    recipe: "FixSensitiveDataInTelemetry",
    body: subjectBody(
      new FixSensitiveDataInTelemetryTaskHandler(),
      telemetryLeakFixDetails,
    ),
  },
  {
    recipe: "PullRequestCreator.generatePRBody",
    body: PullRequestCreator.generatePRBody({
      exceptionMessage: exceptionDetails.exception.message,
      exceptionType: exceptionDetails.exception.exceptionType,
      stackTrace: exceptionDetails.exception.stackTrace,
      serviceName: exceptionDetails.service?.name || "checkout",
      summary: AGENT_SUMMARY,
    }),
  },
];

describe("every AI pull request body", () => {
  test("covers every recipe that builds one", () => {
    /*
     * A tripwire, not a tautology: a new recipe added without a row here
     * would silently escape every assertion below.
     */
    const handlerFiles: Array<string> = fs
      .readdirSync(path.join(__dirname, "..", "..", "TaskHandlers"))
      .filter((file: string) => {
        return file.endsWith("TaskHandler.ts");
      });

    const buildsItsOwnBody: Array<string> = handlerFiles.filter(
      (file: string) => {
        const source: string = fs.readFileSync(
          path.join(__dirname, "..", "..", "TaskHandlers", file),
          "utf8",
        );

        // The abstract declaration in the two base classes does not count.
        return source.includes("protected buildPullRequestBody(");
      },
    );

    expect(BODIES).toHaveLength(buildsItsOwnBody.length + 1);
  });

  describe.each(BODIES)("$recipe", ({ body }: { body: string }) => {
    test("does not claim the pull request is a draft", () => {
      expect(body.toLowerCase()).not.toContain("draft");
    });

    /*
     * The instruction that went stale. The PR is already ready for review, so
     * telling a reviewer to make it ready sends them looking for a button
     * GitHub does not show on a non-draft PR.
     */
    test("does not tell the reviewer to mark it ready for review", () => {
      expect(body.toLowerCase()).not.toContain("mark the pull request ready");
      expect(body.toLowerCase()).not.toContain("mark it ready for review");
    });

    // The half that was never about the draft flag, and must not be lost.
    test("still states that nothing is merged automatically", () => {
      expect(body.toLowerCase()).toContain("nothing is merged automatically");
    });

    test("still asks for human review before merging", () => {
      expect(body.toLowerCase()).toContain("review");
      expect(body.toLowerCase()).toContain("merging");
    });

    test("still says the change came from OneUptime AI", () => {
      expect(body).toContain("OneUptime AI");
    });

    test("still carries the agent's own summary of what it changed", () => {
      expect(body).toContain(AGENT_SUMMARY);
    });
  });
});

/*
 * A source-level backstop for the copy that is duplicated per recipe. The
 * per-handler tests above only see the handlers listed in BODIES; this one
 * sees every line the Runner could ever put in front of a reviewer, including
 * handlers added tomorrow.
 */
describe("Runner source copy", () => {
  const STALE_PHRASES: Array<string> = [
    "opened as a draft",
    "opens as a draft",
    "mark the pull request ready for review",
    "mark it ready for review",
    "it is opened as a draft",
  ];

  function sourceFiles(...directories: Array<string>): Array<string> {
    return directories.flatMap((directory: string) => {
      const absolute: string = path.join(__dirname, "..", "..", directory);

      return fs
        .readdirSync(absolute)
        .filter((file: string) => {
          return file.endsWith(".ts");
        })
        .map((file: string) => {
          return path.join(absolute, file);
        });
    });
  }

  test.each(STALE_PHRASES)(
    "no handler or util still says %p",
    (phrase: string) => {
      const offenders: Array<string> = sourceFiles(
        "TaskHandlers",
        "Utils",
      ).filter((file: string) => {
        return fs.readFileSync(file, "utf8").toLowerCase().includes(phrase);
      });

      expect(offenders).toEqual([]);
    },
  );
});
