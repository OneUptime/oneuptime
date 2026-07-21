import NetworkDeviceDiscoveryScanService from "../../../Server/Services/NetworkDeviceDiscoveryScanService";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import NetworkDeviceDiscoveryScan from "../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Probe from "../../../Models/DatabaseModels/Probe";
import ObjectID from "../../../Types/ObjectID";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import Select from "../../../Server/Types/Database/Select";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

type ScanUpdateData = UpdateBy<NetworkDeviceDiscoveryScan>["data"];

/*
 * Regression tests for the bug that left every SNMP discovery scan stuck in
 * "Pending": update `data` passed as a full model instance carries the
 * non-column own properties of DatabaseBaseModel (column initializers plus
 * `isPermissionIf = {}`). _updateBy used to turn every data key into a select
 * column for its internal find, and the unknown `isPermissionIf` column made
 * that find throw `TableColumnMetadata not found for isPermissionIf column`,
 * failing the whole update — so the probe-ingest list endpoint 400'd before
 * it could claim a scan.
 *
 * sanitizeUpdateData is the fix: model instances are stripped down to their
 * set table columns before the update pipeline runs.
 */

describe("DatabaseService.sanitizeUpdateData — model instances become plain column data", () => {
  test("a fresh model instance really does carry non-column own properties (the trap this guards against)", () => {
    const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan();

    /*
     * If this stops holding, the base model changed shape and these tests
     * (and sanitizeUpdateData itself) should be revisited.
     */
    expect(Object.keys(scan)).toContain("isPermissionIf");
  });

  test("keeps only the columns that were actually set", () => {
    const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan();
    scan.status = "In Progress";
    scan.startedAt = OneUptimeDate.getCurrentDate();

    const data: ScanUpdateData = NetworkDeviceDiscoveryScanService[
      "sanitizeUpdateData"
    ](scan as unknown as ScanUpdateData);

    expect(Object.keys(data as JSONObject).sort()).toEqual([
      "startedAt",
      "status",
    ]);
    expect((data as JSONObject)["status"]).toBe("In Progress");
    expect((data as JSONObject)["startedAt"]).toBeInstanceOf(Date);
  });

  test("the result is a plain object, not a model instance", () => {
    const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan();
    scan.status = "Completed";

    const data: ScanUpdateData = NetworkDeviceDiscoveryScanService[
      "sanitizeUpdateData"
    ](scan as unknown as ScanUpdateData);

    expect(data).not.toBeInstanceOf(DatabaseBaseModel);
    expect(Object.getPrototypeOf(data)).toBe(Object.prototype);
  });

  test("drops isPermissionIf and every other non-column own property", () => {
    const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan();
    scan.status = "Completed";

    const data: ScanUpdateData = NetworkDeviceDiscoveryScanService[
      "sanitizeUpdateData"
    ](scan as unknown as ScanUpdateData);

    expect(Object.keys(data as JSONObject)).not.toContain("isPermissionIf");
  });

  test("drops columns left undefined so they cannot become writes", () => {
    const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan();
    scan.status = "Failed";
    // cidr, snmpVersion, statusMessage etc. stay undefined.

    const data: ScanUpdateData = NetworkDeviceDiscoveryScanService[
      "sanitizeUpdateData"
    ](scan as unknown as ScanUpdateData);

    expect(Object.keys(data as JSONObject)).toEqual(["status"]);
  });

  test("preserves explicit null so columns can still be cleared", () => {
    const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan();
    scan.status = "Pending";
    (scan as any).statusMessage = null;
    (scan as any).nextScanAt = null;

    const data: ScanUpdateData = NetworkDeviceDiscoveryScanService[
      "sanitizeUpdateData"
    ](scan as unknown as ScanUpdateData);

    expect((data as JSONObject)["statusMessage"]).toBeNull();
    expect((data as JSONObject)["nextScanAt"]).toBeNull();
  });

  test("drops _id, createdAt, updatedAt and version even when set (loaded-model updates must not redirect the write or forge timestamps)", () => {
    const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan(
      ObjectID.generate(),
    );
    scan.status = "Completed";
    (scan as any).createdAt = OneUptimeDate.getCurrentDate();
    (scan as any).updatedAt = OneUptimeDate.getCurrentDate();
    (scan as any).version = 7;

    const data: ScanUpdateData = NetworkDeviceDiscoveryScanService[
      "sanitizeUpdateData"
    ](scan as unknown as ScanUpdateData);

    expect(Object.keys(data as JSONObject)).toEqual(["status"]);
  });

  test("keeps entity relation columns that were set", () => {
    const probeId: ObjectID = ObjectID.generate();
    const scan: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan();
    scan.status = "Pending";
    scan.probe = new Probe(probeId);

    const data: ScanUpdateData = NetworkDeviceDiscoveryScanService[
      "sanitizeUpdateData"
    ](scan as unknown as ScanUpdateData);

    expect((data as JSONObject)["probe"]).toBeInstanceOf(Probe);
    expect(((data as JSONObject)["probe"] as Probe).id?.toString()).toBe(
      probeId.toString(),
    );
  });

  test("plain objects pass through by reference, unknown keys and all (typos must keep failing loudly)", () => {
    const plain: JSONObject = {
      status: "Completed",
      someTypoColumn: 1,
    };

    const data: ScanUpdateData = NetworkDeviceDiscoveryScanService[
      "sanitizeUpdateData"
    ](plain as unknown as ScanUpdateData);

    expect(data).toBe(plain);
    expect(Object.keys(data as JSONObject)).toContain("someTypoColumn");
  });
});

describe("DatabaseService._updateBy — updateOneById with a model instance no longer poisons the internal find", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("select columns for the internal find contain only real columns from the data", async () => {
    const scanId: ObjectID = ObjectID.generate();

    const foundItem: NetworkDeviceDiscoveryScan =
      new NetworkDeviceDiscoveryScan();
    foundItem._id = scanId.toString();

    // eslint-disable-next-line @typescript-eslint/typedef
    const findBySpy = jest
      .spyOn(NetworkDeviceDiscoveryScanService as any, "_findBy")
      .mockResolvedValue([foundItem] as never);

    // eslint-disable-next-line @typescript-eslint/typedef
    const saveMock = jest.fn((item: unknown) => {
      return Promise.resolve(item);
    });
    jest
      .spyOn(NetworkDeviceDiscoveryScanService, "getRepository")
      .mockReturnValue({ save: saveMock } as never);

    // Permission layer is not under test here and needs no DB.
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

    const inProgress: NetworkDeviceDiscoveryScan =
      new NetworkDeviceDiscoveryScan();
    inProgress.status = "In Progress";
    inProgress.startedAt = OneUptimeDate.getCurrentDate();

    /*
     * Before the fix this call rejected with "TableColumnMetadata not found
     * for isPermissionIf column" — reproducing exactly why discovery scans
     * never left Pending.
     */
    await expect(
      NetworkDeviceDiscoveryScanService.updateOneById({
        id: scanId,
        data: inProgress as unknown as UpdateBy<NetworkDeviceDiscoveryScan>["data"],
        props: {
          isRoot: true,
        },
      }),
    ).resolves.toBeUndefined();

    expect(findBySpy).toHaveBeenCalledTimes(1);
    const findArgs: { select: Select<NetworkDeviceDiscoveryScan> } = (
      findBySpy.mock.calls[0] as Array<any>
    )[0];
    const selectedColumns: Array<string> = Object.keys(findArgs.select);

    // The data columns plus _id and the tenant column — nothing else.
    expect(selectedColumns.sort()).toEqual(
      ["_id", "projectId", "startedAt", "status"].sort(),
    );
    expect(selectedColumns).not.toContain("isPermissionIf");

    // The persisted payload is the plain data plus the located row's _id.
    expect(saveMock).toHaveBeenCalledTimes(1);
    const savedItem: JSONObject = saveMock.mock.calls[0]![0] as JSONObject;
    expect(Object.keys(savedItem).sort()).toEqual(
      ["_id", "startedAt", "status"].sort(),
    );
    expect(savedItem["status"]).toBe("In Progress");
    expect(savedItem["_id"]).toBe(scanId.toString());
  });
});
