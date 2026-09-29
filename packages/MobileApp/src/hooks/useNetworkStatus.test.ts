import type { NetInfoState } from "@react-native-community/netinfo";
import { renderHook, act } from "@testing-library/react-native";
import { useNetworkStatus } from "./useNetworkStatus";
import { describe, expect, test, beforeEach } from "@jest/globals";

/*
 * This hook drives one thing: the offline banner pinned across the top of every
 * screen. OfflineBanner treats `!isConnected || isInternetReachable === false`
 * as offline, so the two fields are not interchangeable and neither is a
 * throwaway - `isInternetReachable: null` means NetInfo has not decided yet and
 * must NOT be shown as offline, while `false` means it has decided and must be.
 *
 * Two failure modes matter more than the happy path:
 *
 *   - a banner that shows on launch. NetInfo does not report until its first
 *     callback, so the hook starts optimistic. A pessimistic start would put
 *     "You are offline" over a perfectly connected app every cold start, which
 *     is exactly when a responder is opening a page.
 *   - a subscription that outlives the component. Every screen mounting the
 *     banner adds a listener; if they are never removed, a long session
 *     accumulates them and each one calls setState on an unmounted tree.
 *
 * NetInfo is a native module with no JS implementation off-device, so it is
 * mocked here - but the mock hands back a REAL unsubscribe function that the
 * teardown test can then assert was called.
 */

const mockNetInfo: {
  listeners: Array<(state: unknown) => void>;
  unsubscribe: jest.Mock;
} = {
  listeners: [],
  unsubscribe: jest.fn(),
};

jest.mock("@react-native-community/netinfo", () => {
  return {
    __esModule: true,
    default: {
      addEventListener: jest.fn((listener: (state: unknown) => void) => {
        mockNetInfo.listeners.push(listener);
        return mockNetInfo.unsubscribe;
      }),
    },
  };
});

type NetworkStatus = ReturnType<typeof useNetworkStatus>;

interface RenderedNetworkStatus {
  result: { current: NetworkStatus };
  rerender: (props: unknown) => Promise<void>;
  unmount: () => Promise<void>;
}

/*
 * renderHook is asynchronous in @testing-library/react-native v14 - it returns
 * a promise, so destructuring the call directly hands back undefined.
 */
async function renderNetworkStatus(): Promise<RenderedNetworkStatus> {
  return (await renderHook(() => {
    return useNetworkStatus();
  })) as unknown as RenderedNetworkStatus;
}

/*
 * NetInfo pushes a whole state object; only the two fields the hook reads are
 * worth stating, and spelling out the rest would just be noise that drifts from
 * the real payload.
 *
 * The act() call is AWAITED. React 19 leaves its act scope open until the
 * returned thenable settles, so a fire-and-forget act() not only fails to flush
 * this update - it wedges every render that comes after it in the same file.
 */
async function emitNetInfoState(state: Partial<NetInfoState>): Promise<void> {
  await act(async (): Promise<void> => {
    mockNetInfo.listeners.forEach(
      (listener: (state: unknown) => void): void => {
        listener(state);
      },
    );
  });
}

describe("useNetworkStatus before NetInfo has said anything", () => {
  beforeEach(() => {
    mockNetInfo.listeners = [];
  });

  test("assumes the device is connected", async () => {
    /*
     * The optimistic start is deliberate: NetInfo is silent until its first
     * callback, and a banner that appears for that gap accuses a working app of
     * being offline every single launch.
     */
    const { result } = await renderNetworkStatus();

    expect(result.current.isConnected).toBe(true);
  });

  test("assumes the internet is reachable", async () => {
    const { result } = await renderNetworkStatus();

    expect(result.current.isInternetReachable).toBe(true);
  });

  test("subscribes to NetInfo on mount", async () => {
    await renderNetworkStatus();

    expect(mockNetInfo.listeners).toHaveLength(1);
  });
});

describe("useNetworkStatus reacting to NetInfo", () => {
  beforeEach(() => {
    mockNetInfo.listeners = [];
  });

  test("a disconnection event turns the status offline", async () => {
    const { result } = await renderNetworkStatus();

    await emitNetInfoState({ isConnected: false, isInternetReachable: false });

    expect(result.current.isConnected).toBe(false);
  });

  test("reconnecting turns it back on rather than latching offline", async () => {
    /*
     * A responder who walks back into signal has to get the banner taken away
     * without restarting the app.
     */
    const { result } = await renderNetworkStatus();

    await emitNetInfoState({ isConnected: false, isInternetReachable: false });
    await emitNetInfoState({ isConnected: true, isInternetReachable: true });

    expect(result.current.isConnected).toBe(true);
    expect(result.current.isInternetReachable).toBe(true);
  });

  test("an unreachable internet is reported as false, not as unknown", async () => {
    /*
     * Connected to a captive-portal wifi that answers DHCP and nothing else.
     * `isConnected` is true, and `isInternetReachable === false` is the only
     * thing that tells the banner to show.
     */
    const { result } = await renderNetworkStatus();

    await emitNetInfoState({ isConnected: true, isInternetReachable: false });

    expect(result.current.isConnected).toBe(true);
    expect(result.current.isInternetReachable).toBe(false);
  });

  test("an undecided reachability stays null instead of collapsing to false", async () => {
    /*
     * NetInfo reports null while its reachability probe is still in flight.
     * Flattening that to false would flash the offline banner every time the
     * network changed, so null has to survive the trip through the hook.
     */
    const { result } = await renderNetworkStatus();

    await emitNetInfoState({ isConnected: true, isInternetReachable: null });

    expect(result.current.isInternetReachable).toBeNull();
  });

  test("a null connectivity reading is treated as connected", async () => {
    /*
     * Android reports isConnected as null on some transports. Reading that as
     * "offline" would put the banner up on a working phone, so the hook keeps
     * the optimistic reading for anything it cannot confirm.
     */
    const { result } = await renderNetworkStatus();

    await emitNetInfoState({ isConnected: null, isInternetReachable: null });

    expect(result.current.isConnected).toBe(true);
  });

  test("a missing connectivity reading is treated as connected", async () => {
    const { result } = await renderNetworkStatus();

    await emitNetInfoState({ isInternetReachable: null });

    expect(result.current.isConnected).toBe(true);
  });

  test("a false connectivity reading is never optimistically overridden", async () => {
    /*
     * The counterpart to the two above: the fallback applies to null and
     * undefined only. An explicit false is NetInfo being certain, and hiding
     * the banner then would strand a responder wondering why nothing loads.
     */
    const { result } = await renderNetworkStatus();

    await emitNetInfoState({ isConnected: false, isInternetReachable: null });

    expect(result.current.isConnected).toBe(false);
  });
});

describe("useNetworkStatus teardown", () => {
  beforeEach(() => {
    mockNetInfo.listeners = [];
  });

  test("removes its NetInfo subscription on unmount", async () => {
    /*
     * The listener closes over this component's setState. Left behind, it fires
     * for the rest of the process every time the radio changes.
     */
    const { unmount } = await renderNetworkStatus();

    await unmount();

    expect(mockNetInfo.unsubscribe).toHaveBeenCalledTimes(1);
  });

  test("does not unsubscribe while still mounted", async () => {
    await renderNetworkStatus();

    await emitNetInfoState({ isConnected: false, isInternetReachable: false });

    expect(mockNetInfo.unsubscribe).not.toHaveBeenCalled();
  });

  test("subscribes once across re-renders rather than once per render", async () => {
    /*
     * The effect has no dependencies. If one were added, every re-render would
     * tear down and rebuild the subscription - and a state update from the
     * listener re-renders, so the hook would resubscribe on its own output.
     */
    const { rerender } = await renderNetworkStatus();

    await rerender({});
    await rerender({});

    expect(mockNetInfo.listeners).toHaveLength(1);
    expect(mockNetInfo.unsubscribe).not.toHaveBeenCalled();
  });
});
