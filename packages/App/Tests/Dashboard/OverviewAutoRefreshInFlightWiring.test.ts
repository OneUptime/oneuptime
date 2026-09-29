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
 * The Serverless, Cloud, Service and Database overviews did the same
 * through their telemetry effect, which was keyed on the model object (the
 * Database's also on its endpoint list) every tick replaces.
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
 *   Common/Tests/App/Dashboard/ServiceDatabaseSlowLoads.test.tsx
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
 * Their telemetry effect reloads when its key changes. The key used to be
 * the model object (on the Database overview, the row and its endpoint
 * list), which every refresh replaces (the tick reloads the model), so its
 * ignore cleanup dropped the load still running for the same window and
 * started an identical one. It is keyed instead on a value of what scopes
 * the load, the range, and a refresh counter that only Refresh and an idle
 * tick bump.
 */
interface KeyedPage {
  file: string;
  // The value the effect is keyed on in place of the model object.
  scope: string;
  deps: string;
  // The key it had: the model object(s) every refresh replaces.
  modelDeps: string;
  // Set while the current window's load runs; only the tick waits on it.
  inFlightRef: string;
  // The refresh counter the effect is keyed on, and its setter.
  counter: string;
  setCounter: string;
  // How a refresh reloads the model, as the page reads.
  reloadModel: string;
  /*
   * Declared, raised, lowered by the answer and by the failure, and read by
   * the refresh - plus, on a page that can have no scope yet, lowered where
   * it then loads nothing.
   */
  inFlightMentions: number;
}

const KEYED_PAGES: Array<[string, KeyedPage]> = [
  [
    "Serverless function overview",
    {
      file: "Serverless/View/Overview.tsx",
      scope:
        'const functionIdentifier: string = (serverlessFunction?.functionIdentifier as string | undefined) || "";',
      deps: "}, [functionIdentifier, timeRange, metricsRefreshCount]);",
      modelDeps: "}, [serverlessFunction, timeRange]);",
      inFlightRef: "metricsInFlightRef",
      counter: "metricsRefreshCount",
      setCounter: "setMetricsRefreshCount",
      reloadModel: "fetchModel(false).catch(() => {});",
      inFlightMentions: 5,
    },
  ],
  [
    "Cloud environment overview",
    {
      file: "Cloud/View/Overview.tsx",
      scope:
        'const metricsScope: string = cloudResource?.resourceIdentifier ? JSON.stringify(getCloudResourceAttributeFilters(cloudResource)) : "";',
      deps: "}, [metricsScope, timeRange, metricsRefreshCount]);",
      modelDeps: "}, [cloudResource, timeRange]);",
      inFlightRef: "metricsInFlightRef",
      counter: "metricsRefreshCount",
      setCounter: "setMetricsRefreshCount",
      reloadModel: "fetchModel(false).catch(() => {});",
      inFlightMentions: 6,
    },
  ],
  [
    "Service overview",
    {
      file: "Service/View/Index.tsx",
      scope:
        'const metricsScope: string = service ? JSON.stringify({ telemetrySdkLanguage: service.telemetrySdkLanguage || "", runtimeName: service.runtimeName || "", techStack: service.techStack || [], }) : "";',
      deps: "}, [metricsScope, timeRange, metricsRefreshCount]);",
      modelDeps: "}, [service, timeRange]);",
      inFlightRef: "metricsInFlightRef",
      counter: "metricsRefreshCount",
      setCounter: "setMetricsRefreshCount",
      // The catch holds only a comment: loadModel reports its own errors.
      reloadModel: "loadModel(false).catch(() => { });",
      inFlightMentions: 5,
    },
  ],
  [
    "Database overview",
    {
      file: "Database/View/Overview.tsx",
      scope:
        'const telemetryScope: string = databaseServer ? JSON.stringify({ projectId: String( databaseServer.projectId || ProjectUtil.getCurrentProjectId() || "", ), dbSystem: databaseServer.dbSystem || "", memberEntityKeys: Object.keys( databaseServer.memberEntityKeys || {}, ).sort(), platform: getDatabaseRuntimePlatform(databaseServer), endpoints: endpoints, }) : "";',
      deps: "}, [telemetryScope, timeRange, telemetryRefreshCount]);",
      modelDeps: "}, [databaseServer, endpoints, timeRange]);",
      inFlightRef: "telemetryInFlightRef",
      counter: "telemetryRefreshCount",
      setCounter: "setTelemetryRefreshCount",
      reloadModel: "fetchModel(false).catch(() => {});",
      inFlightMentions: 6,
    },
  ],
];

describe.each(KEYED_PAGES)(
  "%s: a tick leaves a running telemetry load alone",
  (_name: string, page: KeyedPage) => {
    const source: string = readSquashed(page.file);
    const inFlight: string = page.inFlightRef;

    test("the load follows a value of what scopes it, the range and a refresh counter - not the model object", () => {
      expect(source).toContain(page.scope);
      expect(source).toContain(
        `const [${page.counter}, ${page.setCounter}] = useState<number>(0);`,
      );
      expect(source).toContain(page.deps);
      expect(source).not.toContain(page.modelDeps);
    });

    test("a range change still drops the load it replaces", () => {
      const effect: string = between(
        source,
        "let ignore: boolean = false;",
        page.deps,
      );

      expect(effect).toContain("return () => { ignore = true; };");
    });

    test("keeps an in-flight flag, down until a load starts", () => {
      expect(source).toContain(
        `const ${inFlight}: React.MutableRefObject<boolean> = useRef<boolean>(false);`,
      );
    });

    test("a load is in flight from its start until its own answer or failure lands", () => {
      const effect: string = between(
        source,
        "let ignore: boolean = false;",
        page.deps,
      );

      expect(effect).toContain(
        `let ignore: boolean = false; ${inFlight}.current = true;`,
      );
      // The answer and the failure; a dropped load leaves it to the newer.
      expect(
        countOf(effect, `if (ignore) { return; } ${inFlight}.current = false;`),
      ).toBe(2);
    });

    test("a refresh reloads the model, and the telemetry unless a tick finds it still loading", () => {
      expect(source).toContain(
        `const refresh: (options: { isAutoRefresh: boolean }) => void = (options: { isAutoRefresh: boolean; }): void => { ${page.reloadModel} if (options.isAutoRefresh && ${inFlight}.current) { return; } ${page.setCounter}((count: number): number => { return count + 1; }); };`,
      );
      // The counter changes nowhere else.
      expect(countOf(source, `${page.setCounter}(`)).toBe(1);
    });

    test("only the timer waits: Refresh reloads the telemetry at once", () => {
      expect(source).toContain(
        "onRefresh: (): void => { refresh({ isAutoRefresh: true }); },",
      );
      expect(source).toContain(
        "onManualRefresh={(): void => { refresh({ isAutoRefresh: false }); }}",
      );
      // The timer and the button are the only ways in.
      expect(countOf(source, "refresh({ isAutoRefresh:")).toBe(2);
    });

    test("nothing else reads or writes the flag", () => {
      expect(countOf(source, inFlight)).toBe(page.inFlightMentions);
    });
  },
);

/*
 * A page that can have no scope yet loads nothing then. No load is running,
 * so the flag goes down there too: one left up by the load that page
 * dropped would stay up with nothing to lower it.
 */
describe.each([
  [
    "Cloud environment overview",
    "Cloud/View/Overview.tsx",
    "if (!isCloudResourceScoped(item)) {",
    "metricsInFlightRef",
  ],
  [
    "Database overview",
    "Database/View/Overview.tsx",
    "if (!isDatabaseServerScoped(allKeys)) {",
    "telemetryInFlightRef",
  ],
])(
  "%s: with no scope yet nothing is in flight",
  (_name: string, file: string, guard: string, inFlight: string) => {
    test("the unscoped early return lowers the flag", () => {
      const unscoped: string = between(readSquashed(file), guard, "return;");

      expect(unscoped).toContain(`${guard} ${inFlight}.current = false;`);
    });
  },
);

/*
 * The key must name everything the load reads off the model: a field left
 * out would not reload the telemetry when a refresh changes it.
 */
interface KeyCoverage {
  file: string;
  // Where the load's effect starts, and what it calls the model.
  effectStart: string;
  deps: string;
  modelInEffect: string;
  // Where the key is worked out, and what it calls the model.
  scopeStart: string;
  modelInScope: string;
  // The model fields both read, sorted.
  fields: Array<string>;
}

const KEY_COVERAGE: Array<[string, KeyCoverage]> = [
  [
    "Service overview",
    {
      file: "Service/View/Index.tsx",
      effectStart: "useEffect(() => { if (!service) { return; }",
      deps: "}, [metricsScope, timeRange, metricsRefreshCount]);",
      modelInEffect: "service",
      scopeStart: "const metricsScope: string = service ?",
      modelInScope: "service",
      // The language detection's inputs; the queries are scoped by the id.
      fields: ["runtimeName", "techStack", "telemetrySdkLanguage"],
    },
  ],
  [
    "Database overview",
    {
      file: "Database/View/Overview.tsx",
      effectStart:
        "useEffect(() => { const item: DatabaseServer | null = databaseServer;",
      deps: "}, [telemetryScope, timeRange, telemetryRefreshCount]);",
      modelInEffect: "item",
      scopeStart: "const telemetryScope: string = databaseServer ?",
      modelInScope: "databaseServer",
      fields: ["dbSystem", "memberEntityKeys", "projectId"],
    },
  ],
];

// The fields `code` reads off `model` (model.x or model?.x), sorted.
function fieldsRead(code: string, model: string): Array<string> {
  const read: Set<string> = new Set<string>();

  for (const match of code.matchAll(
    new RegExp(`\\b${model}\\??\\.(\\w+)`, "g"),
  )) {
    read.add(match[1]!);
  }

  return Array.from(read).sort();
}

describe.each(KEY_COVERAGE)(
  "%s: the key covers what the load reads",
  (_name: string, page: KeyCoverage) => {
    const source: string = readSquashed(page.file);

    test("every model field the load reads is in its key, and nothing more", () => {
      const effect: string = between(source, page.effectStart, page.deps);
      const scope: string = between(source, page.scopeStart, "useEffect(");

      expect(fieldsRead(effect, page.modelInEffect)).toEqual(page.fields);
      expect(fieldsRead(scope, page.modelInScope)).toEqual(page.fields);
    });
  },
);

describe("Database overview: what else its key holds", () => {
  const source: string = readSquashed("Database/View/Overview.tsx");

  test("its pods' member keys, but not when each was last seen", () => {
    /*
     * Discovery re-stamps the times as liveness; the load reads the keys as
     * a set. A key holding the times would reload the telemetry on the tick
     * after every re-stamp, replacing a load still running.
     */
    expect(source).toContain(
      "memberEntityKeys: Object.keys( databaseServer.memberEntityKeys || {}, ).sort(),",
    );
    expect(source).not.toContain(
      "memberEntityKeys: databaseServer.memberEntityKeys",
    );
  });

  test("the runtime platform and the endpoint list the load reads are in its key too", () => {
    const effect: string = between(
      source,
      "useEffect(() => { const item: DatabaseServer | null = databaseServer;",
      "}, [telemetryScope, timeRange, telemetryRefreshCount]);",
    );

    // The pod charts follow where it runs; the query keys, its endpoints.
    expect(effect).toContain("getDatabaseRuntimePlatform(item);");
    expect(effect).toContain("endpoints: endpoints,");
    expect(source).toContain(
      "platform: getDatabaseRuntimePlatform(databaseServer), endpoints: endpoints, })",
    );
  });
});
