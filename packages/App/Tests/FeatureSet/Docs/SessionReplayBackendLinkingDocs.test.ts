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

/* One bullet or numbered step's line, found by how it starts. */
function lineStartingWith(markdown: string, start: string): string {
  const line: string | undefined = markdown
    .split("\n")
    .find((candidate: string): boolean => {
      return candidate.startsWith(start);
    });

  expect([start, line !== undefined]).toEqual([start, true]);

  return line as string;
}

/* One "What is not linked automatically" bullet, by its bold lead-in. */
function limitBullet(limits: string, lead: string): string {
  return lineStartingWith(limits, `- **${lead}`);
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

  /*
   * The recorder leaves the traceparent to another agent only when that
   * agent is configured to trace the request. The page used to say it
   * stood down whenever the agent "adds it", while the recorder stood
   * down on the global's mere presence - so Datadog RUM with its default
   * config (no allowedTracingUrls) sent a lone tracestate that no backend
   * keeps, and nothing linked.
   */
  it("says exactly when the recorder leaves the traceparent to another agent", (): void => {
    expect(correlating).toContain("configured to trace the request");

    for (const condition of [
      "fetch or XMLHttpRequest instrumentation",
      /* Datadog decides by the FIRST matching entry, as the recorder does. */
      "the first entry of its `allowedTracingUrls` that matches the request's URL",
      "`tracecontext` propagator",
      "`propagatorTypes`",
      "New Relic with distributed tracing enabled",
      "an active Elastic APM RUM agent with distributed tracing on",
      "It still adds its `tracestate` member",
      "only if that agent really sends a W3C `traceparent`",
      "merely loaded",
    ]) {
      expect([condition, correlating.includes(condition)]).toEqual([
        condition,
        true,
      ]);
    }

    /* The old presence-only wording. */
    expect(correlating).not.toContain(
      "(the OpenTelemetry browser SDK, New Relic, Elastic APM, Datadog RUM) adds it",
    );
  });

  /*
   * Round-3 corrections to the stand-down paragraph, each matching what the
   * agent really does:
   * - Datadog injects only once it has started, in a session it tracks, and
   *   (with the default traceContextInjection "sampled") only in a session
   *   it trace-samples. Its init configuration is readable before any of
   *   that, so "lists the URL" alone promised a link Datadog never sends.
   * - Elastic sends a W3C traceparent only with distributed tracing on AND
   *   its default header name; the legacy elastic-apm-traceparent is not W3C.
   * - New Relic with distributed tracing on sends its OWN tracestate
   *   (headers.set on fetch, setRequestHeader before send on XHR), so the
   *   session member never reaches the backend. The page used to put it
   *   under "linked if the agent sends a traceparent", which it always does.
   */
  it("scopes the stand-down to tracked Datadog sessions, W3C Elastic, and New Relic's own tracestate", (): void => {
    for (const phrase of [
      "Datadog RUM, once it has started and tracks the session, when the first entry",
      "with distributed tracing on and its default `traceparent` header name (`distributedTracingHeaderName`)",
      "With the first three, the request is linked only if that agent really sends a W3C `traceparent`",
      "Datadog sends one only in a tracked, trace-sampled Datadog session",
      "New Relic sends its own `tracestate` with its `traceparent`, and that takes the place of the member",
      "never stamped with the session and link only by trace id",
      "(#what-is-not-linked-automatically)",
      "before it has started or its `trackingConsent` is granted, or in a session it does not track",
    ]) {
      expect([phrase, correlating.includes(phrase)]).toEqual([phrase, true]);
    }

    /* New Relic is no longer promised a link once it sends a traceparent. */
    expect(correlating).not.toContain(
      "It still adds its `tracestate` member, and the request is linked only if that agent really sends a W3C `traceparent` with it.",
    );
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

  /*
   * TraceIdRatioBased hashes the trace id differently per language SDK,
   * and the OTel spec recommends it for root spans only. With the delegate
   * on every service of a polyglot backend, a Go or Java service behind a
   * Node gateway drops ~90% of the traces the gateway kept. The delegate
   * belongs on the first hop only.
   */
  it("scopes the remote-parent ratio delegate to the first hop and says why", (): void => {
    const sampling: string = section(
      page,
      "### Sampling of browser-started traces",
    );

    for (const phrase of [
      "**only to the service(s) your pages call directly**",
      "Leave the default `ParentBased` sampler on every service those call",
      "follow the first hop's decision",
      "Do not put this delegate on the services further down",
      "JavaScript XORs its 32-bit words",
      "Go and Python use its low 64 bits",
      "Java uses the absolute value of the signed low 64 bits",
      "recommends this sampler for root spans only",
      "tail sampling in an OpenTelemetry Collector",
    ]) {
      expect([phrase, sampling.includes(phrase)]).toEqual([phrase, true]);
    }

    /* The old advice named no service, so readers put it on all of them. */
    expect(sampling).not.toContain(
      "give the sampler the same ratio for sampled remote parents",
    );

    /* Listed origins get a sampled traceparent in every session, recorded or not. */
    expect(sampling).toContain(
      "the requests to origins in **Trace propagation origins** from every session the recorder runs in, recorded or not",
    );
    expect(sampling).not.toContain(
      "keep **every** browser-started trace from a recorded session",
    );
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

    const off: string = section(page, "### Turning automatic linking off");

    expect(off).toContain(`**${SWITCH_TITLE}**`);
    /*
     * Older docs told people to list their own origin in Trace propagation
     * origins; a listed origin keeps getting a traceparent with the switch
     * off, so turning it off alone does not stop the headers.
     */
    expect(off).toContain("if you listed your own origin there");
    expect(off).toContain("remove it as well");
    expect(off).toContain("your own requests keep getting a `traceparent`");
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
    /* A body-less DELETE is not retried either, not only XHRs and bodies. */
    expect(redirects).toContain("Anything else is not retried");
    expect(redirects).toContain("an `XMLHttpRequest` cannot be retried");
    expect(redirects).toContain(
      "neither can a `fetch` with any other method or with a body",
    );
    expect(redirects).toContain(`**${SWITCH_TITLE}**`);
    expect(redirects).toContain(
      "take your own origin out of **Trace propagation origins**",
    );
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
      /* A vendor agent the recorder stood down for, that sent no traceparent. */
      "set up to trace but sent without a W3C `traceparent`",
      "`allowedTracingUrls`",
      'reason: "agent-stand-down"',
      "send a W3C `traceparent` to your own origin",
      /* The page's own OTLP exporter, proxied through its origin. */
      "`/v1/traces`",
      "`/v1/logs`",
      "`/v1/metrics`",
    ]) {
      expect([limit, limits.includes(limit)]).toEqual([limit, true]);
    }
  });

  /*
   * New Relic with distributed tracing on replaces the member with its own
   * tracestate, so its requests belong with "already carry a tracestate"
   * (linked by trace id only, and a fetch(url) not at all), not with the
   * agents that link once they send a traceparent.
   */
  it("puts New Relic under the tracestate limit, with what still links", (): void => {
    const limits: string = section(
      page,
      "### What is not linked automatically",
    );
    const carried: string = limitBullet(
      limits,
      "Requests that already carry a `tracestate`",
    );

    for (const phrase of [
      "and every request New Relic traces",
      "sends its own `tracestate` with every `traceparent` it adds, in place of the member",
      "none of its requests is stamped with the session",
      "Its `XMLHttpRequest` calls and its `fetch` calls made with a `Request` object still link by trace id",
      "A `fetch` called with a URL does not link at all when New Relic loads first",
      "a copy of the request's options that the recorder never sees",
    ]) {
      expect([phrase, carried.includes(phrase)]).toEqual([phrase, true]);
    }

    const standDown: string = limitBullet(
      limits,
      "Requests another tracing agent was set up to trace",
    );

    expect(standDown).not.toContain("New Relic");
    expect(standDown).not.toContain("or it sends only its own header format");
  });

  /*
   * Datadog only injects in a session it tracks and trace-samples, and
   * traceContextInjection "all" sends the other sessions' traceparent with
   * the not-sampled flag (Datadog's tracer: `-0${traceSampled ? 1 : 0}`),
   * which a ParentBased backend drops, so the page must not sell "all" as
   * the fix. Elastic stands down only with distributed tracing on.
   */
  it("says which Datadog and Elastic sessions a stand-down leaves unlinked, and the real fix", (): void => {
    const standDown: string = limitBullet(
      section(page, "### What is not linked automatically"),
      "Requests another tracing agent was set up to trace",
    );

    for (const phrase of [
      "When Datadog RUM tracks the session and lists the URL in `allowedTracingUrls`",
      "an Elastic APM RUM agent is active with distributed tracing on",
      "Datadog sends one only in the sessions it trace-samples",
      'with a `traceSampleRate` below 100 and the default `traceContextInjection: "sampled"`, the requests of its other sessions do not link',
      "`traceSampleRate: 100` links every session Datadog tracks",
      '`traceContextInjection: "all"`',
      "flagged not sampled",
      "the default `ParentBased` sampler drops them",
      "the first time the recorder stands down on a page load",
      /* Elastic's own switch that silences it on fetch or XHR. */
      "(for Elastic, `fetch` or `xmlhttprequest` in its `disableInstrumentations`)",
    ]) {
      expect([phrase, standDown.includes(phrase)]).toEqual([phrase, true]);
    }
  });

  /*
   * The recorder skips only POSTs to the OTLP paths (an app's GET
   * /api/v1/logs is linked), and its listed-origin path still mints for
   * an own origin that is also in Trace propagation origins.
   */
  it("scopes the OTLP export skip to POSTs and names the listed-origin catch", (): void => {
    const otlp: string = limitBullet(
      section(page, "### What is not linked automatically"),
      "Your page's own OpenTelemetry exports.",
    );

    for (const phrase of [
      "A same-origin `POST` whose path ends in `/v1/traces`, `/v1/logs` or `/v1/metrics`",
      "gets nothing from the recorder's same-origin path",
      "such as a `GET /api/v1/logs` on your own API, are linked as usual",
      "If your own origin is also listed in **Trace propagation origins**",
      "those exports still get that list's `traceparent`, so remove your origin from the list",
    ]) {
      expect([phrase, otlp.includes(phrase)]).toEqual([phrase, true]);
    }

    expect(otlp).not.toContain("A same-origin request whose path ends in");
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

    /* Only POSTs to the OTLP paths are skipped (OTLP/HTTP always POSTs). */
    expect(carried).toContain(
      "except the page's own OpenTelemetry exports (`POST` requests to paths ending in `/v1/traces`, `/v1/logs` or `/v1/metrics`)",
    );

    /*
     * A client-asserted member also pulls the trace it names into that
     * session's rail and erasure scope; only a trace that belongs to the
     * erased sessions alone is erased as a whole.
     */
    expect(carried).toContain(
      "brings that trace's backend rows into its session's rail and into the scope of that session's erasure",
    );
    expect(carried).toContain(
      "only the rows stamped with the erased ids (see [Erasing sessions](#erasing-sessions))",
    );

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

    /*
     * Erasure reads its trace ids from stamped spans, and only erases a
     * trace whole when it belongs to the erased sessions alone. The page
     * used to promise that "the backend logs the player joined by trace id
     * go too", which is false for listed cross-origin APIs, requests that
     * already carried a tracestate, and shared or pre-dated traces.
     */
    expect(erasure).not.toContain(
      "so the backend logs the player joined by trace id go too",
    );

    for (const phrase of [
      "every trace that belongs to the erased sessions alone",
      "every stamped span in the trace carries one of their ids",
      "Erasure does not follow a trace id any further",
      "only by a trace id the recording observed",
      "[Trace propagation origins](#apis-on-another-origin)",
      "requests that already carried a `tracestate`",
      "a trace shared with other sessions",
      "only its rows stamped with an erased id are removed",
      "Delete that telemetry by trace id yourself, or let telemetry retention remove it.",
      "Erasure only removes rows in this project.",
      "still open when its session is erased keeps sending the erased id",
      "within the limits above",
    ]) {
      expect([phrase, erasure.includes(phrase)]).toEqual([phrase, true]);
    }

    /* The job reads every trace id of a batch, so no per-batch cap caveat. */
    expect(erasure).not.toMatch(/10,000|\bcap(ped)? at\b/);

    /* Logs joined by trace id carry no session id to be searched by. */
    expect(section(page, "## Retention and deletion")).toContain(
      "backend logs linked by trace id stay searchable by that trace id",
    );
  });

  /*
   * The job's ownership flag bounds a trace on both sides of the batch's
   * stamped spans (a reused page traceparent that unrecorded visitors keep
   * extending is not owned), and is judged per batch of up to 1,000
   * sessions (MAX_SESSION_IDS_PER_MUTATION), so a trace shared by erased
   * sessions in different batches keeps its unstamped rows.
   */
  it("bounds trace ownership before and after, and says it is judged per batch", (): void => {
    const erasure: string = section(page, "### Erasing sessions");

    for (const phrase of [
      "nothing in the trace started more than ten minutes before the first or after the last of those spans",
      "or of one that started more than ten minutes before its first stamped span or continued more than ten minutes after its last",
      "the rest of a trace shared only by erased sessions that erasure handles in different batches",
      "Erasure judges ownership per batch of up to 1,000 sessions",
      "a trace two of them share can count as shared in each batch",
    ]) {
      expect([phrase, erasure.includes(phrase)]).toEqual([phrase, true]);
    }

    /* The one-sided wording the job no longer matches. */
    expect(erasure).not.toContain(
      "more than ten minutes before the first of those spans.",
    );

    /* The numbers the page states are the job's, read from its source. */
    const job: string = readRepo(
      "App/FeatureSet/Workers/Jobs/Rum/ProcessSessionErasureRequests.ts",
    );

    expect(job).toContain(
      "export const MAX_SESSION_IDS_PER_MUTATION: number = 1000;",
    );
    expect(job).toContain(
      "export const TRACE_OWNERSHIP_SKEW_MINUTES: number = 10;",
    );
    expect(job).toContain("minIf(startTime, sessionId != '')");
    expect(job).toContain("maxIf(startTime, sessionId != '')");
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

  /*
   * OTel's fetch wrapper writes its headers onto `args[1] || {}` - a
   * private object when the page passes no init - so the read-back claim
   * must hold for fetch(url) too, and say so.
   */
  it("says the read-back covers a URL with or without an init, and a Request", (): void => {
    expect(join).toContain(
      "reads back the `traceparent` your instrumentations set, whether the call passes a URL (with or without an init object) or a `Request` object",
    );
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

    for (const reason of [
      '"on"',
      '"policy-off"',
      '"opaque-origin"',
      '"agent-stand-down"',
    ]) {
      expect([reason, propagation.includes(reason)]).toEqual([reason, true]);
    }

    expect(propagation).toContain("`enabled: true`");
    expect(propagation).toContain(`**${SWITCH_TITLE}**`);

    /* The stand-down line names the agent, by the global it reads. */
    for (const agent of ["`agent`", "`DD_RUM`", "`NREUM`", "`elasticApm`"]) {
      expect([agent, propagation.includes(agent)]).toEqual([agent, true]);
    }

    /*
     * Datadog links only in a tracked, trace-sampled session; New Relic's
     * own tracestate replaces the member; OTLP exports are POSTs only.
     */
    for (const phrase of [
      "(Datadog RUM only in a session it tracks)",
      "which Datadog does only in a tracked, trace-sampled Datadog session",
      "New Relic (`NREUM`) sends its own `tracestate` in place of the member, so its requests link only by trace id",
      "never on a `POST` to a path ending in `/v1/traces`, `/v1/logs` or `/v1/metrics`",
    ]) {
      expect([phrase, propagation.includes(phrase)]).toEqual([phrase, true]);
    }

    expect(propagation).toContain(
      "(#the-players-logs-and-traces-tabs-are-empty)",
    );

    const tripped: string = tableRow(page, "`same-origin-propagation-tripped`");

    expect(tripped).toContain("`retried: true`");
    expect(tripped).toContain("`false`");
    expect(tripped).toContain(
      "anything but a `GET` or `HEAD` `fetch` without a body (any XHR, any other method, any request with a body) is not retried",
    );
    expect(tripped).not.toContain("(an XHR, or a request with a body)");
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

    /*
     * Every emission of the code, not only the start-up one: the recorder
     * also logs it once per page load when it first stands down for a
     * vendor agent (reason "agent-stand-down").
     */
    const emissions: Array<string> = source
      .split('"same-origin-propagation",')
      .slice(1)
      .map((rest: string): string => {
        return rest.split(");")[0] || "";
      });
    const reasons: Array<string> = Array.from(
      new Set<string>(
        emissions.flatMap((emission: string): Array<string> => {
          return Array.from(
            emission.matchAll(/"(on|[a-z]+(?:-[a-z]+)+)"/g),
          ).map((match: RegExpMatchArray): string => {
            return match[1] as string;
          });
        }),
      ),
    );

    expect(reasons.length).toBeGreaterThanOrEqual(3);

    /* The stand-down reason is in the recorder, wherever it is emitted. */
    expect(source).toContain('"agent-stand-down"');

    const row: string = tableRow(page, "`same-origin-propagation`");

    for (const reason of [...reasons, "agent-stand-down"]) {
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

  /*
   * A same-origin request with our tracestate but no traceparent is the
   * one symptom of a vendor-agent stand-down that DevTools shows: step 1
   * passes (the member is there), and the backend silently drops a lone
   * tracestate.
   */
  it("has a step for a tracestate without a traceparent, naming the stand-down diagnostic", (): void => {
    const empty: string = section(
      page,
      "## The player's Logs and Traces tabs are empty",
    );

    for (const phrase of [
      "**`tracestate` but no `traceparent`?**",
      "`tracestate: oneuptime=…`",
      "made the recorder stand down, and then did not add a `traceparent` itself",
      'reason: "agent-stand-down"',
      "(`DD_RUM`)",
      "(`NREUM`)",
      "(`elasticApm`)",
      "propagate a W3C `traceparent` to your own origin",
      "`ignoreUrls`",
    ]) {
      expect([phrase, empty.includes(phrase)]).toEqual([phrase, true]);
    }

    /* Numbered 1 to 7, with the new step second. */
    const stepLine: RegExp = /^\d+\. /;
    const steps: Array<string> = empty
      .split("\n")
      .filter((line: string): boolean => {
        return stepLine.test(line);
      })
      .map((line: string): string => {
        return line.split(".")[0] as string;
      });

    expect(steps).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
    expect(
      empty.indexOf("**`tracestate` but no `traceparent`?**"),
    ).toBeLessThan(empty.indexOf("**Is your API on another origin?**"));
  });

  /*
   * Step 2 used to tell a New Relic user to "configure that agent to
   * propagate" - New Relic already propagates, with its own tracestate in
   * place of the member, which is step 5's symptom. And for Datadog the
   * lone-tracestate case is a session it does not trace-sample, where
   * traceContextInjection "all" only sends a not-sampled traceparent.
   */
  it("sends New Relic to the tracestate step, and Datadog to its trace sampling", (): void => {
    const empty: string = section(
      page,
      "## The player's Logs and Traces tabs are empty",
    );
    const step2: string = lineStartingWith(empty, "2. ");
    const pointer: string =
      "New Relic (`NREUM`) shows a different symptom, covered in step 5.";

    expect(step2).toContain(
      "its `agent` names Datadog RUM (`DD_RUM`) or Elastic APM (`elasticApm`)",
    );
    expect(step2).toContain(pointer);
    /* Nothing before the pointer tells New Relic what to configure. */
    expect(step2.split(pointer)[0]).not.toContain("NREUM");
    expect(step2.split(pointer)[0]).not.toContain("New Relic");

    for (const phrase of [
      "a session Datadog does not trace-sample",
      'with a `traceSampleRate` below 100 and the default `traceContextInjection: "sampled"`',
      "Set `traceSampleRate: 100` to link every session it tracks",
      '`traceContextInjection: "all"` sends a `traceparent` in those sessions too, but flagged not sampled',
      "With Elastic APM, check that its `disableInstrumentations` does not list `fetch` or `xmlhttprequest`.",
      "Otherwise, configure that agent to propagate a W3C `traceparent` to your own origin.",
    ]) {
      expect([phrase, step2.includes(phrase)]).toEqual([phrase, true]);
    }

    const step5: string = lineStartingWith(empty, "5. ");

    for (const phrase of [
      "New Relic with distributed tracing on (`agent-stand-down` names `NREUM`)",
      "sends its own `tracestate` with every `traceparent` it adds, in place of the member",
      "a `traceparent` and a `tracestate` with no `oneuptime=` entry",
      "Its `XMLHttpRequest` calls and its `fetch` calls made with a `Request` object link by trace id",
      "a `fetch` called with a URL does not link at all when New Relic loads first",
      "No New Relic setting brings the member back; only turning its distributed tracing off does",
    ]) {
      expect([phrase, step5.includes(phrase)]).toEqual([phrase, true]);
    }
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
      "Anything but a `GET` or `HEAD` `fetch` without a body (any `XMLHttpRequest`, any other method, any request with a body) is not retried",
    );
    expect(downloads).not.toContain(
      "An `XMLHttpRequest`, or a `fetch` with a body, cannot be retried",
    );
    expect(downloads).toContain(
      "remove your own origin from **Trace propagation origins** if you listed it there",
    );
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
    const propagation: string = tableRow(
      troubleshooting,
      "`same-origin-propagation`",
    );

    for (const token of [
      '"opaque-origin"',
      '"agent-stand-down"',
      "`DD_RUM`",
      "`NREUM`",
      "`elasticApm`",
    ]) {
      expect([token, propagation.includes(token)]).toEqual([token, true]);
    }
    expect(
      tableRow(troubleshooting, "`same-origin-propagation-tripped`"),
    ).toContain("`retried: true`");
  });

  it("uses the span processor in the browser setup, not a mutated resource", (): void => {
    expect(browserSetup).toContain(
      "export class ReplaySessionSpanProcessor implements SpanProcessor",
    );
  });

  /*
   * The review-round corrections, pinned by the tokens a translation keeps
   * verbatim plus the Persian sentences that replaced the wrong ones: the
   * stand-down conditions and diagnostic, the OTLP export-path skip, the
   * first-hop sampling scope, the scoped erasure and the retry rule.
   */
  it("carries the stand-down, sampling, erasure and retry corrections", (): void => {
    for (const token of [
      "`allowedTracingUrls`",
      "`propagatorTypes`",
      "`tracecontext`",
      'reason: "agent-stand-down"',
      "`/v1/traces`",
      "`/v1/logs`",
      "`/v1/metrics`",
      "tail sampling",
      "OpenTelemetry Collector",
      "XOR",
      "(#پاک-کردن-نشستها)",
    ]) {
      expect([token, sessionReplay.includes(token)]).toEqual([token, true]);
    }

    /* First hop only; the old unscoped sentence is gone. */
    expect(sessionReplay).toContain(
      "**فقط به سرویس(هایی) بدهید که صفحه‌هایتان مستقیم صدا می‌زنند**",
    );
    expect(sessionReplay).not.toContain(
      "همان نرخ را برای والدهای دوردستِ نمونه‌برداری‌شده هم به نمونه‌بردار بدهید",
    );

    /* Erasure: the old "logs joined by trace id go too" promise is gone. */
    expect(sessionReplay).not.toContain(
      "پس گزارش‌های بک‌اندی که پخش‌کننده بر پایه شناسه ردیابی پیوند داده هم می‌روند",
    );
    expect(sessionReplay).toContain("تنها از آنِ نشست‌های پاک‌شده است");
    expect(sessionReplay).toContain(
      "پاک‌سازی فقط سطرهای همین پروژه را برمی‌دارد",
    );

    /* The troubleshooting step and the retry rule. */
    for (const token of [
      "`tracestate` هست اما `traceparent` نه؟",
      'reason: "agent-stand-down"',
      "`ignoreUrls`",
      "هر چیزی جز `fetch`ای از نوع `GET` یا `HEAD` بدون بدنه",
    ]) {
      expect([token, troubleshooting.includes(token)]).toEqual([token, true]);
    }

    expect(troubleshooting).not.toContain(
      "یک `XMLHttpRequest`، یا `fetch`ای با بدنه، را نمی‌توان دوباره فرستاد",
    );

    /* The read-back claim covers fetch(url) with no init. */
    expect(browserSetup).toContain("(با شیء init یا بی آن)");
  });

  /*
   * Round 3, mirrored: Datadog only in a tracked, trace-sampled session,
   * Elastic only with the W3C header name, New Relic moved to the
   * tracestate limit (and out of troubleshooting step 2's "configure it"),
   * OTLP skip for POSTs only plus the listed-origin catch, and erasure
   * ownership bounded on both sides and judged per batch.
   */
  it("carries the round-3 agent, OTLP and erasure corrections", (): void => {
    for (const token of [
      "`trackingConsent`",
      "`distributedTracingHeaderName`",
      "`disableInstrumentations`",
      "(tracked, trace-sampled)",
      "`tracestate` خودش را می‌فرستد و آن جای عضو را می‌گیرد",
      "(#آنچه-خودکار-پیوند-نمیخورد)",
      "و هر درخواستی که New Relic ردیابی می‌کند",
      "`traceSampleRate: 100`",
      '`traceContextInjection: "all"`',
      "`ParentBased`",
      "(درخواست‌های `POST` به مسیرهایی که به `/v1/traces`",
      "`GET /api/v1/logs`",
      "`traceparent` آن فهرست را می‌گیرند",
      "پیش از نخستین یا پس از آخرین آن اسپن‌ها",
      "بیش از ده دقیقه پس از آخرینش ادامه یافته",
      "مالکیت در هر دسته از حداکثر ۱٬۰۰۰ نشست سنجیده می‌شود",
    ]) {
      expect([token, sessionReplay.includes(token)]).toEqual([token, true]);
    }

    /* The sentences the corrections replaced. */
    for (const gone of [
      "ضبط‌کننده همچنان عضو `tracestate` خود را می‌افزاید، و درخواست فقط وقتی پیوند می‌خورد",
      "New Relic ردیابی توزیع‌شده را روشن داشته باشد",
      "درخواستی هم‌مبدأ که مسیرش به `/v1/traces`",
      "(مسیرهایی که به `/v1/traces`",
    ]) {
      expect([gone, sessionReplay.includes(gone)]).toEqual([gone, false]);
    }

    const codes: string = tableRow(
      troubleshooting,
      "`same-origin-propagation`",
    );

    expect(codes).toContain("(tracked, trace-sampled)");
    expect(codes).toContain("هرگز روی `POST` به مسیری که به `/v1/traces`");

    /* Step 2 names DD and Elastic only, then points New Relic at step 5. */
    const empty: string = section(
      troubleshooting,
      "## زبانه‌های Logs و Traces پخش‌کننده خالی‌اند",
    );
    const step2: string = lineStartingWith(empty, "2. ");
    const pointer: string = "نشانه دیگری دارد که گام ۵ به آن می‌پردازد";

    expect(step2).toContain(pointer);
    /* NREUM is named once, in the closing pointer after `ignoreUrls`. */
    expect(step2.split("NREUM").length - 1).toBe(1);
    expect(step2.slice(step2.indexOf("`ignoreUrls`"))).toContain("NREUM");
    expect(step2).toContain("`traceSampleRate: 100`");
    expect(step2).toContain('`traceContextInjection: "all"`');
    expect(step2).toContain("`disableInstrumentations`");

    const step5: string = lineStartingWith(empty, "5. ");

    expect(step5).toContain("(`agent-stand-down` نام `NREUM` را می‌برد)");
    expect(step5).toContain("`oneuptime=`");
  });
});
