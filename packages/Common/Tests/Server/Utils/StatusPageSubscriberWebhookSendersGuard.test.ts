import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * EVERY SEND TO A STATUS PAGE WEBHOOK SUBSCRIBER SAYS WHICH SUBSCRIBER IT IS
 * (issue #6589).
 *
 * What a subscriber's webhook may reach depends on who wrote its URL: one the
 * team added may reach what the project's webhooks may, one a visitor signed
 * up on the status page public addresses only
 * (StatusPageSubscriberWebhookUtil.getTargetValidationOptions). Each send
 * re-checks the URL with that rule, so each sender hands over the
 * subscriber's own Is Added By Team, as read from the database - never a
 * constant, which would give every sign-up the team's rule.
 *
 * TypeScript already makes the field required; this reads every call in the
 * code that sends (the subscriber jobs and the services) and holds each to a
 * value that comes from the subscriber it sends to.
 */

const PACKAGES_ROOT: string = path.join(__dirname, "..", "..", "..", "..");

const SEARCHED: Array<string> = [
  path.join(PACKAGES_ROOT, "App", "FeatureSet"),
  path.join(PACKAGES_ROOT, "Common", "Server"),
];

const SKIPPED_FOLDERS: Array<string> = ["node_modules", "build", "dist"];

const CALL: string = "StatusPageSubscriberWebhookUtil.sendWebhookNotification(";

/*
 * The values a call may pass: the subscriber's own column, as every job
 * reads it (getSubscribersByStatusPage selects it), or - for the message
 * a new subscriber is sent on its create - that column and the create's own
 * mark of a sign-up together.
 */
const ALLOWED_VALUES: Array<string> = [
  "subscriber.isAddedByTeam",
  "!signUp && createdItem.isAddedByTeam === true",
];

function sourceFiles(folder: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_FOLDERS.includes(entry.name)) {
        files.push(...sourceFiles(path.join(folder, entry.name)));
      }
      continue;
    }

    const isSource: boolean =
      entry.name.endsWith(".ts") || entry.name.endsWith(".tsx");
    const isTest: boolean =
      entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx");

    if (isSource && !isTest) {
      files.push(path.join(folder, entry.name));
    }
  }

  return files;
}

/*
 * The text between a call's parentheses: brackets are counted, and string
 * and template literals and comments are stepped over whole.
 */
function argumentsOf(source: string, openIndex: number): string {
  let depth: number = 0;
  let quote: string | null = null;

  for (let index: number = openIndex; index < source.length; index++) {
    const character: string = source[index]!;

    if (!quote && character === "/" && source[index + 1] === "/") {
      const lineEnd: number = source.indexOf("\n", index);
      index = lineEnd === -1 ? source.length : lineEnd;
      continue;
    }

    if (!quote && character === "/" && source[index + 1] === "*") {
      const commentEnd: number = source.indexOf("*/", index + 2);
      index = commentEnd === -1 ? source.length : commentEnd + 1;
      continue;
    }

    if (quote) {
      if (character === "\\") {
        index++;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === '"' || character === "'" || character === "`") {
      quote = character;
    } else if (character === "(" || character === "{" || character === "[") {
      depth++;
    } else if (character === ")" || character === "}" || character === "]") {
      depth--;

      if (depth === 0) {
        return source.substring(openIndex + 1, index);
      }
    }
  }

  throw new Error("Unbalanced call.");
}

interface SendCall {
  file: string;
  isAddedByTeam: string | null;
}

function findCalls(): Array<SendCall> {
  const calls: Array<SendCall> = [];

  for (const folder of SEARCHED) {
    for (const file of sourceFiles(folder)) {
      const source: string = fs.readFileSync(file, "utf8");
      let from: number = 0;

      for (;;) {
        const index: number = source.indexOf(CALL, from);

        if (index === -1) {
          break;
        }

        const args: string = argumentsOf(source, index + CALL.length - 1);
        const match: RegExpMatchArray | null = args.match(
          /\bisAddedByTeam:\s*([^,\n]+),/,
        );

        calls.push({
          file: path.relative(PACKAGES_ROOT, file),
          isAddedByTeam: match ? match[1]!.trim() : null,
        });

        from = index + CALL.length;
      }
    }
  }

  return calls;
}

describe("status page subscriber webhook senders", () => {
  const calls: Array<SendCall> = findCalls();

  test("are all found: every subscriber job, the scheduled event service and the new-subscriber message", () => {
    expect(calls.length).toBeGreaterThanOrEqual(12);

    const files: Array<string> = calls.map((call: SendCall): string => {
      return call.file;
    });

    for (const expected of [
      "Common/Server/Services/StatusPageSubscriberService.ts",
      "Common/Server/Services/ScheduledMaintenanceService.ts",
      "App/FeatureSet/Workers/Jobs/Incident/SendNotificationToSubscribers.ts",
      "App/FeatureSet/Workers/Jobs/Announcement/SendNotificationToSubscribers.ts",
    ]) {
      expect(files).toContain(expected);
    }
  });

  test("each passes the Is Added By Team of the subscriber it sends to", () => {
    const wrong: Array<SendCall> = calls.filter((call: SendCall): boolean => {
      return (
        call.isAddedByTeam === null ||
        !ALLOWED_VALUES.includes(call.isAddedByTeam)
      );
    });

    expect(wrong).toEqual([]);
  });

  test("none says a subscriber is the team's outright", () => {
    for (const call of calls) {
      expect(call.isAddedByTeam).not.toBe("true");
    }
  });
});
