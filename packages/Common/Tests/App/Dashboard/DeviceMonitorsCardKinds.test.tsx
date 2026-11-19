import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { Mock } from "jest-mock";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import fs from "fs";
import path from "path";
import { MemoryRouter } from "react-router-dom";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Includes from "../../../Types/BaseDatabase/Includes";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import DeviceMonitorsCard, {
  ADDABLE_MONITOR_QUERY,
  getDeviceWebUiMonitorRoute,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceMonitorsCard";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionUtil from "../../../UI/Utils/Permission";
import { DEVICE_TARGET_MONITOR_TYPES } from "../../../Utils/Monitor/DeviceMonitorTemplateUtil";
import {
  DEVICE_MONITOR_CHECK_QUERY_PARAM,
  DeviceMonitorCheck,
} from "../../../Utils/NetworkDevice/DeviceWebUiUtil";

/*
 * A device's "Monitors alerting on this device" card, RENDERED, with the
 * kinds of monitor it lists since OneUptime issue #5145: a Network Device
 * monitor that reads the device's polls, and the Ping monitor a discovery
 * import made for the device from a Ping template. The card's own words
 * have to fit every row under them - "Network Device monitors that evaluate
 * this device's polls and traps" sat above a Ping monitor that does
 * neither.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const DEVICE_ID: string = "40000000-0000-4000-8000-000000000001";

// Runs of whitespace, read as one space when a page's source is compared.
const WHITESPACE_RUNS: RegExp = /\s+/g;

// What a device page asks before it offers Monitor web UI.
const CREATE_MONITOR_GATE: string =
  "const canCreateMonitor: boolean = PermissionGate.check( new Monitor(), ModelAction.Create, ).isAllowed;";

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        return mockProjectObjectId;
      },
    },
  };
});

// Handed out by the Project mock; below the imports so ObjectID exists.
const mockProjectObjectId: ObjectID = new ObjectID(PROJECT_ID);

function monitor(data: {
  id: string;
  name: string;
  monitorType: MonitorType;
  madeForDevice?: boolean;
}): Monitor {
  const item: Monitor = new Monitor();
  item._id = data.id;
  item.name = data.name;
  item.monitorType = data.monitorType;

  if (data.madeForDevice) {
    item.autoProvisionedNetworkDeviceId = new ObjectID(DEVICE_ID);
  }

  return item;
}

const NETWORK_DEVICE_MONITOR: Monitor = monitor({
  id: "90000000-0000-4000-8000-000000000001",
  name: "WB0024KDS03 - Network device alert pack",
  monitorType: MonitorType.NetworkDevice,
});

const PING_MONITOR_FROM_IMPORT: Monitor = monitor({
  id: "90000000-0000-4000-8000-000000000002",
  name: "WB0024KDS03 - WB KDS Ping Monitor Template",
  monitorType: MonitorType.Ping,
  madeForDevice: true,
});

function renderCard(data: {
  monitors: Array<Monitor>;
  isMonitorBacked: boolean;
  // Whether the reader may create monitors: yes unless a test says no.
  canCreateMonitor?: boolean;
}): void {
  render(
    <MemoryRouter>
      <DeviceMonitorsCard
        monitors={data.monitors}
        isLoading={false}
        error=""
        networkDeviceId={DEVICE_ID}
        isMonitorBacked={data.isMonitorBacked}
        canCreateMonitor={data.canCreateMonitor ?? true}
      />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
});

describe("the device monitors card says what every monitor it lists does", () => {
  test("a probe-polled device: its Network Device monitor and the Ping monitor an import made for it, under words that fit both", () => {
    renderCard({
      monitors: [NETWORK_DEVICE_MONITOR, PING_MONITOR_FROM_IMPORT],
      isMonitorBacked: false,
    });

    expect(screen.getByText("Monitors alerting on this device")).toBeVisible();
    expect(
      screen.getByText(
        "Monitors that check this device and open incidents or alerts.",
      ),
    ).toBeVisible();
    expect(screen.getByText(NETWORK_DEVICE_MONITOR.name!)).toBeVisible();
    expect(screen.getByText(PING_MONITOR_FROM_IMPORT.name!)).toBeVisible();

    // The words that described Network Device monitors alone are gone.
    expect(document.body).not.toHaveTextContent(
      "Network Device monitors that evaluate this device's polls and traps",
    );
  });

  test("a device whose status comes from a bound monitor: the bound one decides, the others listed check it too", () => {
    renderCard({
      monitors: [
        monitor({
          id: "90000000-0000-4000-8000-000000000003",
          name: "lobby-camera ping",
          monitorType: MonitorType.Ping,
        }),
        monitor({
          id: "90000000-0000-4000-8000-000000000004",
          name: "lobby-camera - Receipt printers",
          monitorType: MonitorType.Port,
          madeForDevice: true,
        }),
      ],
      isMonitorBacked: true,
    });

    expect(screen.getByText("Monitors reporting on this device")).toBeVisible();
    expect(
      screen.getByText(
        "The monitor bound to this device decides its status; any other monitors here check it too.",
      ),
    ).toBeVisible();
    expect(screen.getByText("lobby-camera - Receipt printers")).toBeVisible();
    expect(document.body).not.toHaveTextContent(
      "plus any Network Device monitors that reference it",
    );
  });

  test("with nothing listed, the card keeps its words and its way forward", () => {
    renderCard({ monitors: [], isMonitorBacked: false });

    expect(
      screen.getByText(
        "Monitors that check this device and open incidents or alerts.",
      ),
    ).toBeVisible();
    expect(
      screen.getByText(/^Nothing alerts on this device yet\./),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Set up alerts" })).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Create Monitor" }),
    ).toBeVisible();
  });
});

/*
 * "Monitor web UI" (#5281, the follow-up of #5145's device web UI
 * templates): in the card's header, with monitors listed or none, it opens
 * Create Monitor on a Website monitor of the device's management page.
 */
describe("Monitor web UI", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the device's link asks Create Monitor for its web UI check", () => {
    const route: string = getDeviceWebUiMonitorRoute(DEVICE_ID).toString();
    const query: URLSearchParams = new URLSearchParams(
      route.slice(route.indexOf("?")),
    );

    expect(route.startsWith(`/dashboard/${PROJECT_ID}/monitors/create?`)).toBe(
      true,
    );
    expect(query.get("networkDeviceId")).toBe(DEVICE_ID);
    expect(query.get(DEVICE_MONITOR_CHECK_QUERY_PARAM)).toBe(
      DeviceMonitorCheck.WebUi,
    );
  });

  test.each([
    ["with monitors listed", [NETWORK_DEVICE_MONITOR]],
    ["with none", []],
  ])(
    "sits in the card's header %s, and opens Create Monitor on it",
    (_name: string, monitors: Array<Monitor>) => {
      const navigate: ReturnType<typeof jest.spyOn> = jest
        .spyOn(Navigation, "navigate")
        .mockImplementation((): void => {
          return undefined;
        });

      renderCard({ monitors: monitors, isMonitorBacked: false });

      const actions: HTMLElement = screen.getByTestId("card-header-actions");
      const button: HTMLElement = within(actions).getByRole("button", {
        name: "Monitor web UI",
      });

      fireEvent.click(button);

      expect(navigate).toHaveBeenCalledTimes(1);
      expect(String((navigate.mock.calls[0] as Array<unknown>)[0])).toBe(
        getDeviceWebUiMonitorRoute(DEVICE_ID).toString(),
      );
    },
  );

  test("a device whose status a bound monitor decides is offered it too", () => {
    renderCard({ monitors: [], isMonitorBacked: true });

    expect(
      screen.getByRole("button", { name: "Monitor web UI" }),
    ).toBeVisible();
    // The way out of no bound monitor stays the empty state's.
    expect(
      screen.getByRole("button", { name: "Create Ping Monitor" }),
    ).toBeVisible();
  });

  test("a card that names no device offers nothing to monitor", () => {
    render(
      <MemoryRouter>
        <DeviceMonitorsCard
          monitors={[]}
          isLoading={false}
          error=""
          canCreateMonitor={true}
        />
      </MemoryRouter>,
    );

    expect(screen.queryByRole("button", { name: "Monitor web UI" })).toBeNull();
  });

  /*
   * Offered only to a reader who may create monitors - hidden, not locked,
   * as the device's other on-demand actions are: for anyone else it opened
   * a form that would not save.
   */
  test.each([
    ["with monitors listed", [NETWORK_DEVICE_MONITOR]],
    ["with none", []],
  ])(
    "a reader who may not create monitors is not offered it, %s",
    (_name: string, monitors: Array<Monitor>) => {
      renderCard({
        monitors: monitors,
        isMonitorBacked: false,
        canCreateMonitor: false,
      });

      expect(
        screen.queryByRole("button", { name: "Monitor web UI" }),
      ).toBeNull();
      expect(screen.queryByTestId("device-monitors-web-ui")).toBeNull();
      // The card still says what watches the device.
      expect(
        screen.getByText("Monitors alerting on this device"),
      ).toBeVisible();
    },
  );

  test("both device pages ask the reader's permission to create a monitor", () => {
    const pages: string = path.resolve(
      __dirname,
      "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkDevice/View",
    );

    for (const page of ["Index.tsx", "Monitors.tsx"]) {
      const source: string = fs
        .readFileSync(path.join(pages, page), "utf8")
        .replace(WHITESPACE_RUNS, " ");

      expect({ page, asks: source.includes(CREATE_MONITOR_GATE) }).toEqual({
        page,
        asks: true,
      });
      expect({
        page,
        hands: source.includes("canCreateMonitor={canCreateMonitor}"),
      }).toEqual({ page, hands: true });
    }
  });

  test("the device's web UI monitor is listed with the others", () => {
    renderCard({
      monitors: [
        NETWORK_DEVICE_MONITOR,
        monitor({
          id: "90000000-0000-4000-8000-000000000005",
          name: "WB0024KDS03 web UI",
          monitorType: MonitorType.Website,
        }),
      ],
      isMonitorBacked: false,
    });

    expect(screen.getByText("WB0024KDS03 web UI")).toBeVisible();
  });
});

/*
 * "Add Existing Monitor" (issue #9545): a Ping, Port or Website monitor
 * someone made by hand, before the device was added or on another of its
 * names, tied to the device - listed on its pages from then on, and counted
 * by the duplicate check imports and auto import rules run.
 */
describe("Add Existing Monitor", () => {
  const HAND_MADE_PING: Monitor = monitor({
    id: "90000000-0000-4000-8000-000000000031",
    name: "Kiosk ping (made by hand)",
    monitorType: MonitorType.Ping,
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function grant(permissions: Array<Permission>): void {
    jest
      .spyOn(PermissionUtil, "getAllPermissions")
      .mockReturnValue(permissions);
  }

  function renderAddable(onMonitorAdded?: () => void): void {
    render(
      <MemoryRouter>
        <DeviceMonitorsCard
          monitors={[]}
          isLoading={false}
          error=""
          networkDeviceId={DEVICE_ID}
          isMonitorBacked={false}
          canCreateMonitor={true}
          onMonitorAdded={onMonitorAdded}
        />
      </MemoryRouter>,
    );
  }

  test("a page that reads the card again offers it in the card's header", () => {
    grant([Permission.ProjectOwner]);
    renderAddable(jest.fn());

    expect(
      within(screen.getByTestId("card-header-actions")).getByRole("button", {
        name: "Add Existing Monitor",
      }),
    ).toBeInTheDocument();
  });

  test("a card no page reads again, or a reader who may not tie monitors to devices, is offered nothing to add", () => {
    grant([Permission.ProjectOwner]);
    renderCard({ monitors: [], isMonitorBacked: false });

    expect(
      screen.queryByRole("button", { name: "Add Existing Monitor" }),
    ).toBeNull();

    cleanup();
    grant([Permission.Viewer]);
    renderAddable(jest.fn());

    expect(
      screen.queryByRole("button", { name: "Add Existing Monitor" }),
    ).toBeNull();
  });

  test("the monitor picked is tied to the device - nothing else about it changes - and the page reads its monitors again", async () => {
    grant([Permission.ProjectOwner]);

    const getList: ReturnType<typeof jest.spyOn> = jest
      .spyOn(ModelAPI, "getList")
      .mockResolvedValue({
        data: [HAND_MADE_PING],
        count: 1,
        skip: 0,
        limit: 10,
      } as never);
    const updateById: ReturnType<typeof jest.spyOn> = jest
      .spyOn(ModelAPI, "updateById")
      .mockResolvedValue({} as never);
    const onMonitorAdded: Mock<() => void> = jest.fn<() => void>();

    renderAddable(onMonitorAdded);

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Add Existing Monitor" }),
      );
    });

    const dialog: HTMLElement = await screen.findByRole("dialog");
    const combobox: HTMLElement = within(dialog).getByRole("combobox");

    await act(async () => {
      fireEvent.focus(combobox);
      fireEvent.keyDown(combobox, { key: "ArrowDown", keyCode: 40 });
    });

    const option: HTMLElement = await screen.findByRole("option", {
      name: /Kiosk ping \(made by hand\)/,
    });

    await act(async () => {
      fireEvent.click(option);
    });

    // Only the monitors a person made that check a host and are no device's yet.
    const queries: Array<Record<string, unknown>> = getList.mock.calls.map(
      (call: Array<unknown>): Record<string, unknown> => {
        return (call[0] as { query: Record<string, unknown> }).query;
      },
    );
    expect(queries.length).toBeGreaterThan(0);
    for (const query of queries) {
      expect(query["networkDeviceId"]).toBeInstanceOf(IsNull);
      expect(query["autoProvisionedNetworkDeviceId"]).toBeInstanceOf(IsNull);
      expect((query["monitorType"] as Includes).values).toEqual([
        ...DEVICE_TARGET_MONITOR_TYPES,
      ]);
    }

    await act(async () => {
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Add Monitor" }),
      );
    });

    expect(updateById).toHaveBeenCalledTimes(1);
    const update: {
      modelType: unknown;
      id: ObjectID;
      data: Record<string, unknown>;
    } = updateById.mock.calls[0]![0] as {
      modelType: unknown;
      id: ObjectID;
      data: Record<string, unknown>;
    };
    expect(update.modelType).toBe(Monitor);
    expect(update.id.toString()).toBe(HAND_MADE_PING._id);
    expect(Object.keys(update.data)).toEqual(["networkDeviceId"]);
    expect(String(update.data["networkDeviceId"])).toBe(DEVICE_ID);
    expect(onMonitorAdded).toHaveBeenCalledTimes(1);
    expect(ADDABLE_MONITOR_QUERY["networkDeviceId"]).toBeInstanceOf(IsNull);
  });

  test("a tie the server refuses is said in the dialog, which stays open, and the page reads nothing again", async () => {
    grant([Permission.ProjectOwner]);

    jest.spyOn(ModelAPI, "getList").mockResolvedValue({
      data: [HAND_MADE_PING],
      count: 1,
      skip: 0,
      limit: 10,
    } as never);
    jest
      .spyOn(ModelAPI, "updateById")
      .mockRejectedValue(
        new Error(
          "An import, an auto import rule or an alert policy made this monitor for its network device, so it is that device's already. Its Network Device cannot be changed.",
        ),
      );
    const onMonitorAdded: Mock<() => void> = jest.fn<() => void>();

    renderAddable(onMonitorAdded);

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Add Existing Monitor" }),
      );
    });

    const dialog: HTMLElement = await screen.findByRole("dialog");
    const combobox: HTMLElement = within(dialog).getByRole("combobox");

    await act(async () => {
      fireEvent.focus(combobox);
      fireEvent.keyDown(combobox, { key: "ArrowDown", keyCode: 40 });
    });

    await act(async () => {
      fireEvent.click(
        await screen.findByRole("option", {
          name: /Kiosk ping \(made by hand\)/,
        }),
      );
    });

    await act(async () => {
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Add Monitor" }),
      );
    });

    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Its Network Device cannot be changed.",
    );
    expect(onMonitorAdded).not.toHaveBeenCalled();
  });
});

/*
 * ISSUE #9676: a monitor a person tied to the device - and nothing else puts
 * on the card - can be taken off it from the card, after a confirmation that
 * says what that changes. One made for the device, bound to it or watching
 * it is the device's for that reason, and is never offered.
 */
describe("Remove a monitor someone tied to the device", () => {
  const TIED_PING: Monitor = monitor({
    id: "90000000-0000-4000-8000-000000000041",
    name: "Kiosk ping (made by hand)",
    monitorType: MonitorType.Ping,
  });
  const TIED_ID: string = TIED_PING._id!.toString();

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function grant(permissions: Array<Permission>): void {
    jest
      .spyOn(PermissionUtil, "getAllPermissions")
      .mockReturnValue(permissions);
  }

  function renderRemovable(data: {
    removableMonitorIds?: Array<string>;
    onMonitorRemoved?: (() => void) | undefined;
  }): void {
    render(
      <MemoryRouter>
        <DeviceMonitorsCard
          monitors={[
            NETWORK_DEVICE_MONITOR,
            PING_MONITOR_FROM_IMPORT,
            TIED_PING,
          ]}
          isLoading={false}
          error=""
          networkDeviceId={DEVICE_ID}
          isMonitorBacked={false}
          canCreateMonitor={true}
          removableMonitorIds={new Set<string>(data.removableMonitorIds || [])}
          onMonitorRemoved={data.onMonitorRemoved}
        />
      </MemoryRouter>,
    );
  }

  function removeButtons(): Array<HTMLElement> {
    return screen.queryAllByRole("button", {
      name: /^Remove .+ from this device$/,
    });
  }

  test("is offered on the tied monitor's row alone, named for a screen reader", () => {
    grant([Permission.ProjectOwner]);
    renderRemovable({
      removableMonitorIds: [TIED_ID],
      onMonitorRemoved: jest.fn(),
    });

    expect(removeButtons()).toHaveLength(1);
    expect(
      screen.getByRole("button", {
        name: "Remove Kiosk ping (made by hand) from this device",
      }),
    ).toHaveTextContent("Remove");
    expect(
      screen.getByTestId(`device-monitors-remove-${TIED_ID}`),
    ).toBeInTheDocument();
  });

  test("is never offered for a monitor made for the device, or one watching it", () => {
    grant([Permission.ProjectOwner]);
    renderRemovable({ removableMonitorIds: [], onMonitorRemoved: jest.fn() });

    expect(removeButtons()).toHaveLength(0);
  });

  test("is offered to nobody who may not tie monitors to devices, nor on a page that reads nothing again", () => {
    grant([Permission.Viewer]);
    renderRemovable({
      removableMonitorIds: [TIED_ID],
      onMonitorRemoved: jest.fn(),
    });

    expect(removeButtons()).toHaveLength(0);

    cleanup();
    grant([Permission.ProjectOwner]);
    renderRemovable({ removableMonitorIds: [TIED_ID] });

    expect(removeButtons()).toHaveLength(0);
  });

  test("asks first, naming the monitor and what changes, then unties it alone and reads the device's monitors again", async () => {
    grant([Permission.ProjectOwner]);
    const updateById: ReturnType<typeof jest.spyOn> = jest
      .spyOn(ModelAPI, "updateById")
      .mockResolvedValue({} as never);
    const onMonitorRemoved: Mock<() => void> = jest.fn<() => void>();

    renderRemovable({
      removableMonitorIds: [TIED_ID],
      onMonitorRemoved: onMonitorRemoved,
    });

    await act(async () => {
      fireEvent.click(removeButtons()[0]!);
    });

    const dialog: HTMLElement = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Remove from Device");
    expect(dialog).toHaveTextContent(
      "Kiosk ping (made by hand) stops being listed on this device, and what it raises from now on is not linked to the device. Imports and auto import rules stop counting it, so they can give the device a monitor like it. The monitor itself keeps checking, unchanged.",
    );
    // Nothing is written until the reader says so.
    expect(updateById).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));
    });

    expect(updateById).toHaveBeenCalledTimes(1);
    const update: {
      modelType: unknown;
      id: ObjectID;
      data: Record<string, unknown>;
    } = updateById.mock.calls[0]![0] as {
      modelType: unknown;
      id: ObjectID;
      data: Record<string, unknown>;
    };
    expect(update.modelType).toBe(Monitor);
    expect(update.id.toString()).toBe(TIED_ID);
    expect(update.data).toEqual({ networkDeviceId: null });
    expect(onMonitorRemoved).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("Cancel writes nothing", async () => {
    grant([Permission.ProjectOwner]);
    const updateById: ReturnType<typeof jest.spyOn> = jest
      .spyOn(ModelAPI, "updateById")
      .mockResolvedValue({} as never);

    renderRemovable({
      removableMonitorIds: [TIED_ID],
      onMonitorRemoved: jest.fn(),
    });

    await act(async () => {
      fireEvent.click(removeButtons()[0]!);
    });

    const dialog: HTMLElement = await screen.findByRole("dialog");

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    });

    expect(updateById).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  test("a removal the server refuses is said in the dialog, which stays open, and nothing is read again", async () => {
    grant([Permission.ProjectOwner]);
    jest
      .spyOn(ModelAPI, "updateById")
      .mockRejectedValue(new Error("You may not edit this monitor."));
    const onMonitorRemoved: Mock<() => void> = jest.fn<() => void>();

    renderRemovable({
      removableMonitorIds: [TIED_ID],
      onMonitorRemoved: onMonitorRemoved,
    });

    await act(async () => {
      fireEvent.click(removeButtons()[0]!);
    });

    const dialog: HTMLElement = await screen.findByRole("dialog");

    await act(async () => {
      fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));
    });

    expect(screen.getByRole("dialog")).toHaveTextContent(
      "You may not edit this monitor.",
    );
    expect(onMonitorRemoved).not.toHaveBeenCalled();
  });

  test("both device pages pass the card what it may remove, and read the monitors again after", () => {
    for (const page of ["Index.tsx", "Monitors.tsx"]) {
      const source: string = fs
        .readFileSync(
          path.join(
            __dirname,
            "../../../../App/FeatureSet/Dashboard/src/Pages/NetworkDevice/View",
            page,
          ),
          "utf-8",
        )
        .replace(WHITESPACE_RUNS, " ");

      expect(source).toContain("removableMonitorIds={removableMonitorIds}");
      expect(source).toContain("onMonitorRemoved={readMonitorsAgain}");
      expect(source).toContain(
        "setRemovableMonitorIds(context.removableMonitorIds);",
      );
    }
  });
});
