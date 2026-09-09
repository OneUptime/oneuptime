import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import DiscoveryPage from "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkDevice/Discovery";
import ProbeUtil from "../../../../App/FeatureSet/Dashboard/src/Utils/Probe";
import NetworkDeviceDiscoveryScan, {
  DiscoveredNetworkDevice,
} from "../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import Project from "../../../Models/DatabaseModels/Project";
import ObjectID from "../../../Types/ObjectID";
import Route from "../../../Types/API/Route";
import Permission from "../../../Types/Permission";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import PermissionUtil from "../../../UI/Utils/Permission";
import { BaseTableProps } from "../../../UI/Components/ModelTable/BaseModelTable";
import Column from "../../../UI/Components/ModelTable/Column";
import ActionButtonSchema from "../../../UI/Components/ActionButton/ActionButtonSchema";
import { ComponentProps as ModalProps } from "../../../UI/Components/Modal/Modal";

type TableProps = Pick<
  BaseTableProps<NetworkDeviceDiscoveryScan>,
  "columns" | "onFetchSuccess" | "actionButtons" | "topContent"
>;
let capturedTable: TableProps | null = null;
let mockRows: Array<NetworkDeviceDiscoveryScan> = [];

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: TableProps) => {
      capturedTable = props;
      return (
        <div>
          {props.topContent}
          {mockRows.map((row: NetworkDeviceDiscoveryScan) => {
            return (
              <div key={row._id} data-testid="scan-row">
                {props.columns.map(
                  (
                    column: Column<NetworkDeviceDiscoveryScan>,
                    index: number,
                  ) => {
                    return <div key={index}>{column.getElement?.(row)}</div>;
                  },
                )}
                {props.actionButtons
                  ?.filter(
                    (
                      button: ActionButtonSchema<NetworkDeviceDiscoveryScan>,
                    ) => {
                      return button.isVisible?.(row) !== false;
                    },
                  )
                  .map(
                    (
                      button: ActionButtonSchema<NetworkDeviceDiscoveryScan>,
                    ) => {
                      return (
                        <button
                          key={button.title}
                          onClick={() => {
                            void button.onClick(
                              row,
                              () => {},
                              () => {},
                            );
                          }}
                        >
                          {button.title}
                        </button>
                      );
                    },
                  )}
              </div>
            );
          })}
        </div>
      );
    },
  };
});

jest.mock("../../../UI/Components/Modal/Modal", () => {
  return {
    __esModule: true,
    ModalWidth: { Medium: 1 },
    default: (props: ModalProps) => {
      return (
        <div role="dialog" aria-label={props.title}>
          <p>{props.description}</p>
          {props.error && <p role="alert">{props.error}</p>}
          {!props.isBodyLoading && props.children}
          <button onClick={props.onClose}>Close review</button>
          <button
            disabled={props.disableSubmitButton || props.isLoading}
            onClick={props.onSubmit}
          >
            {props.submitButtonText}
          </button>
        </div>
      );
    },
  };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SCAN_ID: string = "22222222-2222-4222-8222-222222222222";
let getListSpy: jest.SpyInstance;
let getItemSpy: jest.SpyInstance;

type ScanOverrides = {
  [Key in keyof NetworkDeviceDiscoveryScan]?:
    | NetworkDeviceDiscoveryScan[Key]
    | undefined;
};

function scan(overrides: ScanOverrides = {}): NetworkDeviceDiscoveryScan {
  return Object.assign(
    new NetworkDeviceDiscoveryScan(),
    {
      _id: SCAN_ID,
      name: "Core switches",
      cidr: "10.240-249.0-255.220-225",
      status: "In Progress",
      startedAt: new Date("2026-09-09T12:00:00Z"),
      scannedHostCount: 0,
      respondedHostCount: 0,
      discoveredDevices: [],
    },
    overrides,
  );
}

function list(
  row: NetworkDeviceDiscoveryScan,
): ListResult<NetworkDeviceDiscoveryScan> {
  return { data: [row], count: 1, skip: 0, limit: 1 };
}

const HOST: DiscoveredNetworkDevice = {
  ipAddress: "10.240.0.220",
  snmpReachable: false,
  isAlreadyRegistered: false,
};

async function renderPage(
  row: NetworkDeviceDiscoveryScan = scan(),
): Promise<void> {
  mockRows = [row];
  const project: Project = Object.assign(new Project(), { id: PROJECT_ID });
  await act(async () => {
    render(
      <MemoryRouter>
        <DiscoveryPage
          pageRoute={new Route("/dashboard/network-devices/discovery")}
          currentProject={project}
          hasPaymentMethod={true}
        />
      </MemoryRouter>,
    );
  });
  act(() => {
    capturedTable!.onFetchSuccess!(mockRows, mockRows.length);
  });
}

async function poll(): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(10000);
  });
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["performance"] });
  jest.setSystemTime(new Date("2026-09-09T12:02:00Z"));
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: false,
  });
  capturedTable = null;
  mockRows = [];
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(ProbeUtil, "getAllProbes").mockResolvedValue([]);
  jest
    .spyOn(PermissionUtil, "getAllPermissions")
    .mockReturnValue([Permission.ProjectAdmin]);
  jest
    .spyOn(API, "getFriendlyMessage")
    .mockImplementation((err: unknown): string => {
      return (err as Error).message;
    });
  getListSpy = jest.spyOn(ModelAPI, "getList").mockResolvedValue(
    list(
      scan({
        statusMessage: "Scan in progress: checking ping reachability.",
        scannedHostCount: 7680,
        respondedHostCount: 1,
        discoveredDevices: [HOST],
      }),
    ),
  );
  getItemSpy = jest
    .spyOn(ModelAPI, "getItem")
    .mockResolvedValue(
      scan({ discoveredDevices: [HOST], isSnmpEnabled: false }),
    );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("Discovery page live progress wiring", () => {
  test("background progress updates keep rows visible and make newly available results reviewable", async () => {
    await renderPage();
    const originalRow: HTMLElement = screen.getByTestId("scan-row");
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "0",
    );
    expect(
      screen.queryByRole("button", { name: "Review Results" }),
    ).not.toBeInTheDocument();
    await poll();
    expect(screen.getByTestId("scan-row")).toBe(originalRow);
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "50",
    );
    expect(
      screen.getByText("7,680 of 15,360 addresses swept"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Review Results" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Partial results are ready to review."),
    ).toBeInTheDocument();
  });

  test("a failed scan keeps partial results accessible and stops polling", async () => {
    getListSpy.mockResolvedValue(
      list(
        scan({
          status: "Failed",
          scannedHostCount: 1024,
          respondedHostCount: 1,
          discoveredDevices: [HOST],
          statusMessage: "Probe lost connection during discovery.",
        }),
      ),
    );
    await renderPage();
    await poll();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(
      screen.getAllByText("Probe lost connection during discovery.")[0],
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Review Results" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    await poll();
    expect(getListSpy).toHaveBeenCalledTimes(1);
  });

  test("network failure explains stale progress with a retry that recovers in place", async () => {
    getListSpy.mockRejectedValueOnce(new Error("Connection interrupted"));
    await renderPage();
    const originalRow: HTMLElement = screen.getByTestId("scan-row");
    await poll();
    expect(screen.getByText("Live updates interrupted")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Showing the last known progress. Updates will retry automatically.",
      ),
    ).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Retry now" }));
    });
    expect(
      screen.queryByText("Live updates interrupted"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute(
      "aria-valuenow",
      "50",
    );
    expect(screen.getByTestId("scan-row")).toBe(originalRow);
  });

  test("queued scans do not offer stale results from an earlier run", async () => {
    await renderPage(
      scan({
        status: "Pending",
        respondedHostCount: 10,
        scannedHostCount: 15360,
        discoveredDevices: [HOST],
      }),
    );
    expect(screen.getByText("Queued")).toBeInTheDocument();
    expect(
      screen.getByText("Results will appear when the probe starts."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Review Results" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/10 of 15360 hosts/)).not.toBeInTheDocument();
  });

  test("a claimed recurring scan hides the previous run's results until a new report arrives", async () => {
    await renderPage(
      scan({
        scannedHostCount: 15360,
        respondedHostCount: 10,
        discoveredDevices: [HOST],
        statusMessage: "Scan started. Waiting for the first progress update.",
      }),
    );
    expect(screen.getByRole("progressbar")).not.toHaveAttribute(
      "aria-valuenow",
    );
    expect(
      screen.queryByRole("button", { name: "Review Results" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/10 of 15360 hosts/)).not.toBeInTheDocument();
    await poll();
    expect(
      screen.getByRole("button", { name: "Review Results" }),
    ).toBeInTheDocument();
  });

  test("started column selects the actual run start rather than the original creation time", async () => {
    await renderPage(
      scan({
        status: "Pending",
        startedAt: undefined,
        createdAt: new Date("2020-01-01T12:00:00Z"),
      }),
    );
    const column: Column<NetworkDeviceDiscoveryScan> | undefined =
      capturedTable!.columns.find(
        (item: Column<NetworkDeviceDiscoveryScan>) => {
          return item.title === "Started";
        },
      );
    expect(column?.field).toEqual({ startedAt: true });
    expect(screen.getByText("Not started")).toBeInTheDocument();
  });

  test("reviewing a live result explains that importing is safe while discovery continues", async () => {
    await renderPage(scan({ discoveredDevices: [HOST] }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Review Results" }));
    });
    expect(getItemSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/This scan is still running/)).toBeInTheDocument();
    expect(screen.getByText(/This review is a snapshot/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Import Selected (1)" }),
    ).toBeEnabled();
  });
});
