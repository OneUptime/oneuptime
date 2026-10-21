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
 *   - each row, in three columns that fit beside the side menu: the
 *     account (its name, then its cloud and what it reads on one quiet
 *     line, without repeating what the name says); how it is doing, when it
 *     was last read and how often it is read - not while it is turned off;
 *     and how many resources its last read found, as the way to them, with
 *     the first two regions and how many more;
 *   - its actions: View error only while it is not working, Read now and
 *     Turn off while it is on, Turn on while it is off, Test, Edit - each
 *     greyed, with why, without the right to change connections;
 *   - Read now queues a read, and the row says it is reading - Read now
 *     put away - until the connection's last read time moves, asked of the
 *     one connection now and then, when the list loads again by itself; it
 *     gives up after a read's longest time. Test opens a test of the saved
 *     connection; View error says what went wrong in a test's words, the
 *     stored error under them.
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
import {
  READ_NOW_GIVE_UP_MS,
  READ_NOW_POLL_MS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/Connect/CloudConnectApi";
import CloudConnection from "../../../Models/DatabaseModels/CloudConnection";
import ActionButtonSchema from "../../../UI/Components/ActionButton/ActionButtonSchema";
import splitActionButtons, {
  SplitActionButtonsResult,
  getActionButtonLock,
} from "../../../UI/Components/ActionButton/SplitActionButtons";
import Route from "../../../Types/API/Route";
import { CloudProvider } from "../../../Types/Cloud/CloudPlatform";
import { CloudConnectionFailureKind } from "../../../Types/CloudConnection/CloudConnectionTest";
import OneUptimeDate from "../../../Types/Date";
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
  getDisabledReason?: (item: CloudConnection) => string | undefined;
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
let getItemSpy: jest.SpyInstance<any, any>;

const READ_AT: Date = new Date("2026-10-21T10:00:00.000Z");
const READ_AGAIN_AT: Date = new Date("2026-10-21T10:04:00.000Z");

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
  // The connection as the list asks after a read it started: not read again yet.
  getItemSpy = getJestSpyOn(ModelAPI, "getItem").mockImplementation(
    async (): Promise<CloudConnection> => {
      return connection({ lastPulledAt: READ_AT });
    },
  );
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// The promises a tick of the read watch awaits.
async function settle(): Promise<void> {
  for (let index: number = 0; index < 5; index++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function tick(milliseconds: number): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(milliseconds);
  });
  await settle();
}

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
    ).toEqual(["Account", "Status", "Resources"]);
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
    expect(cell).toHaveTextContent("Amazon Web Services · 123456789012");
    expect(
      within(cell).getByTestId("cloud-connection-accounts"),
    ).toHaveTextContent("123456789012");
  });

  test("a name that says its cloud is not followed by it again: the line under it says what it reads", () => {
    renderTable();

    const azure: HTMLElement = drawCell(
      "Account",
      connection({
        name: "Microsoft Azure",
        provider: CloudProvider.Azure,
        lastPullResult: readResult({
          accounts: ["7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b"],
        }),
      }),
    );

    expect(azure.textContent?.split("Microsoft Azure")).toHaveLength(2);
    expect(
      within(azure).getByTestId("cloud-connection-subtitle"),
    ).toHaveTextContent(/^7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b$/);
    // Cut, not widening the table: the whole line on hover.
    expect(
      within(azure).getByTestId("cloud-connection-subtitle"),
    ).toHaveAttribute("title", "7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b");

    // The name says both: nothing under it.
    const gcp: HTMLElement = drawCell(
      "Account",
      connection({
        name: "Google Cloud acme-prod",
        provider: CloudProvider.GCP,
        lastPullResult: readResult({ accounts: ["acme-prod"] }),
      }),
    );

    expect(gcp).toHaveTextContent(/^Google Cloud acme-prod$/);
    expect(
      within(gcp).queryByTestId("cloud-connection-subtitle"),
    ).not.toBeInTheDocument();
  });

  test("the account says once what its name already says", () => {
    renderTable();

    const cell: HTMLElement = drawCell(
      "Account",
      connection({
        name: "AWS 123456789012",
        lastPullResult: readResult({}),
      }),
    );

    expect(cell).toHaveTextContent("AWS 123456789012");
    expect(cell).toHaveTextContent("Amazon Web Services");
    // The account is in the name: no second line repeats it.
    expect(
      within(cell).queryByTestId("cloud-connection-accounts"),
    ).not.toBeInTheDocument();
    expect(cell.textContent?.split("123456789012")).toHaveLength(2);
  });

  test("its resources: none yet before a read; after, how many as the way to them, and where", () => {
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
      within(cell).getByTestId("cloud-connection-resource-count"),
    ).toHaveTextContent("14 resources");
    expect(
      within(cell).getByTestId("cloud-connection-resource-count").closest("a"),
    ).toHaveAttribute("href", RESOURCES_ROUTE.toString());
    expect(
      within(cell).getByTestId("cloud-connection-regions"),
    ).toHaveTextContent("us-east-1");
    // By service is the test's to say: the row stays two short lines.
    expect(
      within(cell).queryByTestId("cloud-resource-groups-types"),
    ).not.toBeInTheDocument();
  });

  test("its regions: the first two, and how many more", () => {
    renderTable();

    const cell: HTMLElement = drawCell(
      "Resources",
      connection({
        lastPullResult: readResult({
          resourceCount: 1,
          regions: [
            { region: "us-east-1", count: 20 },
            { region: "eu-west-1", count: 10 },
            { region: "ap-south-1", count: 5 },
            { region: "sa-east-1", count: 1 },
          ],
        }),
      }),
    );

    expect(cell).toHaveTextContent("1 resource");
    expect(
      within(cell).getByTestId("cloud-connection-regions"),
    ).toHaveTextContent("us-east-1, eu-west-1 +2 more");
  });

  test("its status: how it is doing, when it was last read and how often it is", () => {
    renderTable();

    const cell: HTMLElement = drawCell(
      "Status",
      connection({
        lastPulledAt: READ_AT,
        lastSuccessfulPullAt: READ_AT,
      }),
    );

    expect(cell).toHaveTextContent("Working");
    expect(
      within(cell).getByTestId("cloud-connection-last-read"),
    ).toHaveTextContent(
      `Last read ${OneUptimeDate.getDateAsLocalShortDateTimeString(READ_AT)}`,
    );
    // The whole date and time zone on hover.
    expect(
      within(cell).getByTestId("cloud-connection-last-read"),
    ).toHaveAttribute(
      "title",
      OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(READ_AT),
    );
    expect(
      within(cell).getByTestId("cloud-connection-read-interval"),
    ).toHaveTextContent("Every 10 minutes");
  });

  test("never read: waiting says so alone; a first read that failed says it was never read", () => {
    renderTable();

    const waiting: HTMLElement = drawCell("Status", connection());

    expect(waiting).toHaveTextContent("Waiting for the first read");
    expect(
      within(waiting).queryByTestId("cloud-connection-last-read"),
    ).not.toBeInTheDocument();

    const failing: HTMLElement = drawCell(
      "Status",
      connection({
        lastError: "AccessDenied",
        lastPulledAt: READ_AT,
      }),
    );

    expect(failing).toHaveTextContent("Not working");
    expect(
      within(failing).getByTestId("cloud-connection-last-read"),
    ).toHaveTextContent("Not read yet");
  });

  test("a connection turned off is not read: no 'every 10 minutes' under it", () => {
    renderTable();

    const cell: HTMLElement = drawCell(
      "Status",
      connection({
        isEnabled: false,
        lastSuccessfulPullAt: new Date("2026-10-19T12:00:00.000Z"),
        lastPullResult: readResult({ resourceCount: 3 }),
      }),
    );

    expect(cell).toHaveTextContent("Off");
    expect(cell).toHaveTextContent("Last read");
    expect(
      within(cell).queryByTestId("cloud-connection-read-interval"),
    ).not.toBeInTheDocument();
    expect(cell).not.toHaveTextContent("Every 10 minutes");
  });

  test("a connection read hourly says so", () => {
    renderTable();

    expect(
      drawCell(
        "Status",
        connection({
          config: { readIntervalInMinutes: "60" },
          lastSuccessfulPullAt: READ_AT,
        }),
      ),
    ).toHaveTextContent("Every hour");
  });
});

describe("its actions", () => {
  test("the row's button: View error while it fails, else Read now - which keeps its place while it reads", () => {
    renderTable();

    const actions: Array<ActionButtonSchema<CloudConnection>> = tableProps()[
      "actionButtons"
    ] as Array<ActionButtonSchema<CloudConnection>>;
    const button: (item: CloudConnection) => string | undefined = (
      item: CloudConnection,
    ): string | undefined => {
      return splitActionButtons<CloudConnection>({
        actionButtons: actions,
        item,
      }).primary?.button.title;
    };

    expect(
      button(
        connection({
          lastError: "AccessDenied",
          lastPulledAt: READ_AT,
        }),
      ),
    ).toBe("View error");
    expect(
      button(
        connection({ lastPulledAt: READ_AT, lastSuccessfulPullAt: READ_AT }),
      ),
    ).toBe("Read now");
    expect(button(connection({ isEnabled: false }))).toBe("Turn on");
  });

  test("Read now stays the row's button, locked, while a read it started runs", async () => {
    renderTable();
    const item: CloudConnection = connection({
      lastPulledAt: READ_AT,
      lastSuccessfulPullAt: READ_AT,
    });

    await act(async () => {
      await action("Read now").onClick(item, getJestMockFunction());
    });

    const split: SplitActionButtonsResult<CloudConnection> =
      splitActionButtons<CloudConnection>({
        actionButtons: tableProps()["actionButtons"] as Array<
          ActionButtonSchema<CloudConnection>
        >,
        item,
      });

    expect(split.primary?.button.title).toBe("Read now");
    expect(getActionButtonLock(split.primary!.button, item)).toEqual({
      isDisabled: true,
      tooltip: "Reading now…",
    });
  });

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

  test("Read now queues a read, and the row says it is reading - nothing to refresh by hand", async () => {
    renderTable();
    const done: MockFunction = getJestMockFunction();
    const item: CloudConnection = connection({
      lastPulledAt: READ_AT,
      lastSuccessfulPullAt: READ_AT,
    });

    await act(async () => {
      await action("Read now").onClick(item, done);
    });

    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(postSpy.mock.calls[0]![0].url.toString()).toMatch(
      new RegExp(`/cloud-connection/${CONNECTION_ID}/read-now$`),
    );
    expect(done).toHaveBeenCalledTimes(1);
    // No notice to read: the row says it.
    expect(
      screen.queryByTestId("cloud-connections-notice"),
    ).not.toBeInTheDocument();

    const cell: HTMLElement = drawCell("Status", item);

    expect(
      within(cell).getByTestId("cloud-connection-reading"),
    ).toHaveTextContent("Reading now…");
    expect(
      within(cell).queryByTestId("cloud-connection-last-read"),
    ).not.toBeInTheDocument();
    // Not twice: Read now stays where it is, locked, on that row only.
    expect(action("Read now").isVisible!(item)).toBe(true);
    expect(action("Read now").getDisabledReason!(item)).toBe("Reading now…");
    expect(
      action("Read now").getDisabledReason!(
        connection({ _id: "20000000-0000-4000-8000-000000000009" }),
      ),
    ).toBeUndefined();
  });

  test("the list loads again by itself once the read ends, asked of the one connection", async () => {
    jest.useFakeTimers();
    renderTable();
    const item: CloudConnection = connection({
      lastPulledAt: READ_AT,
      lastSuccessfulPullAt: READ_AT,
    });

    await act(async () => {
      await action("Read now").onClick(item, getJestMockFunction());
    });

    const toggleBefore: unknown = tableProps()["refreshToggle"];

    // Not read again yet: still reading, the list left as it is.
    await tick(READ_NOW_POLL_MS);

    expect(getItemSpy).toHaveBeenCalledTimes(1);
    expect(getItemSpy.mock.calls[0]![0]).toMatchObject({
      modelType: CloudConnection,
      select: { lastPulledAt: true },
    });
    expect(getItemSpy.mock.calls[0]![0].id.toString()).toBe(CONNECTION_ID);
    expect(tableProps()["refreshToggle"]).toBe(toggleBefore);
    expect(action("Read now").getDisabledReason!(item)).toBe("Reading now…");

    // The read ends: its last read time moves.
    getItemSpy.mockImplementation(async (): Promise<CloudConnection> => {
      return connection({ lastPulledAt: READ_AGAIN_AT });
    });

    await tick(READ_NOW_POLL_MS);

    expect(tableProps()["refreshToggle"]).not.toBe(toggleBefore);
    expect(action("Read now").getDisabledReason!(item)).toBeUndefined();
    expect(
      within(drawCell("Status", item)).queryByTestId(
        "cloud-connection-reading",
      ),
    ).not.toBeInTheDocument();

    // Nothing more to ask.
    const asked: number = getItemSpy.mock.calls.length;
    await tick(READ_NOW_POLL_MS * 3);
    expect(getItemSpy.mock.calls.length).toBe(asked);
  });

  test("a read that never ends is given up on after a read's longest time", async () => {
    jest.useFakeTimers();
    renderTable();
    const item: CloudConnection = connection({ lastPulledAt: READ_AT });

    await act(async () => {
      await action("Read now").onClick(item, getJestMockFunction());
    });

    const toggleBefore: unknown = tableProps()["refreshToggle"];

    await tick(READ_NOW_GIVE_UP_MS - READ_NOW_POLL_MS);
    expect(action("Read now").getDisabledReason!(item)).toBe("Reading now…");

    await tick(READ_NOW_POLL_MS * 2);

    expect(action("Read now").getDisabledReason!(item)).toBeUndefined();
    // The list loads again: whatever it now holds is what is shown.
    expect(tableProps()["refreshToggle"]).not.toBe(toggleBefore);
  });

  test("a connection waiting for its first read is watched quietly, once: its row shows the read when it ends", async () => {
    jest.useFakeTimers();
    // Not read yet.
    getItemSpy.mockImplementation(async (): Promise<CloudConnection> => {
      return connection();
    });
    renderTable();
    const waiting: CloudConnection = connection();
    const loaded: (data: Array<CloudConnection>, count: number) => void =
      tableProps()["onFetchSuccess"] as (
        data: Array<CloudConnection>,
        count: number,
      ) => void;

    await act(async () => {
      loaded([waiting], 1);
    });

    const toggleBefore: unknown = tableProps()["refreshToggle"];

    // Quiet: the row says no more than it is waiting, and Read now is free.
    expect(
      within(drawCell("Status", waiting)).queryByTestId(
        "cloud-connection-reading",
      ),
    ).not.toBeInTheDocument();
    expect(action("Read now").getDisabledReason!(waiting)).toBeUndefined();

    await tick(READ_NOW_POLL_MS);

    expect(getItemSpy).toHaveBeenCalledTimes(1);
    expect(tableProps()["refreshToggle"]).toBe(toggleBefore);

    // The first read ends: the list loads again by itself.
    getItemSpy.mockImplementation(async (): Promise<CloudConnection> => {
      return connection({ lastPulledAt: READ_AT });
    });

    await tick(READ_NOW_POLL_MS);

    expect(tableProps()["refreshToggle"]).not.toBe(toggleBefore);

    // Once is enough: a later load does not watch it again.
    const asked: number = getItemSpy.mock.calls.length;

    await act(async () => {
      (
        tableProps()["onFetchSuccess"] as (
          data: Array<CloudConnection>,
          count: number,
        ) => void
      )([waiting], 1);
    });
    await tick(READ_NOW_POLL_MS * 2);

    expect(getItemSpy.mock.calls.length).toBe(asked);
  });

  test("a connection that works, failed or is turned off is not watched", async () => {
    jest.useFakeTimers();
    renderTable();

    await act(async () => {
      (
        tableProps()["onFetchSuccess"] as (
          data: Array<CloudConnection>,
          count: number,
        ) => void
      )(
        [
          connection({
            _id: "20000000-0000-4000-8000-000000000011",
            lastPulledAt: READ_AT,
            lastSuccessfulPullAt: READ_AT,
          }),
          connection({
            _id: "20000000-0000-4000-8000-000000000012",
            lastPulledAt: READ_AT,
            lastError: "AccessDenied",
          }),
          connection({
            _id: "20000000-0000-4000-8000-000000000013",
            isEnabled: false,
          }),
        ],
        3,
      );
    });
    await tick(READ_NOW_POLL_MS * 2);

    expect(getItemSpy).not.toHaveBeenCalled();
  });

  test("a connection deleted while it reads ends the watch", async () => {
    jest.useFakeTimers();
    getItemSpy.mockResolvedValue(null);
    renderTable();
    const item: CloudConnection = connection({ lastPulledAt: READ_AT });

    await act(async () => {
      await action("Read now").onClick(item, getJestMockFunction());
    });

    await tick(READ_NOW_POLL_MS);

    expect(action("Read now").getDisabledReason!(item)).toBeUndefined();
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
    // Test again beside Close, in the dialog's footer.
    expect(
      within(screen.getByTestId("modal-footer")).getByTestId(
        "cloud-connection-test-button",
      ),
    ).toHaveTextContent("Test again");
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
