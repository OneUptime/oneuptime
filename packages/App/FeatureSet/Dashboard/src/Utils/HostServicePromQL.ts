import {
  PROMQL_METRIC_NAME_LABEL,
  PromQLAggregateOperator,
  PromQLBinaryOperator,
  PromQLExpression,
  PromQLLabelMatcher,
  PromQLMatchType,
  PromQLNodeKind,
  PromQLVectorSelector,
} from "Common/Utils/PromQL/PromQLAst";
import {
  PromQLLabels,
  matchesPromQLMatchers,
} from "Common/Utils/PromQL/PromQLLabels";
import {
  PromQLMetricRequest,
  PromQLSeriesKind,
  PromQLStoredMetric,
  attributesToPromQLLabels,
  canonicalPromQLNamesOf,
  resolvePromQLMetricName,
  toPromQLLabelName,
} from "Common/Utils/PromQL/PromQLMetricNames";
import { parsePromQL } from "Common/Utils/PromQL/PromQLParser";
import { canonicalizeEntityValue } from "Common/Utils/Telemetry/EntityKey";
import {
  HOST_NAME_ATTR,
  SYSTEMD_ACTIVE_STATES,
  SYSTEMD_UNIT_ACTIVE_STATE_ATTR,
} from "../Pages/Host/Utils/SystemdUnits";
import {
  HOST_SERVICE_STATES,
  HostServiceKind,
  HostServiceStateDefinition,
} from "./HostServiceMonitorPrefill";

/*
 * WHETHER A PROMQL EXPRESSION WATCHES A SERVICE ON A HOST (#10452).
 *
 * A Metrics monitor written in PromQL evaluates its expression over the
 * project's metrics, and a service's page lists it when the expression reads
 * the service's state on the host:
 *
 *   windows_service_status{name="Spooler", resource_host_name="web-01"} != 4
 *
 * The expression is parsed (PromQLParser) and each vector selector in it is
 * matched against the service's series on the host the way the engine
 * selects series: the labels those series carry (attributesToPromQLLabels -
 * a Windows service's `name` and its host's `resource_host_name`, a unit's
 * `resource_systemd_unit_name`, one series for each of its active states),
 * and the selector's own matchers (matchesPromQLMatchers, with the engine's
 * patterns). A selector reads the service when:
 *
 *   - it names the state metric by a name the engine reads it under
 *     (resolvePromQLMetricName: windows_service_status, or
 *     {"windows.service.status"}), or names no metric and its `__name__`
 *     pattern takes the state metric in;
 *   - its service label equals the service's name, takes it in as a
 *     pattern, or is absent: a query of every service watches this one too;
 *   - its host label names this host - as ingest stores host names, trimmed
 *     and in lower case, as the engine compares them - or is absent.
 *
 * What the page cannot know, it says (HostServicePromQLWatch.isCertain):
 *
 *   - a selector that also filters by a label the page does not know this
 *     service's series by (a Windows service's `startup_mode`, a resource
 *     label such as `job`) may or may not take the service in: its labels
 *     are named;
 *   - a part of the expression may leave the service out after the
 *     selector took it in: `unless` a selector of the state metric that can
 *     take the service in, `and` one that leaves it out (whichever labels the
 *     two sides are matched on), or topk and bottomk, which keep only some
 *     series.
 *
 * Everything else an expression does - a comparison, a function, an
 * aggregation, arithmetic with another metric - is part of watching the
 * service. An expression that does not parse watches nothing: the worker
 * cannot run it.
 *
 * Pure: the card reads monitors with it, and its tests read it alone.
 */

export interface HostServicePromQLSubject {
  kind: HostServiceKind;
  // As the host's collector reports it.
  serviceName: string;
  // The host's host.name.
  hostIdentifier: string;
}

export interface HostServicePromQLWatch {
  // A selector names this service: its service label equals the name.
  isForThisService: boolean;
  // False when the expression may leave the service out (above).
  isCertain: boolean;
  /*
   * The labels a selector also filters by that the page cannot check for
   * the service's series, each once, in the order the expression writes
   * them. Empty when that is not why it is uncertain.
   */
  uncertainLabels: Array<string>;
}

/*
 * The unit each state metric's receiver declares: Prometheus writes a unit
 * into a metric's name (#7715), so it is part of the names the engine reads
 * the metric under. A unit in braces adds nothing.
 */
const STATE_METRIC_UNITS: Record<HostServiceKind, string> = {
  [HostServiceKind.WindowsService]: "{status}",
  [HostServiceKind.SystemdUnit]: "1",
};

// The aggregations that keep only some of their series.
const SUBSET_AGGREGATIONS: ReadonlyArray<PromQLAggregateOperator> = [
  PromQLAggregateOperator.Topk,
  PromQLAggregateOperator.Bottomk,
];

// What a selector's part in the expression is.
enum SelectorPart {
  // Its series are what the expression returns, or are part of it.
  Result = "Result",
  // A topk or the like keeps only some of them.
  Subset = "Subset",
  // The right side of `and`: only series it matches are kept.
  Keeps = "Keeps",
  // The right side of `unless`: series it matches are left out.
  LeavesOut = "LeavesOut",
}

interface PlacedSelector {
  selector: PromQLVectorSelector;
  part: SelectorPart;
}

// Every vector selector of an expression, with its part in it.
function placeSelectors(
  expression: PromQLExpression,
  part: SelectorPart,
  placed: Array<PlacedSelector>,
): void {
  switch (expression.kind) {
    case PromQLNodeKind.VectorSelector:
      placed.push({ selector: expression, part: part });
      return;
    case PromQLNodeKind.MatrixSelector:
      placed.push({ selector: expression.vectorSelector, part: part });
      return;
    case PromQLNodeKind.Subquery:
    case PromQLNodeKind.Paren:
    case PromQLNodeKind.Unary:
      placeSelectors(expression.expression, part, placed);
      return;
    case PromQLNodeKind.Call:
      for (const argument of expression.args) {
        placeSelectors(argument, part, placed);
      }
      return;
    case PromQLNodeKind.Aggregate:
      // Its parameter (a topk's k, a quantile) is a number or a label name.
      placeSelectors(
        expression.expression,
        SUBSET_AGGREGATIONS.includes(expression.operator) &&
          part === SelectorPart.Result
          ? SelectorPart.Subset
          : part,
        placed,
      );
      return;
    case PromQLNodeKind.Binary:
      placeSelectors(expression.lhs, part, placed);
      placeSelectors(
        expression.rhs,
        expression.operator === PromQLBinaryOperator.And
          ? SelectorPart.Keeps
          : expression.operator === PromQLBinaryOperator.Unless
            ? SelectorPart.LeavesOut
            : part,
        placed,
      );
      return;
    default:
      // A number or a string reads no series.
      return;
  }
}

interface SelectorReading {
  // Whether the selector takes the service's series in, by what it can tell.
  takesIn: boolean;
  isForThisService: boolean;
  uncertainLabels: Array<string>;
}

class ServiceSeries {
  public readonly state: HostServiceStateDefinition;
  public readonly storedMetric: PromQLStoredMetric;
  // The labels of each of the service's series, as the engine draws them.
  public readonly labelSets: Array<PromQLLabels>;
  public readonly knownLabels: Set<string>;
  public readonly serviceLabel: string;

  public constructor(private readonly subject: HostServicePromQLSubject) {
    this.state = HOST_SERVICE_STATES[subject.kind];
    this.storedMetric = {
      name: this.state.metricName,
      unit: STATE_METRIC_UNITS[subject.kind],
    };
    this.serviceLabel = toPromQLLabelName(this.state.nameAttribute);

    const canonicalName: string =
      canonicalPromQLNamesOf(this.storedMetric).find(
        (entry: { name: string; kind: PromQLSeriesKind }): boolean => {
          return entry.kind === PromQLSeriesKind.Value;
        },
      )?.name || this.state.metricName;

    const attributes: Record<string, unknown> = {
      [this.state.nameAttribute]: subject.serviceName,
      // Ingest stores a host name trimmed and in lower case.
      [HOST_NAME_ATTR]: canonicalizeEntityValue(subject.hostIdentifier),
    };

    // A unit's state is a state set: one series for each active state.
    const attributeSets: Array<Record<string, unknown>> =
      subject.kind === HostServiceKind.SystemdUnit
        ? SYSTEMD_ACTIVE_STATES.map(
            (activeState: string): Record<string, unknown> => {
              return {
                ...attributes,
                [SYSTEMD_UNIT_ACTIVE_STATE_ATTR]: activeState,
              };
            },
          )
        : [attributes];

    this.labelSets = attributeSets.map(
      (set: Record<string, unknown>): PromQLLabels => {
        return {
          ...attributesToPromQLLabels(set),
          [PROMQL_METRIC_NAME_LABEL]: canonicalName,
        };
      },
    );

    this.knownLabels = new Set<string>(
      this.labelSets.flatMap((labels: PromQLLabels): Array<string> => {
        return Object.keys(labels);
      }),
    );
  }

  // Whether a metric name in a query reads the state metric.
  public isNamedBy(name: string): boolean {
    return resolvePromQLMetricName(name, [this.storedMetric]).some(
      (request: PromQLMetricRequest): boolean => {
        return (
          request.storedName === this.storedMetric.name &&
          request.kind === PromQLSeriesKind.Value
        );
      },
    );
  }

  public read(selector: PromQLVectorSelector): SelectorReading | null {
    if (selector.name !== undefined && !this.isNamedBy(selector.name)) {
      return null;
    }

    // A named selector's own name matcher was read above, by name.
    const matchers: Array<PromQLLabelMatcher> = selector.matchers.filter(
      (matcher: PromQLLabelMatcher): boolean => {
        return !(
          selector.name !== undefined &&
          matcher.name === PROMQL_METRIC_NAME_LABEL &&
          matcher.type === PromQLMatchType.Equal &&
          matcher.value === selector.name
        );
      },
    );

    const known: Array<PromQLLabelMatcher> = [];
    const uncertainLabels: Array<string> = [];

    for (const matcher of matchers) {
      if (this.knownLabels.has(matcher.name)) {
        known.push(matcher);
      } else if (!uncertainLabels.includes(matcher.name)) {
        uncertainLabels.push(matcher.name);
      }
    }

    let takesIn: boolean;

    try {
      takesIn = this.labelSets.some((labels: PromQLLabels): boolean => {
        return matchesPromQLMatchers(labels, known);
      });
    } catch {
      // A pattern the engine refuses as too costly: it reads nothing.
      return null;
    }

    if (!takesIn) {
      return null;
    }

    return {
      takesIn: true,
      isForThisService: known.some((matcher: PromQLLabelMatcher): boolean => {
        return (
          matcher.name === this.serviceLabel &&
          matcher.type === PromQLMatchType.Equal &&
          matcher.value === this.subject.serviceName
        );
      }),
      uncertainLabels: uncertainLabels,
    };
  }

  // Whether a selector reads the state metric at all, whatever its labels.
  public readsStateMetric(selector: PromQLVectorSelector): boolean {
    if (selector.name !== undefined) {
      return this.isNamedBy(selector.name);
    }

    const nameMatchers: Array<PromQLLabelMatcher> = selector.matchers.filter(
      (matcher: PromQLLabelMatcher): boolean => {
        return matcher.name === PROMQL_METRIC_NAME_LABEL;
      },
    );

    try {
      return matchesPromQLMatchers(this.labelSets[0]!, nameMatchers);
    } catch {
      return false;
    }
  }
}

// The better of two readings: a certain one, then one naming this service.
function isBetter(
  candidate: HostServicePromQLWatch,
  current: HostServicePromQLWatch | null,
): boolean {
  if (!current) {
    return true;
  }

  if (candidate.isCertain !== current.isCertain) {
    return candidate.isCertain;
  }

  return candidate.isForThisService && !current.isForThisService;
}

/*
 * Whether a PromQL expression watches the service on the host (above), and
 * how surely. Null when it does not, or does not parse.
 */
export function readHostServicePromQLWatch(data: {
  expression: string;
  subject: HostServicePromQLSubject;
}): HostServicePromQLWatch | null {
  const text: string = (data.expression || "").trim();

  if (!text) {
    return null;
  }

  let expression: PromQLExpression;

  try {
    expression = parsePromQL(text);
  } catch {
    return null;
  }

  const series: ServiceSeries = new ServiceSeries(data.subject);
  const placed: Array<PlacedSelector> = [];

  placeSelectors(expression, SelectorPart.Result, placed);

  /*
   * Whether a part of the expression may leave the service out after a
   * selector took it in: an `unless` of the state metric that can take it
   * in, or an `and` of the state metric that leaves it out.
   */
  const mayBeLeftOut: boolean = placed.some((entry: PlacedSelector) => {
    if (
      entry.part !== SelectorPart.LeavesOut &&
      entry.part !== SelectorPart.Keeps
    ) {
      return false;
    }

    if (!series.readsStateMetric(entry.selector)) {
      return false;
    }

    const reading: SelectorReading | null = series.read(entry.selector);

    return entry.part === SelectorPart.LeavesOut
      ? reading !== null
      : reading === null || reading.uncertainLabels.length > 0;
  });

  let best: HostServicePromQLWatch | null = null;

  for (const entry of placed) {
    if (
      entry.part !== SelectorPart.Result &&
      entry.part !== SelectorPart.Subset
    ) {
      continue;
    }

    const reading: SelectorReading | null = series.read(entry.selector);

    if (!reading) {
      continue;
    }

    const watch: HostServicePromQLWatch = {
      isForThisService: reading.isForThisService,
      isCertain:
        reading.uncertainLabels.length === 0 &&
        entry.part === SelectorPart.Result &&
        !mayBeLeftOut,
      uncertainLabels: reading.uncertainLabels,
    };

    if (isBetter(watch, best)) {
      best = watch;
    }
  }

  return best;
}
