import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import * as React from "react";

/*
 * Where packet captures appear: a probe's page (Monitors > Settings >
 * Probes > the probe) and a network device's Traffic page. Each reads what
 * the table needs - the probe's report, or the device's probe and address -
 * and hands it over; a device with no probe is told how to get one. And the
 * two calls the table makes that are not its own CRUD: Stop, and Download.
 */

const mockCapturedTableProps: Array<Record<string, unknown>> = [];

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/PacketCapture/PacketCapturesTable",
  () => {
    return {
      __esModule: true,
      default: (props: Record<string, unknown>): React.ReactElement => {
        mockCapturedTableProps.push(props);
        return <div data-testid="packet-captures-table" />;
      },
    };
  },
);

import DevicePacketCaptures from "../../../../App/FeatureSet/Dashboard/src/Components/PacketCapture/DevicePacketCaptures";
import ProbePacketCaptures from "../../../../App/FeatureSet/Dashboard/src/Components/PacketCapture/ProbePacketCaptures";
import {
  downloadPacketCapture,
  PACKET_CAPTURE_ROUTES,
  PacketCaptureFile,
  stopPacketCapture,
} from "../../../../App/FeatureSet/Dashboard/src/Components/PacketCapture/PacketCaptureApi";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import Probe from "../../../Models/DatabaseModels/Probe";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import getJestMockFunction, { MockFunction } from "../../MockType";

const PROBE_ID: string = "11111111-1111-4111-8111-111111111111";
const DEVICE_ID: string = "22222222-2222-4222-8222-222222222222";
const CAPTURE_ID: string = "33333333-3333-4333-8333-333333333333";

let getItemMock: MockFunction;

async function flush(): Promise<void> {
  await act(async () => {});
}

function latestTable(): Record<string, unknown> {
  expect(mockCapturedTableProps.length).toBeGreaterThan(0);
  return mockCapturedTableProps[mockCapturedTableProps.length - 1]!;
}

beforeEach(() => {
  mockCapturedTableProps.length = 0;
  getItemMock = getJestMockFunction();

  jest
    .spyOn(ModelAPI, "getItem")
    .mockImplementation(getItemMock as unknown as typeof ModelAPI.getItem);
  jest.spyOn(API, "getFriendlyMessage").mockImplementation((err: unknown) => {
    return (err as Error).message;
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a probe's page", () => {
  test("reads the probe with its packet capture report, then lists its captures", async () => {
    const probe: Probe = new Probe(new ObjectID(PROBE_ID));
    getItemMock.mockResolvedValue(probe);

    render(<ProbePacketCaptures probeId={new ObjectID(PROBE_ID)} />);

    expect(screen.getByTestId("component-loader")).toBeInTheDocument();

    await flush();

    const request: { modelType: unknown; id: ObjectID; select: JSONObject } =
      getItemMock.mock.calls[0]![0] as {
        modelType: unknown;
        id: ObjectID;
        select: JSONObject;
      };

    expect(request.modelType).toBe(Probe);
    expect(request.id.toString()).toBe(PROBE_ID);
    // Only what the probe's readers may read: never isGlobalProbe or the key.
    expect(request.select).toEqual({
      _id: true,
      name: true,
      projectId: true,
      packetCaptureCapability: true,
    });
    expect(latestTable()["probe"]).toBe(probe);
    expect(latestTable()["networkDeviceId"]).toBeUndefined();
  });

  test("a probe that cannot be read says why", async () => {
    getItemMock.mockRejectedValue(new Error("Probe not found."));

    render(<ProbePacketCaptures probeId={new ObjectID(PROBE_ID)} />);

    await flush();

    expect(screen.getByText("Probe not found.")).toBeInTheDocument();
    expect(mockCapturedTableProps).toHaveLength(0);
  });

  test("a probe that is not there says so", async () => {
    getItemMock.mockResolvedValue(null);

    render(<ProbePacketCaptures probeId={new ObjectID(PROBE_ID)} />);

    await flush();

    expect(
      screen.getByText("This probe could not be loaded."),
    ).toBeInTheDocument();
  });
});

describe("a device's Traffic page", () => {
  function device(withProbe: boolean): NetworkDevice {
    const item: NetworkDevice = new NetworkDevice(new ObjectID(DEVICE_ID));
    item.hostname = "10.0.0.9";

    if (withProbe) {
      item.probeId = new ObjectID(PROBE_ID);
      item.probe = new Probe();
      item.probe.name = "Site A";
    }

    return item;
  }

  test("captures run on the device's own probe, start at its address, and are linked to it", async () => {
    getItemMock.mockResolvedValue(device(true));

    render(<DevicePacketCaptures networkDeviceId={new ObjectID(DEVICE_ID)} />);

    await flush();

    const request: { modelType: unknown; select: JSONObject } = getItemMock.mock
      .calls[0]![0] as { modelType: unknown; select: JSONObject };

    expect(request.modelType).toBe(NetworkDevice);
    expect(request.select).toEqual({
      _id: true,
      hostname: true,
      probeId: true,
      probe: {
        _id: true,
        name: true,
        projectId: true,
        isGlobalProbe: true,
        packetCaptureCapability: true,
      },
    });

    const table: Record<string, unknown> = latestTable();

    // The probe read through the relation carries the device's probe id.
    expect((table["probe"] as Probe).id?.toString()).toBe(PROBE_ID);
    expect((table["networkDeviceId"] as ObjectID).toString()).toBe(DEVICE_ID);
    expect(table["defaultHost"]).toBe("10.0.0.9");
    expect(table["description"]).toBe(
      "Capture this device's traffic from its probe, then download the file and open it in Wireshark. New captures start filtered to the device's address.",
    );
  });

  test("a device with no probe is told how to get one, and lists nothing", async () => {
    getItemMock.mockResolvedValue(device(false));

    render(<DevicePacketCaptures networkDeviceId={new ObjectID(DEVICE_ID)} />);

    await flush();

    const note: HTMLElement = screen.getByTestId(
      "device-packet-capture-no-probe",
    );

    expect(note).toHaveTextContent(
      "This device has no probe. Assign one in its settings to capture its traffic from there.",
    );
    expect(
      screen.getByText("Open device settings").closest("a"),
    ).toHaveAttribute("href", expect.stringContaining(`${DEVICE_ID}/settings`));
    expect(mockCapturedTableProps).toHaveLength(0);
  });

  test("a device that cannot be read says why", async () => {
    getItemMock.mockRejectedValue(new Error("Network Device not found."));

    render(<DevicePacketCaptures networkDeviceId={new ObjectID(DEVICE_ID)} />);

    await flush();

    expect(screen.getByText("Network Device not found.")).toBeInTheDocument();
  });
});

describe("Stop and Download, over the API", () => {
  let postMock: MockFunction;

  beforeEach(() => {
    postMock = getJestMockFunction();
    jest
      .spyOn(API, "post")
      .mockImplementation(postMock as unknown as typeof API.post);
  });

  function postedTo(): string {
    return (postMock.mock.calls[0]![0] as { url: URL }).url.toString();
  }

  test("the routes are the capture's own, its id escaped", () => {
    expect(PACKET_CAPTURE_ROUTES.stop(CAPTURE_ID)).toBe(
      `/packet-capture/${CAPTURE_ID}/stop`,
    );
    expect(PACKET_CAPTURE_ROUTES.download("a/../b")).toBe(
      "/packet-capture/a%2F..%2Fb/download",
    );
  });

  test("Stop posts to the capture's stop route", async () => {
    postMock.mockResolvedValue(
      new HTTPResponse(200, { result: "ok" }, {}) as never,
    );

    await stopPacketCapture(new ObjectID(CAPTURE_ID));

    expect(postedTo()).toContain(`/packet-capture/${CAPTURE_ID}/stop`);
  });

  test("a refused Stop is thrown, for the table to show", async () => {
    const refusal: HTTPErrorResponse = new HTTPErrorResponse(
      400,
      { message: "This capture has already finished." },
      {},
    );
    postMock.mockResolvedValue(refusal as never);

    await expect(stopPacketCapture(new ObjectID(CAPTURE_ID))).rejects.toBe(
      refusal,
    );
  });

  test("Download turns the file back into its bytes, with its name and type", async () => {
    const bytes: Buffer = Buffer.from([0xd4, 0xc3, 0xb2, 0xa1, 0, 255]);

    postMock.mockResolvedValue(
      new HTTPResponse(
        200,
        {
          fileName: "packet-capture-site-a-eth0.pcap",
          fileType: "application/vnd.tcpdump.pcap",
          sizeInBytes: bytes.length,
          base64: bytes.toString("base64"),
        },
        {},
      ) as never,
    );

    const file: PacketCaptureFile = await downloadPacketCapture(
      new ObjectID(CAPTURE_ID),
    );

    expect(postedTo()).toContain(`/packet-capture/${CAPTURE_ID}/download`);
    expect(file.fileName).toBe("packet-capture-site-a-eth0.pcap");
    expect(file.fileType).toBe("application/vnd.tcpdump.pcap");
    expect(Buffer.from(file.bytes)).toEqual(bytes);
  });

  test("a download with no name or type is saved as a pcap file", async () => {
    postMock.mockResolvedValue(
      new HTTPResponse(
        200,
        { base64: Buffer.from("x").toString("base64") },
        {},
      ) as never,
    );

    const file: PacketCaptureFile = await downloadPacketCapture(
      new ObjectID(CAPTURE_ID),
    );

    expect(file.fileName).toBe("packet-capture.pcap");
    expect(file.fileType).toBe("application/vnd.tcpdump.pcap");
  });

  test("an answer with no file is an error, never an empty download", async () => {
    postMock.mockResolvedValue(new HTTPResponse(200, {}, {}) as never);

    await expect(
      downloadPacketCapture(new ObjectID(CAPTURE_ID)),
    ).rejects.toThrow("The capture file could not be downloaded.");
  });
});
