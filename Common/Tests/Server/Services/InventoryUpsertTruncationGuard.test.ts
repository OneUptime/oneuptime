import CephResourceService, {
  ParsedCephResource,
} from "../../../Server/Services/CephResourceService";
import DockerResourceService, {
  ParsedDockerContainer,
  ParsedDockerResource,
} from "../../../Server/Services/DockerResourceService";
import DockerSwarmResourceService, {
  ParsedDockerSwarmResource,
} from "../../../Server/Services/DockerSwarmResourceService";
import KubernetesContainerService, {
  ContainerLatestMetric,
  ParsedKubernetesContainer,
} from "../../../Server/Services/KubernetesContainerService";
import KubernetesResourceService, {
  ParsedKubernetesResource,
  ResourceLatestMetric,
} from "../../../Server/Services/KubernetesResourceService";
import PodmanResourceService, {
  ParsedPodmanContainer,
  ParsedPodmanResource,
} from "../../../Server/Services/PodmanResourceService";
import ProxmoxResourceService, {
  ParsedProxmoxResource,
} from "../../../Server/Services/ProxmoxResourceService";
import logger from "../../../Server/Utils/Logger";
import ColumnLength from "../../../Types/Database/ColumnLength";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * Follow-up to issue #3006. The inventory services hand-build
 * `INSERT ... ON CONFLICT` strings and flush them through
 * `getRepository().manager.query()` in chunks of 500 rows, which
 * bypasses the length validation DatabaseService applies to ordinary
 * CRUD writes. A single value past its column limit raises 22001
 * ("value too long for type character varying(N)") and aborts the WHOLE
 * multi-row INSERT — one malformed resource silently drops up to 499
 * healthy inventory rows with it.
 *
 * Widening the columns (see InventoryResourceNameColumnWidth.test.ts)
 * removes the overflow that actually happens in the field; these clamps
 * are the backstop that keeps ANY future overflow from taking the batch
 * down with it. Every test here asserts the same two things: the
 * oversized value is clipped to its column bound, and the healthy row
 * riding in the same chunk still makes it into the statement.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const PARENT_ID: ObjectID = ObjectID.generate();
const OBSERVED_AT: Date = new Date("2026-08-05T00:00:00.000Z");

const OVERSIZED: string = "x".repeat(900);
const CLAMPED_TO_SHORT_TEXT: string = OVERSIZED.substring(
  0,
  ColumnLength.ShortText,
);
const CLAMPED_TO_LONG_TEXT: string = OVERSIZED.substring(
  0,
  ColumnLength.LongText,
);

type QueryCall = [string, Array<unknown>];

interface RepositoryHolder {
  getRepository: () => unknown;
}

function mockQueryRunner(service: RepositoryHolder): jest.Mock {
  const query: jest.Mock = jest.fn().mockResolvedValue([]);
  jest
    .spyOn(service, "getRepository")
    .mockReturnValue({ manager: { query } } as any);
  return query;
}

function paramsOf(query: jest.Mock, callIndex: number = 0): Array<unknown> {
  const [, params] = query.mock.calls[callIndex] as QueryCall;
  return params;
}

/**
 * Every string parameter in the statement fits inside the widest
 * bounded varchar this codebase uses, so nothing in the tuple can
 * trigger 22001.
 */
function expectNoParamExceedsLongText(params: Array<unknown>): void {
  for (const value of params) {
    if (typeof value === "string") {
      expect(value.length).toBeLessThanOrEqual(ColumnLength.LongText);
    }
  }
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("KubernetesResourceService — oversized values can't drop the chunk", () => {
  function resource(
    overrides: Partial<ParsedKubernetesResource> = {},
  ): ParsedKubernetesResource {
    return {
      kind: "Pod",
      namespaceKey: "default",
      name: "api-7d9f8c6b5d-x2k9p",
      uid: "9f1c2b3a-4d5e-6f70-8192-a3b4c5d6e7f8",
      phase: "Running",
      isReady: true,
      hasMemoryPressure: null,
      hasDiskPressure: null,
      hasPidPressure: null,
      labels: null,
      annotations: null,
      ownerReferences: null,
      spec: null,
      containerCount: 1,
      status: null,
      lastSeenAt: OBSERVED_AT,
      resourceCreationTimestamp: null,
      ...overrides,
    };
  }

  test("bulkUpsert clamps an oversized name and keeps its sibling row", async () => {
    const query: jest.Mock = mockQueryRunner(KubernetesResourceService);

    await KubernetesResourceService.bulkUpsert({
      projectId: PROJECT_ID,
      kubernetesClusterId: PARENT_ID,
      resources: [resource({ name: OVERSIZED }), resource()],
    });

    expect(query).toHaveBeenCalledTimes(1);
    const params: Array<unknown> = paramsOf(query);

    expect(params).toContain(CLAMPED_TO_LONG_TEXT);
    expect(params).not.toContain(OVERSIZED);
    expect(params).toContain("api-7d9f8c6b5d-x2k9p");
    expectNoParamExceedsLongText(params);
  });

  test("bulkUpsert clamps the ShortText identity columns at 100", async () => {
    const query: jest.Mock = mockQueryRunner(KubernetesResourceService);

    await KubernetesResourceService.bulkUpsert({
      projectId: PROJECT_ID,
      kubernetesClusterId: PARENT_ID,
      resources: [
        resource({
          kind: OVERSIZED,
          namespaceKey: OVERSIZED,
          uid: OVERSIZED,
          phase: OVERSIZED,
        }),
      ],
    });

    const params: Array<unknown> = paramsOf(query);
    const clamped: Array<unknown> = params.filter((value: unknown) => {
      return value === CLAMPED_TO_SHORT_TEXT;
    });

    expect(clamped).toHaveLength(4);
    expect(params).not.toContain(OVERSIZED);
  });

  test("bulkUpdateLatestMetrics clamps controller names, which are assigned columns", async () => {
    const query: jest.Mock = mockQueryRunner(KubernetesResourceService);

    const metric: ResourceLatestMetric = {
      kind: "Pod",
      namespaceKey: "default",
      name: "api-7d9f8c6b5d-x2k9p",
      cpuPercent: 12,
      memoryBytes: 1024,
      memoryPercent: 4,
      observedAt: OBSERVED_AT,
      controllerDeploymentName: OVERSIZED,
      controllerCronJobName: OVERSIZED,
    };

    await KubernetesResourceService.bulkUpdateLatestMetrics({
      projectId: PROJECT_ID,
      kubernetesClusterId: PARENT_ID,
      metrics: [metric],
    });

    const params: Array<unknown> = paramsOf(query);

    // controllerDeploymentName is LongText, controllerCronJobName is ShortText.
    expect(params).toContain(CLAMPED_TO_LONG_TEXT);
    expect(params).toContain(CLAMPED_TO_SHORT_TEXT);
    expect(params).not.toContain(OVERSIZED);
    expectNoParamExceedsLongText(params);
  });

  test("bulkUpdateLatestMetrics clamps identity the same way bulkUpsert does", async () => {
    /*
     * If the two paths clamped differently, the mirror UPDATE would
     * silently miss the row the upsert just wrote under the clipped name.
     */
    const upsertQuery: jest.Mock = mockQueryRunner(KubernetesResourceService);
    await KubernetesResourceService.bulkUpsert({
      projectId: PROJECT_ID,
      kubernetesClusterId: PARENT_ID,
      resources: [resource({ name: OVERSIZED })],
    });
    const upsertParams: Array<unknown> = paramsOf(upsertQuery);

    jest.restoreAllMocks();

    const metricQuery: jest.Mock = mockQueryRunner(KubernetesResourceService);
    await KubernetesResourceService.bulkUpdateLatestMetrics({
      projectId: PROJECT_ID,
      kubernetesClusterId: PARENT_ID,
      metrics: [
        {
          kind: "Pod",
          namespaceKey: "default",
          name: OVERSIZED,
          cpuPercent: null,
          memoryBytes: null,
          memoryPercent: null,
          observedAt: OBSERVED_AT,
        },
      ],
    });
    const metricParams: Array<unknown> = paramsOf(metricQuery);

    /*
     * name is written at index 4 of the INSERT tuple, index 4 of the
     * metric tuple (which is offset by the two leading scope params).
     */
    expect(upsertParams[4]).toBe(CLAMPED_TO_LONG_TEXT);
    expect(metricParams[4]).toBe(CLAMPED_TO_LONG_TEXT);
  });
});

describe("KubernetesContainerService — oversized values can't drop the chunk", () => {
  function container(
    overrides: Partial<ParsedKubernetesContainer> = {},
  ): ParsedKubernetesContainer {
    return {
      podNamespaceKey: "default",
      podName: "api-7d9f8c6b5d-x2k9p",
      name: "app",
      image: "ghcr.io/acme/api:1.2.3",
      state: "running",
      reason: null,
      isReady: true,
      restartCount: 0,
      memoryLimitBytes: 1024,
      lastSeenAt: OBSERVED_AT,
      ...overrides,
    };
  }

  test("bulkUpsert clamps an oversized podName and keeps its sibling row", async () => {
    const query: jest.Mock = mockQueryRunner(KubernetesContainerService);

    await KubernetesContainerService.bulkUpsert({
      projectId: PROJECT_ID,
      kubernetesClusterId: PARENT_ID,
      containers: [container({ podName: OVERSIZED }), container()],
    });

    expect(query).toHaveBeenCalledTimes(1);
    const params: Array<unknown> = paramsOf(query);

    expect(params).toContain(CLAMPED_TO_LONG_TEXT);
    expect(params).not.toContain(OVERSIZED);
    expect(params).toContain("api-7d9f8c6b5d-x2k9p");
    expectNoParamExceedsLongText(params);
  });

  test("bulkUpsert clamps image at 500 and the ShortText columns at 100", async () => {
    const query: jest.Mock = mockQueryRunner(KubernetesContainerService);

    await KubernetesContainerService.bulkUpsert({
      projectId: PROJECT_ID,
      kubernetesClusterId: PARENT_ID,
      containers: [
        container({
          image: OVERSIZED,
          name: OVERSIZED,
          state: OVERSIZED,
          reason: OVERSIZED,
        }),
      ],
    });

    const params: Array<unknown> = paramsOf(query);

    expect(params).toContain(CLAMPED_TO_LONG_TEXT);
    expect(
      params.filter((value: unknown) => {
        return value === CLAMPED_TO_SHORT_TEXT;
      }),
    ).toHaveLength(3);
    expectNoParamExceedsLongText(params);
  });

  test("bulkUpdateLatestMetrics clamps identity the same way bulkUpsert does", async () => {
    const query: jest.Mock = mockQueryRunner(KubernetesContainerService);

    const metric: ContainerLatestMetric = {
      podNamespaceKey: "default",
      podName: OVERSIZED,
      name: "app",
      cpuPercent: 1,
      memoryBytes: 2,
      observedAt: OBSERVED_AT,
    };

    await KubernetesContainerService.bulkUpdateLatestMetrics({
      projectId: PROJECT_ID,
      kubernetesClusterId: PARENT_ID,
      metrics: [metric],
    });

    const params: Array<unknown> = paramsOf(query);
    expect(params).toContain(CLAMPED_TO_LONG_TEXT);
    expect(params).not.toContain(OVERSIZED);
  });
});

describe("DockerResourceService — oversized values can't drop the chunk", () => {
  function dockerContainer(
    overrides: Partial<ParsedDockerContainer> = {},
  ): ParsedDockerContainer {
    return {
      containerName: "api",
      containerId: "0123456789ab",
      imageName: "ghcr.io/acme/api:1.2.3",
      state: "running",
      cpuPercent: 5,
      memoryBytes: 1024,
      observedAt: OBSERVED_AT,
      ...overrides,
    };
  }

  function dockerResource(
    overrides: Partial<ParsedDockerResource> = {},
  ): ParsedDockerResource {
    return {
      kind: "Image",
      name: "ghcr.io/acme/api:1.2.3",
      containerId: null,
      imageName: null,
      state: null,
      labels: null,
      resourceCreationTimestamp: null,
      lastSeenAt: OBSERVED_AT,
      ...overrides,
    };
  }

  test("bulkUpsertContainers clamps an oversized image reference", async () => {
    const query: jest.Mock = mockQueryRunner(DockerResourceService);

    await DockerResourceService.bulkUpsertContainers({
      projectId: PROJECT_ID,
      dockerHostId: PARENT_ID,
      containers: [
        dockerContainer({ imageName: OVERSIZED }),
        dockerContainer(),
      ],
    });

    expect(query).toHaveBeenCalledTimes(1);
    const params: Array<unknown> = paramsOf(query);

    expect(params).toContain(CLAMPED_TO_LONG_TEXT);
    expect(params).not.toContain(OVERSIZED);
    expect(params).toContain("ghcr.io/acme/api:1.2.3");
    expectNoParamExceedsLongText(params);
  });

  test("bulkUpsert clamps an oversized name and keeps its sibling row", async () => {
    const query: jest.Mock = mockQueryRunner(DockerResourceService);

    await DockerResourceService.bulkUpsert({
      projectId: PROJECT_ID,
      dockerHostId: PARENT_ID,
      resources: [dockerResource({ name: OVERSIZED }), dockerResource()],
    });

    const params: Array<unknown> = paramsOf(query);
    expect(params).toContain(CLAMPED_TO_LONG_TEXT);
    expect(params).toContain("ghcr.io/acme/api:1.2.3");
    expectNoParamExceedsLongText(params);
  });
});

describe("PodmanResourceService — oversized values can't drop the chunk", () => {
  function podmanContainer(
    overrides: Partial<ParsedPodmanContainer> = {},
  ): ParsedPodmanContainer {
    return {
      containerName: "api",
      containerId: "0123456789ab",
      imageName: "ghcr.io/acme/api:1.2.3",
      state: "running",
      cpuPercent: 5,
      memoryBytes: 1024,
      observedAt: OBSERVED_AT,
      ...overrides,
    };
  }

  function podmanResource(
    overrides: Partial<ParsedPodmanResource> = {},
  ): ParsedPodmanResource {
    return {
      kind: "Image",
      name: "ghcr.io/acme/api:1.2.3",
      containerId: null,
      imageName: null,
      state: null,
      labels: null,
      resourceCreationTimestamp: null,
      lastSeenAt: OBSERVED_AT,
      ...overrides,
    };
  }

  test("bulkUpsertContainers clamps an oversized image reference", async () => {
    const query: jest.Mock = mockQueryRunner(PodmanResourceService);

    await PodmanResourceService.bulkUpsertContainers({
      projectId: PROJECT_ID,
      podmanHostId: PARENT_ID,
      containers: [
        podmanContainer({ imageName: OVERSIZED }),
        podmanContainer(),
      ],
    });

    expect(query).toHaveBeenCalledTimes(1);
    const params: Array<unknown> = paramsOf(query);

    expect(params).toContain(CLAMPED_TO_LONG_TEXT);
    expect(params).not.toContain(OVERSIZED);
    expect(params).toContain("ghcr.io/acme/api:1.2.3");
    expectNoParamExceedsLongText(params);
  });

  test("bulkUpsert clamps an oversized Repository:Tag name from `image ls`", async () => {
    const query: jest.Mock = mockQueryRunner(PodmanResourceService);

    await PodmanResourceService.bulkUpsert({
      projectId: PROJECT_ID,
      podmanHostId: PARENT_ID,
      resources: [podmanResource({ name: OVERSIZED }), podmanResource()],
    });

    const params: Array<unknown> = paramsOf(query);
    expect(params).toContain(CLAMPED_TO_LONG_TEXT);
    expect(params).toContain("ghcr.io/acme/api:1.2.3");
    expectNoParamExceedsLongText(params);
  });

  test("bulkUpsert clamps the ShortText columns at 100, not 500", async () => {
    const query: jest.Mock = mockQueryRunner(PodmanResourceService);

    await PodmanResourceService.bulkUpsert({
      projectId: PROJECT_ID,
      podmanHostId: PARENT_ID,
      resources: [
        podmanResource({
          kind: OVERSIZED,
          containerId: OVERSIZED,
          state: OVERSIZED,
        }),
      ],
    });

    const params: Array<unknown> = paramsOf(query);
    expect(
      params.filter((value: unknown) => {
        return value === CLAMPED_TO_SHORT_TEXT;
      }),
    ).toHaveLength(3);
  });
});

describe("DockerSwarmResourceService — oversized values can't drop the chunk", () => {
  function swarmResource(
    overrides: Partial<ParsedDockerSwarmResource> = {},
  ): ParsedDockerSwarmResource {
    return {
      kind: "Task",
      externalId: "task/abc123",
      name: "api.1",
      state: "running",
      role: null,
      serviceMode: null,
      desiredReplicas: null,
      runningReplicas: null,
      image: "ghcr.io/acme/api:1.2.3",
      stackName: "acme",
      serviceName: "api",
      nodeHostname: "swarm-1",
      driver: null,
      isReady: true,
      attributes: null,
      lastSeenAt: OBSERVED_AT,
      ...overrides,
    };
  }

  test("bulkUpsert clamps an oversized externalId and keeps its sibling row", async () => {
    const query: jest.Mock = mockQueryRunner(DockerSwarmResourceService);

    await DockerSwarmResourceService.bulkUpsert({
      projectId: PROJECT_ID,
      dockerSwarmClusterId: PARENT_ID,
      resources: [swarmResource({ externalId: OVERSIZED }), swarmResource()],
    });

    expect(query).toHaveBeenCalledTimes(1);
    const params: Array<unknown> = paramsOf(query);

    expect(params).toContain(CLAMPED_TO_SHORT_TEXT);
    expect(params).not.toContain(OVERSIZED);
    expect(params).toContain("task/abc123");
    expectNoParamExceedsLongText(params);
  });

  test("bulkUpsert clamps image at 500, since it is the one LongText column", async () => {
    const query: jest.Mock = mockQueryRunner(DockerSwarmResourceService);

    await DockerSwarmResourceService.bulkUpsert({
      projectId: PROJECT_ID,
      dockerSwarmClusterId: PARENT_ID,
      resources: [swarmResource({ image: OVERSIZED })],
    });

    const params: Array<unknown> = paramsOf(query);
    expect(params).toContain(CLAMPED_TO_LONG_TEXT);
    expect(params).not.toContain(CLAMPED_TO_SHORT_TEXT);
  });

  test("bulkUpdateLatestMetrics clamps identity the same way bulkUpsert does", async () => {
    const query: jest.Mock = mockQueryRunner(DockerSwarmResourceService);

    await DockerSwarmResourceService.bulkUpdateLatestMetrics({
      projectId: PROJECT_ID,
      dockerSwarmClusterId: PARENT_ID,
      metrics: [
        {
          kind: "Task",
          externalId: OVERSIZED,
          cpuPercent: null,
          memoryBytes: null,
          maxMemoryBytes: null,
          memoryPercent: null,
          observedAt: OBSERVED_AT,
        },
      ],
    });

    const params: Array<unknown> = paramsOf(query);
    expect(params).toContain(CLAMPED_TO_SHORT_TEXT);
    expect(params).not.toContain(OVERSIZED);
  });
});

describe("ProxmoxResourceService — oversized values can't drop the chunk", () => {
  function proxmoxResource(
    overrides: Partial<ParsedProxmoxResource> = {},
  ): ParsedProxmoxResource {
    return {
      kind: "Guest",
      externalId: "qemu/100",
      name: "web-01",
      vmid: 100,
      guestType: "qemu",
      parentNodeName: "pve1",
      isUp: true,
      haState: null,
      onboot: null,
      isBackedUp: null,
      uptimeSeconds: 3600,
      lastSeenAt: OBSERVED_AT,
      ...overrides,
    };
  }

  test("bulkUpsert clamps an oversized externalId and keeps its sibling row", async () => {
    const query: jest.Mock = mockQueryRunner(ProxmoxResourceService);

    await ProxmoxResourceService.bulkUpsert({
      projectId: PROJECT_ID,
      proxmoxClusterId: PARENT_ID,
      resources: [
        proxmoxResource({ externalId: OVERSIZED }),
        proxmoxResource(),
      ],
    });

    expect(query).toHaveBeenCalledTimes(1);
    const params: Array<unknown> = paramsOf(query);

    expect(params).toContain(CLAMPED_TO_SHORT_TEXT);
    expect(params).not.toContain(OVERSIZED);
    expect(params).toContain("qemu/100");
    expectNoParamExceedsLongText(params);
  });

  test("bulkUpdateLatestMetrics clamps identity the same way bulkUpsert does", async () => {
    const query: jest.Mock = mockQueryRunner(ProxmoxResourceService);

    await ProxmoxResourceService.bulkUpdateLatestMetrics({
      projectId: PROJECT_ID,
      proxmoxClusterId: PARENT_ID,
      metrics: [
        {
          kind: "Guest",
          externalId: OVERSIZED,
          cpuPercent: null,
          memoryBytes: null,
          maxMemoryBytes: null,
          memoryPercent: null,
          diskBytes: null,
          maxDiskBytes: null,
          observedAt: OBSERVED_AT,
        },
      ],
    });

    const params: Array<unknown> = paramsOf(query);
    expect(params).toContain(CLAMPED_TO_SHORT_TEXT);
    expect(params).not.toContain(OVERSIZED);
  });
});

describe("CephResourceService — oversized values can't drop the chunk", () => {
  function cephResource(
    overrides: Partial<ParsedCephResource> = {},
  ): ParsedCephResource {
    return {
      kind: "Osd",
      externalId: "osd.3",
      name: null,
      hostname: "ceph-node-1",
      daemonVersion: "ceph version 18.2.2 reef",
      deviceClass: "ssd",
      isUp: true,
      isIn: true,
      inQuorum: null,
      lastSeenAt: OBSERVED_AT,
      ...overrides,
    };
  }

  test("bulkUpsert clamps an oversized externalId and keeps its sibling row", async () => {
    const query: jest.Mock = mockQueryRunner(CephResourceService);

    await CephResourceService.bulkUpsert({
      projectId: PROJECT_ID,
      cephClusterId: PARENT_ID,
      resources: [cephResource({ externalId: OVERSIZED }), cephResource()],
    });

    expect(query).toHaveBeenCalledTimes(1);
    const params: Array<unknown> = paramsOf(query);

    expect(params).toContain(CLAMPED_TO_SHORT_TEXT);
    expect(params).not.toContain(OVERSIZED);
    expect(params).toContain("osd.3");
    expectNoParamExceedsLongText(params);
  });

  test("bulkUpsert leaves NULL identity columns alone", async () => {
    /*
     * CephResource.name is pool-only — clamping must not turn a
     * legitimate NULL into an empty string, or the COALESCE in the
     * upsert would stop protecting the last-known value.
     */
    const query: jest.Mock = mockQueryRunner(CephResourceService);

    await CephResourceService.bulkUpsert({
      projectId: PROJECT_ID,
      cephClusterId: PARENT_ID,
      resources: [cephResource()],
    });

    const params: Array<unknown> = paramsOf(query);
    expect(params[4]).toBeNull();
  });

  test("bulkUpdateLatestMetrics clamps identity the same way bulkUpsert does", async () => {
    const query: jest.Mock = mockQueryRunner(CephResourceService);

    await CephResourceService.bulkUpdateLatestMetrics({
      projectId: PROJECT_ID,
      cephClusterId: PARENT_ID,
      metrics: [
        {
          kind: "Osd",
          externalId: OVERSIZED,
          statBytes: null,
          statBytesUsed: null,
          applyLatencyMs: null,
          commitLatencyMs: null,
          pgCount: null,
          storedBytes: null,
          maxAvailBytes: null,
          objects: null,
          readOpsCounter: null,
          writeOpsCounter: null,
          observedAt: OBSERVED_AT,
        },
      ],
    });

    const params: Array<unknown> = paramsOf(query);
    expect(params).toContain(CLAMPED_TO_SHORT_TEXT);
    expect(params).not.toContain(OVERSIZED);
  });
});

describe("a full 500-row chunk survives one oversized row", () => {
  test("every row still rides in the single statement", async () => {
    const query: jest.Mock = mockQueryRunner(KubernetesContainerService);

    const containers: Array<ParsedKubernetesContainer> = [];
    for (let i: number = 0; i < 500; i++) {
      containers.push({
        podNamespaceKey: "default",
        podName: i === 0 ? OVERSIZED : `api-7d9f8c6b5d-${i}`,
        name: "app",
        image: "ghcr.io/acme/api:1.2.3",
        state: "running",
        reason: null,
        isReady: true,
        restartCount: 0,
        memoryLimitBytes: null,
        lastSeenAt: OBSERVED_AT,
      });
    }

    await KubernetesContainerService.bulkUpsert({
      projectId: PROJECT_ID,
      kubernetesClusterId: PARENT_ID,
      containers,
    });

    // One chunk, 13 columns per row — nothing dropped by the clamp.
    expect(query).toHaveBeenCalledTimes(1);
    const params: Array<unknown> = paramsOf(query);
    expect(params).toHaveLength(500 * 13);
    expect(params).toContain(CLAMPED_TO_LONG_TEXT);
    expect(params).toContain("api-7d9f8c6b5d-499");
    expectNoParamExceedsLongText(params);
  });

  test("an oversized row in a later chunk doesn't disturb the earlier one", async () => {
    const query: jest.Mock = mockQueryRunner(KubernetesContainerService);

    const containers: Array<ParsedKubernetesContainer> = [];
    for (let i: number = 0; i < 501; i++) {
      containers.push({
        podNamespaceKey: "default",
        podName: i === 500 ? OVERSIZED : `api-7d9f8c6b5d-${i}`,
        name: "app",
        image: "ghcr.io/acme/api:1.2.3",
        state: "running",
        reason: null,
        isReady: true,
        restartCount: 0,
        memoryLimitBytes: null,
        lastSeenAt: OBSERVED_AT,
      });
    }

    await KubernetesContainerService.bulkUpsert({
      projectId: PROJECT_ID,
      kubernetesClusterId: PARENT_ID,
      containers,
    });

    expect(query).toHaveBeenCalledTimes(2);
    expect(paramsOf(query, 0)).toHaveLength(500 * 13);
    expect(paramsOf(query, 1)).toHaveLength(13);
    expect(paramsOf(query, 0)).not.toContain(CLAMPED_TO_LONG_TEXT);
    expect(paramsOf(query, 1)).toContain(CLAMPED_TO_LONG_TEXT);
  });
});

describe("values that already fit are never touched", () => {
  /*
   * The other half of the contract. A clamp that fires one character
   * early would silently corrupt legitimate inventory names — and
   * because the clamped columns are conflict targets, a corrupted name
   * mints a duplicate row rather than updating the real one.
   */
  const AT_SHORT_TEXT_BOUND: string = "s".repeat(ColumnLength.ShortText);
  const AT_LONG_TEXT_BOUND: string = "l".repeat(ColumnLength.LongText);
  const KUBERNETES_LONGEST_NAME: string = "k".repeat(253);

  test("KubernetesResource keeps a name sitting exactly on the 500 bound", async () => {
    const query: jest.Mock = mockQueryRunner(KubernetesResourceService);

    await KubernetesResourceService.bulkUpsert({
      projectId: PROJECT_ID,
      kubernetesClusterId: PARENT_ID,
      resources: [
        {
          kind: AT_SHORT_TEXT_BOUND,
          namespaceKey: "default",
          name: AT_LONG_TEXT_BOUND,
          uid: null,
          phase: "Running",
          isReady: true,
          hasMemoryPressure: null,
          hasDiskPressure: null,
          hasPidPressure: null,
          labels: null,
          annotations: null,
          ownerReferences: null,
          spec: null,
          containerCount: null,
          status: null,
          lastSeenAt: OBSERVED_AT,
          resourceCreationTimestamp: null,
        },
      ],
    });

    const params: Array<unknown> = paramsOf(query);
    expect(params[2]).toBe(AT_SHORT_TEXT_BOUND);
    expect(params[4]).toBe(AT_LONG_TEXT_BOUND);
  });

  test("KubernetesContainer keeps the longest name Kubernetes can produce", async () => {
    const query: jest.Mock = mockQueryRunner(KubernetesContainerService);

    await KubernetesContainerService.bulkUpsert({
      projectId: PROJECT_ID,
      kubernetesClusterId: PARENT_ID,
      containers: [
        {
          podNamespaceKey: "default",
          podName: KUBERNETES_LONGEST_NAME,
          name: "app",
          image: "ghcr.io/acme/api:1.2.3",
          state: "running",
          reason: null,
          isReady: true,
          restartCount: 0,
          memoryLimitBytes: null,
          lastSeenAt: OBSERVED_AT,
        },
      ],
    });

    // The whole point of the widening: 253 chars must survive intact.
    expect(paramsOf(query)[3]).toBe(KUBERNETES_LONGEST_NAME);
  });

  test("PodmanResource keeps a long-but-legal image reference intact", async () => {
    const query: jest.Mock = mockQueryRunner(PodmanResourceService);
    const imageReference: string = `ghcr.io/${"o".repeat(60)}/${"r".repeat(
      60,
    )}:${"t".repeat(60)}`;

    await PodmanResourceService.bulkUpsert({
      projectId: PROJECT_ID,
      podmanHostId: PARENT_ID,
      resources: [
        {
          kind: "Image",
          name: imageReference,
          containerId: null,
          imageName: null,
          state: null,
          labels: null,
          resourceCreationTimestamp: null,
          lastSeenAt: OBSERVED_AT,
        },
      ],
    });

    expect(imageReference.length).toBeGreaterThan(ColumnLength.ShortText);
    expect(paramsOf(query)[3]).toBe(imageReference);
  });

  test("CephResource keeps every identity value that already fits", async () => {
    const query: jest.Mock = mockQueryRunner(CephResourceService);

    await CephResourceService.bulkUpsert({
      projectId: PROJECT_ID,
      cephClusterId: PARENT_ID,
      resources: [
        {
          kind: "Osd",
          externalId: "osd.3",
          name: null,
          hostname: "ceph-node-1",
          daemonVersion: "ceph version 18.2.2 reef",
          deviceClass: "ssd",
          isUp: true,
          isIn: true,
          inQuorum: null,
          lastSeenAt: OBSERVED_AT,
        },
      ],
    });

    expect(paramsOf(query)).toEqual([
      PROJECT_ID.toString(),
      PARENT_ID.toString(),
      "Osd",
      "osd.3",
      null,
      "ceph-node-1",
      "ceph version 18.2.2 reef",
      "ssd",
      true,
      true,
      null,
      OBSERVED_AT,
      0,
    ]);
  });
});

describe("NULL stays NULL through the clamp", () => {
  /*
   * Every one of these upserts COALESCEs against the existing row, so a
   * NULL means "this batch didn't carry the field, keep what's stored."
   * A clamp that coerced NULL to "" would blank real data on every
   * partial scrape.
   */
  test("DockerSwarmResource passes its nullable identity columns through as null", async () => {
    const query: jest.Mock = mockQueryRunner(DockerSwarmResourceService);

    await DockerSwarmResourceService.bulkUpsert({
      projectId: PROJECT_ID,
      dockerSwarmClusterId: PARENT_ID,
      resources: [
        {
          kind: "Network",
          externalId: "network/abc",
          name: null,
          state: null,
          role: null,
          serviceMode: null,
          desiredReplicas: null,
          runningReplicas: null,
          image: null,
          stackName: null,
          serviceName: null,
          nodeHostname: null,
          driver: null,
          isReady: null,
          attributes: null,
          lastSeenAt: OBSERVED_AT,
        },
      ],
    });

    const params: Array<unknown> = paramsOf(query);
    for (const index of [4, 5, 6, 7, 10, 11, 12, 13, 14]) {
      expect(params[index]).toBeNull();
    }
    expect(params).not.toContain("");
  });

  test("ProxmoxResource passes its nullable identity columns through as null", async () => {
    const query: jest.Mock = mockQueryRunner(ProxmoxResourceService);

    await ProxmoxResourceService.bulkUpsert({
      projectId: PROJECT_ID,
      proxmoxClusterId: PARENT_ID,
      resources: [
        {
          kind: "Node",
          externalId: "node/pve1",
          name: null,
          vmid: null,
          guestType: null,
          parentNodeName: null,
          isUp: true,
          haState: null,
          onboot: null,
          isBackedUp: null,
          uptimeSeconds: null,
          lastSeenAt: OBSERVED_AT,
        },
      ],
    });

    const params: Array<unknown> = paramsOf(query);
    for (const index of [4, 6, 7, 9]) {
      expect(params[index]).toBeNull();
    }
  });

  test("PodmanResource keeps a null imageName null rather than empty", async () => {
    const query: jest.Mock = mockQueryRunner(PodmanResourceService);

    await PodmanResourceService.bulkUpsertContainers({
      projectId: PROJECT_ID,
      podmanHostId: PARENT_ID,
      containers: [
        {
          containerName: "api",
          containerId: null,
          imageName: null,
          state: "running",
          cpuPercent: null,
          memoryBytes: null,
          observedAt: OBSERVED_AT,
        },
      ],
    });

    const params: Array<unknown> = paramsOf(query);
    expect(params[4]).toBeNull();
    expect(params[5]).toBeNull();
  });
});

describe("the clamp announces itself", () => {
  /*
   * Truncation is data loss, however small. It has to be visible in the
   * logs or an operator debugging a "missing container" has nothing to
   * go on.
   */
  test("warns once per offending row, naming the parent resource", async () => {
    const warn: jest.SpyInstance = jest
      .spyOn(logger, "warn")
      .mockImplementation(() => {});
    mockQueryRunner(PodmanResourceService);

    await PodmanResourceService.bulkUpsert({
      projectId: PROJECT_ID,
      podmanHostId: PARENT_ID,
      resources: [
        {
          kind: "Image",
          name: OVERSIZED,
          containerId: null,
          imageName: null,
          state: null,
          labels: null,
          resourceCreationTimestamp: null,
          lastSeenAt: OBSERVED_AT,
        },
      ],
    });

    expect(warn).toHaveBeenCalledTimes(1);
    const message: string = String(warn.mock.calls[0]?.[0]);
    expect(message).toContain("PodmanResource name exceeds");
    expect(message).toContain(String(ColumnLength.LongText));
    expect(message).toContain(PARENT_ID.toString());
  });

  test("stays quiet for a batch that needs no clamping", async () => {
    const warn: jest.SpyInstance = jest
      .spyOn(logger, "warn")
      .mockImplementation(() => {});
    mockQueryRunner(KubernetesResourceService);

    await KubernetesResourceService.bulkUpsert({
      projectId: PROJECT_ID,
      kubernetesClusterId: PARENT_ID,
      resources: [
        {
          kind: "Pod",
          namespaceKey: "default",
          name: "api-7d9f8c6b5d-x2k9p",
          uid: null,
          phase: "Running",
          isReady: true,
          hasMemoryPressure: null,
          hasDiskPressure: null,
          hasPidPressure: null,
          labels: null,
          annotations: null,
          ownerReferences: null,
          spec: null,
          containerCount: null,
          status: null,
          lastSeenAt: OBSERVED_AT,
          resourceCreationTimestamp: null,
        },
      ],
    });

    expect(warn).not.toHaveBeenCalled();
  });

  test("warns per offending row, not once for the whole batch", async () => {
    const warn: jest.SpyInstance = jest
      .spyOn(logger, "warn")
      .mockImplementation(() => {});
    mockQueryRunner(CephResourceService);

    await CephResourceService.bulkUpsert({
      projectId: PROJECT_ID,
      cephClusterId: PARENT_ID,
      /*
       * The two ids must differ WITHIN the clamp bound, or they collapse
       * onto the same ON CONFLICT target and the statement Postgres gets
       * is one the clamp itself made unusable — not what this test is
       * about, and a misleading fixture to leave lying around.
       */
      resources: [
        {
          kind: "Osd",
          externalId: `a${OVERSIZED}`,
          name: null,
          hostname: null,
          daemonVersion: null,
          deviceClass: null,
          isUp: true,
          isIn: true,
          inQuorum: null,
          lastSeenAt: OBSERVED_AT,
        },
        {
          kind: "Osd",
          externalId: `b${OVERSIZED}`,
          name: null,
          hostname: null,
          daemonVersion: null,
          deviceClass: null,
          isUp: true,
          isIn: true,
          inQuorum: null,
          lastSeenAt: OBSERVED_AT,
        },
      ],
    });

    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe("an empty batch still short-circuits", () => {
  /*
   * The sanitizing map runs before the chunk loop, so the early return
   * has to stay ahead of it — an empty batch must not reach Postgres.
   */
  test.each([
    [
      "KubernetesResourceService.bulkUpsert",
      KubernetesResourceService,
      async (): Promise<void> => {
        await KubernetesResourceService.bulkUpsert({
          projectId: PROJECT_ID,
          kubernetesClusterId: PARENT_ID,
          resources: [],
        });
      },
    ],
    [
      "KubernetesContainerService.bulkUpsert",
      KubernetesContainerService,
      async (): Promise<void> => {
        await KubernetesContainerService.bulkUpsert({
          projectId: PROJECT_ID,
          kubernetesClusterId: PARENT_ID,
          containers: [],
        });
      },
    ],
    [
      "DockerResourceService.bulkUpsertContainers",
      DockerResourceService,
      async (): Promise<void> => {
        await DockerResourceService.bulkUpsertContainers({
          projectId: PROJECT_ID,
          dockerHostId: PARENT_ID,
          containers: [],
        });
      },
    ],
    [
      "PodmanResourceService.bulkUpsert",
      PodmanResourceService,
      async (): Promise<void> => {
        await PodmanResourceService.bulkUpsert({
          projectId: PROJECT_ID,
          podmanHostId: PARENT_ID,
          resources: [],
        });
      },
    ],
    [
      "DockerSwarmResourceService.bulkUpsert",
      DockerSwarmResourceService,
      async (): Promise<void> => {
        await DockerSwarmResourceService.bulkUpsert({
          projectId: PROJECT_ID,
          dockerSwarmClusterId: PARENT_ID,
          resources: [],
        });
      },
    ],
    [
      "ProxmoxResourceService.bulkUpsert",
      ProxmoxResourceService,
      async (): Promise<void> => {
        await ProxmoxResourceService.bulkUpsert({
          projectId: PROJECT_ID,
          proxmoxClusterId: PARENT_ID,
          resources: [],
        });
      },
    ],
    [
      "CephResourceService.bulkUpsert",
      CephResourceService,
      async (): Promise<void> => {
        await CephResourceService.bulkUpsert({
          projectId: PROJECT_ID,
          cephClusterId: PARENT_ID,
          resources: [],
        });
      },
    ],
  ])(
    "%s issues no statement",
    async (
      _label: string,
      service: RepositoryHolder,
      invoke: () => Promise<void>,
    ) => {
      const query: jest.Mock = mockQueryRunner(service);
      await invoke();
      expect(query).not.toHaveBeenCalled();
    },
  );
});
