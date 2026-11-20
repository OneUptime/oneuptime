import Monitor from "Common/Models/DatabaseModels/Monitor";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import MetricsAggregationType from "Common/Types/Metrics/MetricsAggregationType";
import { FilterType } from "Common/Types/Monitor/CriteriaFilter";
import { getDockerAlertTemplateById } from "Common/Types/Monitor/DockerAlertTemplates";
import {
  buildHostMonitorConfig,
  buildHostMonitorStep,
  buildHostOfflineCriteriaInstance,
  buildHostOnlineCriteriaInstance,
  getHostAlertTemplateById,
} from "Common/Types/Monitor/HostAlertTemplates";
import MetricMonitorResponse from "Common/Types/Monitor/MetricMonitor/MetricMonitorResponse";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationSummary from "Common/Types/Monitor/MonitorEvaluationSummary";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorStepDockerMonitor from "Common/Types/Monitor/MonitorStepDockerMonitor";
import MonitorStepPodmanMonitor from "Common/Types/Monitor/MonitorStepPodmanMonitor";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import { getPodmanAlertTemplateById } from "Common/Types/Monitor/PodmanAlertTemplates";
import ObjectID from "Common/Types/ObjectID";
import ProbeApiIngestResponse from "Common/Types/Probe/ProbeApiIngestResponse";
import RollingTime from "Common/Types/RollingTime/RollingTime";
import MetricExplorerUrl, {
  SerializedMetricFormula,
  SerializedMetricQuery,
} from "Common/Utils/Metrics/MetricExplorerUrl";
import RecordRootCauseWording from "Common/Utils/Monitor/RecordRootCauseWording";
import { dashboardTranslator } from "Common/Tests/Helpers/DashboardLocales";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import childProcess from "child_process";
import path from "path";
import type { MonitorSeedIds } from "../../../../FeatureSet/Dashboard/src/Utils/MonitorSeedIds";
import type { HostServiceKind } from "../../../../FeatureSet/Dashboard/src/Utils/HostServiceMonitorPrefill";

/*
 * AN INCIDENT'S LINKS OPEN WHAT THE MONITOR READ (#10451).
 *
 * The root cause of a Host, Docker or Podman monitor's incident ends with
 * three links: Open metric, Open logs and Open traces. They were built from
 * the step's own queries, which the worker reads narrowed to the host and
 * its containers, so the metric was charted on every host, and logs and
 * spans were searched for the metric's own attributes - a Windows service's
 * `name`, which no log line has, and which a traces search reads as the
 * span's name.
 *
 * Each monitor here reads samples stored on two hosts through the worker's
 * real read (monitorHost, monitorDocker, monitorPodman, folded per minute
 * as ClickHouse folds them: SqlGroupedFold), is judged by the real
 * evaluator, and its root cause is worded and laid out as the incident's
 * Root Cause page draws it (RecordRootCauseWording, then the viewer's
 * react-markdown and its address check), in English and in Persian. Each
 * link of that page is then opened the way its explorer opens it: its path
 * against the Dashboard's route, the metric explorer's own parse of its
 * queries, the logs explorer's compile of its chips onto the logs query
 * (applyLogsFacetFiltersToQuery) and the traces explorer's parse of its
 * search (parseTraceSearch).
 */

// Keep the heavy worker module from touching Redis at import time.
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: { addJob: jest.fn() },
    QueueName: { Telemetry: "Telemetry" },
  };
});

// The worker transitively loads the native `isolated-vm` addon; stub it.
jest.mock("Common/Server/Utils/VM/VMRunner", () => {
  return { __esModule: true, default: {} };
});

jest.mock("Common/Server/Services/MetricService", () => {
  return {
    __esModule: true,
    default: { aggregateBy: jest.fn(), findBy: jest.fn() },
  };
});
jest.mock("Common/Server/Services/MetricTypeService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});
jest.mock("Common/Server/Services/HostService", () => {
  return {
    __esModule: true,
    default: { getExpectedHostIdentifiers: jest.fn() },
  };
});

import MetricService from "Common/Server/Services/MetricService";
import MetricTypeService from "Common/Server/Services/MetricTypeService";
import HostService from "Common/Server/Services/HostService";
import MonitorCriteriaEvaluator from "Common/Server/Utils/Monitor/MonitorCriteriaEvaluator";
import {
  monitorDocker,
  monitorHost,
  monitorPodman,
} from "../../../../FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor";
import { DashboardClientUrl } from "Common/Server/EnvironmentConfig";
import { DashboardRoute } from "Common/ServiceRoute";
import { StoredMetricRow, foldRowsAsSqlRead } from "./SqlGroupedFold";

type PrefillModule =
  typeof import("../../../../FeatureSet/Dashboard/src/Utils/HostServiceMonitorPrefill");
type RouteMapModule =
  typeof import("../../../../FeatureSet/Dashboard/src/Utils/RouteMap");
type PageMapModule =
  typeof import("../../../../FeatureSet/Dashboard/src/Utils/PageMap");
type LogsPivotModule =
  typeof import("../../../../FeatureSet/Dashboard/src/Utils/LogsCrossSignalPivot");
type TracesSearchModule =
  typeof import("../../../../FeatureSet/Dashboard/src/Components/Traces/TracesSearchCompile");
type EvaluationTextModule =
  typeof import("../../../../FeatureSet/Dashboard/src/Utils/EvaluationText");

let Prefill: PrefillModule;
let Routes: RouteMapModule;
let Pages: PageMapModule;
let LogsPivot: LogsPivotModule;
let TracesSearch: TracesSearchModule;
let EvaluationText: EvaluationTextModule;

const metricAggregateBy: jest.Mock =
  MetricService.aggregateBy as unknown as jest.Mock;
const metricFindBy: jest.Mock = MetricService.findBy as unknown as jest.Mock;
const metricTypeFindBy: jest.Mock =
  MetricTypeService.findBy as unknown as jest.Mock;
const expectedHostIdentifiers: jest.Mock =
  HostService.getExpectedHostIdentifiers as unknown as jest.Mock;

const SECOND: number = 1_000;
const MINUTE: number = 60 * SECOND;

// Every check is made at noon; every sample is taken in the hour before it.
const CHECK_AT_MS: number = Date.UTC(2026, 10, 20, 12, 0, 0);

const HOST: string = "web-01";
const OTHER_HOST: string = "web-02";
const HOST_ID: string = "11111111-1111-4111-8111-111111111111";
const DOCKER_HOST: string = "dock-01";
const OTHER_DOCKER_HOST: string = "dock-02";

const projectId: ObjectID = ObjectID.generate();
const monitorId: ObjectID = ObjectID.generate();

const OFFLINE_ID: ObjectID = ObjectID.generate();
const ONLINE_ID: ObjectID = ObjectID.generate();
const SEVERITY_ID: ObjectID = ObjectID.generate();

const seeds: MonitorSeedIds = {
  operationalMonitorStatusId: ONLINE_ID,
  offlineMonitorStatusId: OFFLINE_ID,
  rankedIncidentSeverityIds: [SEVERITY_ID],
  rankedAlertSeverityIds: [SEVERITY_ID],
};

const templateArgs: (hostIdentifier: string) => {
  hostIdentifier: string;
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
  monitorName: string;
} = (
  hostIdentifier: string,
): {
  hostIdentifier: string;
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
  monitorName: string;
} => {
  return {
    hostIdentifier: hostIdentifier,
    onlineMonitorStatusId: ONLINE_ID,
    offlineMonitorStatusId: OFFLINE_ID,
    defaultIncidentSeverityId: SEVERITY_ID,
    defaultAlertSeverityId: SEVERITY_ID,
    monitorName: hostIdentifier || "every host",
  };
};

// A sample every 30 seconds through the hour before the check.
function scrapeTimes(): Array<number> {
  const times: Array<number> = [];

  for (
    let ms: number = CHECK_AT_MS - 60 * MINUTE;
    ms <= CHECK_AT_MS;
    ms += 30 * SECOND
  ) {
    times.push(ms);
  }

  return times;
}

function samples(
  value: number,
  attributes: JSONObject,
): Array<StoredMetricRow> {
  return scrapeTimes().map((ms: number): StoredMetricRow => {
    return { time: new Date(ms), value: value, attributes: attributes };
  });
}

// What a read selects: every attribute it names, equal.
function isSelected(
  row: StoredMetricRow,
  attributes: Dictionary<unknown> | undefined,
): boolean {
  return Object.entries(attributes || {}).every(
    ([key, value]: [string, unknown]): boolean => {
      return row.attributes[key] === value;
    },
  );
}

interface Read {
  query: { name: string; attributes?: Dictionary<unknown> };
  aggregationType: MetricsAggregationType;
  groupByAttributeKeys?: Array<string>;
  startTimestamp: Date;
  endTimestamp: Date;
}

// The rows of the store, by metric name, which every read selects from.
let stored: Dictionary<Array<StoredMetricRow>> = {};
let reads: Array<Read> = [];

/*
 * The store, and the catalog of the metrics read: installed once, before the
 * incidents are made (in a beforeAll), and every read selects from the rows
 * of the incident being made.
 */
function installStore(): void {
  stored = {};
  reads = [];
  metricAggregateBy.mockReset().mockImplementation(async (args: unknown) => {
    const read: Read = args as Read;
    reads.push(read);

    return foldRowsAsSqlRead(
      (stored[read.query.name] || []).filter((row: StoredMetricRow) => {
        return (
          row.time.getTime() >= read.startTimestamp.getTime() &&
          row.time.getTime() <= read.endTimestamp.getTime() &&
          isSelected(row, read.query.attributes)
        );
      }),
      read,
    );
  });
  metricFindBy.mockReset().mockResolvedValue([]);
  metricTypeFindBy.mockReset().mockResolvedValue([
    { name: "windows.service.status", unit: "{status}" },
    { name: "systemd.unit.state", unit: "1" },
    { name: "system.cpu.utilization", unit: "1" },
    { name: "container.cpu.utilization", unit: "%" },
  ]);
  expectedHostIdentifiers.mockReset().mockResolvedValue([HOST, OTHER_HOST]);
}

type WorkerRead = (data: {
  monitorStep: MonitorStep;
  monitorId: ObjectID;
  projectId: ObjectID;
  evaluateUntil?: Date | undefined;
}) => Promise<MetricMonitorResponse>;

interface Incident {
  // The root cause as the evaluator writes it.
  rootCause: string;
  // The reads the worker made for it.
  reads: Array<Read>;
  rows: Dictionary<Array<StoredMetricRow>>;
}

// One check of a monitor at noon, and the root cause of what it opened.
async function incidentOf(data: {
  monitorType: MonitorType;
  step: MonitorStep;
  rows: Dictionary<Array<StoredMetricRow>>;
  read: WorkerRead;
}): Promise<Incident> {
  stored = data.rows;
  reads = [];

  const response: MetricMonitorResponse = await data.read({
    monitorStep: data.step,
    monitorId: monitorId,
    projectId: projectId,
    evaluateUntil: new Date(CHECK_AT_MS),
  });

  const monitor: Monitor = new Monitor();
  monitor._id = monitorId.toString();
  monitor.projectId = projectId;
  monitor.monitorType = data.monitorType;
  monitor.name = "Watched";

  const result: ProbeApiIngestResponse =
    await MonitorCriteriaEvaluator.processMonitorStep({
      dataToProcess: response,
      monitorStep: data.step,
      monitor: monitor,
      probeApiIngestResponse: { monitorId: monitorId, rootCause: null },
      evaluationSummary: {
        criteriaResults: [],
        events: [],
      } as unknown as MonitorEvaluationSummary,
    });

  const opened: boolean = Boolean(
    data.step.data?.monitorCriteria?.data?.monitorCriteriaInstanceArray.find(
      (instance: MonitorCriteriaInstance): boolean => {
        return (
          instance.data?.id?.toString() === result.criteriaMetId?.toString() &&
          Boolean(instance.data?.createIncidents)
        );
      },
    ),
  );

  expect({ opened: opened, hasRootCause: Boolean(result.rootCause) }).toEqual({
    opened: true,
    hasRootCause: true,
  });

  return { rootCause: result.rootCause!, reads: [...reads], rows: data.rows };
}

// The monitor Create Monitor opens on a service's page, as the form saves it.
function serviceMonitorStep(
  kind: HostServiceKind,
  serviceName: string,
): MonitorStep {
  const prefill: JSONObject | null = Prefill.buildHostServiceMonitorPrefill({
    link: { hostId: HOST_ID, kind: kind, serviceName: serviceName },
    host: { id: HOST_ID, hostIdentifier: HOST, name: HOST },
    seeds: seeds,
  });

  return MonitorSteps.fromJSON(prefill!["monitorSteps"] as JSONObject).data!
    .monitorStepsInstanceArray[0]!;
}

function withContainerName(
  step: MonitorStep,
  containerName: string,
): MonitorStep {
  const config:
    | MonitorStepDockerMonitor
    | MonitorStepPodmanMonitor
    | undefined = step.data?.dockerMonitor || step.data?.podmanMonitor;

  config!.containerFilters = { ...config!.containerFilters, containerName };

  return step;
}

/*
 * THE ROOT CAUSE PAGE, LAID OUT.
 *
 * The page words the stored root cause in the reader's language, each value
 * set apart from the words round it (RecordRootCauseWording), and draws it
 * with react-markdown, remark-gfm and the viewer's own address check
 * (markdownUrlTransform), in a node subprocess: jest stubs react-markdown,
 * an ES module (see Common's MarkdownUrlTransform.test.ts).
 */
const COMMON_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "Common",
);

const RENDER_SCRIPT: string = String.raw`
  const esbuild = require("esbuild");
  const Module = require("module");
  const path = require("path");

  const entry = [
    'import React from "react";',
    'import { renderToStaticMarkup } from "react-dom/server";',
    'import ReactMarkdown from "react-markdown";',
    'import remarkGfm from "remark-gfm";',
    'import { markdownUrlTransform } from "./UI/Components/Markdown.tsx/MarkdownUrlTransform";',
    'import { rehypeBlocksReadTheirOwnWay } from "./UI/Components/Markdown.tsx/MarkdownReadingDirection";',
    "const texts = JSON.parse(process.env.MARKDOWN_TEXTS);",
    "process.stdout.write(JSON.stringify(texts.map((text) => renderToStaticMarkup(",
    "  React.createElement(ReactMarkdown, { remarkPlugins: [remarkGfm], rehypePlugins: [rehypeBlocksReadTheirOwnWay], urlTransform: markdownUrlTransform }, text),",
    "))));",
  ].join("\n");

  esbuild
    .build({
      stdin: { contents: entry, resolveDir: process.cwd(), loader: "ts", sourcefile: "render.ts" },
      bundle: true,
      platform: "node",
      format: "cjs",
      write: false,
      logLevel: "silent",
      define: { "process.env.NODE_ENV": '"production"' },
    })
    .then((result) => {
      const file = path.join(process.cwd(), "render.js");
      const compiled = new Module(file);
      compiled.filename = file;
      compiled.paths = Module._nodeModulePaths(process.cwd());
      compiled._compile(result.outputFiles[0].text, file);
    })
    .catch((error) => {
      process.stderr.write(String(error && error.stack ? error.stack : error));
      process.exit(1);
    });
`;

function renderWithReactMarkdown(texts: Array<string>): Array<string> {
  return JSON.parse(
    childProcess.execFileSync(process.execPath, ["-e", RENDER_SCRIPT], {
      cwd: COMMON_ROOT,
      env: { ...process.env, MARKDOWN_TEXTS: JSON.stringify(texts) },
      encoding: "utf8",
      timeout: 120000,
      maxBuffer: 64 * 1024 * 1024,
    }),
  ) as Array<string>;
}

// The marks react-dom writes in an attribute, every one of them read back.
const HTML_ENTITIES: Dictionary<string> = {
  "&amp;": "&",
  "&quot;": '"',
  "&#x27;": "'",
  "&lt;": "<",
  "&gt;": ">",
};

const HTML_ENTITY: RegExp = /&(?:amp|quot|#x27|lt|gt);/g;

const ANCHOR: RegExp = /<a href="([^"]*)"[^>]*>/g;

/*
 * A link the page holds: where it goes in the Dashboard, and its query. The
 * Dashboard's own address (DashboardClientUrl: its host is the server's) is
 * taken off and its route (/dashboard) put back, so its path reads as a
 * route of the Dashboard's RouteMap does, whatever host the server has.
 */
interface ExplorerLink {
  href: string;
  path: string;
  searchParams: URLSearchParams;
}

function explorerLinkOf(href: string): ExplorerLink {
  const base: string = DashboardClientUrl.toString();

  expect(href.startsWith(`${base}/`)).toBe(true);

  const parts: Array<string> = href.substring(base.length).split("?");

  return {
    href: href,
    path: `${DashboardRoute.toString()}${parts[0]}`,
    searchParams: new URLSearchParams(parts[1] || ""),
  };
}

// Every link the laid-out page holds, as the browser follows it.
function linksOnPage(html: string): Array<ExplorerLink> {
  return Array.from(html.matchAll(ANCHOR)).map(
    (match: RegExpMatchArray): ExplorerLink => {
      return explorerLinkOf(
        match[1]!.replace(HTML_ENTITY, (entity: string): string => {
          return HTML_ENTITIES[entity]!;
        }),
      );
    },
  );
}

// The links of a root cause as the evaluator wrote them, in its Markdown.
const MARKDOWN_LINK: RegExp =
  /\[Open (metric|logs|traces) in dashboard\]\(([^)\s]+)\)/g;

function linksWritten(rootCause: string): Array<ExplorerLink> {
  return Array.from(rootCause.matchAll(MARKDOWN_LINK)).map(
    (match: RegExpMatchArray): ExplorerLink => {
      return explorerLinkOf(match[2]!);
    },
  );
}

interface IncidentLinks {
  metric: ExplorerLink;
  logs: ExplorerLink;
  traces: ExplorerLink;
}

// The page's links, each the one to its explorer, by the Dashboard's route.
function explorerLinks(links: Array<ExplorerLink>): IncidentLinks {
  const routeOf: (pageMap: string) => string = (pageMap: string): string => {
    return Routes.default[pageMap]!.toString().replace(
      ":projectId",
      projectId.toString(),
    );
  };

  const find: (pageMap: string) => ExplorerLink = (
    pageMap: string,
  ): ExplorerLink => {
    const found: Array<ExplorerLink> = links.filter(
      (link: ExplorerLink): boolean => {
        return link.path === routeOf(pageMap);
      },
    );

    expect({ page: pageMap, links: found.length }).toEqual({
      page: pageMap,
      links: 1,
    });

    return found[0]!;
  };

  expect(links).toHaveLength(3);

  return {
    metric: find(Pages.default.METRIC_VIEW),
    logs: find(Pages.default.LOGS),
    traces: find(Pages.default.TRACES),
  };
}

// The metric explorer's own reading of a link (MetricExplorer.tsx).
function metricQueriesOf(link: ExplorerLink): Array<SerializedMetricQuery> {
  return MetricExplorerUrl.parseMetricQueriesParam(
    link.searchParams.get("metricQueries") || "",
  );
}

function metricFormulasOf(link: ExplorerLink): Array<SerializedMetricFormula> {
  return MetricExplorerUrl.parseMetricFormulasParam(
    link.searchParams.get("metricFormulas") || "",
  );
}

/*
 * The logs query the logs explorer runs for a link: its `filters` chips,
 * read as LogsViewer.readInitialUrlState reads them, compiled onto the
 * query by the explorer's own compile.
 */
function logsQueryOf(link: ExplorerLink): JSONObject {
  const facets: Map<string, Set<string>> = new Map();

  for (const [key, values] of JSON.parse(
    link.searchParams.get("filters") || "[]",
  ) as Array<[string, Array<string>]>) {
    facets.set(key, new Set(values));
  }

  return LogsPivot.applyLogsFacetFiltersToQuery(
    {},
    facets,
  ) as unknown as JSONObject;
}

// The attribute filters of a link's traces search, as the explorer parses it.
function tracesSearchOf(link: ExplorerLink): {
  freeText: string;
  attributes: Dictionary<string>;
} {
  const parsed: ReturnType<TracesSearchModule["parseTraceSearch"]> =
    TracesSearch.parseTraceSearch(link.searchParams.get("search") || "");
  const attributes: Dictionary<string> = {};

  for (const filter of parsed.attributeFilters) {
    attributes[filter.key] = String(
      (filter.predicate as { value?: unknown }).value,
    );
  }

  return { freeText: parsed.freeText, attributes: attributes };
}

// The rows a link's metric query charts: every one its filters select.
function rowsCharted(
  rows: Dictionary<Array<StoredMetricRow>>,
  query: SerializedMetricQuery,
): Array<StoredMetricRow> {
  return (rows[query.metricName] || []).filter((row: StoredMetricRow) => {
    return isSelected(row, query.attributes as Dictionary<unknown>);
  });
}

// Attribute filters as one text, whatever order they were written in.
function filtersText(attributes: Dictionary<unknown> | undefined): string {
  return JSON.stringify(
    Object.entries(attributes || {}).sort(
      (a: [string, unknown], b: [string, unknown]): number => {
        return a[0].localeCompare(b[0]);
      },
    ),
  );
}

// The read of a check that asked for exactly what a link's query asks for.
function readOf(
  incident: Incident,
  query: SerializedMetricQuery,
): Read | undefined {
  return incident.reads.find((candidate: Read): boolean => {
    return (
      candidate.query.name === query.metricName &&
      filtersText(candidate.query.attributes) ===
        filtersText(query.attributes as Dictionary<unknown>)
    );
  });
}

interface Laid {
  // The page's links, in English and in Persian.
  en: IncidentLinks;
  fa: IncidentLinks;
  written: IncidentLinks;
  rootCause: string;
  incident: Incident;
}

const scenarios: Dictionary<() => Promise<Incident>> = {};
const laid: Dictionary<Laid> = {};

beforeAll(async () => {
  const globals: Record<string, unknown> = globalThis as unknown as Record<
    string,
    unknown
  >;

  globals["window"] = {
    location: { pathname: "/", search: "", hash: "" },
    history: { state: null, replaceState: (): void => {} },
  };

  Prefill = await import(
    "../../../../FeatureSet/Dashboard/src/Utils/HostServiceMonitorPrefill"
  );
  Routes = await import("../../../../FeatureSet/Dashboard/src/Utils/RouteMap");
  Pages = await import("../../../../FeatureSet/Dashboard/src/Utils/PageMap");
  LogsPivot = await import(
    "../../../../FeatureSet/Dashboard/src/Utils/LogsCrossSignalPivot"
  );
  TracesSearch = await import(
    "../../../../FeatureSet/Dashboard/src/Components/Traces/TracesSearchCompile"
  );
  EvaluationText = await import(
    "../../../../FeatureSet/Dashboard/src/Utils/EvaluationText"
  );

  delete globals["window"];
}, 120000);

afterAll(() => {
  jest.restoreAllMocks();
});

/*
 * Each monitor's incident, laid out once for all of its tests: the worker
 * and the evaluator run per scenario, and every root cause is drawn in one
 * subprocess.
 */
async function layOut(names: Array<string>): Promise<void> {
  installStore();

  const incidents: Array<Incident> = [];

  for (const name of names) {
    incidents.push(await scenarios[name]!());
  }

  const worded: Array<string> = [];

  for (const incident of incidents) {
    for (const language of ["en", "fa"]) {
      worded.push(
        RecordRootCauseWording.wordRootCause({
          rootCause: incident.rootCause,
          translator: dashboardTranslator(language),
          options: EvaluationText.EVALUATION_TEXT_OPTIONS,
          setsValuesApart: true,
        }),
      );
    }
  }

  const html: Array<string> = renderWithReactMarkdown(worded);

  names.forEach((name: string, index: number) => {
    const incident: Incident = incidents[index]!;

    laid[name] = {
      en: explorerLinks(linksOnPage(html[index * 2]!)),
      fa: explorerLinks(linksOnPage(html[index * 2 + 1]!)),
      written: explorerLinks(linksWritten(incident.rootCause)),
      rootCause: incident.rootCause,
      incident: incident,
    };
  });
}

scenarios["Spooler on web-01"] = async (): Promise<Incident> => {
  return incidentOf({
    monitorType: MonitorType.Host,
    step: serviceMonitorStep(Prefill.HostServiceKind.WindowsService, "Spooler"),
    read: monitorHost,
    rows: {
      "windows.service.status": [
        // Stopped on web-01 for the whole hour: not running.
        ...samples(1, { "resource.host.name": HOST, name: "Spooler" }),
        // Running on web-02, and another service running on web-01.
        ...samples(4, { "resource.host.name": OTHER_HOST, name: "Spooler" }),
        ...samples(4, { "resource.host.name": HOST, name: "W3SVC" }),
      ],
    },
  });
};

scenarios["nginx.service on web-01"] = async (): Promise<Incident> => {
  const states: Array<string> = ["active", "inactive", "failed"];
  const rows: Array<StoredMetricRow> = [];

  for (const host of [HOST, OTHER_HOST]) {
    for (const state of states) {
      // Inactive on web-01, active on web-02.
      const isIn: boolean = state === (host === HOST ? "inactive" : "active");
      rows.push(
        ...samples(isIn ? 1 : 0, {
          "resource.host.name": host,
          "resource.systemd.unit.name": "nginx.service",
          "systemd.unit.active_state": state,
        }),
      );
    }
  }

  return incidentOf({
    monitorType: MonitorType.Host,
    step: serviceMonitorStep(
      Prefill.HostServiceKind.SystemdUnit,
      "nginx.service",
    ),
    read: monitorHost,
    rows: { "systemd.unit.state": rows },
  });
};

scenarios["High CPU on web-01"] = async (): Promise<Incident> => {
  return incidentOf({
    monitorType: MonitorType.Host,
    step: getHostAlertTemplateById("host-high-cpu")!.getMonitorStep(
      templateArgs(HOST),
    ),
    read: monitorHost,
    rows: {
      "system.cpu.utilization": [
        ...samples(0.5, { "resource.host.name": HOST, state: "user" }),
        ...samples(0.45, { "resource.host.name": HOST, state: "system" }),
        ...samples(0.05, { "resource.host.name": OTHER_HOST, state: "user" }),
        ...samples(0.05, { "resource.host.name": OTHER_HOST, state: "system" }),
      ],
    },
  });
};

scenarios["High CPU on every host, grouped by host"] =
  async (): Promise<Incident> => {
    return incidentOf({
      monitorType: MonitorType.Host,
      step: buildHostMonitorStep({
        hostMonitor: buildHostMonitorConfig({
          hostIdentifier: "",
          metricName: "system.cpu.utilization",
          metricAlias: "cpu_user",
          rollingTime: RollingTime.Past5Minutes,
          aggregationType: MetricsAggregationType.Avg,
          attributes: { state: "user" },
          groupByAttributeKeys: ["resource.host.name"],
        }),
        offlineCriteriaInstance: buildHostOfflineCriteriaInstance({
          offlineMonitorStatusId: OFFLINE_ID,
          incidentSeverityId: SEVERITY_ID,
          alertSeverityId: SEVERITY_ID,
          monitorName: "every host",
          metricAlias: "cpu_user",
          filterType: FilterType.GreaterThan,
          value: 0.8,
        }),
        onlineCriteriaInstance: buildHostOnlineCriteriaInstance({
          onlineMonitorStatusId: ONLINE_ID,
          metricAlias: "cpu_user",
          filterType: FilterType.LessThanOrEqualTo,
          value: 0.8,
        }),
      }),
      read: monitorHost,
      rows: {
        "system.cpu.utilization": [
          ...samples(0.1, { "resource.host.name": HOST, state: "user" }),
          ...samples(0.95, { "resource.host.name": OTHER_HOST, state: "user" }),
        ],
      },
    });
  };

// Two containers on the monitor's host, and a busy one on another host.
function containerRows(runtime: string): Dictionary<Array<StoredMetricRow>> {
  return {
    "container.cpu.utilization": [
      ...samples(95, {
        "resource.host.name": DOCKER_HOST,
        "resource.container.runtime": runtime,
        "resource.container.name": "web",
        "resource.container.id": "c0ffee",
      }),
      ...samples(5, {
        "resource.host.name": DOCKER_HOST,
        "resource.container.runtime": runtime,
        "resource.container.name": "db",
        "resource.container.id": "decaf",
      }),
      ...samples(97, {
        "resource.host.name": OTHER_DOCKER_HOST,
        "resource.container.runtime": runtime,
        "resource.container.name": "web",
        "resource.container.id": "beef",
      }),
    ],
  };
}

for (const runtime of ["docker", "podman"]) {
  const monitorType: MonitorType =
    runtime === "docker" ? MonitorType.Docker : MonitorType.Podman;
  const read: WorkerRead = runtime === "docker" ? monitorDocker : monitorPodman;
  const highCpu: () => MonitorStep = (): MonitorStep => {
    return runtime === "docker"
      ? getDockerAlertTemplateById("docker-high-cpu")!.getMonitorStep(
          templateArgs(DOCKER_HOST),
        )
      : getPodmanAlertTemplateById("podman-high-cpu")!.getMonitorStep(
          templateArgs(DOCKER_HOST),
        );
  };

  scenarios[`${runtime}: High CPU, one alert per container`] =
    async (): Promise<Incident> => {
      return incidentOf({
        monitorType: monitorType,
        step: highCpu(),
        read: read,
        rows: containerRows(runtime),
      });
    };

  scenarios[`${runtime}: High CPU of the container web`] =
    async (): Promise<Incident> => {
      return incidentOf({
        monitorType: monitorType,
        step: withContainerName(highCpu(), "web"),
        read: read,
        rows: containerRows(runtime),
      });
    };
}

describe("an incident's links open what its monitor read (#10451)", () => {
  beforeAll(async () => {
    await layOut(Object.keys(scenarios));
  }, 300000);

  test.each(Object.keys(scenarios))(
    "%s: the page draws the links the evaluator wrote, in English and in Persian",
    (name: string) => {
      const page: Laid = laid[name]!;

      for (const language of ["en", "fa"] as Array<"en" | "fa">) {
        expect({
          language: language,
          metric: page[language].metric.href,
          logs: page[language].logs.href,
          traces: page[language].traces.href,
        }).toEqual({
          language: language,
          metric: page.written.metric.href,
          logs: page.written.logs.href,
          traces: page.written.traces.href,
        });
      }
    },
  );

  test.each(Object.keys(scenarios))(
    "%s: Open metric charts exactly the rows the monitor read",
    (name: string) => {
      const page: Laid = laid[name]!;
      const queries: Array<SerializedMetricQuery> = metricQueriesOf(
        page.en.metric,
      );

      expect(queries.length).toBeGreaterThan(0);

      for (const query of queries) {
        // Each query of the link is one the worker read, filter for filter.
        const read: Read | undefined = readOf(page.incident, query);

        expect({ query: query.attributes, isRead: Boolean(read) }).toEqual({
          query: query.attributes,
          isRead: true,
        });

        const charted: Array<StoredMetricRow> = rowsCharted(
          page.incident.rows,
          query,
        );

        expect(charted.length).toBeGreaterThan(0);
        expect(charted).toEqual(
          (page.incident.rows[query.metricName] || []).filter(
            (row: StoredMetricRow) => {
              return isSelected(row, read!.query.attributes);
            },
          ),
        );
      }
    },
  );

  describe("a Windows service's monitor, made by Create Monitor: Spooler on web-01", () => {
    test("Open metric: Spooler on web-01, not on every host", () => {
      const page: Laid = laid["Spooler on web-01"]!;

      expect(metricQueriesOf(page.en.metric)).toEqual([
        {
          metricName: "windows.service.status",
          attributes: { name: "Spooler", "resource.host.name": HOST },
          aggregationType: MetricsAggregationType.Max,
        },
      ]);
      expect(page.en.metric.searchParams.get("startTime")).not.toBeNull();
      expect(page.en.metric.searchParams.get("endTime")).not.toBeNull();
    });

    test("Open logs: web-01's logs in the window, not logs whose own `name` is Spooler", () => {
      const page: Laid = laid["Spooler on web-01"]!;

      expect(logsQueryOf(page.en.logs)).toEqual({
        attributes: { "resource.host.name": HOST },
      });
      expect(page.en.logs.searchParams.get("range")).toBe("Custom");
    });

    test("Open traces: web-01's spans, not spans named Spooler", () => {
      const page: Laid = laid["Spooler on web-01"]!;

      expect(tracesSearchOf(page.en.traces)).toEqual({
        freeText: "",
        attributes: { "resource.host.name": HOST },
      });
      expect(page.en.traces.searchParams.get("filters")).toBeNull();
    });

    test("nothing is said to be left out", () => {
      expect(laid["Spooler on web-01"]!.rootCause).not.toContain(
        "scope partially carried",
      );
    });
  });

  describe("a systemd unit's monitor, made by Create Monitor: nginx.service on web-01", () => {
    test("Open metric: the unit on web-01", () => {
      expect(
        metricQueriesOf(laid["nginx.service on web-01"]!.en.metric)[0]!
          .attributes,
      ).toEqual({
        "resource.systemd.unit.name": "nginx.service",
        "systemd.unit.active_state": "active",
        "resource.host.name": HOST,
      });
    });

    test("Open logs: the unit's journal lines on web-01", () => {
      expect(logsQueryOf(laid["nginx.service on web-01"]!.en.logs)).toEqual({
        attributes: {
          "resource.host.name": HOST,
          "systemd.unit.name": "nginx.service",
        },
      });
    });

    test("Open traces: web-01's spans", () => {
      expect(
        tracesSearchOf(laid["nginx.service on web-01"]!.en.traces),
      ).toEqual({ freeText: "", attributes: { "resource.host.name": HOST } });
    });
  });

  describe("a Host monitor of one host, on a formula: High CPU on web-01", () => {
    test("Open metric: both queries the formula adds up, each on web-01", () => {
      const page: Laid = laid["High CPU on web-01"]!;

      expect(
        metricQueriesOf(page.en.metric).map((query: SerializedMetricQuery) => {
          return query.attributes;
        }),
      ).toEqual([
        { state: "user", "resource.host.name": HOST },
        { state: "system", "resource.host.name": HOST },
      ]);
      expect(
        metricFormulasOf(page.en.metric).map(
          (formula: SerializedMetricFormula) => {
            return formula.formula;
          },
        ),
      ).toEqual(["(host_cpu_user + host_cpu_system) * 100"]);
    });

    test("Open logs and Open traces: web-01's, with no CPU `state`", () => {
      const page: Laid = laid["High CPU on web-01"]!;

      expect(logsQueryOf(page.en.logs)).toEqual({
        attributes: { "resource.host.name": HOST },
      });
      expect(tracesSearchOf(page.en.traces)).toEqual({
        freeText: "",
        attributes: { "resource.host.name": HOST },
      });
    });
  });

  describe("a Host monitor of every host, grouped by host", () => {
    test("Open metric: the query as it read it, for every host", () => {
      expect(
        metricQueriesOf(
          laid["High CPU on every host, grouped by host"]!.en.metric,
        )[0]!.attributes,
      ).toEqual({ state: "user" });
    });

    test("Open logs and Open traces: the host whose CPU breached", () => {
      const page: Laid = laid["High CPU on every host, grouped by host"]!;

      expect(logsQueryOf(page.en.logs)).toEqual({
        attributes: { "resource.host.name": OTHER_HOST },
      });
      expect(tracesSearchOf(page.en.traces)).toEqual({
        freeText: "",
        attributes: { "resource.host.name": OTHER_HOST },
      });
    });
  });

  describe.each(["docker", "podman"])("a %s monitor", (runtime: string) => {
    const perContainer: string = `${runtime}: High CPU, one alert per container`;
    const ofWeb: string = `${runtime}: High CPU of the container web`;

    test("Open metric: the host's containers it read, and the one it names", () => {
      expect(
        metricQueriesOf(laid[perContainer]!.en.metric)[0]!.attributes,
      ).toEqual({
        "resource.host.name": DOCKER_HOST,
        "resource.container.runtime": runtime,
      });
      expect(metricQueriesOf(laid[ofWeb]!.en.metric)[0]!.attributes).toEqual({
        "resource.host.name": DOCKER_HOST,
        "resource.container.runtime": runtime,
        "resource.container.name": "web",
      });
    });

    test.each([
      ["one alert per container", perContainer],
      ["the container web", ofWeb],
    ])(
      "%s: Open logs reads the host's container logs, as the host's own Logs page does",
      (_label: string, name: string) => {
        expect(logsQueryOf(laid[name]!.en.logs)).toEqual({
          attributes: {
            "resource.host.name": DOCKER_HOST,
            "resource.container.runtime": runtime,
          },
        });
      },
    );

    test.each([
      ["one alert per container", perContainer],
      ["the container web", ofWeb],
    ])(
      "%s: Open traces reads the host's spans",
      (_label: string, name: string) => {
        expect(tracesSearchOf(laid[name]!.en.traces)).toEqual({
          freeText: "",
          attributes: { "resource.host.name": DOCKER_HOST },
        });
      },
    );

    test.each([
      ["one alert per container", perContainer],
      ["the container web", ofWeb],
    ])(
      "%s: both links say the container is not applied, as its logs carry its id alone",
      (_label: string, name: string) => {
        const hint: string =
          "_(scope partially carried — not applied: resource.container.name)_";
        const rootCause: string = laid[name]!.rootCause;

        expect(rootCause.split(hint).length - 1).toBe(2);
        expect(rootCause).toMatch(
          /\[Open logs in dashboard\]\([^)]+\) _\(scope partially carried — not applied: resource\.container\.name\)_/,
        );
        expect(rootCause).toMatch(
          /\[Open traces in dashboard\]\([^)]+\) _\(scope partially carried — not applied: resource\.container\.name\)_/,
        );
      },
    );
  });
});
