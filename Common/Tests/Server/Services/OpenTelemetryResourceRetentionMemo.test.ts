/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it (DatabaseService, the base class of
 * every concrete service, imports it). Nothing password-related is under
 * test here, so the module is replaced WITH A FACTORY — an automock would
 * still require (and type-check) the real file.
 */
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "../../../Server/Services/OpenTelemetryIngestService";
import ProjectService from "../../../Server/Services/ProjectService";
import HostService from "../../../Server/Services/HostService";
import DockerHostService from "../../../Server/Services/DockerHostService";
import PodmanHostService from "../../../Server/Services/PodmanHostService";
import KubernetesClusterService from "../../../Server/Services/KubernetesClusterService";
import ProxmoxClusterService from "../../../Server/Services/ProxmoxClusterService";
import CephClusterService from "../../../Server/Services/CephClusterService";
import DockerSwarmClusterService from "../../../Server/Services/DockerSwarmClusterService";
import IoTFleetService from "../../../Server/Services/IoTFleetService";
import ServerlessFunctionService from "../../../Server/Services/ServerlessFunctionService";
import CloudResourceService from "../../../Server/Services/CloudResourceService";
import RumApplicationService from "../../../Server/Services/RumApplicationService";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The L1 memo inside OTelIngestService.getResourceRetention.
 *
 * For non-Service telemetry (Host / DockerHost / KubernetesCluster / ...)
 * the per-resource retention override is read with a Postgres findOneById.
 * A comment used to claim the signal services cache the result under their
 * per-batch `serviceDictionary` — they do store it there, but only AFTER
 * `resolveTelemetryResource` has run, and none of the three consults the
 * dictionary before calling in. So every resource block of every batch paid
 * that SELECT. The memo (keyed on entityType + entityId, 60s TTL) is what
 * actually removes it; this suite pins that for ALL eleven entity types.
 *
 * What is pinned, per type:
 *
 *   1. A repeated build for the same resource does NOT reach Postgres
 *      again inside the TTL, and returns identical retention values.
 *   2. The memo expires on the TTL — a user's retention edit propagates
 *      within a minute (the documented staleness bound).
 *   3. A lookup ERROR is not memoized: the failing call falls back to the
 *      project default (old behaviour) and the next call retries.
 *   4. Entries never leak across resources or entity types.
 *
 * getResourceRetention is private; everything goes through the public
 * buildResourceMetadataForNonService. Every test uses fresh ObjectIDs so
 * the module-level memo cannot leak state between tests — the same
 * isolation idiom as OpenTelemetryServiceResolutionCache.test.ts.
 */

type RetentionCase = {
  /** describe() title. */
  name: string;
  /** The ServiceType discriminator routed to this lookup branch. */
  serviceType: ServiceType;
  /** The service whose findOneById the branch calls. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  service: any;
};

const RETENTION_CASES: Array<RetentionCase> = [
  { name: "Host", serviceType: ServiceType.Host, service: HostService },
  {
    name: "DockerHost",
    serviceType: ServiceType.DockerHost,
    service: DockerHostService,
  },
  {
    name: "PodmanHost",
    serviceType: ServiceType.PodmanHost,
    service: PodmanHostService,
  },
  {
    name: "KubernetesCluster",
    serviceType: ServiceType.KubernetesCluster,
    service: KubernetesClusterService,
  },
  {
    name: "ProxmoxCluster",
    serviceType: ServiceType.ProxmoxCluster,
    service: ProxmoxClusterService,
  },
  {
    name: "CephCluster",
    serviceType: ServiceType.CephCluster,
    service: CephClusterService,
  },
  {
    name: "DockerSwarmCluster",
    serviceType: ServiceType.DockerSwarmCluster,
    service: DockerSwarmClusterService,
  },
  {
    name: "IoTFleet",
    serviceType: ServiceType.IoTDevice,
    service: IoTFleetService,
  },
  {
    name: "ServerlessFunction",
    serviceType: ServiceType.ServerlessFunction,
    service: ServerlessFunctionService,
  },
  {
    name: "CloudResource",
    serviceType: ServiceType.CloudResource,
    service: CloudResourceService,
  },
  {
    name: "RumApplication",
    serviceType: ServiceType.RealUserMonitor,
    service: RumApplicationService,
  },
];

const PROJECT_DEFAULT_RETENTION_DAYS: number = 15;

let nowMs: number;

function build(data: {
  serviceType: ServiceType;
  resourceId: ObjectID;
  projectId: ObjectID;
}): Promise<TelemetryServiceMetadata> {
  return OTelIngestService.buildResourceMetadataForNonService({
    serviceName: "resource-under-test",
    resourceId: data.resourceId,
    primaryEntityType: data.serviceType,
    projectId: data.projectId,
  });
}

describe.each(RETENTION_CASES)(
  "$name resource-retention memo",
  ({ serviceType, service }: RetentionCase) => {
    let findOneById: jest.SpyInstance;

    beforeEach(() => {
      nowMs = 1_700_000_000_000;
      jest.spyOn(Date, "now").mockImplementation(() => {
        return nowMs;
      });

      /*
       * The project-retention context rides its own (already-tested) L1+L2
       * cache; Redis misses here so it always resolves through the mocked
       * ProjectService below. Fresh projectIds per test keep ITS L1 cold
       * too.
       */
      jest.spyOn(GlobalCache, "getJSONObject").mockResolvedValue(null);
      jest.spyOn(GlobalCache, "setJSON").mockResolvedValue(undefined);
      jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
        defaultTelemetryRetentionInDays: PROJECT_DEFAULT_RETENTION_DAYS,
        telemetryRetentionConfig: null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      findOneById = jest.spyOn(service, "findOneById") as jest.SpyInstance;
      findOneById.mockResolvedValue({
        retainTelemetryDataForDays: 30,
        telemetryRetentionConfig: null,
      });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    /*
     * THE assertion: one findOneById per resource per TTL window — not one
     * per resource block per batch.
     */
    test("a repeated build does not reach Postgres again", async () => {
      const projectId: ObjectID = ObjectID.generate();
      const resourceId: ObjectID = ObjectID.generate();

      for (let i: number = 0; i < 50; i++) {
        await build({ serviceType, resourceId, projectId });
      }

      expect(findOneById).toHaveBeenCalledTimes(1);
    });

    test("the memoed build carries the same retention as the resolving one", async () => {
      const projectId: ObjectID = ObjectID.generate();
      const resourceId: ObjectID = ObjectID.generate();

      const first: TelemetryServiceMetadata = await build({
        serviceType,
        resourceId,
        projectId,
      });
      const second: TelemetryServiceMetadata = await build({
        serviceType,
        resourceId,
        projectId,
      });

      expect(first.serviceRetentionInDays).toBe(30);
      expect(first.dataRententionInDays).toBe(30);
      expect(second.serviceRetentionInDays).toBe(first.serviceRetentionInDays);
      expect(second.dataRententionInDays).toBe(first.dataRententionInDays);
    });

    test("a resource with no override still falls back to the project default — memoized too", async () => {
      const projectId: ObjectID = ObjectID.generate();
      const resourceId: ObjectID = ObjectID.generate();
      findOneById.mockResolvedValue({
        retainTelemetryDataForDays: null,
        telemetryRetentionConfig: null,
      });

      const first: TelemetryServiceMetadata = await build({
        serviceType,
        resourceId,
        projectId,
      });
      const second: TelemetryServiceMetadata = await build({
        serviceType,
        resourceId,
        projectId,
      });

      expect(first.serviceRetentionInDays).toBeNull();
      expect(first.dataRententionInDays).toBe(PROJECT_DEFAULT_RETENTION_DAYS);
      expect(second.dataRententionInDays).toBe(PROJECT_DEFAULT_RETENTION_DAYS);
      expect(findOneById).toHaveBeenCalledTimes(1);
    });

    test("distinct resources never share an entry", async () => {
      const projectId: ObjectID = ObjectID.generate();

      await build({
        serviceType,
        resourceId: ObjectID.generate(),
        projectId,
      });
      await build({
        serviceType,
        resourceId: ObjectID.generate(),
        projectId,
      });

      expect(findOneById).toHaveBeenCalledTimes(2);
    });

    test("a retention edit propagates within the 60s TTL", async () => {
      const projectId: ObjectID = ObjectID.generate();
      const resourceId: ObjectID = ObjectID.generate();

      const before: TelemetryServiceMetadata = await build({
        serviceType,
        resourceId,
        projectId,
      });
      expect(before.dataRententionInDays).toBe(30);

      // The user edits retention; inside the TTL the memo still answers.
      findOneById.mockResolvedValue({
        retainTelemetryDataForDays: 45,
        telemetryRetentionConfig: null,
      });
      const inside: TelemetryServiceMetadata = await build({
        serviceType,
        resourceId,
        projectId,
      });
      expect(inside.dataRententionInDays).toBe(30);

      // Past the TTL the edit lands — the documented staleness bound.
      nowMs += 61 * 1000;
      const after: TelemetryServiceMetadata = await build({
        serviceType,
        resourceId,
        projectId,
      });
      expect(after.dataRententionInDays).toBe(45);
      expect(findOneById).toHaveBeenCalledTimes(2);
    });

    test("a lookup error is NOT memoized — it degrades this call and retries on the next", async () => {
      const projectId: ObjectID = ObjectID.generate();
      const resourceId: ObjectID = ObjectID.generate();
      findOneById.mockRejectedValueOnce(new Error("connection terminated"));

      const degraded: TelemetryServiceMetadata = await build({
        serviceType,
        resourceId,
        projectId,
      });
      // Old behaviour: warn and fall back to the project default.
      expect(degraded.serviceRetentionInDays).toBeNull();
      expect(degraded.dataRententionInDays).toBe(
        PROJECT_DEFAULT_RETENTION_DAYS,
      );

      const recovered: TelemetryServiceMetadata = await build({
        serviceType,
        resourceId,
        projectId,
      });

      expect(recovered.dataRententionInDays).toBe(30);
      expect(findOneById).toHaveBeenCalledTimes(2);
    });
  },
);

describe("resource-retention memo across entity types", () => {
  beforeEach(() => {
    jest.spyOn(GlobalCache, "getJSONObject").mockResolvedValue(null);
    jest.spyOn(GlobalCache, "setJSON").mockResolvedValue(undefined);
    jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
      defaultTelemetryRetentionInDays: PROJECT_DEFAULT_RETENTION_DAYS,
      telemetryRetentionConfig: null,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the same resource id under two entity types occupies two entries", async () => {
    /*
     * The memo key includes the entity type, so an id collision across
     * tables (possible — the tables are independent) cannot serve Host
     * retention for a DockerHost.
     */
    const projectId: ObjectID = ObjectID.generate();
    const resourceId: ObjectID = ObjectID.generate();

    const hostFind: jest.SpyInstance = jest
      .spyOn(HostService, "findOneById")
      .mockResolvedValue({
        retainTelemetryDataForDays: 30,
        telemetryRetentionConfig: null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
    const dockerFind: jest.SpyInstance = jest
      .spyOn(DockerHostService, "findOneById")
      .mockResolvedValue({
        retainTelemetryDataForDays: 7,
        telemetryRetentionConfig: null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

    const asHost: TelemetryServiceMetadata = await build({
      serviceType: ServiceType.Host,
      resourceId,
      projectId,
    });
    const asDockerHost: TelemetryServiceMetadata = await build({
      serviceType: ServiceType.DockerHost,
      resourceId,
      projectId,
    });

    expect(asHost.dataRententionInDays).toBe(30);
    expect(asDockerHost.dataRententionInDays).toBe(7);
    expect(hostFind).toHaveBeenCalledTimes(1);
    expect(dockerFind).toHaveBeenCalledTimes(1);
  });

  test("an entity type with no retention branch resolves to the project default with no lookup", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const resourceId: ObjectID = ObjectID.generate();

    const hostFind: jest.SpyInstance = jest.spyOn(HostService, "findOneById");

    const unknown: TelemetryServiceMetadata = await build({
      serviceType: ServiceType.Unknown,
      resourceId,
      projectId,
    });

    expect(unknown.serviceRetentionInDays).toBeNull();
    expect(unknown.dataRententionInDays).toBe(PROJECT_DEFAULT_RETENTION_DAYS);
    expect(hostFind).not.toHaveBeenCalled();
  });
});
