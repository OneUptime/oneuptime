/*
 * The Queue infrastructure module pulls in BullMQ (ESM-only msgpackr) at
 * import time via the services' queue imports; nothing queue-related is
 * under test here, so the module is replaced — same idiom as
 * OtelIngestMaintenanceFenceRelease.test.ts in this directory.
 */
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: {
      addJob: jest.fn(),
    },
    QueueName: {
      Workflow: "Workflow",
      Worker: "Worker",
      Telemetry: "Telemetry",
      Runbook: "Runbook",
    },
  };
});

/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it (DatabaseService, the base class
 * of every concrete service, imports it). Nothing password-related is under
 * test here, so the module is replaced WITH A FACTORY — an automock would
 * still require (and type-check) the real file.
 */
jest.mock("Common/Server/Utils/PasswordHash", () => {
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

import OtelIngestBaseService from "../../FeatureSet/Telemetry/Services/OtelIngestBaseService";
import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import CloudResourceService from "Common/Server/Services/CloudResourceService";
import CloudResourceInstanceService from "Common/Server/Services/CloudResourceInstanceService";
import HostService from "Common/Server/Services/HostService";
import LabelService from "Common/Server/Services/LabelService";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import ObjectID from "Common/Types/ObjectID";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import {
  FAAS_CLOUD_PLATFORM_VALUES,
  MANAGED_CLOUD_PLATFORMS,
  ManagedCloudPlatform,
  ManagedCloudPlatformDescriptor,
} from "Common/Types/Cloud/CloudPlatform";
/*
 * `jest` is deliberately taken from the ambient global rather than from
 * "@jest/globals" — see OtelIngestMaintenanceFenceRelease.test.ts for why
 * the two spell a spy type differently.
 */
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * autoDiscoverCloudResource turns one OTLP resource into one Cloud
 * Environment row (platform + account + region) plus, when the resource
 * names one, an instance row. This suite pins the contract every other
 * part of the product leans on:
 *
 *   - the GATE is the shared registry: every managed platform is accepted,
 *     FaaS / raw VM / unknown / missing platforms are refused before any
 *     cache or database call is made;
 *   - the KEY and NAME are exactly what the dashboard create form derives,
 *     so a hand-created environment is found rather than duplicated;
 *   - the INSTANCE identity walks the shared fallback chain (an ECS task
 *     ARN is shortened to its task id, Cloud Run uses faas.instance, the
 *     platform's id beats an SDK-minted service.instance.id), and the
 *     live-inventory fence is
 *     keyed on the resolved name;
 *   - the entity-id cache short-circuits find-or-create.
 *
 * All Postgres / Redis access is mocked; the attribute walk runs for real.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const RESOURCE_ID: string = "44444444-4444-4444-8444-444444444444";

const ENTITY_ID_NAMESPACE: string = "cloud-resource-id";
const FENCE_NAMESPACE: string = "otel-maintenance-fence";

const TASK_ARN: string =
  "arn:aws:ecs:us-east-1:123456789012:task/my-cluster/1a2b3c4d5e6f7a8b9c0d";
const TASK_ID: string = "1a2b3c4d5e6f7a8b9c0d";

/* eslint-disable @typescript-eslint/no-explicit-any */
const baseService: Record<string, any> =
  OtelIngestBaseService as unknown as Record<string, any>;
/* eslint-enable @typescript-eslint/no-explicit-any */

function stringAttribute(key: string, value: string): JSONObject {
  return { key: key, value: { stringValue: value } };
}

function attributes(values: Record<string, string>): JSONArray {
  return Object.entries(values).map(
    ([key, value]: [string, string]): JSONObject => {
      return stringAttribute(key, value);
    },
  );
}

/* A fully-described ECS environment, the common case. */
const ECS_ATTRIBUTES: Record<string, string> = {
  "cloud.platform": "aws_ecs",
  "cloud.provider": "aws",
  "cloud.region": "us-east-1",
  "cloud.account.id": "123456789012",
  "service.name": "checkout",
};

let cachedEntityIds: Map<string, string>;
let heldFences: Set<string>;
let findOrCreate: jest.SpiedFunction<
  typeof CloudResourceService.findOrCreateByResourceIdentifier
>;
let updateLastSeen: jest.SpiedFunction<
  typeof CloudResourceService.updateLastSeen
>;
let recordInstance: jest.SpiedFunction<
  typeof CloudResourceInstanceService.recordInstance
>;
let getString: jest.SpiedFunction<typeof GlobalCache.getString>;
let setString: jest.SpiedFunction<typeof GlobalCache.setString>;
let setStringIfNotExists: jest.SpiedFunction<
  typeof GlobalCache.setStringIfNotExists
>;

async function discover(values: Record<string, string>): Promise<unknown> {
  return baseService["autoDiscoverCloudResource"]({
    projectId: PROJECT_ID,
    attributes: attributes(values),
  });
}

beforeEach(() => {
  cachedEntityIds = new Map<string, string>();
  heldFences = new Set<string>();

  /*
   * The base service memoizes resolved entity ids and fence refusals
   * in-process. Every test reuses RESOURCE_ID, so simulate those memos'
   * TTLs expiring between cases exactly as the fake Redis maps are reset.
   */
  OtelIngestBaseService.clearInProcessMemos();

  getString = jest
    .spyOn(GlobalCache, "getString")
    .mockImplementation(async (namespace: string, key: string) => {
      if (namespace === ENTITY_ID_NAMESPACE) {
        return cachedEntityIds.get(key) || null;
      }
      return null;
    });
  setString = jest
    .spyOn(GlobalCache, "setString")
    .mockImplementation(
      async (namespace: string, key: string, value: string) => {
        if (namespace === ENTITY_ID_NAMESPACE) {
          cachedEntityIds.set(key, value);
        }
      },
    );
  /*
   * Fences are a single atomic SET NX: the claim succeeds only when the key
   * is absent. Modelled faithfully so a test can hold a fence and watch the
   * gated work get skipped.
   */
  setStringIfNotExists = jest
    .spyOn(GlobalCache, "setStringIfNotExists")
    .mockImplementation(async (namespace: string, key: string) => {
      if (namespace !== FENCE_NAMESPACE) {
        return true;
      }
      if (heldFences.has(key)) {
        return false;
      }
      heldFences.add(key);
      return true;
    });
  jest.spyOn(GlobalCache, "deleteKey").mockResolvedValue(undefined);

  const created: CloudResource = new CloudResource();
  created._id = RESOURCE_ID;
  findOrCreate = jest
    .spyOn(CloudResourceService, "findOrCreateByResourceIdentifier")
    .mockResolvedValue(created);
  updateLastSeen = jest
    .spyOn(CloudResourceService, "updateLastSeen")
    .mockResolvedValue(undefined);
  recordInstance = jest
    .spyOn(CloudResourceInstanceService, "recordInstance")
    .mockResolvedValue(undefined);

  // Label promotion is not what is under test.
  jest.spyOn(LabelService, "findOrCreateLabelsByNames").mockResolvedValue([]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("autoDiscoverCloudResource gate", () => {
  test.each<[string, Record<string, string>]>([
    ["a FaaS platform", { "cloud.platform": "aws_lambda" }],
    ["a raw VM platform (stays a Host)", { "cloud.platform": "aws_ec2" }],
    [
      "a Kubernetes platform (routes via k8s.*)",
      { "cloud.platform": "aws_eks" },
    ],
    ["an unknown platform", { "cloud.platform": "hetzner_cloud" }],
    ["a blank platform", { "cloud.platform": "   " }],
    [
      "a missing platform",
      { "cloud.region": "us-east-1", "cloud.account.id": "123456789012" },
    ],
    ["no attributes at all", {}],
  ])(
    "refuses %s and calls nothing",
    async (_label: string, values: Record<string, string>) => {
      await expect(discover(values)).resolves.toBeNull();

      expect(findOrCreate).not.toHaveBeenCalled();
      expect(updateLastSeen).not.toHaveBeenCalled();
      expect(recordInstance).not.toHaveBeenCalled();
      expect(getString).not.toHaveBeenCalled();
      expect(setStringIfNotExists).not.toHaveBeenCalled();
    },
  );

  test("refuses every FaaS platform — those belong to Serverless Functions", async () => {
    for (const platform of FAAS_CLOUD_PLATFORM_VALUES) {
      await expect(
        discover({ ...ECS_ATTRIBUTES, "cloud.platform": platform }),
      ).resolves.toBeNull();
    }
    expect(findOrCreate).not.toHaveBeenCalled();
    expect(getString).not.toHaveBeenCalled();
  });

  test("the platform value is matched exactly, not case-folded", async () => {
    await expect(
      discover({ ...ECS_ATTRIBUTES, "cloud.platform": "AWS_ECS" }),
    ).resolves.toBeNull();
    expect(findOrCreate).not.toHaveBeenCalled();
  });

  test.each(MANAGED_CLOUD_PLATFORMS)(
    "accepts $platform and names the environment after its label",
    async (descriptor: ManagedCloudPlatformDescriptor) => {
      const result: unknown = await discover({
        "cloud.platform": descriptor.platform,
        "service.name": "checkout",
      });

      expect(result).toBeInstanceOf(ObjectID);
      expect((result as ObjectID).toString()).toBe(RESOURCE_ID);
      expect(findOrCreate).toHaveBeenCalledTimes(1);
      expect(findOrCreate).toHaveBeenCalledWith({
        projectId: PROJECT_ID,
        resourceIdentifier: `${descriptor.platform}||`,
        name: descriptor.label,
        cloudPlatform: descriptor.platform,
        /*
         * No cloud.provider attribute was sent, so the provider comes from
         * the registry — a hand-written OTEL_RESOURCE_ATTRIBUTES often
         * carries only the platform.
         */
        cloudProvider: descriptor.provider,
        cloudRegion: undefined,
        cloudAccountId: undefined,
      });
    },
  );
});

describe("autoDiscoverCloudResource environment key and name", () => {
  test("mints the composite key and the display name the create form derives", async () => {
    await discover(ECS_ATTRIBUTES);

    expect(findOrCreate).toHaveBeenCalledTimes(1);
    expect(findOrCreate).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      resourceIdentifier: "aws_ecs|123456789012|us-east-1",
      name: "AWS ECS · us-east-1 · 123456789012",
      cloudPlatform: "aws_ecs",
      cloudProvider: "aws",
      cloudRegion: "us-east-1",
      cloudAccountId: "123456789012",
    });
  });

  test("keeps empty key segments when account and region are absent", async () => {
    await discover({ "cloud.platform": "aws_ecs", "service.name": "checkout" });

    expect(findOrCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceIdentifier: "aws_ecs||",
        name: "AWS ECS",
      }),
    );
  });

  test("keeps the empty account segment when only the region is known", async () => {
    await discover({
      "cloud.platform": "aws_ecs",
      "cloud.region": "us-east-1",
    });

    expect(findOrCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceIdentifier: "aws_ecs||us-east-1",
        name: "AWS ECS · us-east-1",
        cloudRegion: "us-east-1",
        cloudAccountId: undefined,
      }),
    );
  });

  test("keeps the empty region segment when only the account is known", async () => {
    await discover({
      "cloud.platform": "gcp_cloud_run",
      "cloud.account.id": "my-gcp-project",
    });

    expect(findOrCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceIdentifier: "gcp_cloud_run|my-gcp-project|",
        name: "GCP Cloud Run · my-gcp-project",
        cloudProvider: "gcp",
        cloudRegion: undefined,
        cloudAccountId: "my-gcp-project",
      }),
    );
  });

  test("a cloud.provider the collector sent is passed through untouched", async () => {
    await discover({
      ...ECS_ATTRIBUTES,
      "cloud.provider": "aws-govcloud",
    });

    expect(findOrCreate).toHaveBeenCalledWith(
      expect.objectContaining({ cloudProvider: "aws-govcloud" }),
    );
  });

  test("the heartbeat carries the same platform / provider / region / account", async () => {
    await discover(ECS_ATTRIBUTES);

    expect(updateLastSeen).toHaveBeenCalledTimes(1);
    const [id, extra]: [ObjectID, unknown] = updateLastSeen.mock.calls[0]! as [
      ObjectID,
      unknown,
    ];
    expect(id.toString()).toBe(RESOURCE_ID);
    expect(extra).toEqual({
      cloudPlatform: "aws_ecs",
      cloudProvider: "aws",
      cloudRegion: "us-east-1",
      cloudAccountId: "123456789012",
    });
  });

  test("caches the resolved id under the project-scoped environment key", async () => {
    await discover(ECS_ATTRIBUTES);

    expect(setString).toHaveBeenCalledWith(
      ENTITY_ID_NAMESPACE,
      `${PROJECT_ID.toString()}:aws_ecs|123456789012|us-east-1`,
      RESOURCE_ID,
      expect.objectContaining({ expiresInSeconds: expect.any(Number) }),
    );
  });

  test("two services on one environment resolve to one row", async () => {
    await discover({ ...ECS_ATTRIBUTES, "service.name": "checkout" });
    await discover({ ...ECS_ATTRIBUTES, "service.name": "payments" });

    /*
     * The second batch hits the id cache the first one populated — the
     * environment is the identity, not the service.
     */
    expect(findOrCreate).toHaveBeenCalledTimes(1);
    expect(findOrCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceIdentifier: "aws_ecs|123456789012|us-east-1",
      }),
    );
  });
});

describe("autoDiscoverCloudResource instance identity", () => {
  test("with only aws.ecs.task.arn present, records the shortened task id", async () => {
    await discover({ ...ECS_ATTRIBUTES, "aws.ecs.task.arn": TASK_ARN });

    expect(recordInstance).toHaveBeenCalledTimes(1);
    const [call]: [unknown] = recordInstance.mock.calls[0]! as [unknown];
    expect(call).toEqual({
      projectId: PROJECT_ID,
      cloudResourceId: expect.any(ObjectID),
      instanceName: TASK_ID,
    });
    expect(
      (call as { cloudResourceId: ObjectID }).cloudResourceId.toString(),
    ).toBe(RESOURCE_ID);
  });

  test("aws.ecs.task.id is preferred over the ARN when both are present", async () => {
    await discover({
      ...ECS_ATTRIBUTES,
      "aws.ecs.task.id": "explicit-task-id",
      "aws.ecs.task.arn": TASK_ARN,
    });

    expect(recordInstance).toHaveBeenCalledWith(
      expect.objectContaining({ instanceName: "explicit-task-id" }),
    );
  });

  test("on gcp_cloud_run, faas.instance identifies the instance", async () => {
    await discover({
      "cloud.platform": "gcp_cloud_run",
      "cloud.provider": "gcp",
      "cloud.region": "europe-west1",
      "cloud.account.id": "my-gcp-project",
      "faas.instance": "00bf4bf02d4b1b7e2c0e5f7d6e0a3d5b",
      "faas.name": "checkout",
    });

    expect(recordInstance).toHaveBeenCalledTimes(1);
    expect(recordInstance).toHaveBeenCalledWith(
      expect.objectContaining({
        instanceName: "00bf4bf02d4b1b7e2c0e5f7d6e0a3d5b",
      }),
    );
  });

  test("the ECS task id wins over an SDK-minted service.instance.id, so app spans and sidecar metrics share one row", async () => {
    await discover({
      ...ECS_ATTRIBUTES,
      "service.instance.id": "sdk-instance-7",
      "aws.ecs.task.arn": TASK_ARN,
    });

    expect(recordInstance).toHaveBeenCalledTimes(1);
    expect(recordInstance).toHaveBeenCalledWith(
      expect.objectContaining({ instanceName: TASK_ID }),
    );
  });

  test("service.instance.id is the identity when the platform sets none of its own", async () => {
    await discover({
      "cloud.platform": "aws_app_runner",
      "cloud.region": "us-east-1",
      "service.instance.id": "sdk-instance-7",
      "host.name": "ip-10-0-0-7",
    });

    expect(recordInstance).toHaveBeenCalledWith(
      expect.objectContaining({ instanceName: "sdk-instance-7" }),
    );
  });

  test("falls all the way back to host.name on platforms with no detector", async () => {
    await discover({
      "cloud.platform": "azure_container_apps",
      "cloud.region": "westeurope",
      "host.name": "checkout--rev1-abc12--replica-0",
    });

    expect(recordInstance).toHaveBeenCalledWith(
      expect.objectContaining({
        instanceName: "checkout--rev1-abc12--replica-0",
      }),
    );
  });

  test("with no identity attribute at all, no instance is recorded but the environment still resolves", async () => {
    const result: unknown = await discover(ECS_ATTRIBUTES);

    expect((result as ObjectID).toString()).toBe(RESOURCE_ID);
    expect(updateLastSeen).toHaveBeenCalledTimes(1);
    expect(recordInstance).not.toHaveBeenCalled();
    /*
     * And no live-inventory fence was claimed for a nameless instance —
     * only the environment's own maintenance fence.
     */
    expect([...heldFences]).toEqual([`cloud-resource:${RESOURCE_ID}`]);
  });

  test("the live-inventory fence is keyed on the RESOLVED name, not the raw ARN", async () => {
    await discover({ ...ECS_ATTRIBUTES, "aws.ecs.task.arn": TASK_ARN });

    expect(
      heldFences.has(`cloud-resource-instance:${RESOURCE_ID}:${TASK_ID}`),
    ).toBe(true);
    expect(
      heldFences.has(`cloud-resource-instance:${RESOURCE_ID}:${TASK_ARN}`),
    ).toBe(false);
  });

  test("a held live-inventory fence skips the instance write for this window", async () => {
    heldFences.add(`cloud-resource-instance:${RESOURCE_ID}:${TASK_ID}`);

    await discover({ ...ECS_ATTRIBUTES, "aws.ecs.task.arn": TASK_ARN });

    expect(recordInstance).not.toHaveBeenCalled();
    // The environment's own maintenance is fenced independently.
    expect(updateLastSeen).toHaveBeenCalledTimes(1);
  });
});

describe("autoDiscoverCloudResource entity-id cache", () => {
  test("a cached id short-circuits find-or-create", async () => {
    cachedEntityIds.set(
      `${PROJECT_ID.toString()}:aws_ecs|123456789012|us-east-1`,
      RESOURCE_ID,
    );

    const result: unknown = await discover(ECS_ATTRIBUTES);

    expect((result as ObjectID).toString()).toBe(RESOURCE_ID);
    expect(findOrCreate).not.toHaveBeenCalled();
    expect(setString).not.toHaveBeenCalled();
    // Maintenance is gated by its own fence, not by the id cache.
    expect(updateLastSeen).toHaveBeenCalledTimes(1);
  });

  test("a cache miss runs find-or-create exactly once and then serves from the cache", async () => {
    await discover(ECS_ATTRIBUTES);
    await discover(ECS_ATTRIBUTES);
    await discover(ECS_ATTRIBUTES);

    expect(findOrCreate).toHaveBeenCalledTimes(1);
  });

  test("a held maintenance fence skips the heartbeat but still returns the id", async () => {
    heldFences.add(`cloud-resource:${RESOURCE_ID}`);

    const result: unknown = await discover(ECS_ATTRIBUTES);

    expect((result as ObjectID).toString()).toBe(RESOURCE_ID);
    expect(updateLastSeen).not.toHaveBeenCalled();
  });

  test("a failing find-or-create is swallowed — one bad batch must not break ingest", async () => {
    findOrCreate.mockRejectedValue(new Error("Postgres said no"));

    await expect(discover(ECS_ATTRIBUTES)).resolves.toBeNull();
  });
});

describe("autoDiscoverHost on managed cloud platforms", () => {
  /*
   * A managed-compute task still carries host.name (the container
   * hostname) and, with the system detector, os.type. Those would satisfy
   * the Host gate; the cloud.platform check must refuse them so an ECS
   * environment does not also spawn one phantom Host per task.
   */
  const HOST_ATTRIBUTES: Record<string, string> = {
    "host.name": "ip-10-0-1-23.ec2.internal",
    "os.type": "linux",
  };

  async function discoverHost(
    values: Record<string, string>,
  ): Promise<unknown> {
    return baseService["autoDiscoverHost"]({
      projectId: PROJECT_ID,
      attributes: attributes(values),
    });
  }

  test.each(
    MANAGED_CLOUD_PLATFORMS.map(
      (descriptor: ManagedCloudPlatformDescriptor): ManagedCloudPlatform => {
        return descriptor.platform;
      },
    ),
  )("does not create a Host for %s", async (platform: ManagedCloudPlatform) => {
    const findOrCreateHost: jest.SpiedFunction<
      typeof HostService.findOrCreateByHostIdentifier
    > = jest
      .spyOn(HostService, "findOrCreateByHostIdentifier")
      .mockRejectedValue(new Error("must not be reached"));

    await expect(
      discoverHost({ ...HOST_ATTRIBUTES, "cloud.platform": platform }),
    ).resolves.toBeNull();

    expect(findOrCreateHost).not.toHaveBeenCalled();
    expect(getString).not.toHaveBeenCalled();
  });

  test.each([...FAAS_CLOUD_PLATFORM_VALUES])(
    "does not create a Host for FaaS platform %s",
    async (platform: string) => {
      const findOrCreateHost: jest.SpiedFunction<
        typeof HostService.findOrCreateByHostIdentifier
      > = jest
        .spyOn(HostService, "findOrCreateByHostIdentifier")
        .mockRejectedValue(new Error("must not be reached"));

      await expect(
        discoverHost({ ...HOST_ATTRIBUTES, "cloud.platform": platform }),
      ).resolves.toBeNull();

      expect(findOrCreateHost).not.toHaveBeenCalled();
    },
  );

  test("a raw VM platform still becomes a Host", async () => {
    /*
     * Prime the host-id cache so the walk stops at the fence check; what
     * matters is that the gate let the batch through, which the cache
     * lookup proves.
     */
    getString.mockImplementation(async (namespace: string) => {
      return namespace === "host-id" ? RESOURCE_ID : null;
    });
    jest.spyOn(HostService, "updateLastSeen").mockResolvedValue(undefined);
    jest
      .spyOn(baseService, "tryLinkHostToProxmoxGuest")
      .mockResolvedValue(undefined);

    const result: unknown = await discoverHost({
      ...HOST_ATTRIBUTES,
      "cloud.platform": "aws_ec2",
      "cloud.provider": "aws",
    });

    expect((result as ObjectID).toString()).toBe(RESOURCE_ID);
    expect(getString).toHaveBeenCalledWith(
      "host-id",
      `${PROJECT_ID.toString()}:ip-10-0-1-23.ec2.internal`,
    );
  });
});
