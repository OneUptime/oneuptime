import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * An embedded logs list's empty state says each thing once.
 *
 * Every logs list draws its empty state the same way (Common LogsTable): the
 * title "No logs found", and under it one line from the page that embeds the
 * list - what to do or why the list is empty. About twenty embeds handed it a
 * line that started with the title again, so a service's Logs tab read
 * "No logs found / No logs found for this service." and a host's read "No
 * logs found / No logs found for this host. Make sure your OTel collector
 * forwards logs with the host.name resource attribute."
 *
 * Each embed's line now says only what the title does not: how logs get
 * here for that kind of resource. This keeps it so for every `noLogsMessage`
 * in the Dashboard (and the Enterprise dashboard when ee/ is present):
 *
 *   - no line opens with "No logs" (or "No container logs", "No
 *     application logs") - the title already says it. The one exception
 *     is the title word for word ("No logs found"), which the table
 *     replaces with its own hint (getLogsTableEmptyHint);
 *   - every line written as a literal is a Dashboard key with a translation
 *     in each of the sixteen other languages, and so are the title and the
 *     hint, so the empty state is never half English.
 *
 * What the table does with the line is rendered in the Common suites
 * (LogsViewerFirstSteps, LogsViewerEmbedEmptyContent).
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "..", "..", "..");
const REPOSITORY_DIR: string = path.resolve(PACKAGES_DIR, "..");
const DASHBOARD_SRC: string = path.join(
  PACKAGES_DIR,
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
);
const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

const SCAN_DIRS: Array<string> = [
  DASHBOARD_SRC,
  path.join(REPOSITORY_DIR, "ee", "Dashboard"),
];

const SKIPPED_DIRECTORIES: Array<string> = [
  "node_modules",
  "build",
  "dist",
  "Locales",
];

// The logs table's own words (Common LogsTable).
const TITLE: string = "No logs found";
const HINT: string = "Adjust filters or check again later.";

/*
 * "No logs", "No container logs", "No application logs from this pod": up
 * to two words between "No" and "logs" (bounded, so it reads any line in
 * one pass).
 */
const OPENS_WITH_NO_LOGS: RegExp = /^no\s+(?:[a-z-]+\s+){0,2}logs\b/i;
const WHITESPACE: RegExp = /\s+/g;

interface FoundMessage {
  // Relative to the repository root, with forward slashes.
  file: string;
  line: number;
  text: string;
  // A literal the extractor reads as a key; a template's head is not one.
  isLiteral: boolean;
}

function relative(file: string): string {
  return path.relative(REPOSITORY_DIR, file).split(path.sep).join("/");
}

function listSourceFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  if (!fs.existsSync(directory)) {
    return files;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.includes(entry.name)) {
        files.push(...listSourceFiles(fullPath));
      }
    } else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) {
      if (!entry.name.endsWith(".d.ts")) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

/*
 * Every line an expression can hand over: a literal, either side of a
 * condition, a parenthesised value, or the words of a template before its
 * first ${...}.
 */
function collectMessages(
  node: ts.Node,
  source: ts.SourceFile,
  file: string,
  into: Array<FoundMessage>,
): void {
  const line: number =
    source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;

  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    into.push({
      file: file,
      line: line,
      text: node.text.replace(WHITESPACE, " ").trim(),
      isLiteral: true,
    });
    return;
  }

  if (ts.isTemplateExpression(node)) {
    into.push({
      file: file,
      line: line,
      text: node.head.text.replace(WHITESPACE, " ").trim(),
      isLiteral: false,
    });
    return;
  }

  if (ts.isJsxExpression(node) && node.expression) {
    collectMessages(node.expression, source, file, into);
    return;
  }

  if (ts.isParenthesizedExpression(node)) {
    collectMessages(node.expression, source, file, into);
    return;
  }

  if (ts.isConditionalExpression(node)) {
    collectMessages(node.whenTrue, source, file, into);
    collectMessages(node.whenFalse, source, file, into);
    return;
  }

  if (
    ts.isBinaryExpression(node) &&
    (node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
  ) {
    collectMessages(node.left, source, file, into);
    collectMessages(node.right, source, file, into);
  }
}

function readNoLogsMessages(file: string): Array<FoundMessage> {
  const text: string = fs.readFileSync(file, "utf8");

  if (!text.includes("noLogsMessage")) {
    return [];
  }

  const source: ts.SourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const found: Array<FoundMessage> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isJsxAttribute(node) &&
      node.name.getText(source) === "noLogsMessage" &&
      node.initializer
    ) {
      collectMessages(node.initializer, source, relative(file), found);
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return found;
}

const MESSAGES: Array<FoundMessage> = SCAN_DIRS.flatMap(
  (directory: string): Array<FoundMessage> => {
    return listSourceFiles(directory).flatMap(readNoLogsMessages);
  },
);

type Locale = Record<string, unknown>;

const locales: Record<string, Locale> = {};

for (const file of fs.readdirSync(LOCALES_DIR).sort()) {
  if (file.endsWith(".json")) {
    locales[file.replace(/\.json$/, "")] = JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
    ) as Locale;
  }
}

const OTHER_LANGUAGES: Array<string> = Object.keys(locales).filter(
  (code: string): boolean => {
    return code !== "en";
  },
);

// The languages that still show a key in English.
function untranslatedIn(key: string): Array<string> {
  return OTHER_LANGUAGES.filter((code: string): boolean => {
    const value: unknown = locales[code]?.[key];

    return typeof value !== "string" || value === key;
  });
}

function describeMessage(message: FoundMessage): string {
  return `${message.file}:${message.line}: ${message.text}`;
}

describe("embedded logs lists say each thing once", () => {
  test("the scan reads the embeds it is meant to hold", () => {
    /*
     * The pages that embed a logs list - a service, a host, a container, a
     * Kubernetes or Proxmox cluster, a database, a trace, a network device,
     * a VMware vCenter... - each pass a line. A scan that found a handful
     * would let the rule below pass on nothing.
     */
    expect(MESSAGES.length).toBeGreaterThanOrEqual(20);

    const files: Set<string> = new Set<string>(
      MESSAGES.map((message: FoundMessage): string => {
        return message.file;
      }),
    );

    for (const page of [
      "Pages/Service/View/Logs.tsx",
      "Pages/Host/View/Logs.tsx",
      "Pages/Kubernetes/View/Logs.tsx",
      "Pages/Docker/View/ContainerDetail.tsx",
      "Pages/NetworkDevice/View/Logs.tsx",
      "Components/Traces/TraceDetail/TraceSignals.tsx",
      "Components/Telemetry/TelemetryCompanionSignalTabs.tsx",
    ]) {
      expect(files).toContain(`packages/App/FeatureSet/Dashboard/src/${page}`);
    }
  });

  test("no embed's line opens with what the title already says", () => {
    const restating: Array<string> = MESSAGES.filter(
      (message: FoundMessage): boolean => {
        // The title word for word gives way to the table's own hint.
        if (message.text === TITLE) {
          return false;
        }

        return OPENS_WITH_NO_LOGS.test(message.text);
      },
    ).map(describeMessage);

    expect(restating).toEqual([]);
  });

  test("every line is a Dashboard key, translated in every language", () => {
    const missing: Array<string> = [];

    for (const message of MESSAGES) {
      // A template's words are composed at run time, not looked up.
      if (!message.isLiteral || message.text === TITLE) {
        continue;
      }

      if (locales["en"]?.[message.text] !== message.text) {
        missing.push(`not a key: ${describeMessage(message)}`);
        continue;
      }

      const untranslated: Array<string> = untranslatedIn(message.text);

      if (untranslated.length > 0) {
        missing.push(
          `English in ${untranslated.join(", ")}: ${describeMessage(message)}`,
        );
      }
    }

    expect(missing).toEqual([]);
  });

  test("the table's own title and hint read in every language", () => {
    expect(untranslatedIn(TITLE)).toEqual([]);
    expect(untranslatedIn(HINT)).toEqual([]);
  });

  test("the lines that were dropped are gone from the locale files", () => {
    for (const oldLine of [
      "No logs found for this service.",
      "No logs found for this host. Make sure your OTel collector forwards logs with the host.name resource attribute.",
      "No logs found for this trace.",
      "No logs received from this device yet. Point the device's syslog and SNMP trap forwarding at the probe and messages will appear here.",
    ]) {
      for (const code of Object.keys(locales)) {
        expect({ code, has: oldLine in (locales[code] || {}) }).toEqual({
          code,
          has: false,
        });
      }
    }
  });
});
