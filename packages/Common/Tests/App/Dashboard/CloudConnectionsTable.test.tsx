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
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * Cloud > Connect > Connected accounts. Only what the list hands to
 * ModelTable, and what it draws around it, is under test, so ModelTable is
 * captured instead of rendered:
 *
 *   - it reads the connections of this project with what the list shows,
 *     never their credentials or what a read keeps for the next one;
 *   - each row: the account (cloud, name, what it reads), how it is doing,
 *     its resources by service with a way to all of them, and when it was
 *     last read, what it then held and how often it is read;
 *   - its actions: View error only while it is not working, Read now and
 *     Turn off while it is on, Turn on while it is off, Test, Edit - each
 *     greyed, with why, without the right to change connections;
 *   - Read now queues a read and says how to see it end; Test opens a test
 *     of the saved connection; View error says what went wrong in a test's
 *     words, the stored error under them.
 */

const mockCapturedTableProps: Array<Record<string, unknown>> = [];

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): null => {
      mockCapturedTableProps.push(props);
      return null;
    },
  };
});

import CloudConnectionsTable from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/Connect/CloudConnectionsTable";
import CloudConnection from "../../../Models/DatabaseModels/CloudConnection";
import Route from "../../../Types/API/Route";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import { CloudConnectionFailureKind } from "../../../Types/CloudConnection/CloudConnectionTest";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { PermissionGateResult } from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

interface CapturedAction {
  title: string;
  disabled?: boolean;
  tooltip?: string;
  isVisible?: (item: CloudConnection) => boolean;
  onClick: (item: CloudConnection, done: () => void) => void | Promise<void>;
}

interface CapturedColumn {
  title: string;
  getElement: (item: CloudConnection) => React.ReactElement;
}

const CONNECTION_ID: string = "20000000-0000-4000-8000-000000000001";
const RESOURCES_ROUTE: Route = new Route(
  `/dashboard/${PROJECT_ID}/cloud/resources`,
);

let postSpy: jest.SpyInstance<any, any>;
let updateSpy: jest.SpyInstance<any, any>;

function connection(fields: Partial<CloudConnection> = {}): CloudConnection {
  const item: CloudConnection = new CloudConnection();
  item._id = CONNECTION_ID;
  item.name = "Production AWS";
  item.provider = CloudProvider.AWS;
  item.isEnabled = true;
  item.config = { authMethod: "aws-role", readIntervalInMinutes: "10" };
  Object.assign(item, fields);
  return item;
}

function readResult(data: JSONObject): JSONObject {
  return {
    status: "success",
    accounts: ["123456789012"],
    resourceCount: 0,
    resourceTypes: [],
    regions: [],
    newResources: 0,
    archivedResources: 0,
    pointsWritten: 0,
    requestCount: 0,
    warnings: [],
    durationMs: 1,
    finishedAt: "2026-10-21T10:00:00.000Z",
    ...data,
  };
}

beforeEach(() => {
  mockCapturedTableProps.length = 0;
  goTo(`/dashboard/${PROJECT_ID}/cloud/connect`);
  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
    new ObjectID(PROJECT_ID),
  );
  postSpy = getJestSpyOn(API, "post").mockResolvedValue({
    data: { queued: true },
  });
  updateSpy = getJestSpyOn(ModelAPI, "updateById").mockResolvedValue({});
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

function renderTable(
  updateGate: PermissionGateResult = { isAllowed: true },
  onEdit: MockFunction = getJestMockFunction(),
): void {
  render(
    <MemoryRouter>
      <CloudConnectionsTable
        refreshToggle="0"
        updateGate={updateGate}
        resourcesRoute={RESOURCES_ROUTE}
        onEdit={onEdit}
        onConnectionsLoaded={getJestMockFunction()}
      />
    </MemoryRouter>,
  );
}

function tableProps(): Record<string, unknown> {
  expect(mockCapturedTableProps.length).toBeGreaterThan(0);
  return mockCapturedTableProps[mockCapturedTableProps.length - 1]!;
}

function action(title: string): CapturedAction {
  const found: CapturedAction | undefined = (
    tableProps()["actionButtons"] as Array<CapturedAction>
  ).find((item: CapturedAction): boolean => {
    return item.title === title;
  });
  expect(found).toBeDefined();
  return found!;
}

function column(title: string): CapturedColumn {
  const found: CapturedColumn | undefined = (
    tableProps()["columns"] as Array<CapturedColumn>
  ).find((item: CapturedColumn): boolean => {
    return item.title === title;
  });
  expect(found).toBeDefined();
  return found!;
}

function drawCell(title: string, item: CloudConnection): HTMLElement {
  const { container } = render(
    <MemoryRouter>{column(title).getElement(item)}</MemoryRouter>,
  );
  return container;
}

describe("what the list reads", () => {
  test("this project's connections, with what the list shows - never credentials or read state", () => {
    renderTable();

    const props: Record<string, unknown> = tableProps();

    expect(props["modelType"]).toBe(CloudConnection);
    expect((props["query"] as JSONObject)["projectId"]?.toString()).toBe(
      PROJECT_ID,
    );
    expect(Object.keys(props["selectMoreFields"] as JSONObject).sort()).toEqual(
      [
        "config",
        "isEnabled",
        "lastError",
        "lastPullResult",
        "lastPulledAt",
        "lastSuccessfulPullAt",
        "provider",
      ],
    );
    expect(props["isDeleteable"]).toBe(true);
    expect(props["isEditable"]).toBe(false);
    expect(props["isCreateable"]).toBe(false);
    expect(props["noItemsMessage"]).toBe(
      "No cloud account connected yet. Pick one above.",
    );
    expect(
      (props["columns"] as Array<CapturedColumn>).map(
        (item: CapturedColumn): string => {
          return item.title;
        },
      ),
    ).toEqual(["Account", "Status", "Resources", "Last read"]);
  });
});

describe("a row", () => {
  test("the account: its name, its cloud and what it reads", () => {
    renderTable();

    const cell: HTMLElement = drawCell(
      "Account",
      connection({ lastPullResult: readResult({}) }),
    );

    expect(cell).toHaveTextContent("Production AWS");
    expect(cell).toHaveTextContent("Amazon Web Services");
    expect(
      within(cell).getByTestId("cloud-connection-accounts"),
    ).toHaveTextContent("123456789012");
  });

  test("its resources: none yet before a read; by service, with a way to all of them, after", () => {
    renderTable();

    expect(drawCell("Resources", connection())).toHaveTextContent("None yet");

    const cell: HTMLElement = drawCell(
      "Resources",
      connection({
        lastPullResult: readResult({
          resourceCount: 14,
          resourceTypes: [
            { type: "AWS::EC2::Instance", count: 10 },
            { type: "AWS::RDS::DBInstance", count: 4 },
          ],
          regions: [{ region: "us-east-1", count: 14 }],
        }),
      }),
    );

    expect(
      within(cell).getByTestId("cloud-resource-groups-types"),
    ).toBeInTheDocument();
    expect(
      within(cell).getByText("See all resources").closest("a"),
    ).toHaveAttribute("href", RESOURCES_ROUTE.toString());
  });

  test("when it was last read, what it then held, and how often it is read", () => {
    renderTable();

    expect(drawCell("Last read", connection())).toHaveTextContent("Not yet");

    const cell: HTMLElement = drawCell(
      "Last read",
      connection({
        lastSuccessfulPullAt: new Date("2026-10-21T10:00:00.000Z"),
        lastPullResult: readResult({
          resourceCount: 14,
          regions: [
            { region: "us-east-1", count: 10 },
            { region: "eu-west-1", count: 4 },
          ],
        }),
      }),
    );

    expect(cell).toHaveTextContent("14 resources in 2 regions");
    expect(cell).toHaveTextContent("Every 10 minutes");
  });

  test("a connection read hourly says so", () => {
    renderTable();

    expect(
      drawCell(
        "Last read",
        connection({
          config: { readIntervalInMinutes: "60" },
          lastSuccessfulPullAt: new Date("2026-10-21T10:00:00.000Z"),
        }),
      ),
    ).toHaveTextContent("Every hour");
  });

  test("its status, as a pill", () => {
    renderTable();

    expect(
      drawCell("Status", connection({ isEnabled: false })),
    ).toHaveTextContent("Off");
    expect(drawCell("Status", connection())).toHaveTextContent(
      "Waiting for the first read",
    );
  });
});

describe("its actions", () => {
  test("each shown when it makes sense", () => {
    renderTable();

    const on: CloudConnection = connection();
    const off: CloudConnection = connection({ isEnabled: false });
    const failing: CloudConnection = connection({
      lastError: "AccessDenied",
      lastPulledAt: new Date("2026-10-21T10:00:00Z"),
    });

    expect(action("View error").isVisible!(on)).toBe(false);
    expect(action("View error").isVisible!(failing)).toBe(true);
    expect(action("Read now").isVisible!(on)).toBe(true);
    expect(action("Read now").isVisible!(off)).toBe(false);
    expect(action("Turn on").isVisible!(off)).toBe(true);
    expect(action("Turn on").isVisible!(on)).toBe(false);
    expect(action("Turn off").isVisible!(on)).toBe(true);
    expect(action("Turn off").isVisible!(off)).toBe(false);
  });

  test("without the right to change connections, every change is greyed and says why", () => {
    renderTable({ isAllowed: false, disabledReason: "Read only." });

    for (const title of ["Read now", "Turn on", "Test", "Turn off", "Edit"]) {
      expect(action(title).disabled).toBe(true);
      expect(action(title).tooltip).toBe("Read only.");
    }
  });

  test("Read now queues a read and says how to see it end", async () => {
    renderTable();
    const done: MockFunction = getJestMockFunction();

    await act(async () => {
      await action("Read now").onClick(connection(), done);
    });

    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(postSpy.mock.calls[0]![0].url.toString()).toMatch(
      new RegExp(`/cloud-connection/${CONNECTION_ID}/read-now$`),
    );
    expect(screen.getByTestId("cloud-connections-notice")).toHaveTextContent(
      "Reading Production AWS now. Refresh the list in a minute to see how it went.",
    );
    expect(done).toHaveBeenCalledTimes(1);
  });

  test("Read now that is refused says why", async () => {
    postSpy.mockRejectedValue(new Error("This connection is turned off."));
    renderTable();

    await act(async () => {
      await action("Read now").onClick(connection(), getJestMockFunction());
    });

    expect(screen.getByTestId("cloud-connections-notice")).toHaveTextContent(
      "This connection is turned off.",
    );
  });

  test("Turn off and Turn on write only whether it is on", async () => {
    renderTable();

    await act(async () => {
      await action("Turn off").onClick(connection(), getJestMockFunction());
    });

    expect(updateSpy.mock.calls[0]![0]).toMatchObject({
      modelType: CloudConnection,
      data: { isEnabled: false },
    });
    expect(updateSpy.mock.calls[0]![0].id.toString()).toBe(CONNECTION_ID);

    await act(async () => {
      await action("Turn on").onClick(
        connection({ isEnabled: false }),
        getJestMockFunction(),
      );
    });

    expect(updateSpy.mock.calls[1]![0].data).toEqual({ isEnabled: true });
  });

  test("Test opens a test of the saved connection, run at once", async () => {
    postSpy.mockResolvedValue({
      data: {
        provider: "aws",
        status: "pass",
        message: "Signed in.",
        resourceCount: 1,
        resourceTypes: [{ type: "AWS::EC2::Instance", count: 1 }],
        durationMs: 5,
      },
    });
    renderTable();

    await act(async () => {
      await action("Test").onClick(connection(), getJestMockFunction());
    });

    expect(screen.getByText("Test Production AWS")).toBeInTheDocument();

    await waitFor(() => {
      expect(
        screen.getByTestId("cloud-connection-test-pass"),
      ).toBeInTheDocument();
    });
    expect(postSpy.mock.calls[0]![0].data).toEqual({
      connectionId: CONNECTION_ID,
    });
  });

  test("View error says what went wrong in a test's words, the stored error under them", async () => {
    renderTable();

    await act(async () => {
      await action("View error").onClick(
        connection({
          lastError:
            "AccessDenied: User is not authorized to perform sts:AssumeRole",
          lastPulledAt: new Date("2026-10-21T10:00:00Z"),
          lastPullResult: readResult({
            status: "failed",
            failureKind: CloudConnectionFailureKind.Permission,
          }),
        }),
        getJestMockFunction(),
      );
    });

    expect(
      screen.getByTestId("cloud-connection-error-words"),
    ).toHaveTextContent(
      "Signed in, but this access cannot read what OneUptime needs.",
    );
    expect(screen.getByTestId("cloud-connection-error")).toHaveTextContent(
      "AccessDenied: User is not authorized to perform sts:AssumeRole",
    );
  });

  test("Edit hands the connection to the page's form", async () => {
    const onEdit: MockFunction = getJestMockFunction();
    renderTable({ isAllowed: true }, onEdit);
    const item: CloudConnection = connection();

    await act(async () => {
      await action("Edit").onClick(item, getJestMockFunction());
    });

    expect(onEdit).toHaveBeenCalledWith(item);
  });
});
