import slugify from "Common/Server/Types/MarkdownSlugify";
import {
  SESSION_TRACE_STATE_KEY,
  buildSessionTraceStateMember,
} from "Common/Utils/Rum/SessionTraceState";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Issue #3979: installing the recorder is enough to link a recording to
 * backend telemetry. The recorder carries the session id on the page's
 * same-origin requests (a `tracestate` member), span ingest stamps it onto
 * every span that inherits it, and the rail joins logs and exceptions by
 * trace id.
 *
 * Every customer-facing page used to prescribe the opposite: wire
 * OneUptimeReplay.onSessionChange into the OpenTelemetry resource, then
 * forward the id to the backend "as baggage or a header" and read it there.
 * These tests pin the new story on the docs pages (en and their fa
 * mirrors, which no other test watches) and on the Dashboard surfaces that
 * repeat it, against the code that implements it: the tracestate builder,
 * the recorder's debug codes and the policy switch's title.
 */
const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(REPO_ROOT, "App/FeatureSet/Docs/Content");
const RECORDER_SRC: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/BrowserRecorder/src",
);
const DASHBOARD_REPLAY_DIR: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Dashboard/src/Components/SessionReplay",
);

const SWITCH_TITLE: string = "Same-origin trace propagation";

/* The three pages this change rewrote, in both languages that carry them. */
const PAGES: Array<string> = [
  "telemetry/session-replay.md",
  "rum/browser-setup.md",
  "rum/session-replay-troubleshooting.md",
];
const LANGUAGES: Array<string> = ["en", "fa"];

/*
 * The old manual path, in the forms it took on these pages and in the
 * Dashboard. `resource.attributes[...] =` was the instruction; the new
 * copy may still NAME resource.attributes to explain why it is not used.
 */
const MANUAL_STEP_PATTERNS: Array<RegExp> = [
  /resource\.attributes\["session\.id"\]\s*=/,
  /baggage/i,
  /Forward the id to your backend/,
  /read the session\.id baggage/,
  /it does \*\*not\*\* inject one/,
  /nothing is stamping the id/,
  /recorder stamps session\.id on its own network/,
  /capped at 50/,
];

const FENCE_LINE: RegExp = /^\s*```/;

function readContent(language: string, relative: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, language, relative), "utf8");
}

function readRepo(relative: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

function headingSlugs(markdown: string): Set<string> {
  const slugs: Set<string> = new Set<string>();
  let inFence: boolean = false;

  for (const line of markdown.split("\n")) {
    if (FENCE_LINE.test(line)) {
      inFence = !inFence;
      continue;
    }

    if (inFence) {
      continue;
    }

    const match: RegExpMatchArray | null = line.match(/^#{1,6}\s+(.+?)\s*$/);

    if (match) {
      slugs.add(slugify(match[1] as string));
    }
  }

  return slugs;
}

/* One heading's body, up to the next heading of the same or a higher level. */
function section(markdown: string, heading: string): string {
  const lines: Array<string> = markdown.split("\n");
  const start: number = lines.findIndex((line: string): boolean => {
    return line.trim() === heading;
  });

  expect([heading, start >= 0]).toEqual([heading, true]);

  const level: number = (heading.match(/^#+/) as RegExpMatchArray)[0].length;
  const body: Array<string> = [];
  let inFence: boolean = false;

  for (const line of lines.slice(start + 1)) {
    if (FENCE_LINE.test(line)) {
      inFence = !inFence;
    }

    const match: RegExpMatchArray | null = inFence
      ? null
      : line.match(/^(#{1,6})\s/);

    if (match && (match[1] as string).length <= level) {
      break;
    }

    body.push(line);
  }

  return body.join("\n");
}

/* A table row's text, found by its first cell. */
function tableRow(markdown: string, firstCell: string): string {
  const row: string | undefined = markdown
    .split("\n")
    .find((line: string): boolean => {
      return new RegExp(
        `^\\|\\s*${firstCell.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\|`,
      ).test(line);
    });

  expect([firstCell, row !== undefined]).toEqual([firstCell, true]);

  return row as string;
}

describe("Session Replay docs: automatic backend linking (issue #3979)", (): void => {
  const page: string = readContent("en", "telemetry/session-replay.md");
  const correlating: string = section(
    page,
    "## Correlating with your other telemetry",
  );

  it("keeps the heading the Dashboard deep-links to", (): void => {
    expect(
      headingSlugs(page).has("correlating-with-your-other-telemetry"),
    ).toBe(true);
    expect(
      headingSlugs(readContent("en", "rum/browser-setup.md")).has(
        "joining-traces-to-session-replay",
      ),
    ).toBe(true);
  });

  it("says linking is automatic for the page's own origin, with no code", (): void => {
    expect(correlating).toContain("no code to add");
    expect(correlating).toContain("**to its own origin**");
    expect(correlating).toContain("`traceparent`");
    expect(correlating).toContain("`tracestate`");
    expect(correlating).toContain(
      "**every service that continues W3C trace context**",
    );
    /* Logs have no trace state in OTLP, so the page must say how they join. */
    expect(correlating).toContain("OTLP log records carry no trace state");
    expect(correlating).toContain("**by trace id**");
  });

  it("shows the tracestate member exactly as the recorder builds it", (): void => {
    const withParent: string = buildSessionTraceStateMember(
      "<32 hex session id>",
      "<16 hex parent id>",
    );
    const withoutParent: string = buildSessionTraceStateMember("<session id>");

    expect(withParent).toBe(
      `${SESSION_TRACE_STATE_KEY}=sid:<32 hex session id>;p:<16 hex parent id>`,
    );
    expect(page).toContain(`tracestate:  ${withParent}`);
    expect(correlating).toContain(`\`${withoutParent}\``);
    expect(correlating).toContain("`;p:<parent id>`");
  });

  it("gives APIs on another origin the one remaining step, traceparent only", (): void => {
    const crossOrigin: string = section(page, "### APIs on another origin");

    expect(crossOrigin).toContain("**Trace propagation origins**");
    expect(crossOrigin).toContain(
      "allows `traceparent` in `Access-Control-Allow-Headers`",
    );
    expect(crossOrigin).toContain("get a `traceparent` only");
    expect(crossOrigin).toContain("no session id");
    expect(crossOrigin).toContain("**by trace id**");
  });

  it("keeps onSessionChange documented, as optional and for the page's own telemetry", (): void => {
    const row: string = tableRow(
      section(page, "## JavaScript API"),
      "`onSessionChange(listener)`",
    );

    expect(row).toContain("**Optional**");
    expect(row).toContain("#your-pages-own-browser-telemetry");
    expect(row).not.toContain("This is what puts `session.id`");

    const own: string = section(page, "### Your page's own browser telemetry");

    expect(own).toContain('span.setAttribute("session.id", replaySessionId)');
    expect(own).toContain('"onSessionChange"');
    expect(own).toContain("before consent or a trigger");
  });

  it("says what the minted sampled flag does to sampling, with a fix per SDK", (): void => {
    const recorder: string = fs.readFileSync(
      path.join(RECORDER_SRC, "NetworkRecorder.ts"),
      "utf8",
    );

    /* The flag the docs explain is the one the recorder mints. */
    expect(recorder).toContain("-${parentId}-01`");

    const sampling: string = section(
      page,
      "### Sampling of browser-started traces",
    );

    expect(sampling).toContain("(`-01`)");
    expect(sampling).toContain("`ParentBased`");
    expect(sampling).toContain("OTEL_TRACES_SAMPLER=parentbased_traceidratio");

    for (const snippet of [
      "remoteParentSampled: new TraceIdRatioBasedSampler(0.1)",
      ".setRemoteParentSampled(Sampler.traceIdRatioBased(0.1))",
      "remote_parent_sampled=TraceIdRatioBased(0.1)",
      "sdktrace.WithRemoteParentSampled(sdktrace.TraceIDRatioBased(0.1))",
    ]) {
      expect([snippet, sampling.includes(snippet)]).toEqual([snippet, true]);
    }

    expect(sampling).toContain("#turning-automatic-linking-off");
  });

  it("documents the switch under the title the product gives it", (): void => {
    const model: string = readRepo(
      "Common/Models/DatabaseModels/RumApplication.ts",
    );
    const settings: string = readRepo(
      "App/FeatureSet/Dashboard/src/Pages/Rum/View/SessionReplaySettings.tsx",
    );

    expect(model).toContain("sessionReplaySameOriginTracePropagation");
    expect(model).toContain(`"${SWITCH_TITLE}"`);
    expect(settings).toContain(`"${SWITCH_TITLE}"`);

    expect(section(page, "### Turning automatic linking off")).toContain(
      `**${SWITCH_TITLE}**`,
    );
    /* A privacy control, so it is in the controls table with its default. */
    expect(tableRow(section(page, "## Privacy"), SWITCH_TITLE)).toContain(
      "| **on** |",
    );
  });

  it("warns about redirects to another origin and names the breaker's code", (): void => {
    const redirects: string = section(page, "### Redirects to another origin");

    expect(redirects).toContain("CORS preflight");
    expect(redirects).toContain("`same-origin-propagation-tripped`");
    expect(redirects).toContain("`GET` or `HEAD` `fetch` without a body");
    expect(redirects).toContain("An `XMLHttpRequest` cannot be retried");
    expect(redirects).toContain(`**${SWITCH_TITLE}**`);
  });

  it("lists what is not linked automatically, plainly", (): void => {
    const limits: string = section(
      page,
      "### What is not linked automatically",
    );

    for (const limit of [
      "document navigations and form posts",
      "server-side render",
      "WebSocket",
      "server-sent events",
      "`navigator.sendBeacon`",
      "Web Workers or Service Workers",
      "before the recorder starts",
      "before consent under _Require explicit_",
      "before a trigger under _On error or frustration_",
      "already carry a `tracestate`",
      "`otel.SetTextMapPropagator(propagation.TraceContext{})`",
      "proxies or CDNs",
      "sandboxed iframes",
      "React Native",
    ]) {
      expect([limit, limits.includes(limit)]).toEqual([limit, true]);
    }
  });

  it("says what the added headers carry, where they go, and what never travels", (): void => {
    const carried: string = section(page, "### What your own requests carry");

    expect(carried).toContain("**own origin**");
    expect(carried).toContain("while the session is **uploading**");
    expect(carried).toContain("after `revokeConsent()`");
    expect(carried).toContain("_On error or frustration_ until a trigger");
    expect(carried).toContain("third-party API");
    expect(carried).toContain("stays the same for the whole visit");
    expect(carried).toContain("[anonymous visitor id](#anonymous-visitors)");
    expect(carried).toContain("never travel this way");
    expect(carried).toContain("**Capture user identity** off");
    expect(carried).toContain("removes the member from the trace state");

    /* The consent section and the visitor-id promises point at it. */
    expect(section(page, "### Consent")).toContain(
      "(#what-your-own-requests-carry)",
    );
    expect(section(page, "### Anonymous visitors")).toContain(
      "**It never travels on your own requests.**",
    );
  });

  it("describes erasure of the telemetry joined by trace id", (): void => {
    const erasure: string = section(page, "### Erasing sessions");

    expect(erasure).toContain("stamped [automatically]");
    expect(erasure).toContain("share a trace id with those stamped spans");
    expect(erasure).toContain("`BySessionId`");
    expect(erasure).not.toContain(
      "the correlated logs, spans and exceptions for those sessions",
    );

    /* Logs joined by trace id carry no session id to be searched by. */
    expect(section(page, "## Retention and deletion")).toContain(
      "backend logs linked by trace id stay searchable by that trace id",
    );
  });

  it("describes the rail's Logs and Traces tabs by how rows really join", (): void => {
    const rail: string = section(page, "### The events rail");

    expect(tableRow(rail, "**Logs**")).toContain("joined by trace id");
    expect(tableRow(rail, "**Traces**")).toContain(
      "spans stamped with its id at ingest",
    );
    expect(rail).not.toContain("carried this session's id");
  });
});

describe("Browser Setup docs: joining traces to session replay", (): void => {
  const join: string = section(
    readContent("en", "rum/browser-setup.md"),
    "## Joining traces to session replay",
  );

  it("says backend telemetry joins with no code, and the recorder leaves traceparent to the SDK", (): void => {
    expect(join).toContain("with no code here");
    expect(join).toContain("`tracestate`");
    expect(join).toContain(
      "leaves the `traceparent` to your `FetchInstrumentation`",
    );
    expect(join).toContain(
      "/docs/telemetry/session-replay#correlating-with-your-other-telemetry",
    );
    expect(join).toContain("`propagateTraceHeaderCorsUrls`");
  });

  it("stamps the SDK's own spans with a span processor, not a mutated resource", (): void => {
    expect(join).toContain(
      "export class ReplaySessionSpanProcessor implements SpanProcessor",
    );
    expect(join).toContain('span.setAttribute("session.id", replaySessionId)');
    expect(join).toContain("new ReplaySessionSpanProcessor(),");
    expect(join).toContain('"onSessionChange"');
  });
});

describe("Session Replay troubleshooting: backend linking", (): void => {
  const page: string = readContent(
    "en",
    "rum/session-replay-troubleshooting.md",
  );

  it("explains both new recorder codes as table rows, with their detail fields", (): void => {
    const propagation: string = tableRow(page, "`same-origin-propagation`");

    for (const reason of ['"on"', '"policy-off"', '"opaque-origin"']) {
      expect([reason, propagation.includes(reason)]).toEqual([reason, true]);
    }

    expect(propagation).toContain("`enabled: true`");
    expect(propagation).toContain(`**${SWITCH_TITLE}**`);

    const tripped: string = tableRow(page, "`same-origin-propagation-tripped`");

    expect(tripped).toContain("`retried: true`");
    expect(tripped).toContain("`false`");
    expect(tripped).toContain(
      "(#downloads-or-redirects-fail-after-enabling-session-replay)",
    );
  });

  /*
   * The recorder's source is the vocabulary: when it emits the start-up
   * code, every reason it can report must be one the row explains.
   */
  it("documents every reason the recorder reports for same-origin-propagation", (): void => {
    const source: string = fs
      .readdirSync(RECORDER_SRC)
      .filter((file: string): boolean => {
        return file.endsWith(".ts");
      })
      .map((file: string): string => {
        return fs.readFileSync(path.join(RECORDER_SRC, file), "utf8");
      })
      .join("\n");

    expect(source).toContain('"same-origin-propagation"');

    const emission: string =
      source.split('"same-origin-propagation",')[1]?.split(");")[0] || "";
    const reasons: Array<string> = Array.from(
      emission.matchAll(/"(on|[a-z]+(?:-[a-z]+)+)"/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });

    expect(reasons.length).toBeGreaterThanOrEqual(3);

    const row: string = tableRow(page, "`same-origin-propagation`");

    for (const reason of reasons) {
      expect([reason, row.includes(`"${reason}"`)]).toEqual([reason, true]);
    }
  });

  it("rewrites the empty Logs and Traces entry around the automatic path", (): void => {
    const empty: string = section(
      page,
      "## The player's Logs and Traces tabs are empty",
    );

    expect(empty).toContain("with no code on your side");
    expect(empty).toContain("`same-origin-propagation`");
    expect(empty).toContain(`**${SWITCH_TITLE}**`);
    expect(empty).toContain("**Trace propagation origins**");
    expect(empty).toContain("`otel.SetTextMapPropagator");
    expect(empty).toContain("already carry a `tracestate`");
    expect(empty).not.toContain("OneUptimeReplay.onSessionChange(...)");
  });

  it("has an entry for downloads and redirects that fail after enabling replay", (): void => {
    const downloads: string = section(
      page,
      "## Downloads or redirects fail after enabling Session Replay",
    );

    expect(downloads).toContain("CORS preflight");
    expect(downloads).toContain("`same-origin-propagation-tripped`");
    expect(downloads).toContain("`AllowedHeaders`");
    expect(downloads).toContain(`**${SWITCH_TITLE}**`);
    expect(downloads).toContain(
      "/docs/telemetry/session-replay#redirects-to-another-origin",
    );
  });
});

describe("the manual session.id step is gone everywhere it was prescribed", (): void => {
  it("from the docs pages, in both languages", (): void => {
    const found: Array<string> = [];

    for (const language of LANGUAGES) {
      for (const relative of PAGES) {
        const markdown: string = readContent(language, relative);

        for (const pattern of MANUAL_STEP_PATTERNS) {
          if (pattern.test(markdown)) {
            found.push(`${language}/${relative}: ${pattern}`);
          }
        }
      }
    }

    expect(found).toEqual([]);
  });

  it("from the Dashboard surfaces that repeat it", (): void => {
    const found: Array<string> = [];

    for (const relative of [
      "Rail/ReplayRailEmptyCopy.ts",
      "SessionReplaySetupGuide.tsx",
      "SessionReplayInstallSnippet.tsx",
      "ReplayCorrelationPanel.tsx",
      "SessionReplayDocsReference.tsx",
    ]) {
      const source: string = fs.readFileSync(
        path.join(DASHBOARD_REPLAY_DIR, relative),
        "utf8",
      );

      for (const pattern of MANUAL_STEP_PATTERNS) {
        if (pattern.test(source)) {
          found.push(`${relative}: ${pattern}`);
        }
      }
    }

    expect(found).toEqual([]);
  });

  it("the docs reference card describes the automatic path", (): void => {
    const reference: string = fs.readFileSync(
      path.join(DASHBOARD_REPLAY_DIR, "SessionReplayDocsReference.tsx"),
      "utf8",
    );
    const card: string =
      reference.split('title: "Correlating with your other telemetry",')[1] ||
      "";

    expect(card).toContain("automatically");
    expect(card).not.toContain("Put session.id on your resource");
  });
});

/*
 * No test enforces en/fa parity for the RUM pages in general. These pin
 * the parts of this change a Persian reader relies on: the same codes, the
 * same sampling fixes, the same member, the same switch.
 */
describe("the Persian mirrors carry the same change", (): void => {
  const sessionReplay: string = readContent(
    "fa",
    "telemetry/session-replay.md",
  );
  const troubleshooting: string = readContent(
    "fa",
    "rum/session-replay-troubleshooting.md",
  );
  const browserSetup: string = readContent("fa", "rum/browser-setup.md");

  it("keeps the correlation headings", (): void => {
    expect(sessionReplay).toContain("\n## همبسته کردن با باقی تله‌متری‌تان\n");
    expect(browserSetup).toContain("\n## پیوستن ردیابی‌ها به بازپخش نشست\n");
  });

  it("documents the member, the switch, the sampling fixes and the limits", (): void => {
    expect(sessionReplay).toContain(
      `tracestate:  ${buildSessionTraceStateMember(
        "<32 hex session id>",
        "<16 hex parent id>",
      )}`,
    );
    expect(tableRow(sessionReplay, SWITCH_TITLE)).toContain("| **روشن** |");

    for (const snippet of [
      "remoteParentSampled: new TraceIdRatioBasedSampler(0.1)",
      ".setRemoteParentSampled(Sampler.traceIdRatioBased(0.1))",
      "remote_parent_sampled=TraceIdRatioBased(0.1)",
      "sdktrace.WithRemoteParentSampled(sdktrace.TraceIDRatioBased(0.1))",
      "`otel.SetTextMapPropagator(propagation.TraceContext{})`",
      "`same-origin-propagation-tripped`",
      'span.setAttribute("session.id", replaySessionId)',
    ]) {
      expect([snippet, sessionReplay.includes(snippet)]).toEqual([
        snippet,
        true,
      ]);
    }
  });

  it("has a table row for both new recorder codes on the troubleshooting page", (): void => {
    expect(tableRow(troubleshooting, "`same-origin-propagation`")).toContain(
      '"opaque-origin"',
    );
    expect(
      tableRow(troubleshooting, "`same-origin-propagation-tripped`"),
    ).toContain("`retried: true`");
  });

  it("uses the span processor in the browser setup, not a mutated resource", (): void => {
    expect(browserSetup).toContain(
      "export class ReplaySessionSpanProcessor implements SpanProcessor",
    );
  });
});
