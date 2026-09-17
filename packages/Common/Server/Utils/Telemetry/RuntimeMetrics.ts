import { monitorEventLoopDelay, IntervalHistogram } from "perf_hooks";
import type { Attributes, ObservableResult } from "@opentelemetry/api";
import Telemetry from "../Telemetry";
import logger from "../Logger";

/**
 * Process-level runtime metrics (memory, CPU, event-loop lag).
 *
 * Implemented as observable gauges so they're sampled at export time rather
 * than continuously. Registered once per process from `Telemetry.init()`.
 *
 * Metric names follow the OpenTelemetry semantic conventions for Node.js
 * process and runtime metrics where they exist.
 */
export default class RuntimeMetrics {
  private static initialized: boolean = false;

  private static lastCpuUsage: NodeJS.CpuUsage | null = null;
  private static lastCpuSampleTimestampNs: bigint | null = null;

  private static eventLoopHistogram: IntervalHistogram | null = null;

  public static init(): void {
    if (this.initialized) {
      return;
    }

    if (!Telemetry.isMetricsEnabled()) {
      return;
    }

    try {
      this.startEventLoopMonitor();

      Telemetry.getObservableGauge({
        name: "process.runtime.nodejs.memory.heap.used",
        description: "V8 heap memory currently in use.",
        unit: "By",
        callback: (result: ObservableResult<Attributes>) => {
          result.observe(process.memoryUsage().heapUsed);
        },
      });

      Telemetry.getObservableGauge({
        name: "process.runtime.nodejs.memory.heap.total",
        description: "Total size of allocated V8 heap.",
        unit: "By",
        callback: (result: ObservableResult<Attributes>) => {
          result.observe(process.memoryUsage().heapTotal);
        },
      });

      Telemetry.getObservableGauge({
        name: "process.runtime.nodejs.memory.rss",
        description:
          "Resident set size — total memory allocated to the Node.js process.",
        unit: "By",
        callback: (result: ObservableResult<Attributes>) => {
          result.observe(process.memoryUsage().rss);
        },
      });

      Telemetry.getObservableGauge({
        name: "process.runtime.nodejs.memory.external",
        description:
          "Memory used by C++ objects bound to JavaScript objects managed by V8.",
        unit: "By",
        callback: (result: ObservableResult<Attributes>) => {
          result.observe(process.memoryUsage().external);
        },
      });

      Telemetry.getObservableGauge({
        name: "process.runtime.nodejs.cpu.utilization",
        description:
          "Fraction of a single CPU core used by this Node.js process since the last sample (0-1, may exceed 1 on multi-core).",
        unit: "1",
        callback: (result: ObservableResult<Attributes>) => {
          const utilization: number = this.sampleCpuUtilization();
          if (Number.isFinite(utilization)) {
            result.observe(utilization);
          }
        },
      });

      Telemetry.getObservableGauge({
        name: "process.runtime.nodejs.eventloop.lag",
        description:
          "Event loop scheduling delay (mean and p99 over the sampling interval).",
        unit: "ms",
        callback: (result: ObservableResult<Attributes>) => {
          if (!this.eventLoopHistogram) {
            return;
          }

          const meanMs: number = this.eventLoopHistogram.mean / 1e6;
          const p99Ms: number = this.eventLoopHistogram.percentile(99) / 1e6;
          const maxMs: number = this.eventLoopHistogram.max / 1e6;

          if (Number.isFinite(meanMs)) {
            result.observe(meanMs, { quantile: "mean" });
          }
          if (Number.isFinite(p99Ms)) {
            result.observe(p99Ms, { quantile: "p99" });
          }
          if (Number.isFinite(maxMs)) {
            result.observe(maxMs, { quantile: "max" });
          }

          this.eventLoopHistogram.reset();
        },
      });

      Telemetry.getObservableGauge({
        name: "process.runtime.nodejs.uptime",
        description: "Time elapsed since the Node.js process started.",
        unit: "s",
        callback: (result: ObservableResult<Attributes>) => {
          result.observe(process.uptime());
        },
      });

      this.initialized = true;
    } catch (err) {
      logger.error("Failed to initialize Node.js runtime metrics");
      logger.error(err);
    }
  }

  private static startEventLoopMonitor(): void {
    if (this.eventLoopHistogram) {
      return;
    }

    /*
     * Resolution in milliseconds (the API expects nanoseconds via internal
     * resolution, but `monitorEventLoopDelay` accepts a millisecond value).
     */
    this.eventLoopHistogram = monitorEventLoopDelay({ resolution: 20 });
    this.eventLoopHistogram.enable();
  }

  private static sampleCpuUtilization(): number {
    const nowNs: bigint = process.hrtime.bigint();
    const usage: NodeJS.CpuUsage = process.cpuUsage();

    if (!this.lastCpuUsage || !this.lastCpuSampleTimestampNs) {
      this.lastCpuUsage = usage;
      this.lastCpuSampleTimestampNs = nowNs;
      return 0;
    }

    const elapsedNs: bigint = nowNs - this.lastCpuSampleTimestampNs;
    const elapsedMicros: number = Number(elapsedNs / BigInt(1000));

    if (elapsedMicros <= 0) {
      return 0;
    }

    const userDelta: number = usage.user - this.lastCpuUsage.user;
    const systemDelta: number = usage.system - this.lastCpuUsage.system;
    const utilization: number = (userDelta + systemDelta) / elapsedMicros;

    this.lastCpuUsage = usage;
    this.lastCpuSampleTimestampNs = nowNs;

    return utilization;
  }
}
