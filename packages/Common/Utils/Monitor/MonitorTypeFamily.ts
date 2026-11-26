import BadDataException from "../../Types/Exception/BadDataException";
import MonitorType from "../../Types/Monitor/MonitorType";

/*
 * The monitor overview groups the 35 monitor types into eight families that
 * behave alike on the page: where the "last checked" time comes from, which
 * facts the hero shows, which cards appear. Everything type-specific on the
 * overview goes through this one switch, so a new MonitorType fails to
 * compile here until somebody decides how its overview should look.
 *
 * The family is a module of its own, apart from the overview's layout
 * (MonitorOverviewFamily), because of what the layout reads: every monitor
 * type's metrics and the database metric catalog (Utils/Monitor/
 * MonitorMetricType), some 45 KB before gzip. The rule for a first check
 * that is overdue (MonitorFirstCheckOverdue) needs the family alone, and a
 * public dashboard's Monitor List widget draws its rows by that rule, so a
 * public dashboard loads the family before it draws but not the catalogs
 * (packages/Common/Scripts/first-load-budgets.js).
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
  // Evaluated every minute from the connection status of the probes it watches.
  ProbeStatus = "ProbeStatus",
  // No checks at all; people set the status.
  Manual = "Manual",
}

export default class MonitorTypeFamily {
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
      case MonitorType.NTP:
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
      case MonitorType.Llm:
        return MonitorOverviewFamily.TelemetrySignal;

      case MonitorType.Kubernetes:
      case MonitorType.Docker:
      case MonitorType.Host:
      case MonitorType.Podman:
      case MonitorType.DockerSwarm:
      case MonitorType.Proxmox:
      case MonitorType.OpenStack:
      case MonitorType.VMware:
      case MonitorType.XcpNg:
      case MonitorType.Ceph:
      case MonitorType.StorageArray:
      case MonitorType.IoTDevice:
        return MonitorOverviewFamily.Infrastructure;

      case MonitorType.NetworkDevice:
        return MonitorOverviewFamily.NetworkDevice;

      case MonitorType.ProbeStatus:
        return MonitorOverviewFamily.ProbeStatus;

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
}
