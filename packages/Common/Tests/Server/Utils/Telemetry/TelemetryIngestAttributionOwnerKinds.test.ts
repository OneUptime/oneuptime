import { describe, expect, test } from "@jest/globals";
import ModelPermission from "../../../../Server/Types/AnalyticsDatabase/ModelPermission";
import TelemetryIngestAttributionSettings, {
  TelemetryIngestOwnerKind,
} from "../../../../Server/Utils/Telemetry/TelemetryIngestAttributionSettings";
import ServiceType from "../../../../Types/Telemetry/ServiceType";

/*
 * WHOSE A HOST, A CLUSTER OR ANY OTHER RESOURCE IS, for a team's or a
 * label's ingestion budget (#10101), is decided as the rest of the product
 * decides it: by the owner table registry's kinds whose ids a telemetry row
 * can name - the very kinds the telemetry read scope works ownership and
 * labels out over (ModelPermission) - each through its own owner team table
 * and its own labels. Against the real registry, so a kind added there is
 * counted by the budgets too, and one the budgets would miss fails here.
 */

const KINDS: Array<TelemetryIngestOwnerKind> =
  TelemetryIngestAttributionSettings.getTelemetryOwnerKinds();

describe("the kinds of resource a team's or a label's budget counts", () => {
  test("are exactly the kinds the telemetry read scope decides ownership and labels over", () => {
    expect(
      KINDS.map((kind: TelemetryIngestOwnerKind) => {
        return kind.kind;
      }).sort(),
    ).toEqual([...ModelPermission.getTelemetryResourceTypes()].sort());
  });

  test("hold every kind an ingest service files telemetry under", () => {
    const kinds: Array<string> = KINDS.map((kind: TelemetryIngestOwnerKind) => {
      return kind.kind;
    });

    // The model each primary entity type names (an IoT row names its fleet).
    for (const [type, model] of [
      [ServiceType.OpenTelemetry, "Service"],
      [ServiceType.Host, "Host"],
      [ServiceType.DockerHost, "DockerHost"],
      [ServiceType.PodmanHost, "PodmanHost"],
      [ServiceType.KubernetesCluster, "KubernetesCluster"],
      [ServiceType.ProxmoxCluster, "ProxmoxCluster"],
      [ServiceType.OpenStackCloud, "OpenStackCloud"],
      [ServiceType.CephCluster, "CephCluster"],
      [ServiceType.StorageArray, "StorageArray"],
      [ServiceType.DockerSwarmCluster, "DockerSwarmCluster"],
      [ServiceType.VMwareVCenter, "VMwareVCenter"],
      [ServiceType.ServerlessFunction, "ServerlessFunction"],
      [ServiceType.CloudResource, "CloudResource"],
      [ServiceType.RealUserMonitor, "RumApplication"],
      [ServiceType.IoTDevice, "IoTFleet"],
      [ServiceType.DatabaseServer, "DatabaseServer"],
    ] as Array<[ServiceType, string]>) {
      expect({ type, counted: kinds.includes(model) }).toEqual({
        type,
        counted: true,
      });
    }
  });

  test("each is read through its owner team table, by its own key, and through its labels", () => {
    for (const kind of KINDS) {
      expect({
        kind: kind.kind,
        ownerTeams: typeof kind.ownerTeamService?.findAllBy,
        key: typeof kind.fkColumn === "string" && kind.fkColumn.length > 0,
        labels: typeof kind.modelService?.findAllBy,
      }).toEqual({
        kind: kind.kind,
        ownerTeams: "function",
        key: true,
        labels: "function",
      });
    }
  });

  test("each owner team table names its team and the resource, by the key the budgets read", () => {
    for (const kind of KINDS) {
      const service: {
        getModel?: () => {
          getTableColumns: () => { columns: Array<string> };
        };
      } = kind.ownerTeamService as never;
      const columns: Array<string> =
        service.getModel!().getTableColumns().columns;

      expect({
        kind: kind.kind,
        names: ["projectId", "teamId", kind.fkColumn].filter(
          (column: string) => {
            return columns.includes(column);
          },
        ),
      }).toEqual({
        kind: kind.kind,
        names: ["projectId", "teamId", kind.fkColumn],
      });
    }
  });

  test("each resource carries labels, and is a project's", () => {
    for (const kind of KINDS) {
      const service: {
        getModel?: () => {
          getTableColumns: () => { columns: Array<string> };
        };
      } = kind.modelService as never;
      const columns: Array<string> =
        service.getModel!().getTableColumns().columns;

      expect({
        kind: kind.kind,
        labels: columns.includes("labels"),
        projectId: columns.includes("projectId"),
      }).toEqual({ kind: kind.kind, labels: true, projectId: true });
    }
  });
});
