import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * EVERY RUN OF THE ENGINE READS FOR ITS READERS (#9576, #9612). Each run of
 * the investigation engine writes where everyone who may see its subject
 * reads it: an incident's or an alert's report and the fixes worked out
 * for it, a security case's triage, an AI insight's triage. The engine
 * hands its tools the run's readers (InvestigationRequest.readAudience),
 * and a run handed none reads the whole project as OneUptime. So every
 * call of AIInvestigationEngine.executeRun in the server passes the
 * readers its runner worked out; a new runner fails here until it does.
 */

const SERVER: string = path.resolve(__dirname, "../../../../Server");

// The runners this suite knows, relative to Server/: the scan must find them.
const KNOWN_RUNNERS: Array<string> = [
  "Utils/AI/SRE/IncidentInvestigationRunner.ts",
  "Utils/AI/SRE/AlertInvestigationRunner.ts",
  "Utils/AI/Remediation/RemediationPlanRunner.ts",
  "Utils/AI/Remediation/RemediationExecutionRunner.ts",
  "Utils/AI/Remediation/McpRemediationRunner.ts",
  "Utils/AI/SRE/Insights/InsightTriageRunner.ts",
  "Utils/AI/Security/SecurityCaseTriageRunner.ts",
];

const CALL: string = "AIInvestigationEngine.executeRun(";

// A call's request names the readers it reads for.
const HANDS_READERS: RegExp = new RegExp("\\breadAudience\\b");

function typeScriptFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...typeScriptFiles(full));
    } else if (entry.name.endsWith(".ts")) {
      files.push(full);
    }
  }

  return files;
}

// The argument text of each call in `source`, up to its closing parenthesis.
function callArguments(source: string): Array<string> {
  const calls: Array<string> = [];
  let from: number = source.indexOf(CALL);

  while (from !== -1) {
    const lineStart: number = source.lastIndexOf("\n", from) + 1;
    const before: string = source.slice(lineStart, from).trim();

    // A comment that names the call is not one.
    if (!before.startsWith("*") && !before.startsWith("//")) {
      let depth: number = 1;
      let index: number = from + CALL.length;

      while (index < source.length && depth > 0) {
        if (source[index] === "(") {
          depth++;
        } else if (source[index] === ")") {
          depth--;
        }
        index++;
      }

      calls.push(source.slice(from + CALL.length, index - 1));
    }

    from = source.indexOf(CALL, from + CALL.length);
  }

  return calls;
}

const callers: Map<string, Array<string>> = new Map<string, Array<string>>();

for (const file of typeScriptFiles(SERVER)) {
  const calls: Array<string> = callArguments(fs.readFileSync(file, "utf8"));

  if (calls.length > 0) {
    callers.set(path.relative(SERVER, file).split(path.sep).join("/"), calls);
  }
}

describe("every run of the engine reads for its readers", () => {
  test("the scan finds every runner it knows", () => {
    expect(
      KNOWN_RUNNERS.filter((runner: string): boolean => {
        return !callers.has(runner);
      }),
    ).toEqual([]);
  });

  test.each(Array.from(callers.keys()))(
    "%s hands the engine the readers it worked out",
    (file: string) => {
      const calls: Array<string> = callers.get(file)!;

      expect({
        file,
        callsWithoutReaders: calls.filter((call: string): boolean => {
          return !HANDS_READERS.test(call);
        }).length,
      }).toEqual({ file, callsWithoutReaders: 0 });
    },
  );
});
