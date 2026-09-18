import fs from "fs";
import path from "path";
import {
  buildSyncResultSummary,
  SyncResultSummary,
} from "../../FeatureSet/Dashboard/src/Pages/Monitor/Settings/MonitorTemplateSyncResultUtil";
import { describe, expect, it } from "@jest/globals";

const TEMPLATES_VIEW_SOURCE: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Pages",
  "Monitor",
  "Settings",
  "MonitorTemplatesView.tsx",
);

const BULK_SYNC_ROUTE: string = "/sync-to-linked-monitors";

/*
 * Hoisted rather than written inline at their use sites: eslint's `wrap-regex`
 * wants a literal used as the object of a member expression parenthesised,
 * while `prettier/prettier` strips those parentheses straight back out, so the
 * two rules cannot both be satisfied in place. A named constant sidesteps the
 * fight and reads better anyway. `no-div-regex` is why the second one opens
 * with a character class instead of a bare `=`.
 */
const IDENTIFIER_ONLY: RegExp = /^[A-Za-z_$][\w$]*$/;
const STRING_INITIALISER: RegExp = /[=]\s*"([^"]*)"/;

/*
 * Prose is stripped before anything below counts call sites. This view explains
 * itself at length — each sync card carries a paragraph saying what it writes —
 * and a comment that mentions the route or the helper by name would otherwise
 * be counted as a call to it, failing the wiring tests over an explanation.
 */
function readTemplatesViewCode(): string {
  return fs
    .readFileSync(TEMPLATES_VIEW_SOURCE, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/\s+/g, " ");
}

const TEMPLATES_VIEW_CODE: string = readTemplatesViewCode();

/*
 * The index of the brace that closes the one at `openIndex`. Nested objects and
 * the `${...}` of a template literal both balance, so a depth walk is enough;
 * running off the end means the scanner has lost the shape of the file, which
 * it says out loud rather than quietly returning a truncated slice that would
 * make every check below read less than it thinks it is reading.
 */
function readClosingBrace(code: string, openIndex: number): number {
  let depth: number = 0;

  for (let index: number = openIndex; index < code.length; index++) {
    if (code[index] === "{") {
      depth++;
    } else if (code[index] === "}") {
      depth--;

      if (depth === 0) {
        return index;
      }
    }
  }

  throw new Error(
    `Unbalanced braces from index ${openIndex} in MonitorTemplatesView.`,
  );
}

/*
 * The `{ ... }` argument of every call the marker matches, as source text.
 */
function readCallArguments(code: string, marker: RegExp): Array<string> {
  const args: Array<string> = [];

  let match: RegExpExecArray | null = marker.exec(code);

  while (match !== null) {
    const openIndex: number = code.indexOf("{", match.index);

    args.push(code.slice(openIndex, readClosingBrace(code, openIndex) + 1));
    match = marker.exec(code);
  }

  return args;
}

/*
 * Raw `API.post` calls, with or without an explicit generic argument. The
 * lookbehind keeps `ModelAPI.post` out — that one is model CRUD and never
 * carries these routes.
 */
function readApiPostArguments(code: string): Array<string> {
  return readCallArguments(
    code,
    /(?<![A-Za-z])API\.post\s*(?:<[^();{}]*>)?\s*\(\s*\{/g,
  );
}

/*
 * One expression, from `start` up to the character that ends it at the top
 * level — `stop` itself, or a closing bracket belonging to something that
 * encloses it. Read by walking rather than by regex so a nested object, a call
 * argument or a template literal inside the value cannot truncate it.
 */
function readExpression(text: string, start: number, stop: string): string {
  let depth: number = 0;

  for (let index: number = start; index < text.length; index++) {
    const character: string = text[index]!;

    if (character === "(" || character === "[" || character === "{") {
      depth++;
    } else if (character === ")" || character === "]" || character === "}") {
      if (depth === 0) {
        return text.slice(start, index).trim();
      }

      depth--;
    } else if (character === stop && depth === 0) {
      return text.slice(start, index).trim();
    }
  }

  return text.slice(start).trim();
}

/*
 * The source text of one property of an object literal, or null when the
 * object does not set it. Only the object's own top level is considered, so a
 * `subject:` belonging to something nested inside `data:` is not mistaken for
 * the call's own.
 */
function readProperty(objectText: string, name: string): string | null {
  let depth: number = 0;

  for (let index: number = 0; index < objectText.length; index++) {
    const character: string = objectText[index]!;

    if (character === "(" || character === "[" || character === "{") {
      depth++;
    } else if (character === ")" || character === "]" || character === "}") {
      depth--;
    } else if (depth === 1 && objectText.startsWith(`${name}:`, index)) {
      const before: string = objectText.slice(0, index).trimEnd().slice(-1);

      if (before === "{" || before === ",") {
        return readExpression(objectText, index + name.length + 1, ",");
      }
    }
  }

  return null;
}

/*
 * What an identifier is bound to in this file, as source text — or null when
 * the file does not declare it (an import, a prop, a destructured hook result)
 * or declares it more than once. Ambiguity has to read as "cannot tell": two
 * handlers that each keep a local named `subject` would otherwise both resolve
 * to whichever one happens to appear first, and the checks below would then
 * pin a sentence the page never shows.
 */
function readDeclaration(code: string, identifier: string): string | null {
  const pattern: string = `\\b(?:const|let|var|function)\\s+${identifier}\\b`;
  const declarations: RegExpMatchArray | null = code.match(
    new RegExp(pattern, "g"),
  );

  if (declarations === null || declarations.length !== 1) {
    return null;
  }

  const start: number = new RegExp(pattern).exec(code)!.index;

  if (code.startsWith("function", start)) {
    const bodyStart: number = code.indexOf("{", start);

    return code.slice(start, readClosingBrace(code, bodyStart) + 1);
  }

  return readExpression(code, start, ";");
}

/*
 * Whether one `API.post` argument object posts to `route`.
 *
 * The route is normally written inline in the `url:` template literal, and the
 * first version of this file simply counted occurrences of the route string.
 * That was wrong in a way worth spelling out: the four bulk-sync URLs are
 * spelled identically today, so hoisting them into one shared const or builder
 * — a pure refactor that improves the view — would have reported one bulk sync
 * against four helper calls and turned this suite red. So when the route is
 * not in the call itself, every identifier the `url:` expression mentions is
 * resolved once against this file's own declarations and the route is looked
 * for there.
 *
 * One level of indirection, because that is as far as source text can honestly
 * be followed. A URL assembled through two hops leaves its call unattributed
 * and the count below then fails — loudly and in the right place, rather than
 * silently reporting one sync fewer than the page really has.
 */
function postsToRoute(call: string, code: string, route: string): boolean {
  const url: string | null = readProperty(call, "url");

  if (url === null) {
    return false;
  }

  if (url.includes(route)) {
    return true;
  }

  const identifiers: Array<string> = url.match(/[A-Za-z_$][\w$]*/g) || [];

  return identifiers.some((identifier: string) => {
    const declaration: string | null = readDeclaration(code, identifier);

    return declaration !== null && declaration.includes(route);
  });
}

type BulkSyncSubject = {
  call: number;
  expression: string;
  name: string | null;
};

/*
 * The subject as a plain string when the source says so outright, and null
 * when it is built at runtime. A quoted literal, an uninterpolated template
 * literal and an identifier this file binds to one are all readable; a call
 * result or an interpolation is not, and saying so is the point. The version
 * of this that only understood a double-quoted literal reported anything else
 * as the empty string, which reads as "the developer forgot the subject" and
 * would have failed a legitimate change to a translated or derived label.
 */
function readSubjectName(expression: string, code: string): string | null {
  const literal: RegExpMatchArray | null =
    expression.match(/^"([^"]*)"$/) ||
    expression.match(/^'([^']*)'$/) ||
    expression.match(/^`([^`$]*)`$/);

  if (literal !== null) {
    return literal[1]!;
  }

  if (!IDENTIFIER_ONLY.test(expression)) {
    return null;
  }

  const declaration: string | null = readDeclaration(code, expression);

  if (declaration === null) {
    return null;
  }

  const bound: RegExpMatchArray | null = declaration.match(STRING_INITIALISER);

  return bound === null ? null : bound[1]!;
}

/*
 * The subjects the view actually reports on, read out of its
 * buildSyncResultSummary calls rather than listed here. A sync added later is
 * then exercised by these tests the day it lands, and one that forgets its
 * subject arrives as an empty expression against a call number the failure can
 * name — a list copied into this file would simply have gone quietly out of
 * date instead.
 */
function readBulkSyncSubjects(code: string): Array<BulkSyncSubject> {
  return readCallArguments(code, /buildSyncResultSummary\(\s*\{/g).map(
    (call: string, index: number): BulkSyncSubject => {
      const expression: string | null = readProperty(call, "subject");

      return {
        call: index + 1,
        expression: expression === null ? "" : expression,
        name: expression === null ? null : readSubjectName(expression, code),
      };
    },
  );
}

const BULK_SYNC_SUBJECTS: Array<BulkSyncSubject> =
  readBulkSyncSubjects(TEMPLATES_VIEW_CODE);

const NAMED_BULK_SYNC_SUBJECTS: Array<string> = BULK_SYNC_SUBJECTS.filter(
  (subject: BulkSyncSubject) => {
    return subject.name !== null;
  },
).map((subject: BulkSyncSubject) => {
  return subject.name!;
});

describe("Monitor template sync result summary", () => {
  it("reports a complete sync as done", () => {
    const summary: SyncResultSummary = buildSyncResultSummary({
      subject: "criteria",
      syncedMonitors: 12,
      totalLinkedMonitors: 12,
    });

    expect(summary.isIncomplete).toBe(false);
    expect(summary.title).toBe("Done");
    expect(summary.message).toBe(
      "Synced criteria onto 12 monitors (12 linked to this template).",
    );
  });

  /*
   * Regression: a short sync used to render as plain success, so a fleet left
   * partly on the old configuration looked fully updated.
   */
  it("flags a short sync instead of reporting success", () => {
    const summary: SyncResultSummary = buildSyncResultSummary({
      subject: "criteria",
      syncedMonitors: 10000,
      totalLinkedMonitors: 50000,
    });

    expect(summary.isIncomplete).toBe(true);
    expect(summary.title).toBe("Partially synced");
    expect(summary.message).toContain(
      "40000 linked monitors still use the previous configuration",
    );
  });

  it("singularizes the one-monitor cases", () => {
    expect(
      buildSyncResultSummary({
        subject: "labels",
        syncedMonitors: 1,
        totalLinkedMonitors: 1,
      }).message,
    ).toBe("Synced labels onto 1 monitor (1 linked to this template).");

    const partial: SyncResultSummary = buildSyncResultSummary({
      subject: "labels",
      syncedMonitors: 1,
      totalLinkedMonitors: 2,
    });

    expect(partial.message).toContain(
      "1 linked monitor still uses the previous configuration",
    );
  });

  it("treats a template with no linked monitors as done", () => {
    const summary: SyncResultSummary = buildSyncResultSummary({
      subject: "monitoring interval",
      syncedMonitors: 0,
      totalLinkedMonitors: 0,
    });

    expect(summary.isIncomplete).toBe(false);
    expect(summary.title).toBe("Done");
  });

  /*
   * The linked count is read project-wide while the writes are narrowed to the
   * caller, and the two are separate round trips. A count that lands lower than
   * the writes must not report a negative remainder.
   */
  it("does not invent a shortfall when more rows were written than counted", () => {
    const summary: SyncResultSummary = buildSyncResultSummary({
      subject: "criteria",
      syncedMonitors: 5,
      totalLinkedMonitors: 3,
    });

    expect(summary.isIncomplete).toBe(false);
    expect(summary.title).toBe("Done");
    expect(summary.message).not.toContain("still");
  });

  /*
   * Runs on the subjects the view really passes rather than a sample of them,
   * so the sentence an operator sees is pinned for every sync that exists, not
   * for the three that existed when this was written.
   */
  it("names the subject it was asked to report on", () => {
    expect(NAMED_BULK_SYNC_SUBJECTS.length).toBeGreaterThan(0);

    for (const subject of NAMED_BULK_SYNC_SUBJECTS) {
      expect(
        buildSyncResultSummary({
          subject: subject,
          syncedMonitors: 2,
          totalLinkedMonitors: 2,
        }).message,
      ).toBe(`Synced ${subject} onto 2 monitors (2 linked to this template).`);
    }
  });

  it("keeps the raw counts visible even when it flags a shortfall", () => {
    const summary: SyncResultSummary = buildSyncResultSummary({
      subject: "labels",
      syncedMonitors: 7,
      totalLinkedMonitors: 20,
    });

    expect(summary.message).toContain(
      "Synced labels onto 7 monitors (20 linked to this template).",
    );
    expect(summary.message).toContain("13 linked monitors still use");
  });

  /*
   * A zero-write sync against a non-empty fleet is the loudest possible
   * failure and must not read as success.
   */
  it("flags a sync that reached nothing at all", () => {
    const summary: SyncResultSummary = buildSyncResultSummary({
      subject: "criteria",
      syncedMonitors: 0,
      totalLinkedMonitors: 12,
    });

    expect(summary.isIncomplete).toBe(true);
    expect(summary.title).toBe("Partially synced");
    expect(summary.message).toContain("12 linked monitors still use");
  });
});

/*
 * The result modal shares one title across sync, link and unlink. A path that
 * sets a message without setting a title would inherit whatever the previous
 * action left behind — most visibly "Partially synced" sitting on top of a
 * later success. The view is a React page the App suite cannot render, so pin
 * the pairing at the source level the way the sibling tenant-header suite does.
 */
describe("Monitor template result modal title wiring", () => {
  it("sets a title on every path that shows a result message", () => {
    const source: string = fs.readFileSync(TEMPLATES_VIEW_SOURCE, "utf8");

    const contentMessages: number = (
      source.match(/setSyncResultMessage\((?!"")/g) || []
    ).length;
    const titles: number = (source.match(/setSyncResultTitle\(/g) || []).length;

    expect(contentMessages).toBeGreaterThan(0);
    expect(titles).toBeGreaterThanOrEqual(contentMessages);
  });

  /*
   * One bulk sync is one POST to the bulk-sync route, so the number of those
   * posts is what the number of helper calls has to match. Both sides are read
   * off the view: a card added later brings its own expectation with it, while
   * a sync that formats its own message drifts the two apart and fails.
   *
   * The posts are identified by resolving each call's `url:`, not by counting
   * occurrences of the route string — see postsToRoute for why that difference
   * is what keeps a DRY cleanup of those four identical URLs green.
   *
   * The single-monitor sync and the link/unlink paths are deliberately not in
   * this count — they set a plain "Done" because they have no synced-versus-
   * linked totals to report, which is the whole subject of the helper.
   */
  it("routes every bulk sync through the shared summary helper", () => {
    const bulkSyncs: number = readApiPostArguments(TEMPLATES_VIEW_CODE).filter(
      (call: string) => {
        return postsToRoute(call, TEMPLATES_VIEW_CODE, BULK_SYNC_ROUTE);
      },
    ).length;

    /*
     * Zero here means the page still posts to the bulk-sync route but this
     * file can no longer see which calls do — teach postsToRoute the new
     * shape, because everything below it is then counting nothing.
     */
    expect(bulkSyncs).toBeGreaterThan(0);
    expect(BULK_SYNC_SUBJECTS.length).toBe(bulkSyncs);
  });

  /*
   * Every one of those calls has to name what it synced, and name it
   * distinctly: the modal is shared, so a card that reports the subject of the
   * card next to it tells the operator the wrong fields were written to their
   * fleet — and does it in a sentence that reads as a clean success.
   */
  it("gives every bulk sync its own subject to report on", () => {
    expect(BULK_SYNC_SUBJECTS.length).toBeGreaterThan(0);

    const unnamed: Array<string> = BULK_SYNC_SUBJECTS.filter(
      (subject: BulkSyncSubject) => {
        return subject.expression === "";
      },
    ).map((subject: BulkSyncSubject) => {
      return `buildSyncResultSummary call ${subject.call} passes no subject`;
    });

    expect(unnamed).toEqual([]);

    /*
     * Distinctness is judged only on the subjects the source states outright.
     * One assembled at runtime is exempt because no reading of the text can
     * decide what it will say — it is still required above to be passed at
     * all, and at least one has to stay readable or this check would quietly
     * become a no-op the day the last literal is replaced.
     */
    expect(NAMED_BULK_SYNC_SUBJECTS.length).toBeGreaterThan(0);

    const reused: Array<string> = NAMED_BULK_SYNC_SUBJECTS.filter(
      (subject: string, index: number) => {
        return NAMED_BULK_SYNC_SUBJECTS.indexOf(subject) !== index;
      },
    );

    expect(reused).toEqual([]);
  });

  it("renders the modal from the title state rather than a hardcoded string", () => {
    const source: string = fs.readFileSync(TEMPLATES_VIEW_SOURCE, "utf8");

    expect(source).toContain("title={syncResultTitle}");
  });

  /*
   * Modal titles are resolved through translateString, which falls back to the
   * raw English on a miss. The modal used to hardcode "Done", which every
   * catalog carries; a title that varies has to be carried too, or the one
   * case that needs the operator's attention is the one that shows up
   * untranslated.
   */
  it("carries both modal titles in every locale catalog", () => {
    const localeDir: string = path.join(
      __dirname,
      "..",
      "..",
      "FeatureSet",
      "Dashboard",
      "src",
      "Locales",
    );

    const catalogs: Array<string> = fs
      .readdirSync(localeDir)
      .filter((file: string) => {
        return file.endsWith(".json");
      });

    expect(catalogs.length).toBeGreaterThan(0);

    for (const catalog of catalogs) {
      const messages: Record<string, string> = JSON.parse(
        fs.readFileSync(path.join(localeDir, catalog), "utf8"),
      );

      expect(messages["Done"]).toBeTruthy();
      expect(messages["Partially synced"]).toBeTruthy();
    }
  });
});
