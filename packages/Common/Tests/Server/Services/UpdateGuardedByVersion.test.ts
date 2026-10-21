import NetworkDeviceDiscoveryScan from "../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import NetworkDeviceDiscoveryScanService from "../../../Server/Services/NetworkDeviceDiscoveryScanService";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * An update whose query names the row's version is a compare-and-set: the
 * UPDATE itself asks for that version too, not only the find before it.
 *
 * The workflow Update steps merge custom fields into what a record holds
 * (https://github.com/OneUptime/oneuptime/issues/4469) and write the merged
 * bag guarded by the version they read it at. _updateBy finds the rows and
 * then writes each one in a statement of its own, so a guard asked only of
 * the find would let a write landing in between be overwritten with a bag
 * merged from what the row used to hold.
 *
 * _findBy is mocked, so this exercises the write in isolation, as
 * UpdateOneByIdKeepsRowId.test.ts does.
 */

interface WhereClause {
  _id?: string;
  version?: number;
}

function mockPersistence(
  existingRowId: string,
  affected: number = 1,
): jest.Mock {
  const existing: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan();
  existing._id = existingRowId;

  jest
    .spyOn(NetworkDeviceDiscoveryScanService as any, "_findBy")
    .mockResolvedValue([existing] as never);

  const update: jest.Mock = jest
    .fn()
    .mockImplementation(async (): Promise<unknown> => {
      return { affected: affected };
    });

  jest
    .spyOn(NetworkDeviceDiscoveryScanService, "getRepository")
    .mockReturnValue({ update } as any);

  return update;
}

describe("DatabaseService update - a query that names the version guards the write", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the UPDATE asks for the version the query named", async () => {
    const rowId: string = ObjectID.generate().toString();
    const update: jest.Mock = mockPersistence(rowId);

    const updated: number = await NetworkDeviceDiscoveryScanService.updateOneBy(
      {
        query: { _id: rowId, version: 4 } as never,
        data: { status: "In Progress" } as never,
        props: { isRoot: true },
      },
    );

    expect(updated).toBe(1);
    expect(update).toHaveBeenCalledTimes(1);

    const where: WhereClause = update.mock.calls[0]![0] as WhereClause;

    expect(where._id).toBe(rowId);
    expect(where.version).toBe(4);
  });

  test("reports nothing updated when the row moved past that version", async () => {
    const rowId: string = ObjectID.generate().toString();
    mockPersistence(rowId, 0);

    const onUpdateSuccess: jest.SpyInstance = jest.spyOn(
      NetworkDeviceDiscoveryScanService as any,
      "onUpdateSuccess",
    );

    const updated: number = await NetworkDeviceDiscoveryScanService.updateOneBy(
      {
        query: { _id: rowId, version: 4 } as never,
        data: { status: "In Progress" } as never,
        props: { isRoot: true },
      },
    );

    expect(updated).toBe(0);
    // The hook still runs, as it does for a query matching nothing - with no rows.
    expect(onUpdateSuccess).toHaveBeenCalledTimes(1);
    expect(onUpdateSuccess.mock.calls[0]![1]).toEqual([]);
  });

  test("an update that names no version writes by the row's _id alone, as before", async () => {
    const rowId: string = ObjectID.generate().toString();
    const update: jest.Mock = mockPersistence(rowId);

    await NetworkDeviceDiscoveryScanService.updateOneBy({
      query: { _id: rowId } as never,
      data: { status: "In Progress" } as never,
      props: { isRoot: true },
    });

    const where: WhereClause = update.mock.calls[0]![0] as WhereClause;

    expect(where).toEqual({ _id: rowId });
  });

  test("a version that is not a plain number is left to the find", async () => {
    const rowId: string = ObjectID.generate().toString();
    const update: jest.Mock = mockPersistence(rowId);

    await NetworkDeviceDiscoveryScanService.updateOneBy({
      query: { _id: rowId, version: "4" } as never,
      data: { status: "In Progress" } as never,
      props: { isRoot: true },
    });

    const where: WhereClause = update.mock.calls[0]![0] as WhereClause;

    expect(where).toEqual({ _id: rowId });
  });
});
