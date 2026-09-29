import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Issue #4105 follow-up: an auto-refresh tick must never supersede a load
 * that is still running for the same window.
 *
 * The overview pages keep only their newest load, so a zoom and its reset
 * cannot land out of order. Their auto-refresh timers used to start a load
 * on every tick whether or not one was still running; a load that outlasted
 * the interval was superseded by the tick's before it landed, and when
 * every load did (a wide range, a busy ClickHouse), none ever landed: the
 * tiles and charts on skeletons for good, Refresh disabled and spinning.
 * The Serverless and Cloud overviews did the same through their metrics
 * effect, which was keyed on the model object every tick replaces.
 *
 * Only the timer waits. A zoom, its reset, the picker and Refresh must
 * still replace a running load at once.
 *
 * App's jest runs in node and cannot render React, so the wiring is pinned
 * here as whitespace-squashed source (comments stripped, so a rationale
 * comment or a Prettier reflow cannot make a test pass or fail). The
 * behaviour is rendered for real, with every load outlasting the interval,
 * in:
 *
 *   Common/Tests/App/Dashboard/HostPagesSlowLoads.test.tsx
 *   Common/Tests/App/Dashboard/ContainerHostOverviewSlowLoads.test.tsx
 *   Common/Tests/App/Dashboard/VMwareOverviewSlowLoads.test.tsx
 *   Common/Tests/App/Dashboard/ProxmoxOverviewSlowLoads.test.tsx
 *   Common/Tests/App/Dashboard/CloudServerlessSlowLoads.test.tsx
 */

const PAGES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Pages",
);

const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /(^|[^:])\/\/[^\n]*/g;
const WHITESPACE: RegExp = /\s+/g;

function readSquashed(relative: string): string {
  return fs
    .readFileSync(path.join(PAGES_DIR, ...relative.split("/")), "utf8")
    .replace(BLOCK_COMMENT, " ")
    .replace(LINE_COMMENT, "$1")
    .replace(WHITESPACE, " ");
}

function countOf(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

// The slice of `source` from `from` up to (not including) the next `to`.
function between(source: string, from: string, to: string): string {
  const start: number = source.indexOf(from);

  if (start < 0) {
    throw new Error(`Expected the source to contain "${from}".`);
  }

  const end: number = source.indexOf(to, start + from.length);

  if (end < 0) {
    throw new Error(`Expected "${to}" after "${from}".`);
  }

  return source.slice(start, end);
}

function escapeForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface GuardedPage {
  file: string;
  // Numbers every load, so only the newest one commits.
  seqRef: string;
  // Set while the newest load runs; the timer waits on it.
  inFlightRef: string;
  // The auto-refresh timer's callback, as it must read.
  timer: string;
}

const HOST_TIMER: (loader: string, setError: string) => string = (
  loader: string,
  setError: string,
): string => {
  return `setInterval(() => { if (fetchInFlightRef.current) { return; } ${loader}.current().catch((err: Error) => { ${setError}(API.getFriendlyMessage(err)); }); }, ms);`;
};

/*
 * Docker and Podman flip the details card's refresher on every tick, while
 * the stats fetch runs or not: Last Seen and Agent Version keep refreshing.
 */
const CONTAINER_TIMER: string =
  "setInterval(() => { if (!fetchInFlightRef.current) { fetchStatsRef.current().catch((err: Error) => { setStatsError(API.getFriendlyMessage(err)); }); } setDetailsRefresher((prev: boolean) => { return !prev; }); }, ms);";

const GUARDED_PAGES: Array<[string, GuardedPage]> = [
  [
    "Host overview",
    {
      file: "Host/View/Overview.tsx",
      seqRef: "fetchSeqRef",
      inFlightRef: "fetchInFlightRef",
      timer: HOST_TIMER("fetchStatsRef", "setStatsError"),
    },
  ],
  [
    "Host process view",
    {
      file: "Host/View/ProcessView.tsx",
      seqRef: "fetchSeqRef",
      inFlightRef: "fetchInFlightRef",
      timer: HOST_TIMER("fetchStatsRef", "setStatsError"),
    },
  ],
  [
    "Host Windows service view",
    {
      file: "Host/View/ServiceView.tsx",
      seqRef: "fetchSeqRef",
      inFlightRef: "fetchInFlightRef",
      timer: HOST_TIMER("fetchDataRef", "setError"),
    },
  ],
  [
    "Host systemd unit view",
    {
      file: "Host/View/SystemdUnitView.tsx",
      seqRef: "fetchSeqRef",
      inFlightRef: "fetchInFlightRef",
      timer: HOST_TIMER("fetchDataRef", "setError"),
    },
  ],
  [
    "Docker host overview",
    {
      file: "Docker/View/Overview.tsx",
      seqRef: "fetchSeqRef",
      inFlightRef: "fetchInFlightRef",
      timer: CONTAINER_TIMER,
    },
  ],
  [
    "Podman host overview",
    {
      file: "Podman/View/Overview.tsx",
      seqRef: "fetchSeqRef",
      inFlightRef: "fetchInFlightRef",
      timer: CONTAINER_TIMER,
    },
  ],
  [
    "VMware vCenter overview",
    {
      file: "VMware/View/Index.tsx",
      seqRef: "goldenLoadSeqRef",
      inFlightRef: "goldenLoadInFlightRef",
      // Only the golden metrics wait; the inventory and details still tick.
      timer:
        "setInterval(() => { if (vcenter?.name) { if (!goldenLoadInFlightRef.current) { void loadGoldenMetricsRef.current(vcenter.name); } void loadInventory(); setDetailsRefresher((prev: boolean) => { return !prev; }); } }, ms);",
    },
  ],
  [
    "Proxmox cluster overview",
    {
      file: "Proxmox/View/Index.tsx",
      seqRef: "goldenLoadSeqRef",
      inFlightRef: "goldenLoadInFlightRef",
      // Only the golden metrics wait; replication is anchored to now.
      timer:
        "setInterval(() => { if (cluster?.name) { if (!goldenLoadInFlightRef.current) { void loadGoldenMetricsRef.current(cluster.name); } void loadInventory(); void loadReplication(cluster.name); setDetailsRefresher((prev: boolean) => { return !prev; }); } }, ms);",
    },
  ],
];

describe.each(GUARDED_PAGES)(
  "%s: the auto-refresh waits for a load still running",
  (_name: string, page: GuardedPage) => {
    const source: string = readSquashed(page.file);
    const inFlight: string = page.inFlightRef;

    test("keeps an in-flight flag, down until a load starts", () => {
      expect(source).toContain(
        `const ${inFlight}: React.MutableRefObject<boolean> = useRef<boolean>(false);`,
      );
    });

    test("a load raises it as it claims the newest slot, before its first await", () => {
      expect(source).toContain(
        `const seq: number = ++${page.seqRef}.current; const isStale: () => boolean = (): boolean => { return seq !== ${page.seqRef}.current; }; ${inFlight}.current = true; setIsRefreshing(true);`,
      );
    });

    test("only the newest load lowers it, however it ends (a finally)", () => {
      /*
       * A superseded load leaves it to the load that replaced it: lowering
       * it there would let the timer supersede the newer load in turn.
       */
      expect(source).toMatch(
        new RegExp(
          `\\} finally \\{ if \\(!isStale\\(\\)\\) \\{ [^}]*${escapeForRegExp(
            `${inFlight}.current = false;`,
          )} \\} \\}`,
        ),
      );
      expect(countOf(source, `${inFlight}.current = false;`)).toBe(1);
    });

    test("the timer skips its load while one is in flight", () => {
      expect(source).toContain(page.timer);
      expect(countOf(source, "setInterval(")).toBe(1);
    });

    test("nothing else waits on it: a zoom, its reset, the picker and Refresh still load at once", () => {
      // Declared, raised, lowered, and read by the timer - nowhere else.
      expect(countOf(source, inFlight)).toBe(4);
    });
  },
);

/*
 * Their metrics effect reloads when its key changes. The key used to be the
 * model object, which every refresh replaces (the tick reloads the model),
 * so its ignore cleanup dropped the metrics load still running for the same
 * window and started an identical one.
 */
describe.each([
  [
    "Serverless function overview",
    "Serverless/View/Overview.tsx",
    'const functionIdentifier: string = (serverlessFunction?.functionIdentifier as string | undefined) || "";',
    "}, [functionIdentifier, timeRange, metricsRefreshCount]);",
    "}, [serverlessFunction, timeRange]);",
  ],
  [
    "Cloud environment overview",
    "Cloud/View/Overview.tsx",
    'const metricsScope: string = cloudResource?.resourceIdentifier ? JSON.stringify(getCloudResourceAttributeFilters(cloudResource)) : "";',
    "}, [metricsScope, timeRange, metricsRefreshCount]);",
    "}, [cloudResource, timeRange]);",
  ],
])(
  "%s: a tick leaves a running metrics load alone",
  (
    _name: string,
    file: string,
    identity: string,
    deps: string,
    modelDeps: string,
  ) => {
    const source: string = readSquashed(file);

    test("the metrics follow the model's identity, the range and a refresh counter - not the model object", () => {
      expect(source).toContain(identity);
      expect(source).toContain(
        "const [metricsRefreshCount, setMetricsRefreshCount] = useState<number>(0);",
      );
      expect(source).toContain(deps);
      expect(source).not.toContain(modelDeps);
    });

    test("a range change still drops the load it replaces", () => {
      const effect: string = between(
        source,
        "let ignore: boolean = false;",
        deps,
      );

      expect(effect).toContain("return () => { ignore = true; };");
    });

    test("a metrics load is in flight from its start until its own answer or failure lands", () => {
      const effect: string = between(
        source,
        "let ignore: boolean = false;",
        deps,
      );

      expect(effect).toContain(
        "let ignore: boolean = false; metricsInFlightRef.current = true;",
      );
      // The answer and the failure; a dropped load leaves it to the newer.
      expect(
        countOf(
          effect,
          "if (ignore) { return; } metricsInFlightRef.current = false;",
        ),
      ).toBe(2);
    });

    test("a refresh reloads the model, and the metrics unless a tick finds them still loading", () => {
      expect(source).toContain(
        "const refresh: (options: { isAutoRefresh: boolean }) => void = (options: { isAutoRefresh: boolean; }): void => { fetchModel(false).catch(() => {}); if (options.isAutoRefresh && metricsInFlightRef.current) { return; } setMetricsRefreshCount((count: number): number => { return count + 1; }); };",
      );
      // The counter changes nowhere else.
      expect(countOf(source, "setMetricsRefreshCount(")).toBe(1);
    });

    test("only the timer waits: Refresh reloads the metrics at once", () => {
      expect(source).toContain(
        "onRefresh: (): void => { refresh({ isAutoRefresh: true }); },",
      );
      expect(source).toContain(
        "onManualRefresh={(): void => { refresh({ isAutoRefresh: false }); }}",
      );
    });
  },
);
