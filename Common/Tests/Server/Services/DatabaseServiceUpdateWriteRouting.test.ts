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
 * sanitized update data touches a RELATION column (a column whose
 * TableColumn metadata type is Entity/EntityArray):
 *
 *   - scalar-only updates -> repository.update(): a WHERE-clause UPDATE that
 *     never INSERTs, so a row hard-deleted between the internal find and the
 *     write simply gets zero rows affected instead of being resurrected as a
 *     zombie. The @VersionColumn bump save() did for free is emulated with an
 *     atomic `"version" + 1` SQL expression in the SET.
 *
 *   - updates that touch a relation column -> repository.save(): keeps
 *     TypeORM's junction-table handling for the relation.
 *
 * These tests pin the routing itself (which primitive fires for which data
 * shape), which is the exact behaviour a future refactor of _updateBy could
 * silently break — reintroducing the zombie-resurrection bug or losing
 * relation writes. NetworkDeviceDiscoveryScan is used because it has both a
 * plain scalar column (`status`) and an Entity relation column (`probe`).
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

  test("an update that touches a relation column goes through save(), never update()", async () => {
    const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan();
    scan.status = "Completed";
    scan.probe = new Probe(ObjectID.generate());

    await NetworkDeviceDiscoveryScanService.updateOneById({
      id: scanId,
      data: scan as unknown as ScanUpdateData,
      props: { isRoot: true },
    });

    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(updateMock).not.toHaveBeenCalled();
  });

  test("the relation save() payload carries the located row's _id so it updates rather than inserts", async () => {
    const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan();
    scan.probe = new Probe(ObjectID.generate());

    await NetworkDeviceDiscoveryScanService.updateOneById({
      id: scanId,
      data: scan as unknown as ScanUpdateData,
      props: { isRoot: true },
    });

    const savedItem: JSONObject = saveMock.mock.calls[0]![0] as JSONObject;
    expect(savedItem["_id"]).toBe(scanId.toString());
  });
});
