import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Every picker of incident, alert and maintenance states, incident and alert
 * severities and monitor statuses lists them in the order the settings
 * pages put them in - states in the order an incident moves through them,
 * severities most severe first, statuses from the healthiest to the worst.
 *
 * Left alone, a list request comes back newest first, so the incident
 * template's states read Resolved, Acknowledged, Identified, a rule's
 * severities came out in the order they were created, and the workspace rule
 * conditions sorted them by name. Now that the order is something people set
 * by dragging, every list of them follows it:
 *
 *   1. a form field's dropdownModal for one of them sorts by its order
 *      column (`order`, or `priority` for monitor statuses);
 *   2. a list request of one of them (anything but a lookup of known ids,
 *      whose answer's order does not matter) sorts by it too.
 */

const PACKAGES: string = path.join(__dirname, "..", "..", "..");
const REPO: string = path.join(PACKAGES, "..");

const SCAN_ROOTS: Array<string> = [
  path.join(PACKAGES, "App", "FeatureSet", "Dashboard", "src"),
  path.join(PACKAGES, "App", "FeatureSet", "AdminDashboard", "src"),
  path.join(PACKAGES, "Common", "UI"),
  path.join(PACKAGES, "Common", "Types"),
  path.join(REPO, "ee", "Dashboard"),
];

const ORDER_COLUMNS: Record<string, string> = {
  IncidentState: "order",
  AlertState: "order",
  ScheduledMaintenanceState: "order",
  IncidentSeverity: "order",
  AlertSeverity: "order",
  MonitorStatus: "priority",
};

const MODEL_PATTERN: string = Object.keys(ORDER_COLUMNS).join("|");

interface SourceFile {
  file: string;
  source: string;
}

function listSourceFiles(directory: string): Array<string> {
  if (!fs.existsSync(directory)) {
    return [];
  }

  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (
        ["node_modules", "Locales", "build", "dist", "Tests"].includes(
          entry.name,
        )
      ) {
        continue;
      }

      files.push(...listSourceFiles(fullPath));
    } else if (
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.includes(".test.")
    ) {
      files.push(fullPath);
    }
  }

  return files;
}

const SOURCES: Array<SourceFile> = SCAN_ROOTS.flatMap(
  (root: string): Array<string> => {
    return listSourceFiles(root);
  },
).map((file: string): SourceFile => {
  return {
    file: path.relative(REPO, file),
    source: fs.readFileSync(file, "utf8"),
  };
});

/*
 * The index of the bracket closing the one at `openIndex`, skipping strings
 * and comments.
 */
function matchingBracket(source: string, openIndex: number): number {
  const open: string = source[openIndex] as string;
  const close: string = open === "{" ? "}" : open === "(" ? ")" : "]";
  let depth: number = 0;

  for (let index: number = openIndex; index < source.length; index++) {
    const char: string = source[index] as string;
    const next: string = source[index + 1] || "";

    if (char === "/" && next === "/") {
      index = source.indexOf("\n", index);
      if (index === -1) {
        return -1;
      }
      continue;
    }

    if (char === "/" && next === "*") {
      index = source.indexOf("*/", index + 2) + 1;
      if (index === 0) {
        return -1;
      }
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      for (index = index + 1; index < source.length; index++) {
        if (source[index] === "\\") {
          index++;
          continue;
        }
        if (source[index] === char) {
          break;
        }
      }
      continue;
    }

    if (char === open) {
      depth++;
    } else if (char === close) {
      depth--;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

interface Found {
  where: string;
  model: string;
  block: string;
}

// Every `dropdownModal: { type: <Model>, ... }`.
function dropdownModals(): Array<Found> {
  const found: Array<Found> = [];
  const pattern: RegExp = new RegExp(
    `dropdownModal:\\s*\\{\\s*type:\\s*(${MODEL_PATTERN})\\s*,`,
    "g",
  );

  for (const file of SOURCES) {
    for (const match of file.source.matchAll(pattern)) {
      const brace: number = file.source.indexOf("{", match.index);

      found.push({
        where: `${file.file}:${lineOf(file.source, match.index as number)}`,
        model: match[1] as string,
        block: file.source.slice(
          brace,
          matchingBracket(file.source, brace) + 1,
        ),
      });
    }
  }

  return found;
}

// Every list request's options object for one of the models.
function listRequests(): Array<Found> {
  const found: Array<Found> = [];
  const pattern: RegExp = new RegExp(
    `modelType:\\s*(${MODEL_PATTERN})\\s*,`,
    "g",
  );

  for (const file of SOURCES) {
    for (const match of file.source.matchAll(pattern)) {
      const open: number = file.source.lastIndexOf("{", match.index);
      const head: string = file.source.slice(Math.max(0, open - 120), open);

      if (!/getList\b/.test(head)) {
        continue;
      }

      found.push({
        where: `${file.file}:${lineOf(file.source, match.index as number)}`,
        model: match[1] as string,
        block: file.source.slice(open, matchingBracket(file.source, open) + 1),
      });
    }
  }

  return found;
}

const sortsByOrder: (found: Found) => boolean = (found: Found): boolean => {
  const column: string = ORDER_COLUMNS[found.model] as string;
  const sort: RegExpMatchArray | null =
    found.block.match(/sort:\s*\{([^{}]*)\}/);

  return Boolean(
    sort &&
      new RegExp(`^\\s*${column}\\s*:\\s*SortOrder\\.Ascending`).test(
        sort[1] as string,
      ),
  );
};

describe("the guard reads the code it guards", () => {
  test("it finds the pickers and the list requests", () => {
    expect(dropdownModals().length).toBeGreaterThan(60);
    expect(listRequests().length).toBeGreaterThan(20);
  });

  test("the bracket matcher skips strings and comments", () => {
    const source: string = 'f({ a: "}", b: `{`, /* } */ c: 1 // }\n})';

    expect(matchingBracket(source, 1)).toBe(source.length - 1);
    expect(matchingBracket(source, 2)).toBe(source.length - 2);
  });

  test("it recognises an ordered sort and an unordered one", () => {
    expect(
      sortsByOrder({
        where: "",
        model: "MonitorStatus",
        block: "{ sort: { priority: SortOrder.Ascending } }",
      }),
    ).toBe(true);
    expect(
      sortsByOrder({
        where: "",
        model: "IncidentState",
        block: "{ sort: {} }",
      }),
    ).toBe(false);
    expect(
      sortsByOrder({
        where: "",
        model: "IncidentState",
        block: "{ sort: { name: SortOrder.Ascending } }",
      }),
    ).toBe(false);
  });
});

describe("1. pickers list them in their order", () => {
  test("every dropdownModal of a state, severity or status sorts by its order column", () => {
    const unordered: Array<string> = dropdownModals()
      .filter((found: Found): boolean => {
        return !sortsByOrder(found);
      })
      .map((found: Found): string => {
        return `${found.where} (${found.model})`;
      });

    expect(unordered).toEqual([]);
  });
});

describe("2. lists of them come in their order", () => {
  test("every list request sorts by its order column, unless it looks up known ids", () => {
    const unordered: Array<string> = listRequests()
      .filter((found: Found): boolean => {
        // A lookup of known ids: the order of its answer does not matter.
        if (found.block.includes("new Includes(")) {
          return false;
        }

        return !sortsByOrder(found);
      })
      .map((found: Found): string => {
        return `${found.where} (${found.model})`;
      });

    expect(unordered).toEqual([]);
  });
});
