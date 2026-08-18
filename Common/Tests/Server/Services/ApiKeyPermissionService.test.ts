/**
 * ApiKeyPermissionService.findPermissionsByApiKeyId cache tests.
 *
 * Every API-key-authenticated request builds its tenant permissions from this
 * lookup, so it now consults a per-process 60s TTL cache before running the
 * findBy (with its labels join). The contract pinned here is load-bearing in
 * three ways:
 * - the underlying query is unchanged: keyed by exactly the given apiKeyId,
 *   as root, selecting permission / labels._id / isBlockPermission — and the
 *   row -> DTO mapping preserves the old edge cases (undefined labels -> [],
 *   isBlockPermission passed through unchanged, never defaulted)
 * - hits and misses both return freshly built objects, so a caller mutating
 *   its result cannot poison the permissions of every later request
 * - the service's own lifecycle hooks (create/update/delete) clear the cache,
 *   so a permission edit takes effect immediately in the process that made it;
 *   the TTL only bounds staleness for OTHER processes.
 *
 * ApiKeyPermissionService.findBy is spied on, so no database is touched.
 */

import ApiKeyPermissionService, {
  ApiKeyPermissionRow,
} from "../../../Server/Services/ApiKeyPermissionService";
import ApiKeyPermission from "../../../Models/DatabaseModels/ApiKeyPermission";
import Label from "../../../Models/DatabaseModels/Label";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * PasswordHash has a known, pre-existing TS5.9 compile failure under ts-jest
 * (Buffer vs BinaryLike) that breaks every suite whose import graph reaches
 * it. Nothing here touches password hashing; stub the module before the
 * service import graph drags it into compilation.
 */
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: class PasswordHashStub {},
  };
});

const TTL_MS: number = 60 * 1000;

/*
 * The hooks are protected on purpose — DatabaseService calls them, feature
 * code does not. Reaching them through a cast is how their cache-clearing
 * behaviour can be pinned without standing up Postgres.
 */
type HookCallable = {
  onBeforeCreate: (createBy: unknown) => Promise<unknown>;
  onBeforeUpdate: (updateBy: unknown) => Promise<unknown>;
  onBeforeDelete: (deleteBy: unknown) => Promise<unknown>;
};

function asHooks(service: unknown): HookCallable {
  return service as unknown as HookCallable;
}

function makeModelRow(data: {
  permission: Permission;
  labelIds?: Array<ObjectID>;
  isBlockPermission?: boolean;
}): ApiKeyPermission {
  const row: ApiKeyPermission = new ApiKeyPermission();
  row.permission = data.permission;
  if (data.labelIds) {
    row.labels = data.labelIds.map((id: ObjectID) => {
      const label: Label = new Label();
      label.id = id;
      return label;
    });
  }
  if (data.isBlockPermission !== undefined) {
    row.isBlockPermission = data.isBlockPermission;
  }
  return row;
}

function spyOnFindBy(): jest.SpyInstance {
  return getJestSpyOn(ApiKeyPermissionService, "findBy");
}

describe("ApiKeyPermissionService.findPermissionsByApiKeyId", () => {
  const apiKeyId: ObjectID = ObjectID.generate();

  beforeEach(() => {
    /*
     * The cache lives on the singleton service, so entries written by one
     * test would leak into the next without an explicit clear.
     */
    ApiKeyPermissionService.clearCache();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("runs the exact legacy query and maps rows onto DTOs", async () => {
    const labelId: ObjectID = ObjectID.generate();
    const findBy: jest.SpyInstance = spyOnFindBy().mockResolvedValue([
      makeModelRow({
        permission: Permission.CreateProjectIncident,
        labelIds: [labelId],
        isBlockPermission: true,
      }),
      makeModelRow({
        // labels intentionally left undefined; isBlockPermission too.
        permission: Permission.ReadProjectMonitor,
      }),
    ] as never);

    const rows: Array<ApiKeyPermissionRow> =
      await ApiKeyPermissionService.findPermissionsByApiKeyId(apiKeyId);

    expect(findBy).toHaveBeenCalledTimes(1);
    const arg: Record<string, any> = findBy.mock.calls[0]![0] as Record<
      string,
      any
    >;
    expect(arg["query"]["apiKeyId"].toString()).toBe(apiKeyId.toString());
    expect(arg["props"]["isRoot"]).toBe(true);
    expect(arg["select"]).toEqual({
      permission: true,
      labels: {
        _id: true,
      },
      isBlockPermission: true,
    });

    expect(rows).toHaveLength(2);
    // Label scope survives the string round-trip through the cache.
    expect(rows[0]!.permission).toBe(Permission.CreateProjectIncident);
    expect(
      rows[0]!.labelIds.map((id: ObjectID) => {
        return id.toString();
      }),
    ).toEqual([labelId.toString()]);
    // A block row stays a block row.
    expect(rows[0]!.isBlockPermission).toBe(true);
    // Undefined labels become [] rather than crashing or staying undefined.
    expect(rows[1]!.labelIds).toEqual([]);
    // isBlockPermission is passed through unchanged, never defaulted.
    expect(rows[1]!.isBlockPermission).toBeUndefined();
  });

  test("serves the second call for the same key from cache", async () => {
    const findBy: jest.SpyInstance = spyOnFindBy().mockResolvedValue([
      makeModelRow({
        permission: Permission.ProjectMember,
        isBlockPermission: false,
      }),
    ] as never);

    const first: Array<ApiKeyPermissionRow> =
      await ApiKeyPermissionService.findPermissionsByApiKeyId(apiKeyId);
    const second: Array<ApiKeyPermissionRow> =
      await ApiKeyPermissionService.findPermissionsByApiKeyId(apiKeyId);

    expect(findBy).toHaveBeenCalledTimes(1);
    expect(second).toHaveLength(1);
    expect(second[0]!.permission).toBe(Permission.ProjectMember);
    expect(second[0]!.isBlockPermission).toBe(false);
    expect(first).toEqual(second);
  });

  test("hits return fresh objects, so mutation cannot poison the cache", async () => {
    const labelId: ObjectID = ObjectID.generate();
    spyOnFindBy().mockResolvedValue([
      makeModelRow({
        permission: Permission.CreateProjectIncident,
        labelIds: [labelId],
        isBlockPermission: false,
      }),
    ] as never);

    const first: Array<ApiKeyPermissionRow> =
      await ApiKeyPermissionService.findPermissionsByApiKeyId(apiKeyId);

    // Mutate everything a caller could reach on the first result.
    first[0]!.labelIds.pop();
    first.pop();

    const second: Array<ApiKeyPermissionRow> =
      await ApiKeyPermissionService.findPermissionsByApiKeyId(apiKeyId);

    expect(second).toHaveLength(1);
    expect(
      second[0]!.labelIds.map((id: ObjectID) => {
        return id.toString();
      }),
    ).toEqual([labelId.toString()]);
    // Distinct object graphs on every call, hit or miss.
    expect(second).not.toBe(first);
    expect(second[0]).not.toBe(first[0]);
  });

  test("caches distinct api keys independently", async () => {
    const otherApiKeyId: ObjectID = ObjectID.generate();
    const findBy: jest.SpyInstance = spyOnFindBy().mockImplementation(((
      options: Record<string, any>,
    ): Promise<Array<ApiKeyPermission>> => {
      const queriedId: string = options["query"]["apiKeyId"].toString();
      return Promise.resolve([
        makeModelRow({
          permission:
            queriedId === apiKeyId.toString()
              ? Permission.ProjectMember
              : Permission.ReadProjectMonitor,
          isBlockPermission: false,
        }),
      ]);
    }) as never);

    const first: Array<ApiKeyPermissionRow> =
      await ApiKeyPermissionService.findPermissionsByApiKeyId(apiKeyId);
    const other: Array<ApiKeyPermissionRow> =
      await ApiKeyPermissionService.findPermissionsByApiKeyId(otherApiKeyId);

    expect(findBy).toHaveBeenCalledTimes(2);
    expect(first[0]!.permission).toBe(Permission.ProjectMember);
    expect(other[0]!.permission).toBe(Permission.ReadProjectMonitor);

    // Both keys are now cached: repeat calls issue no further queries.
    await ApiKeyPermissionService.findPermissionsByApiKeyId(apiKeyId);
    await ApiKeyPermissionService.findPermissionsByApiKeyId(otherApiKeyId);
    expect(findBy).toHaveBeenCalledTimes(2);
  });

  test("a key with zero permission rows still short-circuits the second call", async () => {
    const findBy: jest.SpyInstance = spyOnFindBy().mockResolvedValue(
      [] as never,
    );

    await expect(
      ApiKeyPermissionService.findPermissionsByApiKeyId(apiKeyId),
    ).resolves.toEqual([]);
    await expect(
      ApiKeyPermissionService.findPermissionsByApiKeyId(apiKeyId),
    ).resolves.toEqual([]);

    expect(findBy).toHaveBeenCalledTimes(1);
  });

  test("expires after the 60s TTL and re-queries", async () => {
    const base: number = Date.now();
    let nowMs: number = base;
    jest.spyOn(Date, "now").mockImplementation((): number => {
      return nowMs;
    });

    const findBy: jest.SpyInstance = spyOnFindBy().mockResolvedValue(
      [] as never,
    );

    await ApiKeyPermissionService.findPermissionsByApiKeyId(apiKeyId);
    expect(findBy).toHaveBeenCalledTimes(1);

    // Just inside the TTL: still served from cache.
    nowMs = base + TTL_MS - 1;
    await ApiKeyPermissionService.findPermissionsByApiKeyId(apiKeyId);
    expect(findBy).toHaveBeenCalledTimes(1);

    // Past the TTL: the entry has expired and the key is re-queried.
    nowMs = base + TTL_MS + 1;
    await ApiKeyPermissionService.findPermissionsByApiKeyId(apiKeyId);
    expect(findBy).toHaveBeenCalledTimes(2);
  });

  describe("invalidation", () => {
    type PrimeCacheFunction = () => Promise<jest.SpyInstance>;

    const primeCache: PrimeCacheFunction =
      async (): Promise<jest.SpyInstance> => {
        const findBy: jest.SpyInstance = spyOnFindBy().mockResolvedValue(
          [] as never,
        );
        await ApiKeyPermissionService.findPermissionsByApiKeyId(apiKeyId);
        expect(findBy).toHaveBeenCalledTimes(1);
        return findBy;
      };

    test("clearCache() drops every cached entry", async () => {
      const findBy: jest.SpyInstance = await primeCache();

      ApiKeyPermissionService.clearCache();

      await ApiKeyPermissionService.findPermissionsByApiKeyId(apiKeyId);
      expect(findBy).toHaveBeenCalledTimes(2);
    });

    test("creating a permission clears the cache", async () => {
      const findBy: jest.SpyInstance = await primeCache();

      // The duplicate-permission check inside the hook must find nothing.
      getJestSpyOn(ApiKeyPermissionService, "findOneBy").mockResolvedValue(
        null,
      );

      const data: ApiKeyPermission = new ApiKeyPermission();
      data.apiKeyId = apiKeyId;
      data.projectId = ObjectID.generate();
      data.permission = Permission.ProjectMember;

      await asHooks(ApiKeyPermissionService).onBeforeCreate({
        data: data,
        props: { isRoot: true },
      });

      await ApiKeyPermissionService.findPermissionsByApiKeyId(apiKeyId);
      expect(findBy).toHaveBeenCalledTimes(2);
    });

    test("updating a permission clears the cache", async () => {
      const findBy: jest.SpyInstance = await primeCache();

      await asHooks(ApiKeyPermissionService).onBeforeUpdate({
        query: {},
        data: {},
        props: { isRoot: true },
      });

      await ApiKeyPermissionService.findPermissionsByApiKeyId(apiKeyId);
      expect(findBy).toHaveBeenCalledTimes(2);
    });

    test("deleting a permission clears the cache", async () => {
      const findBy: jest.SpyInstance = await primeCache();

      await asHooks(ApiKeyPermissionService).onBeforeDelete({
        query: {},
        props: { isRoot: true },
      });

      await ApiKeyPermissionService.findPermissionsByApiKeyId(apiKeyId);
      expect(findBy).toHaveBeenCalledTimes(2);
    });
  });
});
