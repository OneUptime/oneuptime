import NetworkDeviceDiscoveryScanService from "../../../Server/Services/NetworkDeviceDiscoveryScanService";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import NetworkDeviceDiscoveryScan from "../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import Probe from "../../../Models/DatabaseModels/Probe";
import ObjectID from "../../../Types/ObjectID";
import { JSONObject } from "../../../Types/JSON";
import getJestMockFunction, { MockFunction } from "../../MockType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Regression tests for the write-routing contract introduced by
 * "updates must never resurrect concurrently-deleted rows".
 *
 * DatabaseService._updateBy chooses its persistence primitive by whether the
 * sanitized update data touches an EntityArray (many-to-many) column:
 *
 *   - everything else -> repository.update(): a WHERE-clause UPDATE that
 *     never INSERTs, so a row hard-deleted between the internal find and the
 *     write simply gets zero rows affected instead of being resurrected as a
 *     zombie. The @VersionColumn bump save() did for free is emulated with an
 *     atomic `"version" + 1` SQL expression in the SET.
 *
 *   - updates touching an EntityArray column -> repository.save(): only
 *     many-to-many writes need TypeORM's junction-table handling.
 *
 * Entity (many-to-one) columns deliberately take the update() path. They are
 * ordinary foreign-key columns on the row itself, and TypeORM resolves a
 * relation property to its join columns. Routing them to save() left the
 * resurrection hole open for any caller expressing the write as the relation
 * member instead of the scalar id — Monitor.currentMonitorStatus and
 * Monitor.currentMonitorStatusId are two decorated members over the SAME
 * physical column, and a save() through the former could re-INSERT a
 * concurrently-deleted Monitor, permanently blocking deletion of the
 * MonitorStatus it pointed at.
 *
 * These tests pin the routing itself (which primitive fires for which data
 * shape), which is the exact behaviour a future refactor of _updateBy could
 * silently break. NetworkDeviceDiscoveryScan has a plain scalar column
 * (`status`) and an Entity relation column (`probe`); Monitor supplies the
 * EntityArray case (`labels`) and the two-members-one-column case.
 */

type ScanUpdateData = UpdateBy<NetworkDeviceDiscoveryScan>["data"];

describe("DatabaseService._updateBy — save() vs update() write routing", () => {
  let saveMock: MockFunction;
  let updateMock: MockFunction;
  let scanId: ObjectID;

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();

    scanId = ObjectID.generate();

    const foundItem: NetworkDeviceDiscoveryScan =
      new NetworkDeviceDiscoveryScan();
    foundItem._id = scanId.toString();

    jest
      .spyOn(NetworkDeviceDiscoveryScanService as any, "_findBy")
      .mockResolvedValue([foundItem] as never);

    saveMock = getJestMockFunction();
    saveMock.mockImplementation((item: unknown) => {
      return Promise.resolve(item);
    });
    updateMock = getJestMockFunction();
    updateMock.mockImplementation(() => {
      return Promise.resolve({ affected: 1 });
    });
    jest
      .spyOn(NetworkDeviceDiscoveryScanService, "getRepository")
      .mockReturnValue({ save: saveMock, update: updateMock } as never);

    // The permission layer needs a DB and is not what these tests exercise.
    jest
      .spyOn(ModelPermission, "checkUpdatePermissionByModel")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(ModelPermission, "checkUpdateQueryPermissions")
      .mockImplementation(((
        _modelType: unknown,
        query: unknown,
      ): Promise<unknown> => {
        return Promise.resolve(query);
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a scalar-only update goes through update(), never save()", async () => {
    await NetworkDeviceDiscoveryScanService.updateOneById({
      id: scanId,
      data: { status: "In Progress" } as ScanUpdateData,
      props: { isRoot: true },
    });

    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(saveMock).not.toHaveBeenCalled();
  });

  test("the scalar update() targets the located _id and never puts _id in the SET", async () => {
    await NetworkDeviceDiscoveryScanService.updateOneById({
      id: scanId,
      data: { status: "In Progress" } as ScanUpdateData,
      props: { isRoot: true },
    });

    const whereClause: JSONObject = updateMock.mock.calls[0]![0] as JSONObject;
    const setPayload: JSONObject = updateMock.mock.calls[0]![1] as JSONObject;

    expect(whereClause["_id"]).toBe(scanId.toString());
    expect(setPayload["status"]).toBe("In Progress");
    expect(setPayload["_id"]).toBeUndefined();
  });

  test("the scalar update() emulates the version bump with an SQL expression, not a literal", async () => {
    await NetworkDeviceDiscoveryScanService.updateOneById({
      id: scanId,
      data: { status: "In Progress" } as ScanUpdateData,
      props: { isRoot: true },
    });

    const setPayload: JSONObject = updateMock.mock.calls[0]![1] as JSONObject;
    const versionValue: unknown = setPayload["version"];

    /*
     * A function (SQL expression thunk) is what keeps the bump atomic and
     * race-free; a plain number would clobber a concurrent writer's bump.
     */
    expect(typeof versionValue).toBe("function");
    expect((versionValue as () => string)()).toBe('"version" + 1');
  });

  test("an Entity (many-to-one) column takes update(), not save() — it is just an FK on this row", async () => {
    const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan();
    scan.status = "Completed";
    scan.probe = new Probe(ObjectID.generate());

    await NetworkDeviceDiscoveryScanService.updateOneById({
      id: scanId,
      data: scan as unknown as ScanUpdateData,
      props: { isRoot: true },
    });

    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(saveMock).not.toHaveBeenCalled();
  });

  test("a row deleted between the find and the write is not resurrected and reports no rows affected", async () => {
    updateMock.mockImplementation(() => {
      // The concurrent hard delete already removed the row.
      return Promise.resolve({ affected: 0 });
    });

    const updatedCount: number =
      await NetworkDeviceDiscoveryScanService.updateOneById({
        id: scanId,
        data: { status: "In Progress" } as ScanUpdateData,
        props: { isRoot: true },
      });

    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(saveMock).not.toHaveBeenCalled();
    expect(updatedCount).toBe(0);
  });
});
