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
 * DatabaseService._updateBy builds the row it saves as a merge of the
 * located row's _id and the caller's update data. With the old merge order
 * `{ _id: item._id, ...data }`, update data carrying an own `_id: undefined`
 * property (a fresh model instance before sanitizeUpdateData existed, or a
 * plain object that spells it out) clobbered the located row's id — TypeORM
 * save() saw no primary key, INSERTed a new row instead of updating, and
 * died on the first NOT NULL column.
 *
 * These tests pin the fixed merge order: the located row's _id must win no
 * matter what shape the update data takes. _findBy is mocked out, so this
 * exercises the save-payload merge in isolation.
 */

type SavedRow = { _id?: string; status?: string; startedAt?: Date };

function mockPersistence(existingRowId: string): jest.Mock {
  const existing: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan();
  existing._id = existingRowId;

  jest
    .spyOn(NetworkDeviceDiscoveryScanService as any, "_findBy")
    .mockResolvedValue([existing] as never);

  const save: jest.Mock = jest
    .fn()
    .mockImplementation(async (row: unknown): Promise<unknown> => {
      return row;
    });

  jest
    .spyOn(NetworkDeviceDiscoveryScanService, "getRepository")
    .mockReturnValue({ save } as any);

  return save;
}

describe("DatabaseService.updateOneById — saved row keeps the located row's _id", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("when data is a fresh model instance (own undefined _id property)", async () => {
    const rowId: string = ObjectID.generate().toString();
    const save: jest.Mock = mockPersistence(rowId);

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

    expect(save).toHaveBeenCalledTimes(1);
    const saved: SavedRow = save.mock.calls[0]![0] as SavedRow;
    expect(saved._id).toBe(rowId);
    expect(saved.status).toBe("In Progress");
  });

  test("when data is a plain partial object", async () => {
    const rowId: string = ObjectID.generate().toString();
    const save: jest.Mock = mockPersistence(rowId);

    await NetworkDeviceDiscoveryScanService.updateOneById({
      id: new ObjectID(rowId),
      data: { status: "In Progress" } as never,
      props: { isRoot: true },
    });

    expect(save).toHaveBeenCalledTimes(1);
    const saved: SavedRow = save.mock.calls[0]![0] as SavedRow;
    expect(saved._id).toBe(rowId);
    expect(saved.status).toBe("In Progress");
  });

  test("when data is a plain object that spells out _id: undefined", async () => {
    const rowId: string = ObjectID.generate().toString();
    const save: jest.Mock = mockPersistence(rowId);

    await NetworkDeviceDiscoveryScanService.updateOneById({
      id: new ObjectID(rowId),
      data: { _id: undefined, status: "In Progress" } as never,
      props: { isRoot: true },
    });

    expect(save).toHaveBeenCalledTimes(1);
    const saved: SavedRow = save.mock.calls[0]![0] as SavedRow;
    expect(saved._id).toBe(rowId);
    expect(saved.status).toBe("In Progress");
  });
});
