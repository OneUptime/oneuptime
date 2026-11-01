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
import CloudAppService from "Common/Server/Services/CloudAppService";
import CloudAppRevisionService from "Common/Server/Services/CloudAppRevisionService";
import CloudAppChangeRecorder from "Common/Server/Utils/Telemetry/ChangeDetection/CloudAppChangeRecorder";
import {
  CloudAppRevisionChange,
  CloudAppRevisionChangeKind,
} from "Common/Server/Utils/Telemetry/ChangeDetection/CloudAppChangeEntries";
import {
  CloudAppIdentity,
  resolveCloudAppIdentity,
} from "Common/Server/Utils/Telemetry/CloudAppIdentity";
import HostService from "Common/Server/Services/HostService";
import LabelService from "Common/Server/Services/LabelService";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import ObjectID from "Common/Types/ObjectID";
import { HEARTBEAT_ROW_PRESENT } from "Common/Server/Utils/Telemetry/ResourceHeartbeat";
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
 *   - the entity-id cache short-circuits find-or-create;
 *   - the APP the resource belongs to (an ECS task definition family in its
 *     cluster, a Cloud Run service) and the revision it runs are kept once
 *     per fence window each, a deploy or rollback the revision service finds
 *     is recorded as a change, and the instance names its app and revision;
 *     a failure there never fails the batch.
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
const CLUSTER_ARN: string =
  "arn:aws:ecs:us-east-1:123456789012:cluster/production";
const APP_ID: string = "55555555-5555-4555-8555-555555555555";

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
let recordApp: jest.SpiedFunction<typeof CloudAppService.recordApp>;
let findAppId: jest.SpiedFunction<typeof CloudAppService.findAppId>;
let recordRevision: jest.SpiedFunction<
  typeof CloudAppRevisionService.recordRevision
>;
let recordChange: jest.SpiedFunction<
  typeof CloudAppChangeRecorder.recordChange
>;
let deleteKey: jest.SpiedFunction<typeof GlobalCache.deleteKey>;
let getString: jest.SpiedFunction<typeof GlobalCache.getString>;
let setString: jest.SpiedFunction<typeof GlobalCache.setString>;
let setStringIfNotExists: jest.SpiedFunction<
  typeof GlobalCache.setStringIfNotExists
>;

// The app identity the ingest resolves from these attributes on ECS.
function appIdentityOf(
  values: Record<string, string>,
  platform: string = "aws_ecs",
): CloudAppIdentity {
  return resolveCloudAppIdentity({
    platform,
    getAttribute: (key: string): string | null => {
      return values[key] ?? null;
    },
  })!;
}

function appKeyOf(values: Record<string, string>): string {
  return appIdentityOf(values).appKey;
}

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
  deleteKey = jest.spyOn(GlobalCache, "deleteKey").mockResolvedValue(undefined);

  const created: CloudResource = new CloudResource();
  created._id = RESOURCE_ID;
  findOrCreate = jest
    .spyOn(CloudResourceService, "findOrCreateByResourceIdentifier")
    .mockResolvedValue(created);
  updateLastSeen = jest
    .spyOn(CloudResourceService, "updateLastSeen")
    .mockResolvedValue(HEARTBEAT_ROW_PRESENT);
  recordInstance = jest
    .spyOn(CloudResourceInstanceService, "recordInstance")
    .mockResolvedValue(undefined);

  // The app's row and its revisions: found or created, nothing changed.
  recordApp = jest
    .spyOn(CloudAppService, "recordApp")
    .mockResolvedValue(new ObjectID(APP_ID));
  findAppId = jest.spyOn(CloudAppService, "findAppId").mockResolvedValue(null);
  recordRevision = jest
    .spyOn(CloudAppRevisionService, "recordRevision")
    .mockResolvedValue({ change: null });
  recordChange = jest
    .spyOn(CloudAppChangeRecorder, "recordChange")
    .mockImplementation(() => {
      return undefined;
    });

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
      // The app its service.name names; it reports no revision.
      cloudAppId: expect.any(ObjectID),
      revision: undefined,
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
     * only the environment's own maintenance fence, and its app's (the
     * service.name), which has no revision to keep.
     */
    expect([...heldFences]).toEqual([
      `cloud-resource:${RESOURCE_ID}`,
      `cloud-app:${RESOURCE_ID}:${appKeyOf(ECS_ATTRIBUTES)}`,
    ]);
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

describe("autoDiscoverCloudResource apps and their revisions", () => {
  // An ECS task of the checkout-api family, revision 43, in production.
  const TASK: Record<string, string> = {
    ...ECS_ATTRIBUTES,
    "aws.ecs.task.family": "checkout-api",
    "aws.ecs.task.revision": "43",
    "aws.ecs.cluster.arn": CLUSTER_ARN,
    "aws.ecs.task.arn": TASK_ARN,
    "service.version": "1.4.2",
  };

  test("keeps the task's app (its family, in its cluster) and its revision, and the instance names both", async () => {
    const result: unknown = await discover(TASK);

    expect((result as ObjectID).toString()).toBe(RESOURCE_ID);

    expect(recordApp).toHaveBeenCalledTimes(1);
    const [appCall] = recordApp.mock.calls[0]! as [
      {
        projectId: ObjectID;
        cloudResourceId: ObjectID;
        cloudPlatform: string;
        identity: CloudAppIdentity;
      },
    ];
    expect(appCall.projectId).toBe(PROJECT_ID);
    expect(appCall.cloudResourceId.toString()).toBe(RESOURCE_ID);
    expect(appCall.cloudPlatform).toBe("aws_ecs");
    expect(appCall.identity).toEqual(appIdentityOf(TASK));
    expect(appCall.identity).toEqual(
      expect.objectContaining({
        name: "checkout-api",
        groupName: "production",
        revision: "43",
      }),
    );

    expect(recordRevision).toHaveBeenCalledTimes(1);
    const [revisionCall] = recordRevision.mock.calls[0]! as [
      {
        projectId: ObjectID;
        cloudResourceId: ObjectID;
        cloudAppId: ObjectID;
        revision: string;
        serviceVersion: string | null;
        image: string | null;
      },
    ];
    expect(revisionCall.cloudResourceId.toString()).toBe(RESOURCE_ID);
    expect(revisionCall.cloudAppId.toString()).toBe(APP_ID);
    expect(revisionCall.revision).toBe("43");
    expect(revisionCall.serviceVersion).toBe("1.4.2");

    // The task's row names the app it runs and the revision.
    expect(recordInstance).toHaveBeenCalledTimes(1);
    const [instanceCall] = recordInstance.mock.calls[0]! as [
      { instanceName: string; cloudAppId: ObjectID; revision: string },
    ];
    expect(instanceCall.instanceName).toBe(TASK_ID);
    expect(instanceCall.cloudAppId.toString()).toBe(APP_ID);
    expect(instanceCall.revision).toBe("43");

    // Each under a fence of its own: the app's, and the app's revision's.
    const key: string = appKeyOf(TASK);
    expect(heldFences.has(`cloud-app:${RESOURCE_ID}:${key}`)).toBe(true);
    expect(heldFences.has(`cloud-app-revision:${RESOURCE_ID}:${key}:43`)).toBe(
      true,
    );
    // Found once, so not looked up again.
    expect(findAppId).not.toHaveBeenCalled();
  });

  test("on Cloud Run, the app is the service and its revision K_REVISION", async () => {
    await discover({
      "cloud.platform": "gcp_cloud_run",
      "cloud.provider": "gcp",
      "cloud.region": "europe-west1",
      "cloud.account.id": "my-gcp-project",
      "faas.name": "api",
      "faas.version": "api-00042-xyz",
      "faas.instance": "00bf4bf02d4b1b7e2c0e5f7d6e0a3d5b",
    });

    expect(recordApp).toHaveBeenCalledWith(
      expect.objectContaining({
        cloudPlatform: "gcp_cloud_run",
        identity: expect.objectContaining({
          name: "api",
          nameAttribute: "faas.name",
          revision: "api-00042-xyz",
        }),
      }),
    );
    expect(recordRevision).toHaveBeenCalledWith(
      expect.objectContaining({ revision: "api-00042-xyz" }),
    );
    expect(recordInstance).toHaveBeenCalledWith(
      expect.objectContaining({ revision: "api-00042-xyz" }),
    );
  });

  test("a deploy the revision service found is recorded as a change of the app, in its environment", async () => {
    const change: CloudAppRevisionChange = {
      kind: CloudAppRevisionChangeKind.Deployed,
      revision: "43",
      previousRevision: "42",
      time: new Date("2026-11-01T09:35:00.000Z"),
    };
    recordRevision.mockResolvedValue({ change });

    await discover(TASK);

    expect(recordChange).toHaveBeenCalledTimes(1);
    const [changeCall] = recordChange.mock.calls[0]! as [
      {
        projectId: ObjectID;
        subject: Record<string, unknown>;
        change: CloudAppRevisionChange;
      },
    ];
    expect(changeCall.projectId).toBe(PROJECT_ID);
    expect(changeCall.change).toBe(change);
    expect(changeCall.subject).toEqual({
      appId: expect.any(ObjectID),
      appName: "checkout-api",
      groupName: "production",
      environmentId: expect.any(ObjectID),
      cloudPlatform: "aws_ecs",
      cloudProvider: "aws",
      cloudAccountId: "123456789012",
      cloudRegion: "us-east-1",
      serviceVersion: "1.4.2",
    });
    expect((changeCall.subject["appId"] as ObjectID).toString()).toBe(APP_ID);
    expect((changeCall.subject["environmentId"] as ObjectID).toString()).toBe(
      RESOURCE_ID,
    );
  });

  test("a sighting that is neither a deploy nor a rollback records no change", async () => {
    await discover(TASK);

    expect(recordRevision).toHaveBeenCalledTimes(1);
    expect(recordChange).not.toHaveBeenCalled();
  });

  test("with the app's and the revision's fences held, neither is written, and the instance still names its app", async () => {
    const key: string = appKeyOf(TASK);
    heldFences.add(`cloud-app:${RESOURCE_ID}:${key}`);
    heldFences.add(`cloud-app-revision:${RESOURCE_ID}:${key}:43`);
    findAppId.mockResolvedValue(new ObjectID(APP_ID));

    await discover(TASK);

    expect(recordApp).not.toHaveBeenCalled();
    expect(recordRevision).not.toHaveBeenCalled();
    expect(findAppId).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      cloudResourceId: expect.any(ObjectID),
      appKey: key,
    });
    const [instanceCall] = recordInstance.mock.calls[0]! as [
      { cloudAppId: ObjectID; revision: string },
    ];
    expect(instanceCall.cloudAppId.toString()).toBe(APP_ID);
    expect(instanceCall.revision).toBe("43");
  });

  test("a revision of an app found earlier in the minute reads no row for the app", async () => {
    heldFences.add(`cloud-app:${RESOURCE_ID}:${appKeyOf(TASK)}`);
    findAppId.mockResolvedValue(new ObjectID(APP_ID));

    await discover({ ...TASK, "aws.ecs.task.arn": `${TASK_ARN}1` });
    await discover({
      ...TASK,
      "aws.ecs.task.revision": "44",
      "aws.ecs.task.arn": `${TASK_ARN}2`,
    });

    // Looked up once; the second revision's sighting took the remembered id.
    expect(findAppId).toHaveBeenCalledTimes(1);
    expect(recordRevision).toHaveBeenCalledTimes(2);
    expect(
      recordRevision.mock.calls.map((call: Array<unknown>): string => {
        return (call[0] as { revision: string }).revision;
      }),
    ).toEqual(["43", "44"]);
  });

  test("an app it cannot keep never fails the batch: the environment resolves, the app's fence is released, and the instance is recorded without it", async () => {
    recordApp.mockRejectedValue(new Error("Postgres said no"));

    const result: unknown = await discover(TASK);

    expect((result as ObjectID).toString()).toBe(RESOURCE_ID);
    expect(updateLastSeen).toHaveBeenCalledTimes(1);
    expect(recordRevision).not.toHaveBeenCalled();
    expect(deleteKey).toHaveBeenCalledWith(
      FENCE_NAMESPACE,
      `cloud-app:${RESOURCE_ID}:${appKeyOf(TASK)}`,
    );
    // The environment's own fence is kept: its heartbeat was written.
    expect(deleteKey).not.toHaveBeenCalledWith(
      FENCE_NAMESPACE,
      `cloud-resource:${RESOURCE_ID}`,
    );

    expect(recordInstance).toHaveBeenCalledTimes(1);
    const [instanceCall] = recordInstance.mock.calls[0]! as [
      { instanceName: string; cloudAppId?: ObjectID; revision?: string },
    ];
    expect(instanceCall.instanceName).toBe(TASK_ID);
    expect(instanceCall.cloudAppId).toBeUndefined();
    expect(instanceCall.revision).toBe("43");
  });

  test("a revision it cannot keep releases its fence, and the app and instance are kept", async () => {
    recordRevision.mockRejectedValue(new Error("Postgres said no"));

    const result: unknown = await discover(TASK);

    expect((result as ObjectID).toString()).toBe(RESOURCE_ID);
    expect(recordApp).toHaveBeenCalledTimes(1);
    const key: string = appKeyOf(TASK);
    expect(deleteKey).toHaveBeenCalledWith(
      FENCE_NAMESPACE,
      `cloud-app-revision:${RESOURCE_ID}:${key}:43`,
    );
    expect(deleteKey).toHaveBeenCalledWith(
      FENCE_NAMESPACE,
      `cloud-app:${RESOURCE_ID}:${key}`,
    );
    const [instanceCall] = recordInstance.mock.calls[0]! as [
      { cloudAppId: ObjectID },
    ];
    expect(instanceCall.cloudAppId.toString()).toBe(APP_ID);
  });

  test("a resource that names no app keeps none, and its instance names none", async () => {
    await discover({
      "cloud.platform": "aws_ecs",
      "cloud.region": "us-east-1",
      "service.name": "unknown_service:java",
      "aws.ecs.task.arn": TASK_ARN,
    });

    expect(recordApp).not.toHaveBeenCalled();
    expect(recordRevision).not.toHaveBeenCalled();
    expect(findAppId).not.toHaveBeenCalled();
    expect(recordInstance).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      cloudResourceId: expect.any(ObjectID),
      instanceName: TASK_ID,
      cloudAppId: undefined,
      revision: undefined,
    });
  });

  test("an app with no revision keeps its row and records no revision", async () => {
    await discover({ ...ECS_ATTRIBUTES, "aws.ecs.task.arn": TASK_ARN });

    expect(recordApp).toHaveBeenCalledTimes(1);
    expect(recordRevision).not.toHaveBeenCalled();
    expect(recordInstance).toHaveBeenCalledWith(
      expect.objectContaining({ revision: undefined }),
    );
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
    jest
      .spyOn(HostService, "updateLastSeen")
      .mockResolvedValue(HEARTBEAT_ROW_PRESENT);
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
