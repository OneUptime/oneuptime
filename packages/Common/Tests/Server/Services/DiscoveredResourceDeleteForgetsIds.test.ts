import DatabaseService from "../../../Server/Services/DatabaseService";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import PublishedImages from "../../../Server/Utils/File/PublishedImages";
import StatusPageOverviewCache from "../../../Server/Utils/StatusPage/StatusPageOverviewCache";
import DiscoveredResourceIdCache from "../../../Server/Utils/Telemetry/DiscoveredResourceIdCache";
import DockerHost from "../../../Models/DatabaseModels/DockerHost";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import IncidentInternalNote from "../../../Models/DatabaseModels/IncidentInternalNote";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * EVERY DELETE OF A DISCOVERED RESOURCE FORGETS ITS IDS (issue #5214).
 *
 * The ingest caches kept a deleted Docker host's id for a day. Forgetting it
 * in one service's hook would miss every delete that skips the hooks - a
 * bulk delete, a workflow's, a retention purge (hardDeleteBy) - so it is
 * done where every delete goes: DatabaseService reads the column ingest
 * found the row by (DiscoveredResourceIdCache.getColumnsToRead) with the
 * rows it deletes, and hands them to DiscoveredResourceIdCache.afterDelete
 * once the DELETE is done. Pinned here for both delete paths, with and
 * without hooks, for a discovered kind and for any other table.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5e000000-0000-4000-8000-00000000a001",
);
const HOST_ID: ObjectID = new ObjectID("5f000000-0000-4000-8000-00000000a001");

interface Read {
  select: Record<string, unknown>;
}

function serviceOf<TModel extends BaseModel>(
  model: { new (): TModel },
  rows: Array<TModel>,
  reads: Array<Read>,
  deleteFails: boolean = false,
): DatabaseService<TModel> {
  const service: DatabaseService<TModel> = new DatabaseService<TModel>(model);

  jest.spyOn(service as never, "_findBy").mockImplementation((async (findBy: {
    select: Record<string, unknown>;
  }): Promise<Array<TModel>> => {
    reads.push({ select: { ...(findBy.select || {}) } });
    return rows;
  }) as never);
  jest
    .spyOn(service as never, "readRowsShowingImages")
    .mockImplementation((async (items: Array<TModel>) => {
      return items;
    }) as never);
  jest
    .spyOn(service as never, "readRowsDeletedWith")
    .mockResolvedValue([] as never);
  jest
    .spyOn(service as never, "keepRowsCallerMayWrite")
    .mockResolvedValue(true as never);
  jest
    .spyOn(service as never, "checkCallerBeforeHooks")
    .mockImplementation((async (props: unknown) => {
      return props;
    }) as never);
  jest
    .spyOn(service as never, "getRealtimeAccessBeforeDelete")
    .mockResolvedValue(new Map() as never);
  jest
    .spyOn(service, "onTriggerWorkflow")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(service, "onTriggerRealtime" as never)
    .mockResolvedValue(undefined as never);
  jest.spyOn(service, "getRepository").mockReturnValue({
    delete: async (): Promise<{ affected: number }> => {
      if (deleteFails) {
        throw new Error("The database could not delete the row");
      }
      return { affected: rows.length };
    },
  } as never);

  return service;
}

function dockerHost(identifier: string): DockerHost {
  const host: DockerHost = new DockerHost();
  host._id = HOST_ID.toString();
  host.projectId = PROJECT_ID;
  host.hostIdentifier = identifier;
  return host;
}

describe("a delete of a discovered resource forgets its ids", () => {
  let afterDelete: jest.SpyInstance;

  beforeEach(() => {
    jest
      .spyOn(ModelPermission, "checkDeleteQueryPermission")
      .mockImplementation((async (_type: unknown, query: unknown) => {
        return query;
      }) as never);
    jest
      .spyOn(PublishedImages, "afterDelete")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(StatusPageOverviewCache, "afterDelete")
      .mockResolvedValue(undefined as never);
    afterDelete = jest
      .spyOn(DiscoveredResourceIdCache, "afterDelete")
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("deleteBy reads the host name with the rows, and hands them to the cache after the DELETE", async () => {
    const reads: Array<Read> = [];
    const service: DatabaseService<DockerHost> = serviceOf(
      DockerHost,
      [dockerHost("test01")],
      reads,
    );

    await service.deleteBy({
      query: { _id: HOST_ID.toString() },
      limit: 1,
      skip: 0,
      props: { isRoot: true },
    });

    expect(reads.length).toBeGreaterThan(0);
    expect(reads[reads.length - 1]!.select).toMatchObject({
      hostIdentifier: true,
      projectId: true,
    });

    expect(afterDelete).toHaveBeenCalledTimes(1);
    const handed: { tableName: string; rows: Array<DockerHost> } = afterDelete
      .mock.calls[0]![0] as { tableName: string; rows: Array<DockerHost> };
    expect(handed.tableName).toBe("DockerHost");
    expect(handed.rows).toHaveLength(1);
    expect(handed.rows[0]!.hostIdentifier).toBe("test01");
    expect(handed.rows[0]!.projectId?.toString()).toBe(PROJECT_ID.toString());
  });

  test("a delete that skips the hooks forgets too - a bulk delete, a workflow's", async () => {
    const reads: Array<Read> = [];
    const service: DatabaseService<DockerHost> = serviceOf(
      DockerHost,
      [dockerHost("test01")],
      reads,
    );

    await service.deleteBy({
      query: { _id: HOST_ID.toString() },
      limit: 1,
      skip: 0,
      props: { isRoot: true, ignoreHooks: true },
    });

    expect(afterDelete).toHaveBeenCalledTimes(1);
  });

  test("hardDeleteBy reads the host name and forgets too - the retention purge", async () => {
    const reads: Array<Read> = [];
    const service: DatabaseService<DockerHost> = serviceOf(
      DockerHost,
      [dockerHost("test01")],
      reads,
    );

    await service.hardDeleteBy({
      query: { _id: HOST_ID.toString() },
      limit: 1,
      skip: 0,
      props: { isRoot: true },
    });

    expect(reads[0]!.select).toMatchObject({
      hostIdentifier: true,
      projectId: true,
    });
    expect(afterDelete).toHaveBeenCalledTimes(1);
    expect(
      (afterDelete.mock.calls[0]![0] as { tableName: string }).tableName,
    ).toBe("DockerHost");
  });

  test("a cloud resource's delete reads its resource identifier", async () => {
    const reads: Array<Read> = [];
    const row: CloudResource = new CloudResource();
    row._id = HOST_ID.toString();
    row.projectId = PROJECT_ID;
    row.resourceIdentifier = "aws_ecs|123456789012|us-east-1";

    const service: DatabaseService<CloudResource> = serviceOf(
      CloudResource,
      [row],
      reads,
    );

    await service.deleteBy({
      query: { _id: HOST_ID.toString() },
      limit: 1,
      skip: 0,
      props: { isRoot: true },
    });

    expect(reads[reads.length - 1]!.select).toMatchObject({
      resourceIdentifier: true,
    });
  });

  test("a delete the database refuses forgets nothing", async () => {
    const reads: Array<Read> = [];
    const service: DatabaseService<DockerHost> = serviceOf(
      DockerHost,
      [dockerHost("test01")],
      reads,
      true,
    );

    await expect(
      service.deleteBy({
        query: { _id: HOST_ID.toString() },
        limit: 1,
        skip: 0,
        props: { isRoot: true },
      }),
    ).rejects.toThrow();

    expect(afterDelete).not.toHaveBeenCalled();
  });

  test("a delete that found nothing forgets nothing", async () => {
    const reads: Array<Read> = [];
    const service: DatabaseService<DockerHost> = serviceOf(
      DockerHost,
      [],
      reads,
    );

    await service.deleteBy({
      query: { _id: HOST_ID.toString() },
      limit: 1,
      skip: 0,
      props: { isRoot: true },
    });

    expect(afterDelete).not.toHaveBeenCalled();
  });

  test("any other table reads nothing more, and the cache does nothing with it", async () => {
    const reads: Array<Read> = [];
    const note: IncidentInternalNote = new IncidentInternalNote();
    note._id = HOST_ID.toString();
    note.projectId = PROJECT_ID;

    const service: DatabaseService<IncidentInternalNote> = serviceOf(
      IncidentInternalNote,
      [note],
      reads,
    );

    afterDelete.mockRestore();
    const forget: jest.SpyInstance = jest.spyOn(
      DiscoveredResourceIdCache,
      "forget",
    );

    await service.deleteBy({
      query: { _id: HOST_ID.toString() },
      limit: 1,
      skip: 0,
      props: { isRoot: true },
    });

    for (const read of reads) {
      expect(Object.keys(read.select)).not.toContain("hostIdentifier");
    }
    expect(forget).not.toHaveBeenCalled();
  });
});
