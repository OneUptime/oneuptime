// UX rule: Docs/ux/README.md#empty-states-and-suggestions
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * An empty list never says "No X found." (#9124, #9060).
 *
 * The shared table heads its empty state with the page's first sentence
 * (getMessageEmptyStateParts), so a brand-new project read "No ingestion
 * keys found", "No custom domains found", "No labels found" on some fifty
 * lists: words that read as a search that missed, or a load that failed,
 * on a project that simply has none yet. The rulebook's empty state says
 * "No X yet", what the list is for (the card's description, which the
 * empty state takes over) and offers the list's Create button. A search or
 * filter that hides every row is told apart by the table itself ("No X
 * match your search or filters", with Clear), so a page's noItemsMessage
 * is only ever read for a list with nothing in it at all.
 *
 * CoreListEmptyStates renders the core lists. This reads every
 * `noItemsMessage` the Dashboard (and the Enterprise dashboard, when ee/ is
 * present) writes, as a JSX attribute or an object's property, and every
 * sentence it can hand over - a literal, either side of a condition or of
 * `||` - and:
 *
 *   - fails on "found" in any of them, unless the sentence is listed in
 *     ALLOWED below with the reason: a list that only ever shows the
 *     answer to a search the reader typed, where "nothing found" is the
 *     truth;
 *   - holds each sentence it reads to a Dashboard key with a translation in
 *     every other language, so the empty state is never half English.
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

const PROP_NAME: string = "noItemsMessage";
const SAYS_FOUND: RegExp = /\bfound\b/i;
const WHITESPACE: RegExp = /\s+/g;

interface AllowedMessage {
  // Relative to the repository root, with forward slashes.
  file: string;
  text: string;
  reason: string;
}

/*
 * Sentences that may say "found": each is drawn only after the reader asked
 * for something and nothing came back. Add one only with its reason.
 */
const ALLOWED: Array<AllowedMessage> = [
  {
    file: "packages/App/FeatureSet/Dashboard/src/Components/Traces/TraceTable.tsx",
    text: "No spans found.",
    reason:
      "The traces explorer's list: its rows are the answer to the time range and query the reader set, so an empty one is a search that found nothing, never a project with no spans. Pages that embed it pass a sentence of their own.",
  },
  {
    file: "packages/App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionInstanceTable.tsx",
    text: "No exception instances found.",
    reason:
      "An exception's occurrences in the time range and query the reader set: an empty list is a search that found nothing. Pages that embed it pass a sentence of their own.",
  },
];

/*
 * The lists whose "No X found." was reworded (#9124, #9060), relative to the
 * Dashboard's src (or the repository, for ee/). Their sentences are held to
 * a translation in every language below.
 */
const REWORDED_LISTS: Array<string> = [
  "Components/CallSMS/CallSMSConfigTable.tsx",
  "Components/CustomDomain/CustomDomainsTable.tsx",
  "Components/IncidentRole/IncidentRoleSettings.ts",
  "Components/Infrastructure/ResourceTable.tsx",
  "Components/Metrics/AddToDashboardModal.tsx",
  "Components/NotificationMethods/Call.tsx",
  "Components/NotificationMethods/Email.tsx",
  "Components/NotificationMethods/IncomingCallNumber.tsx",
  "Components/NotificationMethods/SMS.tsx",
  "Components/NotificationMethods/WhatsApp.tsx",
  "Components/TelemetryService/TelemetryServiceTable.tsx",
  "Components/Workflow/WorkflowVariablesTable.tsx",
  "Pages/Alerts/Settings/AlertNoteTemplates.tsx",
  "Pages/Ceph/View/ClusterLog.tsx",
  "Pages/Ceph/View/Daemons.tsx",
  "Pages/DataSecurity/StoreView/Inside.tsx",
  "Pages/DataSecurity/Telemetry.tsx",
  "Pages/Docker/View/Profiles.tsx",
  "Pages/Host/View/Profiles.tsx",
  "Pages/Incidents/Settings/IncidentNoteTemplates.tsx",
  "Pages/Incidents/Settings/IncidentPostmortemTemplates.tsx",
  "Pages/Incidents/Settings/IncidentTemplates.tsx",
  "Pages/Inventory/View/Profiles.tsx",
  "Pages/Kubernetes/View/Profiles.tsx",
  "Pages/Llm/Budgets.tsx",
  "Pages/Llm/Pricing.tsx",
  "Pages/Logs/Settings/DropFilters.tsx",
  "Pages/Logs/Settings/Pipelines.tsx",
  "Pages/Logs/Settings/RecordingRules.tsx",
  "Pages/Logs/Settings/ScrubRules.tsx",
  "Pages/Metrics/Settings/PipelineRules.tsx",
  "Pages/Metrics/Settings/RecordingRules.tsx",
  "Pages/Monitor/Settings/MonitorProbes.tsx",
  "Pages/Monitor/Settings/MonitorTemplates.tsx",
  "Pages/Monitor/View/Slos.tsx",
  "Pages/MonitorGroup/MonitorGroups.tsx",
  "Pages/OnCallDuty/IncomingCallPolicy/LogView.tsx",
  "Pages/OnCallDuty/IncomingCallPolicy/Logs.tsx",
  "Pages/Podman/View/Profiles.tsx",
  "Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceNoteTemplates.tsx",
  "Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceTemplates.tsx",
  "Pages/Service/View/Profiles.tsx",
  "Pages/Settings/APIKeys.tsx",
  "Pages/Settings/Base/CustomFieldsPageBase.tsx",
  "Pages/Settings/Billing.tsx",
  "Pages/Settings/Labels.tsx",
  "Pages/Settings/TelemetryIngestionKeys.tsx",
  "Pages/StorageArray/View/Buckets.tsx",
  "Pages/StorageArray/View/FileSystems.tsx",
  "Pages/StorageArray/View/Hardware.tsx",
  "Pages/StorageArray/View/Hosts.tsx",
  "Pages/StorageArray/View/Replication.tsx",
  "Pages/StorageArray/View/Volumes.tsx",
  "Pages/Teams/View/Members.tsx",
  "Pages/Traces/Settings/DropFilters.tsx",
  "Pages/Traces/Settings/Pipelines.tsx",
  "Pages/Traces/Settings/RecordingRules.tsx",
  "Pages/Traces/Settings/ScrubRules.tsx",
  "Pages/Users/CustomFields.tsx",
  "ee/Dashboard/Identity/Pages/Settings/SCIM.tsx",
  "ee/Dashboard/Identity/Pages/StatusPages/SCIM.tsx",
];

interface FoundMessage {
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

// The constants a file declares, by name: what each holds.
type FileConstants = ReadonlyMap<string, ts.Expression>;

function readConstants(source: ts.SourceFile): FileConstants {
  const constants: Map<string, ts.Expression> = new Map();

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isVariableDeclarationList(node) &&
      (node.flags & ts.NodeFlags.Const) !== 0
    ) {
      for (const declaration of node.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer) {
          constants.set(declaration.name.text, declaration.initializer);
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return constants;
}

/*
 * Every sentence an expression can hand over: a literal, either side of a
 * condition or of `||`/`??`, a parenthesised value, the words of a
 * template before its first ${...}, the key a translationKey() marks, or
 * what a constant of the same file holds. A page whose platform may say
 * its own sentence keeps its own in a constant (the storage array lists,
 * `kindPage?.noItemsMessage || BUCKETS_NO_ITEMS`), and is read through it.
 */
function collectMessages(
  node: ts.Node,
  source: ts.SourceFile,
  file: string,
  into: Array<FoundMessage>,
  constants: FileConstants,
  followed: ReadonlySet<string> = new Set<string>(),
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
    collectMessages(node.expression, source, file, into, constants, followed);
    return;
  }

  if (ts.isParenthesizedExpression(node)) {
    collectMessages(node.expression, source, file, into, constants, followed);
    return;
  }

  if (ts.isConditionalExpression(node)) {
    collectMessages(node.whenTrue, source, file, into, constants, followed);
    collectMessages(node.whenFalse, source, file, into, constants, followed);
    return;
  }

  if (
    ts.isBinaryExpression(node) &&
    (node.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
  ) {
    collectMessages(node.left, source, file, into, constants, followed);
    collectMessages(node.right, source, file, into, constants, followed);
    return;
  }

  if (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "translationKey" &&
    node.arguments[0]
  ) {
    collectMessages(node.arguments[0], source, file, into, constants, followed);
    return;
  }

  if (ts.isIdentifier(node) && !followed.has(node.text)) {
    const value: ts.Expression | undefined = constants.get(node.text);

    if (value) {
      collectMessages(
        value,
        source,
        file,
        into,
        constants,
        new Set<string>([...followed, node.text]),
      );
    }
  }
}

function readNoItemsMessages(file: string): Array<FoundMessage> {
  const text: string = fs.readFileSync(file, "utf8");

  if (!text.includes(PROP_NAME)) {
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
  const constants: FileConstants = readConstants(source);

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isJsxAttribute(node) &&
      node.name.getText(source) === PROP_NAME &&
      node.initializer
    ) {
      collectMessages(
        node.initializer,
        source,
        relative(file),
        found,
        constants,
      );
    }

    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText(source) === PROP_NAME
    ) {
      collectMessages(
        node.initializer,
        source,
        relative(file),
        found,
        constants,
      );
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return found;
}

const MESSAGES: Array<FoundMessage> = SCAN_DIRS.flatMap(
  (directory: string): Array<FoundMessage> => {
    return listSourceFiles(directory).flatMap(readNoItemsMessages);
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

function isAllowed(message: FoundMessage): boolean {
  return ALLOWED.some((allowed: AllowedMessage): boolean => {
    return allowed.file === message.file && allowed.text === message.text;
  });
}

const DASHBOARD_PREFIX: string = "packages/App/FeatureSet/Dashboard/src/";

describe("an empty list says 'No X yet', never 'No X found.'", () => {
  test("the scan reads the lists it is meant to hold", () => {
    /*
     * Some hundreds of Dashboard tables write their own empty sentence. A
     * scan that found a handful would let the rule below pass on nothing.
     */
    expect(MESSAGES.length).toBeGreaterThanOrEqual(200);

    const files: Set<string> = new Set<string>(
      MESSAGES.map((message: FoundMessage): string => {
        return message.file;
      }),
    );

    for (const page of [
      "Pages/Settings/TelemetryIngestionKeys.tsx",
      "Pages/Settings/Labels.tsx",
      "Pages/Teams/View/Members.tsx",
      "Pages/Monitor/View/Slos.tsx",
      "Pages/Settings/APIKeys.tsx",
      "Components/CustomDomain/CustomDomainsTable.tsx",
      // An object's property, not a JSX attribute.
      "Components/IncidentRole/IncidentRoleSettings.ts",
    ]) {
      expect(files).toContain(`${DASHBOARD_PREFIX}${page}`);
    }
  });

  test("no list's empty sentence says 'found'", () => {
    const saysFound: Array<string> = MESSAGES.filter(
      (message: FoundMessage): boolean => {
        return SAYS_FOUND.test(message.text) && !isAllowed(message);
      },
    ).map(describeMessage);

    expect(saysFound).toEqual([]);
  });

  test("every allowed sentence is still there, with its reason", () => {
    for (const allowed of ALLOWED) {
      expect(allowed.reason.trim().length).toBeGreaterThan(20);
      expect(
        MESSAGES.some((message: FoundMessage): boolean => {
          return message.file === allowed.file && message.text === allowed.text;
        }),
      ).toBe(true);
    }
  });

  test("every reworded list's empty sentence is a Dashboard key, translated in every language", () => {
    const missing: Array<string> = [];
    const reworded: Array<FoundMessage> = MESSAGES.filter(
      (message: FoundMessage): boolean => {
        return REWORDED_LISTS.some((file: string): boolean => {
          return (
            message.file === file || message.file === DASHBOARD_PREFIX + file
          );
        });
      },
    );

    // Each list named below is still read: none was renamed out of the check.
    expect(reworded.length).toBeGreaterThanOrEqual(REWORDED_LISTS.length);

    for (const message of reworded) {
      // A template's words are composed at run time, not looked up.
      if (!message.isLiteral || !message.text) {
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

  test("the 'found' sentences that were replaced are gone from the locale files", () => {
    for (const oldSentence of [
      "No ingestion keys found.",
      "No API Keys found.",
      "No labels found.",
      "No custom domains found.",
      "No members found for this team.",
      "No monitor groups found.",
      "No logs found for this resource. Please check back later.",
    ]) {
      for (const code of Object.keys(locales)) {
        expect({ code, has: oldSentence in (locales[code] || {}) }).toEqual({
          code,
          has: false,
        });
      }
    }
  });
});
