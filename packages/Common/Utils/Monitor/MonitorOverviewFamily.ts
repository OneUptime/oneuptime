import BadDataException from "../../Types/Exception/BadDataException";
import MonitorMetricType from "../../Types/Monitor/MonitorMetricType";
import MonitorType from "../../Types/Monitor/MonitorType";
import MonitorMetricTypeUtil from "./MonitorMetricType";

/*
 * The monitor overview groups the 34 monitor types into seven families that
 * behave alike on the page: where the "last checked" time comes from, which
 * facts the hero shows, which cards appear. Everything type-specific on the
 * overview goes through this one switch, so a new MonitorType fails to
 * compile here until somebody decides how its overview should look.
 */

export enum MonitorOverviewFamily {
  // Run by probes on a schedule.
  ProbeCheck = "ProbeCheck",
  // Pushed to us: heartbeat requests and inbound email.
  Heartbeat = "Heartbeat",
  // Pushed by the server agent.
  Agent = "Agent",
  // Criteria evaluated by a worker over telemetry.
  TelemetrySignal = "TelemetrySignal",
  // Criteria evaluated by a worker over infrastructure metrics.
  Infrastructure = "Infrastructure",
  // Evaluated on every device poll and matching trap.
  NetworkDevice = "NetworkDevice",
  // No checks at all; people set the status.
  Manual = "Manual",
}

export enum MonitorOverviewSetupKind {
  HeartbeatUrl = "HeartbeatUrl",
  InboundEmail = "InboundEmail",
  ServerAgent = "ServerAgent",
}

export type MonitorOverviewSideCard = "probes" | "connection" | "manual";

export type MonitorOverviewTelemetryPreview =
  | "Logs"
  | "Metrics"
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
  evaluationPolicy: MonitorOverviewEvaluationPolicy;
  setupKind: MonitorOverviewSetupKind | null;
  sideCard: MonitorOverviewSideCard | null;
  summaryDescription: string | null;
}

export default class MonitorOverviewFamilyUtil {
  public static getFamily(monitorType: MonitorType): MonitorOverviewFamily {
    switch (monitorType) {
      case MonitorType.API:
      case MonitorType.Website:
      case MonitorType.IP:
      case MonitorType.Ping:
      case MonitorType.Port:
      case MonitorType.SSLCertificate:
      case MonitorType.SyntheticMonitor:
      case MonitorType.CustomJavaScriptCode:
      case MonitorType.DNS:
      case MonitorType.DNSSEC:
      case MonitorType.Domain:
      case MonitorType.SQLQuery:
      case MonitorType.Database:
      case MonitorType.ExternalStatusPage:
        return MonitorOverviewFamily.ProbeCheck;

      case MonitorType.IncomingRequest:
      case MonitorType.IncomingEmail:
        return MonitorOverviewFamily.Heartbeat;

      case MonitorType.Server:
        return MonitorOverviewFamily.Agent;

      case MonitorType.Logs:
      case MonitorType.Metrics:
      case MonitorType.Traces:
      case MonitorType.Exceptions:
      case MonitorType.Profiles:
      case MonitorType.SecurityEvents:
        return MonitorOverviewFamily.TelemetrySignal;

      case MonitorType.Kubernetes:
      case MonitorType.Docker:
      case MonitorType.Host:
      case MonitorType.Podman:
      case MonitorType.DockerSwarm:
      case MonitorType.Proxmox:
      case MonitorType.VMware:
      case MonitorType.Ceph:
      case MonitorType.IoTDevice:
        return MonitorOverviewFamily.Infrastructure;

      case MonitorType.NetworkDevice:
        return MonitorOverviewFamily.NetworkDevice;

      case MonitorType.Manual:
        return MonitorOverviewFamily.Manual;

      default: {
        /*
         * Compile-time guard: a MonitorType added without a case above makes
         * this assignment a type error.
         */
        const unhandled: never = monitorType;
        throw new BadDataException(
          `Monitor type ${String(unhandled)} has no overview family.`,
        );
      }
    }
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
      case MonitorType.Metrics:
        return "Metrics";
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
        return "What each probe saw on its most recent check.";
      case MonitorOverviewFamily.Heartbeat:
        return monitorType === MonitorType.IncomingEmail
          ? "The most recent email and how the criteria judged it."
          : "The most recent request and how the criteria judged it.";
      case MonitorOverviewFamily.Agent:
        return "What the agent sent in its most recent report.";
      case MonitorOverviewFamily.TelemetrySignal:
      case MonitorOverviewFamily.Infrastructure:
        return "How the criteria judged the data on the most recent evaluation.";
      case MonitorOverviewFamily.NetworkDevice:
        return "How this monitor is evaluated.";
      case MonitorOverviewFamily.Manual:
        // Nothing is evaluated, so there is nothing to summarise.
        return null;
      default:
        return null;
    }
  }
}
