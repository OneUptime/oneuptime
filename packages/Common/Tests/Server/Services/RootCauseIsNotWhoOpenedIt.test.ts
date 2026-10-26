import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * NOTHING ON THE SERVER WRITES A ROOT CAUSE THAT ONLY SAYS WHO OPENED IT.
 *
 * An incident or an alert a person opened without a root cause used to be
 * given one: "Incident created by <them>", "Incident created by @them on
 * Slack.", "Incident created via Microsoft Teams", "Incident created via the
 * OneUptime AI copilot." It said who, not why, and stood where the cause
 * belongs - the What happened card, the feed's Root Cause, the first state's
 * timeline row, every changed monitor's status timeline. The record names
 * who opened it itself (its creator), so the root cause is left for
 * somebody who knows it (Common/Utils/Incident/WhoOpenedItRootCause).
 *
 * This reads every server source file for a record's root cause written as
 * "<record> created by" or "<record> created via".
 *
 * Two other kinds of line are not this and stay: a state or status
 * timeline row's "Incident state created by ..." says who changed the state,
 * on the row of that change; and an alert opened only to page people - by a
 * chat's /oneuptime page (WorkspacePage) or a workflow's page step
 * (OnCallPageService) - says "Created by ... to page people": that is why
 * the alert exists.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");
const REPOSITORY_DIR: string = path.resolve(PACKAGES_DIR, "..");

// Where the server writes records: Common's server code and App's services.
const SOURCE_DIRS: Array<string> = [
  path.join(PACKAGES_DIR, "Common/Server"),
  path.join(PACKAGES_DIR, "App/FeatureSet/Workers"),
  path.join(PACKAGES_DIR, "App/FeatureSet/Notification"),
  path.join(PACKAGES_DIR, "App/FeatureSet/BaseAPI"),
  path.join(REPOSITORY_DIR, "ee/Server"),
];

// How many lines a root cause's value is read over, at most.
const VALUE_LINES: number = 6;

// How a line saying who opened a record began, record by record.
const PHRASES: Array<string> = [
  "incident created by",
  "incident created via",
  "alert created by",
  "alert created via",
  "episode created by",
  "episode created via",
];

/*
 * A root cause's value, from just after its "=" or ":": the rest of its line,
 * and the lines after it until one ends the statement or the property (a
 * line ending in ";" or ","), at most VALUE_LINES of them.
 */
function readValue(source: string, from: number): string {
  const lines: Array<string> = source.slice(from).split("\n");
  const value: Array<string> = [];

  for (const line of lines.slice(0, VALUE_LINES)) {
    value.push(line);

    const trimmed: string = line.trim();

    if (trimmed.endsWith(";") || trimmed.endsWith(",")) {
      break;
    }
  }

  return value.join("\n");
}

function listSourceFiles(dir: string): Array<string> {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const files: Array<string> = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) {
      continue;
    }

    const full: string = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...listSourceFiles(full));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      files.push(full);
    }
  }

  return files;
}

/*
 * The writes of a root cause in a file - "rootCause =" and "rootCause:" -
 * whose value (readValue) holds one of PHRASES, by the line each starts on.
 */
function findWhoOpenedItWrites(source: string): Array<number> {
  const lines: Array<number> = [];
  let from: number = 0;

  while (from < source.length) {
    const at: number = source.indexOf("rootCause", from);

    if (at === -1) {
      break;
    }

    from = at + "rootCause".length;

    let cursor: number = from;

    while (source[cursor] === " ") {
      cursor++;
    }

    const isWrite: boolean =
      (source[cursor] === "=" && source[cursor + 1] !== "=") ||
      source[cursor] === ":";

    if (!isWrite) {
      continue;
    }

    const value: string = readValue(source, cursor + 1).toLowerCase();

    if (
      PHRASES.some((phrase: string): boolean => {
        return value.includes(phrase);
      })
    ) {
      lines.push(source.slice(0, at).split("\n").length);
    }
  }

  return lines;
}

describe("a root cause the server writes", () => {
  const files: Array<string> = SOURCE_DIRS.flatMap(listSourceFiles);

  test("is read from every server source file", () => {
    expect(files.length).toBeGreaterThan(1000);
  });

  test("never says who opened the record", () => {
    const writes: Array<string> = [];

    for (const file of files) {
      const relative: string = path
        .relative(PACKAGES_DIR, file)
        .split(path.sep)
        .join("/");

      const source: string = fs.readFileSync(file, "utf8");

      for (const line of findWhoOpenedItWrites(source)) {
        writes.push(`${relative}:${line}`);
      }
    }

    expect(writes).toEqual([]);
  });

  test("a page's alert still says it was opened to page people", () => {
    for (const relative of [
      "Common/Server/Utils/Workspace/WorkspacePage.ts",
      "Common/Server/Services/OnCallPageService.ts",
    ]) {
      const source: string = fs.readFileSync(
        path.join(PACKAGES_DIR, relative),
        "utf8",
      );

      expect([relative, source.includes("to page people.`")]).toEqual([
        relative,
        true,
      ]);
    }
  });
});

describe("the reader of root cause writes", () => {
  test("finds a write that says who opened the record, in either form", () => {
    expect(
      findWhoOpenedItWrites(
        [
          "const a = 1;",
          "incident.rootCause = `Incident created via Microsoft Teams`;",
          "createBy.data.rootCause =",
          "  mdText`Alert created by ${name}`.toString();",
          "const data = { rootCause: 'Episode created by Ada' };",
          "incident.rootCause = `Incident created by @${who} on Slack.`;",
        ].join("\n"),
      ),
    ).toEqual([2, 3, 5, 6]);
  });

  test("passes over reads, comparisons and other root causes", () => {
    expect(
      findWhoOpenedItWrites(
        [
          "if (incident.rootCause === 'Incident created by x') {}",
          "const text = incident.rootCause;",
          "statusTimeline.rootCause = rootCause;",
          "rootCause: 'This status was changed when the incident was updated.',",
          "select: { rootCause: true },",
          "createBy.data.rootCause =",
          "  mdText`Incident state created by ${who}`.toString();",
          "alert.rootCause =",
          "  mdText`Created by workflow **${name}** to page people.`.toString();",
        ].join("\n"),
      ),
    ).toEqual([]);
  });
});
