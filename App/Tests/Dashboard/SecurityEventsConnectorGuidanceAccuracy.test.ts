import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import nodePath from "path";

/*
 * The Google SecOps connector ships two pieces of operator-facing prose
 * about the **Last Error** column — the integration doc's Troubleshooting
 * section and the Connections page's own in-product help — and both of
 * them used to be wrong in the same way.
 *
 * They said Last Error "carries verbatim whatever the Chronicle API
 * returned" and that a populated value meant "the poll ran and Chronicle
 * rejected it". Neither is what the code does:
 *
 *  - the stored string is synthetic. GoogleSecOpsClient builds a prefix
 *    naming the step plus the HTTP status, appends only the FIRST slice of
 *    the response body, and ConnectorErrorMessage then clamps the whole
 *    thing and appends a truncation marker. Nothing about it is verbatim.
 *  - the same catch block in GoogleSecOpsPoller.pollAllDueConnections
 *    stores failures Chronicle never saw. A token exchange failure comes
 *    from the OAuth endpoint in the customer's own service-account JSON,
 *    before Chronicle is contacted at all; and a telemetry-store write
 *    failure happens AFTER a completely successful Chronicle fetch. Both
 *    land in exactly the same column.
 *
 * So an operator reading "Chronicle rejected it" off a OneUptime-side
 * storage outage would open a ticket with Google support. Prose drifted
 * from behaviour and nothing caught it — this file is the thing that
 * catches it.
 *
 * What is pinned here is the TRUTH of the rewritten three-way taxonomy,
 * against the code that produces the thing it describes:
 *
 *  1. neither text reintroduces the false wording,
 *  2. every message prefix the texts quote is really thrown by
 *     GoogleSecOpsClient, and every HTTP-error template the client can
 *     throw is named by both texts,
 *  3. the slice limit, the clamp and the truncation marker the texts
 *     describe are the ones the code actually applies,
 *  4. "Last Polled: Never with an empty Last Error means the worker never
 *     ran" is genuinely unreachable once a poll has been attempted.
 *
 * Every constant is parsed back out of the producing source rather than
 * written down here, so renaming a message or moving a limit breaks this
 * test instead of quietly invalidating it.
 *
 * Sources are read as TEXT, the same choice as
 * App/Tests/Dashboard/SecurityEventsSetupGuide.test.ts: react is a
 * Dashboard dependency that App's own install never provides, so the .tsx
 * cannot be imported. Nothing here needs RouteMap, so this file also skips
 * that file's `window` / storage stubs.
 *
 * NOT covered here on purpose: the DISABLE_QUEUE_WORKERS and
 * worker.enabled claims in the same Troubleshooting section. Those are
 * already scraped from config.example.env and HelmChart values.yaml and
 * compared against the doc in
 * App/Tests/Dashboard/SecurityEventsConnectionsPage.test.ts ("the
 * DISABLE_QUEUE_WORKERS guidance matches config.example.env" and "the Helm
 * worker guidance matches values.yaml"), and duplicating them would just
 * give the same claim two places to be updated.
 */

/*
 * Read as constants rather than inline literals: eslint's wrap-regex wants
 * an inline regex parenthesised and prettier wants the parentheses gone,
 * and the two rules fight forever over the same line.
 */

/* Matches `new APIException(...)` with either a template or a plain string. */
const CLIENT_API_EXCEPTION_PATTERN: RegExp =
  /new\s+APIException\(\s*(?:`([^`]*)`|"((?:[^"\\]|\\.)*)")/g;
/* Matches every `responseText.slice(0, N)` echo in the client. */
const RESPONSE_SLICE_PATTERN: RegExp =
  /responseText\.slice\(\s*0\s*,\s*(\d+)\s*\)/g;
/* Matches the truncation marker constant in ConnectorErrorMessage.ts. */
const TRUNCATION_MARKER_PATTERN: RegExp =
  /TRUNCATION_MARKER:\s*string\s*=\s*"((?:[^"\\]|\\.)*)"/;
/* Matches the overall clamp constant in ConnectorErrorMessage.ts. */
const MAX_MESSAGE_LENGTH_PATTERN: RegExp =
  /MAX_CONNECTOR_ERROR_MESSAGE_LENGTH:\s*number\s*=\s*(\d+)/;
/* Matches a backticked span that claims to be a connector error message. */
const GUIDANCE_QUOTED_MESSAGE_PATTERN: RegExp = /`(Google[^`]*)`/g;
/* Matches the ` (HTTP ...)` tail the docs render in place of the status. */
const HTTP_TAIL_PATTERN: RegExp = /\s*\(HTTP[^)]*\)\s*$/;
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

/* The literal interpolation the client puts the HTTP status into. */
const HTTP_STATUS_INTERPOLATION: string = "${response.status}";
/* What separates a client message's static prefix from its status tail. */
const HTTP_TAIL_MARKER: string = " (HTTP ";

const REPO_ROOT: string = nodePath.join(__dirname, "..", "..", "..");

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(nodePath.join(REPO_ROOT, relativePath), "utf8");
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
 * Read a template literal declaration out of a .tsx file as the string it
 * evaluates to. The page's help text escapes its inline code spans as \`,
 * so a raw slice would leave backslashes all through the markdown and no
 * assertion about backticked prefixes would ever match.
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
 * inside them alongside the key being looked for.
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

function extractLineStartingWith(text: string, startsWith: string): string {
  const start: number = indexOfOrThrow(text, startsWith);
  const end: number = text.indexOf("\n", start);

  return end === -1 ? text.slice(start) : text.slice(start, end);
}

/*
 * ---------------------------------------------------------------------------
 * Sources
 * ---------------------------------------------------------------------------
 */

const docsSource: string = readRepoFile(
  "App/FeatureSet/Docs/Content/en/integrations/google-secops.md",
);
const connectionsPageSource: string = readRepoFile(
  "App/FeatureSet/Dashboard/src/Pages/SecurityEvents/GoogleSecOpsConnections.tsx",
);
const clientSource: string = readRepoFile(
  "Common/Server/Utils/SecurityEvent/GoogleSecOps/GoogleSecOpsClient.ts",
);
const pollerSource: string = readRepoFile(
  "Common/Server/Utils/SecurityEvent/GoogleSecOps/GoogleSecOpsPoller.ts",
);
const connectorErrorMessageSource: string = readRepoFile(
  "Common/Server/Utils/SecurityEvent/ConnectorErrorMessage.ts",
);

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

/* The subset that does not — these fall into the guidance's third bucket. */
const clientNonHttpMessages: Array<string> = clientThrownMessages.filter(
  (message: string): boolean => {
    return !message.includes(HTTP_STATUS_INTERPOLATION);
  },
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

const responseSliceLimits: Array<number> = matchAllGroups(
  RESPONSE_SLICE_PATTERN,
  clientSource,
).map((groups: Array<string>): number => {
  return Number(groups[1]);
});

const responseSliceLimit: number = responseSliceLimits[0] as number;

const truncationMarker: string = requireGroup(
  TRUNCATION_MARKER_PATTERN,
  connectorErrorMessageSource,
  "TRUNCATION_MARKER",
);

const maxConnectorErrorMessageLength: number = Number(
  requireGroup(
    MAX_MESSAGE_LENGTH_PATTERN,
    connectorErrorMessageSource,
    "MAX_CONNECTOR_ERROR_MESSAGE_LENGTH",
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
const pollConnectionBody: string = pollerSource.slice(
  indexOfOrThrow(pollerSource, "public static async pollConnection("),
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

const docsTroubleshootingIndex: number = indexOfOrThrow(
  docsSource,
  "### Troubleshooting",
);
const docsSectionEndIndex: number = ((): number => {
  const next: number = docsSource.indexOf("\n## ", docsTroubleshootingIndex);

  return next === -1 ? docsSource.length : next;
})();

/* The pre-GA callout plus the whole Troubleshooting section. */
const docsGuidance: string = docsSource.slice(
  indexOfOrThrow(docsSource, "> The connector uses the Chronicle"),
  docsSectionEndIndex,
);

/* Just the Last Error bullet and its sub-bullets. */
const docsLastErrorGuidance: string = docsSource
  .slice(
    indexOfOrThrow(docsSource, "- **Last Error is populated**"),
    docsSectionEndIndex,
  )
  .trim();

/* The page's in-product help, as the markdown string it evaluates to. */
const pageGuidance: string = readTemplateLiteral(
  connectionsPageSource,
  "const documentationMarkdown: string = `",
);

const pageLastErrorGuidance: string = extractLineStartingWith(
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
 * Each entry is the EXACT wording the review found to be false, kept here
 * so a future edit cannot quietly reintroduce it. These are not stylistic
 * preferences — every one of them is a factual claim the code contradicts.
 */
const FORBIDDEN_CLAIMS: Array<ForbiddenClaim> = [
  {
    /*
     * "**Last Error** carries verbatim whatever the Chronicle API returned"
     * and "The field carries the API's own message verbatim." The stored
     * value is a synthetic prefix plus a truncated slice; never verbatim.
     */
    pattern: /\bverbatim\b/i,
    wording: "Last Error carries the API's message verbatim",
  },
  {
    /*
     * "the connection's **Last Error** field says exactly what the API
     * returned" — it says at most the first slice of it, behind a prefix.
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
];

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
    test(`${guidance.name} quotes only prefixes the client actually throws`, () => {
      const quoted: Array<string> = matchAllGroups(
        GUIDANCE_QUOTED_MESSAGE_PATTERN,
        guidance.lastError,
      ).map((groups: Array<string>): string => {
        return groups[1] as string;
      });

      expect(quoted.length).toBeGreaterThan(0);

      for (const span of quoted) {
        const prefix: string = span.replace(HTTP_TAIL_PATTERN, "");
        const match: { prefix: string; template: string } | undefined =
          clientHttpErrorPrefixByTemplate.find(
            (entry: { prefix: string; template: string }): boolean => {
              return entry.prefix === prefix;
            },
          );

        /*
         * A quoted span is legitimate if the client throws it EITHER as an
         * HTTP-status template or as one of its status-less messages. The
         * guidance names both kinds: the status-less ones are the Google-side
         * failures that carry no status (an unparseable 2xx body, a 200 with
         * no access_token) and would otherwise be silently filed under the
         * OneUptime-side bucket.
         */
        const isStatusLessMessage: boolean = clientNonHttpMessages.some(
          (message: string): boolean => {
            return message.startsWith(prefix);
          },
        );

        expect({
          quoted: span,
          isThrownByTheClient: Boolean(match) || isStatusLessMessage,
        }).toEqual({
          quoted: span,
          isThrownByTheClient: true,
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
     * superset. Equality here would punish the texts for being MORE
     * accurate than the two-prefix taxonomy, which is the direction the
     * review pushed them in.
     */
    test(`${guidance.name} accounts for every HTTP error the client can throw`, () => {
      const quotedPrefixes: Set<string> = new Set(
        matchAllGroups(GUIDANCE_QUOTED_MESSAGE_PATTERN, guidance.lastError).map(
          (groups: Array<string>): string => {
            return (groups[1] as string).replace(HTTP_TAIL_PATTERN, "");
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
     * And the third bucket has to be present at all — it is the one the
     * old prose erased, and the one that sends an operator to the wrong
     * support queue when it is missing.
     */
    test(`${guidance.name} names the OneUptime-side third bucket`, () => {
      expect(guidance.lastError).toMatch(/anything else/i);
      expect(guidance.lastError).toMatch(/OneUptime's side/i);
      expect(guidance.lastError).toMatch(/telemetry store/i);
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
   * The third bucket's headline claim — "the alerts came back fine and the
   * failure was on OneUptime's side, usually writing them to the telemetry
   * store" — is only true if the telemetry-store write happens after a
   * successful fetch AND is allowed to escape pollConnection so the
   * poller's catch records it. pollConnection has exactly one try/catch,
   * around alert normalization, and neither the fetch nor the insert is
   * inside it.
   */
  test("a telemetry-store failure really reaches Last Error after a good fetch", () => {
    const fetchIndex: number = pollConnectionBody.indexOf(
      "client.fetchDetectionAlerts(",
    );
    const insertIndex: number = pollConnectionBody.indexOf(
      "SecurityEventService.insertJsonRows(",
    );

    expect(fetchIndex).toBeGreaterThan(-1);
    expect(insertIndex).toBeGreaterThan(fetchIndex);

    const catchVariables: Array<string> = matchAllGroups(
      CATCH_CLAUSE_PATTERN,
      pollConnectionBody,
    ).map((groups: Array<string>): string => {
      return groups[1] as string;
    });

    expect(catchVariables).toEqual(["normalizeError"]);

    const [tryBlock]: Array<string> = extractBalancedBlocks(
      pollConnectionBody,
      "try {",
    );
    const [catchBlock]: Array<string> = extractBalancedBlocks(
      pollConnectionBody,
      "catch (normalizeError)",
    );

    for (const block of [tryBlock, catchBlock]) {
      expect(block).toBeTruthy();
      expect(block).not.toContain("insertJsonRows");
      expect(block).not.toContain("fetchDetectionAlerts");
    }
  });

  /*
   * Tripwire on the messages that carry no HTTP status. Today both are
   * Google-side conditions that the guidance's "anything else" bucket
   * nevertheless absorbs, which is the known rough edge in the taxonomy;
   * a THIRD one appearing means someone has to decide which bucket it
   * belongs to instead of letting it default into the OneUptime-side one.
   */
  test("the client's status-less throws are the known set", () => {
    expect(clientNonHttpMessages.length).toBe(2);

    for (const message of clientNonHttpMessages) {
      expect(message).not.toContain(HTTP_STATUS_INTERPOLATION);
      expect(message.startsWith("Google")).toBe(true);
    }
  });
});

describe("The truncation story the guidance tells is the one the code runs", () => {
  test("the client slices response bodies at one shared limit", () => {
    // Both echo sites — token exchange and alerts fetch — and one N.
    expect(responseSliceLimits.length).toBe(2);
    expect(new Set(responseSliceLimits).size).toBe(1);
    expect(responseSliceLimit).toBeGreaterThan(0);
  });

  for (const guidance of guidanceTexts) {
    test(`${guidance.name} quotes the client's real slice limit`, () => {
      expect(guidance.lastError).toContain(
        `first ${responseSliceLimit} characters of the response body`,
      );
    });

    /*
     * The marker is quoted as inline code, and — critically — hedged. A
     * client HTTP error never actually reaches the clamp (see below), so a
     * text promising the marker unconditionally would be wrong again.
     */
    test(`${guidance.name} quotes the real truncation marker, conditionally`, () => {
      expect(guidance.lastError).toContain(`\`${truncationMarker}\``);
      expect(guidance.lastError).toMatch(/if it is still too long/i);
    });
  }

  test("the overall clamp leaves room for the slice, so the hedge is honest", () => {
    expect(maxConnectorErrorMessageLength).toBeGreaterThan(responseSliceLimit);

    /*
     * Worst case for a client HTTP error: the longest prefix, a three
     * digit status, and a full body slice. It still fits under the clamp,
     * which is why the guidance says the marker appears only "if it is
     * still too long" — the messages that do get marked come from
     * elsewhere, e.g. a ClickHouse error echoing back the whole query.
     */
    for (const entry of clientHttpErrorPrefixByTemplate) {
      const worstCase: string = entry.template
        .replace(HTTP_STATUS_INTERPOLATION, "999")
        .replace(
          `\${responseText.slice(0, ${responseSliceLimit})}`,
          "x".repeat(responseSliceLimit),
        );

      expect(worstCase).not.toContain("${");
      expect(worstCase.length).toBeLessThan(maxConnectorErrorMessageLength);
    }
  });
});

describe('"Never" really means the poll was never attempted', () => {
  /*
   * The whole advice rests on one invariant: an attempted poll always
   * leaves a mark. pollAllDueConnections has a single catch, and it stamps
   * through ConnectorErrorMessage.recordFailure, which swallows a failed
   * write rather than letting it abort the loop — the original bug, where
   * a throw from the recovery write left lastPolledAt AND lastError null
   * and made an attempted poll indistinguishable from an unattempted one.
   */
  test("pollAllDueConnections has one catch and records through the guard", () => {
    const catchVariables: Array<string> = matchAllGroups(
      CATCH_CLAUSE_PATTERN,
      pollAllDueConnectionsBody,
    ).map((groups: Array<string>): string => {
      return groups[1] as string;
    });

    expect(catchVariables.length).toBe(1);
    expect(pollAllDueConnectionsBody).toContain(
      "ConnectorErrorMessage.recordFailure(",
    );
    expect(pollAllDueConnectionsBody).toContain(
      "ConnectorErrorMessage.toMessage(",
    );
  });

  /*
   * Every write that touches lastError also stamps lastPolledAt in the
   * same object, so no code path can produce "an error but never polled".
   * Read as balanced `data: { ... }` blocks so a key added between them
   * cannot fool a substring search.
   */
  test("every lastError write stamps lastPolledAt alongside it", () => {
    const dataBlocks: Array<string> = extractBalancedBlocks(
      pollerSource,
      "data: {",
    );

    expect(dataBlocks.length).toBeGreaterThan(0);

    const lastErrorBlocks: Array<string> = dataBlocks.filter(
      (block: string): boolean => {
        return block.includes("lastError");
      },
    );

    // Both the failure stamp and the success clear are in here.
    expect(lastErrorBlocks.length).toBe(2);

    for (const block of lastErrorBlocks) {
      expect(block).toContain("lastPolledAt");
    }
  });

  /*
   * The only way a connection leaves the loop unstamped is the not-due
   * skip, and that runs before the attempt — so it can only preserve a
   * previous state, never erase one.
   */
  test("the only skip path runs before the poll is attempted", () => {
    const continueIndex: number =
      pollAllDueConnectionsBody.indexOf("continue;");
    const tryIndex: number = pollAllDueConnectionsBody.indexOf("try {");

    expect(continueIndex).toBeGreaterThan(-1);
    expect(tryIndex).toBeGreaterThan(-1);
    expect(continueIndex).toBeLessThan(tryIndex);

    // And there is no second continue hiding after the try.
    expect(
      pollAllDueConnectionsBody.indexOf("continue;", continueIndex + 1),
    ).toBe(-1);
  });

  /*
   * The stamp sits behind an `if (connection.id)` guard, which would be a
   * hole if a row could come back without one. The query selects _id, so
   * the guard's else branch is unreachable.
   */
  test("the poller always selects the id and stamp columns it needs", () => {
    expect(pollAllDueConnectionsBody).toContain("_id: true");
    expect(pollAllDueConnectionsBody).toContain("lastPolledAt: true");
    expect(pollAllDueConnectionsBody).toContain("if (connection.id)");
  });

  test("both texts still tell the operator what Never means", () => {
    expect(docsGuidance).toContain(
      "- **Last Polled is `Never` and Last Error is empty**",
    );
    expect(docsGuidance).toContain(
      "the background worker has not executed the poll job at all",
    );
    expect(pageGuidance).toContain(
      "**Last Polled: Never** means the poll job has not run for this connection yet",
    );
  });
});
