import { act, cleanup, renderHook } from "@testing-library/react";
import useDiscoveryScanLiveUpdates, {
  DISCOVERY_REFRESH_INTERVAL_MS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/useDiscoveryScanLiveUpdates";
import NetworkDeviceDiscoveryScan from "../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import Probe from "../../../Models/DatabaseModels/Probe";
import Includes from "../../../Types/BaseDatabase/Includes";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import ObjectID from "../../../Types/ObjectID";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SCAN_ID: string = "22222222-2222-4222-8222-222222222222";
const OTHER_ID: string = "33333333-3333-4333-8333-333333333333";
let getListSpy: jest.SpyInstance;

function scan(
  overrides: Partial<NetworkDeviceDiscoveryScan> = {},
): NetworkDeviceDiscoveryScan {
  return Object.assign(
    new NetworkDeviceDiscoveryScan(),
    {
      _id: SCAN_ID,
      status: "In Progress",
      cidr: "10.0.0.0/24",
      scannedHostCount: 10,
    },
    overrides,
  );
}

function list(
  rows: Array<NetworkDeviceDiscoveryScan>,
): ListResult<NetworkDeviceDiscoveryScan> {
  return { data: rows, count: rows.length, skip: 0, limit: rows.length };
}

async function tick(
  milliseconds: number = DISCOVERY_REFRESH_INTERVAL_MS,
): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(milliseconds);
  });
}

function setHidden(hidden: boolean): void {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: hidden,
  });
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["performance"] });
  setHidden(false);
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest
    .spyOn(API, "getFriendlyMessage")
    .mockImplementation((err: unknown): string => {
      return (err as Error).message;
    });
  getListSpy = jest
    .spyOn(ModelAPI, "getList")
    .mockResolvedValue(list([scan({ scannedHostCount: 20 })]));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("Discovery scan live updates", () => {
  test("polls only the visible page's queued/running scans and scopes requests to the project", async () => {
    const { result } = renderHook(useDiscoveryScanLiveUpdates);
    const rows: Array<NetworkDeviceDiscoveryScan> = [
      scan(),
      scan({ _id: OTHER_ID, status: "Completed" }),
    ];
    act(() => {
      result.current.onRowsLoaded(rows);
    });
    expect(getListSpy).not.toHaveBeenCalled();
    await tick();
    const request: {
      query: { projectId: ObjectID; _id: Includes };
      limit: number;
      select: Record<string, boolean>;
    } = getListSpy.mock.calls[0]![0];
    expect(request.query.projectId).toEqual(PROJECT_ID);
    expect((request.query._id as Includes).values).toEqual([SCAN_ID]);
    expect(request.limit).toBe(1);
    expect(result.current.getScan(rows[0]!).scannedHostCount).toBe(20);
    expect(rows[0]!.scannedHostCount).toBe(10);
    expect(result.current.error).toBe("");
    expect(request.select.snmpCommunityString).toBeUndefined();
  });

  test("preserves unselected relation fields while live fields change", async () => {
    const { result } = renderHook(useDiscoveryScanLiveUpdates);
    const probe: Probe = Object.assign(new Probe(), { name: "Office probe" });
    const original: NetworkDeviceDiscoveryScan = scan({ probe });
    act(() => {
      result.current.onRowsLoaded([original]);
    });
    await tick();
    expect(result.current.getScan(original).probe?.name).toBe("Office probe");
    expect(result.current.getScan(original)).toBeInstanceOf(
      NetworkDeviceDiscoveryScan,
    );
    expect(result.current.getScan(original).id?.toString()).toBe(SCAN_ID);
  });

  test.each(["Completed", "Failed"])(
    "stops automatically when a scan becomes %s",
    async (status: string) => {
      getListSpy.mockResolvedValue(list([scan({ status })]));
      const { result } = renderHook(useDiscoveryScanLiveUpdates);
      const original: NetworkDeviceDiscoveryScan = scan();
      act(() => {
        result.current.onRowsLoaded([original]);
      });
      await tick();
      expect(result.current.activeCount).toBe(0);
      expect(result.current.getScan(original).status).toBe(status);
      await tick(60000);
      expect(getListSpy).toHaveBeenCalledTimes(1);
    },
  );

  test("queued scans keep updating after the probe claims them", async () => {
    const { result } = renderHook(useDiscoveryScanLiveUpdates);
    const original: NetworkDeviceDiscoveryScan = scan({ status: "Pending" });
    act(() => {
      result.current.onRowsLoaded([original]);
    });
    await tick();
    expect(result.current.getScan(original).status).toBe("In Progress");
    await tick();
    expect(getListSpy).toHaveBeenCalledTimes(2);
  });

  test("no background request is made for a page containing only finished scans", async () => {
    const { result } = renderHook(useDiscoveryScanLiveUpdates);
    act(() => {
      result.current.onRowsLoaded([
        scan({ status: "Completed" }),
        scan({ _id: OTHER_ID, status: "Failed" }),
      ]);
    });
    await tick(60000);
    expect(getListSpy).not.toHaveBeenCalled();
  });

  test("pauses hidden tabs and refreshes immediately when the tab becomes visible", async () => {
    const { result } = renderHook(useDiscoveryScanLiveUpdates);
    act(() => {
      result.current.onRowsLoaded([scan()]);
    });
    act(() => {
      setHidden(true);
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current.isPaused).toBe(true);
    await tick(60000);
    expect(getListSpy).not.toHaveBeenCalled();
    await act(async () => {
      setHidden(false);
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(getListSpy).toHaveBeenCalledTimes(1);
    expect(result.current.isPaused).toBe(false);
  });

  test("an in-flight request never overlaps another timer or manual refresh", async () => {
    let resolve: (
      value: ListResult<NetworkDeviceDiscoveryScan>,
    ) => void = () => {};
    getListSpy.mockImplementation(() => {
      return new Promise<ListResult<NetworkDeviceDiscoveryScan>>(
        (
          resolvePromise: (
            value:
              | ListResult<NetworkDeviceDiscoveryScan>
              | PromiseLike<ListResult<NetworkDeviceDiscoveryScan>>,
          ) => void,
        ) => {
          resolve = resolvePromise;
        },
      );
    });
    const { result } = renderHook(useDiscoveryScanLiveUpdates);
    act(() => {
      result.current.onRowsLoaded([scan()]);
    });
    await tick();
    expect(result.current.isRefreshing).toBe(true);
    await tick(60000);
    await act(async () => {
      await result.current.refresh();
    });
    expect(getListSpy).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolve(list([scan({ scannedHostCount: 50 })]));
    });
    expect(result.current.isRefreshing).toBe(false);
  });

  test("a network failure leaves the latest values and timestamp visible, then recovers on retry", async () => {
    const { result } = renderHook(useDiscoveryScanLiveUpdates);
    const original: NetworkDeviceDiscoveryScan = scan();
    act(() => {
      result.current.onRowsLoaded([original]);
    });
    const lastRefreshed: Date | null = result.current.lastRefreshedAt;
    getListSpy.mockRejectedValueOnce(
      new Error("The probe service is temporarily unavailable"),
    );
    await tick();
    expect(result.current.getScan(original).scannedHostCount).toBe(10);
    expect(result.current.error).toBe(
      "The probe service is temporarily unavailable",
    );
    expect(result.current.lastRefreshedAt).toBe(lastRefreshed);
    expect(result.current.isRefreshing).toBe(false);
    await act(async () => {
      await result.current.refresh();
    });
    expect(result.current.getScan(original).scannedHostCount).toBe(20);
    expect(result.current.error).toBe("");
  });

  test("automatic retry continues after a failed poll", async () => {
    getListSpy.mockRejectedValueOnce(new Error("Offline"));
    const { result } = renderHook(useDiscoveryScanLiveUpdates);
    act(() => {
      result.current.onRowsLoaded([scan()]);
    });
    await tick();
    await tick();
    expect(getListSpy).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBe("");
  });

  test("a late response from the previous page cannot overwrite the new page", async () => {
    let resolve: (
      value: ListResult<NetworkDeviceDiscoveryScan>,
    ) => void = () => {};
    getListSpy.mockImplementationOnce(() => {
      return new Promise<ListResult<NetworkDeviceDiscoveryScan>>(
        (
          resolvePromise: (
            value:
              | ListResult<NetworkDeviceDiscoveryScan>
              | PromiseLike<ListResult<NetworkDeviceDiscoveryScan>>,
          ) => void,
        ) => {
          resolve = resolvePromise;
        },
      );
    });
    const { result } = renderHook(useDiscoveryScanLiveUpdates);
    act(() => {
      result.current.onRowsLoaded([scan()]);
    });
    await tick();
    const nextPage: NetworkDeviceDiscoveryScan = scan({
      _id: OTHER_ID,
      status: "Completed",
    });
    act(() => {
      result.current.onRowsLoaded([nextPage]);
    });
    await act(async () => {
      resolve(list([scan({ scannedHostCount: 100 })]));
    });
    expect(result.current.getScan(nextPage)).toBe(nextPage);
    expect(result.current.activeCount).toBe(0);
    expect(result.current.getScan(scan()).scannedHostCount).toBe(10);
  });

  test("a manual table reload invalidates earlier poll results for the same scan", async () => {
    let resolve: (
      value: ListResult<NetworkDeviceDiscoveryScan>,
    ) => void = () => {};
    getListSpy.mockImplementationOnce(() => {
      return new Promise<ListResult<NetworkDeviceDiscoveryScan>>(
        (
          resolvePromise: (
            value:
              | ListResult<NetworkDeviceDiscoveryScan>
              | PromiseLike<ListResult<NetworkDeviceDiscoveryScan>>,
          ) => void,
        ) => {
          resolve = resolvePromise;
        },
      );
    });
    const { result } = renderHook(useDiscoveryScanLiveUpdates);
    const original: NetworkDeviceDiscoveryScan = scan();
    act(() => {
      result.current.onRowsLoaded([original]);
    });
    await tick();
    act(() => {
      result.current.onRowsLoaded([
        scan({
          status: "Pending",
          scannedHostCount: null,
        } as unknown as Partial<NetworkDeviceDiscoveryScan>),
      ]);
    });
    await act(async () => {
      resolve(list([scan({ status: "Completed" })]));
    });
    expect(result.current.getScan(original).status).toBe("Pending");
  });

  test("unmount clears timers and discards a late response", async () => {
    let resolve: (
      value: ListResult<NetworkDeviceDiscoveryScan>,
    ) => void = () => {};
    getListSpy.mockImplementationOnce(() => {
      return new Promise<ListResult<NetworkDeviceDiscoveryScan>>(
        (
          resolvePromise: (
            value:
              | ListResult<NetworkDeviceDiscoveryScan>
              | PromiseLike<ListResult<NetworkDeviceDiscoveryScan>>,
          ) => void,
        ) => {
          resolve = resolvePromise;
        },
      );
    });
    const { result, unmount } = renderHook(useDiscoveryScanLiveUpdates);
    act(() => {
      result.current.onRowsLoaded([scan()]);
    });
    await tick();
    unmount();
    await act(async () => {
      resolve(list([scan()]));
    });
    await tick(60000);
    expect(getListSpy).toHaveBeenCalledTimes(1);
  });

  test("a removed scan is explained instead of silently claiming a successful refresh", async () => {
    getListSpy.mockResolvedValue(list([]));
    const { result } = renderHook(useDiscoveryScanLiveUpdates);
    act(() => {
      result.current.onRowsLoaded([scan()]);
    });
    await tick();
    expect(result.current.error).toMatch(/no longer available/);
  });
});
