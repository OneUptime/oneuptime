import MonitorMetricType from "../../Types/Monitor/MonitorMetricType";
import MonitorType, {
  MonitorTypeHelper,
} from "../../Types/Monitor/MonitorType";
import MonitorMetricTypeUtil from "./MonitorMetricType";
import MonitorTypeFamily, { MonitorOverviewFamily } from "./MonitorTypeFamily";
import { translationKey } from "../../Types/Translator";

/*
 * How the monitor overview lays out each of the eight families it groups
 * the monitor types into. The family itself - the enum, and the one switch
 * every type-specific part of the overview goes through - is a module of
 * its own (MonitorTypeFamily), which loads without the metric catalogs the
 * layout reads; it is exported here as it always was.
 */

export { MonitorOverviewFamily };

export enum MonitorOverviewSetupKind {
  HeartbeatUrl = "HeartbeatUrl",
  InboundEmail = "InboundEmail",
  ServerAgent = "ServerAgent",
}

export type MonitorOverviewSideCard = "probes" | "connection" | "manual";

/*
 * The card that previews what a log, trace or security events monitor's
 * filter matches. A metric-backed monitor's metrics are charted on a card
 * of their own instead (metricCharts).
 */
export type MonitorOverviewTelemetryPreview =
  | "Logs"
  | "Traces"
  | "SecurityEvents";

/*
 * How many MonitorLog rows the overview reads to explain the latest verdict:
 * one per probe for probe checks, the newest row for everything evaluated
 * centrally, none for Manual (nothing is evaluated).
 */
export type MonitorOverviewEvaluationPolicy = "PerProbe" | "Latest" | "None";

export interface MonitorOverviewLayout {
  family: MonitorOverviewFamily;
  responseTimeMetric: MonitorMetricType | null;
  telemetryPreview: MonitorOverviewTelemetryPreview | null;
  /*
   * The metrics the monitor checks, charted with the values its criteria
   * alert at, first on the page: every metric-backed type, the Metrics
   * monitor and every infrastructure monitor alike (issue #5759).
   */
  metricCharts: boolean;
  evaluationPolicy: MonitorOverviewEvaluationPolicy;
  setupKind: MonitorOverviewSetupKind | null;
  sideCard: MonitorOverviewSideCard | null;
  /*
   * The summary card's description, in English: a key of the Dashboard's
   * locales, translated where the overview is put together
   * (MonitorOverviewPresentationUtil.getSections).
   */
  summaryDescription: string | null;
}

export default class MonitorOverviewFamilyUtil {
  // The family a type belongs to, by MonitorTypeFamily's switch.
  public static getFamily(monitorType: MonitorType): MonitorOverviewFamily {
    return MonitorTypeFamily.getFamily(monitorType);
  }

  public static getLayout(monitorType: MonitorType): MonitorOverviewLayout {
    const family: MonitorOverviewFamily =
      MonitorOverviewFamilyUtil.getFamily(monitorType);

    return {
      family: family,
      responseTimeMetric: MonitorOverviewFamilyUtil.getResponseTimeMetric(
        monitorType,
        family,
      ),
      telemetryPreview:
        MonitorOverviewFamilyUtil.getTelemetryPreview(monitorType),
      metricCharts: MonitorTypeHelper.isMetricBackedMonitor(monitorType),
      evaluationPolicy: MonitorOverviewFamilyUtil.getEvaluationPolicy(family),
      setupKind: MonitorOverviewFamilyUtil.getSetupKind(monitorType),
      sideCard: MonitorOverviewFamilyUtil.getSideCard(family),
      summaryDescription: MonitorOverviewFamilyUtil.getSummaryDescription(
        monitorType,
        family,
      ),
    };
  }

  /*
   * The chart the response-time card draws. Scripted checks have no
   * response, only a run time, so they get ExecutionTime. Read from the
   * metric catalog rather than listed here, so the card only ever asks for
   * a series the probe actually writes.
   */
  private static getResponseTimeMetric(
    monitorType: MonitorType,
    family: MonitorOverviewFamily,
  ): MonitorMetricType | null {
    if (family !== MonitorOverviewFamily.ProbeCheck) {
      return null;
    }

    const metrics: Array<MonitorMetricType> =
      MonitorMetricTypeUtil.getMonitorMetricTypesByMonitorType(monitorType);

    if (metrics.includes(MonitorMetricType.ResponseTime)) {
      return MonitorMetricType.ResponseTime;
    }

    if (metrics.includes(MonitorMetricType.ExecutionTime)) {
      return MonitorMetricType.ExecutionTime;
    }

    return null;
  }

  private static getTelemetryPreview(
    monitorType: MonitorType,
  ): MonitorOverviewTelemetryPreview | null {
    switch (monitorType) {
      case MonitorType.Logs:
        return "Logs";
      case MonitorType.Traces:
        return "Traces";
      case MonitorType.SecurityEvents:
        return "SecurityEvents";
      default:
        return null;
    }
  }

  private static getEvaluationPolicy(
    family: MonitorOverviewFamily,
  ): MonitorOverviewEvaluationPolicy {
    if (family === MonitorOverviewFamily.ProbeCheck) {
      return "PerProbe";
    }

    if (family === MonitorOverviewFamily.Manual) {
      return "None";
    }

    return "Latest";
  }

  private static getSetupKind(
    monitorType: MonitorType,
  ): MonitorOverviewSetupKind | null {
    switch (monitorType) {
      case MonitorType.IncomingRequest:
        return MonitorOverviewSetupKind.HeartbeatUrl;
      case MonitorType.IncomingEmail:
        return MonitorOverviewSetupKind.InboundEmail;
      case MonitorType.Server:
        return MonitorOverviewSetupKind.ServerAgent;
      default:
        return null;
    }
  }

  private static getSideCard(
    family: MonitorOverviewFamily,
  ): MonitorOverviewSideCard | null {
    switch (family) {
      case MonitorOverviewFamily.ProbeCheck:
        return "probes";
      case MonitorOverviewFamily.Heartbeat:
      case MonitorOverviewFamily.Agent:
        return "connection";
      case MonitorOverviewFamily.Manual:
        return "manual";
      default:
        return null;
    }
  }

  private static getSummaryDescription(
    monitorType: MonitorType,
    family: MonitorOverviewFamily,
  ): string | null {
    switch (family) {
      case MonitorOverviewFamily.ProbeCheck:
        return translationKey("What each probe saw on its most recent check.");
      case MonitorOverviewFamily.Heartbeat:
        return monitorType === MonitorType.IncomingEmail
          ? translationKey(
              "The most recent email and how the criteria judged it.",
            )
          : translationKey(
              "The most recent request and how the criteria judged it.",
            );
      case MonitorOverviewFamily.Agent:
        return translationKey("What the agent sent in its most recent report.");
      case MonitorOverviewFamily.TelemetrySignal:
      case MonitorOverviewFamily.Infrastructure:
        return translationKey(
          "How the criteria judged the data on the most recent evaluation.",
        );
      case MonitorOverviewFamily.NetworkDevice:
        return translationKey("How this monitor is evaluated.");
      case MonitorOverviewFamily.ProbeStatus:
        return translationKey(
          "Each probe this monitor watches, as the latest evaluation found it.",
        );
      case MonitorOverviewFamily.Manual:
        // Nothing is evaluated, so there is nothing to summarise.
        return null;
      default:
        return null;
    }
  }
}
