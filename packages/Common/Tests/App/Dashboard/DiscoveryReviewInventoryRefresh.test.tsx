import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
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
import { VoidFunction } from "../../../Types/FunctionTypes";
import { JSONObject } from "../../../Types/JSON";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import PermissionUtil from "../../../UI/Utils/Permission";
import { ComponentProps as ModalProps } from "../../../UI/Components/Modal/Modal";
import DiscoveryImportFakeServer from "./DiscoveryImportFakeServer";

/*
 * What the import dialog offers is the inventory as it is NOW, not as the
 * scans table had it when it loaded: a device deleted since is importable
 * again, a host added since is not, and the scan's naming choice is the one
 * it has now. The dialog reads the scan fresh on every open, and a read that
 * is pending, failed or overtaken offers nothing to import.
 *
 * The import itself is the server's (issue #4812): it creates the devices,
 * under the names these rows show, from the same scan read with the same
 * naming choice - DiscoveryImportRunner.test.ts creates them through the real
 * builder ("names: ..."). Here the page's real review handlers run against
 * an in-memory import API (DiscoveryImportFakeServer); the table mock exposes
 * the real row action, and the modal mock removes animation and portals.
 */
interface TableProps {
  actionButtons: Array<{
    title: string;
    onClick: (
      scan: NetworkDeviceDiscoveryScan,
      onComplete: VoidFunction,
    ) => Promise<void>;
  }>;
}

let capturedTable: TableProps | null = null;

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: TableProps) => {
      capturedTable = props;
      return null;
    },
  };
});

jest.mock("../../../UI/Components/Modal/Modal", () => {
  return {
    __esModule: true,
    ModalWidth: { Medium: 1, Large: 2 },
    default: (props: ModalProps) => {
      return (
        <div role="dialog" aria-label={props.title}>
          <p>{props.description}</p>
          {props.error && <p role="alert">{props.error}</p>}
          {props.isBodyLoading ? <p>Refreshing inventory</p> : props.children}
          {props.leftFooterElement}
          <button onClick={props.onClose}>Close review</button>
          {props.secondaryButton && (
            <button
              disabled={props.secondaryButton.disabled}
              onClick={props.secondaryButton.onClick}
            >
              {props.secondaryButton.title}
            </button>
          )}
          {props.submitButtonText && (
            <button
              disabled={props.disableSubmitButton || props.isLoading}
              onClick={props.onSubmit}
            >
              {props.submitButtonText}
            </button>
          )}
        </div>
      );
    },
  };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SCAN_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const OTHER_SCAN_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const PROBE_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");

const IMPORT_BUTTON: RegExp = /^Import \d+ devices?$/;

let getItemSpy: jest.SpyInstance;
let server: DiscoveryImportFakeServer;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise: Promise<T> = new Promise<T>(
    (
      resolvePromise: (value: T | PromiseLike<T>) => void,
      rejectPromise: (reason?: unknown) => void,
    ) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    },
  );
  return { promise, resolve, reject };
}

function host(
  ipAddress: string,
  isAlreadyRegistered: boolean,
): DiscoveredNetworkDevice {
  return { ipAddress, isAlreadyRegistered, snmpReachable: false };
}

function scan(
  hosts: Array<DiscoveredNetworkDevice>,
  id: ObjectID = SCAN_ID,
): NetworkDeviceDiscoveryScan {
  const value: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan();
  value.id = id;
  value._id = id.toString();
  value.projectId = PROJECT_ID;
  value.probeId = PROBE_ID;
  value.name =
    id.toString() === SCAN_ID.toString() ? "Primary scan" : "Other scan";
  value.cidr = "10.0.0.0/24";
  value.status = "Completed";
  value.discoveredDevices = hosts;
  return value;
}

async function renderPage(): Promise<void> {
  const project: Project = new Project();
  project.id = PROJECT_ID;
  render(
    <MemoryRouter>
      <DiscoveryPage
        pageRoute={new Route("/dashboard/network-devices/discovery")}
        currentProject={project}
        hasPaymentMethod={true}
      />
    </MemoryRouter>,
  );
  await waitFor(() => {
    expect(capturedTable).not.toBeNull();
  });
}

function reviewAction(): TableProps["actionButtons"][number] {
  const action: TableProps["actionButtons"][number] | undefined =
    capturedTable?.actionButtons.find(
      (button: TableProps["actionButtons"][number]) => {
        return button.title === "Review Results";
      },
    );
  if (!action) {
    throw new Error("Review Results action was not rendered");
  }
  return action;
}

async function openReview(value: NetworkDeviceDiscoveryScan): Promise<void> {
  await act(async () => {
    await reviewAction().onClick(value, () => {});
  });
  await act(async () => {
    await Promise.resolve();
  });
}

function checkbox(ipAddress: string): HTMLElement {
  return screen.getByTestId(`discovered-device-checkbox-${ipAddress}`);
}

function next(): HTMLElement {
  return screen.getByRole("button", { name: "Next" });
}

// On to the monitoring step, then Import: what the server is asked to import.
async function importSelected(): Promise<JSONObject> {
  const before: number = server.startBodies.length;

  fireEvent.click(next());

  const submit: HTMLElement = await screen.findByRole("button", {
    name: IMPORT_BUTTON,
  });

  await waitFor(() => {
    expect(submit).toBeEnabled();
  });

  fireEvent.click(submit);

  await waitFor(() => {
    expect(server.startBodies.length).toBe(before + 1);
  });

  return server.startBodies[before]!;
}

async function closeReview(): Promise<void> {
  fireEvent.click(screen.getByText("Close review"));
  await waitFor(() => {
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
}

beforeEach(() => {
  capturedTable = null;
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(ProbeUtil, "getAllProbes").mockResolvedValue([]);
  jest
    .spyOn(PermissionUtil, "getAllPermissions")
    .mockReturnValue([Permission.ProjectAdmin]);
  getItemSpy = jest.spyOn(ModelAPI, "getItem");
  // The monitoring step's lists: nothing in them is needed here.
  jest.spyOn(ModelAPI, "getList").mockResolvedValue({
    data: [],
    count: 0,
    skip: 0,
    limit: 0,
  } as never);
  server = new DiscoveryImportFakeServer().install();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("Discovery review refreshes registration from current inventory", () => {
  test("a deleted device becomes selectable, while a newly registered device cannot be imported", async () => {
    const oldScan: NetworkDeviceDiscoveryScan = scan([
      host("10.0.0.1", true),
      host("10.0.0.2", false),
    ]);
    getItemSpy.mockResolvedValue(
      scan([host("10.0.0.1", false), host("10.0.0.2", true)]),
    );
    await renderPage();
    await openReview(oldScan);

    expect(checkbox("10.0.0.1")).toBeEnabled();
    expect(checkbox("10.0.0.1")).toBeChecked();
    expect(checkbox("10.0.0.2")).toBeDisabled();
    expect(checkbox("10.0.0.2")).not.toBeChecked();
    expect(screen.getByText("1 host will be imported")).toBeInTheDocument();

    const body: JSONObject = await importSelected();

    expect(body["ipAddresses"]).toEqual(["10.0.0.1"]);
    expect(body["scanId"]).toBe(SCAN_ID.toString());
    // The table's row is not rewritten by the review.
    expect(oldScan.discoveredDevices![0]!.isAlreadyRegistered).toBe(true);
  });

  test("reads the scan's identity, results, probe and naming - and never its credentials, which the server reads itself", async () => {
    getItemSpy.mockResolvedValue(scan([host("10.0.0.1", false)]));
    await renderPage();
    await openReview(scan([host("10.0.0.1", true)]));

    expect(getItemSpy).toHaveBeenCalledTimes(1);
    expect(getItemSpy.mock.calls[0]![0]).toEqual({
      modelType: NetworkDeviceDiscoveryScan,
      id: SCAN_ID,
      select: {
        _id: true,
        projectId: true,
        name: true,
        cidr: true,
        status: true,
        statusMessage: true,
        discoveredDevices: true,
        probeId: true,
        isSnmpEnabled: true,
        useShortDeviceNames: true,
        /*
         * Read so an unnamed row can say whether NetBIOS was ever asked
         * (issue #3916) — see DiscoveryReviewUnnamedHostHint.test.tsx.
         */
        isNetbiosLookupEnabled: true,
      },
    });
  });

  test("reopening after the import was undone - its device deleted - offers the host again", async () => {
    getItemSpy.mockResolvedValue(scan([host("10.0.0.1", false)]));
    await renderPage();
    await openReview(scan([host("10.0.0.1", false)]));
    await importSelected();
    expect(await screen.findByText("Import finished")).toBeInTheDocument();
    await closeReview();

    /*
     * The inventory no longer has the device: the fresh read says so, and
     * the host is offered again.
     */
    await openReview(scan([host("10.0.0.1", false)]));

    expect(checkbox("10.0.0.1")).toBeEnabled();
    expect(checkbox("10.0.0.1")).toBeChecked();
    expect(getItemSpy).toHaveBeenCalledTimes(3);
  });

  test("reopening keeps a device that is there disabled, and offers nothing to import", async () => {
    getItemSpy.mockResolvedValue(scan([host("10.0.0.1", true)]));
    await renderPage();
    await openReview(scan([host("10.0.0.1", false)]));

    expect(checkbox("10.0.0.1")).toBeDisabled();
    expect(screen.getByText("Already added")).toBeInTheDocument();
    expect(next()).toBeDisabled();
    expect(screen.getByText("0 hosts will be imported")).toBeInTheDocument();
  });

  test("after a partly failed import, the imported host reads as added and the failed one can be imported again", async () => {
    getItemSpy.mockResolvedValue(
      scan([host("10.0.0.1", false), host("10.0.0.2", false)]),
    );
    server.control.failDevices.set("10.0.0.2", "Device creation failed");
    await renderPage();
    await openReview(scan([]));
    await importSelected();

    await waitFor(() => {
      expect(
        screen.getByTestId("discovery-import-issue-DeviceFailed"),
      ).toHaveTextContent("Device creation failed");
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Import more devices" }),
    );

    expect(checkbox("10.0.0.1")).toBeDisabled();
    expect(checkbox("10.0.0.2")).toBeEnabled();
    expect(checkbox("10.0.0.2")).toBeChecked();

    server.control.failDevices.clear();
    const body: JSONObject = await importSelected();

    expect(body["ipAddresses"]).toEqual(["10.0.0.2"]);
  });
});

/*
 * OneUptime issue #3678: a scan set to short device names shows the short
 * name - the name the server's import creates the device under - with the
 * FQDN it was cut from beside the address. The choice is the FRESH scan's,
 * not the table row's: the operator may have switched short names on since
 * the list loaded.
 */
describe("Discovery review names hosts by the scan's short-name choice", () => {
  const FQDN: string = "core-gw.corp.example.com";

  function namedHost(ipAddress: string): DiscoveredNetworkDevice {
    return { ...host(ipAddress, false), dnsHostname: FQDN };
  }

  function scanNaming(
    hosts: Array<DiscoveredNetworkDevice>,
    useShortDeviceNames: boolean | undefined,
  ): NetworkDeviceDiscoveryScan {
    const value: NetworkDeviceDiscoveryScan = scan(hosts);
    if (useShortDeviceNames !== undefined) {
      value.useShortDeviceNames = useShortDeviceNames;
    }
    return value;
  }

  test("a scan set to short names shows the short name, with the FQDN beside the address", async () => {
    getItemSpy.mockResolvedValue(scanNaming([namedHost("10.0.0.1")], true));
    await renderPage();
    await openReview(scanNaming([namedHost("10.0.0.1")], true));

    expect(screen.getByText("core-gw")).toBeInTheDocument();
    expect(screen.getByText("core-gw")).toHaveAttribute("title", "core-gw");
    expect(screen.getByText(FQDN, { exact: false })).toBeInTheDocument();
    expect(checkbox("10.0.0.1")).toHaveAttribute(
      "aria-label",
      "Import core-gw (10.0.0.1)",
    );
  });

  test("a scan that did not ask shows the full name", async () => {
    for (const flag of [false, undefined]) {
      cleanup();
      capturedTable = null;
      getItemSpy.mockResolvedValue(scanNaming([namedHost("10.0.0.1")], flag));
      await renderPage();
      await openReview(scanNaming([namedHost("10.0.0.1")], flag));

      expect(checkbox("10.0.0.1")).toHaveAttribute(
        "aria-label",
        `Import ${FQDN} (10.0.0.1)`,
      );
    }
  });

  test("the fresh read decides the naming, not the stale table row", async () => {
    getItemSpy.mockResolvedValue(scanNaming([namedHost("10.0.0.1")], true));
    await renderPage();
    await openReview(scanNaming([namedHost("10.0.0.1")], false));

    expect(checkbox("10.0.0.1")).toHaveAttribute(
      "aria-label",
      "Import core-gw (10.0.0.1)",
    );
  });

  test("a search finds the short name the row shows", async () => {
    getItemSpy.mockResolvedValue(
      scanNaming(
        [
          namedHost("10.0.0.1"),
          { ...host("10.0.0.2", false), dnsHostname: "web.corp.example.com" },
        ],
        true,
      ),
    );
    await renderPage();
    await openReview(scan([]));

    fireEvent.change(screen.getByTestId("discovered-host-search"), {
      target: { value: "core-gw" },
    });

    expect(screen.getByText("1 host will be imported")).toBeInTheDocument();
    expect(
      screen.queryByTestId("discovered-host-row-10.0.0.2"),
    ).not.toBeInTheDocument();
  });
});

/*
 * OneUptime issues #3677 and #4518: a host named by its NetBIOS answer shows
 * that name, with a plain "NetBIOS name" hint beside its address - and the
 * PTR name after it, when DNS names it too. A NetBIOS answer the rules
 * reject leaves the host on its address.
 */
describe("Discovery review names a host by its NetBIOS answer", () => {
  function netbiosHost(
    ipAddress: string,
    netbiosName: string,
  ): DiscoveredNetworkDevice {
    return { ...host(ipAddress, false), netbiosName };
  }

  test("the row shows the NetBIOS name, and says beside the address where it came from", async () => {
    getItemSpy.mockResolvedValue(
      scan([netbiosHost("10.0.0.1", "accounts-pc01")]),
    );
    await renderPage();
    await openReview(scan([netbiosHost("10.0.0.1", "accounts-pc01")]));

    expect(screen.getByText("accounts-pc01")).toHaveAttribute(
      "title",
      "accounts-pc01",
    );
    expect(checkbox("10.0.0.1")).toHaveAttribute(
      "aria-label",
      "Import accounts-pc01 (10.0.0.1)",
    );

    const hint: HTMLElement = screen.getByText(/NetBIOS name/);

    expect(hint.tagName).toBe("SPAN");
    // Beside the address, on the address line — not a badge elsewhere.
    expect(hint.parentElement).toHaveTextContent("10.0.0.1 · NetBIOS name");
    // Says what the name is, and why it beat any reverse-DNS name (#4518).
    expect(hint.getAttribute("title") || "").toContain(
      "Windows computer name this host reported for itself",
    );
    expect(hint.getAttribute("title") || "").toContain(
      "ahead of its reverse-DNS name",
    );
  });

  test("a host DNS names as well is named by its NetBIOS name, with the PTR name after the hint", async () => {
    getItemSpy.mockResolvedValue(
      scan([
        {
          ...netbiosHost("10.0.0.1", "ACCOUNTS-PC01"),
          dnsHostname: "core-gw.corp.example.com",
        },
      ]),
    );
    await renderPage();
    await openReview(scan([]));

    expect(screen.getByText("ACCOUNTS-PC01")).toHaveAttribute(
      "title",
      "ACCOUNTS-PC01",
    );
    expect(screen.getByText(/NetBIOS name/).parentElement).toHaveTextContent(
      "10.0.0.1 · NetBIOS name · core-gw.corp.example.com",
    );
  });

  test("a NetBIOS answer the rules reject leaves the host on its address, with no hint", async () => {
    getItemSpy.mockResolvedValue(
      scan([netbiosHost("10.0.0.1", "<img src=x onerror=alert(1)>")]),
    );
    await renderPage();
    await openReview(scan([]));

    expect(checkbox("10.0.0.1")).toHaveAttribute(
      "aria-label",
      "Import 10.0.0.1 (10.0.0.1)",
    );
    expect(screen.queryByText(/NetBIOS name/)).not.toBeInTheDocument();
    expect(screen.queryByText(/onerror/)).not.toBeInTheDocument();
  });
});

/*
 * OneUptime issue #4518, rendered: the reporter's kitchen displays. Each is
 * named by its own hostname — WB0024KDS03 by SNMP, WB0024KDS04 and
 * WB0024KDS05 by the Windows name they report over NetBIOS — with its DNS
 * name beside the address, and the unnamed one says why.
 */
describe("Discovery review names the reported displays by their hostnames (issue #4518)", () => {
  const REPORTED: Array<DiscoveredNetworkDevice> = [
    { ipAddress: "10.16.42.52", snmpReachable: false },
    {
      ipAddress: "10.16.42.53",
      snmpReachable: true,
      sysName: "WB0024KDS03",
      dnsHostname: "wb-0024-kds03.wbhq.com",
    },
    {
      ipAddress: "10.16.42.54",
      snmpReachable: false,
      dnsHostname: "wb-0024-kds04.wbhq.com",
      netbiosName: "WB0024KDS04",
    },
    {
      ipAddress: "10.16.42.55",
      snmpReachable: false,
      dnsHostname: "wb-0024-kds05.wbhq.com",
      netbiosName: "WB0024KDS05",
    },
  ];

  function reportedScan(): NetworkDeviceDiscoveryScan {
    const value: NetworkDeviceDiscoveryScan = scan(REPORTED);
    value.useShortDeviceNames = true;
    value.isNetbiosLookupEnabled = true;
    return value;
  }

  test("each row reads as its hostname, with the DNS name beside the address", async () => {
    getItemSpy.mockResolvedValue(reportedScan());
    await renderPage();
    await openReview(reportedScan());

    for (const [address, name] of [
      ["10.16.42.53", "WB0024KDS03"],
      ["10.16.42.54", "WB0024KDS04"],
      ["10.16.42.55", "WB0024KDS05"],
    ] as Array<[string, string]>) {
      expect(screen.getByText(name)).toHaveAttribute("title", name);
      expect(checkbox(address)).toHaveAttribute(
        "aria-label",
        `Import ${name} (${address})`,
      );
    }

    expect(screen.getByText(/^10\.16\.42\.53/)).toHaveTextContent(
      "10.16.42.53 · wb-0024-kds03.wbhq.com",
    );
    expect(screen.getByText(/^10\.16\.42\.54/)).toHaveTextContent(
      "10.16.42.54 · NetBIOS name · wb-0024-kds04.wbhq.com",
    );
    // The SNMP-named display carries no NetBIOS hint.
    expect(screen.getAllByText(/NetBIOS name/)).toHaveLength(2);
    // The unnamed one is still listed by its address, and says so.
    expect(checkbox("10.16.42.52")).toHaveAttribute(
      "aria-label",
      "Import 10.16.42.52 (10.16.42.52)",
    );
    expect(screen.getByText("No name found")).toBeInTheDocument();
  });

  test("all four are imported, the unnamed one with them", async () => {
    getItemSpy.mockResolvedValue(reportedScan());
    await renderPage();
    await openReview(reportedScan());

    const body: JSONObject = await importSelected();

    expect(body["ipAddresses"]).toEqual([
      "10.16.42.52",
      "10.16.42.53",
      "10.16.42.54",
      "10.16.42.55",
    ]);
  });
});

describe("Discovery review waits for a successful current response", () => {
  test("offers nothing to select or import while the inventory read is pending", async () => {
    const pending: Deferred<NetworkDeviceDiscoveryScan | null> = deferred();
    getItemSpy.mockReturnValue(pending.promise);
    await renderPage();
    let opening: Promise<void> = Promise.resolve();
    await act(async () => {
      opening = reviewAction().onClick(
        scan([host("10.0.0.1", false)]),
        () => {},
      );
    });

    expect(screen.getByText("Refreshing inventory")).toBeInTheDocument();
    expect(next()).toBeDisabled();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();

    await act(async () => {
      pending.resolve(scan([host("10.0.0.1", true)]));
      await opening;
    });
    expect(checkbox("10.0.0.1")).toBeDisabled();
    expect(server.startBodies).toEqual([]);
  });

  test("a failed refresh cannot fall back to a stale importable row, and reopening tries again", async () => {
    getItemSpy.mockRejectedValueOnce(new Error("Inventory refresh failed"));
    await renderPage();
    const oldScan: NetworkDeviceDiscoveryScan = scan([host("10.0.0.1", false)]);
    await openReview(oldScan);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Inventory refresh failed",
    );
    expect(next()).toBeDisabled();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();

    await closeReview();
    getItemSpy.mockResolvedValue(scan([host("10.0.0.1", false)]));
    await openReview(oldScan);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(checkbox("10.0.0.1")).toBeChecked();
    expect(next()).toBeEnabled();
  });

  test("a scan deleted since the table loaded leaves import disabled", async () => {
    getItemSpy.mockResolvedValue(null);
    await renderPage();
    await openReview(scan([host("10.0.0.1", false)]));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "This discovery scan could not be found.",
    );
    expect(next()).toBeDisabled();
    expect(server.startBodies).toEqual([]);
  });

  test("closing during a pending read does not reopen the dialog when the read completes", async () => {
    const pending: Deferred<NetworkDeviceDiscoveryScan | null> = deferred();
    getItemSpy.mockReturnValue(pending.promise);
    const completed: jest.Mock = jest.fn();
    await renderPage();
    let opening: Promise<void> = Promise.resolve();
    await act(async () => {
      opening = reviewAction().onClick(scan([]), completed);
    });
    fireEvent.click(screen.getByText("Close review"));

    await act(async () => {
      pending.resolve(scan([host("10.0.0.1", false)]));
      await opening;
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(completed).toHaveBeenCalledTimes(1);
  });

  test("an older response cannot replace another scan's review", async () => {
    const older: Deferred<NetworkDeviceDiscoveryScan | null> = deferred();
    getItemSpy.mockReturnValueOnce(older.promise);
    getItemSpy.mockResolvedValueOnce(
      scan([host("10.0.0.2", true)], OTHER_SCAN_ID),
    );
    await renderPage();
    let opening: Promise<void> = Promise.resolve();
    await act(async () => {
      opening = reviewAction().onClick(scan([]), () => {});
    });
    await openReview(scan([], OTHER_SCAN_ID));

    await act(async () => {
      older.resolve(scan([host("10.0.0.1", false)]));
      await opening;
    });

    expect(
      screen.queryByTestId("discovered-device-checkbox-10.0.0.1"),
    ).not.toBeInTheDocument();
    expect(checkbox("10.0.0.2")).toBeDisabled();
    expect(next()).toBeDisabled();
  });

  test("an older failure cannot show an error on another scan's review", async () => {
    const older: Deferred<NetworkDeviceDiscoveryScan | null> = deferred();
    getItemSpy.mockReturnValueOnce(older.promise);
    getItemSpy.mockResolvedValueOnce(
      scan([host("10.0.0.2", false)], OTHER_SCAN_ID),
    );
    await renderPage();
    let opening: Promise<void> = Promise.resolve();
    await act(async () => {
      opening = reviewAction().onClick(scan([]), () => {});
    });
    await openReview(scan([], OTHER_SCAN_ID));
    await act(async () => {
      older.reject(new Error("Old request failed"));
      await opening;
    });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(checkbox("10.0.0.2")).toBeChecked();
    expect(next()).toBeEnabled();
  });
});
