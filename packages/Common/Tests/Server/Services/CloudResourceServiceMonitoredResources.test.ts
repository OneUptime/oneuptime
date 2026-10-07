/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it, and DatabaseService imports it.
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

import CloudResourceService, {
  CLOUD_ENVIRONMENT_DISCONNECTED_MINUTES,
  CLOUD_RESOURCE_DISCONNECTED_MINUTES,
  CloudMonitoredResourceFindOrCreateResult,
} from "../../../Server/Services/CloudResourceService";
import CloudResourceFeedService from "../../../Server/Services/CloudResourceFeedService";
import ResourceHeartbeat from "../../../Server/Utils/Telemetry/ResourceHeartbeat";
import ResourceFeedUtil from "../../../Server/Utils/ResourceFeed/ResourceFeedUtil";
import logger from "../../../Server/Utils/Logger";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import { CloudResourceKind } from "../../../Types/Cloud/CloudResourceKind";
import {
  CloudMonitoredResource,
  buildCloudMonitoredResourceIdentifier,
  getCloudMonitoredResourceNameCandidates,
  resolveCloudMonitoredResource,
} from "../../../Types/Cloud/CloudMonitoredResource";
import ObjectID from "../../../Types/ObjectID";
import BadDataException from "../../../Types/Exception/BadDataException";
import PositiveNumber from "../../../Types/PositiveNumber";
import { getJestSpyOn } from "../../Spy";
import crypto from "crypto";

/*
 * CloudResourceService, for the Cloud Resources discovered from cloud
 * monitoring (CloudResourceKind.Resource). Everything external is mocked at
 * its seam - no Postgres, no Redis:
 *
 *   - findOrCreateMonitoredResource: lookup by the identity's hash first; a
 *     new row created as root with every column the provider reports, under
 *     the first free name; the per-project budget (cached a minute, bumped by
 *     every create, warned about once); the races on the identity and on the
 *     name;
 *   - recordMonitoredResourceSighting: one gated heartbeat, never the name;
 *   - the sweeps: "not reporting" after an hour, the auto-archive after the
 *     configured days, and the restore of what the sweep archived - each one
 *     set-based SQL scoped to resources;
 *   - an environment keeps its 15-minute disconnect, and a person's archive
 *     takes a resource out of the sweep's hands.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const SUBSCRIPTION: string = "7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b";
const NOW: Date = new Date("2026-10-06T12:00:00.000Z");

const service: any = CloudResourceService;

function vm(name: string = "vm-prod-01"): CloudMonitoredResource {
  const resource: CloudMonitoredResource | null = resolveCloudMonitoredResource(
    {
      metricName: "azure_percentage_cpu_average",
      attributes: {
        "resource.azuremonitor.subscription_id": SUBSCRIPTION,
        "azuremonitor.resource_id": `/subscriptions/${SUBSCRIPTION}/resourceGroups/rg-prod/providers/Microsoft.Compute/virtualMachines/${name}`,
        name: name,
        location: "westeurope",
      },
    },
  );
  if (!resource) {
    throw new Error("fixture did not resolve");
  }
  return resource;
}

function row(overrides: Partial<CloudResource> = {}): CloudResource {
  const item: CloudResource = new CloudResource(ObjectID.generate());
  item.projectId = PROJECT_ID;
  Object.assign(item, overrides);
  return item;
}

function withEnv(name: string, value: string | undefined): () => void {
  const previous: string | undefined = process.env[name];
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
  return () => {
    if (previous === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = previous;
    }
  };
}

/*
 * Raw SQL through getRepository().manager.query, answered by statement:
 * the budget count, or anything else (an UPDATE ... RETURNING, which the pg
 * driver hands back through TypeORM as [rows, rowCount]).
 */
function mockRawQueries(
  answers: { count?: number; updated?: number } = {},
): jest.Mock {
  const query: jest.Mock = jest.fn(async (sql: string) => {
    if (sql.includes(`COUNT(*)::int AS "count"`)) {
      return [{ count: answers.count ?? 0 }];
    }
    const updated: number = answers.updated ?? 0;
    return [
      Array.from({ length: updated }).map((_: unknown, index: number) => {
        return { _id: `row-${index}` };
      }),
      updated,
    ];
  });
  getJestSpyOn(service, "getRepository").mockReturnValue({
    manager: { query },
  } as never);
  return query;
}

let warn: jest.SpyInstance;

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: ["nextTick", "setImmediate"] });
  warn = jest.spyOn(logger, "warn").mockImplementation(() => {
    return undefined as never;
  });
  jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined as never;
  });
  service.clearMonitoredResourceBudgetMemo();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
  service.clearMonitoredResourceBudgetMemo();
});

describe("findOrCreateMonitoredResource", () => {
  let findOneBy: jest.SpyInstance;
  let countBy: jest.SpyInstance;
  let create: jest.SpyInstance;
  let query: jest.Mock;

  beforeEach(() => {
    findOneBy = getJestSpyOn(service, "findOneBy").mockResolvedValue(null);
    countBy = getJestSpyOn(service, "countBy").mockResolvedValue(
      new PositiveNumber(0) as never,
    );
    create = getJestSpyOn(service, "create").mockImplementation(
      async (data: { data: CloudResource }) => {
        data.data._id = ObjectID.generate().toString();
        return data.data;
      },
    );
    query = mockRawQueries();
  });

  test("an existing row is found by its identity's hash, and nothing is created", async () => {
    const existing: CloudResource = row();
    findOneBy.mockResolvedValue(existing);
    const resource: CloudMonitoredResource = vm();

    const result: CloudMonitoredResourceFindOrCreateResult =
      await service.findOrCreateMonitoredResource({
        projectId: PROJECT_ID,
        resource: resource,
      });

    expect(result).toEqual({ cloudResource: existing, created: false });
    expect(create).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();

    const lookup: any = findOneBy.mock.calls[0]![0];
    expect(lookup.query.projectId).toBe(PROJECT_ID);
    // Matched without regard to case (QueryHelper.findWithSameText).
    expect(
      Object.values(lookup.query.resourceIdentifier.objectLiteralParameters),
    ).toEqual([buildCloudMonitoredResourceIdentifier(resource)]);
    expect(lookup.props).toEqual({ isRoot: true });
  });

  test("a new resource is created as root with everything its provider reports", async () => {
    const resource: CloudMonitoredResource = vm();

    const result: CloudMonitoredResourceFindOrCreateResult =
      await service.findOrCreateMonitoredResource({
        projectId: PROJECT_ID,
        resource: resource,
      });

    expect(result.created).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
    const call: any = create.mock.calls[0]![0];
    expect(call.props).toEqual({ isRoot: true });

    const created: CloudResource = call.data;
    expect(created.projectId).toBe(PROJECT_ID);
    expect(created.name).toBe("vm-prod-01");
    expect(created.resourceIdentifier).toBe(
      buildCloudMonitoredResourceIdentifier(resource),
    );
    expect(created.cloudResourceKind).toBe(CloudResourceKind.Resource);
    expect(created.cloudProvider).toBe("azure");
    expect(created.cloudResourceType).toBe("Microsoft.Compute/virtualMachines");
    expect(created.providerResourceId).toBe(resource.providerResourceId);
    expect(created.telemetryAttributes).toEqual(resource.telemetryAttributes);
    expect(created.cloudAccountId).toBe(SUBSCRIPTION);
    expect(created.cloudRegion).toBe("westeurope");
    expect(created.cloudResourceGroup).toBe("rg-prod");
    expect(created.otelCollectorStatus).toBe("connected");
    expect(created.lastSeenAt).toEqual(NOW);
    // Never a platform: that is what an environment is keyed on.
    expect(created.cloudPlatform).toBeUndefined();
  });

  test("a name another row has is passed over for the next candidate", async () => {
    const resource: CloudMonitoredResource = vm();
    const candidates: Array<string> =
      getCloudMonitoredResourceNameCandidates(resource);
    countBy
      .mockResolvedValueOnce(new PositiveNumber(1) as never)
      .mockResolvedValue(new PositiveNumber(0) as never);

    await service.findOrCreateMonitoredResource({
      projectId: PROJECT_ID,
      resource: resource,
    });

    expect(create.mock.calls[0]![0].data.name).toBe(candidates[1]);
    // Each candidate checked by name, without regard to case, in order.
    expect(
      countBy.mock.calls.map((call: Array<any>): unknown => {
        return Object.values(call[0].query.name.objectLiteralParameters)[0];
      }),
    ).toEqual([candidates[0]!.toLowerCase(), candidates[1]!.toLowerCase()]);
  });

  test("with every candidate taken, the hash-qualified one is used", async () => {
    countBy.mockResolvedValue(new PositiveNumber(1) as never);
    const resource: CloudMonitoredResource = vm();
    const candidates: Array<string> =
      getCloudMonitoredResourceNameCandidates(resource);

    await service.findOrCreateMonitoredResource({
      projectId: PROJECT_ID,
      resource: resource,
    });

    expect(create.mock.calls[0]![0].data.name).toBe(
      candidates[candidates.length - 1],
    );
  });

  test("the budget counts the project's live resources, and refuses at the budget with one warning", async () => {
    const restore: () => void = withEnv(
      "CLOUD_RESOURCE_AUTO_CREATE_BUDGET",
      "3",
    );
    try {
      query = mockRawQueries({ count: 3 });

      const first: CloudMonitoredResourceFindOrCreateResult =
        await service.findOrCreateMonitoredResource({
          projectId: PROJECT_ID,
          resource: vm("vm-1"),
        });
      const second: CloudMonitoredResourceFindOrCreateResult =
        await service.findOrCreateMonitoredResource({
          projectId: PROJECT_ID,
          resource: vm("vm-2"),
        });

      expect(first).toEqual({ cloudResource: null, created: false });
      expect(second).toEqual({ cloudResource: null, created: false });
      expect(create).not.toHaveBeenCalled();

      // One count per project per minute.
      expect(query).toHaveBeenCalledTimes(1);
      const [sql, params]: [string, Array<unknown>] = query.mock.calls[0] as [
        string,
        Array<unknown>,
      ];
      expect(sql).toContain(`"isArchived" = false`);
      expect(sql).toContain(`"deletedAt" IS NULL`);
      expect(sql).toContain(`"cloudResourceKind" = $2`);
      expect(params).toEqual([
        PROJECT_ID.toString(),
        CloudResourceKind.Resource,
      ]);

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]![0]).toContain(
        "CLOUD_RESOURCE_AUTO_CREATE_BUDGET",
      );
    } finally {
      restore();
    }
  });

  test("every create counts against the cached budget at once", async () => {
    const restore: () => void = withEnv(
      "CLOUD_RESOURCE_AUTO_CREATE_BUDGET",
      "2",
    );
    try {
      query = mockRawQueries({ count: 1 });

      const first: CloudMonitoredResourceFindOrCreateResult =
        await service.findOrCreateMonitoredResource({
          projectId: PROJECT_ID,
          resource: vm("vm-1"),
        });
      const second: CloudMonitoredResourceFindOrCreateResult =
        await service.findOrCreateMonitoredResource({
          projectId: PROJECT_ID,
          resource: vm("vm-2"),
        });

      expect(first.created).toBe(true);
      expect(second).toEqual({ cloudResource: null, created: false });
      expect(create).toHaveBeenCalledTimes(1);
      expect(query).toHaveBeenCalledTimes(1);
    } finally {
      restore();
    }
  });

  test("a budget of 0 turns discovery off", async () => {
    const restore: () => void = withEnv(
      "CLOUD_RESOURCE_AUTO_CREATE_BUDGET",
      "0",
    );
    try {
      const result: CloudMonitoredResourceFindOrCreateResult =
        await service.findOrCreateMonitoredResource({
          projectId: PROJECT_ID,
          resource: vm(),
        });
      expect(result.cloudResource).toBeNull();
      expect(create).not.toHaveBeenCalled();
      expect(query).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  test("a lost race on the identity returns the winner's row", async () => {
    const winner: CloudResource = row();
    create.mockRejectedValue(new Error("duplicate key value"));
    findOneBy.mockResolvedValueOnce(null).mockResolvedValueOnce(winner);

    const result: CloudMonitoredResourceFindOrCreateResult =
      await service.findOrCreateMonitoredResource({
        projectId: PROJECT_ID,
        resource: vm(),
      });

    expect(result).toEqual({ cloudResource: winner, created: false });
    expect(create).toHaveBeenCalledTimes(1);
  });

  test("a name taken in the meantime is retried once under the hash-qualified name", async () => {
    const resource: CloudMonitoredResource = vm();
    const candidates: Array<string> =
      getCloudMonitoredResourceNameCandidates(resource);
    create
      .mockRejectedValueOnce(
        new BadDataException(
          "Cloud Resource with the same name already exists.",
        ),
      )
      .mockImplementationOnce(async (data: { data: CloudResource }) => {
        return data.data;
      });

    const result: CloudMonitoredResourceFindOrCreateResult =
      await service.findOrCreateMonitoredResource({
        projectId: PROJECT_ID,
        resource: resource,
      });

    expect(result.created).toBe(true);
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0]![0].data.name).toBe(candidates[0]);
    expect(create.mock.calls[1]![0].data.name).toBe(
      candidates[candidates.length - 1],
    );
  });

  test("a create that fails for another reason is thrown, not retried under another name", async () => {
    create.mockRejectedValue(new Error("connection reset"));

    await expect(
      service.findOrCreateMonitoredResource({
        projectId: PROJECT_ID,
        resource: vm(),
      }),
    ).rejects.toThrow("connection reset");
    expect(create).toHaveBeenCalledTimes(1);
  });

  test("a name clash on the retry too is thrown", async () => {
    create.mockRejectedValue(
      new BadDataException("Cloud Resource with the same name already exists."),
    );

    await expect(
      service.findOrCreateMonitoredResource({
        projectId: PROJECT_ID,
        resource: vm(),
      }),
    ).rejects.toThrow("same name");
    expect(create).toHaveBeenCalledTimes(2);
  });
});

describe("recordMonitoredResourceSighting", () => {
  let write: jest.SpyInstance;

  beforeEach(() => {
    write = jest
      .spyOn(ResourceHeartbeat, "write")
      .mockResolvedValue(undefined as never);
  });

  test("one gated heartbeat: liveness, and what the provider reports - never the name", async () => {
    const resource: CloudMonitoredResource = vm();
    const id: ObjectID = ObjectID.generate();

    await service.recordMonitoredResourceSighting({
      cloudResourceId: id,
      resource: resource,
    });

    expect(write).toHaveBeenCalledTimes(1);
    const call: any = write.mock.calls[0]![0];
    expect(call.service).toBe(service);
    expect(call.id).toBe(id);
    expect(call.cacheNamespace).toBe("cloud-monitored-resource-sighting");
    expect(call.throttleInSeconds).toBe(60);
    expect(call.liveness).toEqual({
      lastSeenAt: NOW,
      otelCollectorStatus: "connected",
    });
    expect(call.metadata).toEqual({
      cloudProvider: "azure",
      cloudResourceType: "Microsoft.Compute/virtualMachines",
      providerResourceId: resource.providerResourceId,
      telemetryAttributes: resource.telemetryAttributes,
      cloudRegion: "westeurope",
      cloudAccountId: SUBSCRIPTION,
      cloudResourceGroup: "rg-prod",
    });
    expect(call.metadata.name).toBeUndefined();
    expect(call.fingerprint).toBe(
      crypto
        .createHash("sha1")
        .update(JSON.stringify(call.metadata))
        .digest("hex"),
    );
  });

  test("the fingerprint is stable for one resource and moves when what it reports moves", async () => {
    await service.recordMonitoredResourceSighting({
      cloudResourceId: ObjectID.generate(),
      resource: vm(),
    });
    await service.recordMonitoredResourceSighting({
      cloudResourceId: ObjectID.generate(),
      resource: vm(),
    });
    await service.recordMonitoredResourceSighting({
      cloudResourceId: ObjectID.generate(),
      resource: { ...vm(), region: "northeurope" },
    });

    const fingerprints: Array<string> = write.mock.calls.map(
      (call: Array<any>): string => {
        return call[0].fingerprint;
      },
    );
    expect(fingerprints[0]).toBe(fingerprints[1]);
    expect(fingerprints[2]).not.toBe(fingerprints[0]);
  });

  test("an absent region, account or group is left out rather than blanked", async () => {
    await service.recordMonitoredResourceSighting({
      cloudResourceId: ObjectID.generate(),
      resource: { ...vm(), region: "", accountId: "", resourceGroup: "" },
    });

    const metadata: any = write.mock.calls[0]![0].metadata;
    expect("cloudRegion" in metadata).toBe(false);
    expect("cloudAccountId" in metadata).toBe(false);
    expect("cloudResourceGroup" in metadata).toBe(false);
  });

  test("a value wider than its column is clamped to it", async () => {
    await service.recordMonitoredResourceSighting({
      cloudResourceId: ObjectID.generate(),
      resource: { ...vm(), region: "r".repeat(150) },
    });

    expect(write.mock.calls[0]![0].metadata.cloudRegion).toHaveLength(100);
  });
});

describe("the sweeps", () => {
  test("not reporting: one UPDATE of resources unseen for an hour", async () => {
    const query: jest.Mock = mockRawQueries({ updated: 4 });

    await expect(service.markUnreportedMonitoredResources()).resolves.toBe(4);

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params]: [string, Array<unknown>] = query.mock.calls[0] as [
      string,
      Array<unknown>,
    ];
    expect(sql).toContain(`UPDATE "CloudResource"`);
    expect(sql).toContain(`SET "otelCollectorStatus" = 'disconnected'`);
    expect(sql).toContain(`"cloudResourceKind" = $1`);
    expect(sql).toContain(`"otelCollectorStatus" = 'connected'`);
    expect(params[0]).toBe(CloudResourceKind.Resource);
    expect((params[1] as Date).getTime()).toBe(
      NOW.getTime() - CLOUD_RESOURCE_DISCONNECTED_MINUTES * 60 * 1000,
    );
    expect(CLOUD_RESOURCE_DISCONNECTED_MINUTES).toBe(60);
  });

  test("auto-archive: resources unseen for 7 days, oldest first, marked as the sweep's", async () => {
    const query: jest.Mock = mockRawQueries({ updated: 2 });

    await expect(service.archiveUnseenMonitoredResources()).resolves.toBe(2);

    const [sql, params]: [string, Array<unknown>] = query.mock.calls[0] as [
      string,
      Array<unknown>,
    ];
    expect(sql).toContain(`cr."cloudResourceKind" = $1`);
    expect(sql).toContain(`cr."isArchived" = false`);
    expect(sql).toContain(`cr."autoArchivedAt" IS NULL`);
    expect(sql).toContain(
      `ORDER BY COALESCE(cr."lastSeenAt", cr."createdAt") ASC`,
    );
    expect(sql).toContain(`"autoArchivedAt" = $3`);
    expect(sql).toContain(`"archivedByUserId" = NULL`);
    expect(params).toEqual([
      CloudResourceKind.Resource,
      new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000),
      NOW,
      500,
    ]);
  });

  test.each([
    ["3", 3],
    ["1", 1],
    ["0", 1],
    ["-4", 1],
    ["not a number", 7],
    ["2.5", 7],
    ["", 7],
  ])(
    "CLOUD_RESOURCE_AUTO_ARCHIVE_DAYS=%p archives after %p day(s)",
    async (value: string, days: number) => {
      const restore: () => void = withEnv(
        "CLOUD_RESOURCE_AUTO_ARCHIVE_DAYS",
        value,
      );
      try {
        const query: jest.Mock = mockRawQueries();
        await service.archiveUnseenMonitoredResources();
        expect((query.mock.calls[0]![1] as Array<unknown>)[1]).toEqual(
          new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000),
        );
      } finally {
        restore();
      }
    },
  );

  test("restore: only rows the sweep archived that reported since - then forget the mark of those a person restored", async () => {
    const query: jest.Mock = mockRawQueries({ updated: 3 });

    await expect(service.restoreReportingMonitoredResources()).resolves.toBe(3);

    expect(query).toHaveBeenCalledTimes(2);
    const restoreSql: string = query.mock.calls[0]![0] as string;
    expect(restoreSql).toContain(`SET "isArchived" = false`);
    expect(restoreSql).toContain(`"isArchived" = true`);
    expect(restoreSql).toContain(`"autoArchivedAt" IS NOT NULL`);
    expect(restoreSql).toContain(`"lastSeenAt" > "autoArchivedAt"`);
    expect(restoreSql).toContain(`"cloudResourceKind" = $1`);

    const forgetSql: string = query.mock.calls[1]![0] as string;
    expect(forgetSql).toContain(`SET "autoArchivedAt" = NULL`);
    expect(forgetSql).toContain(`"isArchived" = false`);
    expect(forgetSql).toContain(`"lastSeenAt" > "autoArchivedAt"`);

    for (const call of query.mock.calls) {
      expect(call[1]).toEqual([CloudResourceKind.Resource]);
    }
  });

  test("an environment still reads disconnected after 15 minutes - and only environments do", async () => {
    const findBy: jest.SpyInstance = getJestSpyOn(
      service,
      "findBy",
    ).mockResolvedValue([]);

    await service.markDisconnectedResources();

    const args: any = findBy.mock.calls[0]![0];
    expect(args.query.cloudResourceKind).toBe(CloudResourceKind.Environment);
    expect(args.query.otelCollectorStatus).toBe("connected");
    expect(
      Object.values(args.query.lastSeenAt.objectLiteralParameters),
    ).toEqual([
      new Date(
        NOW.getTime() - CLOUD_ENVIRONMENT_DISCONNECTED_MINUTES * 60 * 1000,
      ),
    ]);
    expect(CLOUD_ENVIRONMENT_DISCONNECTED_MINUTES).toBe(15);
  });
});

describe("a person's archive decisions", () => {
  function onUpdate(data: Record<string, unknown>): any {
    return {
      updateBy: {
        data: data,
        query: {},
        props: { isRoot: false },
      },
      carryForward: null,
    };
  }

  beforeEach(() => {
    getJestSpyOn(service, "writeCloudResourceUpdatedFeed").mockResolvedValue(
      undefined as never,
    );
  });

  test("archiving a row clears its auto-archive mark, so the sweep never restores it", async () => {
    const query: jest.Mock = mockRawQueries();
    const ids: Array<ObjectID> = [ObjectID.generate(), ObjectID.generate()];

    await service.onUpdateSuccess(onUpdate({ isArchived: true }), ids);

    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]![0]).toContain(`SET "autoArchivedAt" = NULL`);
    expect(query.mock.calls[0]![1]).toEqual([
      ids.map((id: ObjectID) => {
        return id.toString();
      }),
    ]);
  });

  test("restoring a row keeps the mark, and any other update touches nothing", async () => {
    const query: jest.Mock = mockRawQueries();

    await service.onUpdateSuccess(onUpdate({ isArchived: false }), [
      ObjectID.generate(),
    ]);
    await service.onUpdateSuccess(onUpdate({ name: "renamed" }), [
      ObjectID.generate(),
    ]);

    expect(query).not.toHaveBeenCalled();
  });

  test("a failing clear is logged, never thrown", async () => {
    const query: jest.Mock = jest.fn(async () => {
      throw new Error("lock timeout");
    });
    getJestSpyOn(service, "getRepository").mockReturnValue({
      manager: { query },
    } as never);

    await expect(
      service.onUpdateSuccess(onUpdate({ isArchived: true }), [
        ObjectID.generate(),
      ]),
    ).resolves.toBeDefined();
    expect(logger.error).toHaveBeenCalled();
  });
});

describe("the created feed item", () => {
  test("names a resource by its provider id, an environment by its key", async () => {
    getJestSpyOn(service, "getCloudResourceMarkdownLink").mockResolvedValue(
      "[Cloud Resource x](https://example.com)" as never,
    );
    const markdown: jest.SpyInstance = jest
      .spyOn(ResourceFeedUtil, "getCreatedFeedMarkdown")
      .mockResolvedValue({
        feedInfoInMarkdown: "",
        moreInformationInMarkdown: "",
      });
    jest
      .spyOn(CloudResourceFeedService, "createCloudResourceFeedItem")
      .mockResolvedValue(undefined as never);

    const onCreate: any = { createBy: { props: { isRoot: true } } };

    await service.writeCloudResourceCreatedFeed(
      row({
        cloudResourceKind: CloudResourceKind.Resource,
        resourceIdentifier: "azure:abc",
        providerResourceId:
          "/subscriptions/x/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm",
      }),
      onCreate,
    );
    await service.writeCloudResourceCreatedFeed(
      row({
        cloudResourceKind: CloudResourceKind.Environment,
        resourceIdentifier: "aws_ecs|123456789012|us-east-1",
      }),
      onCreate,
    );

    expect(markdown.mock.calls[0]![0]).toMatchObject({
      identifierName: "Provider resource ID",
      identifierValue:
        "/subscriptions/x/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm",
    });
    expect(markdown.mock.calls[1]![0]).toMatchObject({
      identifierName: "Resource identifier",
      identifierValue: "aws_ecs|123456789012|us-east-1",
    });
  });
});

describe("getMonitoredResourceAutoCreateBudget", () => {
  test.each([
    [undefined, 5000],
    ["250", 250],
    ["0", 0],
    ["-1", 0],
    ["many", 5000],
  ])(
    "CLOUD_RESOURCE_AUTO_CREATE_BUDGET=%p is %p",
    (value: string | undefined, budget: number) => {
      const restore: () => void = withEnv(
        "CLOUD_RESOURCE_AUTO_CREATE_BUDGET",
        value,
      );
      try {
        expect(service.getMonitoredResourceAutoCreateBudget()).toBe(budget);
      } finally {
        restore();
      }
    },
  );
});
