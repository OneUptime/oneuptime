import NetworkDeviceDiscoveryScan from "../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import NetworkDeviceDiscoveryScanService from "../../../Server/Services/NetworkDeviceDiscoveryScanService";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * Regression tests for the second layer of the discovery-scan "stuck
 * Pending" bug (the first layer — model instances poisoning the internal
 * find's select columns — is covered in
 * DatabaseServiceSanitizeUpdateData.test.ts).
 *
 * DatabaseService._updateBy targets the write at the located row's _id and
 * the caller's update data. With the old save-payload merge order
 * `{ _id: item._id, ...data }`, update data carrying an own `_id: undefined`
 * property (a fresh model instance before sanitizeUpdateData existed, or a
 * plain object that spells it out) clobbered the located row's id — TypeORM
 * save() saw no primary key, INSERTed a new row instead of updating, and
 * died on the first NOT NULL column.
 *
 * Scalar-only updates now go through repository.update() (never inserts, so
 * it cannot resurrect a concurrently-deleted row), which takes the located
 * row's _id as its WHERE clause and the sanitized columns as the SET. These
 * tests pin that down: the located row's _id must target the write no matter
 * what shape the update data takes, and _id must never leak into the SET
 * payload. _findBy is mocked out, so this exercises the write in isolation.
 */

type WhereClause = { _id?: string };
type UpdatePayload = { _id?: string; status?: string; startedAt?: Date };

function mockPersistence(existingRowId: string): jest.Mock {
  const existing: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan();
  existing._id = existingRowId;

  jest
    .spyOn(NetworkDeviceDiscoveryScanService as any, "_findBy")
    .mockResolvedValue([existing] as never);

  const update: jest.Mock = jest
    .fn()
    .mockImplementation(async (): Promise<unknown> => {
      return { affected: 1 };
    });

  jest
    .spyOn(NetworkDeviceDiscoveryScanService, "getRepository")
    .mockReturnValue({ update } as any);

  return update;
}

describe("DatabaseService.updateOneById — the write targets the located row's _id", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("when data is a fresh model instance (own undefined _id property)", async () => {
    const rowId: string = ObjectID.generate().toString();
    const update: jest.Mock = mockPersistence(rowId);

    const data: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan();
    data.status = "In Progress";
    data.startedAt = new Date();

    // The bug's precondition: the instance really does carry _id: undefined.
    expect(Object.keys(data)).toContain("_id");

    await NetworkDeviceDiscoveryScanService.updateOneById({
      id: new ObjectID(rowId),
      data: data as never,
      props: { isRoot: true },
    });

    expect(update).toHaveBeenCalledTimes(1);
    const where: WhereClause = update.mock.calls[0]![0] as WhereClause;
    const payload: UpdatePayload = update.mock.calls[0]![1] as UpdatePayload;
    expect(where._id).toBe(rowId);
    expect(payload.status).toBe("In Progress");
    // _id must never leak into the SET payload — it is the WHERE, not a column.
    expect(payload._id).toBeUndefined();
  });

  test("when data is a plain partial object", async () => {
    const rowId: string = ObjectID.generate().toString();
    const update: jest.Mock = mockPersistence(rowId);

    await NetworkDeviceDiscoveryScanService.updateOneById({
      id: new ObjectID(rowId),
      data: { status: "In Progress" } as never,
      props: { isRoot: true },
    });

    expect(update).toHaveBeenCalledTimes(1);
    const where: WhereClause = update.mock.calls[0]![0] as WhereClause;
    const payload: UpdatePayload = update.mock.calls[0]![1] as UpdatePayload;
    expect(where._id).toBe(rowId);
    expect(payload.status).toBe("In Progress");
    expect(payload._id).toBeUndefined();
  });

  test("when data is a plain object that spells out _id: undefined", async () => {
    const rowId: string = ObjectID.generate().toString();
    const update: jest.Mock = mockPersistence(rowId);

    await NetworkDeviceDiscoveryScanService.updateOneById({
      id: new ObjectID(rowId),
      data: { _id: undefined, status: "In Progress" } as never,
      props: { isRoot: true },
    });

    expect(update).toHaveBeenCalledTimes(1);
    const where: WhereClause = update.mock.calls[0]![0] as WhereClause;
    const payload: UpdatePayload = update.mock.calls[0]![1] as UpdatePayload;
    expect(where._id).toBe(rowId);
    expect(payload.status).toBe("In Progress");
    expect(payload._id).toBeUndefined();
  });
});
