import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { JSONObject } from "../../../Types/JSON";
import {
  DiscoveryImportDeviceOutcome,
  DiscoveryImportMonitorOutcome,
  DiscoveryImportStatus,
} from "../../../Types/NetworkDevice/DiscoveryImport";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionUtil from "../../../UI/Utils/Permission";
import ProjectUtil from "../../../UI/Utils/Project";
import DiscoveredDevicesTable from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveredDevices/DiscoveredDevicesTable";
import { DiscoveredDeviceItem } from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveredDevices/DiscoveredDeviceItems";
import {
  TABLE_FOLDED_VALUE_TEST_ID,
  TABLE_FOLDED_VALUE_TITLE_TEST_ID,
} from "../../../UI/Components/Table/TableFoldedValues";
import { forgetRememberedTableFits } from "../../../UI/Components/Table/useTableFit";
import { escapeRegExp } from "../../../Utils/RegExpEscape";
import DiscoveryImportFakeServer from "./DiscoveryImportFakeServer";
import DiscoveredDevicesFakeServer, {
  FAKE_DISCOVERED_DEVICE_ROUTES,
  FakeDiscoveredDevice,
} from "./DiscoveredDevicesFakeServer";

/*
 * THE DISCOVERED DEVICES LIST, RENDERED (OneUptime issue #5775).
 *
 * The real list - its search, its Show choices, the real Table with its row
 * actions and bulk selection, the real bulk confirmation and outcome - over
 * an in-memory list API (DiscoveredDevicesFakeServer) and the import API
 * (DiscoveryImportFakeServer). The Add to monitoring dialog is a recorder
 * here: its own suite (AddDiscoveredDevicesDialog.test.tsx) renders it.
 *
 * What these pin is what a person sees and what the server is asked for:
 *
 *   - the list opens on what is not monitored yet, and the search, the
 *     counts and the paging are the server's;
 *   - each row says where the device was seen and what state it is in, and
 *     a monitored one links to its device;
 *   - Hide from map and Show on map are one request for the whole
 *     selection, behind a confirmation that says nothing is deleted, and say
 *     row by row what they did;
 *   - "select every matching row" asks the server, and Add to monitoring
 *     gets the whole selection;
 *   - an action the reader may not take is locked, and says why.
 */

interface DialogProps {
  devices: Array<DiscoveredDeviceItem>;
  importId?: string | undefined;
  onClose: () => void;
  onImportsChanged: () => void;
}

const mockDialogOpenings: Array<DialogProps> = [];

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveredDevices/AddDiscoveredDevicesDialog",
  () => {
    const ReactModule: typeof React = jest.requireActual("react");

    return {
      __esModule: true,
      default: (props: DialogProps): ReactElement => {
        mockDialogOpenings.push(props);

        return ReactModule.createElement(
          "div",
          {
            "data-testid": "add-dialog-recorder",
            "data-import-id": props.importId || "",
          },
          ReactModule.createElement(
            "span",
            { "data-testid": "add-dialog-devices" },
            props.devices
              .map((device: DiscoveredDeviceItem): string => {
                return device.name;
              })
              .join(" | "),
          ),
          ReactModule.createElement(
            "button",
            { type: "button", onClick: props.onImportsChanged },
            "Recorder: imports changed",
          ),
          ReactModule.createElement(
            "button",
            { type: "button", onClick: props.onClose },
            "Recorder: close",
          ),
        );
      },
    };
  },
);

const PROJECT_ID: ObjectID = new ObjectID(
  "4f1c2d3e-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
);
const SITE_ID: string = "20000000-0000-4000-8000-000000000001";
const OTHER_SITE_ID: string = "20000000-0000-4000-8000-000000000002";
const SWITCH_ID: string = "30000000-0000-4000-8000-000000000001";
const ROUTER_DEVICE_ID: string = "30000000-0000-4000-8000-000000000002";

const CAMERA_ID: string = "10000000-0000-4000-8000-000000000001";
const PRINTER_ID: string = "10000000-0000-4000-8000-000000000002";
const NO_ADDRESS_ID: string = "10000000-0000-4000-8000-000000000003";
const LAPTOP_ID: string = "10000000-0000-4000-8000-000000000004";
const ROUTER_ID: string = "10000000-0000-4000-8000-000000000005";
const OTHER_SITE_PHONE_ID: string = "10000000-0000-4000-8000-000000000006";

const NOW: number = Date.now();

function minutesAgo(minutes: number): string {
  return new Date(NOW - minutes * 60_000).toISOString();
}

/*
 * A small office: a camera and a printer on the access switch, a device the
 * switch saw with no address yet, a laptop someone hid from the map, the
 * router OneUptime monitors, and a phone at another site.
 */
function officeDevices(): Array<FakeDiscoveredDevice> {
  return [
    {
      id: CAMERA_ID,
      name: "Lobby camera",
      macAddress: "00:1a:2b:3c:4d:01",
      ipAddress: "10.20.0.11",
      vendor: "Camera Vendor Inc",
      classification: "Lobby camera",
      seenOn: { id: SWITCH_ID, name: "Access switch 1" },
      portName: "Gi1/0/5",
      vlanId: 20,
      lastSeenAt: minutesAgo(2),
      isSeenRecently: true,
      isFromController: false,
      isHidden: false,
      siteId: SITE_ID,
    },
    {
      id: PRINTER_ID,
      name: "10.20.0.12",
      macAddress: "00:1a:2b:3c:4d:02",
      ipAddress: "10.20.0.12",
      hostname: "printer-2f.example.internal",
      vendor: "Printer Vendor Ltd",
      seenOn: { id: SWITCH_ID, name: "Access switch 1" },
      portName: "Gi1/0/7",
      lastSeenAt: minutesAgo(3),
      isSeenRecently: true,
      isFromController: false,
      isHidden: false,
      siteId: SITE_ID,
    },
    {
      id: NO_ADDRESS_ID,
      name: "00:1a:2b:3c:4d:03",
      macAddress: "00:1a:2b:3c:4d:03",
      seenOn: { id: SWITCH_ID, name: "Access switch 1" },
      lastSeenAt: minutesAgo(60 * 24 * 3),
      isSeenRecently: false,
      isFromController: false,
      isHidden: false,
      siteId: SITE_ID,
    },
    {
      id: LAPTOP_ID,
      name: "Spare laptop",
      macAddress: "00:1a:2b:3c:4d:04",
      ipAddress: "10.20.0.14",
      lastSeenAt: minutesAgo(5),
      isSeenRecently: true,
      isFromController: false,
      isHidden: true,
      siteId: SITE_ID,
    },
    {
      id: ROUTER_ID,
      name: "Branch router",
      macAddress: "00:1a:2b:3c:4d:05",
      ipAddress: "10.20.0.1",
      lastSeenAt: minutesAgo(1),
      isSeenRecently: true,
      isFromController: false,
      isHidden: false,
      monitoredDevice: { id: ROUTER_DEVICE_ID, name: "Branch router" },
      siteId: SITE_ID,
    },
    {
      id: OTHER_SITE_PHONE_ID,
      name: "Desk phone",
      macAddress: "00:1a:2b:3c:4d:06",
      ipAddress: "10.30.0.21",
      lastSeenAt: minutesAgo(4),
      isSeenRecently: true,
      isFromController: true,
      isHidden: false,
      siteId: OTHER_SITE_ID,
    },
  ];
}

let devicesServer: DiscoveredDevicesFakeServer;
let importServer: DiscoveryImportFakeServer;
let navigateSpy: jest.SpyInstance;
let deleteSpy: jest.SpyInstance;

function grant(permissions: Array<Permission>): void {
  jest.spyOn(PermissionUtil, "getAllPermissions").mockReturnValue(permissions);
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

/*
 * Draws the list and waits for its first read: for the row named
 * `waitForName`, or - for a list that opens empty - for its empty state.
 */
async function renderList(
  props: { siteId?: string; waitForName?: string | null } = {},
): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <DiscoveredDevicesTable siteId={props.siteId} />
      </MemoryRouter>,
    );
  });

  if (props.waitForName === null) {
    await screen.findByTestId("discovered-devices-empty");
  } else {
    await screen.findByText(props.waitForName || "Lobby camera", {
      selector: "p",
    });
  }

  await flush();
}

function listBodies(): Array<JSONObject> {
  return devicesServer.bodiesOf(FAKE_DISCOVERED_DEVICE_ROUTES.list);
}

function lastListBody(): JSONObject {
  const body: JSONObject | undefined = devicesServer.lastBodyOf(
    FAKE_DISCOVERED_DEVICE_ROUTES.list,
  );

  expect(body).toBeDefined();

  return body!;
}

// The table row that names this device.
function rowOf(name: string): HTMLElement {
  const cell: HTMLElement = screen.getByText(name, { selector: "p" });
  const row: HTMLElement | null = cell.closest("tr");

  expect(row).not.toBeNull();

  return row!;
}

function stateOf(id: string): string {
  return screen.getByTestId(`discovered-device-state-${id}`).textContent || "";
}

function showChoices(): HTMLElement {
  return screen.getByRole("radiogroup", { name: "Show" });
}

async function showChoice(label: RegExp): Promise<void> {
  await act(async () => {
    fireEvent.click(within(showChoices()).getByRole("radio", { name: label }));
  });
  await flush();
}

async function openRowMenu(name: string): Promise<HTMLElement> {
  await act(async () => {
    fireEvent.click(within(rowOf(name)).getByTestId("row-actions-more-button"));
  });

  return screen.getByRole("menu");
}

// A row's box is named by the device and its address.
function selectBox(name: string): HTMLElement {
  return screen.getByRole("checkbox", {
    name: new RegExp("^Select " + escapeRegExp(name)),
  });
}

async function select(name: string): Promise<void> {
  await act(async () => {
    fireEvent.click(selectBox(name));
  });
}

async function runBulk(title: string): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByText("Bulk Actions"));
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("menuitem", { name: title }));
  });
  await flush();
}

// Lets Tippy's deferred work run, then says which tooltips are shown.
async function tooltipsShown(): Promise<Array<string>> {
  await act(async () => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 50);
    });
  });

  return screen.queryAllByRole("tooltip").map((tooltip: HTMLElement) => {
    return tooltip.textContent || "";
  });
}

async function confirmModal(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
  });
  await flush();
  await flush();
}

beforeEach(() => {
  mockDialogOpenings.length = 0;
  window.localStorage.clear();

  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest
    .spyOn(PermissionUtil, "getProjectPermissions")
    .mockReturnValue(null as never);
  grant([Permission.ProjectOwner]);
  jest
    .spyOn(API, "getFriendlyMessage")
    .mockImplementation((err: unknown): string => {
      return (err as { message?: string }).message || String(err);
    });
  navigateSpy = jest
    .spyOn(Navigation, "navigate")
    .mockImplementation((): void => {});
  deleteSpy = jest
    .spyOn(ModelAPI, "deleteItem")
    .mockResolvedValue(undefined as never);

  devicesServer = new DiscoveredDevicesFakeServer(officeDevices());
  importServer = new DiscoveryImportFakeServer().install({
    post: (path: string, body: JSONObject) => {
      return devicesServer.answer(path, body) as never;
    },
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("opening the list", () => {
  test("opens on the devices OneUptime does not monitor yet, last seen first, one page of 25 from the server", async () => {
    await renderList();

    expect(listBodies()).toHaveLength(1);
    expect(lastListBody()).toEqual({
      search: "",
      show: "notMonitored",
      sort: "lastSeen",
      sortOrder: "desc",
      limit: 25,
      skip: 0,
    });

    // Hidden devices are not monitored either; the monitored router is not here.
    for (const name of ["Lobby camera", "10.20.0.12", "Spare laptop"]) {
      expect(screen.getByText(name, { selector: "p" })).toBeInTheDocument();
    }
    expect(
      screen.queryByText("Branch router", { selector: "p" }),
    ).not.toBeInTheDocument();

    // Each choice says how many it holds, and the list opens on the first.
    const show: HTMLElement = showChoices();
    const notMonitored: HTMLElement = within(show).getByRole("radio", {
      name: /Not monitored/,
    });
    expect(notMonitored).toHaveAttribute("aria-checked", "true");
    expect(notMonitored).toHaveTextContent("5");
    expect(
      within(show).getByRole("radio", { name: /^Monitored/ }),
    ).toHaveTextContent("1");
    expect(
      within(show).getByRole("radio", { name: /Hidden from map/ }),
    ).toHaveTextContent("1");
    expect(within(show).getByRole("radio", { name: /All/ })).toHaveTextContent(
      "6",
    );
  });

  test("a site's own page asks for that site's devices only", async () => {
    await renderList({ siteId: SITE_ID });

    expect(lastListBody()["siteId"]).toBe(SITE_ID);
    expect(
      screen.queryByText("Desk phone", { selector: "p" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText("Discovered Devices at this Site"),
    ).toBeInTheDocument();
  });

  test("each row says what the device is, where it was seen and what state it is in", async () => {
    await renderList();

    // A device named by its address keeps its hostname under the name.
    const printer: HTMLElement = rowOf("10.20.0.12");
    expect(
      within(printer).getByText("printer-2f.example.internal"),
    ).toBeInTheDocument();

    const camera: HTMLElement = rowOf("Lobby camera");
    expect(within(camera).getByText("10.20.0.11")).toHaveAttribute(
      "dir",
      "ltr",
    );
    expect(within(camera).getByText("00:1a:2b:3c:4d:01")).toBeInTheDocument();
    expect(within(camera).getByText("Camera Vendor Inc")).toBeInTheDocument();
    expect(
      within(camera).getByRole("link", { name: "Access switch 1" }),
    ).toBeInTheDocument();
    expect(within(camera).getByText("Gi1/0/5 · VLAN 20")).toBeInTheDocument();

    expect(stateOf(CAMERA_ID)).toBe("Discovered only");
    expect(stateOf(NO_ADDRESS_ID)).toBe("Not seen recently");
    expect(stateOf(LAPTOP_ID)).toBe("Hidden from map");
  });

  test("a monitored device links to the device that monitors it, and cannot be added again", async () => {
    await renderList();
    await showChoice(/^Monitored/);

    expect(lastListBody()["show"]).toBe("monitored");
    await screen.findByText("Branch router", { selector: "p" });

    expect(stateOf(ROUTER_ID)).toBe("Monitored");
    expect(
      screen.getByTestId(`discovered-device-monitored-${ROUTER_ID}`),
    ).toHaveTextContent("Branch router");

    const router: HTMLElement = rowOf("Branch router");
    expect(
      within(router).queryByRole("button", { name: "Add to monitoring" }),
    ).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(
        within(router).getByRole("button", { name: "View device" }),
      );
    });
    expect(navigateSpy).toHaveBeenCalledTimes(1);
    expect(navigateSpy.mock.calls[0]![0].toString()).toContain(
      ROUTER_DEVICE_ID,
    );
  });

  test("a list that could not be read says why, and Refresh reads it again", async () => {
    devicesServer.refuseNext = {
      route: FAKE_DISCOVERED_DEVICE_ROUTES.list,
      message: "The list is not available right now.",
    };

    await act(async () => {
      render(
        <MemoryRouter>
          <DiscoveredDevicesTable />
        </MemoryRouter>,
      );
    });

    expect(
      await screen.findByText("The list is not available right now."),
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByTestId("discovered-devices-more"));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Refresh" }));
    });

    expect(
      await screen.findByText("Lobby camera", { selector: "p" }),
    ).toBeInTheDocument();
    expect(listBodies()).toHaveLength(2);
  });
});

describe("finding devices", () => {
  test("the search is the server's, sent once the typing stops, from the first page", async () => {
    await renderList();

    const input: HTMLElement = screen.getByTestId("discovered-devices-search");

    // Typed a key at a time, each well within the wait for the typing to stop.
    for (const value of ["c", "ca", "camera"]) {
      await act(async () => {
        fireEvent.change(input, { target: { value: value } });
        await new Promise<void>((resolve: () => void) => {
          setTimeout(resolve, 60);
        });
      });
    }

    await waitFor(() => {
      expect(lastListBody()["search"]).toBe("camera");
    });

    // One request for the whole word, not one per key.
    expect(
      listBodies().filter((body: JSONObject): boolean => {
        return body["search"] !== "";
      }),
    ).toHaveLength(1);
    expect(lastListBody()["skip"]).toBe(0);

    await waitFor(() => {
      expect(
        screen.queryByText("Spare laptop", { selector: "p" }),
      ).not.toBeInTheDocument();
    });
    expect(
      screen.getByText("Lobby camera", { selector: "p" }),
    ).toBeInTheDocument();
  });

  test("a MAC address is found with or without its separators", async () => {
    await renderList();

    await act(async () => {
      fireEvent.change(screen.getByTestId("discovered-devices-search"), {
        target: { value: "001a2b3c4d04" },
      });
    });

    await waitFor(() => {
      expect(lastListBody()["search"]).toBe("001a2b3c4d04");
    });
    await waitFor(() => {
      expect(
        screen.queryByText("Lobby camera", { selector: "p" }),
      ).not.toBeInTheDocument();
    });
    expect(
      screen.getByText("Spare laptop", { selector: "p" }),
    ).toBeInTheDocument();
  });

  test("a search that matches nothing says so, and Clear search brings every device back", async () => {
    await renderList();

    await act(async () => {
      fireEvent.change(screen.getByTestId("discovered-devices-search"), {
        target: { value: "no such device" },
      });
    });

    const empty: HTMLElement = await screen.findByTestId(
      "discovered-devices-empty",
      {},
      { timeout: 3000 },
    );
    expect(empty).toHaveTextContent("No discovered device matches this search");
    expect(empty).toHaveTextContent("a MAC address with or without separators");

    await act(async () => {
      fireEvent.click(screen.getByTestId("discovered-devices-clear-search"));
    });

    expect(
      await screen.findByText(
        "Lobby camera",
        { selector: "p" },
        {
          timeout: 3000,
        },
      ),
    ).toBeInTheDocument();
    expect(lastListBody()["search"]).toBe("");
  });

  test("Hidden from map shows only the hidden devices, and a sort asked for is the server's", async () => {
    await renderList();
    await showChoice(/Hidden from map/);

    expect(lastListBody()["show"]).toBe("hidden");
    await waitFor(() => {
      expect(
        screen.queryByText("Lobby camera", { selector: "p" }),
      ).not.toBeInTheDocument();
    });
    expect(
      screen.getByText("Spare laptop", { selector: "p" }),
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(
        within(screen.getByRole("columnheader", { name: /^Name/ })).getByRole(
          "button",
        ),
      );
    });
    await flush();

    expect(lastListBody()["sort"]).toBe("name");
    expect(lastListBody()["sortOrder"]).toBe("asc");
    expect(lastListBody()["skip"]).toBe(0);

    // MAC address and Seen On are not the server's to sort by.
    expect(
      within(
        screen.getByRole("columnheader", { name: /^MAC Address/ }),
      ).queryByRole("button"),
    ).not.toBeInTheDocument();
  });

  test("when every device is monitored, the list says so instead of showing nothing", async () => {
    devicesServer = new DiscoveredDevicesFakeServer(
      officeDevices().filter((device: FakeDiscoveredDevice): boolean => {
        return Boolean(device.monitoredDevice);
      }),
    );

    await renderList({ waitForName: null });

    expect(
      await screen.findByTestId("discovered-devices-empty"),
    ).toHaveTextContent("Every discovered device is monitored");
  });

  test("a project nothing has been discovered in says how to start", async () => {
    devicesServer = new DiscoveredDevicesFakeServer([]);

    await renderList({ waitForName: null });

    const empty: HTMLElement = await screen.findByTestId(
      "discovered-devices-empty",
    );
    expect(empty).toHaveTextContent("No discovered devices yet");
    expect(empty).toHaveTextContent("Collect Connected Endpoints");
  });
});

describe("a row's own actions", () => {
  test("Add to monitoring opens the import for that one device", async () => {
    await renderList();

    await act(async () => {
      fireEvent.click(
        within(rowOf("Lobby camera")).getByRole("button", {
          name: "Add to monitoring",
        }),
      );
    });

    expect(screen.getByTestId("add-dialog-devices")).toHaveTextContent(
      "Lobby camera",
    );
    const opened: DialogProps =
      mockDialogOpenings[mockDialogOpenings.length - 1]!;
    expect(opened.devices).toHaveLength(1);
    expect(opened.devices[0]).toMatchObject({
      id: CAMERA_ID,
      ipAddress: "10.20.0.11",
      macAddress: "00:1a:2b:3c:4d:01",
    });
    expect(opened.importId).toBeUndefined();
  });

  test("a device with no address yet cannot be added, and says why", async () => {
    await renderList();

    const add: HTMLElement = within(rowOf("00:1a:2b:3c:4d:03")).getByRole(
      "button",
      { name: "Add to monitoring" },
    );

    expect(add).toBeDisabled();

    await act(async () => {
      fireEvent.mouseEnter(add.parentElement!);
      fireEvent.click(add.parentElement!);
    });

    expect(await tooltipsShown()).toEqual([
      "No IP address yet: a device gets one once a router's ARP table or a network controller reports it.",
    ]);
    expect(mockDialogOpenings).toHaveLength(0);
  });

  test("Hide from map hides that device in one request, and the list is read again", async () => {
    await renderList();
    const reads: number = listBodies().length;

    const menu: HTMLElement = await openRowMenu("Lobby camera");
    await act(async () => {
      fireEvent.click(
        within(menu).getByRole("menuitem", { name: "Hide from map" }),
      );
    });
    await flush();

    expect(devicesServer.bodiesOf(FAKE_DISCOVERED_DEVICE_ROUTES.hide)).toEqual([
      { endpointIds: [CAMERA_ID] },
    ]);
    await waitFor(() => {
      expect(listBodies().length).toBeGreaterThan(reads);
    });
    await waitFor(() => {
      expect(stateOf(CAMERA_ID)).toBe("Hidden from map");
    });
  });

  test("a hidden device offers Show on map instead", async () => {
    await renderList();

    const menu: HTMLElement = await openRowMenu("Spare laptop");
    expect(
      within(menu).queryByRole("menuitem", { name: "Hide from map" }),
    ).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(
        within(menu).getByRole("menuitem", { name: "Show on map" }),
      );
    });
    await flush();

    expect(devicesServer.bodiesOf(FAKE_DISCOVERED_DEVICE_ROUTES.show)).toEqual([
      { endpointIds: [LAPTOP_ID] },
    ]);
    await waitFor(() => {
      expect(stateOf(LAPTOP_ID)).toBe("Discovered only");
    });
  });

  test("Delete asks first, says the monitored device is not changed, and deletes only the list's row", async () => {
    await renderList();

    const menu: HTMLElement = await openRowMenu("Lobby camera");
    await act(async () => {
      fireEvent.click(within(menu).getByRole("menuitem", { name: "Delete" }));
    });

    const dialog: HTMLElement = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Delete Lobby camera (10.20.0.11)?");
    expect(dialog).toHaveTextContent(
      "A monitored device and its monitoring are not changed.",
    );
    expect(deleteSpy).not.toHaveBeenCalled();

    await confirmModal();

    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(
      (deleteSpy.mock.calls[0]![0] as { id: ObjectID }).id.toString(),
    ).toBe(CAMERA_ID);
  });
});

describe("many devices at once", () => {
  test("Hide from map asks first, saying nothing is deleted, then hides the whole selection in one request", async () => {
    await renderList();
    await select("Lobby camera");
    await select("10.20.0.12");

    await runBulk("Hide from map");

    const dialog: HTMLElement = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("Hide 2 devices from the map?");
    expect(dialog).toHaveTextContent("Nothing is deleted");
    expect(dialog).toHaveTextContent(
      "monitored devices and their monitoring are never changed",
    );
    expect(
      devicesServer.bodiesOf(FAKE_DISCOVERED_DEVICE_ROUTES.hide),
    ).toHaveLength(0);

    await confirmModal();

    await waitFor(() => {
      expect(
        devicesServer.bodiesOf(FAKE_DISCOVERED_DEVICE_ROUTES.hide),
      ).toHaveLength(1);
    });
    const body: JSONObject = devicesServer.bodiesOf(
      FAKE_DISCOVERED_DEVICE_ROUTES.hide,
    )[0]!;
    expect([...(body["endpointIds"] as Array<string>)].sort()).toEqual(
      [CAMERA_ID, PRINTER_ID].sort(),
    );

    expect(
      await screen.findByText("2 devices hidden from the map"),
    ).toBeInTheDocument();
    expect(devicesServer.devices.get(CAMERA_ID)!.isHidden).toBe(true);
    expect(devicesServer.devices.get(PRINTER_ID)!.isHidden).toBe(true);
  });

  test("a device already hidden is left as it was, and says why", async () => {
    await renderList();
    await select("Lobby camera");
    await select("Spare laptop");

    await runBulk("Hide from map");
    await confirmModal();

    expect(
      await screen.findByText("1 device hidden from the map"),
    ).toBeInTheDocument();
    expect(screen.getByText("1 device left as it was")).toBeInTheDocument();
    expect(
      screen.getByText("Already hidden from the map.", { exact: false }),
    ).toBeInTheDocument();
  });

  test("selecting every matching device asks the server, and Add to monitoring gets them all", async () => {
    await renderList();
    await select("Lobby camera");

    await act(async () => {
      fireEvent.click(screen.getByTestId("bulk-update-select-all"));
    });
    await flush();
    await flush();

    expect(devicesServer.lastBodyOf(FAKE_DISCOVERED_DEVICE_ROUTES.ids)).toEqual(
      {
        search: "",
        show: "notMonitored",
        sort: "lastSeen",
        sortOrder: "desc",
      },
    );

    await runBulk("Add to monitoring");

    const opened: DialogProps =
      mockDialogOpenings[mockDialogOpenings.length - 1]!;
    expect(
      opened.devices
        .map((device: DiscoveredDeviceItem): string => {
          return device.id;
        })
        .sort(),
    ).toEqual(
      [CAMERA_ID, PRINTER_ID, NO_ADDRESS_ID, LAPTOP_ID, OTHER_SITE_PHONE_ID]
        .map((id: string): string => {
          return id.toLowerCase();
        })
        .sort(),
    );

    // An import the dialog started clears the selection and reads the list again.
    const reads: number = listBodies().length;
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Recorder: imports changed" }),
      );
    });
    await flush();

    await waitFor(() => {
      expect(listBodies().length).toBeGreaterThan(reads);
    });
    expect(selectBox("Lobby camera")).not.toBeChecked();
  });
});

describe("imports that are still running", () => {
  test("an import from this list is shown over the table, and View reopens it on its progress", async () => {
    importServer.seed({
      scanId: "",
      status: DiscoveryImportStatus.Running,
      results: [
        {
          ipAddress: "10.20.0.11",
          name: "Lobby camera",
          isPingOnly: true,
          device: DiscoveryImportDeviceOutcome.Pending,
          monitor: DiscoveryImportMonitorOutcome.NotRequested,
        },
      ],
    });
    // An import of a scan belongs to the scan's row, not this list.
    importServer.seed({
      scanId: "50000000-0000-4000-8000-000000000001",
      status: DiscoveryImportStatus.Running,
      results: [],
    });

    await renderList();

    const strip: HTMLElement = await screen.findByTestId(
      "discovered-devices-running-imports",
    );
    const views: Array<HTMLElement> = within(strip).getAllByRole("button");

    expect(views).toHaveLength(1);

    await act(async () => {
      fireEvent.click(views[0]!);
    });

    const opened: DialogProps =
      mockDialogOpenings[mockDialogOpenings.length - 1]!;
    expect(opened.importId).toBeTruthy();
    expect(opened.devices).toEqual([]);
  });
});

describe("what a reader may not do", () => {
  test("a viewer sees the list, and every change is locked with why", async () => {
    grant([Permission.Viewer]);

    await renderList();

    const add: HTMLElement = within(rowOf("Lobby camera")).getByRole("button", {
      name: "Add to monitoring",
    });
    expect(add).toBeDisabled();

    const menu: HTMLElement = await openRowMenu("Lobby camera");
    for (const title of ["Hide from map", "Edit classification", "Delete"]) {
      const item: HTMLElement = within(menu).getByRole("menuitem", {
        name: new RegExp(title),
      });
      expect(
        item.hasAttribute("disabled") ||
          item.getAttribute("aria-disabled") === "true",
      ).toBe(true);
    }

    expect(
      devicesServer.bodiesOf(FAKE_DISCOVERED_DEVICE_ROUTES.hide),
    ).toHaveLength(0);
  });
});

/*
 * The UI review (#5775): beside the Network menu at 1280px the rows ran past
 * their card, and the State column sat under the row's buttons - in German
 * the whole of it. Where the rows do not fit, the MAC address goes under the
 * IP address, the vendor under the name and Last Seen under where the device
 * was seen; the row's button says "Add" (its name still the whole action).
 */
describe("a card narrower than the rows", () => {
  function setWindowWidth(width: number): void {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: width,
    });
  }

  function headerTitles(): Array<string> {
    return Array.from(document.querySelectorAll("thead th")).map(
      (cell: Element): string => {
        return (cell.textContent || "").trim();
      },
    );
  }

  // The cell of `row` that shows `text`.
  function cellOf(row: HTMLElement, text: string): HTMLElement {
    const cell: HTMLElement | null = within(row).getByText(text).closest("td");

    expect(cell).not.toBeNull();

    return cell!;
  }

  // What a cell shows under its own value: each column's name, then its value.
  function foldedIn(cell: HTMLElement): Array<string> {
    return within(cell)
      .queryAllByTestId(TABLE_FOLDED_VALUE_TEST_ID)
      .map((line: HTMLElement): string => {
        return (line.textContent || "").trim();
      });
  }

  afterEach(() => {
    forgetRememberedTableFits();
    setWindowWidth(1024);
  });

  test("the MAC address goes under the IP address, the vendor under the name and Last Seen under where it was seen, and State keeps its column", async () => {
    // Below lg the window stands in for the card: one too narrow for the rows.
    setWindowWidth(900);
    await renderList();

    const titles: Array<string> = headerTitles();
    expect(titles).toEqual(
      expect.arrayContaining(["Name", "IP Address", "Seen On", "State"]),
    );
    for (const folded of ["MAC Address", "Vendor", "Last Seen"]) {
      expect(titles).not.toContain(folded);
    }

    const camera: HTMLElement = rowOf("Lobby camera");
    expect(foldedIn(cellOf(camera, "Lobby camera"))).toEqual([
      "VendorCamera Vendor Inc",
    ]);
    expect(foldedIn(cellOf(camera, "10.20.0.11"))).toEqual([
      "MAC Address00:1a:2b:3c:4d:01",
    ]);
    expect(foldedIn(cellOf(camera, "Gi1/0/5 · VLAN 20"))).toEqual([
      "Last Seen2 minutes ago",
    ]);
    expect(stateOf(CAMERA_ID)).toBe("Discovered only");

    /*
     * A time among where-it-was-seen says what it is ("Last Seen 2 minutes
     * ago"); a vendor and a MAC address say it by themselves.
     */
    expect(
      within(cellOf(camera, "Gi1/0/5 · VLAN 20")).getByTestId(
        TABLE_FOLDED_VALUE_TITLE_TEST_ID,
      ),
    ).toHaveTextContent("Last Seen");
    for (const text of ["Lobby camera", "10.20.0.11"]) {
      expect(
        within(cellOf(camera, text)).queryByTestId(
          TABLE_FOLDED_VALUE_TITLE_TEST_ID,
        ),
      ).not.toBeInTheDocument();
    }

    // Under the name, the vendor is as quiet as the rest of what is folded.
    expect(within(camera).getByText("Camera Vendor Inc")).toHaveClass(
      "text-gray-500",
    );

    // A device with no vendor draws no empty line under its name.
    expect(foldedIn(cellOf(rowOf("Spare laptop"), "Spare laptop"))).toEqual([]);
  });

  test("where the rows fit, each is a column of its own", async () => {
    setWindowWidth(1280);
    await renderList();

    expect(headerTitles()).toEqual(
      expect.arrayContaining([
        "Name",
        "IP Address",
        "MAC Address",
        "Vendor",
        "Seen On",
        "Last Seen",
        "State",
      ]),
    );

    const camera: HTMLElement = rowOf("Lobby camera");
    expect(within(camera).queryAllByTestId(TABLE_FOLDED_VALUE_TEST_ID)).toEqual(
      [],
    );
    expect(within(camera).getByText("Camera Vendor Inc")).toHaveClass(
      "text-gray-900",
    );
  });

  test("a row's button says Add, and View for a monitored device, each named for the whole action", async () => {
    await renderList();

    expect(
      within(rowOf("Lobby camera")).getByRole("button", {
        name: "Add to monitoring",
      }),
    ).toHaveTextContent(/^Add$/);

    await showChoice(/^Monitored/);
    await screen.findByText("Branch router", { selector: "p" });

    expect(
      within(rowOf("Branch router")).getByRole("button", {
        name: "View device",
      }),
    ).toHaveTextContent(/^View$/);
  });
});
