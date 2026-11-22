import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import SecurityCaseFeed from "../../../../Models/DatabaseModels/SecurityCaseFeed";
import { getStepCheck } from "../../../../Server/Utils/SecurityCase/StepChecks/StepCheckRegistry";
import {
  getResponseStepKey,
  hashText,
  RESPONSE_STEP_KINDS,
} from "../../../../Utils/SecurityCase/ResponsePlan/ResponsePlanKeys";

/*
 * A RUN THAT WEIGHS ONLY ITS SUBJECT'S READERS POSTS NOWHERE ELSE (#9632).
 *
 * ReadAudienceReader.forSubject's postsOnlyWhereTheSubjectIsRead leaves out
 * the owner and label narrowing that reaches nobody who may read the
 * subject: a security case's triage no longer leaves out every host a team
 * that may not read cases is narrowed on. That is safe only while what the
 * run writes is read where the subject is read, by whoever may read it
 * there (ReadAudienceReader.getSubjectReadingPermissions), and nowhere else.
 * This suite holds each premise of it:
 *
 *   - only the runs weighed here say so: a security case's triage;
 *   - the triage writes on the case and its timeline, and tells nobody: it
 *     calls no notice, channel, mail or webhook;
 *   - its report is read on the server only where the case is read - the
 *     case's AI card, served to whoever may read the case - and by the
 *     case's Response Plan, whose steps from the report no step check reads,
 *     so OneUptime never tells anybody about them. No AI tool and no other
 *     run reads it, so no run posts it again for other readers;
 *   - no relation reads the report: only who may read the case does;
 *   - the case's timeline is read only by who may read the case, and the
 *     server reads none of it itself.
 *
 * A change that breaks one fails here until it is weighed: a runner that
 * posts somewhere else counts every row (it drops the option), or
 * getSubjectReadingPermissions names the readers of the new place.
 */

const PACKAGES: string = path.resolve(__dirname, "..", "..", "..", "..", "..");
const SERVER: string = path.join(PACKAGES, "Common", "Server");
const APP_FEATURE_SETS: string = path.join(PACKAGES, "App", "FeatureSet");

const OPTION: string = "postsOnlyWhereTheSubjectIsRead";

// The runs that weigh only their subject's readers, relative to Server/, and why they may.
const RUNS_POSTED_ONLY_ON_THEIR_SUBJECT: Record<string, string> = {
  "Utils/AI/Security/SecurityCaseTriageRunner.ts":
    "a security case's triage: written on the case and its timeline, read by whoever may read the case there, in the audit log, and nowhere else (the rest of this suite).",
};

// Where the triage's report is read on the server, relative to Server/, and why it stays with the case's readers.
const TRIAGE_REPORT_READERS: Record<string, string> = {
  "Utils/AI/Security/SecurityCaseTriageRunner.ts":
    "writes it, on the case (recordTriage).",
  "Utils/AI/Security/SecurityCaseTriageStatus.ts":
    "the case's AI card, which SecurityCaseAPI serves only to whoever may read the case.",
  "Utils/SecurityCase/StepChecks/SecurityCaseStepCheckRunner.ts":
    "builds the case's Response Plan, whose steps from the report are of a kind no step check reads (below): OneUptime never tells anybody about them.",
  "Infrastructure/Postgres/SchemaMigrations/1805980000000-AddSecurityCaseAiTriage.ts":
    "adds the column.",
};

/*
 * What the triage runner may call on a service, a queue, a launcher or
 * anything that tells people - by Name.method - and why it posts the triage
 * nowhere else.
 */
const TRIAGE_RUNNER_CALLS: Record<string, string> = {
  "SecurityCaseService.updateOneById":
    "the verdict, suggestions and report, on the case.",
  "SecurityCaseFeedService.createSecurityCaseFeedItem":
    "the AI Triage entry, on the case's timeline.",
  "SecurityDetectionService.findBy":
    "reads the case's detections for its playbooks.",
  "AIInvestigationQueue.failOrRequeue":
    "the run's own state, when its context cannot be built: no part of a report.",
  "SecurityPlaybookLauncher.launchForCase":
    "starts the playbooks a Likely Malicious read calls for, with the case's detections: no part of the report.",
};

// A call that writes, queues, starts or tells: the names a runner reaches people or other runs through.
const WRITES_OR_TELLS: RegExp =
  /^(?:\w*Service|\w*Notifications?|\w*Workspace\w*|\w*Mail\w*|\w*Slack\w*|\w*MicrosoftTeams\w*|\w*Webhook\w*|\w*Sms\w*|\w*Queue|\w*Launcher|\w*Engine)$/;

const TYPESCRIPT_FILE: RegExp = /\.tsx?$/;

function typeScriptFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== "build") {
        files.push(...typeScriptFiles(full));
      }
    } else if (TYPESCRIPT_FILE.test(entry.name)) {
      files.push(full);
    }
  }

  return files;
}

// A source's lines that are code, not comments.
function codeLines(source: string): Array<string> {
  return source.split("\n").filter((line: string): boolean => {
    const trimmed: string = line.trim();
    return (
      !trimmed.startsWith("*") &&
      !trimmed.startsWith("//") &&
      !trimmed.startsWith("/*")
    );
  });
}

// The files under `root` whose code names `text`, relative to `root`.
function filesNaming(root: string, text: string): Array<string> {
  return typeScriptFiles(root)
    .filter((file: string): boolean => {
      return codeLines(fs.readFileSync(file, "utf8")).some(
        (line: string): boolean => {
          return line.includes(text);
        },
      );
    })
    .map((file: string): string => {
      return path.relative(root, file).split(path.sep).join("/");
    })
    .sort();
}

const TRIAGE_RUNNER: string = fs.readFileSync(
  path.join(SERVER, "Utils/AI/Security/SecurityCaseTriageRunner.ts"),
  "utf8",
);

describe("a run that weighs only its subject's readers posts nowhere else (#9632)", () => {
  test("only the runs weighed here say they post only where their subject is read", () => {
    expect(
      filesNaming(SERVER, OPTION).filter((file: string): boolean => {
        return file !== "Utils/ReadAudience/ReadAudienceReader.ts";
      }),
    ).toEqual(Object.keys(RUNS_POSTED_ONLY_ON_THEIR_SUBJECT).sort());
  });

  test("a security case's triage says so", () => {
    expect(TRIAGE_RUNNER).toContain(`{ ${OPTION}: true }`);
  });

  test("the triage writes on the case and its timeline, and tells nobody", () => {
    const calls: Set<string> = new Set<string>();
    const call: RegExp = /(?<![\w.])([A-Z]\w*)\.(\w+)\(/g;

    for (const line of codeLines(TRIAGE_RUNNER)) {
      for (const match of line.matchAll(call)) {
        if (WRITES_OR_TELLS.test(match[1]!)) {
          calls.add(`${match[1]}.${match[2]}`);
        }
      }
    }

    // The engine runs the triage; what it posts goes through the runner's postAnalysis.
    calls.delete("AIInvestigationEngine.executeRun");

    expect(Array.from(calls).sort()).toEqual(
      Object.keys(TRIAGE_RUNNER_CALLS).sort(),
    );
  });

  test("the triage's report is read on the server only where the case is read", () => {
    expect(filesNaming(SERVER, "aiTriageReport")).toEqual(
      Object.keys(TRIAGE_REPORT_READERS).sort(),
    );
  });

  test("in the app, only the Dashboard reads the report: through the API, as whoever may read the case", () => {
    expect(
      filesNaming(APP_FEATURE_SETS, "aiTriageReport").filter(
        (file: string): boolean => {
          return !file.startsWith("Dashboard/src/");
        },
      ),
    ).toEqual([]);
  });

  test("the Response Plan's steps from the report are of a kind no step check reads, so nobody is told about them", () => {
    expect(
      getStepCheck(
        getResponseStepKey(RESPONSE_STEP_KINDS.ai, hashText("isolate web-1")),
      ),
    ).toBe(null);
  });

  test("no relation reads the report: only who may read the case does", () => {
    const report: { canReadOnRelationQuery?: boolean | undefined } =
      new SecurityCase().getTableColumnMetadata("aiTriageReport") as {
        canReadOnRelationQuery?: boolean | undefined;
      };

    expect(Boolean(report.canReadOnRelationQuery)).toBe(false);
  });

  test("the case's timeline is read only by who may read the case, and the server reads none of it itself", () => {
    expect(
      (new SecurityCaseFeed() as unknown as { canAccessIfCanReadOn?: string })
        .canAccessIfCanReadOn,
    ).toBe("securityCase");
    expect(filesNaming(SERVER, "SecurityCaseFeedService.find")).toEqual([]);
    expect(filesNaming(SERVER, "SecurityCaseFeedService.count")).toEqual([]);
  });

  test("every place weighed still names what it was weighed for, so the lists never outlive their reasons", () => {
    for (const file of Object.keys(TRIAGE_REPORT_READERS)) {
      expect(fs.readFileSync(path.join(SERVER, file), "utf8")).toContain(
        "aiTriageReport",
      );
    }

    for (const file of Object.keys(RUNS_POSTED_ONLY_ON_THEIR_SUBJECT)) {
      expect(fs.readFileSync(path.join(SERVER, file), "utf8")).toContain(
        OPTION,
      );
    }
  });
});
