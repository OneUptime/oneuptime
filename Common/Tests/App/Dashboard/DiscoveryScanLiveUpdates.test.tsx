import { act, cleanup, renderHook } from "@testing-library/react";
import useDiscoveryScanLiveUpdates, {
  DISCOVERY_REFRESH_INTERVAL_MS,
  DISCOVERY_REFRESH_TIMEOUT_MS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/useDiscoveryScanLiveUpdates";
import NetworkDeviceDiscoveryScan from "../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import Probe from "../../../Models/DatabaseModels/Probe";
import Includes from "../../../Types/BaseDatabase/Includes";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import ObjectID from "../../../Types/ObjectID";
import API from "../../../UI/Utils/API/API";
import ModelAPI, {
  RequestOptions as ModelAPIRequestOptions,
} from "../../../UI/Utils/ModelAPI/ModelAPI";
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

function stallUntilRequestTimeout(): void {
  getListSpy.mockImplementationOnce(
    (request: { requestOptions?: ModelAPIRequestOptions }) => {
      return new Promise<ListResult<NetworkDeviceDiscoveryScan>>(
        (_resolve: unknown, reject: (reason: Error) => void): void => {
          const timeout: number | undefined =
            request.requestOptions?.apiRequestOptions?.timeout;
          if (timeout !== undefined) {
            setTimeout(() => {
              reject(new Error("Live update request timed out."));
            }, timeout);
          }
        },
      );
    },
  );
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["performance"] });
  jest.setSystemTime(new Date("2026-09-09T12:00:00Z"));
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
      requestOptions: ModelAPIRequestOptions;
    } = getListSpy.mock.calls[0]![0];
    expect(request.query.projectId).toEqual(PROJECT_ID);
    expect((request.query._id as Includes).values).toEqual([SCAN_ID]);
    expect(request.limit).toBe(1);
    expect(result.current.getScan(rows[0]!).scannedHostCount).toBe(20);
    expect(rows[0]!.scannedHostCount).toBe(10);
    expect(result.current.error).toBe("");
    expect(request.select.snmpCommunityString).toBeUndefined();
    expect(request.requestOptions.apiRequestOptions).toEqual({
      timeout: DISCOVERY_REFRESH_TIMEOUT_MS,
      retries: 0,
    });
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

  test.each(["Completed", "Failed"])(
    "a %s recurring scan resumes updates only when due and waits for the server to queue it",
    async (status: string) => {
      const original: NetworkDeviceDiscoveryScan = scan({
        status,
        isRecurring: true,
        nextScanAt: new Date(Date.now() + 25000),
      });
      getListSpy
        .mockResolvedValueOnce(list([original]))
        .mockResolvedValueOnce(list([scan({ status: "Pending" })]));
      const { result } = renderHook(useDiscoveryScanLiveUpdates);
      act(() => {
        result.current.onRowsLoaded([original]);
      });
      await tick(25000);
      expect(getListSpy).not.toHaveBeenCalled();
      expect(result.current.activeCount).toBe(0);
      await tick(5000);
      expect(getListSpy).toHaveBeenCalledTimes(1);
      expect(result.current.getScan(original).status).toBe(status);
      expect(result.current.activeCount).toBe(0);
      await tick();
      expect(result.current.getScan(original).status).toBe("Pending");
      expect(result.current.activeCount).toBe(1);
      await tick();
      expect(result.current.getScan(original).status).toBe("In Progress");
      expect(getListSpy).toHaveBeenCalledTimes(3);
    },
  );

  test("a running scan that finishes keeps watching its next scheduled run without polling early", async () => {
    const original: NetworkDeviceDiscoveryScan = scan({ isRecurring: true });
    const completed: NetworkDeviceDiscoveryScan = scan({
      status: "Completed",
      isRecurring: true,
      nextScanAt: new Date(Date.now() + 40000),
    });
    getListSpy
      .mockResolvedValueOnce(list([completed]))
      .mockResolvedValueOnce(list([scan({ status: "Pending" })]));
    const { result } = renderHook(useDiscoveryScanLiveUpdates);
    act(() => {
      result.current.onRowsLoaded([original]);
    });
    await tick();
    expect(result.current.activeCount).toBe(0);
    await tick(29999);
    expect(getListSpy).toHaveBeenCalledTimes(1);
    await tick(1);
    expect(getListSpy).toHaveBeenCalledTimes(2);
    expect(result.current.getScan(original).status).toBe("Pending");
  });

  test.each([
    { isRecurring: false, nextScanAt: new Date("2026-09-09T11:00:00Z") },
    { isRecurring: true, nextScanAt: undefined },
    { isRecurring: true, nextScanAt: new Date("invalid") },
  ])(
    "a finished scan without a valid recurring schedule makes no requests: %p",
    async (recurrence: Partial<NetworkDeviceDiscoveryScan>) => {
      const { result } = renderHook(useDiscoveryScanLiveUpdates);
      act(() => {
        result.current.onRowsLoaded([
          scan({ status: "Completed", ...recurrence }),
        ]);
      });
      await tick(120000);
      await act(async () => {
        await result.current.refresh();
      });
      expect(getListSpy).not.toHaveBeenCalled();
      expect(result.current.activeCount).toBe(0);
    },
  );

  test("a due scan that is rescheduled stops polling until the new due time", async () => {
    const original: NetworkDeviceDiscoveryScan = scan({
      status: "Failed",
      isRecurring: true,
      nextScanAt: new Date(Date.now() - 1000),
    });
    getListSpy.mockResolvedValueOnce(
      list([scan({ ...original, nextScanAt: new Date(Date.now() + 60000) })]),
    );
    const { result } = renderHook(useDiscoveryScanLiveUpdates);
    act(() => {
      result.current.onRowsLoaded([original]);
    });
    await tick();
    expect(getListSpy).toHaveBeenCalledTimes(1);
    await tick(49999);
    expect(getListSpy).toHaveBeenCalledTimes(1);
    await tick(1);
    expect(getListSpy).toHaveBeenCalledTimes(2);
  });

  test("disabling recurrence in a live response stops further requests", async () => {
    const original: NetworkDeviceDiscoveryScan = scan({
      status: "Completed",
      isRecurring: true,
      nextScanAt: new Date(Date.now() - 1000),
    });
    getListSpy.mockResolvedValueOnce(
      list([scan({ ...original, isRecurring: false })]),
    );
    const { result } = renderHook(useDiscoveryScanLiveUpdates);
    act(() => {
      result.current.onRowsLoaded([original]);
    });
    await tick();
    await tick(120000);
    expect(getListSpy).toHaveBeenCalledTimes(1);
    expect(result.current.activeCount).toBe(0);
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

  test("visibility stays in sync when active scans disappear while hidden and later reload", async () => {
    const { result } = renderHook(useDiscoveryScanLiveUpdates);
    act(() => {
      result.current.onRowsLoaded([scan()]);
      setHidden(true);
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current.isPaused).toBe(true);
    act(() => {
      result.current.onRowsLoaded([scan({ status: "Completed" })]);
    });
    expect(result.current.activeCount).toBe(0);
    await act(async () => {
      setHidden(false);
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current.isPaused).toBe(false);
    expect(getListSpy).not.toHaveBeenCalled();
    act(() => {
      result.current.onRowsLoaded([scan({ status: "Pending" })]);
    });
    expect(result.current.isPaused).toBe(false);
    await tick();
    expect(getListSpy).toHaveBeenCalledTimes(1);
  });

  test("loading rows synchronizes the current visibility even if no event was observed", async () => {
    setHidden(true);
    const { result } = renderHook(useDiscoveryScanLiveUpdates);
    expect(result.current.isPaused).toBe(true);
    act(() => {
      setHidden(false);
      result.current.onRowsLoaded([scan()]);
    });
    expect(result.current.isPaused).toBe(false);
    await tick();
    expect(getListSpy).toHaveBeenCalledTimes(1);
  });

  test("a recurring run that becomes due while hidden refreshes when the tab becomes visible", async () => {
    setHidden(true);
    const { result } = renderHook(useDiscoveryScanLiveUpdates);
    const original: NetworkDeviceDiscoveryScan = scan({
      status: "Completed",
      isRecurring: true,
      nextScanAt: new Date(Date.now() + 30000),
    });
    act(() => {
      result.current.onRowsLoaded([original]);
    });
    await tick(60000);
    expect(getListSpy).not.toHaveBeenCalled();
    await act(async () => {
      setHidden(false);
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current.isPaused).toBe(false);
    expect(getListSpy).toHaveBeenCalledTimes(1);
    expect(result.current.getScan(original).status).toBe("In Progress");
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

  test("the configured transport timeout releases a stalled poll and the next poll recovers", async () => {
    stallUntilRequestTimeout();
    const { result } = renderHook(useDiscoveryScanLiveUpdates);
    const original: NetworkDeviceDiscoveryScan = scan();
    act(() => {
      result.current.onRowsLoaded([original]);
    });
    const lastRefreshed: Date | null = result.current.lastRefreshedAt;
    await tick();
    expect(result.current.isRefreshing).toBe(true);
    await tick(DISCOVERY_REFRESH_TIMEOUT_MS - 1);
    expect(result.current.isRefreshing).toBe(true);
    expect(getListSpy).toHaveBeenCalledTimes(1);
    await act(async () => {
      await result.current.refresh();
    });
    expect(getListSpy).toHaveBeenCalledTimes(1);
    await tick(1);
    expect(result.current.isRefreshing).toBe(false);
    expect(result.current.error).toBe("Live update request timed out.");
    expect(result.current.getScan(original).scannedHostCount).toBe(10);
    expect(result.current.lastRefreshedAt).toBe(lastRefreshed);
    await tick(5000);
    expect(getListSpy).toHaveBeenCalledTimes(2);
    expect(result.current.isRefreshing).toBe(false);
    expect(result.current.error).toBe("");
    expect(result.current.getScan(original).scannedHostCount).toBe(20);
    expect(result.current.lastRefreshedAt).not.toBe(lastRefreshed);
  });

  test("a timeout from an earlier page cannot set an error on the new page or block its next poll", async () => {
    stallUntilRequestTimeout();
    const { result } = renderHook(useDiscoveryScanLiveUpdates);
    act(() => {
      result.current.onRowsLoaded([scan()]);
    });
    await tick();
    const nextPage: NetworkDeviceDiscoveryScan = scan({ _id: OTHER_ID });
    act(() => {
      result.current.onRowsLoaded([nextPage]);
    });
    getListSpy.mockResolvedValue(
      list([scan({ _id: OTHER_ID, scannedHostCount: 60 })]),
    );
    await tick(DISCOVERY_REFRESH_TIMEOUT_MS);
    expect(result.current.error).toBe("");
    expect(result.current.getScan(nextPage)).toBe(nextPage);
    expect(result.current.isRefreshing).toBe(false);
    await tick(5000);
    expect(getListSpy).toHaveBeenCalledTimes(2);
    expect(result.current.getScan(nextPage).scannedHostCount).toBe(60);
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

  test("unmount clears scheduled-run polling and the visibility listener", async () => {
    const { result, unmount } = renderHook(useDiscoveryScanLiveUpdates);
    act(() => {
      result.current.onRowsLoaded([
        scan({
          status: "Completed",
          isRecurring: true,
          nextScanAt: new Date(Date.now() + 30000),
        }),
      ]);
    });
    unmount();
    await tick(60000);
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(getListSpy).not.toHaveBeenCalled();
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
