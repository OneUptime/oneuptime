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
import NetworkDeviceDiscoveryScan from "../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import Project from "../../../Models/DatabaseModels/Project";
import User from "../../../Models/DatabaseModels/User";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../Types/JSON";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import ProjectUtil from "../../../UI/Utils/Project";
import Toast from "../../../UI/Utils/Toast";
import { BaseTableProps } from "../../../UI/Components/ModelTable/BaseModelTable";
import Column from "../../../UI/Components/ModelTable/Column";
import ActionButtonSchema from "../../../UI/Components/ActionButton/ActionButtonSchema";
import { getDiscoveryScanRunRoute } from "../../../Utils/NetworkDiscovery/DiscoveryScanRun";
import DiscoveryImportFakeServer from "./DiscoveryImportFakeServer";

/*
 * RUN AGAIN ON NETWORK > DISCOVERY (OneUptime issue #10334), as the page
 * draws it.
 *
 * The scans list is drawn with its real columns and actions over a stand-in
 * table, so what the person sees on a row is what this reads: a scan that
 * does not repeat reads "On demand" now, where "One-time" said it ran once
 * and never again; its Status cell says when it last ran and offers Run
 * Again, and pressing it reads the list again so the row turns Queued; the
 * row's own actions are as they were (Run Again is in one place); and a
 * reader who may not edit scans sees no Run Again.
 */

type TableProps = Pick<
  BaseTableProps<NetworkDeviceDiscoveryScan>,
  | "columns"
  | "onFetchSuccess"
  | "actionButtons"
  | "topContent"
  | "refreshToggle"
  | "selectMoreFields"
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
                    return (
                      <div key={index} data-testid={`cell-${column.title}`}>
                        {column.getElement?.(row)}
                      </div>
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

const PROJECT_ID: ObjectID = new ObjectID(
  "10334000-0000-4000-8000-0000000000f2",
);
const SCAN_ID: string = "10334000-0000-4000-8000-0000000000f3";

function tabletsScan(
  overrides: Partial<Record<keyof NetworkDeviceDiscoveryScan, unknown>> = {},
): NetworkDeviceDiscoveryScan {
  return Object.assign(
    new NetworkDeviceDiscoveryScan(),
    {
      _id: SCAN_ID,
      name: "All Tablets Discovery",
      cidr: "10.16-49.0-255.45-47",
      status: "Completed",
      isRecurring: false,
      isSnmpEnabled: false,
      startedAt: new Date("2026-11-19T09:56:00Z"),
      completedAt: new Date("2026-11-19T10:00:00Z"),
      scannedHostCount: 8704,
      respondedHostCount: 2,
      discoveredDevices: [
        { ipAddress: "10.16.0.45", snmpReachable: false },
        { ipAddress: "10.16.0.46", snmpReachable: false },
      ],
    },
    overrides,
  );
}

let postSpy: jest.SpyInstance;
let getListSpy: jest.SpyInstance;

async function renderPage(row: NetworkDeviceDiscoveryScan): Promise<void> {
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

function statusCell(): HTMLElement {
  return screen.getByTestId("cell-Status");
}

function runAgainButton(): HTMLElement | null {
  return screen.queryByTestId(`discovery-scan-run-again-button-${SCAN_ID}`);
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["performance"] });
  jest.setSystemTime(new Date("2026-11-22T10:00:00Z"));
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
    .mockReturnValue([Permission.ProjectMember]);
  jest
    .spyOn(API, "getFriendlyMessage")
    .mockImplementation((err: unknown): string => {
      return (err as Error).message;
    });
  getListSpy = jest.spyOn(ModelAPI, "getList").mockResolvedValue({
    data: [tabletsScan({ status: "Pending", completedAt: null })],
    count: 1,
    skip: 0,
    limit: 1,
  } as ListResult<NetworkDeviceDiscoveryScan>);
  jest.spyOn(Toast, "success").mockReturnValue("toast");
  jest.spyOn(Toast, "error").mockReturnValue("toast");

  /*
   * The import API in memory, as the live page test has it, and the run
   * route beside it: the page asks for the project's active imports as it
   * opens.
   */
  postSpy = new DiscoveryImportFakeServer().install({
    post: (path: string): HTTPResponse<JSONObject> | HTTPErrorResponse => {
      return path.endsWith(getDiscoveryScanRunRoute(SCAN_ID))
        ? new HTTPResponse<JSONObject>(
            200,
            { scanId: SCAN_ID, status: "Pending" },
            {},
          )
        : new HTTPErrorResponse(404, { message: `No fake for ${path}` }, {});
    },
  }).postSpy!;
});

// The calls the page made to the run route.
function runRequests(): Array<{ url: unknown }> {
  return postSpy.mock.calls
    .map((call: Array<unknown>) => {
      return call[0] as { url: unknown };
    })
    .filter((request: { url: unknown }): boolean => {
      return String(request.url).includes(getDiscoveryScanRunRoute(SCAN_ID));
    });
}

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("a scan that does not repeat, on Network > Discovery", () => {
  test("reads On demand, not One-time, in its Scan cell and its Recurrence column", async () => {
    await renderPage(tabletsScan());

    expect(screen.getByTestId("cell-Scan")).toHaveTextContent("On demand");
    expect(screen.getByTestId("cell-Recurrence")).toHaveTextContent(
      "On demand",
    );
    expect(screen.queryByText(/One-time/)).not.toBeInTheDocument();
  });

  test("says in its Status cell when it last ran, and offers Run Again there", async () => {
    await renderPage(tabletsScan());

    expect(statusCell()).toHaveTextContent("Completed");
    expect(statusCell()).toHaveTextContent("Last run 3 days ago");
    expect(runAgainButton()).toBeInTheDocument();
    expect(statusCell()).toContainElement(runAgainButton());
  });

  test("runs again when pressed, and reads the list again so the row turns Queued", async () => {
    await renderPage(tabletsScan());
    const toggleBefore: unknown = capturedTable!.refreshToggle;

    await act(async () => {
      fireEvent.click(runAgainButton()!);
    });

    // The request, its answer and the toast are a few promises long.
    await act(async () => {
      for (let step: number = 0; step < 10; step++) {
        await Promise.resolve();
      }
    });

    expect(runRequests()).toHaveLength(1);
    expect(Toast.error).not.toHaveBeenCalled();
    expect(Toast.success).toHaveBeenCalledWith(
      "All Tablets Discovery is queued to run again.",
    );
    expect(capturedTable!.refreshToggle).not.toEqual(toggleBefore);

    // The list read again: the row is queued, and no button is left.
    act(() => {
      mockRows = [tabletsScan({ status: "Pending", completedAt: null })];
      capturedTable!.onFetchSuccess!(mockRows, mockRows.length);
    });

    expect(statusCell()).toHaveTextContent("Queued");
    expect(runAgainButton()).not.toBeInTheDocument();
  });

  test("keeps the row's own actions as they were: Run Again is in one place", async () => {
    await renderPage(tabletsScan());

    const titles: Array<string> = (capturedTable!.actionButtons || []).map(
      (button: ActionButtonSchema<NetworkDeviceDiscoveryScan>): string => {
        return button.title;
      },
    );

    expect(titles).toEqual(["Edit", "Review Results"]);
  });

  test("offers no Run Again to a reader who may not edit scans", async () => {
    jest
      .spyOn(PermissionUtil, "getAllPermissions")
      .mockReturnValue([Permission.Viewer]);

    await renderPage(tabletsScan());

    expect(statusCell()).toHaveTextContent("Last run 3 days ago");
    expect(runAgainButton()).not.toBeInTheDocument();
  });
});

describe("a scheduled scan, on Network > Discovery", () => {
  test("offers Run Again beside its schedule too", async () => {
    await renderPage(
      tabletsScan({
        isRecurring: true,
        rescanIntervalInMinutes: 60,
        nextScanAt: new Date("2026-11-22T10:30:00Z"),
      }),
    );

    expect(screen.getByTestId("cell-Scan")).toHaveTextContent(
      "Repeats every 60 min",
    );
    expect(runAgainButton()).toBeInTheDocument();
  });
});

describe("who asked for the run on a row", () => {
  function simon(): User {
    const user: User = new User();
    user.name = new Name("Simon Larsen");
    return user;
  }

  test("is read with the scans, and named in the Status cell", async () => {
    await renderPage(
      tabletsScan({
        status: "Pending",
        completedAt: null,
        runRequestedAt: new Date("2026-11-22T09:59:00Z"),
        runRequestedByUser: simon(),
      }),
    );

    expect(capturedTable!.selectMoreFields).toMatchObject({
      runRequestedAt: true,
      runRequestedByUser: { name: true, email: true },
    });
    expect(statusCell()).toHaveTextContent("Queued");
    expect(statusCell()).toHaveTextContent("Requested by Simon Larsen");
  });

  test("is followed by the live updates, so a scheduled run that clears it stops naming them", async () => {
    getListSpy.mockResolvedValue({
      data: [
        tabletsScan({
          status: "Pending",
          completedAt: null,
          runRequestedAt: null,
          runRequestedByUser: null,
        }),
      ],
      count: 1,
      skip: 0,
      limit: 1,
    } as ListResult<NetworkDeviceDiscoveryScan>);

    await renderPage(
      tabletsScan({
        status: "Pending",
        completedAt: null,
        runRequestedAt: new Date("2026-11-22T09:59:00Z"),
        runRequestedByUser: simon(),
      }),
    );

    expect(statusCell()).toHaveTextContent("Requested by Simon Larsen");

    await act(async () => {
      jest.advanceTimersByTime(10000);
    });

    expect(getListSpy.mock.calls[0]![0].select).toMatchObject({
      runRequestedAt: true,
      runRequestedByUser: { name: true, email: true },
    });
    expect(statusCell()).not.toHaveTextContent("Requested by");
  });
});
