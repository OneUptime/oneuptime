import ObjectID from "Common/Types/ObjectID";
import IconProp from "Common/Types/Icon/IconProp";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import TechStack from "Common/Types/Service/TechStack";
import { ChartCardColor } from "./ChartCard";
import {
  fetchMetricSeries,
  formatBytes,
  formatCompact,
  formatDurationMs,
  formatPercent,
  TimePoint,
} from "./telemetryMetrics";

/*
 * Technology-specific "golden" runtime metrics for the Service overview
 * page. The RED signals (rate / errors / duration) come from spans and are
 * language-agnostic; the charts defined here cover the runtime underneath
 * (heap, GC, event loop, goroutines, ...) and are picked by the service's
 * detected technology.
 *
 * Detection is driven by the telemetry.sdk.language resource attribute
 * (stamped onto Service.telemetrySdkLanguage at ingest), with fallbacks to
 * process.runtime.name sniffing and the manually-set tech stack.
 */

// Canonical values of the telemetry.sdk.language resource attribute.
export type ServiceLanguage =
  | "java"
  | "dotnet"
  | "nodejs"
  | "python"
  | "go"
  | "ruby"
  | "php"
  | "rust"
  | "erlang"
  | "swift"
  | "cpp"
  | "webjs";

export const SERVICE_LANGUAGE_DISPLAY_NAMES: Record<ServiceLanguage, string> = {
  java: "Java",
  dotnet: ".NET",
  nodejs: "Node.js",
  python: "Python",
  go: "Go",
  ruby: "Ruby",
  php: "PHP",
  rust: "Rust",
  erlang: "Erlang / Elixir",
  swift: "Swift",
  cpp: "C++",
  webjs: "Browser JS",
};

const KNOWN_LANGUAGES: Array<ServiceLanguage> = Object.keys(
  SERVICE_LANGUAGE_DISPLAY_NAMES,
) as Array<ServiceLanguage>;

/*
 * process.runtime.name values seen in the wild → language. Checked as
 * case-insensitive substrings, so "OpenJDK Runtime Environment" → java.
 * Ordered: more specific markers first ("graalvm" before "go").
 */
const RUNTIME_NAME_MARKERS: Array<{ marker: string; lang: ServiceLanguage }> = [
  { marker: "openjdk", lang: "java" },
  { marker: "graalvm", lang: "java" },
  { marker: "java", lang: "java" },
  { marker: "dotnet", lang: "dotnet" },
  { marker: ".net", lang: "dotnet" },
  { marker: "node", lang: "nodejs" },
  { marker: "deno", lang: "nodejs" },
  { marker: "bun", lang: "nodejs" },
  { marker: "cpython", lang: "python" },
  { marker: "pypy", lang: "python" },
  { marker: "python", lang: "python" },
  { marker: "beam", lang: "erlang" },
  { marker: "erlang", lang: "erlang" },
  { marker: "ruby", lang: "ruby" },
  { marker: "php", lang: "php" },
  { marker: "rust", lang: "rust" },
  { marker: "swift", lang: "swift" },
  { marker: "go", lang: "go" },
];

// Manual tech-stack selections → language (JVM languages map to java).
const TECH_STACK_LANGUAGES: Partial<Record<TechStack, ServiceLanguage>> = {
  [TechStack.Java]: "java",
  [TechStack.Kotlin]: "java",
  [TechStack.CSharp]: "dotnet",
  [TechStack.NodeJS]: "nodejs",
  [TechStack.TypeScript]: "nodejs",
  [TechStack.JavaScript]: "nodejs",
  [TechStack.React]: "webjs",
  [TechStack.Python]: "python",
  [TechStack.Go]: "go",
  [TechStack.Ruby]: "ruby",
  [TechStack.PHP]: "php",
  [TechStack.Rust]: "rust",
  [TechStack.Swift]: "swift",
  [TechStack.CPlusPlus]: "cpp",
};

export const detectServiceLanguage: (data: {
  telemetrySdkLanguage?: string | undefined;
  runtimeName?: string | undefined;
  techStack?: Array<TechStack> | undefined;
}) => ServiceLanguage | null = (data: {
  telemetrySdkLanguage?: string | undefined;
  runtimeName?: string | undefined;
  techStack?: Array<TechStack> | undefined;
}): ServiceLanguage | null => {
  const sdkLanguage: string = (data.telemetrySdkLanguage || "")
    .trim()
    .toLowerCase();
  if (sdkLanguage && KNOWN_LANGUAGES.includes(sdkLanguage as ServiceLanguage)) {
    return sdkLanguage as ServiceLanguage;
  }

  const runtimeName: string = (data.runtimeName || "").trim().toLowerCase();
  if (runtimeName) {
    for (const entry of RUNTIME_NAME_MARKERS) {
      if (runtimeName.includes(entry.marker)) {
        return entry.lang;
      }
    }
  }

  for (const stack of data.techStack || []) {
    const lang: ServiceLanguage | undefined = TECH_STACK_LANGUAGES[stack];
    if (lang) {
      return lang;
    }
  }

  return null;
};

export type RuntimeMetricUnit = "percent" | "bytes" | "count" | "milliseconds";

export const formatRuntimeValue: (
  value: number | null,
  unit: RuntimeMetricUnit,
) => string = (value: number | null, unit: RuntimeMetricUnit): string => {
  switch (unit) {
    case "percent":
      return formatPercent(value);
    case "bytes":
      return formatBytes(value);
    case "milliseconds":
      return formatDurationMs(value);
    default:
      return formatCompact(value);
  }
};

/*
 * One candidate metric name for a chart. Candidates are probed in order
 * and the first that returns data wins — stable semconv names first,
 * legacy (pre-stabilization) names after, so both old and new SDK
 * versions light up the same chart.
 */
export interface RuntimeMetricCandidate {
  metricName: string;
  // Datapoint attribute filters, e.g. { "jvm.memory.type": "heap" }.
  attributes?: Record<string, string> | undefined;
  // Multiplier applied to raw values, e.g. 100 for 0-1 utilization ratios.
  scale?: number | undefined;
}

export interface RuntimeChartDef {
  key: string;
  title: string;
  icon: IconProp;
  iconColor: ChartCardColor;
  aggregationType: AggregationType;
  unit: RuntimeMetricUnit;
  sublabel: string;
  candidates: Array<RuntimeMetricCandidate>;
}

const ratio: (metricName: string) => RuntimeMetricCandidate = (
  metricName: string,
): RuntimeMetricCandidate => {
  return { metricName: metricName, scale: 100 };
};

const RUNTIME_CHARTS_BY_LANGUAGE: Partial<
  Record<ServiceLanguage, Array<RuntimeChartDef>>
> = {
  java: [
    {
      key: "jvm-cpu",
      title: "JVM CPU",
      icon: IconProp.CPUChip,
      iconColor: "blue",
      aggregationType: AggregationType.Avg,
      unit: "percent",
      sublabel: "recent utilization",
      candidates: [
        ratio("jvm.cpu.recent_utilization"),
        ratio("process.runtime.jvm.cpu.utilization"),
      ],
    },
    {
      key: "jvm-heap",
      title: "JVM heap used",
      icon: IconProp.SquareStack,
      iconColor: "violet",
      aggregationType: AggregationType.Avg,
      unit: "bytes",
      sublabel: "avg across heap pools",
      candidates: [
        {
          metricName: "jvm.memory.used",
          attributes: { "jvm.memory.type": "heap" },
        },
        {
          metricName: "process.runtime.jvm.memory.usage",
          attributes: { type: "heap" },
        },
      ],
    },
    {
      key: "jvm-threads",
      title: "JVM threads",
      icon: IconProp.Layers,
      iconColor: "amber",
      aggregationType: AggregationType.Avg,
      unit: "count",
      sublabel: "live threads",
      candidates: [
        { metricName: "jvm.thread.count" },
        { metricName: "process.runtime.jvm.threads.count" },
      ],
    },
  ],
  dotnet: [
    {
      key: "dotnet-memory",
      title: "Working set",
      icon: IconProp.SquareStack,
      iconColor: "violet",
      aggregationType: AggregationType.Avg,
      unit: "bytes",
      sublabel: "process memory",
      candidates: [
        { metricName: "dotnet.process.memory.working_set" },
        { metricName: "process.memory.usage" },
      ],
    },
    {
      key: "dotnet-gc-heap",
      title: "GC heap size",
      icon: IconProp.Cube,
      iconColor: "blue",
      aggregationType: AggregationType.Avg,
      unit: "bytes",
      sublabel: "avg across generations",
      candidates: [
        { metricName: "dotnet.gc.last_collection.heap.size" },
        { metricName: "process.runtime.dotnet.gc.heap.size" },
      ],
    },
    {
      key: "dotnet-threadpool",
      title: "Thread pool threads",
      icon: IconProp.Layers,
      iconColor: "amber",
      aggregationType: AggregationType.Avg,
      unit: "count",
      sublabel: "pool size",
      candidates: [
        { metricName: "dotnet.thread_pool.thread.count" },
        { metricName: "process.runtime.dotnet.thread_pool.threads.count" },
      ],
    },
    {
      key: "dotnet-exceptions",
      title: "Exceptions",
      icon: IconProp.Alert,
      iconColor: "rose",
      aggregationType: AggregationType.Sum,
      unit: "count",
      sublabel: "thrown, selected range",
      candidates: [
        { metricName: "dotnet.exceptions" },
        { metricName: "process.runtime.dotnet.exceptions.count" },
      ],
    },
  ],
  nodejs: [
    {
      key: "node-eventloop-util",
      title: "Event loop utilization",
      icon: IconProp.Bolt,
      iconColor: "blue",
      aggregationType: AggregationType.Avg,
      unit: "percent",
      sublabel: "busy share of loop time",
      candidates: [ratio("nodejs.eventloop.utilization")],
    },
    {
      key: "node-eventloop-delay",
      title: "Event loop delay (p99)",
      icon: IconProp.Clock,
      iconColor: "amber",
      aggregationType: AggregationType.Avg,
      unit: "milliseconds",
      sublabel: "scheduling lag",
      candidates: [{ metricName: "nodejs.eventloop.delay.p99", scale: 1000 }],
    },
    {
      key: "node-heap",
      title: "Heap used",
      icon: IconProp.SquareStack,
      iconColor: "violet",
      aggregationType: AggregationType.Avg,
      unit: "bytes",
      sublabel: "avg across V8 heap spaces",
      candidates: [
        { metricName: "v8js.memory.heap.used" },
        { metricName: "process.memory.usage" },
      ],
    },
  ],
  python: [
    {
      key: "python-memory",
      title: "Memory (RSS)",
      icon: IconProp.SquareStack,
      iconColor: "violet",
      aggregationType: AggregationType.Avg,
      unit: "bytes",
      sublabel: "resident set size",
      candidates: [
        {
          metricName: "process.runtime.cpython.memory",
          attributes: { type: "rss" },
        },
        { metricName: "process.memory.usage" },
      ],
    },
    {
      key: "python-gc",
      title: "GC collections",
      icon: IconProp.Cube,
      iconColor: "amber",
      aggregationType: AggregationType.Sum,
      unit: "count",
      sublabel: "collections, selected range",
      candidates: [{ metricName: "process.runtime.cpython.gc_count" }],
    },
  ],
  go: [
    {
      key: "go-goroutines",
      title: "Goroutines",
      icon: IconProp.Bolt,
      iconColor: "blue",
      aggregationType: AggregationType.Avg,
      unit: "count",
      sublabel: "live goroutines",
      candidates: [
        { metricName: "go.goroutine.count" },
        { metricName: "process.runtime.go.goroutines" },
      ],
    },
    {
      key: "go-heap",
      title: "Heap memory",
      icon: IconProp.SquareStack,
      iconColor: "violet",
      aggregationType: AggregationType.Avg,
      unit: "bytes",
      sublabel: "allocated heap",
      candidates: [
        { metricName: "go.memory.used" },
        { metricName: "process.runtime.go.mem.heap_alloc" },
      ],
    },
    {
      key: "go-gc",
      title: "GC cycles",
      icon: IconProp.Cube,
      iconColor: "amber",
      aggregationType: AggregationType.Sum,
      unit: "count",
      sublabel: "completed, selected range",
      candidates: [{ metricName: "process.runtime.go.gc.count" }],
    },
  ],
};

/*
 * Language-independent process metrics (emitted by the host-metrics /
 * system-metrics instrumentations). Appended after the language-specific
 * charts and also used alone when the technology is unknown.
 */
const GENERIC_RUNTIME_CHARTS: Array<RuntimeChartDef> = [
  {
    key: "process-cpu",
    title: "Process CPU",
    icon: IconProp.CPUChip,
    iconColor: "blue",
    aggregationType: AggregationType.Avg,
    unit: "percent",
    sublabel: "process utilization",
    candidates: [
      ratio("process.cpu.utilization"),
      ratio("process.runtime.cpu.utilization"),
    ],
  },
  {
    key: "process-memory",
    title: "Process memory",
    icon: IconProp.SquareStack,
    iconColor: "violet",
    aggregationType: AggregationType.Avg,
    unit: "bytes",
    sublabel: "resident memory",
    candidates: [
      { metricName: "process.memory.usage" },
      { metricName: "process.runtime.memory.usage" },
    ],
  },
];

const MAX_RUNTIME_CHARTS: number = 4;

export const getRuntimeChartDefs: (
  language: ServiceLanguage | null,
) => Array<RuntimeChartDef> = (
  language: ServiceLanguage | null,
): Array<RuntimeChartDef> => {
  const languageCharts: Array<RuntimeChartDef> = language
    ? RUNTIME_CHARTS_BY_LANGUAGE[language] || []
    : [];
  const languageKeys: Set<string> = new Set(
    languageCharts.map((def: RuntimeChartDef): string => {
      return def.key;
    }),
  );
  return [
    ...languageCharts,
    ...GENERIC_RUNTIME_CHARTS.filter((def: RuntimeChartDef): boolean => {
      return !languageKeys.has(def.key);
    }),
  ];
};

export interface ProbedRuntimeChart {
  def: RuntimeChartDef;
  series: Array<TimePoint>;
}

/*
 * Probe each chart's candidate metric names (in order) against what the
 * service actually emitted in the window; the first candidate with data
 * wins. Charts whose candidates are all empty are dropped, so SDK-version
 * drift and partial instrumentation degrade to fewer charts instead of
 * empty ones.
 */
export const probeRuntimeCharts: (data: {
  language: ServiceLanguage | null;
  primaryEntityId: ObjectID;
  start: Date;
  end: Date;
}) => Promise<Array<ProbedRuntimeChart>> = async (data: {
  language: ServiceLanguage | null;
  primaryEntityId: ObjectID;
  start: Date;
  end: Date;
}): Promise<Array<ProbedRuntimeChart>> => {
  const defs: Array<RuntimeChartDef> = getRuntimeChartDefs(data.language);

  const probed: Array<ProbedRuntimeChart | null> = await Promise.all(
    defs.map(
      async (def: RuntimeChartDef): Promise<ProbedRuntimeChart | null> => {
        for (const candidate of def.candidates) {
          // eslint-disable-next-line no-await-in-loop
          const series: Array<TimePoint> = await fetchMetricSeries(
            {
              name: candidate.metricName,
              attributes: candidate.attributes,
              primaryEntityId: data.primaryEntityId,
              aggregationType: def.aggregationType,
              start: data.start,
              end: data.end,
            },
            candidate.scale ?? 1,
          );
          if (series.length > 0) {
            return { def: def, series: series };
          }
        }
        return null;
      },
    ),
  );

  return probed
    .filter((chart: ProbedRuntimeChart | null): chart is ProbedRuntimeChart => {
      return chart !== null;
    })
    .slice(0, MAX_RUNTIME_CHARTS);
};
