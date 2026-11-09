import {
  LlmMetricUsageFigures,
  emptyLlmMetricUsageFigures,
} from "../../Types/Telemetry/LlmMetricUsageApi";
import {
  LlmUsageDimension,
  LlmUsageFigures,
  LlmUsageGroup,
  LlmUsageResponse,
  LlmUsageService,
  LlmUsageSource,
  emptyLlmUsageFigures,
} from "../../Types/Telemetry/LlmUsageApi";
import LlmMetricUsageUtil, { LlmMetricUsageRow } from "./LlmMetricUsage";

/*
 * WHAT A RANGE'S AI USAGE ADDS UP TO: THE AI CALLS AND THE USAGE METRICS,
 * EACH SERVICE COUNTED FROM ONE OF THEM.
 *
 * Two signals carry AI usage, and many emitters send both for the same
 * calls:
 *
 *   - AI calls (GenAI spans): one row per call, with its tokens and cost.
 *     The apps' instrumentations send them.
 *   - Usage metrics (GenAI metrics): counters of tokens and cost. The coding
 *     assistants (Claude Code, Codex, Gemini CLI, Cursor's export) send only
 *     these; OpenLLMetry and the OpenTelemetry SDKs send them BESIDE their
 *     spans, for the same calls.
 *
 * Adding the two up would count every call of a both-signals app twice.
 * Reading metrics only when the spans added up to nothing - the rule this
 * replaces - dropped every metrics-only tool from the totals as soon as one
 * app sent a span. So each SERVICE is counted from the signal it sends:
 *
 *   - its tokens from its AI calls when they report tokens, and from its
 *     usage metrics when they do not;
 *   - its cost the same way, on its own: calls with tokens and no price
 *     leave the cost to a cost metric when there is one.
 *
 * A service is the OneUptime service the telemetry's resource named
 * (service.name): every tool and app is one, so Claude Code's metrics and
 * an app's calls are each counted, and an app's OpenLLMetry metrics are
 * not added to its own calls. Telemetry that names no service is filed
 * under the project's "Unknown Service" (its id is the project's) and is
 * one service like any other: its calls when it sends any, else its
 * metrics.
 *
 * The figures of each group (a person, a team, a model, a provider) are
 * then added up from its services, each from that service's signal, so
 * every breakdown adds up to the same totals. Calls are always the AI
 * calls': a metric counts no calls. Each figure says where it came from
 * (LlmUsageSource): calls, metrics, both (some services' calls and other
 * services' metrics) or none.
 *
 * Isomorphic, so the server (LlmUsageReader) and the tests share it.
 */

// One row of the AI calls read: a service's total, or one of its groups.
export interface LlmUsageSpanRow {
  // The service (primaryEntityId).
  service: string;
  // true on the service's total row; false on a group's.
  isTotal: boolean;
  // The group's value; "" when the calls named none, or on a total row.
  group: string;
  calls: number;
  erroredCalls: number;
  // Each model call once (LlmCallCounting): wrappers' repeats left out.
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
}

export enum LlmUsageSignal {
  None = "none",
  Calls = "calls",
  Metrics = "metrics",
}

// Which signal one service's tokens and cost are counted from.
export interface LlmUsageServiceSignals {
  tokens: LlmUsageSignal;
  cost: LlmUsageSignal;
}

export interface LlmUsageFoldOptions {
  dimension: LlmUsageDimension;
  truncated?: boolean | undefined;
  metricsLeftOut?: boolean | undefined;
  /*
   * The name a metric group's row is filed under; the row's group value
   * when not given. The place to name people at read time - a Cursor
   * team's member ids (groupAttribute cursor.user.id) by their emails.
   */
  nameMetricGroup?: ((row: LlmMetricUsageRow) => string) | undefined;
}

interface Accumulator {
  figures: LlmUsageFigures;
  tokensFromCalls: boolean;
  tokensFromMetrics: boolean;
  costFromCalls: boolean;
  costFromMetrics: boolean;
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function emptyAccumulator(): Accumulator {
  return {
    figures: emptyLlmUsageFigures(),
    tokensFromCalls: false,
    tokensFromMetrics: false,
    costFromCalls: false,
    costFromMetrics: false,
  };
}

function toSource(fromCalls: boolean, fromMetrics: boolean): LlmUsageSource {
  if (fromCalls && fromMetrics) {
    return LlmUsageSource.Both;
  }

  if (fromCalls) {
    return LlmUsageSource.Calls;
  }

  if (fromMetrics) {
    return LlmUsageSource.Metrics;
  }

  return LlmUsageSource.None;
}

function finish(accumulator: Accumulator): LlmUsageFigures {
  return {
    ...accumulator.figures,
    tokenSource: toSource(
      accumulator.tokensFromCalls,
      accumulator.tokensFromMetrics,
    ),
    costSource: toSource(
      accumulator.costFromCalls,
      accumulator.costFromMetrics,
    ),
  };
}

function spanTokens(row: LlmUsageSpanRow): number {
  return (
    finite(row.inputTokens) + finite(row.outputTokens) + finite(row.totalTokens)
  );
}

export default class LlmUsageUtil {
  /*
   * Which signal a service's tokens and its cost are counted from: its AI
   * calls when they report the figure, else its usage metrics when they
   * do, else none.
   */
  public static getServiceSignals(data: {
    calls: LlmUsageSpanRow | undefined;
    metrics: LlmMetricUsageFigures | undefined;
  }): LlmUsageServiceSignals {
    const metrics: LlmMetricUsageFigures =
      data.metrics || emptyLlmMetricUsageFigures();
    const metricTokens: number =
      finite(metrics.inputTokens) + finite(metrics.outputTokens);

    return {
      tokens:
        data.calls && spanTokens(data.calls) > 0
          ? LlmUsageSignal.Calls
          : metrics.hasTokens && metricTokens > 0
            ? LlmUsageSignal.Metrics
            : LlmUsageSignal.None,
      cost:
        data.calls && finite(data.calls.costUsd) > 0
          ? LlmUsageSignal.Calls
          : metrics.hasCost && finite(metrics.costUsd) > 0
            ? LlmUsageSignal.Metrics
            : LlmUsageSignal.None,
    };
  }

  // Add one AI calls row to a figure, its tokens and cost as the service's signals say.
  private static addSpanRow(
    accumulator: Accumulator,
    row: LlmUsageSpanRow,
    signals: LlmUsageServiceSignals,
  ): void {
    const figures: LlmUsageFigures = accumulator.figures;

    figures.calls += Math.max(0, finite(row.calls));
    figures.erroredCalls += Math.max(0, finite(row.erroredCalls));

    if (signals.tokens === LlmUsageSignal.Calls) {
      figures.inputTokens += Math.max(0, finite(row.inputTokens));
      figures.outputTokens += Math.max(0, finite(row.outputTokens));
      figures.totalTokens += Math.max(
        0,
        finite(row.totalTokens) ||
          finite(row.inputTokens) + finite(row.outputTokens),
      );

      if (spanTokens(row) > 0) {
        accumulator.tokensFromCalls = true;
      }
    }

    if (signals.cost === LlmUsageSignal.Calls) {
      figures.costUsd += Math.max(0, finite(row.costUsd));

      if (finite(row.costUsd) > 0) {
        accumulator.costFromCalls = true;
      }
    }
  }

  // Add one service's or group's metric figures, as the service's signals say.
  private static addMetricFigures(
    accumulator: Accumulator,
    metrics: LlmMetricUsageFigures,
    signals: LlmUsageServiceSignals,
  ): void {
    const figures: LlmUsageFigures = accumulator.figures;

    if (signals.tokens === LlmUsageSignal.Metrics && metrics.hasTokens) {
      const input: number = Math.max(0, finite(metrics.inputTokens));
      const output: number = Math.max(0, finite(metrics.outputTokens));

      figures.inputTokens += input;
      figures.outputTokens += output;
      figures.totalTokens += input + output;

      if (input + output > 0) {
        accumulator.tokensFromMetrics = true;
      }
    }

    if (signals.cost === LlmUsageSignal.Metrics && metrics.hasCost) {
      const cost: number = Math.max(0, finite(metrics.costUsd));

      figures.costUsd += cost;

      if (cost > 0) {
        accumulator.costFromMetrics = true;
      }
    }
  }

  // Largest cost first, then most tokens, then most calls, then by name.
  public static compareFigures(
    a: LlmUsageFigures & { key?: string; serviceId?: string },
    b: LlmUsageFigures & { key?: string; serviceId?: string },
  ): number {
    if (b.costUsd !== a.costUsd) {
      return b.costUsd - a.costUsd;
    }

    const aTokens: number = a.inputTokens + a.outputTokens;
    const bTokens: number = b.inputTokens + b.outputTokens;

    if (bTokens !== aTokens) {
      return bTokens - aTokens;
    }

    if (b.calls !== a.calls) {
      return b.calls - a.calls;
    }

    const aName: string = a.key ?? a.serviceId ?? "";
    const bName: string = b.key ?? b.serviceId ?? "";

    return aName < bName ? -1 : aName > bName ? 1 : 0;
  }

  // Whether a figure holds anything to show: a call, a token or a cost.
  private static hasUsage(figures: LlmUsageFigures): boolean {
    return (
      figures.calls > 0 ||
      figures.inputTokens + figures.outputTokens + figures.totalTokens > 0 ||
      figures.costUsd > 0
    );
  }

  public static fold(data: {
    spanRows: Array<LlmUsageSpanRow>;
    metricRows: Array<LlmMetricUsageRow>;
    options: LlmUsageFoldOptions;
  }): LlmUsageResponse {
    const dimension: LlmUsageDimension = data.options.dimension;

    // Each service's AI calls, from its total rows.
    const callsByService: Map<string, LlmUsageSpanRow> = new Map<
      string,
      LlmUsageSpanRow
    >();

    for (const row of data.spanRows || []) {
      if (!row || !row.isTotal) {
        continue;
      }

      const service: string = (row.service || "").trim();
      const known: LlmUsageSpanRow | undefined = callsByService.get(service);

      callsByService.set(
        service,
        known
          ? {
              ...known,
              calls: known.calls + finite(row.calls),
              erroredCalls: known.erroredCalls + finite(row.erroredCalls),
              inputTokens: known.inputTokens + finite(row.inputTokens),
              outputTokens: known.outputTokens + finite(row.outputTokens),
              totalTokens: known.totalTokens + finite(row.totalTokens),
              costUsd: known.costUsd + finite(row.costUsd),
            }
          : { ...row, service: service },
      );
    }

    const metricsByService: Map<string, LlmMetricUsageFigures> =
      LlmMetricUsageUtil.foldByService(data.metricRows || []);

    const serviceIds: Array<string> = Array.from(
      new Set<string>([...callsByService.keys(), ...metricsByService.keys()]),
    );

    const signals: Map<string, LlmUsageServiceSignals> = new Map<
      string,
      LlmUsageServiceSignals
    >();
    const totals: Accumulator = emptyAccumulator();
    const services: Array<LlmUsageService> = [];

    for (const serviceId of serviceIds) {
      const calls: LlmUsageSpanRow | undefined = callsByService.get(serviceId);
      const metrics: LlmMetricUsageFigures | undefined =
        metricsByService.get(serviceId);
      const serviceSignals: LlmUsageServiceSignals =
        LlmUsageUtil.getServiceSignals({ calls: calls, metrics: metrics });

      signals.set(serviceId, serviceSignals);

      const service: Accumulator = emptyAccumulator();

      for (const accumulator of [service, totals]) {
        if (calls) {
          LlmUsageUtil.addSpanRow(accumulator, calls, serviceSignals);
        }

        if (metrics) {
          LlmUsageUtil.addMetricFigures(accumulator, metrics, serviceSignals);
        }
      }

      const figures: LlmUsageFigures = finish(service);

      if (LlmUsageUtil.hasUsage(figures)) {
        services.push({ ...figures, serviceId: serviceId });
      }
    }

    services.sort(LlmUsageUtil.compareFigures);

    let groups: Array<LlmUsageGroup> = [];

    if (dimension === LlmUsageDimension.Service) {
      groups = services.map((service: LlmUsageService): LlmUsageGroup => {
        const { serviceId, ...figures } = service;

        return { ...figures, key: serviceId };
      });
    } else if (dimension !== LlmUsageDimension.None) {
      groups = LlmUsageUtil.foldGroups({
        spanRows: data.spanRows || [],
        metricRows: data.metricRows || [],
        signals: signals,
        options: data.options,
      });
    }

    return {
      totals: finish(totals),
      groups: groups,
      services: services,
      metricsLeftOut: Boolean(data.options.metricsLeftOut),
      truncated: Boolean(data.options.truncated),
    };
  }

  private static foldGroups(data: {
    spanRows: Array<LlmUsageSpanRow>;
    metricRows: Array<LlmMetricUsageRow>;
    signals: Map<string, LlmUsageServiceSignals>;
    options: LlmUsageFoldOptions;
  }): Array<LlmUsageGroup> {
    const dimension: LlmUsageDimension = data.options.dimension;
    const groups: Map<string, Accumulator> = new Map<string, Accumulator>();

    const groupOf: (key: string) => Accumulator = (
      key: string,
    ): Accumulator => {
      const known: Accumulator | undefined = groups.get(key);

      if (known) {
        return known;
      }

      const created: Accumulator = emptyAccumulator();
      groups.set(key, created);

      return created;
    };

    const signalsOf: (service: string) => LlmUsageServiceSignals = (
      service: string,
    ): LlmUsageServiceSignals => {
      return (
        data.signals.get((service || "").trim()) || {
          tokens: LlmUsageSignal.None,
          cost: LlmUsageSignal.None,
        }
      );
    };

    for (const row of data.spanRows) {
      if (!row || row.isTotal) {
        continue;
      }

      LlmUsageUtil.addSpanRow(
        groupOf(LlmMetricUsageUtil.normalizeGroup(dimension, row.group)),
        row,
        signalsOf(row.service),
      );
    }

    /*
     * A metric group's rows (one per metric and token type) folded into the
     * group's figures first, per service: the token types decide input and
     * output (LlmMetricUsageUtil.addRow).
     */
    const metricGroups: Map<
      string,
      Map<string, LlmMetricUsageFigures>
    > = new Map<string, Map<string, LlmMetricUsageFigures>>();

    for (const row of data.metricRows) {
      if (!row || !LlmMetricUsageUtil.isGroupRow(row)) {
        continue;
      }

      const service: string = (row.service || "").trim();
      const name: string = data.options.nameMetricGroup
        ? data.options.nameMetricGroup(row)
        : row.group;
      const key: string = LlmMetricUsageUtil.normalizeGroup(dimension, name);
      const byGroup: Map<string, LlmMetricUsageFigures> =
        metricGroups.get(service) || new Map<string, LlmMetricUsageFigures>();
      const figures: LlmMetricUsageFigures =
        byGroup.get(key) || emptyLlmMetricUsageFigures();

      LlmMetricUsageUtil.addRow(figures, row);
      byGroup.set(key, figures);
      metricGroups.set(service, byGroup);
    }

    for (const [service, byGroup] of metricGroups) {
      for (const [key, figures] of byGroup) {
        LlmUsageUtil.addMetricFigures(
          groupOf(key),
          figures,
          signalsOf(service),
        );
      }
    }

    return Array.from(groups.entries())
      .map(([key, accumulator]: [string, Accumulator]): LlmUsageGroup => {
        return { ...finish(accumulator), key: key };
      })
      .filter((group: LlmUsageGroup): boolean => {
        return LlmUsageUtil.hasUsage(group);
      })
      .sort(LlmUsageUtil.compareFigures);
  }
}
