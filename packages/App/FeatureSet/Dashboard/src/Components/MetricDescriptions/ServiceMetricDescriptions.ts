/*
 * What each number on the Service overview means, in plain words. Shown in
 * the (i) tooltip beside a tile or chart title.
 *
 * Each text describes what the page actually computes, not what the title
 * suggests:
 *   - "Requests" counts every span of the service (server, client and
 *     internal), not only incoming requests;
 *   - "Latency (p95)" on the tile is the average of the per-interval p95s
 *     (fetchSpanMetrics' meanY), not one p95 over the whole range;
 *   - the runtime charts average every series of a metric in each interval,
 *     so a metric split by pool, generation or mode reads as a per-series
 *     average, and the counter charts follow the highest running counter
 *     rather than the sum across instances.
 * Change the fetch, change the words.
 */

export type ServiceMetric =
  | "requests"
  | "errorRate"
  | "latencyP95"
  | "technology"
  | "requestsChart"
  | "latencyP95Chart"
  | "logsChart"
  | "exceptionsChart";

export const SERVICE_METRIC_DESCRIPTIONS: Record<ServiceMetric, string> = {
  requests:
    "Every span this service reported in the selected range. A span is one timed operation - an incoming request, a database query or an outgoing call - and one request often produces several, so this is usually higher than the request count.",
  errorRate:
    "The share of this service's spans in the selected range whose status was set to Error by your instrumentation. The bar turns amber at 1% and red at 5%.",
  latencyP95:
    "p95 means the 95th percentile: 95% of this service's spans finished faster than this and the slowest 5% took longer. Worked out for each interval on the chart, then averaged over the selected range, so quiet and busy intervals count equally.",
  technology:
    "The language this service runs on, from the telemetry.sdk.language attribute your OpenTelemetry SDK sends, else the runtime name or the tech stack you set. Shown here because no runtime metrics (CPU, memory, heap) arrived in the selected range.",
  requestsChart:
    "Spans this service reported in each interval, with the ones whose status was Error as a second line. Every operation counts - incoming requests, database queries and outgoing calls.",
  latencyP95Chart:
    "The 95th percentile span duration in each interval: 95% of this service's spans in that interval finished faster than the line. A rise means the slowest operations are getting slower.",
  logsChart:
    "Log records this service sent in each interval, of every severity, with the Error and Fatal ones as a second line.",
  exceptionsChart:
    "Exceptions this service recorded in each interval. Unhandled ones were marked as escaping the operation (span) that raised them; handled ones are the rest - usually caught by your code, or not marked either way by your SDK.",
};

/*
 * One text per runtime chart in serviceGoldenMetrics.ts (RuntimeChartDef
 * .description). The same text sits beside the chart and, when that chart is
 * the first with data, beside the Service overview's fourth tile - which
 * averages a level over the range and totals a counter over it - so each
 * text says what the tile shows too.
 */
export type ServiceRuntimeMetric =
  | "jvmCpu"
  | "jvmHeap"
  | "jvmThreads"
  | "dotnetWorkingSet"
  | "dotnetGcHeap"
  | "dotnetThreadPool"
  | "dotnetExceptions"
  | "nodeEventLoopUtilization"
  | "nodeEventLoopDelay"
  | "nodeHeap"
  | "pythonMemory"
  | "pythonGc"
  | "goGoroutines"
  | "goMemory"
  | "goGc"
  | "processCpu"
  | "processMemory";

export const SERVICE_RUNTIME_METRIC_DESCRIPTIONS: Record<
  ServiceRuntimeMetric,
  string
> = {
  jvmCpu:
    "How much of the machine's CPU the Java process used, as the JVM reports it - 100% means every core was busy with this process. Averaged across instances in each interval; as a tile it shows the average over the selected range.",
  jvmHeap:
    "Memory in use on the Java heap, where your objects live. The JVM reports it per memory pool (such as Eden or Old Gen) and this is the average per pool and instance, not the total heap; as a tile it shows the average over the selected range.",
  jvmThreads:
    "Threads running in the Java virtual machine. SDKs split the count by thread state or daemon flag, and this is the average of those series rather than their total, so read it as a trend; as a tile it shows the average over the selected range.",
  dotnetWorkingSet:
    "Physical memory (RAM) the .NET process occupies, called its working set. Averaged across instances in each interval; as a tile it shows the average over the selected range.",
  dotnetGcHeap:
    "Size of the .NET garbage-collected heap at the last collection. It is reported per generation (gen0, gen1, gen2, large and pinned objects) and this is the average per generation, not the total; as a tile it shows the average over the selected range.",
  dotnetThreadPool:
    "Threads in the .NET thread pool, which runs async and request work; a count that keeps climbing often means work is blocking threads. Averaged across instances; as a tile it shows the average over the selected range.",
  dotnetExceptions:
    "Exceptions thrown in .NET code in each interval, including ones your code caught. Worked out from the highest running counter among instances and exception types, so it is approximate; as a tile it shows the total for the selected range.",
  nodeEventLoopUtilization:
    "How much of the time the Node.js event loop was busy running code rather than waiting - near 100% the process is saturated and new requests queue. Averaged across instances; as a tile it shows the average over the selected range.",
  nodeEventLoopDelay:
    "How late the Node.js event loop ran scheduled work; p99 means the 99th percentile: 99% of delays were shorter than this. Your SDK reports it per collection interval and those values are averaged across instances; as a tile it shows the average over the selected range.",
  nodeHeap:
    "Memory used by the V8 JavaScript heap, as the average per heap space (such as new and old space) and instance - not the total heap - or process physical memory when V8 heap metrics are missing. As a tile it shows the average over the selected range.",
  pythonMemory:
    "Resident set size (RSS): the physical memory (RAM) the Python process occupies. Averaged across instances in each interval; as a tile it shows the average over the selected range.",
  pythonGc:
    "How many times Python's garbage collector ran in each interval. Worked out from the highest running counter among generations and instances, so it is approximate; as a tile it shows the total for the selected range.",
  goGoroutines:
    "Goroutines (lightweight Go threads) alive in the process; a count that keeps climbing and never drops usually points to a leak. Averaged across instances; as a tile it shows the average over the selected range.",
  goMemory:
    "Memory the Go runtime is using apart from goroutine stacks - mostly the heap - or allocated heap bytes on older SDKs. Averaged across instances; as a tile it shows the average over the selected range.",
  goGc: "Completed Go garbage-collection cycles in each interval. Worked out from the highest running counter when several instances report, so it is approximate; as a tile it shows the total for the selected range.",
  processCpu:
    "Share of its available CPU the process used (100% means all of its CPUs were busy); if your SDK splits CPU time by mode (user, system) this averages those values rather than adding them, so it reads lower than total use. As a tile it shows the average over the selected range.",
  processMemory:
    "Physical memory (RAM) the process occupies, also called resident memory. Averaged across instances in each interval; as a tile it shows the average over the selected range.",
};

/*
 * The aggregate flame graph on a Service's Profiles tab (Pages/Service/View/
 * Profiles.tsx, "Where the time is going"). The server sums every stored
 * sample value per stack for this service in the tab's own window - the
 * 15m / 1h / 24h / 7d chips, not a page-wide time range - filtered to the
 * picked type's raw types (ProfileUtil.getQueryProfileTypes). "Everything"
 * sends no type, so every type is summed together, whatever its unit.
 * The tree is drawn root first, so the functions a frame calls sit below it.
 */
export type ServiceProfileMetric = "flamegraph";

export const SERVICE_PROFILE_METRIC_DESCRIPTIONS: Record<
  ServiceProfileMetric,
  string
> = {
  flamegraph:
    "Each bar is a function, and its width is its share of everything profiled for this service in the time window picked beside it - CPU time by default, bytes for Memory, lock contention for Locks, and every type added together for Everything. The functions a bar calls sit below it.",
};
