/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it (DatabaseService, the base class of
 * every concrete service, imports it). Nothing password-related is under
 * test here, so the module is replaced WITH A FACTORY — an automock would
 * still require (and type-check) the real file.
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

import NetworkDeviceDiscoveryScanService from "../../../Server/Services/NetworkDeviceDiscoveryScanService";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import ConfigLogLevel from "../../../Server/Types/ConfigLogLevel";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import logger from "../../../Server/Utils/Logger";
import NetworkDeviceDiscoveryScan from "../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import ObjectID from "../../../Types/ObjectID";
import { JSONObject } from "../../../Types/JSON";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Regression tests for the log-level gate on _updateBy's per-row debug
 * logging.
 *
 * _updateBy used to build a pretty-printed JSON.stringify(updatedItem,
 * null, 2) for EVERY matched row of EVERY update, unconditionally — and
 * logger.debug then discarded it at the default INFO level. That was pure
 * per-row CPU and allocation fleet-wide, and it also meant a payload whose
 * serialization throws (e.g. a circular structure) failed the whole update
 * even though nothing would ever be logged.
 *
 * The fix hoists a single logger.getLogLevel() check above the per-item loop
 * and only enters the debug-logging block (stringify + LogAttributes
 * allocation) when the level is DEBUG. These tests pin:
 *
 *   - at INFO: the block is skipped entirely (no debug calls, no stringify,
 *     one level read for the whole update rather than per row), and the
 *     write itself is untouched;
 *   - at DEBUG: logger.debug receives the byte-identical pretty-printed
 *     payload it always did;
 *   - the one blessed semantic delta: a payload whose serialization throws
 *     now only throws at DEBUG level.
 */

type ScanUpdateData = UpdateBy<NetworkDeviceDiscoveryScan>["data"];

describe("DatabaseService._updateBy — per-row debug logging is gated on the log level", () => {
  let saveMock: MockFunction;
  let updateMock: MockFunction;
  let debugSpy: MockFunction;
  let getLogLevelSpy: MockFunction;

  const mockFoundItems: (ids: Array<ObjectID>) => void = (
    ids: Array<ObjectID>,
  ): void => {
    const items: Array<NetworkDeviceDiscoveryScan> = ids.map((id: ObjectID) => {
      const item: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan();
      item._id = id.toString();
      return item;
    });

    jest
      .spyOn(NetworkDeviceDiscoveryScanService as any, "_findBy")
      .mockResolvedValue(items as never);
  };

  const setLogLevel: (level: ConfigLogLevel) => void = (
    level: ConfigLogLevel,
  ): void => {
    getLogLevelSpy = jest
      .spyOn(logger, "getLogLevel")
      .mockReturnValue(level) as unknown as MockFunction;
  };

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();

    debugSpy = jest.spyOn(logger, "debug").mockImplementation(() => {
      return undefined;
    }) as unknown as MockFunction;

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
    /*
     * Restores logger.getLogLevel / logger.debug so other suites see the
     * real log level again.
     */
    jest.restoreAllMocks();
  });

  test("at INFO, an update whose payload JSON.stringify would throw on still completes", async () => {
    setLogLevel(ConfigLogLevel.INFO);

    const scanId: ObjectID = ObjectID.generate();
    mockFoundItems([scanId]);

    const circular: JSONObject = { name: "loop" };
    circular["self"] = circular;
    expect(() => {
      return JSON.stringify(circular);
    }).toThrow();

    const updatedCount: number =
      await NetworkDeviceDiscoveryScanService.updateOneById({
        id: scanId,
        data: { status: circular } as unknown as ScanUpdateData,
        props: { isRoot: true },
      });

    expect(updatedCount).toBe(1);
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(saveMock).not.toHaveBeenCalled();

    /*
     * The write payload is untouched: the very same object reference lands
     * in the SET, never a serialized copy.
     */
    const whereClause: JSONObject = updateMock.mock.calls[0]![0] as JSONObject;
    const setPayload: JSONObject = updateMock.mock.calls[0]![1] as JSONObject;
    expect(whereClause["_id"]).toBe(scanId.toString());
    expect(setPayload["status"]).toBe(circular);
  });

  test("at INFO, logger.debug is never called for any matched row", async () => {
    setLogLevel(ConfigLogLevel.INFO);

    const scanIds: Array<ObjectID> = [
      ObjectID.generate(),
      ObjectID.generate(),
      ObjectID.generate(),
    ];
    mockFoundItems(scanIds);

    const updatedCount: number =
      await NetworkDeviceDiscoveryScanService.updateBy({
        query: {},
        data: { status: "In Progress" } as ScanUpdateData,
        limit: scanIds.length,
        skip: 0,
        props: { isRoot: true },
      });

    // On the old code this was two debug calls per row (six here).
    expect(debugSpy).not.toHaveBeenCalled();

    // The write itself is unchanged.
    expect(updatedCount).toBe(scanIds.length);
    expect(updateMock).toHaveBeenCalledTimes(scanIds.length);
    for (let i: number = 0; i < scanIds.length; i++) {
      const whereClause: JSONObject = updateMock.mock.calls[
        i
      ]![0] as JSONObject;
      const setPayload: JSONObject = updateMock.mock.calls[i]![1] as JSONObject;
      expect(whereClause["_id"]).toBe(scanIds[i]!.toString());
      expect(setPayload["status"]).toBe("In Progress");
    }
  });

  test("the level check is hoisted: one getLogLevel read for the whole update, not one per row", async () => {
    setLogLevel(ConfigLogLevel.INFO);

    mockFoundItems([
      ObjectID.generate(),
      ObjectID.generate(),
      ObjectID.generate(),
    ]);

    await NetworkDeviceDiscoveryScanService.updateBy({
      query: {},
      data: { status: "In Progress" } as ScanUpdateData,
      limit: 3,
      skip: 0,
      props: { isRoot: true },
    });

    expect(getLogLevelSpy).toHaveBeenCalledTimes(1);
  });

  test("at DEBUG, logger.debug receives the exact pretty-printed payload per row, as before", async () => {
    setLogLevel(ConfigLogLevel.DEBUG);

    const projectId: ObjectID = ObjectID.generate();
    const scanIds: Array<ObjectID> = [ObjectID.generate(), ObjectID.generate()];
    mockFoundItems(scanIds);

    await NetworkDeviceDiscoveryScanService.updateBy({
      query: {},
      data: { status: "In Progress" } as ScanUpdateData,
      limit: scanIds.length,
      skip: 0,
      props: { isRoot: true, tenantId: projectId },
    });

    /*
     * Two debug calls per matched row: the "Updated Item" marker, then the
     * pretty-printed payload.
     */
    expect(debugSpy).toHaveBeenCalledTimes(scanIds.length * 2);

    for (let i: number = 0; i < scanIds.length; i++) {
      const expectedPayload: string = JSON.stringify(
        { status: "In Progress", _id: scanIds[i]!.toString() },
        null,
        2,
      );
      /*
       * Guard the guard: the expectation itself must be the multi-line
       * pretty-printed form, not a compact one.
       */
      expect(expectedPayload).toContain("\n");

      expect(debugSpy.mock.calls[i * 2]![0]).toBe("Updated Item");
      expect(debugSpy.mock.calls[i * 2]![1]).toEqual({
        projectId: projectId.toString(),
      });
      expect(debugSpy.mock.calls[i * 2 + 1]![0]).toBe(expectedPayload);
      expect(debugSpy.mock.calls[i * 2 + 1]![1]).toEqual({
        projectId: projectId.toString(),
      });
    }

    expect(updateMock).toHaveBeenCalledTimes(scanIds.length);
  });

  test("at DEBUG, a payload whose serialization throws still fails the update (blessed delta)", async () => {
    setLogLevel(ConfigLogLevel.DEBUG);

    const scanId: ObjectID = ObjectID.generate();
    mockFoundItems([scanId]);

    const circular: JSONObject = { name: "loop" };
    circular["self"] = circular;

    await expect(
      NetworkDeviceDiscoveryScanService.updateOneById({
        id: scanId,
        data: { status: circular } as unknown as ScanUpdateData,
        props: { isRoot: true },
      }),
    ).rejects.toThrow();

    expect(updateMock).not.toHaveBeenCalled();
    expect(saveMock).not.toHaveBeenCalled();
  });
});
