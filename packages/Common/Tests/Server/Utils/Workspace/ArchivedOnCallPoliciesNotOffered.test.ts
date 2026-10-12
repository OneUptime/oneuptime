import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * An archived on-call policy pages no one, so Slack and Microsoft Teams must
 * not offer it. Every "Execute on-call policy" picker - on an incident, an
 * alert, an incident episode and an alert episode, in both apps - reads the
 * project's policies the member may read (WorkspaceActionAuthorization
 * .findReadable with OnCallDutyPolicyService), and the Teams card choices
 * count them for "showing N of M" (countReadable). Each of those reads must
 * leave archived policies out; one that forgot would offer a policy that,
 * when picked, records "Not executed: archived" instead of paging.
 *
 * This guard reads the workspace sources and checks every such read. New
 * pickers are covered automatically: any list or count of on-call policies
 * under Server/Utils/Workspace - OnCallDutyPolicyService.findBy / countBy,
 * or findReadable / countReadable over OnCallDutyPolicyService - must carry
 * `isArchived: false`.
 */

const WORKSPACE_DIR: string = path.resolve(
  __dirname,
  "../../../../Server/Utils/Workspace",
);

const LIST_CALL: RegExp =
  /(?:OnCallDutyPolicyService\.(findBy|countBy)|WorkspaceActionAuthorization\.(findReadable|countReadable))\(/g;

// A findReadable / countReadable call reads on-call policies when it names their service.
const READS_POLICIES: RegExp = /service:\s*OnCallDutyPolicyService\b/;

const LEAVES_ARCHIVED_OUT: RegExp = /isArchived:\s*false/;

function walk(directory: string): Array<string> {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry: fs.Dirent): Array<string> => {
      const full: string = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        return walk(full);
      }

      return entry.name.endsWith(".ts") ? [full] : [];
    });
}

// The full argument list of the call that opens at `start` (its "(").
function callArguments(source: string, start: number): string {
  let depth: number = 0;

  for (let index: number = start; index < source.length; index++) {
    const char: string = source[index]!;

    if (char === "(") {
      depth++;
    } else if (char === ")") {
      depth--;

      if (depth === 0) {
        return source.slice(start, index + 1);
      }
    }
  }

  throw new Error("Unbalanced call - the guard could not read it.");
}

interface PolicyListCall {
  file: string;
  line: number;
  method: string;
  args: string;
}

function policyListCalls(): Array<PolicyListCall> {
  const calls: Array<PolicyListCall> = [];

  for (const file of walk(WORKSPACE_DIR)) {
    const source: string = fs.readFileSync(file, "utf8");

    for (const match of source.matchAll(LIST_CALL)) {
      const open: number = match.index! + match[0].length - 1;
      const args: string = callArguments(source, open);
      const readMethod: string | undefined = match[2];

      // A member's read of some other list (monitors, labels, ...).
      if (readMethod && !READS_POLICIES.test(args)) {
        continue;
      }

      calls.push({
        file: path.relative(WORKSPACE_DIR, file),
        line: source.slice(0, match.index).split("\n").length,
        // findReadable lists, countReadable counts.
        method:
          match[1] || (readMethod === "countReadable" ? "countBy" : "findBy"),
        args: args,
      });
    }
  }

  return calls;
}

describe("Slack and Microsoft Teams do not offer archived on-call policies", () => {
  const calls: Array<PolicyListCall> = policyListCalls();

  test("the guard finds every picker: four Slack, four Teams, and the Teams choice list and its count", () => {
    const files: Array<string> = calls.map((call: PolicyListCall): string => {
      return call.file;
    });

    expect(calls.length).toBeGreaterThanOrEqual(11);

    for (const expected of [
      path.join("Slack", "Actions", "Incident.ts"),
      path.join("Slack", "Actions", "Alert.ts"),
      path.join("Slack", "Actions", "IncidentEpisode.ts"),
      path.join("Slack", "Actions", "AlertEpisode.ts"),
      path.join("MicrosoftTeams", "Actions", "Incident.ts"),
      path.join("MicrosoftTeams", "Actions", "Alert.ts"),
      path.join("MicrosoftTeams", "Actions", "IncidentEpisode.ts"),
      path.join("MicrosoftTeams", "Actions", "AlertEpisode.ts"),
      path.join("MicrosoftTeams", "MicrosoftTeamsCardChoices.ts"),
    ]) {
      expect(files).toContain(expected);
    }

    expect(
      calls.some((call: PolicyListCall): boolean => {
        return call.method === "countBy";
      }),
    ).toBe(true);
  });

  test("every list and count of on-call policies leaves archived ones out", () => {
    const missing: Array<string> = calls
      .filter((call: PolicyListCall): boolean => {
        return !LEAVES_ARCHIVED_OUT.test(call.args);
      })
      .map((call: PolicyListCall): string => {
        return `${call.file}:${call.line} (${call.method})`;
      });

    expect(missing).toEqual([]);
  });
});
