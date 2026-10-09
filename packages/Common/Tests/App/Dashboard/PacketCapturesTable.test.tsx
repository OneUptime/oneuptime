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
 * A probe's packet captures - or a device's - with Start Packet Capture in
 * the header, Download on a finished row and Stop on a running one. The
 * table is captured rather than rendered, so what is pinned is what it is
 * handed: which captures it lists, who sees which button and why one is
 * locked, what each row says, that the list keeps re-reading while
 * something runs, and what Download and Stop do.
 */

const mockCapturedTableProps: Array<Record<string, unknown>> = [];
const mockCapturedModalProps: Array<Record<string, unknown>> = [];
const mockDownloadFile: jest.Mock = jest.fn();
const mockStopPacketCapture: jest.Mock = jest.fn();
const mockDownloadPacketCapture: jest.Mock = jest.fn();
const mockGates: Record<
  string,
  { isAllowed: boolean; disabledReason?: string | undefined }
> = {};

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): null => {
      mockCapturedTableProps.push(props);
      return null;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/PacketCapture/StartPacketCaptureModal",
  () => {
    return {
      __esModule: true,
      default: (props: Record<string, unknown>): React.ReactElement => {
        mockCapturedModalProps.push(props);
        return <div data-testid="start-packet-capture-modal" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/PacketCapture/PacketCaptureApi",
  () => {
    return {
      __esModule: true,
      stopPacketCapture: (...args: Array<unknown>): unknown => {
        return mockStopPacketCapture(...args);
      },
      downloadPacketCapture: (...args: Array<unknown>): unknown => {
        return mockDownloadPacketCapture(...args);
      },
    };
  },
);

jest.mock("../../../UI/Utils/DownloadFile", () => {
  return {
    __esModule: true,
    default: (...args: Array<unknown>): unknown => {
      return mockDownloadFile(...args);
    },
  };
});

jest.mock("../../../UI/Utils/PermissionGate", () => {
  return {
    __esModule: true,
    default: {
      checkPermissions: (
        permissions: Array<string>,
      ): { isAllowed: boolean; disabledReason?: string | undefined } => {
        return (
          mockGates[permissions.join(",")] || {
            isAllowed: true,
          }
        );
      },
    },
  };
});

import PacketCapturesTable from "../../../../App/FeatureSet/Dashboard/src/Components/PacketCapture/PacketCapturesTable";
import { PACKET_CAPTURE_POLL_INTERVAL_IN_MS } from "../../../../App/FeatureSet/Dashboard/src/Components/PacketCapture/PacketCaptureViewModel";
import PacketCapture from "../../../Models/DatabaseModels/PacketCapture";
import Probe from "../../../Models/DatabaseModels/Probe";
import User from "../../../Models/DatabaseModels/User";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import Email from "../../../Types/Email";
import { JSONObject } from "../../../Types/JSON";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import PacketCaptureEndReason from "../../../Types/PacketCapture/PacketCaptureEndReason";
import {
  PACKET_CAPTURE_DOWNLOAD_PERMISSIONS,
  PACKET_CAPTURE_DOWNLOAD_REFUSED_MESSAGE,
  PACKET_CAPTURE_STOP_PERMISSIONS,
  PACKET_CAPTURE_STOP_REFUSED_MESSAGE,
} from "../../../Types/PacketCapture/PacketCapturePermissions";
import PacketCaptureStatus from "../../../Types/PacketCapture/PacketCaptureStatus";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";

const PROBE_ID: string = "11111111-1111-4111-8111-111111111111";
const DEVICE_ID: string = "22222222-2222-4222-8222-222222222222";
const CAPTURE_ID: string = "33333333-3333-4333-8333-333333333333";

interface ActionButton {
  title: string;
  disabled?: boolean;
  tooltip?: string;
  isVisible: (item: PacketCapture) => boolean;
  onClick: (item: PacketCapture, onCompleteAction: () => void) => Promise<void>;
}

interface Column {
  title: string;
  getElement: (item: PacketCapture) => React.ReactElement;
}

function capability(overrides: JSONObject = {}): JSONObject {
  return {
    isEnabled: true,
    isToolAvailable: true,
    interfaces: [{ name: "any", addresses: [] }],
    limits: {
      maxDurationInSeconds: 1800,
      maxPackets: 1000000,
      maxFileSizeInMB: 25,
    },
    ...overrides,
  };
}

// A probe as the page reads it; null is one that never reported.
function probe(report: JSONObject | null = capability()): Probe {
  const item: Probe = new Probe(new ObjectID(PROBE_ID));
  item.name = "Site A";
  item.isGlobalProbe = false;
  item.packetCaptureCapability = report || undefined;
  return item;
}

function row(overrides: Partial<PacketCapture> = {}): PacketCapture {
  const item: PacketCapture = new PacketCapture(new ObjectID(CAPTURE_ID));
  item.interfaceName = "eth0";
  item.bpfFilter = "host 10.0.0.5";
  item.status = PacketCaptureStatus.Completed;
  item.maxDurationInSeconds = 60;
  item.maxPackets = 100000;
  item.maxFileSizeInMB = 10;
  item.packetCount = 3;
  item.fileSizeInBytes = 1536;
  item.endReason = PacketCaptureEndReason.DurationReached;
  item.createdAt = new Date();
  Object.assign(item, overrides);
  return item;
}

function latestTable(): Record<string, unknown> {
  expect(mockCapturedTableProps.length).toBeGreaterThan(0);
  return mockCapturedTableProps[mockCapturedTableProps.length - 1]!;
}

function button(title: string): ActionButton {
  const found: ActionButton | undefined = (
    latestTable()["actionButtons"] as Array<ActionButton>
  ).find((item: ActionButton): boolean => {
    return item.title === title;
  });

  expect(found).toBeDefined();

  return found!;
}

function column(title: string): Column {
  const found: Column | undefined = (
    latestTable()["columns"] as Array<Column>
  ).find((item: Column): boolean => {
    return item.title === title;
  });

  expect(found).toBeDefined();

  return found!;
}

function renderCell(title: string, item: PacketCapture): HTMLElement {
  const { container } = render(column(title).getElement(item));
  return container;
}

async function flush(): Promise<void> {
  await act(async () => {});
}

let countSpy: jest.SpiedFunction<typeof ModelAPI.count>;

beforeEach(() => {
  mockCapturedTableProps.length = 0;
  mockCapturedModalProps.length = 0;
  mockDownloadFile.mockReset();
  mockStopPacketCapture.mockReset();
  mockDownloadPacketCapture.mockReset();

  for (const key of Object.keys(mockGates)) {
    delete mockGates[key];
  }

  countSpy = jest.spyOn(ModelAPI, "count").mockResolvedValue(0);
  jest.spyOn(API, "getFriendlyMessage").mockImplementation((err: unknown) => {
    return (err as Error).message;
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("a probe that can capture", () => {
  test("lists its captures, newest first, with Start in the header", () => {
    render(<PacketCapturesTable probe={probe()} />);

    const table: Record<string, unknown> = latestTable();

    expect(table["modelType"]).toBe(PacketCapture);
    expect(JSON.stringify(table["query"])).toContain(PROBE_ID);
    expect(table["sortBy"]).toBe("createdAt");
    expect(table["sortOrder"]).toBe(SortOrder.Descending);
    expect(table["isCreateable"]).toBe(true);
    expect(table["createVerb"]).toBe("Start");
    expect(table["isDeleteable"]).toBe(true);
    expect(table["isEditable"]).toBe(false);
    expect(table["cardProps"]).toEqual({
      title: "Packet Captures",
      description:
        "Capture the traffic this probe sees, then download the file and open it in Wireshark.",
    });
    expect(table["topContent"]).toBeUndefined();

    // Nothing is counted for a probe that can capture.
    expect(countSpy).not.toHaveBeenCalled();
  });

  test("reads every column a row needs to say what happened", () => {
    render(<PacketCapturesTable probe={probe()} />);

    expect(latestTable()["selectMoreFields"]).toMatchObject({
      bpfFilter: true,
      createdAt: true,
      createdByUser: { name: true, email: true },
      startedAt: true,
      stopRequestedAt: true,
      maxDurationInSeconds: true,
      packetCount: true,
      fileSizeInBytes: true,
      endReason: true,
      statusMessage: true,
    });
  });

  test("Start opens the form for this probe, with what it reported", () => {
    render(<PacketCapturesTable probe={probe()} />);

    act(() => {
      (latestTable()["onCreateClick"] as () => void)();
    });

    expect(
      screen.getByTestId("start-packet-capture-modal"),
    ).toBeInTheDocument();

    const modal: Record<string, unknown> =
      mockCapturedModalProps[mockCapturedModalProps.length - 1]!;

    expect((modal["probeId"] as ObjectID).toString()).toBe(PROBE_ID);
    expect(modal["capability"]).toMatchObject({ isEnabled: true });
    expect(modal["networkDeviceId"]).toBeUndefined();
  });

  test("a started capture closes the form and the list re-reads at once", () => {
    render(<PacketCapturesTable probe={probe()} />);

    act(() => {
      (latestTable()["onCreateClick"] as () => void)();
    });

    const before: unknown = latestTable()["refreshToggle"];

    act(() => {
      (
        mockCapturedModalProps[mockCapturedModalProps.length - 1]![
          "onStarted"
        ] as () => void
      )();
    });

    expect(
      screen.queryByTestId("start-packet-capture-modal"),
    ).not.toBeInTheDocument();
    expect(latestTable()["refreshToggle"]).not.toBe(before);
  });
});

describe("a probe that cannot capture", () => {
  test("with nothing captured before, shows only why, and how to turn it on", async () => {
    render(
      <PacketCapturesTable probe={probe(capability({ isEnabled: false }))} />,
    );

    await flush();

    expect(screen.getByTestId("packet-capture-readiness")).toHaveAttribute(
      "data-readiness",
      "TurnedOff",
    );
    expect(mockCapturedTableProps).toHaveLength(0);
  });

  test("shows a loader while it finds out whether anything was captured before", () => {
    countSpy.mockReturnValue(new Promise<number>(() => {}));

    render(<PacketCapturesTable probe={probe(null)} />);

    expect(screen.getByTestId("component-loader")).toBeInTheDocument();
  });

  test("with past captures, lists them under the notice, with no Start", async () => {
    countSpy.mockResolvedValue(2);

    render(
      <PacketCapturesTable
        probe={probe(capability({ isToolAvailable: false }))}
      />,
    );

    await flush();

    const table: Record<string, unknown> = latestTable();

    expect(table["isCreateable"]).toBe(false);

    render(table["topContent"] as React.ReactElement);

    expect(screen.getByTestId("packet-capture-readiness")).toHaveAttribute(
      "data-readiness",
      "NoTool",
    );
  });

  test("a count that fails shows the table, which explains itself", async () => {
    countSpy.mockRejectedValue(new Error("network"));

    render(<PacketCapturesTable probe={probe(null)} />);

    await flush();

    expect(latestTable()["isCreateable"]).toBe(false);
  });

  test("a global probe never offers Start", async () => {
    const globalProbe: Probe = probe();
    globalProbe.isGlobalProbe = true;
    countSpy.mockResolvedValue(1);

    render(<PacketCapturesTable probe={globalProbe} />);

    await flush();

    expect(latestTable()["isCreateable"]).toBe(false);
  });
});

describe("on a device's page", () => {
  test("lists the device's captures, and new ones are linked to it and start at its address", () => {
    render(
      <PacketCapturesTable
        probe={probe()}
        networkDeviceId={new ObjectID(DEVICE_ID)}
        defaultHost="10.0.0.9"
        description="Device description."
      />,
    );

    const table: Record<string, unknown> = latestTable();

    expect(JSON.stringify(table["query"])).toContain(DEVICE_ID);
    expect(JSON.stringify(table["query"])).not.toContain(PROBE_ID);
    expect(table["cardProps"]).toMatchObject({
      description: "Device description.",
    });

    act(() => {
      (table["onCreateClick"] as () => void)();
    });

    const modal: Record<string, unknown> =
      mockCapturedModalProps[mockCapturedModalProps.length - 1]!;

    expect((modal["networkDeviceId"] as ObjectID).toString()).toBe(DEVICE_ID);
    expect(modal["defaultHost"]).toBe("10.0.0.9");
  });

  test("each row says which probe it ran on", () => {
    render(
      <PacketCapturesTable
        probe={probe()}
        networkDeviceId={new ObjectID(DEVICE_ID)}
      />,
    );

    const item: PacketCapture = row();
    const ranOn: Probe = new Probe();
    ranOn.name = "Site A";
    item.probe = ranOn;

    expect(renderCell("Capture", item)).toHaveTextContent("on Site A");
  });
});

describe("what each row says", () => {
  beforeEach(() => {
    render(<PacketCapturesTable probe={probe()} />);
  });

  test("the interface, the filter and who started it", () => {
    const item: PacketCapture = row();
    const user: User = new User();
    user.name = new Name("Ada Lovelace");
    user.email = new Email("ada@example.com");
    item.createdByUser = user;

    const cell: HTMLElement = renderCell("Capture", item);

    expect(cell).toHaveTextContent("eth0");
    expect(cell).toHaveTextContent("host 10.0.0.5");
    expect(cell).toHaveTextContent("by Ada Lovelace");
  });

  test("every interface, and every packet", () => {
    const cell: HTMLElement = renderCell(
      "Capture",
      row({ interfaceName: "any", bpfFilter: "" }),
    );

    expect(cell).toHaveTextContent("All interfaces");
    expect(cell).toHaveTextContent("All traffic");
  });

  test("a finished capture says what its file holds and why it stopped", () => {
    const cell: HTMLElement = renderCell("Status", row());

    expect(cell).toHaveTextContent("Completed");
    expect(cell).toHaveTextContent("3 packets · 1.5 KB");
    expect(cell).toHaveTextContent("Stopped after 1 minute.");
  });

  test("a running capture shows its progress against its duration", () => {
    const cell: HTMLElement = renderCell(
      "Status",
      row({
        status: PacketCaptureStatus.Running,
        startedAt: new Date(Date.now() - 15 * 1000),
        maxDurationInSeconds: 60,
      }),
    );

    expect(cell).toHaveTextContent("Running");

    const progress: HTMLElement = screen.getByRole("progressbar");

    expect(progress).toHaveAttribute("aria-valuemax", "60");
    expect(
      Number(progress.getAttribute("aria-valuenow")),
    ).toBeGreaterThanOrEqual(14);
    expect(Number(progress.getAttribute("aria-valuenow"))).toBeLessThanOrEqual(
      16,
    );
  });

  test("a failed capture says why", () => {
    const cell: HTMLElement = renderCell(
      "Status",
      row({
        status: PacketCaptureStatus.Failed,
        statusMessage: "tcpdump could not use the filter.",
      }),
    );

    expect(cell).toHaveTextContent("Failed");
    expect(cell).toHaveTextContent("tcpdump could not use the filter.");
  });
});

describe("Download and Stop", () => {
  test("Download is on a finished row with packets, Stop on a running one", () => {
    render(<PacketCapturesTable probe={probe()} />);

    expect(button("Download").isVisible(row())).toBe(true);
    expect(button("Download").isVisible(row({ packetCount: 0 }))).toBe(false);
    expect(
      button("Download").isVisible(
        row({ status: PacketCaptureStatus.Running }),
      ),
    ).toBe(false);

    expect(
      button("Stop").isVisible(row({ status: PacketCaptureStatus.Running })),
    ).toBe(true);
    expect(
      button("Stop").isVisible(
        row({
          status: PacketCaptureStatus.Running,
          stopRequestedAt: new Date(),
        }),
      ),
    ).toBe(false);
    expect(button("Stop").isVisible(row())).toBe(false);
  });

  test("a reader who may not download or stop sees the buttons locked, saying why", () => {
    mockGates[PACKET_CAPTURE_DOWNLOAD_PERMISSIONS.join(",")] = {
      isAllowed: false,
      disabledReason: PACKET_CAPTURE_DOWNLOAD_REFUSED_MESSAGE,
    };
    mockGates[PACKET_CAPTURE_STOP_PERMISSIONS.join(",")] = {
      isAllowed: false,
      disabledReason: PACKET_CAPTURE_STOP_REFUSED_MESSAGE,
    };

    render(<PacketCapturesTable probe={probe()} />);

    expect(button("Download").disabled).toBe(true);
    expect(button("Download").tooltip).toBe(
      PACKET_CAPTURE_DOWNLOAD_REFUSED_MESSAGE,
    );
    expect(button("Download").isVisible(row())).toBe(true);
    expect(button("Stop").disabled).toBe(true);
    expect(button("Stop").tooltip).toBe(PACKET_CAPTURE_STOP_REFUSED_MESSAGE);
  });

  test("while the reader's permissions are still loading, the buttons are hidden, not locked", () => {
    mockGates[PACKET_CAPTURE_DOWNLOAD_PERMISSIONS.join(",")] = {
      isAllowed: false,
    };
    mockGates[PACKET_CAPTURE_STOP_PERMISSIONS.join(",")] = {
      isAllowed: false,
    };

    render(<PacketCapturesTable probe={probe()} />);

    expect(button("Download").isVisible(row())).toBe(false);
    expect(
      button("Stop").isVisible(row({ status: PacketCaptureStatus.Running })),
    ).toBe(false);
  });

  test("Download fetches the file and saves it under its name", async () => {
    const bytes: Uint8Array = new Uint8Array([0xd4, 0xc3, 0xb2, 0xa1]);

    mockDownloadPacketCapture.mockResolvedValue({
      fileName: "packet-capture-site-a-eth0.pcap",
      fileType: "application/vnd.tcpdump.pcap",
      bytes: bytes,
    } as never);

    render(<PacketCapturesTable probe={probe()} />);

    const done: jest.Mock = jest.fn();

    await act(async () => {
      await button("Download").onClick(row(), done);
    });

    expect(
      (mockDownloadPacketCapture.mock.calls[0]![0] as ObjectID).toString(),
    ).toBe(CAPTURE_ID);

    const saved: { content: Blob; filename: string } = mockDownloadFile.mock
      .calls[0]![0] as { content: Blob; filename: string };

    expect(saved.filename).toBe("packet-capture-site-a-eth0.pcap");
    expect(saved.content.type).toBe("application/vnd.tcpdump.pcap");
    expect(saved.content.size).toBe(4);
    expect(done).toHaveBeenCalledTimes(1);
  });

  test("a refused download is said above the list", async () => {
    mockDownloadPacketCapture.mockRejectedValue(
      new Error(PACKET_CAPTURE_DOWNLOAD_REFUSED_MESSAGE) as never,
    );

    render(<PacketCapturesTable probe={probe()} />);

    const done: jest.Mock = jest.fn();

    await act(async () => {
      await button("Download").onClick(row(), done);
    });

    expect(mockDownloadFile).not.toHaveBeenCalled();
    expect(done).toHaveBeenCalledTimes(1);

    render(latestTable()["topContent"] as React.ReactElement);

    expect(screen.getByTestId("packet-capture-action-error")).toHaveTextContent(
      PACKET_CAPTURE_DOWNLOAD_REFUSED_MESSAGE,
    );
  });

  test("Stop asks the probe to stop, and the list re-reads", async () => {
    mockStopPacketCapture.mockResolvedValue(undefined as never);

    render(<PacketCapturesTable probe={probe()} />);

    const before: unknown = latestTable()["refreshToggle"];
    const done: jest.Mock = jest.fn();

    await act(async () => {
      await button("Stop").onClick(
        row({ status: PacketCaptureStatus.Running }),
        done,
      );
    });

    expect(
      (mockStopPacketCapture.mock.calls[0]![0] as ObjectID).toString(),
    ).toBe(CAPTURE_ID);
    expect(latestTable()["refreshToggle"]).not.toBe(before);
    expect(done).toHaveBeenCalledTimes(1);
  });
});

describe("while something is waiting or running", () => {
  test("the list re-reads itself every few seconds, and stops once nothing is", () => {
    jest.useFakeTimers();

    render(<PacketCapturesTable probe={probe()} />);

    act(() => {
      (
        latestTable()["onFetchSuccess"] as (items: Array<PacketCapture>) => void
      )([row({ status: PacketCaptureStatus.Pending })]);
    });

    const first: unknown = latestTable()["refreshToggle"];

    act(() => {
      jest.advanceTimersByTime(PACKET_CAPTURE_POLL_INTERVAL_IN_MS);
    });

    const second: unknown = latestTable()["refreshToggle"];

    expect(second).not.toBe(first);

    act(() => {
      (
        latestTable()["onFetchSuccess"] as (items: Array<PacketCapture>) => void
      )([row()]);
    });

    const settled: unknown = latestTable()["refreshToggle"];

    act(() => {
      jest.advanceTimersByTime(PACKET_CAPTURE_POLL_INTERVAL_IN_MS * 3);
    });

    expect(latestTable()["refreshToggle"]).toBe(settled);
  });
});
