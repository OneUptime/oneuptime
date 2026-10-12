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
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import StartPacketCaptureModal from "../../../../App/FeatureSet/Dashboard/src/Components/PacketCapture/StartPacketCaptureModal";
import PacketCapture from "../../../Models/DatabaseModels/PacketCapture";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PacketCaptureCapabilityUtil, {
  PacketCaptureCapability,
} from "../../../Types/PacketCapture/PacketCaptureCapability";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Start Packet Capture: where to listen, which packets to keep, and for how
 * long - with what a capture holds said before anything is captured. What
 * these pin is what a person sees and what is sent: the capture the form
 * creates carries the probe, the interface, the filter the boxes made and
 * the limits, and nothing the probe would refuse leaves the form.
 */

const PROBE_ID: string = "11111111-1111-4111-8111-111111111111";
const DEVICE_ID: string = "22222222-2222-4222-8222-222222222222";

function capability(overrides: JSONObject = {}): PacketCaptureCapability {
  return PacketCaptureCapabilityUtil.sanitize({
    isEnabled: true,
    isToolAvailable: true,
    interfaces: [
      { name: "any", addresses: [], isUp: true },
      { name: "eth0", addresses: ["10.0.0.2/24"], isUp: true },
    ],
    limits: {
      maxDurationInSeconds: 1800,
      maxPackets: 1000000,
      maxFileSizeInMB: 25,
    },
    ...overrides,
  }) as PacketCaptureCapability;
}

let createMock: MockFunction;
let onClose: MockFunction;
let onStarted: MockFunction;

function renderModal(
  props: {
    capability?: PacketCaptureCapability;
    defaultHost?: string;
    networkDeviceId?: ObjectID;
  } = {},
): void {
  render(
    <StartPacketCaptureModal
      probeId={new ObjectID(PROBE_ID)}
      capability={props.capability || capability()}
      networkDeviceId={props.networkDeviceId}
      defaultHost={props.defaultHost}
      onClose={onClose as unknown as () => void}
      onStarted={onStarted as unknown as () => void}
    />,
  );
}

function modal(): HTMLElement {
  return screen.getByTestId("modal");
}

async function submit(): Promise<void> {
  await act(async () => {
    fireEvent.click(within(modal()).getByTestId("modal-footer-submit-button"));
  });
}

function created(): PacketCapture {
  expect(createMock).toHaveBeenCalledTimes(1);

  return (createMock.mock.calls[0]![0] as { model: PacketCapture }).model;
}

beforeEach(() => {
  createMock = getJestMockFunction();
  createMock.mockResolvedValue({ data: new PacketCapture() } as never);
  onClose = getJestMockFunction();
  onStarted = getJestMockFunction();

  jest
    .spyOn(ModelAPI, "create")
    .mockImplementation(createMock as unknown as typeof ModelAPI.create);
  jest.spyOn(API, "getFriendlyMessage").mockImplementation((err: unknown) => {
    return (err as Error).message;
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("what the form shows", () => {
  test("its title and its button say what it does", () => {
    renderModal();

    expect(
      within(modal()).getByText("Start Packet Capture"),
    ).toBeInTheDocument();
    expect(
      within(modal()).getByTestId("modal-footer-submit-button"),
    ).toHaveTextContent("Start Capture");
  });

  test("before anything is captured, what a capture holds and what OneUptime does about it", () => {
    renderModal();

    const warning: HTMLElement = screen.getByTestId(
      "packet-capture-sensitive-data",
    );

    expect(warning).toHaveTextContent("A capture holds the traffic itself.");
    expect(warning).toHaveTextContent(
      "Passwords, tokens and personal data that cross the wire end up in the file.",
    );
    expect(warning).toHaveTextContent("Captures are deleted after 7 days");
    expect(warning).toHaveTextContent(
      "every start and download is recorded in the audit log",
    );
  });

  test("listens on every interface by default, and keeps every packet", () => {
    renderModal();

    expect(
      within(modal()).getByText("All interfaces (any)"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("packet-capture-filter-preview"),
    ).toHaveTextContent("No filter: every packet on every interface is kept.");
  });

  test("started from a device, the filter starts at the device's address", () => {
    renderModal({ defaultHost: "10.0.0.9" });

    expect(
      screen.getByTestId("packet-capture-filter-preview"),
    ).toHaveTextContent("Filter: host 10.0.0.9");
  });

  test("the limits are folded under a sentence that says what they are", () => {
    renderModal();

    expect(
      within(modal()).getByText(
        "Stops after 1 minute, 100,000 packets or 10 MB, whichever comes first.",
      ),
    ).toBeInTheDocument();
    expect(
      within(modal()).getByRole("button", { name: /More fields/ }),
    ).toHaveAttribute("aria-expanded", "false");
  });

  test("on a probe with lower maximums, the limits start inside them", () => {
    renderModal({
      capability: capability({
        limits: {
          maxDurationInSeconds: 30,
          maxPackets: 1000000,
          maxFileSizeInMB: 2,
        },
      }),
    });

    expect(
      within(modal()).getByText(
        "Stops after 30 seconds, 100,000 packets or 2 MB, whichever comes first.",
      ),
    ).toBeInTheDocument();
  });
});

describe("starting a capture", () => {
  test("creates the capture the form describes, and says it started", async () => {
    renderModal({ defaultHost: "10.0.0.9" });

    await submit();

    await waitFor(() => {
      expect(onStarted).toHaveBeenCalledTimes(1);
    });

    const capture: PacketCapture = created();

    expect(capture.probeId?.toString()).toBe(PROBE_ID);
    expect(capture.interfaceName).toBe("any");
    expect(capture.bpfFilter).toBe("host 10.0.0.9");
    expect(capture.maxDurationInSeconds).toBe(60);
    expect(capture.maxPackets).toBe(100000);
    expect(capture.maxFileSizeInMB).toBe(10);
    expect(capture.networkDeviceId).toBeUndefined();
    expect(
      (createMock.mock.calls[0]![0] as { modelType: unknown }).modelType,
    ).toBe(PacketCapture);
  });

  test("a capture started from a device is linked to it", async () => {
    renderModal({
      defaultHost: "10.0.0.9",
      networkDeviceId: new ObjectID(DEVICE_ID),
    });

    await submit();

    await waitFor(() => {
      expect(onStarted).toHaveBeenCalledTimes(1);
    });

    expect(created().networkDeviceId?.toString()).toBe(DEVICE_ID);
  });

  test("the filter written in the boxes is what is sent", async () => {
    renderModal();

    fireEvent.change(screen.getByTestId("packet-capture-filter-port"), {
      target: { value: "53" },
    });

    await submit();

    await waitFor(() => {
      expect(onStarted).toHaveBeenCalledTimes(1);
    });

    expect(created().bpfFilter).toBe("port 53");
  });

  test("a filter that is wrong is never sent", async () => {
    renderModal();

    fireEvent.change(screen.getByTestId("packet-capture-filter-port"), {
      target: { value: "70000" },
    });

    await submit();

    expect(createMock).not.toHaveBeenCalled();
    expect(onStarted).not.toHaveBeenCalled();
  });

  test("the server's refusal is shown in the form, which stays open", async () => {
    createMock.mockRejectedValue(
      new Error(
        "This probe is already running 2 packet captures. Wait for one to finish, or stop one, and try again.",
      ) as never,
    );

    renderModal();

    await submit();

    expect(
      await within(modal()).findByText(
        "This probe is already running 2 packet captures. Wait for one to finish, or stop one, and try again.",
      ),
    ).toBeInTheDocument();
    expect(onStarted).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  test("Cancel closes the form and starts nothing", () => {
    renderModal();

    fireEvent.click(within(modal()).getByTestId("modal-footer-close-button"));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(createMock).not.toHaveBeenCalled();
  });
});
