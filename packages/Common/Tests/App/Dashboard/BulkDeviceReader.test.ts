import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Fresh reads of a bulk selection, a page at a time - what "Apply Vendor
 * Template" merges into, so a template is added to what each device holds
 * NOW rather than to what the table loaded.
 *
 *   - one request per hundred devices, whatever order and however many at
 *     once the devices are asked for;
 *   - a device the page does not return (deleted, or no longer readable)
 *     fails on its own, saying so;
 *   - a page that cannot be read fails its own devices with the reason, and
 *     no other page's.
 */

const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
    },
  };
});

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        const ObjectIDClass: any = (
          jest.requireActual("../../../Types/ObjectID") as { default: any }
        ).default;
        return new ObjectIDClass("11111111-1111-4111-8111-111111111111");
      },
    },
  };
});

import BulkDeviceReader, {
  BULK_DEVICE_READ_PAGE_SIZE,
  DEVICE_NOT_READABLE_MESSAGE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/BulkDeviceReader";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import Includes from "../../../Types/BaseDatabase/Includes";
import ObjectID from "../../../Types/ObjectID";

function deviceId(index: number): string {
  return `22222222-2222-4222-8222-${String(index).padStart(12, "0")}`;
}

function ids(count: number): Array<string> {
  return Array.from({ length: count }, (_value: unknown, index: number) => {
    return deviceId(index + 1);
  });
}

// Answers a page request with a device per id it asked for, named after it.
function answerEveryId(): void {
  getListMock.mockImplementation(
    async (request: any): Promise<{ data: Array<NetworkDevice> }> => {
      const asked: Array<string> = (request.query._id as Includes).values.map(
        (value: unknown): string => {
          return String(value);
        },
      );

      return {
        data: asked.map((id: string): NetworkDevice => {
          const device: NetworkDevice = new NetworkDevice();
          device._id = id;
          device.name = `device ${id.slice(-3)}`;
          return device;
        }),
      };
    },
  );
}

function askedIdsOf(callIndex: number): Array<string> {
  const request: any = (getListMock.mock.calls[callIndex] as Array<any>)[0];
  return (request.query._id as Includes).values.map(
    (value: unknown): string => {
      return String(value);
    },
  );
}

describe("BulkDeviceReader", () => {
  beforeEach(() => {
    answerEveryId();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test("reads a page of a hundred at a time - five requests for five hundred devices", async () => {
    const reader: BulkDeviceReader = new BulkDeviceReader({
      deviceIds: ids(500),
      select: { name: true },
    });

    expect(BULK_DEVICE_READ_PAGE_SIZE).toBe(100);
    expect(reader.getPageCount()).toBe(5);

    for (const id of ids(500)) {
      const device: NetworkDevice = await reader.read(id);
      expect(device._id).toBe(id);
    }

    expect(getListMock).toHaveBeenCalledTimes(5);
    expect(askedIdsOf(0)).toEqual(ids(100));
    expect(askedIdsOf(4)).toEqual(ids(500).slice(400));
  });

  test("devices asked for at the same time share their page's one request", async () => {
    const reader: BulkDeviceReader = new BulkDeviceReader({
      deviceIds: ids(10),
      select: { name: true },
      pageSize: 4,
    });

    await Promise.all(
      ids(10).map((id: string) => {
        return reader.read(id);
      }),
    );

    // 4 + 4 + 2.
    expect(getListMock).toHaveBeenCalledTimes(3);
  });

  test("a page is only read when one of its devices is asked for", async () => {
    const reader: BulkDeviceReader = new BulkDeviceReader({
      deviceIds: ids(250),
      select: { name: true },
    });

    await reader.read(deviceId(150));

    expect(getListMock).toHaveBeenCalledTimes(1);
    expect(askedIdsOf(0)).toEqual(ids(200).slice(100));
  });

  test("asks for what the caller selects, always with the id, in the current project", async () => {
    const reader: BulkDeviceReader = new BulkDeviceReader({
      deviceIds: ids(2),
      select: { snmpOids: true, sysObjectId: true },
    });

    await reader.read(deviceId(1));

    const request: any = (getListMock.mock.calls[0] as Array<any>)[0];

    expect(request.modelType).toBe(NetworkDevice);
    expect(request.select).toEqual({
      snmpOids: true,
      sysObjectId: true,
      _id: true,
    });
    expect(request.query.projectId.toString()).toBe(PROJECT_ID);
    expect(request.limit).toBe(2);
    expect(request.skip).toBe(0);
  });

  test("an id selected twice, or with blanks around it, is read once", async () => {
    const reader: BulkDeviceReader = new BulkDeviceReader({
      deviceIds: [deviceId(1), ` ${deviceId(1)} `, "", deviceId(2)],
      select: { name: true },
    });

    expect(reader.getPageCount()).toBe(1);

    await reader.read(deviceId(1));

    expect(askedIdsOf(0)).toEqual([deviceId(1), deviceId(2)]);
  });

  test("takes an ObjectID as well as a string", async () => {
    const reader: BulkDeviceReader = new BulkDeviceReader({
      deviceIds: ids(1),
      select: { name: true },
    });

    const device: NetworkDevice = await reader.read(new ObjectID(deviceId(1)));

    expect(device._id).toBe(deviceId(1));
  });

  test("a device its page does not return - deleted, or no longer readable - fails on its own", async () => {
    getListMock.mockImplementation(
      async (): Promise<{ data: Array<NetworkDevice> }> => {
        const device: NetworkDevice = new NetworkDevice();
        device._id = deviceId(1);
        return { data: [device] };
      },
    );

    const reader: BulkDeviceReader = new BulkDeviceReader({
      deviceIds: ids(2),
      select: { name: true },
    });

    await expect(reader.read(deviceId(1))).resolves.toBeInstanceOf(
      NetworkDevice,
    );
    await expect(reader.read(deviceId(2))).rejects.toThrow(
      DEVICE_NOT_READABLE_MESSAGE,
    );
  });

  test("a device that was never selected is not read at all", async () => {
    const reader: BulkDeviceReader = new BulkDeviceReader({
      deviceIds: ids(1),
      select: { name: true },
    });

    await expect(reader.read(deviceId(99))).rejects.toThrow(
      DEVICE_NOT_READABLE_MESSAGE,
    );
    expect(getListMock).not.toHaveBeenCalled();
  });

  test("a page that cannot be read fails its devices with the reason, and no other page's", async () => {
    getListMock.mockImplementation(
      async (request: any): Promise<{ data: Array<NetworkDevice> }> => {
        const asked: Array<string> = (request.query._id as Includes).values.map(
          (value: unknown): string => {
            return String(value);
          },
        );

        if (asked.includes(deviceId(1))) {
          throw new Error("The connection was interrupted.");
        }

        return {
          data: asked.map((id: string): NetworkDevice => {
            const device: NetworkDevice = new NetworkDevice();
            device._id = id;
            return device;
          }),
        };
      },
    );

    const reader: BulkDeviceReader = new BulkDeviceReader({
      deviceIds: ids(4),
      select: { name: true },
      pageSize: 2,
    });

    await expect(reader.read(deviceId(1))).rejects.toThrow(
      "The connection was interrupted.",
    );
    await expect(reader.read(deviceId(2))).rejects.toThrow(
      "The connection was interrupted.",
    );
    await expect(reader.read(deviceId(3))).resolves.toBeInstanceOf(
      NetworkDevice,
    );

    // The failed page is not asked again for its second device.
    expect(getListMock).toHaveBeenCalledTimes(2);
  });
});
