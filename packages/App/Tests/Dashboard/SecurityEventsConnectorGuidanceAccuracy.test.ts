import { describe, expect, test } from "@jest/globals";
import {
  ConnectorField,
  SecurityEventConnectorDefinition,
  getSecurityEventConnectorDefinition,
} from "Common/Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import {
  LEGACY_GOOGLE_SECOPS_CONNECTION_ID_ATTRIBUTE,
  SECURITY_CONNECTION_ID_ATTRIBUTE,
} from "Common/Types/SecurityEvent/Connectors/SecurityEventConnectionDiagnostics";
import SecurityEventConnectorProvider from "Common/Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import fs from "fs";
import nodePath from "path";

/*
 * The Google SecOps connector ships two pieces of operator-facing prose
 * about the **Last Error** message — the integration doc's Troubleshooting
 * section and the Connections page's own in-product help
 * (ConnectorProviderHelp.ts) — and both of them used to be wrong in the
 * same way.
 *
 * They said Last Error "carries verbatim whatever the Chronicle API
 * returned" and that a populated value meant "the poll ran and Chronicle
 * rejected it". Neither is what the code does:
 *
 *  - the stored string is synthetic. GoogleSecOpsClient builds a prefix
 *    naming the step plus the HTTP status and redacts credentials from
 *    the complete diagnostic. Nothing about it is verbatim.
 *  - the same catch in SecurityEventConnectionPoller.executeUnlocked stores
 *    failures Chronicle never saw. A token exchange failure comes from the
 *    OAuth endpoint in the customer's own service-account JSON, before
 *    Chronicle is contacted at all; and a telemetry-store write failure
 *    happens AFTER a completely successful Chronicle fetch. Both land in
 *    exactly the same column.
 *
 * So an operator reading "Chronicle rejected it" off a OneUptime-side
 * storage outage would open a ticket with Google support. Prose drifted
 * from behaviour and nothing caught it — this file is the thing that
 * catches it.
 *
 * Google SecOps used to have a poller of its own (GoogleSecOpsPoller); it
 * now runs through the shared Security Event Connections framework:
 * SecurityEventConnectionRunExecutor schedules and runs every poll,
 * SecurityEventConnectionPoller owns the window, cursor and Last Error, and
 * GoogleSecOpsConnector owns the three read passes and their budgets. Every
 * invariant below is checked against whichever of those now produces the
 * thing the prose describes:
 *
 *  1. neither text reintroduces the false wording,
 *  2. every message prefix the texts quote is really thrown by
 *     GoogleSecOpsClient, and every HTTP-error template the client can
 *     throw is named by both texts; every other message they quote is
 *     really produced by the poller, the executor or the connector,
 *  3. the complete-error and copy guidance matches the untruncated,
 *     credential-redacted diagnostic the poller stores,
 *  4. "Last Polled: Never with an empty Last Error" is only reachable when
 *     no poll has finished, and every attempt that did not finish leaves a
 *     run in history or a scheduler stamp the texts name,
 *  5. the partial-poll warnings, budgets and checks the texts quote are the
 *     ones the code emits and enforces,
 *  6. the upgrade guidance matches the data migration and the API.
 *
 * Message prefixes are read from their producing source so a rename cannot
 * quietly invalidate the troubleshooting guidance. Behavioral client, poller
 * and UI suites separately verify long messages, redaction and clipboard
 * contents.
 *
 * Sources are read as TEXT, the same choice as
 * App/Tests/Dashboard/SecurityEventsSetupGuide.test.ts: react is a
 * Dashboard dependency that App's own install never provides, so the .tsx
 * cannot be imported, and the server modules pull in databases and queues.
 * Only the catalog and the run-diagnostics constants, which are plain
 * types, are imported.
 *
 * NOT covered here on purpose: the DISABLE_QUEUE_WORKERS and
 * worker.enabled claims in the same Troubleshooting section, and the
 * dashboard's column, action and run-detail labels. Those are compared
 * against config.example.env, HelmChart values.yaml and the dashboard
 * sources in App/Tests/Dashboard/SecurityEventsConnectionsPage.test.ts, and
 * duplicating them would just give the same claim two places to be updated.
 */

/*
 * Read as constants rather than inline literals: eslint's wrap-regex wants
 * an inline regex parenthesised and prettier wants the parentheses gone,
 * and the two rules fight forever over the same line.
 */

/* Matches `new APIException(...)` with either a template or a plain string. */
const CLIENT_API_EXCEPTION_PATTERN: RegExp =
  /new\s+APIException\(\s*(?:`([^`]*)`|"((?:[^"\\]|\\.)*)")/g;
/* The poller and connector report invalid runs and settings with BadDataException. */
const THROWN_MESSAGE_PATTERN: RegExp =
  /new\s+(?:APIException|BadDataException|Error)\(\s*(?:`([^`]*)`|"((?:[^"\\]|\\.)*)")/g;
/*
 * Detects length-based cuts in diagnostic strings, whether the bound is
 * written inline or named. These would invalidate the full-error guidance.
 */
const DIAGNOSTIC_SLICE_PATTERN: RegExp = /\.slice\(\s*0\s*,\s*\w+\s*\)/;
/* Matches a quoted key in an object literal, e.g. the query parameter names. */
const QUOTED_KEY_PATTERN: RegExp = /"([^"]+)"\s*:/g;
/* Matches the client's request-timeout constant. */
const REQUEST_TIMEOUT_PATTERN: RegExp =
  /REQUEST_TIMEOUT_IN_SECONDS:\s*number\s*=\s*(\d+)/;
/* Matches the body of the client's "unknown query parameter" 400 detector. */
const UNKNOWN_FIELD_PATTERN_SOURCE: RegExp =
  /UNKNOWN_FIELD_PATTERN:\s*RegExp\s*=\s*\/(.+?)\/i;/;
/* pollAllDueConnections' own stamp: the whole message, redacted. */
const FULL_ERROR_RECORDING_PATTERN: RegExp =
  /lastError:\s*redactLogString\(\s*ConnectorErrorMessage\.toMessage\(\s*error,\s*\{\s*truncate:\s*false\s*\}/;
/* executeUnlocked's run error, which is what a poll writes to Last Error. */
const RESULT_ERROR_RECORDING_PATTERN: RegExp =
  /result\.error\s*=\s*redactLogString\(\s*ConnectorErrorMessage\.toMessage\(\s*error,\s*\{\s*truncate:\s*false\s*\}/;
const OBSOLETE_TRUNCATION_GUIDANCE_PATTERN: RegExp =
  /first\s+(?:500|1000)\s+characters|clamped overall|\(truncated\)/i;
/* Matches a backticked span that claims to be a connector error message. */
const GUIDANCE_QUOTED_MESSAGE_PATTERN: RegExp = /`(Google[^`]*)`/g;
/* Matches the ` (HTTP ...)` tail the docs render in place of the status. */
const HTTP_TAIL_PATTERN: RegExp = /\s*\(HTTP[^)]*\)\s*$/;
/* Matches a trailing ellipsis standing in for the rest of a message. */
const ELLIPSIS_TAIL_PATTERN: RegExp = /\s*(?:\.{3}|…)\s*$/;
/* Matches `catch (someVariable)` so catch paths can be counted. */
const CATCH_CLAUSE_PATTERN: RegExp = /\bcatch\s*\(\s*(\w+)\s*\)/g;
/* Matches the service account JSON's default token endpoint. */
const DEFAULT_TOKEN_URI_PATTERN: RegExp =
  /parsed\["token_uri"\]\s*\|\|\s*"([^"]+)"/;
/* Matches the template `getApiBaseUrl()` returns. */
const API_BASE_URL_TEMPLATE_PATTERN: RegExp = /return\s+`([^`]*)`/;
/* Splits prose into sentence-ish chunks; delimiters are not needed back. */
const SENTENCE_SPLIT_PATTERN: RegExp = /[.:]\s+|\n/;
/* The two words a single sentence must not combine before naming a prefix. */
const CHRONICLE_MENTION_PATTERN: RegExp = /chronicle/i;
const REJECTION_MENTION_PATTERN: RegExp = /reject/i;
/* The connector's budgets, as declared. */
const SEARCH_PAGE_BUDGET_PATTERN: RegExp =
  /GOOGLE_SECOPS_SEARCH_PAGE_BUDGET:\s*number\s*=\s*(\d+);/;
const CURATED_BUDGET_PATTERN: RegExp =
  /GOOGLE_SECOPS_CURATED_REQUEST_BUDGET:\s*number\s*=\s*(\d+);/;
const ALERTS_VIEW_BUDGET_PATTERN: RegExp =
  /GOOGLE_SECOPS_ALERTS_VIEW_REQUEST_BUDGET:\s*number\s*=\s*(\d+);/;
const FETCH_DURATION_MINUTES_PATTERN: RegExp =
  /GOOGLE_SECOPS_FETCH_DURATION_MS:\s*number\s*=\s*(\d+)\s*\*\s*60\s*\*\s*1000;/;
/* The fetchBudget the poller reads: every request budget and the wall clock. */
const TOTAL_REQUEST_BUDGET_PATTERN: RegExp =
  /maxRequests:\s*GOOGLE_SECOPS_SEARCH_PAGE_BUDGET\s*\+\s*GOOGLE_SECOPS_CURATED_REQUEST_BUDGET\s*\+\s*GOOGLE_SECOPS_ALERTS_VIEW_REQUEST_BUDGET/;
const FETCH_DURATION_BUDGET_PATTERN: RegExp =
  /maxDurationMs:\s*GOOGLE_SECOPS_FETCH_DURATION_MS/;
/* The poller's "this failure was a timeout" detector. */
const POLLER_TIMEOUT_PATTERN_SOURCE: RegExp =
  /TIMEOUT_ERROR_PATTERN:\s*RegExp\s*=\s*\/(.+?)\/i;/;
/* The client's timeout message, as a template. */
const CLIENT_TIMEOUT_TEMPLATE_PATTERN: RegExp =
  /`(Google SecOps \$\{stepLabel\} timed out after \$\{timeoutInSeconds\} seconds with no response\.)`/;
/* The synchronous test's per-request deadline. */
const TEST_REQUEST_TIMEOUT_PATTERN: RegExp =
  /CONNECTION_TEST_REQUEST_TIMEOUT_IN_MS:\s*number\s*=\s*(\d+)\s*\*\s*1000;/;
/* Block and whole-line comments, removed before scanning source for literals. */
const BLOCK_COMMENT_PATTERN: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT_PATTERN: RegExp = /^\s*\/\/.*$/gm;
/* A check name written as a plain string literal. */
const CHECK_NAME_PATTERN: RegExp = /name:\s*"([^"]+)"/g;
/* The API example the upgrade section prints. */
const JSON_BLOCK_PATTERN: RegExp = /```json\n([\s\S]*?)\n\s*```/;
/* A model's CRUD route. */
const CRUD_ROUTE_PATTERN: RegExp = /@CrudApiEndpoint\(new Route\("([^"]+)"\)\)/;
/* The migration's run-history bound and the error it gives interrupted runs. */
const RUN_HISTORY_LIMIT_PATTERN: RegExp =
  /RUN_HISTORY_COPY_LIMIT:\s*number\s*=\s*(\d+);/;
const INTERRUPTED_RUN_ERROR_PATTERN: RegExp =
  /INTERRUPTED_RUN_ERROR:\s*string\s*=\s*"([^"]+)";/;

/* The literal interpolation the client puts the HTTP status into. */
const HTTP_STATUS_INTERPOLATION: string = "${response.status}";
/* What separates a client message's static prefix from its status tail. */
const HTTP_TAIL_MARKER: string = " (HTTP ";

const REPO_ROOT: string = nodePath.join(__dirname, "..", "..", "..");

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(nodePath.join(REPO_ROOT, relativePath), "utf8");
}

function repoFileExists(relativePath: string): boolean {
  return fs.existsSync(nodePath.join(REPO_ROOT, relativePath));
}

function indexOfOrThrow(
  source: string,
  marker: string,
  fromIndex: number = 0,
): number {
  const index: number = source.indexOf(marker, fromIndex);

  if (index === -1) {
    throw new Error(`Expected to find "${marker}" in the source, but did not`);
  }

  return index;
}

/*
 * `String.prototype.matchAll` is ES2020 and this package compiles against
 * the ES2017 lib, so groups are collected with an explicit exec loop.
 * Missing optional groups come back as "" rather than undefined, which
 * keeps every caller free of null checks.
 */
function matchAllGroups(pattern: RegExp, text: string): Array<Array<string>> {
  const flags: string = pattern.flags.includes("g")
    ? pattern.flags
    : `${pattern.flags}g`;
  const scanner: RegExp = new RegExp(pattern.source, flags);
  const results: Array<Array<string>> = [];

  let match: RegExpExecArray | null = scanner.exec(text);

  while (match !== null) {
    results.push(
      match.map((group: string | undefined): string => {
        return group === undefined ? "" : group;
      }),
    );
    match = scanner.exec(text);
  }

  return results;
}

function requireGroup(pattern: RegExp, text: string, label: string): string {
  const match: RegExpExecArray | null = new RegExp(
    pattern.source,
    pattern.flags.replace("g", ""),
  ).exec(text);

  if (match === null || match[1] === undefined) {
    throw new Error(`Could not read ${label} out of its source file`);
  }

  return match[1];
}

/* Everything from `startMarker` up to (not including) `endMarker`. */
function sliceBetween(
  source: string,
  startMarker: string,
  endMarker: string,
): string {
  const start: number = indexOfOrThrow(source, startMarker);

  return source.slice(
    start,
    indexOfOrThrow(source, endMarker, start + startMarker.length),
  );
}

/*
 * Read a template literal declaration out of a source file as the string it
 * evaluates to. The help text escapes its inline code spans as \`, so a raw
 * slice would leave backslashes all through the markdown and no assertion
 * about backticked prefixes would ever match.
 */
function readTemplateLiteral(source: string, declaration: string): string {
  let index: number = indexOfOrThrow(source, declaration) + declaration.length;
  let literal: string = "";

  while (index < source.length) {
    const character: string | undefined = source[index];

    if (character === undefined) {
      break;
    }

    if (character === "\\") {
      const escaped: string | undefined = source[index + 1];
      literal += escaped === undefined ? "" : escaped;
      index += 2;
      continue;
    }

    if (character === "`") {
      return literal;
    }

    literal += character;
    index++;
  }

  throw new Error(`Unterminated template literal for "${declaration}"`);
}

/*
 * Pull every `{ ... }` block that follows `marker` out of a source file by
 * brace depth. A naive indexOf("}") would stop at the first nested object,
 * and the whole point of reading these blocks is to check what ELSE is
 * inside them alongside the key being looked for. Blocks nested inside an
 * earlier match are skipped, since the scan resumes after each block.
 */
function extractBalancedBlocks(source: string, marker: string): Array<string> {
  const blocks: Array<string> = [];
  let markerIndex: number = source.indexOf(marker);

  while (markerIndex !== -1) {
    const openIndex: number = source.indexOf("{", markerIndex);

    if (openIndex === -1) {
      break;
    }

    let depth: number = 0;
    let closeIndex: number = -1;

    for (let index: number = openIndex; index < source.length; index++) {
      const character: string | undefined = source[index];

      if (character === "{") {
        depth++;
      } else if (character === "}") {
        depth--;

        if (depth === 0) {
          closeIndex = index;
          break;
        }
      }
    }

    if (closeIndex === -1) {
      throw new Error(`Unbalanced braces after "${marker}"`);
    }

    blocks.push(source.slice(openIndex, closeIndex + 1));
    markerIndex = source.indexOf(marker, closeIndex + 1);
  }

  return blocks;
}

function firstBalancedBlock(source: string, marker: string): string {
  const [block]: Array<string> = extractBalancedBlocks(source, marker);

  if (block === undefined) {
    throw new Error(`No block follows "${marker}"`);
  }

  return block;
}

/*
 * A bullet plus everything indented beneath it, up to the next unindented
 * line. The in-product Last Error taxonomy outgrew a single line when the
 * status-less buckets were spelled out, so reading one line off it would now
 * read only the lead.
 */
function extractBulletBlock(text: string, startsWith: string): string {
  const rest: string = text.slice(indexOfOrThrow(text, startsWith));
  const end: number = rest.search(/\n(?=\S)/);

  return end === -1 ? rest : rest.slice(0, end);
}

/*
 * Undo the two elisions the prose is allowed to make when it quotes a
 * message it does not want to print in full: the ` (HTTP ...)` status tail,
 * and a trailing ellipsis standing in for the rest of the message.
 */
function normalizeQuotedSpan(span: string): string {
  return span.replace(HTTP_TAIL_PATTERN, "").replace(ELLIPSIS_TAIL_PATTERN, "");
}

function countOccurrences(source: string, marker: string): number {
  return source.split(marker).length - 1;
}

/*
 * ---------------------------------------------------------------------------
 * Sources
 * ---------------------------------------------------------------------------
 */

const docsSource: string = readRepoFile(
  "App/FeatureSet/Docs/Content/en/integrations/google-secops.md",
);
/* The in-product help moved out of the retired page into its own module. */
const providerHelpSource: string = readRepoFile(
  "App/FeatureSet/Dashboard/src/Components/SecurityEvents/ConnectorProviderHelp.ts",
);
/* The one list every provider shares, with its View Error dialog. */
const connectionsTableSource: string = readRepoFile(
  "App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventConnectionsTable.tsx",
);
const clientSource: string = readRepoFile(
  "Common/Server/Utils/SecurityEvent/Connectors/GoogleSecOps/GoogleSecOpsClient.ts",
);
const connectorSource: string = readRepoFile(
  "Common/Server/Utils/SecurityEvent/Connectors/GoogleSecOps/GoogleSecOpsConnector.ts",
);
const pollerSource: string = readRepoFile(
  "Common/Server/Utils/SecurityEvent/Connectors/SecurityEventConnectionPoller.ts",
);
const executorSource: string = readRepoFile(
  "Common/Server/Utils/SecurityEvent/Connectors/SecurityEventConnectionRunExecutor.ts",
);
const testerSource: string = readRepoFile(
  "Common/Server/Utils/SecurityEvent/Connectors/SecurityEventConnectionTester.ts",
);
const platformHealthSource: string = readRepoFile(
  "Common/Server/Utils/SecurityEvent/Connectors/ConnectorPlatformHealth.ts",
);
const connectorTypesSource: string = readRepoFile(
  "Common/Server/Utils/SecurityEvent/Connectors/Types.ts",
);
const connectorErrorMessageSource: string = readRepoFile(
  "Common/Server/Utils/SecurityEvent/ConnectorErrorMessage.ts",
);
const pollJobSource: string = readRepoFile(
  "App/FeatureSet/Workers/Jobs/SecurityEvents/PollSecurityEventConnections.ts",
);
const migrationSource: string = readRepoFile(
  "App/FeatureSet/Workers/DataMigrations/MoveGoogleSecOpsConnectionsToSecurityEventConnections.ts",
);
const connectionModelSource: string = readRepoFile(
  "Common/Models/DatabaseModels/SecurityEventConnection.ts",
);
const connectionRunModelSource: string = readRepoFile(
  "Common/Models/DatabaseModels/SecurityEventConnectionRun.ts",
);
const connectionApiSource: string = readRepoFile(
  "Common/Server/API/SecurityEventConnectionAPI.ts",
);

const googleSecOps: SecurityEventConnectorDefinition =
  getSecurityEventConnectorDefinition(
    SecurityEventConnectorProvider.GoogleSecOps,
  ) as SecurityEventConnectorDefinition;

const googleSecOpsFields: Array<ConnectorField> = [
  ...googleSecOps.configFields,
  ...googleSecOps.secretFields,
];

/*
 * ---------------------------------------------------------------------------
 * Constants derived from the producing sources
 * ---------------------------------------------------------------------------
 */

/* Every message GoogleSecOpsClient can throw, as written in the source. */
const clientThrownMessages: Array<string> = matchAllGroups(
  CLIENT_API_EXCEPTION_PATTERN,
  clientSource,
).map((groups: Array<string>): string => {
  // Group 1 is the template-literal form, group 2 the plain-string form.
  return groups[1] || groups[2] || "";
});

/* The subset that carries an HTTP status, i.e. a remote rejection. */
const clientHttpErrorTemplates: Array<string> = clientThrownMessages.filter(
  (message: string): boolean => {
    return message.includes(HTTP_STATUS_INTERPOLATION);
  },
);

/* The subset that does not. Which bucket each of these belongs to is decided below. */
const clientNonHttpMessages: Array<string> = clientThrownMessages.filter(
  (message: string): boolean => {
    return !message.includes(HTTP_STATUS_INTERPOLATION);
  },
);

/*
 * The shared poller and the connector throw too, and the guidance quotes
 * messages of theirs by name. Read them the same way, so renaming one there
 * also breaks the prose.
 */
const frameworkThrownMessages: Array<string> = matchAllGroups(
  THROWN_MESSAGE_PATTERN,
  `${pollerSource}\n${connectorSource}`,
).map((groups: Array<string>): string => {
  return groups[1] || groups[2] || "";
});

const connectorThrownMessages: Array<string> = clientThrownMessages.concat(
  frameworkThrownMessages,
);

/*
 * The static text in front of ` (HTTP <status>)`, paired with the template
 * it came from. The prefix is what an operator reads first and what the
 * guidance's taxonomy keys off; the template is kept so a claim about the
 * status tail can be checked against the real thing.
 */
const clientHttpErrorPrefixByTemplate: Array<{
  prefix: string;
  template: string;
}> = clientHttpErrorTemplates.map(
  (template: string): { prefix: string; template: string } => {
    return {
      prefix: template.slice(0, indexOfOrThrow(template, HTTP_TAIL_MARKER)),
      template: template,
    };
  },
);

const httpErrorPrefixes: Array<string> = clientHttpErrorPrefixByTemplate.map(
  (entry: { prefix: string; template: string }): string => {
    return entry.prefix;
  },
);

const requestTimeoutInSeconds: number = Number(
  requireGroup(
    REQUEST_TIMEOUT_PATTERN,
    clientSource,
    "REQUEST_TIMEOUT_IN_SECONDS",
  ),
);

/*
 * ---------------------------------------------------------------------------
 * Method bodies, so a claim about ordering can be checked structurally
 * ---------------------------------------------------------------------------
 */

const parseServiceAccountJsonBody: string = sliceBetween(
  clientSource,
  "public static parseServiceAccountJson(",
  "public getApiBaseUrl(",
);
const getApiBaseUrlBody: string = sliceBetween(
  clientSource,
  "public getApiBaseUrl(",
  "private async getAccessToken(",
);
const getAccessTokenBody: string = sliceBetween(
  clientSource,
  "private async getAccessToken(",
  "public async fetchDetectionAlerts(",
);
const fetchDetectionAlertsBody: string = sliceBetween(
  clientSource,
  "public async fetchDetectionAlerts(",
  "public static extractAlerts(",
);

const pollAllDueConnectionsBody: string = sliceBetween(
  pollerSource,
  "public static async pollAllDueConnections(",
  "public static async pollConnection(",
);
const pollConnectionBody: string = sliceBetween(
  pollerSource,
  "public static async pollConnection(",
  "public static async executeConnection(",
);
const executeUnlockedBody: string = sliceBetween(
  pollerSource,
  "private static async executeUnlocked(",
  "private static planPollCursor(",
);
const planPollCursorBody: string = sliceBetween(
  pollerSource,
  "private static planPollCursor(",
  "private static async ingest(",
);
const ingestBody: string = pollerSource.slice(
  indexOfOrThrow(pollerSource, "private static async ingest("),
);
/* The first try in executeUnlocked is the one around the whole run. */
const executeUnlockedTryBlock: string = firstBalancedBlock(
  executeUnlockedBody,
  "try {",
);
const executeUnlockedCatchBlock: string = firstBalancedBlock(
  executeUnlockedBody,
  "catch (error)",
);

const resolveSettingsBody: string = sliceBetween(
  connectorSource,
  "private static resolveSettings(",
  "public validateSettings(",
);
const fetchEventsBody: string = sliceBetween(
  connectorSource,
  "public async fetchEvents(",
  "private static readBound(",
);
const recordPassBody: string = sliceBetween(
  connectorSource,
  "private static recordPass(",
  "private static budgetName(",
);
const budgetNameBody: string = sliceBetween(
  connectorSource,
  "private static budgetName(",
  "private static notRunReason(",
);
const fetchWindowsBody: string = sliceBetween(
  connectorSource,
  "private static async fetchWindows(",
  "private static async searchPass(",
);
const searchPassBody: string = sliceBetween(
  connectorSource,
  "private static async searchPass(",
  "private static budgetStop(",
);

const enqueueBody: string = sliceBetween(
  executorSource,
  "public static async enqueue(",
  "public static async executeRun(",
);
const executeRunBody: string = sliceBetween(
  executorSource,
  "public static async executeRun(",
  "private static getRecordedPollResult(",
);
const enqueueDueConnectionsBody: string = sliceBetween(
  executorSource,
  "public static async enqueueDueConnections(",
  "private static async release(",
);
/* The stale-run sweep before it has a try of its own; only the poll loop matters. */
const enqueueDueConnectionsLoop: string = enqueueDueConnectionsBody.slice(
  indexOfOrThrow(
    enqueueDueConnectionsBody,
    "for (const connection of connections)",
  ),
);

/*
 * Which prefix belongs to which step is read off the method that throws
 * it, never assumed from the wording — that is precisely the mapping the
 * guidance claims and therefore the thing under test.
 */
const tokenExchangePrefix: string = httpErrorPrefixes.find(
  (prefix: string): boolean => {
    return getAccessTokenBody.includes(prefix);
  },
) as string;

const alertsFetchPrefix: string = httpErrorPrefixes.find(
  (prefix: string): boolean => {
    return fetchDetectionAlertsBody.includes(prefix);
  },
) as string;

/*
 * ---------------------------------------------------------------------------
 * The two guidance texts
 * ---------------------------------------------------------------------------
 */

/*
 * The Troubleshooting section and the 400 walkthrough after it, ending where
 * the upgrade notes begin: those quote the migration and the API, not
 * connector messages, and are checked on their own below.
 */
const docsSectionEndIndex: number = indexOfOrThrow(
  docsSource,
  "\n### Upgrading from the earlier Google SecOps connector",
  indexOfOrThrow(docsSource, "### Troubleshooting"),
);

/* The pre-GA callout through the end of the Troubleshooting material. */
const docsGuidance: string = docsSource.slice(
  indexOfOrThrow(docsSource, "> The connector uses the Chronicle"),
  docsSectionEndIndex,
);

/* Just the Last Error bullet and everything after it in that material. */
const docsLastErrorGuidance: string = docsSource
  .slice(
    indexOfOrThrow(docsSource, "- **Last Error is populated**"),
    docsSectionEndIndex,
  )
  .trim();

/* The in-product help, as the markdown string it evaluates to. */
const pageGuidance: string = readTemplateLiteral(
  providerHelpSource,
  "const googleSecOpsDocumentationMarkdown: string = `",
);

const pageLastErrorGuidance: string = extractBulletBlock(
  pageGuidance,
  "- **Last Error** ",
);

interface GuidanceText {
  name: string;
  whole: string;
  lastError: string;
}

const guidanceTexts: Array<GuidanceText> = [
  {
    name: "the integration doc",
    whole: docsGuidance,
    lastError: docsLastErrorGuidance,
  },
  {
    name: "the in-product help",
    whole: pageGuidance,
    lastError: pageLastErrorGuidance,
  },
];

interface ForbiddenClaim {
  pattern: RegExp;
  wording: string;
}

/*
 * Each entry is the EXACT wording a review found to be false, kept here
 * so a future edit cannot quietly reintroduce it. These are not stylistic
 * preferences — every one of them is a factual claim the code contradicts.
 */
const FORBIDDEN_CLAIMS: Array<ForbiddenClaim> = [
  {
    /*
     * "**Last Error** carries verbatim whatever the Chronicle API returned"
     * and "The field carries the API's own message verbatim." The stored
     * value has a synthetic prefix and credential redaction; never verbatim.
     */
    pattern: /\bverbatim\b/i,
    wording: "Last Error carries the API's message verbatim",
  },
  {
    /*
     * "the connection's **Last Error** field says exactly what the API
     * returned" — credentials are redacted and a step prefix is added.
     */
    pattern: /exactly what the[^.]{0,40}API returned/i,
    wording: "Last Error says exactly what the API returned",
  },
  {
    // The same claim phrased as ownership of the message.
    pattern: /the API's own message/i,
    wording: "the field carries the API's own message",
  },
  {
    /*
     * "**Last Error is populated** — the poll ran and Chronicle rejected
     * it." A token-exchange failure never reaches Chronicle, and a
     * telemetry-store failure happens after Chronicle answered fine.
     */
    pattern: /the poll ran and Chronicle rejected it/i,
    wording: "a populated Last Error means Chronicle rejected the poll",
  },
  {
    /*
     * "Anything else — read the message rather than assume a side ...
     * Otherwise the alerts arrived and the failure was on OneUptime's
     * side." That arm keyed on the HTTP status, so every status-less
     * message fell into it — including the in-band rejection, which is
     * Chronicle's own and carries no status anywhere in it. See the
     * taxonomy below for what replaced it.
     */
    pattern: /rather than assume a side/i,
    wording:
      "an 'anything else' arm that absorbs the status-less Google failures",
  },
  {
    /*
     * The retired Google SecOps poller's own validation message. The shared
     * poller never throws it, so quoting it sends the reader looking for a
     * message no connection can show.
     */
    pattern:
      /Google SecOps connection is missing id, projectId, region, instance, or credentials/,
    wording: "the retired poller's missing-row message",
  },
];

/*
 * ---------------------------------------------------------------------------
 * The failure taxonomy, and the decision the old tripwire deferred
 * ---------------------------------------------------------------------------
 *
 * This block replaces `expect(clientNonHttpMessages.length).toBe(2)`. That
 * assertion was a placeholder: it recorded that exactly two messages carried
 * no HTTP status, and said a third would mean "someone has to decide which
 * bucket it belongs to". The client throws ten of them now, so the decision
 * is made here.
 *
 * The old split keyed on the STATUS — token exchange failed, alerts fetch
 * failed, anything else is OneUptime's. That is what made a status-less
 * message ambiguous, and it is wrong at the root: Chronicle validates a
 * query in band and answers HTTP 200 with the rejection in the body, so the
 * most purely Google-side failure the connector has carries no status at
 * all. The discriminator is the STEP the prefix names, not whether a status
 * follows it.
 *
 * The buckets below therefore key on the prefix, and each one is a different
 * thing for the operator to do:
 *
 *   1. token exchange failed (HTTP ...) — the credential was rejected at the
 *      OAuth endpoint out of the customer's own service-account JSON, before
 *      Chronicle. Fix the key.
 *   2. token exchange returned ... — that endpoint answered with something
 *      unusable. Still before Chronicle, but the key is not the suspect;
 *      something is answering in its place.
 *   3. alerts fetch failed (HTTP ...) — Chronicle rejected the request.
 *      Read the status.
 *   4. alerts fetch returned ... — Chronicle answered 200 and the body was
 *      not a readable stream. Google's answer, with no status to read.
 *   5. alerts query was rejected on an HTTP 200 — Chronicle ran the request
 *      and rejected the query itself. The case that proves "no status"
 *      cannot mean "not Google's".
 *   6. timed out — nothing answered. No side is attributable from the
 *      message, which is an answer rather than a default into a bucket.
 *
 * Everything matching none of them did not come from Google, and that arm is
 * defined by matching none of them rather than by lacking a status. It owns
 * the settings rejections the connector words after the field, and the
 * telemetry-store write that follows a good fetch.
 *
 * The buckets are asserted to PARTITION what the client throws: every
 * message matches exactly one, and every bucket claims at least one. A new
 * shape therefore still breaks this file — but it breaks it with the
 * question already answered for the ones that exist.
 */

interface MessageBucket {
  /* How the bucket is named when an assertion about it fails. */
  name: string;
  /* Matches the client message templates that belong to it, as written. */
  matches: RegExp;
  /*
   * Where the message is evidence about. "google" holds even with no HTTP
   * status; "unknown" means the message is evidence about neither side.
   */
  side: "google" | "unknown";
  /* The span both texts must quote as inline code for this bucket. */
  quoted: string;
  /* What each text must say about it, checked over that bucket's segment. */
  explains: RegExp;
}

const MESSAGE_BUCKETS: Array<MessageBucket> = [
  {
    name: "the OAuth endpoint rejecting the credential",
    matches: /^Google token exchange failed \(HTTP /,
    side: "google",
    quoted: "Google token exchange failed (HTTP ...)",
    explains: /before Chronicle/i,
  },
  {
    name: "the OAuth endpoint answering with something unusable",
    matches: /^Google token exchange returned /,
    side: "google",
    quoted: "Google token exchange returned ...",
    explains: /before Chronicle/i,
  },
  {
    /*
     * The created-time passes a poll runs first (legacySearchDetections
     * and legacySearchCuratedDetections). Same shape as the alerts fetch
     * buckets, reached earlier in a poll.
     */
    name: "Chronicle rejecting the detections search",
    matches: /^Google SecOps detections search failed \(HTTP /,
    side: "google",
    quoted: "Google SecOps detections search failed (HTTP ...)",
    explains: /Chronicle[^.]*reject/i,
  },
  {
    name: "Chronicle answering the detections search with an unreadable body",
    matches: /^Google SecOps detections search returned /,
    side: "google",
    quoted: "Google SecOps detections search returned ...",
    explains: /Chronicle answered .?200/i,
  },
  {
    /*
     * The curated pass's count, which names the curated rules to search:
     * legacySearchCuratedDetections has no wildcard. Reached after the
     * rule search and before the alerts view.
     */
    name: "Chronicle rejecting the curated rule counts",
    matches: /^Google SecOps curated rule detection counts failed \(HTTP /,
    side: "google",
    quoted: "Google SecOps curated rule detection counts failed (HTTP ...)",
    explains: /Chronicle[^.]*reject/i,
  },
  {
    name: "Chronicle answering the curated rule counts with an unreadable body",
    matches: /^Google SecOps curated rule detection counts returned /,
    side: "google",
    quoted: "Google SecOps curated rule detection counts returned ...",
    explains: /Chronicle answered .?200/i,
  },
  {
    name: "Chronicle rejecting the alerts request",
    matches: /^Google SecOps alerts fetch failed \(HTTP /,
    side: "google",
    quoted: "Google SecOps alerts fetch failed (HTTP ...)",
    explains: /Chronicle[^.]*reject/i,
  },
  {
    name: "Chronicle answering 200 with an unreadable body",
    matches: /^Google SecOps alerts fetch returned /,
    side: "google",
    quoted: "Google SecOps alerts fetch returned ...",
    explains: /Chronicle answered .?200/i,
  },
  {
    name: "Chronicle rejecting the query in band on a 200",
    matches:
      /^Google SecOps alerts query was rejected by Chronicle on an HTTP 200/,
    side: "google",
    quoted:
      "Google SecOps alerts query was rejected by Chronicle on an HTTP 200",
    explains: /no HTTP status/i,
  },
  {
    name: "neither endpoint answering at all",
    matches: /^Google SecOps \$\{stepLabel\} timed out /,
    side: "unknown",
    quoted: `timed out after ${requestTimeoutInSeconds} seconds with no response`,
    explains: /assigns no side/i,
  },
];

/* How both texts introduce the arm that did not come from Google. */
const ONEUPTIME_ARM_MARKER: string = "A message matching none of the above";

// ---------------------------------------------------------------------------

describe("Google SecOps Last Error guidance does not overclaim", () => {
  for (const guidance of guidanceTexts) {
    test(`${guidance.name} contains none of the wording the review found false`, () => {
      for (const claim of FORBIDDEN_CLAIMS) {
        expect({
          claim: claim.wording,
          matched: claim.pattern.test(guidance.whole),
        }).toEqual({ claim: claim.wording, matched: false });
      }
    });

    /*
     * The rewritten texts DO say "Chronicle itself rejected the request",
     * but only inside the bucket for the alerts-fetch prefix, where it is
     * true. What must never come back is the unscoped version: an
     * attribution to Chronicle made BEFORE the reader has been told to
     * look at the prefix. So the check runs on the lead — everything up to
     * the first prefix the text quotes.
     */
    test(`${guidance.name} blames Chronicle only after it names a prefix`, () => {
      const firstPrefixIndex: number = Math.min(
        ...httpErrorPrefixes.map((prefix: string): number => {
          const index: number = guidance.lastError.indexOf(prefix);

          return index === -1 ? guidance.lastError.length : index;
        }),
      );

      const lead: string = guidance.lastError.slice(0, firstPrefixIndex);

      // The prefixes really are quoted later, so the lead is a real cut.
      expect(firstPrefixIndex).toBeGreaterThan(0);
      expect(firstPrefixIndex).toBeLessThan(guidance.lastError.length);

      // And the lead teaches the prefix, rather than an attribution.
      expect(lead.toLowerCase()).toContain("prefix");

      for (const sentence of lead.split(SENTENCE_SPLIT_PATTERN)) {
        const blamesChronicle: boolean =
          CHRONICLE_MENTION_PATTERN.test(sentence) &&
          REJECTION_MENTION_PATTERN.test(sentence);

        expect({
          sentence: sentence,
          blamesChronicle: blamesChronicle,
        }).toEqual({ sentence: sentence, blamesChronicle: false });
      }
    });
  }
});

describe("Every error prefix the guidance names is really produced", () => {
  test("the client's HTTP error templates yield distinct, non-empty prefixes", () => {
    expect(httpErrorPrefixes.length).toBeGreaterThan(0);
    expect(new Set(httpErrorPrefixes).size).toBe(httpErrorPrefixes.length);

    for (const prefix of httpErrorPrefixes) {
      expect(prefix.length).toBeGreaterThan(0);
    }

    // The two the guidance's taxonomy hangs on both resolved, and differ.
    expect(tokenExchangePrefix).toBeTruthy();
    expect(alertsFetchPrefix).toBeTruthy();
    expect(tokenExchangePrefix).not.toBe(alertsFetchPrefix);
  });

  for (const guidance of guidanceTexts) {
    /*
     * Direction one: nothing quoted as a connector error message is
     * invented. The docs render the status as `(HTTP ...)`, so that tail
     * is stripped before the comparison — and the client template is then
     * checked to really continue with " (HTTP " at that point, so the
     * stripping cannot hide a mismatch.
     */
    test(`${guidance.name} quotes only messages the connector actually throws`, () => {
      const quoted: Array<string> = matchAllGroups(
        GUIDANCE_QUOTED_MESSAGE_PATTERN,
        guidance.lastError,
      ).map((groups: Array<string>): string => {
        return groups[1] as string;
      });

      expect(quoted.length).toBeGreaterThan(0);

      for (const span of quoted) {
        const prefix: string = normalizeQuotedSpan(span);
        const match: { prefix: string; template: string } | undefined =
          clientHttpErrorPrefixByTemplate.find(
            (entry: { prefix: string; template: string }): boolean => {
              return entry.prefix === prefix;
            },
          );

        /*
         * A quoted span is legitimate if it is the static prefix of an
         * HTTP-status template, or the start of any other message the
         * client, the shared poller or the connector throws.
         */
        const isThrownMessage: boolean = connectorThrownMessages.some(
          (message: string): boolean => {
            return message.startsWith(prefix);
          },
        );

        expect({
          quoted: span,
          isThrownByTheConnector: Boolean(match) || isThrownMessage,
        }).toEqual({
          quoted: span,
          isThrownByTheConnector: true,
        });

        if (span !== prefix && match) {
          // The docs elided a status here; the client really puts one there.
          expect(match.template).toContain(`${prefix}${HTTP_TAIL_MARKER}`);
        }
      }
    });

    /*
     * Direction two: a newly added HTTP error shape cannot slip past the
     * taxonomy unmentioned. Every HTTP template the client can throw has to
     * be named by name in both texts.
     *
     * Containment, not equality: the guidance also names status-less
     * messages by choice (see above), so the quoted set is legitimately a
     * superset.
     */
    test(`${guidance.name} accounts for every HTTP error the client can throw`, () => {
      const quotedPrefixes: Set<string> = new Set(
        matchAllGroups(GUIDANCE_QUOTED_MESSAGE_PATTERN, guidance.lastError).map(
          (groups: Array<string>): string => {
            return normalizeQuotedSpan(groups[1] as string);
          },
        ),
      );

      const missing: Array<string> = Array.from(
        new Set(httpErrorPrefixes),
      ).filter((prefix: string): boolean => {
        return !quotedPrefixes.has(prefix);
      });

      expect(missing).toEqual([]);
    });

    /*
     * The taxonomy is ordered the way a poll runs — credentials first,
     * Chronicle second — because that is the order an operator should rule
     * the causes out in.
     */
    test(`${guidance.name} lists the prefixes in the order a poll reaches them`, () => {
      expect(guidance.lastError.indexOf(tokenExchangePrefix)).toBeGreaterThan(
        -1,
      );
      expect(guidance.lastError.indexOf(tokenExchangePrefix)).toBeLessThan(
        guidance.lastError.indexOf(alertsFetchPrefix),
      );
    });

    test(`${guidance.name} attributes each prefix to the right side`, () => {
      const tokenIndex: number =
        guidance.lastError.indexOf(tokenExchangePrefix);
      const alertsIndex: number = guidance.lastError.indexOf(alertsFetchPrefix);

      const tokenSegment: string = guidance.lastError.slice(
        tokenIndex,
        alertsIndex,
      );
      const alertsSegment: string = guidance.lastError.slice(alertsIndex);

      // The token failure is explicitly placed BEFORE Chronicle.
      expect(tokenSegment).toMatch(/before Chronicle/i);

      // The alerts failure is where blaming Chronicle is correct.
      expect(alertsSegment).toMatch(/Chronicle/i);
      expect(alertsSegment).toMatch(/reject/i);
    });

    /*
     * The lead's own claim, and the reason the taxonomy can key on the
     * prefix at all: only four of the client's messages carry a status
     * (token exchange, detections search, curated rule counts, alerts
     * fetch), so "no status" is
     * not a discriminator worth reading anything into.
     */
    test(`${guidance.name} says how many prefixes carry a status, correctly`, () => {
      expect(clientHttpErrorTemplates.length).toBe(4);
      expect(new Set(httpErrorPrefixes).size).toBe(4);
      expect(guidance.lastError).toMatch(
        /only four prefixes carry an HTTP status/i,
      );
    });

    test(`${guidance.name} walks every bucket, in the order a poll reaches them`, () => {
      let previousIndex: number = -1;

      for (const bucket of MESSAGE_BUCKETS) {
        const index: number = guidance.lastError.indexOf(bucket.quoted);

        expect({
          bucket: bucket.name,
          quoted: bucket.quoted,
          named: index > -1,
        }).toEqual({ bucket: bucket.name, quoted: bucket.quoted, named: true });

        // Quoted as inline code, so an operator can match it character for character.
        expect(guidance.lastError).toContain(`\`${bucket.quoted}\``);

        expect(index).toBeGreaterThan(previousIndex);
        previousIndex = index;
      }
    });

    test(`${guidance.name} says what each bucket means`, () => {
      const armIndex: number = guidance.lastError.indexOf(ONEUPTIME_ARM_MARKER);

      expect(armIndex).toBeGreaterThan(-1);

      MESSAGE_BUCKETS.forEach(
        (bucket: MessageBucket, position: number): void => {
          const next: MessageBucket | undefined = MESSAGE_BUCKETS[position + 1];
          const start: number = guidance.lastError.indexOf(bucket.quoted);
          const end: number = next
            ? guidance.lastError.indexOf(next.quoted)
            : armIndex;

          expect({
            bucket: bucket.name,
            explained: bucket.explains.test(
              guidance.lastError.slice(start, end),
            ),
          }).toEqual({ bucket: bucket.name, explained: true });
        },
      );
    });

    /*
     * The arm that is not Google's has to be present — it is the one the old
     * prose erased — but it must be reached by ruling the Google buckets
     * out, not by noticing that a message carries no status.
     */
    test(`${guidance.name} defines the OneUptime-side arm by exclusion, not by a missing status`, () => {
      const armIndex: number = guidance.lastError.indexOf(ONEUPTIME_ARM_MARKER);

      expect(armIndex).toBeGreaterThan(-1);

      for (const bucket of MESSAGE_BUCKETS) {
        expect({
          bucket: bucket.name,
          namedBeforeTheOneUptimeArm:
            guidance.lastError.indexOf(bucket.quoted) < armIndex,
        }).toEqual({ bucket: bucket.name, namedBeforeTheOneUptimeArm: true });
      }

      const arm: string = guidance.lastError.slice(armIndex);

      expect(arm).toMatch(/OneUptime/i);
      expect(arm).toMatch(/telemetry store/i);
    });
  }

  /*
   * "before Chronicle was ever contacted" is a claim about control flow,
   * so it is checked as one: the token exchange POSTs to the tokenUri out
   * of the customer's own service-account JSON, and fetchDetectionAlerts
   * awaits it before it so much as builds the Chronicle URL.
   */
  test("the token exchange really happens before Chronicle is contacted", () => {
    expect(getAccessTokenBody).toContain("this.credentials.tokenUri");
    expect(getAccessTokenBody).not.toContain("getApiBaseUrl");
    expect(getAccessTokenBody).toContain(tokenExchangePrefix);

    const tokenCallIndex: number = fetchDetectionAlertsBody.indexOf(
      "await this.getAccessToken()",
    );
    const chronicleUrlIndex: number = fetchDetectionAlertsBody.indexOf(
      "this.getApiBaseUrl()",
    );

    expect(tokenCallIndex).toBeGreaterThan(-1);
    expect(chronicleUrlIndex).toBeGreaterThan(-1);
    expect(tokenCallIndex).toBeLessThan(chronicleUrlIndex);

    // The endpoints really are different hosts, not two paths on Chronicle.
    const defaultTokenUri: string = requireGroup(
      DEFAULT_TOKEN_URI_PATTERN,
      parseServiceAccountJsonBody,
      "the default token_uri",
    );
    const apiBaseUrlTemplate: string = requireGroup(
      API_BASE_URL_TEMPLATE_PATTERN,
      getApiBaseUrlBody,
      "the Chronicle API base URL template",
    );

    expect(defaultTokenUri).toContain("oauth2");
    expect(defaultTokenUri).not.toContain("chronicle");
    expect(apiBaseUrlTemplate).toContain("chronicle.googleapis.com");
  });

  test("the alerts fetch really is the Chronicle request", () => {
    expect(fetchDetectionAlertsBody).toContain(alertsFetchPrefix);
    expect(fetchDetectionAlertsBody).not.toContain(tokenExchangePrefix);
  });

  /*
   * The detections search is the third HTTP prefix and the first Chronicle
   * request a poll makes; it too builds the Chronicle URL only after the
   * token exchange has been awaited.
   */
  test("the detections search really is a Chronicle request made after the token exchange", () => {
    const searchDetectionsBody: string = sliceBetween(
      clientSource,
      "public async searchDetections(",
      "private clearCachedAccessToken(",
    );
    const searchPrefix: string = httpErrorPrefixes.find(
      (prefix: string): boolean => {
        return searchDetectionsBody.includes(prefix);
      },
    ) as string;

    expect(searchPrefix).toBeTruthy();
    expect(searchPrefix).not.toBe(tokenExchangePrefix);
    expect(searchPrefix).not.toBe(alertsFetchPrefix);
    expect(
      searchDetectionsBody.indexOf("await this.getAccessToken()"),
    ).toBeLessThan(searchDetectionsBody.indexOf("this.getApiBaseUrl()"));
    expect(searchDetectionsBody).toContain("legacySearchDetections");
    expect(searchDetectionsBody).toContain("legacySearchCuratedDetections");
  });

  /*
   * The client's prefix only reaches Last Error if nothing between the
   * client and the column rewrites it. The connector rethrows the ORIGINAL
   * error from a failed pass, only attaching the pass checks and the
   * partial-fetch summary to it, and both helpers that attach them return
   * the same object.
   */
  test("the connector hands a pass failure to the poller with its prefix intact", () => {
    const [catchBlock]: Array<string> = extractBalancedBlocks(
      fetchEventsBody.slice(indexOfOrThrow(fetchEventsBody, "} catch (error)")),
      "catch (error)",
    );
    const squashedCatch: string = catchBlock!.replace(/\s+/g, " ");

    expect(squashedCatch).toContain(
      "throw attachConnectorFetchSummary( attachConnectorChecks(error, [...run.checks]),",
    );
    // Nothing else is thrown: no wrapper error replaces the original.
    expect(squashedCatch.match(/\bthrow\b/g)).toHaveLength(1);
    expect(squashedCatch).not.toContain("new ");

    const attachChecksBody: string = sliceBetween(
      connectorTypesSource,
      "export function attachConnectorChecks<T>(",
      "export function readConnectorChecks(",
    );
    const attachSummaryBody: string = sliceBetween(
      connectorTypesSource,
      "export function attachConnectorFetchSummary<T>(",
      "function isNonNegativeCount(",
    );

    for (const body of [attachChecksBody, attachSummaryBody]) {
      expect(body).toContain("Object.defineProperty(error,");
      expect(body).toContain("return error;");
    }
  });

  /*
   * The arm's headline claim — "the detections arrived and the failure was
   * on OneUptime's side, usually writing them to the telemetry store" — is
   * only true if the telemetry-store write happens after a successful fetch,
   * inside the same try whose catch records Last Error. That is now the
   * shared poller's executeUnlocked, which every scheduled poll reaches
   * through the run executor.
   */
  test("a telemetry-store failure really reaches Last Error after a good fetch", () => {
    const fetchIndex: number = executeUnlockedTryBlock.indexOf(
      "await connector.fetchEvents(",
    );
    const insertIndex: number =
      executeUnlockedTryBlock.indexOf("await this.ingest(");

    expect(fetchIndex).toBeGreaterThan(-1);
    expect(insertIndex).toBeGreaterThan(fetchIndex);
    expect(ingestBody).toContain("await SecurityEventService.insertJsonRows(");
    expect(executeUnlockedCatchBlock).toContain('result.status = "failed"');
    expect(executeUnlockedCatchBlock).toContain(
      "result.error = redactLogString(",
    );
    expect(executeUnlockedCatchBlock).toContain(
      "ConnectorErrorMessage.toMessage(",
    );
    expect(executeUnlockedBody).toContain("lastError: (result.error ||");
    expect(executeUnlockedBody.indexOf("lastError:")).toBeGreaterThan(
      executeUnlockedBody.indexOf(executeUnlockedCatchBlock),
    );
    expect(pollConnectionBody).toContain("await this.executeConnection(");
    expect(pollConnectionBody).toContain(
      "throw new RecordedConnectionPollFailure(",
    );
    expect(executeRunBody).toContain(
      "await SecurityEventConnectionPoller.executeConnection(",
    );
  });

  /*
   * The partition. Every message the client throws belongs to exactly one
   * bucket, so a new shape cannot quietly inherit whatever the taxonomy
   * happens to say last.
   */
  test("every message the client throws lands in exactly one bucket", () => {
    expect(clientThrownMessages.length).toBeGreaterThan(0);

    for (const message of clientThrownMessages) {
      const claimed: Array<string> = MESSAGE_BUCKETS.filter(
        (bucket: MessageBucket): boolean => {
          return bucket.matches.test(message);
        },
      ).map((bucket: MessageBucket): string => {
        return bucket.name;
      });

      expect({ message: message, buckets: claimed }).toEqual({
        message: message,
        buckets: [claimed[0]],
      });
    }
  });

  test("no bucket is dead weight", () => {
    for (const bucket of MESSAGE_BUCKETS) {
      const owned: number = clientThrownMessages.filter(
        (message: string): boolean => {
          return bucket.matches.test(message);
        },
      ).length;

      expect({ bucket: bucket.name, hasMessages: owned > 0 }).toEqual({
        bucket: bucket.name,
        hasMessages: true,
      });
    }
  });

  /*
   * The decision itself, which is what the old `.toBe(2)` tripwire was
   * holding open. The COUNT of status-less messages is free now; what is
   * pinned is that not one of them falls through to the OneUptime arm.
   */
  test("no status-less message defaults into the OneUptime-side arm", () => {
    expect(clientNonHttpMessages.length).toBeGreaterThan(0);

    for (const message of clientNonHttpMessages) {
      const bucket: MessageBucket | undefined = MESSAGE_BUCKETS.find(
        (candidate: MessageBucket): boolean => {
          return candidate.matches.test(message);
        },
      );

      /*
       * MessageBucket has no OneUptime side to declare — that arm is
       * reached by matching no bucket at all — so a message the taxonomy
       * has nothing to say about shows up here as the one value the union
       * cannot hold.
       */
      expect({
        message: message,
        startsWithGoogle: message.startsWith("Google"),
        side: bucket ? bucket.side : "OneUptime by default",
      }).toEqual({
        message: message,
        startsWithGoogle: true,
        side: expect.stringMatching(/^(?:google|unknown)$/),
      });

      expect(message).not.toContain(HTTP_STATUS_INTERPOLATION);
    }
  });
});

/*
 * The retired poller's guidance also quoted messages that were not Google's
 * — its missing-row check and its source-lock skip — by name. The shared
 * framework words those differently, and some of them now land on a run in
 * history rather than on the connection. Whatever the texts quote outside
 * the Google buckets must still be text the framework really produces.
 */
describe("Messages the guidance quotes outside the Google buckets are really produced", () => {
  interface ProducedMessage {
    quoted: string;
    producer: string;
    source: string;
  }

  const PRODUCED_MESSAGES: Array<ProducedMessage> = [
    {
      // The forced-advance warning, which leads Last Error.
      quoted: "More records were created in the one minute from",
      producer: "SecurityEventConnectionPoller.planPollCursor",
      source: planPollCursorBody,
    },
    {
      // Source-lock contention, recorded on the run the executor was running.
      quoted:
        "Another poll or import for this source is still running in this project",
      producer: "SecurityEventConnectionPoller.executeConnection",
      source: pollerSource,
    },
    {
      // The only Last Error write that is not a poll's own.
      quoted: "Scheduler could not queue a poll:",
      producer: "SecurityEventConnectionRunExecutor.enqueueDueConnections",
      source: enqueueDueConnectionsBody,
    },
  ];

  for (const produced of PRODUCED_MESSAGES) {
    test(`${produced.producer} produces "${produced.quoted}"`, () => {
      expect(produced.source).toContain(produced.quoted);
    });

    for (const guidance of guidanceTexts) {
      test(`${guidance.name} quotes "${produced.quoted}" as inline code`, () => {
        expect(guidance.whole).toContain(`\`${produced.quoted}\``);
      });
    }
  }

  /*
   * The lock message is thrown before executeUnlocked runs, so a scheduled
   * poll that hits it fails its RUN and never touches the connection. The
   * texts put it under "Never" and point at run history; this is the code
   * path that makes that placement right.
   */
  test("a source-lock skip is recorded on the run, not on the connection", () => {
    const executeConnectionBody: string = sliceBetween(
      pollerSource,
      "public static async executeConnection(",
      "private static validateConnection(",
    );
    const lockIndex: number = executeConnectionBody.indexOf(
      "Another poll or import for this source is still running in this project",
    );

    expect(lockIndex).toBeGreaterThan(-1);
    expect(lockIndex).toBeLessThan(
      executeConnectionBody.indexOf("this.executeUnlocked(current"),
    );
    expect(docsGuidance).toContain("is a failed run in that history instead");
  });

  /*
   * The arm says a message beginning with a field name is the saved
   * settings failing validation. True by construction only while every
   * settings rule in the connector opens with the catalog title of its
   * field, and while the poller validates inside the try that records Last
   * Error.
   */
  test("a settings rejection opens with the field title the guidance names", () => {
    expect(executeUnlockedTryBlock).toContain(
      "connector.validateSettings(settings);",
    );
    expect(connectorSource).toContain(
      "GoogleSecOpsConnector.resolveSettings(settings);",
    );
    expect(connectorSource).toContain(
      "message.startsWith(title) ? message : `${title}: ${message}`",
    );

    for (const field of googleSecOpsFields) {
      expect(resolveSettingsBody).toContain(
        `\${this.fieldTitle("${field.key}")} is required.`,
      );
    }

    const checkedRules: number = countOccurrences(
      resolveSettingsBody,
      "this.checkField(",
    );

    // Every client rule the settings go through is wrapped in checkField.
    expect(checkedRules).toBeGreaterThan(0);
    expect(countOccurrences(resolveSettingsBody, "GoogleSecOpsClient.")).toBe(
      checkedRules,
    );

    for (const guidance of guidanceTexts) {
      const arm: string = guidance.lastError.slice(
        indexOfOrThrow(guidance.lastError, ONEUPTIME_ARM_MARKER),
      );

      for (const field of googleSecOpsFields) {
        expect({
          text: guidance.name,
          field: field.title,
          quoted: arm.includes(`\`${field.title}\``),
        }).toEqual({
          text: guidance.name,
          field: field.title,
          quoted: true,
        });
      }
    }
  });
});

/*
 * An explicit pageSize rejection identifies a request-contract mismatch.
 * The correction predates this change, so the next diagnostic step is to
 * inspect deployed images. Credential acceptance must be established from
 * a successful token exchange, without assuming authentication ordering
 * from a parameter-binding error.
 */
describe("the pageSize 400 points to the deployed request parameters", () => {
  const PAGE_SIZE_ERROR_TEXT: string =
    'Unknown name "pageSize": Cannot bind query parameter';

  test("the alerts request no longer binds pageSize", () => {
    const [parameterBlock]: Array<string> = extractBalancedBlocks(
      fetchDetectionAlertsBody,
      "new URLSearchParams(",
    );

    expect(parameterBlock).toBeTruthy();

    const boundNames: Array<string> = matchAllGroups(
      QUOTED_KEY_PATTERN,
      parameterBlock as string,
    ).map((groups: Array<string>): string => {
      return groups[1] as string;
    });

    expect(boundNames.length).toBeGreaterThan(0);
    expect(boundNames).not.toContain("pageSize");

    // ...and nothing sets it back onto the query afterwards either.
    expect(fetchDetectionAlertsBody).not.toContain('params.set("pageSize"');
  });

  test("the client recognizes this 400 and blames itself for it", () => {
    const unknownFieldPattern: RegExp = new RegExp(
      requireGroup(
        UNKNOWN_FIELD_PATTERN_SOURCE,
        clientSource,
        "UNKNOWN_FIELD_PATTERN",
      ),
      "i",
    );

    expect(unknownFieldPattern.test(PAGE_SIZE_ERROR_TEXT)).toBe(true);
    expect(clientSource).toContain(
      "This is a OneUptime bug, not a credential or permission problem.",
    );
  });

  for (const guidance of guidanceTexts) {
    test(`${guidance.name} identifies the existing correction and checks deployed images`, () => {
      expect(guidance.whole).toContain(PAGE_SIZE_ERROR_TEXT);
      expect(guidance.whole).toContain("Upstream **13.0.0** already replaced");
      expect(guidance.whole).toContain("alertListOptions.maxReturnedAlerts");
      expect(guidance.whole).toContain("actual app and worker images");
      expect(guidance.whole).toContain(
        "Rotating the service-account key does not correct an unsupported query parameter.",
      );
      expect(guidance.whole).not.toContain("fixed in this release");
      expect(guidance.whole).not.toContain("resolved in this release");
      expect(guidance.whole).not.toContain("Upgrade and the poll succeeds");
    });

    test(`${guidance.name} distinguishes token acceptance from a parameter rejection`, () => {
      expect(guidance.whole).toContain(
        "A successful OAuth token exchange confirms credential acceptance",
      );
      expect(guidance.whole).toContain(
        "the parameter rejection alone does not establish authentication or authorization",
      );
      expect(guidance.whole).not.toContain(
        "Google authenticates a request before it transcodes",
      );
      expect(guidance.whole).not.toContain("proof the key was accepted");
      expect(guidance.whole).not.toContain(
        "proof the service account was accepted",
      );
    });
  }
});

describe("Full-error guidance matches retention, redaction and copy controls", () => {
  test("the client retains complete HTTP diagnostics with credentials redacted", () => {
    expect(clientSource).not.toMatch(DIAGNOSTIC_SLICE_PATTERN);

    for (const template of clientHttpErrorTemplates) {
      expect(template).toContain(
        "${GoogleSecOpsClient.redactErrorBody(responseText)}",
      );
    }
  });

  test("streamed Google errors retain their structured details", () => {
    const streamErrorFormatter: string = sliceBetween(
      clientSource,
      "private static summarizeErrorObject(",
      "private static isJsonObject(",
    );

    expect(streamErrorFormatter).toContain(
      "JSON.stringify(redactLogValue(error))",
    );
    expect(streamErrorFormatter).toContain("redactLogValue(");
  });

  /*
   * Was: "the SecOps poller bypasses the shared message clamp". The same
   * property now has to hold where a poll's Last Error is written: the
   * shared poller records the run error without the clamp and writes that
   * error to the column, and its direct polling loop stamps the same way.
   */
  test("the shared poller bypasses the shared message clamp and redacts stored failures", () => {
    expect(executeUnlockedCatchBlock).toMatch(RESULT_ERROR_RECORDING_PATTERN);
    expect(executeUnlockedBody).toContain("lastError: (result.error ||");
    expect(pollAllDueConnectionsBody).toMatch(FULL_ERROR_RECORDING_PATTERN);
    expect(connectorErrorMessageSource).toContain("options.truncate === false");
  });

  test("the page implements the documented full-error and copy actions", () => {
    expect(connectionsTableSource).toContain('title: "View Error"');
    expect(connectionsTableSource).not.toContain("View Full Error");
    expect(connectionsTableSource).toContain('label="Copy Error"');
    expect(connectionsTableSource).toContain('aria-label="Full error message"');
  });

  for (const guidance of guidanceTexts) {
    test(`${guidance.name} describes the complete redacted message and how to copy it`, () => {
      expect(guidance.lastError).toContain(
        "complete error message with credentials redacted",
      );
      expect(guidance.lastError).toContain("When a connection has an error");
      expect(guidance.lastError).toContain("**View Error**");
      expect(guidance.lastError).toContain("**Actions** column");
      expect(guidance.lastError).toContain("**Copy Error**");
      expect(guidance.lastError).toContain("in the dialog");
      expect(guidance.lastError).not.toContain("**View Full Error**");
      expect(guidance.lastError).not.toContain("short preview");
      expect(guidance.lastError).not.toMatch(
        OBSOLETE_TRUNCATION_GUIDANCE_PATTERN,
      );
    });
  }

  test("the docs explain that an upgrade cannot recover an already truncated error", () => {
    expect(docsGuidance).toContain(
      "Errors recorded before upgrading may already be truncated",
    );
    expect(docsGuidance).toContain(
      "a subsequent failed poll records the complete message",
    );
  });
});

describe('"Never" really means no poll has finished', () => {
  /*
   * The advice rests on one invariant: an attempted poll always leaves a
   * mark somewhere the texts send the reader. The retired poller checked
   * that inside its own loop. Scheduled polls now go through the run
   * executor, so the marks are: the run row in Diagnostics history, the
   * connection's lastPolledAt stamped together with lastError, or the
   * scheduler's own stamp when not even a run could be queued.
   */
  test("the scheduled path runs every poll through the run executor", () => {
    expect(pollJobSource).toContain(
      "SecurityEventConnectionRunExecutor.enqueueDueConnections()",
    );
    expect(pollJobSource).not.toContain("pollAllDueConnections");
    expect(executeRunBody).toContain(
      "await SecurityEventConnectionPoller.executeConnection(",
    );
  });

  /*
   * A due connection either gets a queued run or a Last Error stamp. The
   * one quiet skip is the admission conflict, which means a run is already
   * queued or running and therefore already visible in history.
   */
  test("the scheduler records a queueing failure through the guard, and only that", () => {
    const catchVariables: Array<string> = matchAllGroups(
      CATCH_CLAUSE_PATTERN,
      enqueueDueConnectionsLoop,
    ).map((groups: Array<string>): string => {
      return groups[1] as string;
    });

    expect(catchVariables.length).toBe(1);

    const catchBlock: string = firstBalancedBlock(
      enqueueDueConnectionsLoop,
      "catch (error)",
    );

    expect(catchBlock).toContain("ConnectorErrorMessage.recordFailure(");
    expect(catchBlock).toContain(
      "lastError: `Scheduler could not queue a poll: ${message}`",
    );
    expect(countOccurrences(catchBlock, "continue;")).toBe(1);
    expect(catchBlock).toContain(
      'message.includes("already has a queued or running operation")',
    );
    expect(enqueueBody).toContain(
      "This connection already has a queued or running operation.",
    );
  });

  /*
   * An admitted poll is a run row before it is a queue job, and a job
   * that cannot be queued fails that row rather than leaving it queued.
   */
  test("an admitted poll is a run row before it is a queue job", () => {
    const createIndex: number = enqueueBody.indexOf(
      "SecurityEventConnectionRunService.create(",
    );
    const addJobIndex: number = enqueueBody.indexOf("Queue.addJob(");

    expect(createIndex).toBeGreaterThan(-1);
    expect(addJobIndex).toBeGreaterThan(createIndex);
    expect(
      firstBalancedBlock(enqueueBody.slice(addJobIndex), "catch {"),
    ).toContain("await this.failRun(");
  });

  /*
   * Everything that can stop a queued poll before it reaches the connection
   * (the source lock, a connection deleted since, the reseller gate) is
   * caught around executeConnection and recorded on the run.
   */
  test("the executor records every failure of a run on that run", () => {
    const catchIndex: number = indexOfOrThrow(
      executeRunBody,
      "} catch (error) {",
    );
    const tryIndex: number = executeRunBody.lastIndexOf("try {", catchIndex);

    expect(tryIndex).toBeGreaterThan(-1);

    const tryText: string = executeRunBody.slice(tryIndex, catchIndex);

    expect(tryText).toContain(
      "await SecurityEventConnectionPoller.executeConnection(",
    );
    expect(tryText).toContain("this.validateOptions(run.request)");

    const catchBlock: string = firstBalancedBlock(
      executeRunBody.slice(catchIndex),
      "catch (error)",
    );

    expect(catchBlock).toContain("await this.failRun(");
  });

  /*
   * Every write that touches lastError in the poller also stamps
   * lastPolledAt in the same object, so no poll can produce "an error but
   * never polled". Read as balanced `data: { ... }` blocks so a key added
   * between them cannot fool a substring search.
   */
  test("every lastError write in the poller stamps lastPolledAt alongside it", () => {
    const lastErrorBlocks: Array<string> = extractBalancedBlocks(
      pollerSource,
      "data: {",
    ).filter((block: string): boolean => {
      return block.includes("lastError");
    });

    // The direct loop's failure stamp and the poll's own write.
    expect(lastErrorBlocks.length).toBe(2);

    for (const block of lastErrorBlocks) {
      expect(block).toContain("lastPolledAt");
    }

    // The poll's write comes after the try and catch, so every outcome reaches it.
    expect(executeUnlockedBody.indexOf("lastError:")).toBeGreaterThan(
      executeUnlockedBody.indexOf(executeUnlockedCatchBlock),
    );
    expect(executeUnlockedBody.indexOf("lastError:")).toBeLessThan(
      executeUnlockedBody.indexOf("return result;"),
    );
  });

  /*
   * The one legitimate "error but never polled": the scheduler could not
   * queue the poll at all. It is the only lastError write outside the
   * poller, and both texts name its prefix so the reader can tell it apart.
   */
  test("the scheduler's stamp is the only lastError write without lastPolledAt, and the texts name it", () => {
    const lastErrorBlocks: Array<string> = extractBalancedBlocks(
      executorSource,
      "data: {",
    ).filter((block: string): boolean => {
      return block.includes("lastError");
    });

    expect(lastErrorBlocks.length).toBe(1);
    expect(lastErrorBlocks[0]).toContain("Scheduler could not queue a poll:");
    expect(lastErrorBlocks[0]).not.toContain("lastPolledAt");

    for (const guidance of guidanceTexts) {
      expect(guidance.whole).toContain("`Scheduler could not queue a poll:`");
    }
  });

  /*
   * Not-due connections skip before an attempt. In the direct loop, a
   * failure the poll already recorded is not recorded a second time.
   */
  test("skip paths either precede the attempt or preserve a recorded failure", () => {
    expect(enqueueDueConnectionsLoop.indexOf("continue;")).toBeGreaterThan(-1);
    expect(enqueueDueConnectionsLoop.indexOf("continue;")).toBeLessThan(
      enqueueDueConnectionsLoop.indexOf("try {"),
    );

    expect(pollAllDueConnectionsBody.indexOf("continue;")).toBeGreaterThan(-1);
    expect(pollAllDueConnectionsBody.indexOf("continue;")).toBeLessThan(
      pollAllDueConnectionsBody.indexOf("try {"),
    );

    const recordedFailureGuard: string = firstBalancedBlock(
      pollAllDueConnectionsBody,
      "if (error instanceof RecordedConnectionPollFailure)",
    );
    expect(recordedFailureGuard).toContain("continue;");
    expect(countOccurrences(pollAllDueConnectionsBody, "continue;")).toBe(2);
    expect(
      pollConnectionBody.indexOf("throw new RecordedConnectionPollFailure("),
    ).toBeGreaterThan(
      pollConnectionBody.indexOf("await this.executeConnection("),
    );
  });

  /*
   * Both loops guard their writes on the connection id, which would be a
   * hole if a row could come back without one. Both queries select _id and
   * the lastPolledAt the due check reads.
   */
  test("the scheduling loops always select the id and stamp columns they need", () => {
    expect(enqueueDueConnectionsBody).toContain("_id: true");
    expect(enqueueDueConnectionsBody).toContain("lastPolledAt: true");
    expect(enqueueDueConnectionsLoop).toContain("!connection.id ||");

    expect(pollAllDueConnectionsBody).toContain("_id: true");
    expect(pollAllDueConnectionsBody).toContain("lastPolledAt: true");
    expect(pollAllDueConnectionsBody).toContain("if (connection.id)");
  });

  test("both texts still tell the operator what Never means", () => {
    expect(docsGuidance).toContain(
      "- **Last Polled is `Never` and Last Error is empty** — no poll has finished for this connection",
    );
    expect(docsGuidance).toContain(
      "the background worker has not executed the poll job at all",
    );
    expect(docsGuidance).toContain("run history");
    expect(pageGuidance).toContain(
      "**Last Polled: Never** means no poll has finished for this connection yet",
    );
    expect(pageGuidance).toContain("run history in **Diagnostics**");
  });
});

/*
 * Review findings alerts-view-budget-pins-cursor-forever and
 * partial-poll-permanent-stall-docs-remediation-false. A window holding
 * more detections than one poll can read used to pin the cursor forever,
 * and the guidance told the reader to narrow the time range or shorten the
 * poll interval, neither of which a scheduled poll can act on. Polling now
 * narrows its window from the same starting point and, for a single minute
 * that still cannot be read, moves past it and names it in Last Error. Both
 * texts must quote those warnings as the shared poller words them and must
 * not bring back the old advice or the scope control the form no longer
 * shows.
 */
const NARROWING_WARNING_FRAGMENTS: Array<string> = [
  "This window holds more records than one poll can read; the next poll reads a ",
  " minute window from the same starting point.",
];
const FORCED_ADVANCE_WARNING_FRAGMENTS: Array<string> = [
  "More records were created in the one minute from ",
  " than one poll can read. Polling moved past this minute so newer records keep arriving; use Import this time range in Diagnostics on this minute to recover what one run can read.",
];
const TIMEOUT_WARNING_FRAGMENTS: Array<string> = [
  "The source did not answer in time for this window; the next poll reads a ",
  " minute window from the same starting point.",
];
/* Imperative interval advice ("Shorten the poll interval"), not a denial of it. */
const SHORTEN_INTERVAL_ADVICE_PATTERN: RegExp =
  /\bshorten the (?:\*\*)?poll interval|shorter poll interval/i;
const SWITCH_SCOPE_PATTERN: RegExp = /switch the scope/i;
const OLD_SCOPE_OPTION_PATTERN: RegExp = /\*\*Alerts and detections\*\*/;

describe("Partial-poll guidance matches what polling does", () => {
  /*
   * The quoted warnings are only true while the poller emits them, so the
   * same fragments are read off the producing source.
   */
  test("the shared poller emits the warnings the guidance quotes", () => {
    for (const fragment of NARROWING_WARNING_FRAGMENTS.concat(
      FORCED_ADVANCE_WARNING_FRAGMENTS,
      TIMEOUT_WARNING_FRAGMENTS,
    )) {
      expect({
        fragment,
        emitted: planPollCursorBody.includes(fragment),
      }).toEqual({
        fragment,
        emitted: true,
      });
    }
  });

  /*
   * "a poll that stops early has no point it can resume from": Google's
   * searches return newest first, so the connector never reports a resume
   * point, and the poller only moves the cursor to one when it is reported.
   * Without it an unfinished window narrows, which is what the texts say.
   */
  test("Google SecOps reports no resume point, so an unfinished window narrows", () => {
    const resultBlock: string = firstBalancedBlock(
      fetchEventsBody.slice(fetchEventsBody.lastIndexOf("return {")),
      "return {",
    );

    expect(resultBlock).toContain("complete: run.complete");
    expect(resultBlock).not.toContain("resumeAfter");
    expect(executeUnlockedBody).toContain(
      "resumeAfter = fetched.complete ? undefined : fetched.resumeAfter;",
    );
    expect(
      planPollCursorBody.indexOf("resumeAfterMs !== undefined"),
    ).toBeLessThan(
      planPollCursorBody.indexOf(NARROWING_WARNING_FRAGMENTS[0] as string),
    );
  });

  /*
   * "A Partial poll also stores its warnings in Last Error": an incomplete
   * poll with no error writes its joined warnings, and a forced advance
   * puts its warning first so it leads the column.
   */
  test("an incomplete poll writes its warnings to Last Error, the forced advance first", () => {
    expect(executeUnlockedBody).toContain('result.warnings.join(" ")');
    expect(planPollCursorBody).toContain("result.warnings.unshift(");
    expect(docsSource).toContain("stores its warnings in **Last Error**");
    expect(pageGuidance).toContain(
      "warnings are also stored in **Last Error**",
    );
  });

  /*
   * The one failure that changes the window: the poller halves it when the
   * error reads as a timeout, and the client's timeout message is one.
   */
  test("a Google SecOps timeout is the failure that halves the next window", () => {
    const pollerTimeoutPattern: RegExp = new RegExp(
      requireGroup(
        POLLER_TIMEOUT_PATTERN_SOURCE,
        pollerSource,
        "TIMEOUT_ERROR_PATTERN",
      ),
      "i",
    );
    const clientTimeoutTemplate: string = requireGroup(
      CLIENT_TIMEOUT_TEMPLATE_PATTERN,
      clientSource,
      "the client's timeout message",
    );

    expect(pollerTimeoutPattern.test(clientTimeoutTemplate)).toBe(true);

    for (const fragment of TIMEOUT_WARNING_FRAGMENTS) {
      expect(docsSource).toContain(fragment);
    }

    expect(pageGuidance).toContain(
      "a request that timed out halves the next window",
    );
  });

  const partialGuidanceTexts: Array<{ name: string; text: string }> = [
    { name: "the integration doc", text: docsSource },
    { name: "the in-product help", text: pageGuidance },
  ];

  for (const guidance of partialGuidanceTexts) {
    test(`${guidance.name} quotes the narrowing and forced-advance warnings`, () => {
      for (const fragment of NARROWING_WARNING_FRAGMENTS.concat(
        FORCED_ADVANCE_WARNING_FRAGMENTS,
      )) {
        expect({ fragment, quoted: guidance.text.includes(fragment) }).toEqual({
          fragment,
          quoted: true,
        });
      }
    });

    test(`${guidance.name} sends a skipped minute to the import control that ships`, () => {
      expect(guidance.text).toContain("**Import this time range**");
      expect(guidance.text).toMatch(/local time[^.]*UTC/);
    });

    test(`${guidance.name} does not bring back advice polling cannot act on`, () => {
      expect(guidance.text).not.toMatch(SHORTEN_INTERVAL_ADVICE_PATTERN);
      expect(guidance.text).not.toContain(
        "The recovery request limit was reached",
      );
      expect(guidance.text).not.toMatch(SWITCH_SCOPE_PATTERN);
      expect(guidance.text).not.toMatch(OLD_SCOPE_OPTION_PATTERN);
      expect(guidance.text).toContain(
        "select **Detections** under **Data to import**",
      );
    });
  }
});

/*
 * The per-pass budgets used to live in the retired poller. The connector
 * owns them now and hands the poller their sum through fetchBudget; the
 * texts quote the numbers and one budget warning word for word.
 */
describe("Budget guidance matches what the connector enforces", () => {
  const searchPageBudget: number = Number(
    requireGroup(
      SEARCH_PAGE_BUDGET_PATTERN,
      connectorSource,
      "GOOGLE_SECOPS_SEARCH_PAGE_BUDGET",
    ),
  );
  const curatedBudget: number = Number(
    requireGroup(
      CURATED_BUDGET_PATTERN,
      connectorSource,
      "GOOGLE_SECOPS_CURATED_REQUEST_BUDGET",
    ),
  );
  const alertsViewBudget: number = Number(
    requireGroup(
      ALERTS_VIEW_BUDGET_PATTERN,
      connectorSource,
      "GOOGLE_SECOPS_ALERTS_VIEW_REQUEST_BUDGET",
    ),
  );
  const fetchDurationMinutes: number = Number(
    requireGroup(
      FETCH_DURATION_MINUTES_PATTERN,
      connectorSource,
      "GOOGLE_SECOPS_FETCH_DURATION_MS",
    ),
  );

  test("the connector enforces the budgets it declares, and the poller applies them", () => {
    expect(searchPassBody).toContain("GOOGLE_SECOPS_SEARCH_PAGE_BUDGET");
    expect(searchPassBody).toContain("GOOGLE_SECOPS_CURATED_REQUEST_BUDGET");
    expect(fetchWindowsBody).toContain(
      "GOOGLE_SECOPS_ALERTS_VIEW_REQUEST_BUDGET",
    );
    expect(connectorSource).toMatch(TOTAL_REQUEST_BUDGET_PATTERN);
    expect(connectorSource).toMatch(FETCH_DURATION_BUDGET_PATTERN);
    expect(pollerSource).toContain("connector.fetchBudget");
    expect(executeUnlockedTryBlock).toContain(
      "maxDurationMs: budget.maxDurationMs",
    );
  });

  test("both texts quote the budget numbers the connector declares", () => {
    expect(docsSource).toContain(`**${searchPageBudget}** search pages`);
    expect(docsSource).toContain(`**${alertsViewBudget}** requests`);
    expect(docsSource).toContain(`**${curatedBudget}** requests`);
    expect(docsSource).toContain(`**${fetchDurationMinutes} minutes**`);

    expect(pageGuidance).toContain(`${searchPageBudget} search pages`);
    expect(pageGuidance).toContain(`${alertsViewBudget} alerts-view requests`);
    expect(pageGuidance).toContain(`${curatedBudget} curated requests`);
    expect(pageGuidance).toContain(`${fetchDurationMinutes} minutes`);
  });

  /*
   * The docs' example warning, rebuilt from the pieces the connector
   * assembles it from, so a reworded pass name, basis label or budget name
   * breaks here instead of leaving the docs quoting a warning no run shows.
   */
  test("the budget warning the docs quote is the one a stopped rule pass records", () => {
    expect(fetchEventsBody).toContain(
      "let phaseName: string = `Read rule detections by ${basisLabel}`;",
    );
    expect(fetchEventsBody).toContain(': "created time";');
    expect(recordPassBody).toContain(
      'const stop: string = `stopped by the ${this.budgetName(outcome.stoppedBy)} after ${outcome.requests} ${outcome.requests === 1 ? "request" : "requests"}`;',
    );
    expect(recordPassBody).toContain(
      "this.addWarning(data.run, `${data.name} was ${stop}.`);",
    );
    expect(budgetNameBody).toContain('return "request budget";');

    expect(docsSource).toContain(
      `\`Read rule detections by created time was stopped by the request budget after ${searchPageBudget} requests.\``,
    );
  });
});

/*
 * The Test connection checklist in both texts, against the check names the
 * tester, the connector and the platform health module really report.
 */
describe("Test connection guidance names the checks that ship, in order", () => {
  const DOCUMENTED_CHECK_NAMES: Array<string> = [
    "Configuration",
    "Authenticate with Google",
    "Read rule detections",
    "Read curated rule detections",
    "Read the alerts view",
    "Detections available to import",
    "Background workers",
    "Poll scheduler",
    "Security event storage",
    "Scheduled polling",
  ];

  const docsTestSection: string = sliceBetween(
    docsSource,
    "### Test connection",
    "### Preview, run and import on demand",
  );

  test("every documented check is a name the code reports", () => {
    const producers: string = `${testerSource}\n${connectorSource}\n${platformHealthSource}`;

    for (const name of DOCUMENTED_CHECK_NAMES) {
      expect({ name, reported: producers.includes(`"${name}"`) }).toEqual({
        name,
        reported: true,
      });
    }
  });

  /*
   * The converse, for the checks that are string literals: a new platform
   * or Google check cannot ship without the texts naming it.
   */
  test("every check name the connector and platform health report is documented", () => {
    /*
     * Comments are dropped first: ConnectorPlatformHealth describes a
     * BullMQ repeatable entry as `{ key, name: "SecurityEvents:Poll..." }`,
     * which is a job name, not a check.
     */
    const code: string =
      `${connectorSource}\n${platformHealthSource}\n${testerSource}`
        .replace(BLOCK_COMMENT_PATTERN, "")
        .replace(LINE_COMMENT_PATTERN, "");
    const literalNames: Array<string> = matchAllGroups(
      CHECK_NAME_PATTERN,
      code,
    ).map((groups: Array<string>): string => {
      return groups[1] as string;
    });

    expect(literalNames.length).toBeGreaterThan(0);

    for (const name of new Set(literalNames)) {
      expect({
        name,
        documented: DOCUMENTED_CHECK_NAMES.includes(name),
      }).toEqual({ name, documented: true });
    }
  });

  test("the integration doc lists the checks in the order a test reports them", () => {
    let previousIndex: number = -1;

    for (const name of DOCUMENTED_CHECK_NAMES) {
      const index: number = docsTestSection.indexOf(`**${name}**`);

      expect({ name, after: index > previousIndex }).toEqual({
        name,
        after: true,
      });
      previousIndex = index;
    }
  });

  test("the in-product help names every check", () => {
    for (const name of DOCUMENTED_CHECK_NAMES) {
      expect(pageGuidance).toContain(`**${name}**`);
    }
  });

  test("both texts quote the synchronous test's request deadline", () => {
    const deadlineSeconds: number = Number(
      requireGroup(
        TEST_REQUEST_TIMEOUT_PATTERN,
        testerSource,
        "CONNECTION_TEST_REQUEST_TIMEOUT_IN_MS",
      ),
    );

    expect(docsTestSection).toContain(`${deadlineSeconds} second deadline`);
    expect(pageGuidance).toContain(`${deadlineSeconds} second deadline`);
  });
});

/*
 * The upgrade notes promise what the data migration carries over and name
 * the API that replaced the retired one. Both are read off the migration,
 * the models and the API rather than restated.
 */
describe("Upgrade guidance matches the data migration and the API", () => {
  const upgradeSection: string = docsSource.slice(
    indexOfOrThrow(
      docsSource,
      "### Upgrading from the earlier Google SecOps connector",
    ),
    indexOfOrThrow(docsSource, "## Option 3"),
  );

  test("connections keep their id, provider, settings, cursor and scope", () => {
    expect(migrationSource).toContain(
      "connection.id = new ObjectID(String(row._id));",
    );
    expect(migrationSource).toContain(
      "connection.provider = SecurityEventConnectorProvider.GoogleSecOps;",
    );
    expect(migrationSource).toContain("region: row.region");
    expect(migrationSource).toContain(
      "instanceResourceName: row.instanceResourceName",
    );
    expect(migrationSource).toContain("connection.cursor = row.cursor;");
    expect(migrationSource).toContain(
      "connection.alertingOnly = row.includeNonAlertingDetections !== true;",
    );
    expect(migrationSource).toContain("connection.lastError = row.lastError;");
    expect(migrationSource).toContain('SET "isEnabled" = false');

    expect(upgradeSection).toContain(
      `provider \`${SecurityEventConnectorProvider.GoogleSecOps}\``,
    );
    expect(upgradeSection).toContain("It keeps its id");
    expect(upgradeSection).toContain("polling cursor");
    expect(upgradeSection).toContain("disabled, not deleted");
  });

  test("the run history bound and the interrupted-run error are the migration's", () => {
    const limit: string = requireGroup(
      RUN_HISTORY_LIMIT_PATTERN,
      migrationSource,
      "RUN_HISTORY_COPY_LIMIT",
    );
    const interrupted: string = requireGroup(
      INTERRUPTED_RUN_ERROR_PATTERN,
      migrationSource,
      "INTERRUPTED_RUN_ERROR",
    );

    expect(upgradeSection).toContain(`most recent ${limit} runs`);
    expect(upgradeSection).toContain(`\`${interrupted}\``);
  });

  /*
   * "detections already imported count as Already imported": the duplicate
   * lookup is scoped by the catalog's vendor and product names, which must
   * be the ones the retired connector stamped.
   */
  test("the connector keeps the identity earlier imports are deduplicated under", () => {
    expect(googleSecOps.vendorName).toBe("Google");
    expect(googleSecOps.productName).toBe("Google SecOps");
    expect(ingestBody).toContain("vendorName: definition.vendorName,");
    expect(ingestBody).toContain("productName: definition.productName,");
    expect(upgradeSection).toContain(
      `\`${googleSecOps.vendorName}\` / \`${googleSecOps.productName}\``,
    );
  });

  test("the retired API is gone and the documented replacement exists", () => {
    expect(
      repoFileExists("Common/Models/DatabaseModels/GoogleSecOpsConnection.ts"),
    ).toBe(false);
    expect(
      repoFileExists(
        "Common/Models/DatabaseModels/GoogleSecOpsConnectionRun.ts",
      ),
    ).toBe(false);
    expect(
      repoFileExists("Common/Server/API/GoogleSecOpsConnectionAPI.ts"),
    ).toBe(false);

    const connectionRoute: string = requireGroup(
      CRUD_ROUTE_PATTERN,
      connectionModelSource,
      "the connection CRUD route",
    );
    const runRoute: string = requireGroup(
      CRUD_ROUTE_PATTERN,
      connectionRunModelSource,
      "the run CRUD route",
    );

    expect(connectionApiSource).toContain("`${basePath}/test`");
    expect(connectionApiSource).toContain("`${basePath}/:connectionId/run`");

    for (const route of [
      connectionRoute,
      runRoute,
      `${connectionRoute}/test`,
      `${connectionRoute}/:connectionId/run`,
    ]) {
      expect(upgradeSection).toContain(`\`${route}\``);
    }
  });

  /*
   * The example body has to be something the API accepts: valid JSON, the
   * catalog's config and secret keys, the provider's enum value, and model
   * columns for everything else.
   */
  test("the example body uses the catalog's keys and the model's columns", () => {
    const body: Record<string, unknown> = JSON.parse(
      requireGroup(JSON_BLOCK_PATTERN, upgradeSection, "the API example"),
    ) as Record<string, unknown>;
    const data: Record<string, unknown> = body["data"] as Record<
      string,
      unknown
    >;

    expect(data["provider"]).toBe(SecurityEventConnectorProvider.GoogleSecOps);
    expect(
      Object.keys(data["config"] as Record<string, unknown>).sort(),
    ).toEqual(
      googleSecOps.configFields
        .map((field: ConnectorField): string => {
          return field.key;
        })
        .sort(),
    );
    expect(
      Object.keys(data["secrets"] as Record<string, unknown>).sort(),
    ).toEqual(
      googleSecOps.secretFields
        .map((field: ConnectorField): string => {
          return field.key;
        })
        .sort(),
    );

    for (const column of Object.keys(data)) {
      expect({
        column,
        isModelColumn: new RegExp(`public ${column}\\?:`).test(
          connectionModelSource,
        ),
      }).toEqual({ column, isModelColumn: true });
    }
  });

  test("events before and after the move carry the attributes the docs name", () => {
    expect(ingestBody).toContain(
      "event.attributes[SECURITY_CONNECTION_ID_ATTRIBUTE] =",
    );
    expect(ingestBody).toContain(
      'event.attributes["oneuptime.security_connection.provider"] =',
    );
    expect(upgradeSection).toContain(
      `\`${LEGACY_GOOGLE_SECOPS_CONNECTION_ID_ATTRIBUTE}\``,
    );
    expect(upgradeSection).toContain(`\`${SECURITY_CONNECTION_ID_ATTRIBUTE}\``);
    expect(upgradeSection).toContain(
      "`oneuptime.security_connection.provider`",
    );
    expect(migrationSource).toContain(
      'transformed["eventAttributeKey"] =\n    LEGACY_GOOGLE_SECOPS_CONNECTION_ID_ATTRIBUTE;',
    );
  });
});
