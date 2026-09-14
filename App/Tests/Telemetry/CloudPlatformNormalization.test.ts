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
import ServerlessFunctionService from "Common/Server/Services/ServerlessFunctionService";
import ServerlessFunctionInstanceService from "Common/Server/Services/ServerlessFunctionInstanceService";
import HostService from "Common/Server/Services/HostService";
import LabelService from "Common/Server/Services/LabelService";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import ServerlessFunction from "Common/Models/DatabaseModels/ServerlessFunction";
import ObjectID from "Common/Types/ObjectID";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import { CLOUD_PLATFORM_ALIASES } from "Common/Types/Cloud/CloudPlatform";
import fs from "fs";
import path from "path";
/*
 * `jest` is deliberately taken from the ambient global rather than from
 * "@jest/globals" — see OtelIngestMaintenanceFenceRelease.test.ts for why
 * the two spell a spy type differently.
 */
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The Node and .NET Azure resource detectors write cloud.platform as
 * "azure.container_apps" / "azure.app_service" / "azure.functions" — dotted
 * — where the semantic conventions, the Collector's Azure detectors and
 * OneUptime's platform registry all use underscores. Left alone, that
 * spelling failed the Cloud Environment gate (a Node app on Container Apps
 * using the official detector never became an environment), and even once
 * gated it would have split one subscription into two environments (one
 * per spelling) and, worst, the environment row's platform would not have
 * matched the `resource.cloud.platform` value stored on the rows, so the
 * Logs / Traces / Metrics tabs would have scoped to nothing.
 *
 * The fix is one rewrite, in place, on the wire-shaped attribute list,
 * before the auto-discovery gates read it and before the per-signal flatten
 * stores it. This suite pins the rewrite itself, that every gate sees the
 * canonical value, and that every signal service performs the rewrite at
 * the point the attributes are extracted.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const RESOURCE_ID: string = "55555555-5555-4555-8555-555555555555";

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

function readAttribute(list: JSONArray, key: string): unknown {
  const found: JSONObject | undefined = (list as Array<JSONObject>).find(
    (attribute: JSONObject): boolean => {
      return Boolean(attribute) && attribute["key"] === key;
    },
  );
  return (found?.["value"] as JSONObject | undefined)?.["stringValue"];
}

describe("normalizeCloudPlatformAttribute", () => {
  test("rewrites a dotted Azure cloud.platform in place and leaves everything else alone", () => {
    const list: JSONArray = attributes({
      "cloud.provider": "azure",
      "cloud.platform": "azure.container_apps",
      "cloud.region": "eastus",
      "service.name": "checkout",
    });

    baseService["normalizeCloudPlatformAttribute"](list);

    expect(readAttribute(list, "cloud.platform")).toBe("azure_container_apps");
    expect(readAttribute(list, "cloud.provider")).toBe("azure");
    expect(readAttribute(list, "cloud.region")).toBe("eastus");
    expect(readAttribute(list, "service.name")).toBe("checkout");
    expect(list.length).toBe(4);
  });

  test.each(Object.entries(CLOUD_PLATFORM_ALIASES))(
    "rewrites %s to %s",
    (alias: string, canonical: string) => {
      const list: JSONArray = attributes({ "cloud.platform": alias });
      baseService["normalizeCloudPlatformAttribute"](list);
      expect(readAttribute(list, "cloud.platform")).toBe(canonical);
    },
  );

  test("leaves a canonical value and an unknown value exactly as sent", () => {
    for (const value of [
      "aws_ecs",
      "gcp_cloud_run",
      "some_future_platform",
      // Object.prototype member names must come back as the strings sent.
      "constructor",
      "__proto__",
      "toString",
    ]) {
      const list: JSONArray = attributes({ "cloud.platform": value });
      baseService["normalizeCloudPlatformAttribute"](list);
      expect(readAttribute(list, "cloud.platform")).toBe(value);
    }
  });

  test("trims whitespace around a canonical value", () => {
    const list: JSONArray = attributes({ "cloud.platform": "  aws_ecs " });
    baseService["normalizeCloudPlatformAttribute"](list);
    expect(readAttribute(list, "cloud.platform")).toBe("aws_ecs");
  });

  test("ignores non-string, malformed and missing cloud.platform entries", () => {
    const list: JSONArray = [
      { key: "cloud.platform", value: { intValue: 7 } },
      { key: "cloud.platform" },
      null as unknown as JSONObject,
      stringAttribute("cloud.region", "eastus"),
    ];

    expect(() => {
      baseService["normalizeCloudPlatformAttribute"](list);
    }).not.toThrow();

    expect((list[0] as JSONObject)["value"]).toEqual({ intValue: 7 });
    expect(list[1]).toEqual({ key: "cloud.platform" });
    expect(readAttribute(list, "cloud.region")).toBe("eastus");
  });

  test("is a no-op on an empty list", () => {
    const list: JSONArray = [];
    baseService["normalizeCloudPlatformAttribute"](list);
    expect(list).toEqual([]);
  });
});

describe("every signal service canonicalises cloud.platform where it extracts the resource attributes", () => {
  /*
   * The rewrite has to happen on the wire-shaped list, once, before the
   * gates and before the flatten. Pinned by reading the source: the call
   * must directly follow the `resourceAttributes_raw` extraction in each
   * of the four services, so no reader — discovery or storage — can see
   * the un-normalised value.
   */
  const SERVICES_DIR: string = path.join(
    __dirname,
    "..",
    "..",
    "FeatureSet",
    "Telemetry",
    "Services",
  );

  test.each([
    "OtelTracesIngestService.ts",
    "OtelLogsIngestService.ts",
    "OtelMetricsIngestService.ts",
    "OtelProfilesIngestService.ts",
  ])("%s", (file: string) => {
    const source: string = fs
      .readFileSync(path.join(SERVICES_DIR, file), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\s+/g, " ");

    const extraction: number = source.indexOf(
      "const resourceAttributes_raw: JSONArray =",
    );
    const rewrite: number = source.indexOf(
      "this.normalizeCloudPlatformAttribute(resourceAttributes_raw);",
    );

    expect(extraction).toBeGreaterThan(-1);
    expect(rewrite).toBeGreaterThan(extraction);
    /* Nothing reads the list between the extraction and the rewrite. */
    const between: string = source.slice(extraction, rewrite);
    expect(between).not.toContain("autoDiscover");
    expect(between).not.toContain("resolveTelemetryResource");
    expect(between).not.toContain("getStringAttribute");
  });
});

describe("the auto-discovery gates read the canonical spelling", () => {
  let cachedEntityIds: Map<string, string>;

  beforeEach(() => {
    cachedEntityIds = new Map();

    jest
      .spyOn(GlobalCache, "getString")
      .mockImplementation(
        async (namespace: string, key: string): Promise<string | null> => {
          return cachedEntityIds.get(`${namespace}:${key}`) || null;
        },
      );
    jest
      .spyOn(GlobalCache, "setString")
      .mockImplementation(
        async (
          namespace: string,
          key: string,
          value: string,
        ): Promise<void> => {
          cachedEntityIds.set(`${namespace}:${key}`, value);
        },
      );
    // Every maintenance fence is granted, so the gated writes are visible.
    jest
      .spyOn(GlobalCache, "setStringIfNotExists")
      .mockImplementation(async (): Promise<boolean> => {
        return true;
      });
    jest
      .spyOn(GlobalCache, "deleteKey")
      .mockImplementation(async (): Promise<void> => {});

    jest
      .spyOn(CloudResourceService, "findOrCreateByResourceIdentifier")
      .mockImplementation(async (): Promise<CloudResource> => {
        const row: CloudResource = new CloudResource();
        row._id = RESOURCE_ID;
        return row;
      });
    jest
      .spyOn(CloudResourceService, "updateLastSeen")
      .mockImplementation(async (): Promise<void> => {});
    jest
      .spyOn(CloudResourceInstanceService, "recordInstance")
      .mockImplementation(async (): Promise<void> => {});
    jest
      .spyOn(ServerlessFunctionService, "findOrCreateByFunctionIdentifier")
      .mockImplementation(async (): Promise<ServerlessFunction> => {
        const row: ServerlessFunction = new ServerlessFunction();
        row._id = RESOURCE_ID;
        return row;
      });
    jest
      .spyOn(ServerlessFunctionService, "updateLastSeen")
      .mockImplementation(async (): Promise<void> => {});
    jest
      .spyOn(ServerlessFunctionInstanceService, "recordInstance")
      .mockImplementation(async (): Promise<void> => {});
    jest
      .spyOn(HostService, "findOrCreateByHostIdentifier")
      .mockImplementation(async (): Promise<never> => {
        throw new Error("a managed platform must never become a Host");
      });
    jest
      .spyOn(LabelService, "findOrCreateLabelsByNames")
      .mockImplementation(async (): Promise<Array<ObjectID>> => {
        return [];
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("autoDiscoverCloudResource accepts the dotted Container Apps spelling and mints the canonical key, name and platform", async () => {
    const result: unknown = await baseService["autoDiscoverCloudResource"]({
      projectId: PROJECT_ID,
      attributes: attributes({
        "cloud.platform": "azure.container_apps",
        "cloud.region": "eastus",
        "cloud.account.id": "sub-1",
        "azure.container_app.instance.id": "checkout--rev1-abc",
      }),
    });

    expect(result).not.toBeNull();
    expect(
      CloudResourceService.findOrCreateByResourceIdentifier,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceIdentifier: "azure_container_apps|sub-1|eastus",
        name: "Azure Container Apps · eastus · sub-1",
        cloudPlatform: "azure_container_apps",
        cloudProvider: "azure",
      }),
    );
    expect(CloudResourceService.updateLastSeen).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ cloudPlatform: "azure_container_apps" }),
    );
    // The Collector detector's replica id is the instance identity.
    expect(CloudResourceInstanceService.recordInstance).toHaveBeenCalledWith(
      expect.objectContaining({ instanceName: "checkout--rev1-abc" }),
    );
  });

  test("both spellings of the same subscription land on the same environment key", async () => {
    /*
     * A subscription no other test in this file discovers: the entity-id
     * memo is process-wide, so a key another test already resolved would
     * be served from it before find-or-create ever ran.
     */
    const dotted: Record<string, string> = {
      "cloud.platform": "azure.container_apps",
      "cloud.region": "westeurope",
      "cloud.account.id": "sub-both-spellings",
    };
    const canonical: Record<string, string> = {
      ...dotted,
      "cloud.platform": "azure_container_apps",
    };

    const dottedId: unknown = await baseService["autoDiscoverCloudResource"]({
      projectId: PROJECT_ID,
      attributes: attributes(dotted),
    });
    /*
     * The dotted call must have resolved on its own — a refused gate would
     * also leave exactly one find-or-create for the canonical call to make.
     */
    expect(String(dottedId)).toBe(RESOURCE_ID);
    expect(
      CloudResourceService.findOrCreateByResourceIdentifier,
    ).toHaveBeenCalledTimes(1);

    const canonicalId: unknown = await baseService["autoDiscoverCloudResource"](
      {
        projectId: PROJECT_ID,
        attributes: attributes(canonical),
      },
    );
    expect(String(canonicalId)).toBe(RESOURCE_ID);

    /*
     * The first call populates the entity-id cache under the canonical
     * key; the second is served from it, so find-or-create ran exactly
     * once, with the canonical key, and nothing was minted twice.
     */
    expect(
      CloudResourceService.findOrCreateByResourceIdentifier,
    ).toHaveBeenCalledTimes(1);
    expect(
      CloudResourceService.findOrCreateByResourceIdentifier,
    ).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceIdentifier:
          "azure_container_apps|sub-both-spellings|westeurope",
      }),
    );
  });

  test("autoDiscoverServerless accepts the dotted Azure Functions spelling", async () => {
    const result: unknown = await baseService["autoDiscoverServerless"]({
      projectId: PROJECT_ID,
      attributes: attributes({
        "cloud.platform": "azure.functions",
        "service.name": "order-worker",
      }),
    });

    expect(result).not.toBeNull();
    expect(
      ServerlessFunctionService.findOrCreateByFunctionIdentifier,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ functionIdentifier: "order-worker" }),
    );
    expect(ServerlessFunctionService.updateLastSeen).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ cloudPlatform: "azure_functions" }),
    );
  });

  test("autoDiscoverHost refuses a dotted managed platform the way it refuses the canonical one", async () => {
    for (const platform of ["azure.container_apps", "azure.app_service"]) {
      const result: unknown = await baseService["autoDiscoverHost"]({
        projectId: PROJECT_ID,
        attributes: attributes({
          "cloud.platform": platform,
          "host.name": "replica-1",
          "os.type": "linux",
        }),
      });
      expect({ platform, result }).toEqual({ platform, result: null });
    }
    expect(HostService.findOrCreateByHostIdentifier).not.toHaveBeenCalled();
  });

  test("a dotted VM platform still becomes a Host", async () => {
    (
      HostService.findOrCreateByHostIdentifier as unknown as jest.Mock
    ).mockImplementation(async (): Promise<unknown> => {
      return { _id: RESOURCE_ID };
    });
    jest
      .spyOn(HostService, "updateLastSeen")
      .mockImplementation(async (): Promise<void> => {});

    const result: unknown = await baseService["autoDiscoverHost"]({
      projectId: PROJECT_ID,
      attributes: attributes({
        "cloud.platform": "azure.vm",
        "host.name": "vm-1",
        "os.type": "linux",
      }),
    });

    expect(result).not.toBeNull();
    expect(HostService.findOrCreateByHostIdentifier).toHaveBeenCalledWith(
      expect.objectContaining({ hostIdentifier: "vm-1" }),
    );
  });
});
