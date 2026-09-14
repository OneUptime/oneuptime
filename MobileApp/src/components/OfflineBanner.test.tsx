import React from "react";
import { render, screen } from "@testing-library/react-native";
import { describe, expect, test, beforeEach } from "@jest/globals";
import OfflineBanner from "./OfflineBanner";

/*
 * App.tsx renders this banner above the whole navigator, so it is not just a
 * strip of colour - it is a strip of colour laid over the top of every screen
 * in the app, including the navigation header. Two things therefore matter:
 * that it appears exactly when the device cannot reach the network, and that
 * it lets touches through to whatever it is covering.
 *
 * The second is the defect this file was written for. An absolutely
 * positioned view with 50pt of top padding and no `pointerEvents` is a touch
 * target: while the device was offline it swallowed every tap in that strip,
 * the back button included, which is exactly the wrong moment to make the app
 * feel frozen.
 *
 * The test renderer does no hit-testing, so there is no way to press "through"
 * the banner here and watch what happens; `pointerEvents` on the rendered view
 * is the observable that says the banner is out of the way, so that is what is
 * asserted.
 */

interface NetworkStatus {
  isConnected: boolean;
  isInternetReachable: boolean | null;
}

/*
 * The hook talks to NetInfo, which is native. The `mock` prefix is what lets
 * jest.mock's factory reach this despite hoisting.
 */
const mockNetworkStatus: { current: NetworkStatus } = {
  current: { isConnected: true, isInternetReachable: true },
};

jest.mock("../hooks/useNetworkStatus", () => {
  return {
    useNetworkStatus: () => {
      return mockNetworkStatus.current;
    },
  };
});

describe("When the banner is shown at all", () => {
  beforeEach(() => {
    mockNetworkStatus.current = {
      isConnected: true,
      isInternetReachable: true,
    };
  });

  test("nothing is rendered while the device is online", async () => {
    await render(<OfflineBanner />);

    expect(screen.queryByText("No internet connection")).toBeNull();
  });

  test("it appears when the connection drops", async () => {
    mockNetworkStatus.current = {
      isConnected: false,
      isInternetReachable: false,
    };

    await render(<OfflineBanner />);

    expect(screen.getByText("No internet connection")).toBeTruthy();
  });

  test("it appears when there is a connection that cannot reach the internet", async () => {
    /*
     * Captive-portal wifi: the handset is happily associated, and not one
     * request will land. From the responder's point of view that is offline.
     */
    mockNetworkStatus.current = {
      isConnected: true,
      isInternetReachable: false,
    };

    await render(<OfflineBanner />);

    expect(screen.getByText("No internet connection")).toBeTruthy();
  });

  test("reachability that is merely unknown is not treated as offline", async () => {
    /*
     * NetInfo reports null before it has finished probing. Claiming the app is
     * offline on that would flash the banner over the header on every launch.
     */
    mockNetworkStatus.current = {
      isConnected: true,
      isInternetReachable: null,
    };

    await render(<OfflineBanner />);

    expect(screen.queryByText("No internet connection")).toBeNull();
  });
});

describe("The banner does not take the touches of what it covers", () => {
  beforeEach(() => {
    mockNetworkStatus.current = {
      isConnected: false,
      isInternetReachable: false,
    };
  });

  test("it is transparent to touches", async () => {
    await render(<OfflineBanner />);

    expect(screen.root?.props.pointerEvents).toBe("none");
  });

  test("being transparent to touches does not stop it being read", async () => {
    /*
     * `pointerEvents: none` must not be reached for by hiding the banner - it
     * is the message that explains why nothing is loading.
     */
    await render(<OfflineBanner />);

    expect(screen.getByText("No internet connection")).toBeTruthy();
    expect(screen.root?.props.style.position).toBe("absolute");
  });
});
