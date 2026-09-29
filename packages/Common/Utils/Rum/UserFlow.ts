import {
  UserFlowJourneysResponseDto,
  UserFlowSessionDto,
} from "../../Types/Rum/UserFlow";

/*
 * The User Flows engine: recorded session journeys in, everything the page
 * draws out - the step-by-step flow map, the most common paths, per-page
 * entry / exit / drop-off numbers, back-and-forth loops, and the few
 * findings worth putting in front of someone first.
 *
 * Pure and synchronous on purpose. The endpoint returns journeys, not a
 * graph (see Types/Rum/UserFlow.ts), so every control on the page is a call
 * to analyzeUserFlow with different options over the same input; it runs
 * in single-digit milliseconds for the endpoint's session cap.
 *
 * Vocabulary:
 *  - page: a flow-map key. The scrubbed URL without origin, query or
 *    trailing slash ("/cart"), optionally with id-shaped segments grouped
 *    ("/product/:id"), and with the host kept only when the application
 *    spans more than one ("shop.example.com/cart").
 *  - journey: one session's pages in order, after grouping and hiding,
 *    with back-to-back repeats collapsed.
 *  - step: a column of the flow map. Step 0 is the session's first page,
 *    or the anchor page when the map is anchored on one.
 */

export const OTHER_PAGES_KEY: string = "__other__";
export const OTHER_PAGES_LABEL: string = "Other pages";

export const USER_FLOW_MIN_STEPS: number = 2;
export const USER_FLOW_MAX_STEPS: number = 10;
export const USER_FLOW_DEFAULT_STEPS: number = 5;
export const USER_FLOW_MIN_PAGES_PER_STEP: number = 2;
export const USER_FLOW_MAX_PAGES_PER_STEP: number = 20;
export const USER_FLOW_DEFAULT_PAGES_PER_STEP: number = 6;

/* Sessions an entity keeps as "watch one of these" links. */
export const USER_FLOW_SAMPLE_SESSIONS: number = 5;
/* Pages shown in a path before it is cut with an ellipsis. */
export const USER_FLOW_MAX_PATH_LENGTH: number = 8;
export const USER_FLOW_MAX_PATHS: number = 25;
export const USER_FLOW_MAX_NEIGHBOURS: number = 6;
export const USER_FLOW_MAX_LOOPS: number = 10;
/* Pages an "Other pages" node lists when it is opened. */
export const USER_FLOW_MAX_OTHER_PAGES: number = 50;

/*
 * Findings need a floor, or "100% of sessions left from /legal" is a single
 * visitor. The larger of an absolute count and a share of the sample.
 */
const INSIGHT_MIN_SESSIONS: number = 3;
const INSIGHT_MIN_SHARE: number = 0.02;
/* See the drop-off finding: below this, a page is a natural end. */
const DROP_OFF_MIN_CONTINUE_SHARE: number = 0.1;

export type UserFlowDirection = "forward" | "backward";

export type UserFlowSessionFilter = "all" | "errors" | "frustration";

export interface UserFlowOptions {
  /*
   * A page key to anchor on. Forward: journeys from the FIRST time a session
   * reached it. Backward: how sessions got there, up to that first arrival.
   * Null draws journeys from the session start.
   */
  anchorPage: string | null;
  direction: UserFlowDirection;
  steps: number;
  pagesPerStep: number;
  groupDynamicSegments: boolean;
  /* Page keys removed from every journey before anything is counted. */
  hiddenPages: Array<string>;
  sessionFilter: UserFlowSessionFilter;
  /* Empty means every device type. */
  deviceType: string;
}

export const DEFAULT_USER_FLOW_OPTIONS: UserFlowOptions = {
  anchorPage: null,
  direction: "forward",
  steps: USER_FLOW_DEFAULT_STEPS,
  pagesPerStep: USER_FLOW_DEFAULT_PAGES_PER_STEP,
  groupDynamicSegments: true,
  hiddenPages: [],
  sessionFilter: "all",
  deviceType: "",
};

export interface UserFlowNode {
  id: string;
  step: number;
  /* A page key, or OTHER_PAGES_KEY. */
  page: string;
  label: string;
  isOther: boolean;
  /* For an "Other pages" node: what it folds together, largest first. */
  otherPages: Array<UserFlowPageCount>;
  sessions: number;
  /*
   * Sessions whose journey ends at this node. Forward: they left the site
   * here (drop-off). Backward: their session STARTED here.
   */
  terminal: number;
  /* Sessions that went on past the last column. Only on the last column. */
  continued: number;
  errorSessions: number;
  frustrationSessions: number;
  sampleSessionIds: Array<string>;
}

export interface UserFlowLink {
  id: string;
  sourceId: string;
  targetId: string;
  /*
   * Always in reading order of the journey: for a backward map the source
   * is the page visited FIRST (further from the anchor).
   */
  fromPage: string;
  toPage: string;
  sessions: number;
  /* Sessions for which the destination was a page they had already seen. */
  revisitSessions: number;
  sampleSessionIds: Array<string>;
}

export interface UserFlowGraph {
  direction: UserFlowDirection;
  anchorPage: string | null;
  /* Columns actually populated (<= options.steps). */
  steps: number;
  nodes: Array<UserFlowNode>;
  links: Array<UserFlowLink>;
  /* Journeys drawn in the map (those that contain the anchor, if any). */
  sessions: number;
}

export interface UserFlowPageCount {
  page: string;
  sessions: number;
}

export interface UserFlowPageStats {
  page: string;
  /* Sessions that visited the page at least once. */
  sessions: number;
  /* Visits, counting returns. */
  views: number;
  /* Sessions that started here. */
  entries: number;
  /* Sessions that ended here. */
  exits: number;
  /* Sessions that started here and saw no other page. */
  bounces: number;
  /* exits / sessions. */
  exitRate: number;
  errorSessions: number;
  frustrationSessions: number;
  next: Array<UserFlowPageCount>;
  previous: Array<UserFlowPageCount>;
  sampleSessionIds: Array<string>;
}

export interface UserFlowPath {
  pages: Array<string>;
  /* The journey went on past USER_FLOW_MAX_PATH_LENGTH pages. */
  isTruncated: boolean;
  sessions: number;
  share: number;
  avgDurationMs: number;
  errorSessions: number;
  frustrationSessions: number;
  sampleSessionIds: Array<string>;
}

/* A -> B -> A: the visitor went somewhere and came straight back. */
export interface UserFlowLoop {
  pageA: string;
  pageB: string;
  sessions: number;
  share: number;
  sampleSessionIds: Array<string>;
}

export type UserFlowInsightKind =
  | "top-entry"
  | "drop-off"
  | "loop"
  | "error-hotspot"
  | "frustration-hotspot";

export type UserFlowInsightTone = "neutral" | "warning" | "danger";

export interface UserFlowInsight {
  kind: UserFlowInsightKind;
  tone: UserFlowInsightTone;
  title: string;
  detail: string;
  /* The page the finding is about, so the UI can focus it. */
  page: string;
  secondaryPage?: string | undefined;
  /*
   * How to point the map at it: backward for a drop-off ("how did the
   * people who gave up get there?"), forward for the rest ("where do they
   * go from here?").
   */
  focusDirection: UserFlowDirection;
  sessions: number;
  share: number;
}

export interface UserFlowSummary {
  sessions: number;
  navigatingSessions: number;
  bounceRate: number;
  avgPagesPerSession: number;
  medianPagesPerSession: number;
  uniquePages: number;
  topEntryPage: UserFlowPageCount | null;
  topExitPage: UserFlowPageCount | null;
}

export interface UserFlowAnalysis {
  summary: UserFlowSummary;
  graph: UserFlowGraph;
  paths: Array<UserFlowPath>;
  pages: Array<UserFlowPageStats>;
  loops: Array<UserFlowLoop>;
  insights: Array<UserFlowInsight>;
  /* Every page key seen after grouping, busiest first: the anchor picker. */
  availablePages: Array<UserFlowPageCount>;
  /* Device types present in the input, for the filter. */
  deviceTypes: Array<string>;
  /* Whether keys carry a host (the app spans several origins). */
  includesHost: boolean;
}

/* A journey after grouping, hiding and collapsing. */
export interface UserFlowJourney {
  sessionId: string;
  startUnixMs: number;
  durationMs: number;
  deviceType: string;
  pages: Array<string>;
  errorPages: Set<string>;
  frustrationPages: Set<string>;
  hadErrors: boolean;
  hadFrustration: boolean;
}

/* ------------------------------------------------------------------ */
/* Page keys                                                           */
/* ------------------------------------------------------------------ */

const RELATIVE_BASE: string = "https://relative.invalid";
const NUMERIC_SEGMENT: RegExp = /^\d+$/;
const HEX_ID_SEGMENT: RegExp = /^(?=[0-9a-f]*\d)[0-9a-f]{8,}$/i;
const UUID_SEGMENT: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/* A long token mixing letters and digits: a slug id, an opaque key. */
const MIXED_TOKEN_SEGMENT: RegExp =
  /^(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{16,}$/;
const REDACTED_SEGMENT: string = "[redacted]";
const DYNAMIC_SEGMENT_LABEL: string = ":id";

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/*
 * True for a path segment that names one record rather than a route: the
 * recorder's own "[redacted]" marker (uuids, emails, long numbers, opaque
 * tokens are already replaced before storage), plus the id shapes it keeps -
 * short numbers, hex ids, long letter-digit tokens.
 */
export function isDynamicPathSegment(segment: string): boolean {
  const decoded: string = decodeSegment(segment);

  return (
    decoded === REDACTED_SEGMENT ||
    NUMERIC_SEGMENT.test(decoded) ||
    UUID_SEGMENT.test(decoded) ||
    HEX_ID_SEGMENT.test(decoded) ||
    MIXED_TOKEN_SEGMENT.test(decoded)
  );
}

interface ParsedPageUrl {
  host: string;
  path: string;
}

function parsePageUrl(rawUrl: string): ParsedPageUrl {
  const trimmed: string = (rawUrl || "").trim();

  if (!trimmed) {
    return { host: "", path: "/" };
  }

  try {
    const parsed: URL = new URL(trimmed, RELATIVE_BASE);
    const isRelative: boolean =
      parsed.origin === RELATIVE_BASE && !trimmed.startsWith(RELATIVE_BASE);

    /*
     * A hash router keeps its route in the fragment ("/#/orders"). The
     * recorder stores such URLs with the fragment when it can; treat
     * "#/..." as the path so those apps do not collapse onto "/".
     */
    let path: string = parsed.pathname || "/";

    if (parsed.hash.startsWith("#/")) {
      path = parsed.hash.slice(1);
    }

    return { host: isRelative ? "" : parsed.host, path: path };
  } catch {
    return { host: "", path: trimmed };
  }
}

function normalizePath(path: string, groupDynamicSegments: boolean): string {
  let segments: Array<string> = path.split("/");

  if (groupDynamicSegments) {
    segments = segments.map((segment: string): string => {
      if (!segment) {
        return segment;
      }

      return isDynamicPathSegment(segment) ? DYNAMIC_SEGMENT_LABEL : segment;
    });
  }

  let normalized: string = segments.join("/");

  if (!normalized.startsWith("/")) {
    normalized = `/${normalized}`;
  }

  /* "/cart/" and "/cart" are one page to a person; keep "/" itself. */
  while (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }

  return normalized;
}

/*
 * The flow-map key for one stored URL. Query strings are dropped (the
 * scrubber keeps only redacted allowlisted parameters, which would split
 * one page into two), and the host is kept only when asked.
 */
export function toUserFlowPageKey(
  rawUrl: string,
  options: { groupDynamicSegments: boolean; includeHost: boolean },
): string {
  const parsed: ParsedPageUrl = parsePageUrl(rawUrl);
  const path: string = normalizePath(parsed.path, options.groupDynamicSegments);

  if (options.includeHost && parsed.host) {
    return `${parsed.host}${path}`;
  }

  return path;
}

/* True when the stored URLs span more than one host. */
export function spansMultipleHosts(rawUrls: Array<string>): boolean {
  let firstHost: string | null = null;

  for (const rawUrl of rawUrls) {
    const host: string = parsePageUrl(rawUrl).host;

    if (!host) {
      continue;
    }

    if (firstHost === null) {
      firstHost = host;
    } else if (host !== firstHost) {
      return true;
    }
  }

  return false;
}

/*
 * The URL-path prefix that selects a page key in the session list's
 * urlPrefix filter: "/product/:id" -> "/product/", host dropped. The list
 * matches prefixes, so a grouped key is widened to its static head.
 */
export function toSessionListUrlPrefix(page: string): string {
  if (!page || page === OTHER_PAGES_KEY) {
    return "";
  }

  const slash: number = page.indexOf("/");
  const path: string = slash > 0 ? page.slice(slash) : page;
  const dynamic: number = path.indexOf(`/${DYNAMIC_SEGMENT_LABEL}`);

  if (dynamic >= 0) {
    return path.slice(0, dynamic + 1);
  }

  return path;
}

export function getUserFlowPageLabel(page: string): string {
  return page === OTHER_PAGES_KEY ? OTHER_PAGES_LABEL : page;
}

/* ------------------------------------------------------------------ */
/* Journeys                                                            */
/* ------------------------------------------------------------------ */

function collapseRepeats(pages: Array<string>): Array<string> {
  const collapsed: Array<string> = [];

  for (const page of pages) {
    if (collapsed[collapsed.length - 1] !== page) {
      collapsed.push(page);
    }
  }

  return collapsed;
}

/*
 * Every session as a journey of page keys. Hiding runs BEFORE collapsing,
 * so hiding a login interstitial turns "/cart -> /login -> /cart" into one
 * visit to /cart rather than a self-loop.
 */
export function buildUserFlowJourneys(
  response: UserFlowJourneysResponseDto,
  options: Pick<
    UserFlowOptions,
    "groupDynamicSegments" | "hiddenPages" | "sessionFilter" | "deviceType"
  >,
): { journeys: Array<UserFlowJourney>; includesHost: boolean } {
  const includesHost: boolean = spansMultipleHosts(response.pages);
  const keys: Array<string> = response.pages.map((rawUrl: string): string => {
    return toUserFlowPageKey(rawUrl, {
      groupDynamicSegments: options.groupDynamicSegments,
      includeHost: includesHost,
    });
  });
  const hidden: Set<string> = new Set(options.hiddenPages);
  const journeys: Array<UserFlowJourney> = [];

  for (const session of response.sessions) {
    if (options.deviceType && session.deviceType !== options.deviceType) {
      continue;
    }

    const hadErrors: boolean = session.errorCount > 0;
    const hadFrustration: boolean = session.frustrationCount > 0;

    if (options.sessionFilter === "errors" && !hadErrors) {
      continue;
    }

    if (options.sessionFilter === "frustration" && !hadFrustration) {
      continue;
    }

    const pages: Array<string> = collapseRepeats(
      session.pages
        .map((index: number): string => {
          return keys[index] as string;
        })
        .filter((page: string | undefined): page is string => {
          return typeof page === "string" && !hidden.has(page);
        }),
    );

    if (pages.length === 0) {
      continue;
    }

    const errorPages: Set<string> = new Set<string>();
    const frustrationPages: Set<string> = new Set<string>();

    for (const [index, errors, frustration] of session.pageSignals) {
      const page: string | undefined = keys[index];

      if (page === undefined) {
        continue;
      }

      if (errors > 0) {
        errorPages.add(page);
      }

      if (frustration > 0) {
        frustrationPages.add(page);
      }
    }

    journeys.push(toJourney(session, pages, errorPages, frustrationPages));
  }

  return { journeys: journeys, includesHost: includesHost };
}

function toJourney(
  session: UserFlowSessionDto,
  pages: Array<string>,
  errorPages: Set<string>,
  frustrationPages: Set<string>,
): UserFlowJourney {
  return {
    sessionId: session.sessionId,
    startUnixMs: session.startUnixMs,
    durationMs: session.durationMs,
    deviceType: session.deviceType,
    pages: pages,
    errorPages: errorPages,
    frustrationPages: frustrationPages,
    hadErrors: session.errorCount > 0 || errorPages.size > 0,
    hadFrustration: session.frustrationCount > 0 || frustrationPages.size > 0,
  };
}

/* ------------------------------------------------------------------ */
/* Small counting helpers                                              */
/* ------------------------------------------------------------------ */

class Counter {
  private readonly counts: Map<string, number> = new Map<string, number>();

  public add(key: string, amount: number = 1): void {
    this.counts.set(key, (this.counts.get(key) || 0) + amount);
  }

  public get(key: string): number {
    return this.counts.get(key) || 0;
  }

  public top(limit: number): Array<UserFlowPageCount> {
    return sortCounts(
      Array.from(this.counts.entries()).map(
        ([page, sessions]: [string, number]): UserFlowPageCount => {
          return { page: page, sessions: sessions };
        },
      ),
    ).slice(0, limit);
  }

  public size(): number {
    return this.counts.size;
  }
}

/* Largest first; ties by key so the order never depends on input order. */
function sortCounts(
  counts: Array<UserFlowPageCount>,
): Array<UserFlowPageCount> {
  return counts.sort((a: UserFlowPageCount, b: UserFlowPageCount): number => {
    if (b.sessions !== a.sessions) {
      return b.sessions - a.sessions;
    }

    return a.page < b.page ? -1 : a.page > b.page ? 1 : 0;
  });
}

function pushSample(samples: Array<string>, sessionId: string): void {
  if (samples.length < USER_FLOW_SAMPLE_SESSIONS) {
    samples.push(sessionId);
  }
}

function ratio(part: number, whole: number): number {
  return whole > 0 ? part / whole : 0;
}

function median(values: Array<number>): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted: Array<number> = [...values].sort(
    (a: number, b: number): number => {
      return a - b;
    },
  );
  const middle: number = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[middle] as number;
  }

  return ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.max(min, Math.min(max, Math.round(value)));
}

/* ------------------------------------------------------------------ */
/* The flow map                                                        */
/* ------------------------------------------------------------------ */

function nodeId(step: number, page: string): string {
  return `${step}\u0000${page}`;
}

/*
 * The slice of a journey the map draws, step 0 first.
 *  - no anchor: the whole journey.
 *  - forward: from the first arrival at the anchor onwards.
 *  - backward: the anchor, then the page before it, and so on back to the
 *    session start - reversed, so step 1 is "the page they came from".
 * Null when the journey never reached the anchor.
 */
export function sliceJourneyForMap(
  pages: Array<string>,
  anchorPage: string | null,
  direction: UserFlowDirection,
): Array<string> | null {
  if (!anchorPage) {
    return pages;
  }

  const first: number = pages.indexOf(anchorPage);

  if (first < 0) {
    return null;
  }

  if (direction === "backward") {
    return pages.slice(0, first + 1).reverse();
  }

  return pages.slice(first);
}

export function buildUserFlowGraph(
  journeys: Array<UserFlowJourney>,
  options: Pick<
    UserFlowOptions,
    "anchorPage" | "direction" | "steps" | "pagesPerStep"
  >,
): UserFlowGraph {
  const steps: number = clamp(
    options.steps,
    USER_FLOW_MIN_STEPS,
    USER_FLOW_MAX_STEPS,
  );
  const pagesPerStep: number = clamp(
    options.pagesPerStep,
    USER_FLOW_MIN_PAGES_PER_STEP,
    USER_FLOW_MAX_PAGES_PER_STEP,
  );
  const direction: UserFlowDirection = options.anchorPage
    ? options.direction
    : "forward";

  const slices: Array<{ journey: UserFlowJourney; pages: Array<string> }> = [];

  for (const journey of journeys) {
    const pages: Array<string> | null = sliceJourneyForMap(
      journey.pages,
      options.anchorPage,
      direction,
    );

    if (pages && pages.length > 0) {
      slices.push({ journey: journey, pages: pages });
    }
  }

  /* Which pages keep their own node at each step: the busiest few. */
  const stepCounters: Array<Counter> = [];

  for (let step: number = 0; step < steps; step++) {
    stepCounters.push(new Counter());
  }

  for (const slice of slices) {
    const limit: number = Math.min(slice.pages.length, steps);

    for (let step: number = 0; step < limit; step++) {
      (stepCounters[step] as Counter).add(slice.pages[step] as string);
    }
  }

  const keptPages: Array<Set<string>> = stepCounters.map(
    (counter: Counter): Set<string> => {
      /*
       * Folding exactly one page into "Other pages" hides a name to save
       * nothing, so a step is only folded when two or more pages overflow.
       */
      const limit: number =
        counter.size() === pagesPerStep + 1 ? pagesPerStep + 1 : pagesPerStep;

      return new Set(
        counter.top(limit).map((entry: UserFlowPageCount): string => {
          return entry.page;
        }),
      );
    },
  );

  const nodes: Map<string, UserFlowNode> = new Map<string, UserFlowNode>();
  const otherCounters: Map<string, Counter> = new Map<string, Counter>();
  const links: Map<string, UserFlowLink> = new Map<string, UserFlowLink>();
  let populatedSteps: number = 0;

  const getNode: (step: number, page: string) => UserFlowNode = (
    step: number,
    page: string,
  ): UserFlowNode => {
    const isOther: boolean = !(keptPages[step] as Set<string>).has(page);
    const key: string = isOther ? OTHER_PAGES_KEY : page;
    const id: string = nodeId(step, key);
    let node: UserFlowNode | undefined = nodes.get(id);

    if (!node) {
      node = {
        id: id,
        step: step,
        page: key,
        label: getUserFlowPageLabel(key),
        isOther: isOther,
        otherPages: [],
        sessions: 0,
        terminal: 0,
        continued: 0,
        errorSessions: 0,
        frustrationSessions: 0,
        sampleSessionIds: [],
      };
      nodes.set(id, node);
    }

    if (isOther) {
      let counter: Counter | undefined = otherCounters.get(id);

      if (!counter) {
        counter = new Counter();
        otherCounters.set(id, counter);
      }

      counter.add(page);
    }

    return node;
  };

  for (const slice of slices) {
    const { journey, pages } = slice;
    const limit: number = Math.min(pages.length, steps);
    let previous: UserFlowNode | null = null;
    /*
     * Pages already behind the visitor at each step, in the order they
     * lived them. For a backward slice that is everything FURTHER from the
     * anchor, which sits later in the slice.
     */
    const seenBefore: Set<string> = new Set<string>();

    if (direction === "backward") {
      for (let index: number = limit; index < pages.length; index++) {
        seenBefore.add(pages[index] as string);
      }
    } else if (options.anchorPage) {
      /* Forward from an anchor: what came before the first arrival. */
      const first: number = journey.pages.indexOf(options.anchorPage);

      for (let index: number = 0; index < first; index++) {
        seenBefore.add(journey.pages[index] as string);
      }
    }

    populatedSteps = Math.max(populatedSteps, limit);

    const order: Array<number> = [];

    for (let step: number = 0; step < limit; step++) {
      order.push(step);
    }

    /* Revisits are judged in the order the visitor lived the journey. */
    const livedOrder: Array<number> =
      direction === "backward" ? [...order].reverse() : order;
    const revisitAt: Set<number> = new Set<number>();

    for (const step of livedOrder) {
      const page: string = pages[step] as string;

      if (seenBefore.has(page)) {
        revisitAt.add(step);
      }

      seenBefore.add(page);
    }

    for (const step of order) {
      const page: string = pages[step] as string;
      const node: UserFlowNode = getNode(step, page);

      node.sessions += 1;
      pushSample(node.sampleSessionIds, journey.sessionId);

      if (journey.errorPages.has(page)) {
        node.errorSessions += 1;
      }

      if (journey.frustrationPages.has(page)) {
        node.frustrationSessions += 1;
      }

      if (step === limit - 1) {
        if (pages.length > steps) {
          node.continued += 1;
        } else {
          node.terminal += 1;
        }
      }

      if (previous) {
        /* Links always run in the order the visitor lived them. */
        const source: UserFlowNode = direction === "backward" ? node : previous;
        const target: UserFlowNode = direction === "backward" ? previous : node;
        const id: string = `${source.id}\u0001${target.id}`;
        let link: UserFlowLink | undefined = links.get(id);

        if (!link) {
          link = {
            id: id,
            sourceId: source.id,
            targetId: target.id,
            fromPage: source.page,
            toPage: target.page,
            sessions: 0,
            revisitSessions: 0,
            sampleSessionIds: [],
          };
          links.set(id, link);
        }

        link.sessions += 1;
        pushSample(link.sampleSessionIds, journey.sessionId);

        /*
         * The lived destination is `node` going forward and `previous`
         * (the step nearer the anchor) going backward.
         */
        const livedTargetStep: number =
          direction === "backward" ? step - 1 : step;

        if (revisitAt.has(livedTargetStep)) {
          link.revisitSessions += 1;
        }
      }

      previous = node;
    }
  }

  for (const [id, counter] of otherCounters.entries()) {
    const node: UserFlowNode | undefined = nodes.get(id);

    if (node) {
      node.otherPages = counter.top(USER_FLOW_MAX_OTHER_PAGES);
    }
  }

  const sortedNodes: Array<UserFlowNode> = Array.from(nodes.values()).sort(
    (a: UserFlowNode, b: UserFlowNode): number => {
      if (a.step !== b.step) {
        return a.step - b.step;
      }

      /* "Other pages" sits at the bottom of its column. */
      if (a.isOther !== b.isOther) {
        return a.isOther ? 1 : -1;
      }

      if (b.sessions !== a.sessions) {
        return b.sessions - a.sessions;
      }

      return a.page < b.page ? -1 : a.page > b.page ? 1 : 0;
    },
  );

  const sortedLinks: Array<UserFlowLink> = Array.from(links.values()).sort(
    (a: UserFlowLink, b: UserFlowLink): number => {
      if (b.sessions !== a.sessions) {
        return b.sessions - a.sessions;
      }

      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    },
  );

  return {
    direction: direction,
    anchorPage: options.anchorPage,
    steps: populatedSteps,
    nodes: sortedNodes,
    links: sortedLinks,
    sessions: slices.length,
  };
}

/* ------------------------------------------------------------------ */
/* Pages, paths, loops                                                 */
/* ------------------------------------------------------------------ */

interface PageAccumulator {
  sessions: number;
  views: number;
  entries: number;
  exits: number;
  bounces: number;
  errorSessions: number;
  frustrationSessions: number;
  next: Counter;
  previous: Counter;
  sampleSessionIds: Array<string>;
}

export function buildUserFlowPageStats(
  journeys: Array<UserFlowJourney>,
): Array<UserFlowPageStats> {
  const pages: Map<string, PageAccumulator> = new Map<
    string,
    PageAccumulator
  >();

  const get: (page: string) => PageAccumulator = (
    page: string,
  ): PageAccumulator => {
    let accumulator: PageAccumulator | undefined = pages.get(page);

    if (!accumulator) {
      accumulator = {
        sessions: 0,
        views: 0,
        entries: 0,
        exits: 0,
        bounces: 0,
        errorSessions: 0,
        frustrationSessions: 0,
        next: new Counter(),
        previous: new Counter(),
        sampleSessionIds: [],
      };
      pages.set(page, accumulator);
    }

    return accumulator;
  };

  for (const journey of journeys) {
    const visited: Set<string> = new Set<string>();
    /* Next / previous count sessions, not transitions, like every column. */
    const nextSeen: Set<string> = new Set<string>();
    const previousSeen: Set<string> = new Set<string>();

    journey.pages.forEach((page: string, index: number): void => {
      const accumulator: PageAccumulator = get(page);

      accumulator.views += 1;

      if (!visited.has(page)) {
        visited.add(page);
        accumulator.sessions += 1;
        pushSample(accumulator.sampleSessionIds, journey.sessionId);

        if (journey.errorPages.has(page)) {
          accumulator.errorSessions += 1;
        }

        if (journey.frustrationPages.has(page)) {
          accumulator.frustrationSessions += 1;
        }
      }

      const next: string | undefined = journey.pages[index + 1];

      if (next !== undefined && !nextSeen.has(`${page}\u0000${next}`)) {
        nextSeen.add(`${page}\u0000${next}`);
        accumulator.next.add(next);
      }

      const previous: string | undefined = journey.pages[index - 1];

      if (
        previous !== undefined &&
        !previousSeen.has(`${page}\u0000${previous}`)
      ) {
        previousSeen.add(`${page}\u0000${previous}`);
        accumulator.previous.add(previous);
      }
    });

    const entry: string = journey.pages[0] as string;
    const exit: string = journey.pages[journey.pages.length - 1] as string;

    get(entry).entries += 1;
    get(exit).exits += 1;

    if (journey.pages.length === 1) {
      get(entry).bounces += 1;
    }
  }

  const stats: Array<UserFlowPageStats> = Array.from(pages.entries()).map(
    ([page, accumulator]: [string, PageAccumulator]): UserFlowPageStats => {
      return {
        page: page,
        sessions: accumulator.sessions,
        views: accumulator.views,
        entries: accumulator.entries,
        exits: accumulator.exits,
        bounces: accumulator.bounces,
        exitRate: ratio(accumulator.exits, accumulator.sessions),
        errorSessions: accumulator.errorSessions,
        frustrationSessions: accumulator.frustrationSessions,
        next: accumulator.next.top(USER_FLOW_MAX_NEIGHBOURS),
        previous: accumulator.previous.top(USER_FLOW_MAX_NEIGHBOURS),
        sampleSessionIds: accumulator.sampleSessionIds,
      };
    },
  );

  return stats.sort((a: UserFlowPageStats, b: UserFlowPageStats): number => {
    if (b.sessions !== a.sessions) {
      return b.sessions - a.sessions;
    }

    return a.page < b.page ? -1 : a.page > b.page ? 1 : 0;
  });
}

interface PathAccumulator {
  pages: Array<string>;
  isTruncated: boolean;
  sessions: number;
  totalDurationMs: number;
  errorSessions: number;
  frustrationSessions: number;
  sampleSessionIds: Array<string>;
}

export function buildUserFlowPaths(
  journeys: Array<UserFlowJourney>,
): Array<UserFlowPath> {
  const paths: Map<string, PathAccumulator> = new Map<
    string,
    PathAccumulator
  >();

  for (const journey of journeys) {
    const isTruncated: boolean =
      journey.pages.length > USER_FLOW_MAX_PATH_LENGTH;
    const pages: Array<string> = journey.pages.slice(
      0,
      USER_FLOW_MAX_PATH_LENGTH,
    );
    const key: string = `${pages.join("\u0000")}${isTruncated ? "\u0001" : ""}`;
    let accumulator: PathAccumulator | undefined = paths.get(key);

    if (!accumulator) {
      accumulator = {
        pages: pages,
        isTruncated: isTruncated,
        sessions: 0,
        totalDurationMs: 0,
        errorSessions: 0,
        frustrationSessions: 0,
        sampleSessionIds: [],
      };
      paths.set(key, accumulator);
    }

    accumulator.sessions += 1;
    accumulator.totalDurationMs += Math.max(0, journey.durationMs);

    if (journey.hadErrors) {
      accumulator.errorSessions += 1;
    }

    if (journey.hadFrustration) {
      accumulator.frustrationSessions += 1;
    }

    pushSample(accumulator.sampleSessionIds, journey.sessionId);
  }

  return Array.from(paths.values())
    .sort((a: PathAccumulator, b: PathAccumulator): number => {
      if (b.sessions !== a.sessions) {
        return b.sessions - a.sessions;
      }

      /* Longer journeys first among ties: they say more. */
      if (b.pages.length !== a.pages.length) {
        return b.pages.length - a.pages.length;
      }

      const aKey: string = a.pages.join("\u0000");
      const bKey: string = b.pages.join("\u0000");

      return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
    })
    .slice(0, USER_FLOW_MAX_PATHS)
    .map((accumulator: PathAccumulator): UserFlowPath => {
      return {
        pages: accumulator.pages,
        isTruncated: accumulator.isTruncated,
        sessions: accumulator.sessions,
        share: ratio(accumulator.sessions, journeys.length),
        avgDurationMs: ratio(accumulator.totalDurationMs, accumulator.sessions),
        errorSessions: accumulator.errorSessions,
        frustrationSessions: accumulator.frustrationSessions,
        sampleSessionIds: accumulator.sampleSessionIds,
      };
    });
}

/*
 * A -> B -> A, counted once per session and per unordered pair, so a
 * visitor bouncing between a list and a detail page five times is one
 * session with that loop - the question is how many PEOPLE go in circles.
 */
export function buildUserFlowLoops(
  journeys: Array<UserFlowJourney>,
): Array<UserFlowLoop> {
  const loops: Map<
    string,
    { pageA: string; pageB: string; sessions: number; samples: Array<string> }
  > = new Map();

  for (const journey of journeys) {
    const seen: Set<string> = new Set<string>();

    for (let index: number = 0; index + 2 < journey.pages.length; index++) {
      const first: string = journey.pages[index] as string;
      const middle: string = journey.pages[index + 1] as string;

      if (journey.pages[index + 2] !== first || middle === first) {
        continue;
      }

      const [pageA, pageB]: [string, string] =
        first < middle ? [first, middle] : [middle, first];
      const key: string = `${pageA}\u0000${pageB}`;

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);

      let loop:
        | {
            pageA: string;
            pageB: string;
            sessions: number;
            samples: Array<string>;
          }
        | undefined = loops.get(key);

      if (!loop) {
        loop = { pageA: pageA, pageB: pageB, sessions: 0, samples: [] };
        loops.set(key, loop);
      }

      loop.sessions += 1;
      pushSample(loop.samples, journey.sessionId);
    }
  }

  return Array.from(loops.values())
    .sort(
      (
        a: { pageA: string; pageB: string; sessions: number },
        b: { pageA: string; pageB: string; sessions: number },
      ): number => {
        if (b.sessions !== a.sessions) {
          return b.sessions - a.sessions;
        }

        const aKey: string = `${a.pageA}\u0000${a.pageB}`;
        const bKey: string = `${b.pageA}\u0000${b.pageB}`;

        return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
      },
    )
    .slice(0, USER_FLOW_MAX_LOOPS)
    .map(
      (loop: {
        pageA: string;
        pageB: string;
        sessions: number;
        samples: Array<string>;
      }): UserFlowLoop => {
        return {
          pageA: loop.pageA,
          pageB: loop.pageB,
          sessions: loop.sessions,
          share: ratio(loop.sessions, journeys.length),
          sampleSessionIds: loop.samples,
        };
      },
    );
}

/* ------------------------------------------------------------------ */
/* Summary and findings                                                */
/* ------------------------------------------------------------------ */

export function buildUserFlowSummary(
  journeys: Array<UserFlowJourney>,
  pages: Array<UserFlowPageStats>,
): UserFlowSummary {
  const lengths: Array<number> = journeys.map(
    (journey: UserFlowJourney): number => {
      return journey.pages.length;
    },
  );
  const totalPages: number = lengths.reduce((sum: number, value: number) => {
    return sum + value;
  }, 0);
  const bounces: number = lengths.filter((length: number): boolean => {
    return length === 1;
  }).length;

  const topBy: (
    pick: (page: UserFlowPageStats) => number,
  ) => UserFlowPageCount | null = (
    pick: (page: UserFlowPageStats) => number,
  ): UserFlowPageCount | null => {
    const top: Array<UserFlowPageCount> = sortCounts(
      pages
        .map((page: UserFlowPageStats): UserFlowPageCount => {
          return { page: page.page, sessions: pick(page) };
        })
        .filter((entry: UserFlowPageCount): boolean => {
          return entry.sessions > 0;
        }),
    );

    return top[0] || null;
  };

  return {
    sessions: journeys.length,
    navigatingSessions: journeys.length - bounces,
    bounceRate: ratio(bounces, journeys.length),
    avgPagesPerSession: ratio(totalPages, journeys.length),
    medianPagesPerSession: median(lengths),
    uniquePages: pages.length,
    topEntryPage: topBy((page: UserFlowPageStats): number => {
      return page.entries;
    }),
    topExitPage: topBy((page: UserFlowPageStats): number => {
      return page.exits;
    }),
  };
}

function formatShare(share: number): string {
  const percent: number = share * 100;

  if (percent > 0 && percent < 1) {
    return "<1%";
  }

  return `${Math.round(percent)}%`;
}

function sessionsNoun(count: number): string {
  return `${count} session${count === 1 ? "" : "s"}`;
}

/*
 * At most one finding per kind, each over the sample floor, ordered by how
 * much they should worry someone. Every number in the copy is one the page
 * also shows, so a finding can always be checked against the map.
 */
export function buildUserFlowInsights(
  journeys: Array<UserFlowJourney>,
  pages: Array<UserFlowPageStats>,
  loops: Array<UserFlowLoop>,
): Array<UserFlowInsight> {
  const total: number = journeys.length;

  if (total === 0) {
    return [];
  }

  const floor: number = Math.max(
    INSIGHT_MIN_SESSIONS,
    Math.ceil(total * INSIGHT_MIN_SHARE),
  );
  const qualifying: Array<UserFlowPageStats> = pages.filter(
    (page: UserFlowPageStats): boolean => {
      return page.sessions >= floor;
    },
  );
  const insights: Array<UserFlowInsight> = [];

  /*
   * Error and frustration hotspots: the page where the largest SHARE of its
   * visitors hit the problem, among pages with enough visitors.
   */
  const hotspot: (
    kind: "error-hotspot" | "frustration-hotspot",
    pick: (page: UserFlowPageStats) => number,
  ) => void = (
    kind: "error-hotspot" | "frustration-hotspot",
    pick: (page: UserFlowPageStats) => number,
  ): void => {
    const candidates: Array<UserFlowPageStats> = qualifying
      .filter((page: UserFlowPageStats): boolean => {
        return pick(page) >= INSIGHT_MIN_SESSIONS;
      })
      .sort((a: UserFlowPageStats, b: UserFlowPageStats): number => {
        const difference: number =
          ratio(pick(b), b.sessions) - ratio(pick(a), a.sessions);

        if (difference !== 0) {
          return difference;
        }

        return pick(b) - pick(a);
      });
    const page: UserFlowPageStats | undefined = candidates[0];

    if (!page) {
      return;
    }

    const count: number = pick(page);
    const share: number = ratio(count, page.sessions);

    insights.push({
      kind: kind,
      tone: kind === "error-hotspot" ? "danger" : "warning",
      title:
        kind === "error-hotspot"
          ? `Errors concentrate on ${page.page}`
          : `Frustration concentrates on ${page.page}`,
      detail:
        kind === "error-hotspot"
          ? `${formatShare(share)} of the sessions that visited ${page.page} hit an error there (${sessionsNoun(count)}).`
          : `${formatShare(share)} of the sessions that visited ${page.page} rage-clicked, dead-clicked or reloaded in frustration there (${sessionsNoun(count)}).`,
      page: page.page,
      focusDirection: "forward",
      sessions: count,
      share: share,
    });
  };

  hotspot("error-hotspot", (page: UserFlowPageStats): number => {
    return page.errorSessions;
  });

  /*
   * Drop-off: the page that ends the most journeys that had somewhere else
   * to go. Two kinds of page are left out, because they would win this
   * every time and say nothing:
   *  - bounces: a landing page everyone leaves is a marketing question;
   *  - natural ends: a page almost nobody continues from ("order placed",
   *    "signed out") is where journeys are MEANT to end. A page only counts
   *    as a drop-off when a real share of its visitors do go on, which is
   *    what makes the ones who left stand out. A page that is broken for
   *    everyone is the error hotspot's finding, not this one.
   */
  const dropOff: UserFlowPageStats | undefined = qualifying
    .filter((page: UserFlowPageStats): boolean => {
      return (
        page.exits - page.bounces >= INSIGHT_MIN_SESSIONS &&
        ratio(page.sessions - page.exits, page.sessions) >=
          DROP_OFF_MIN_CONTINUE_SHARE
      );
    })
    .sort((a: UserFlowPageStats, b: UserFlowPageStats): number => {
      const difference: number =
        ratio(b.exits - b.bounces, b.sessions - b.bounces) -
        ratio(a.exits - a.bounces, a.sessions - a.bounces);

      if (difference !== 0) {
        return difference;
      }

      return b.exits - a.exits;
    })[0];

  if (dropOff) {
    const leftAfterNavigating: number = dropOff.exits - dropOff.bounces;
    const share: number = ratio(
      leftAfterNavigating,
      dropOff.sessions - dropOff.bounces,
    );

    insights.push({
      kind: "drop-off",
      tone: share >= 0.5 ? "danger" : "warning",
      title: `Journeys end on ${dropOff.page}`,
      detail: `${formatShare(share)} of the sessions that navigated to ${dropOff.page} left the application there (${sessionsNoun(leftAfterNavigating)}).`,
      page: dropOff.page,
      focusDirection: "backward",
      sessions: leftAfterNavigating,
      share: share,
    });
  }

  hotspot("frustration-hotspot", (page: UserFlowPageStats): number => {
    return page.frustrationSessions;
  });

  const loop: UserFlowLoop | undefined = loops[0];

  if (loop && loop.sessions >= INSIGHT_MIN_SESSIONS) {
    insights.push({
      kind: "loop",
      tone: "warning",
      title: `Visitors go back and forth between ${loop.pageA} and ${loop.pageB}`,
      detail: `${formatShare(loop.share)} of sessions (${sessionsNoun(loop.sessions)}) left one of these pages for the other and came straight back - often a sign that what they needed was not where they looked first.`,
      page: loop.pageA,
      secondaryPage: loop.pageB,
      focusDirection: "forward",
      sessions: loop.sessions,
      share: loop.share,
    });
  }

  const entry: UserFlowPageStats | undefined = [...pages].sort(
    (a: UserFlowPageStats, b: UserFlowPageStats): number => {
      return b.entries - a.entries;
    },
  )[0];

  if (entry && entry.entries > 0) {
    const share: number = ratio(entry.entries, total);

    insights.push({
      kind: "top-entry",
      tone: "neutral",
      title: `Most sessions start on ${entry.page}`,
      detail: `${formatShare(share)} of sessions (${sessionsNoun(entry.entries)}) landed on ${entry.page}; ${formatShare(ratio(entry.bounces, entry.entries))} of them saw no other page.`,
      page: entry.page,
      focusDirection: "forward",
      sessions: entry.entries,
      share: share,
    });
  }

  return insights;
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

export function normalizeUserFlowOptions(
  options: Partial<UserFlowOptions>,
): UserFlowOptions {
  const merged: UserFlowOptions = { ...DEFAULT_USER_FLOW_OPTIONS, ...options };

  return {
    ...merged,
    anchorPage: merged.anchorPage || null,
    direction: merged.direction === "backward" ? "backward" : "forward",
    steps: clamp(merged.steps, USER_FLOW_MIN_STEPS, USER_FLOW_MAX_STEPS),
    pagesPerStep: clamp(
      merged.pagesPerStep,
      USER_FLOW_MIN_PAGES_PER_STEP,
      USER_FLOW_MAX_PAGES_PER_STEP,
    ),
    hiddenPages: (merged.hiddenPages || []).filter((page: string): boolean => {
      /* The anchor cannot be hidden: the map would have nothing to draw. */
      return Boolean(page) && page !== merged.anchorPage;
    }),
  };
}

export function analyzeUserFlow(
  response: UserFlowJourneysResponseDto,
  partialOptions: Partial<UserFlowOptions> = {},
): UserFlowAnalysis {
  const options: UserFlowOptions = normalizeUserFlowOptions(partialOptions);
  const { journeys, includesHost } = buildUserFlowJourneys(response, options);
  const pages: Array<UserFlowPageStats> = buildUserFlowPageStats(journeys);
  const loops: Array<UserFlowLoop> = buildUserFlowLoops(journeys);

  const deviceTypes: Array<string> = Array.from(
    new Set(
      response.sessions
        .map((session: UserFlowSessionDto): string => {
          return session.deviceType;
        })
        .filter(Boolean),
    ),
  ).sort();

  return {
    summary: buildUserFlowSummary(journeys, pages),
    graph: buildUserFlowGraph(journeys, options),
    paths: buildUserFlowPaths(journeys),
    pages: pages,
    loops: loops,
    insights: buildUserFlowInsights(journeys, pages, loops),
    availablePages: pages.map((page: UserFlowPageStats): UserFlowPageCount => {
      return { page: page.page, sessions: page.sessions };
    }),
    deviceTypes: deviceTypes,
    includesHost: includesHost,
  };
}
