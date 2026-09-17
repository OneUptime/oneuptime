import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import * as React from "react";
import DeviceDiagnostics from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceDiagnostics";
import {
  DIAGNOSTIC_MAX_CONSECUTIVE_POLL_FAILURES,
  DIAGNOSTIC_MAX_POLL_ATTEMPTS,
  DIAGNOSTIC_POLL_INTERVAL_IN_MS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceDiagnosticsViewModel";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceDiagnostic from "../../../Models/DatabaseModels/NetworkDeviceDiagnostic";
import Probe from "../../../Models/DatabaseModels/Probe";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue #3745, from the operator's side of the drawer.
 *
 * The probe is the only thing that can reach the device, and it pulls work,
 * so "press Ping, read the answer" is a create followed by a poll — and
 * everything a person sees in between (the buttons going quiet, the wait,
 * the two-minute give-up) is what this pins. The API is injected through
 * the same `modelAPI` seam ModelTable uses, so the test needs no network
 * and no browser stub beyond jsdom.
 *
 * Two reads go through that seam: the device (once, on mount, for the
 * probe and the labels) and the diagnostic row (every poll). They are
 * dispatched to two mocks on the model type, so a count of polls is a count
 * of polls and never off by the device read.
 */

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: (error: Error) => {
        return error.message;
      },
    },
  };
});

const DEVICE_ID: string = "11111111-1111-4111-8111-111111111111";
const OTHER_DEVICE_ID: string = "33333333-3333-4333-8333-333333333333";
const DIAGNOSTIC_ID: string = "22222222-2222-4222-8222-222222222222";
const PROBE_ID: string = "44444444-4444-4444-8444-444444444444";

const createMock: MockFunction = getJestMockFunction();
// Reads of the NetworkDeviceDiagnostic row: the poll loop.
const getItemMock: MockFunction = getJestMockFunction();
// Reads of the NetworkDevice: once per device, before the buttons show.
const getDeviceMock: MockFunction = getJestMockFunction();

interface GetItemRequest {
  modelType: unknown;
  id: ObjectID;
  select: Record<string, unknown>;
}

const fakeModelAPI: typeof ModelAPI = {
  create: createMock,
  getItem: (request: GetItemRequest) => {
    return request.modelType === NetworkDevice
      ? getDeviceMock(request)
      : getItemMock(request);
  },
} as unknown as typeof ModelAPI;

type RowOverrides = {
  [Key in keyof NetworkDeviceDiagnostic]?:
    | NetworkDeviceDiagnostic[Key]
    | undefined;
};

function row(overrides: RowOverrides = {}): NetworkDeviceDiagnostic {
  return Object.assign(
    new NetworkDeviceDiagnostic(),
    { _id: DIAGNOSTIC_ID, status: "Pending" },
    overrides,
  );
}

type DeviceOptions = {
  probeName?: string | undefined;
  hasProbe?: boolean | undefined;
};

function device(options: DeviceOptions = {}): NetworkDevice {
  const probe: Probe | undefined =
    options.probeName !== undefined
      ? Object.assign(new Probe(), { name: options.probeName })
      : undefined;

  return Object.assign(new NetworkDevice(), {
    _id: DEVICE_ID,
    hostname: "10.0.0.1",
    probeId: options.hasProbe === false ? undefined : new ObjectID(PROBE_ID),
    probe,
  });
}

// Lets the device read (a resolved promise) land before anything is asserted.
async function flush(): Promise<void> {
  await act(async () => {});
}

async function renderDiagnostics(): Promise<void> {
  render(
    <DeviceDiagnostics
      networkDeviceId={new ObjectID(DEVICE_ID)}
      modelAPI={fakeModelAPI}
    />,
  );

  await flush();
}

async function click(testId: string): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByTestId(testId));
  });
}

async function tick(): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(DIAGNOSTIC_POLL_INTERVAL_IN_MS);
  });
}

beforeEach(() => {
  jest.useFakeTimers();
  createMock.mockReset();
  getItemMock.mockReset();
  getDeviceMock.mockReset();
  createMock.mockResolvedValue({ data: row() });
  getItemMock.mockResolvedValue(row());
  getDeviceMock.mockResolvedValue(device());
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("the diagnostics buttons before anything is pressed", () => {
  test("read the device once and create nothing until a button is pressed", async () => {
    await renderDiagnostics();

    expect(
      screen.getByText("Runs from this device's probe."),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("network-device-diagnostic-result"),
    ).not.toBeInTheDocument();

    expect(getDeviceMock).toHaveBeenCalledTimes(1);

    const request: GetItemRequest = getDeviceMock.mock
      .calls[0]![0] as GetItemRequest;

    expect(request.modelType).toBe(NetworkDevice);
    expect(request.id.toString()).toBe(DEVICE_ID);
    expect(request.select).toEqual({
      hostname: true,
      probeId: true,
      probe: { name: true },
    });

    expect(createMock).not.toHaveBeenCalled();
    expect(getItemMock).not.toHaveBeenCalled();
  });

  test("show a loader until the device has been read", () => {
    getDeviceMock.mockReturnValue(
      new Promise<NetworkDevice>(() => {
        // Never settles: the read is still in flight.
      }),
    );

    render(
      <DeviceDiagnostics
        networkDeviceId={new ObjectID(DEVICE_ID)}
        modelAPI={fakeModelAPI}
      />,
    );

    expect(screen.getByTestId("component-loader")).toBeInTheDocument();
    expect(
      screen.queryByTestId("network-device-diagnostic-ping"),
    ).not.toBeInTheDocument();
  });

  /*
   * A device with no probe has nothing to run from, and every press would
   * fail with the same sentence. The note says so before the click, and
   * points at where the probe is assigned.
   */
  test("a device with no probe gets a note and a link to Settings, not buttons", async () => {
    getDeviceMock.mockResolvedValue(device({ hasProbe: false }));

    await renderDiagnostics();

    const note: HTMLElement = screen.getByTestId(
      "network-device-diagnostics-no-probe",
    );

    expect(note).toHaveTextContent(
      "This device has no probe assigned, so there is nothing to ping or trace it from.",
    );

    const link: HTMLElement = screen.getByText("Assign a probe in Settings");

    expect(link.closest("a")).toHaveAttribute(
      "href",
      expect.stringContaining(`${DEVICE_ID}/settings`),
    );
    expect(
      screen.queryByTestId("network-device-diagnostic-ping"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("network-device-diagnostic-traceroute"),
    ).not.toBeInTheDocument();
    expect(createMock).not.toHaveBeenCalled();
  });

  test("a device that cannot be read shows the API's reason, not buttons", async () => {
    getDeviceMock.mockRejectedValue(new Error("Network Device not found."));

    await renderDiagnostics();

    expect(
      screen.getByTestId("network-device-diagnostics-error"),
    ).toHaveTextContent("Network Device not found.");
    expect(
      screen.queryByTestId("network-device-diagnostic-ping"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("network-device-diagnostics-no-probe"),
    ).not.toBeInTheDocument();
  });
});

describe("pressing Ping", () => {
  test("creates a diagnostic row naming the device and the type", async () => {
    await renderDiagnostics();

    await click("network-device-diagnostic-ping");

    expect(createMock).toHaveBeenCalledTimes(1);

    const request: {
      model: NetworkDeviceDiagnostic;
      modelType: unknown;
    } = createMock.mock.calls[0]![0];

    expect(request.modelType).toBe(NetworkDeviceDiagnostic);
    expect(request.model.networkDeviceId?.toString()).toBe(DEVICE_ID);
    expect(request.model.diagnosticType).toBe("Ping");
  });

  test("Traceroute creates a Traceroute row", async () => {
    await renderDiagnostics();

    await click("network-device-diagnostic-traceroute");

    const request: { model: NetworkDeviceDiagnostic } =
      createMock.mock.calls[0]![0];

    expect(request.model.diagnosticType).toBe("Traceroute");
  });

  /*
   * Two runs at once would race over one result panel. Both buttons go
   * quiet, not just the one pressed.
   */
  test("disables both buttons and shows the wait until the row settles", async () => {
    getItemMock
      .mockResolvedValueOnce(row({ status: "In Progress" }))
      .mockResolvedValueOnce(
        row({
          status: "Completed",
          pingResult: { isOnline: true, failureCause: "" },
        }),
      );

    await renderDiagnostics();
    await click("network-device-diagnostic-ping");

    expect(screen.getByTestId("network-device-diagnostic-ping")).toBeDisabled();
    expect(
      screen.getByTestId("network-device-diagnostic-traceroute"),
    ).toBeDisabled();
    expect(screen.getByText("Waiting for the probe…")).toBeInTheDocument();
    expect(screen.getByTestId("network-device-diagnostics")).toHaveAttribute(
      "aria-busy",
      "true",
    );

    await tick();
    expect(screen.getByTestId("network-device-diagnostic-ping")).toBeDisabled();

    await tick();
    expect(
      screen.getByTestId("network-device-diagnostic-ping"),
    ).not.toBeDisabled();
    expect(
      screen.getByTestId("network-device-diagnostic-traceroute"),
    ).not.toBeDisabled();
    expect(
      screen.queryByText("Waiting for the probe…"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("network-device-diagnostics")).toHaveAttribute(
      "aria-busy",
      "false",
    );
  });

  test("polls the created row by id with the result columns", async () => {
    await renderDiagnostics();
    await click("network-device-diagnostic-ping");
    await tick();

    const request: GetItemRequest = getItemMock.mock
      .calls[0]![0] as GetItemRequest;

    expect(request.modelType).toBe(NetworkDeviceDiagnostic);
    expect(request.id.toString()).toBe(DIAGNOSTIC_ID);
    expect(request.select).toEqual({
      status: true,
      statusMessage: true,
      pingResult: true,
      traceRouteResult: true,
      hostname: true,
      completedAt: true,
    });
  });
});

describe("what the drawer shows once the probe has answered", () => {
  test("a Completed ping reads Reachable with its round-trip rows", async () => {
    getItemMock.mockResolvedValue(
      row({
        status: "Completed",
        hostname: "10.0.0.1",
        pingResult: {
          isOnline: true,
          failureCause: "",
          pingResponse: {
            packetsSent: 5,
            packetsReceived: 5,
            packetLossPercent: 0,
            minRoundTripTimeInMs: 10.2,
            maxRoundTripTimeInMs: 20.1,
            avgRoundTripTimeInMs: 12.44,
            jitterInMs: 1.2,
          },
        },
      }),
    );

    await renderDiagnostics();
    await click("network-device-diagnostic-ping");
    await tick();

    const result: HTMLElement = screen.getByTestId(
      "network-device-diagnostic-result",
    );

    expect(result).toHaveTextContent("Reachable");
    expect(result).toHaveTextContent("Average RTT");
    expect(result).toHaveTextContent("12.4 ms");
    expect(result).toHaveTextContent("10.2 ms / 20.1 ms");
    expect(result).toHaveTextContent("Packet loss");
    expect(result).toHaveTextContent("0% (5/5 received)");
    expect(result).toHaveTextContent("10.0.0.1");
    // The result lands seconds after the click; it is announced, not found.
    expect(result).toHaveAttribute("role", "status");
    expect(result).toHaveAttribute("aria-live", "polite");
  });

  /*
   * The row carries the hostname the probe actually pinged; when it does
   * not, the device's own hostname (read on mount) labels the result.
   */
  test("labels a ping with the device's hostname when the row has none", async () => {
    getItemMock.mockResolvedValue(
      row({
        status: "Completed",
        pingResult: {
          isOnline: true,
          failureCause: "",
          pingResponse: {
            packetsSent: 5,
            packetsReceived: 5,
            packetLossPercent: 0,
            avgRoundTripTimeInMs: 3,
          },
        },
      }),
    );

    await renderDiagnostics();
    await click("network-device-diagnostic-ping");
    await tick();

    expect(
      screen.getByTestId("network-device-diagnostic-result"),
    ).toHaveTextContent("10.0.0.1");
  });

  test("a Completed traceroute renders the hop table", async () => {
    getItemMock.mockResolvedValue(
      row({
        status: "Completed",
        traceRouteResult: {
          timestamp: new Date("2026-09-15T10:00:00Z"),
          traceRoute: {
            destinationAddress: "10.0.0.1",
            destinationHostName: undefined,
            isComplete: true,
            totalHops: 2,
            failedHop: undefined,
            failureMessage: undefined,
            hops: [
              {
                hopNumber: 1,
                address: undefined,
                hostName: undefined,
                roundTripTimeInMS: undefined,
                isTimeout: true,
              },
              {
                hopNumber: 2,
                address: "10.0.0.1",
                hostName: "core",
                roundTripTimeInMS: 4,
                isTimeout: false,
              },
            ],
          },
        },
      }),
    );

    await renderDiagnostics();
    await click("network-device-diagnostic-traceroute");
    await tick();

    const result: HTMLElement = screen.getByTestId(
      "network-device-diagnostic-result",
    );

    expect(result).toHaveTextContent("Reached the destination in 2 hops");
    expect(screen.getByText("* * *")).toBeInTheDocument();
    expect(screen.getByText("core (10.0.0.1)")).toBeInTheDocument();
    expect(screen.getByText("4 ms")).toBeInTheDocument();
    expect(screen.getByText("Hop")).toBeInTheDocument();
  });

  test("a Failed row shows the probe's reason", async () => {
    getItemMock.mockResolvedValue(
      row({
        status: "Failed",
        statusMessage: "This probe does not support traceroute.",
      }),
    );

    await renderDiagnostics();
    await click("network-device-diagnostic-traceroute");
    await tick();

    expect(
      screen.getByTestId("network-device-diagnostic-result"),
    ).toHaveTextContent("This probe does not support traceroute.");
  });
});

describe("when the probe never answers", () => {
  test("gives up after the attempt cap and names the probe", async () => {
    getDeviceMock.mockResolvedValue(device({ probeName: "Rack 3" }));

    await renderDiagnostics();
    await click("network-device-diagnostic-ping");

    for (
      let attempt: number = 0;
      attempt < DIAGNOSTIC_MAX_POLL_ATTEMPTS;
      attempt++
    ) {
      await tick();
    }

    expect(getItemMock).toHaveBeenCalledTimes(DIAGNOSTIC_MAX_POLL_ATTEMPTS);

    const result: HTMLElement = screen.getByTestId(
      "network-device-diagnostic-result",
    );

    expect(result).toHaveTextContent(
      'The probe "Rack 3" did not report a ping result within two minutes.',
    );
    expect(result).toHaveTextContent("supports on-demand diagnostics");
    expect(
      screen.getByTestId("network-device-diagnostic-ping"),
    ).not.toBeDisabled();

    // And it stays given up: no further reads after the cap.
    await tick();
    expect(getItemMock).toHaveBeenCalledTimes(DIAGNOSTIC_MAX_POLL_ATTEMPTS);
  });

  test("falls back to 'this device's probe' when the probe has no name", async () => {
    await renderDiagnostics();
    await click("network-device-diagnostic-ping");

    for (
      let attempt: number = 0;
      attempt < DIAGNOSTIC_MAX_POLL_ATTEMPTS;
      attempt++
    ) {
      await tick();
    }

    expect(
      screen.getByTestId("network-device-diagnostic-result"),
    ).toHaveTextContent(
      "This device's probe did not report a ping result within two minutes.",
    );
  });

  test("keeps waiting right up to the cap", async () => {
    await renderDiagnostics();
    await click("network-device-diagnostic-ping");

    for (
      let attempt: number = 0;
      attempt < DIAGNOSTIC_MAX_POLL_ATTEMPTS - 1;
      attempt++
    ) {
      await tick();
    }

    expect(
      screen.queryByTestId("network-device-diagnostic-result"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Waiting for the probe…")).toBeInTheDocument();
  });
});

describe("when the row cannot be created", () => {
  test("shows the API's reason and re-enables the buttons", async () => {
    createMock.mockRejectedValue(
      new Error("This device has no probe assigned."),
    );

    await renderDiagnostics();
    await click("network-device-diagnostic-ping");

    expect(
      screen.getByTestId("network-device-diagnostic-result"),
    ).toHaveTextContent("This device has no probe assigned.");
    expect(
      screen.getByTestId("network-device-diagnostic-ping"),
    ).not.toBeDisabled();
    expect(getItemMock).not.toHaveBeenCalled();
  });

  /*
   * One rejected read is the API hiccuping, not the probe failing: the row
   * is still being worked, and the next read will very likely answer. Only
   * a streak ends the run.
   */
  test("one rejected poll is retried, and the row's answer still lands", async () => {
    getItemMock
      .mockRejectedValueOnce(new Error("Network unreachable."))
      .mockResolvedValue(
        row({
          status: "Completed",
          pingResult: { isOnline: true, failureCause: "" },
        }),
      );

    await renderDiagnostics();
    await click("network-device-diagnostic-ping");
    await tick();

    expect(
      screen.queryByTestId("network-device-diagnostic-result"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Waiting for the probe…")).toBeInTheDocument();

    await tick();

    const result: HTMLElement = screen.getByTestId(
      "network-device-diagnostic-result",
    );

    expect(result).toHaveTextContent("Reachable");
    expect(result).not.toHaveTextContent("Network unreachable.");
    expect(getItemMock).toHaveBeenCalledTimes(2);
  });

  test("three rejected polls in a row end the run with the API's reason", async () => {
    getItemMock.mockRejectedValue(new Error("Network unreachable."));

    await renderDiagnostics();
    await click("network-device-diagnostic-ping");

    for (
      let failure: number = 0;
      failure < DIAGNOSTIC_MAX_CONSECUTIVE_POLL_FAILURES - 1;
      failure++
    ) {
      await tick();
    }

    expect(
      screen.queryByTestId("network-device-diagnostic-result"),
    ).not.toBeInTheDocument();

    await tick();

    expect(
      screen.getByTestId("network-device-diagnostic-result"),
    ).toHaveTextContent("Network unreachable.");
    expect(getItemMock).toHaveBeenCalledTimes(
      DIAGNOSTIC_MAX_CONSECUTIVE_POLL_FAILURES,
    );
    expect(
      screen.getByTestId("network-device-diagnostic-ping"),
    ).not.toBeDisabled();

    // And it stays ended: no further reads.
    await tick();
    expect(getItemMock).toHaveBeenCalledTimes(
      DIAGNOSTIC_MAX_CONSECUTIVE_POLL_FAILURES,
    );
  });
});

describe("when the row disappears mid-run", () => {
  /*
   * Both foreign keys cascade and hard-delete, and ModelAPI turns the {} the
   * API then answers into an empty model rather than null. Without the id
   * check that empty row would be polled as "still pending" for two minutes.
   */
  test("says so and stops polling", async () => {
    getItemMock.mockResolvedValue(new NetworkDeviceDiagnostic());

    await renderDiagnostics();
    await click("network-device-diagnostic-ping");
    await tick();

    expect(
      screen.getByTestId("network-device-diagnostic-result"),
    ).toHaveTextContent(
      "This diagnostic no longer exists. The device or its probe may have been deleted.",
    );
    expect(
      screen.getByTestId("network-device-diagnostic-ping"),
    ).not.toBeDisabled();
    expect(getItemMock).toHaveBeenCalledTimes(1);

    await tick();
    expect(getItemMock).toHaveBeenCalledTimes(1);
  });
});

describe("switching to another device mid-run", () => {
  /*
   * The topology drawer re-renders this same instance for the next node
   * the operator clicks — no unmount, SideOver has no backdrop — so device
   * A's run must be dropped, not carried under device B's name.
   */
  test("drops the first device's run, and its late answer never renders", async () => {
    type ResolveRead = (value: NetworkDeviceDiagnostic) => void;
    let resolveRead: ResolveRead | null = null;

    getItemMock.mockImplementationOnce(() => {
      return new Promise<NetworkDeviceDiagnostic>((resolve: ResolveRead) => {
        resolveRead = resolve;
      });
    });

    const { rerender } = render(
      <DeviceDiagnostics
        networkDeviceId={new ObjectID(DEVICE_ID)}
        modelAPI={fakeModelAPI}
      />,
    );

    await flush();
    await click("network-device-diagnostic-ping");
    // The first read is now in flight for device A.
    await tick();
    expect(getItemMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("network-device-diagnostic-ping")).toBeDisabled();

    await act(async () => {
      rerender(
        <DeviceDiagnostics
          networkDeviceId={new ObjectID(OTHER_DEVICE_ID)}
          modelAPI={fakeModelAPI}
        />,
      );
    });

    // Device B has been read in its own right.
    expect(getDeviceMock).toHaveBeenCalledTimes(2);
    expect(
      (getDeviceMock.mock.calls[1]![0] as GetItemRequest).id.toString(),
    ).toBe(OTHER_DEVICE_ID);

    expect(
      screen.queryByTestId("network-device-diagnostic-result"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("network-device-diagnostic-ping"),
    ).not.toBeDisabled();
    expect(
      screen.getByText("Runs from this device's probe."),
    ).toBeInTheDocument();

    // A's read answers Completed after the switch: it belongs to nobody.
    await act(async () => {
      resolveRead!(
        row({
          status: "Completed",
          pingResult: { isOnline: true, failureCause: "" },
        }),
      );
    });

    expect(
      screen.queryByTestId("network-device-diagnostic-result"),
    ).not.toBeInTheDocument();

    // And A's polling chain is not continued under B either.
    await tick();
    await tick();
    expect(getItemMock).toHaveBeenCalledTimes(1);
  });
});

describe("closing the drawer mid-run", () => {
  /*
   * The topology drawer unmounts when the operator closes it. A poll loop
   * that outlived it would keep reading a row nobody is looking at, and
   * set state on a component that is gone.
   */
  test("stops polling", async () => {
    const { unmount } = render(
      <DeviceDiagnostics
        networkDeviceId={new ObjectID(DEVICE_ID)}
        modelAPI={fakeModelAPI}
      />,
    );

    await flush();
    await click("network-device-diagnostic-ping");
    await tick();
    await tick();
    expect(getItemMock).toHaveBeenCalledTimes(2);

    unmount();

    await tick();
    await tick();
    await tick();
    expect(getItemMock).toHaveBeenCalledTimes(2);
  });
});
