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
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import Project from "../../../Models/DatabaseModels/Project";
import ObjectID from "../../../Types/ObjectID";
import Route from "../../../Types/API/Route";
import Permission from "../../../Types/Permission";
import { VoidFunction } from "../../../Types/FunctionTypes";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import PermissionUtil from "../../../UI/Utils/Permission";
import { ComponentProps as ModalProps } from "../../../UI/Components/Modal/Modal";

/*
 * Keep the page's review, selection and import handlers real. The table mock
 * exposes its actual row action; the modal mock removes animation and portals.
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
let capturedModal: ModalProps | null = null;

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
    ModalWidth: { Medium: 1 },
    default: (props: ModalProps) => {
      capturedModal = props;
      return (
        <div role="dialog" aria-label={props.title}>
          <p>{props.description}</p>
          {props.error && <p role="alert">{props.error}</p>}
          {props.isBodyLoading ? <p>Refreshing inventory</p> : props.children}
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
const SCAN_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const OTHER_SCAN_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const PROBE_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");

let getItemSpy: jest.SpyInstance;
let createSpy: jest.SpyInstance;

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
}

function checkbox(ipAddress: string): HTMLElement {
  return screen.getByTestId(`discovered-device-checkbox-${ipAddress}`);
}

function submit(): HTMLElement {
  return screen.getByRole("button", { name: /Import Selected/ });
}

async function importSelected(): Promise<void> {
  fireEvent.click(submit());
  await waitFor(() => {
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
}

beforeEach(() => {
  capturedTable = null;
  capturedModal = null;
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest.spyOn(ProbeUtil, "getAllProbes").mockResolvedValue([]);
  jest
    .spyOn(PermissionUtil, "getAllPermissions")
    .mockReturnValue([Permission.ProjectAdmin]);
  getItemSpy = jest.spyOn(ModelAPI, "getItem");
  createSpy = jest
    .spyOn(ModelAPI, "create")
    .mockResolvedValue(undefined as never);
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
    expect(submit()).toHaveTextContent("Import Selected (1)");

    await importSelected();

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(createSpy.mock.calls[0]![0].model.hostname).toBe("10.0.0.1");
    expect(createSpy.mock.calls[0]![0].modelType).toBe(NetworkDevice);
    expect(oldScan.discoveredDevices![0]!.isAlreadyRegistered).toBe(true);
  });

  test("requests the scan identity, current results, probe and all import credentials", async () => {
    const freshScan: NetworkDeviceDiscoveryScan = scan([
      { ...host("10.0.0.1", false), snmpReachable: true },
    ]);
    freshScan.snmpCommunityString = "refreshed-community";
    freshScan.snmpVersion = "2c";
    getItemSpy.mockResolvedValue(freshScan);
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
        snmpConfigs: true,
        snmpVersion: true,
        snmpCommunityString: true,
        snmpPort: true,
        snmpV3SecurityLevel: true,
        snmpV3Username: true,
        snmpV3AuthProtocol: true,
        snmpV3AuthKey: true,
        snmpV3PrivProtocol: true,
        snmpV3PrivKey: true,
      },
    });
    await importSelected();
    const device: NetworkDevice = createSpy.mock.calls[0]![0].model;
    expect(device.probeId?.toString()).toBe(PROBE_ID.toString());
    expect(device.snmpCommunityString).toBe("refreshed-community");
  });

  test("reopening on the same page allows reimport after deleting a device imported during this visit", async () => {
    const oldScan: NetworkDeviceDiscoveryScan = scan([host("10.0.0.1", false)]);
    getItemSpy.mockResolvedValue(scan([host("10.0.0.1", false)]));
    await renderPage();
    await openReview(oldScan);
    await importSelected();

    /*
     * The inventory no longer contains the device; the page still remembers
     * importing it, but a successful new read supersedes that old record.
     */
    await openReview(oldScan);
    expect(checkbox("10.0.0.1")).toBeEnabled();
    expect(checkbox("10.0.0.1")).toBeChecked();
    await importSelected();
    expect(createSpy).toHaveBeenCalledTimes(2);
    expect(getItemSpy).toHaveBeenCalledTimes(2);
  });

  test("reopening keeps an existing device disabled even when its monitor was removed", async () => {
    const oldScan: NetworkDeviceDiscoveryScan = scan([host("10.0.0.1", false)]);
    getItemSpy.mockResolvedValueOnce(oldScan);
    await renderPage();
    await openReview(oldScan);
    await importSelected();

    getItemSpy.mockResolvedValue(scan([host("10.0.0.1", true)]));
    await openReview(oldScan);

    expect(checkbox("10.0.0.1")).toBeDisabled();
    expect(screen.getByText("Already added")).toBeInTheDocument();
    expect(submit()).toBeDisabled();
    fireEvent.click(submit());
    expect(createSpy).toHaveBeenCalledTimes(1);
  });

  test("keeps a successful batch retired while allowing the failed host to be retried", async () => {
    getItemSpy.mockResolvedValue(
      scan([host("10.0.0.1", false), host("10.0.0.2", false)]),
    );
    createSpy
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("Device creation failed"))
      .mockRejectedValueOnce(new Error("Device creation failed"));
    await renderPage();
    await openReview(scan([]));
    fireEvent.click(submit());
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Device creation failed",
      );
    });

    expect(checkbox("10.0.0.1")).toBeDisabled();
    expect(checkbox("10.0.0.2")).toBeEnabled();
    expect(checkbox("10.0.0.2")).toBeChecked();
    expect(submit()).toHaveTextContent("Import Selected (1)");
    await importSelected();
    expect(createSpy).toHaveBeenCalledTimes(4);
    expect(createSpy.mock.calls[3]![0].model.hostname).toBe("10.0.0.2");
  });
});

/*
 * OneUptime issue #3678, end to end through the page's real review and import
 * handlers: a scan set to short device names shows the short name, creates the
 * device under it, keeps the FQDN as the device's DNS name, and — on a name
 * collision — retries as "short (address)" rather than falling back to the
 * FQDN the scan was told not to use.
 */
describe("Discovery review names devices by the scan's short-name choice", () => {
  const FQDN: string = "core-gw.corp.example.com";

  // A ping-only host named only by its PTR record, like the reporter's.
  function namedHost(
    ipAddress: string,
    dnsHostname: string = FQDN,
  ): DiscoveredNetworkDevice {
    return { ...host(ipAddress, false), dnsHostname };
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

  test("a scan set to short names imports the short name and keeps the FQDN as the DNS name", async () => {
    getItemSpy.mockResolvedValue(scanNaming([namedHost("10.0.0.1")], true));
    await renderPage();
    await openReview(scanNaming([namedHost("10.0.0.1")], true));
    await importSelected();

    expect(createSpy).toHaveBeenCalledTimes(1);

    const device: NetworkDevice = createSpy.mock.calls[0]![0].model;

    expect(device.name).toBe("core-gw");
    expect(device.dnsName).toBe(FQDN);
    expect(device.hostname).toBe("10.0.0.1");
  });

  test("a scan that did not ask imports the full name, and still keeps the DNS name", async () => {
    for (const flag of [false, undefined]) {
      createSpy.mockClear();
      cleanup();
      capturedTable = null;
      getItemSpy.mockResolvedValue(scanNaming([namedHost("10.0.0.1")], flag));
      await renderPage();
      await openReview(scanNaming([namedHost("10.0.0.1")], flag));

      expect(checkbox("10.0.0.1")).toHaveAttribute(
        "aria-label",
        `Import ${FQDN} (10.0.0.1)`,
      );

      await importSelected();

      const device: NetworkDevice = createSpy.mock.calls[0]![0].model;

      expect(device.name).toBe(FQDN);
      expect(device.dnsName).toBe(FQDN);
    }
  });

  /*
   * The choice is read off the FRESH scan, not the table row the dialog was
   * opened from. The operator may have switched short names on in the Edit
   * dialog (or another tab) since the list loaded; the review is what they
   * are about to import, so it has to name hosts the way the scan says now.
   */
  test("the fresh read decides the naming, not the stale table row", async () => {
    getItemSpy.mockResolvedValue(scanNaming([namedHost("10.0.0.1")], true));
    await renderPage();
    await openReview(scanNaming([namedHost("10.0.0.1")], false));
    await importSelected();

    expect(createSpy.mock.calls[0]![0].model.name).toBe("core-gw");
  });

  test("a short name that is already taken is retried as the short name plus the address", async () => {
    /*
     * Short names collide more than FQDNs do — "core-gw" in two domains is one
     * name. The first create fails on the duplicate; the retry must build from
     * the same naming choice.
     */
    createSpy
      .mockRejectedValueOnce(
        new Error("Network Device with the same name already exists"),
      )
      .mockResolvedValueOnce(undefined);
    getItemSpy.mockResolvedValue(scanNaming([namedHost("10.0.0.1")], true));
    await renderPage();
    await openReview(scanNaming([namedHost("10.0.0.1")], true));
    await importSelected();

    expect(createSpy).toHaveBeenCalledTimes(2);

    /*
     * The page retries with the SAME device object, renamed — so both calls
     * hold it and both now read the final name. What distinguishes the retry
     * is that it happened, and what it was renamed to.
     */
    const device: NetworkDevice = createSpy.mock.calls[1]![0].model;

    expect(device.name).toBe("core-gw (10.0.0.1)");
    expect(device.dnsName).toBe(FQDN);
  });

  test("two hosts whose short names collide both import", async () => {
    const taken: Set<string> = new Set<string>();

    createSpy.mockImplementation(
      async (args: { model: NetworkDevice }): Promise<undefined> => {
        const name: string = String(args.model.name);

        if (taken.has(name)) {
          throw new Error("Network Device with the same name already exists");
        }

        taken.add(name);
        return undefined;
      },
    );

    const hosts: Array<DiscoveredNetworkDevice> = [
      namedHost("10.0.0.1", "web.corp.example.com"),
      namedHost("10.0.0.2", "web.lab.example.com"),
    ];

    getItemSpy.mockResolvedValue(scanNaming(hosts, true));
    await renderPage();
    await openReview(scanNaming(hosts, true));
    await importSelected();

    expect(Array.from(taken)).toEqual(["web", "web (10.0.0.2)"]);
  });
});

/*
 * OneUptime issue #3677, end to end through the page's real review and import
 * handlers: a host with no SNMP and no PTR record, which the probe named by
 * asking it over NetBIOS, is shown under that name with a plain "NetBIOS name"
 * hint beside its address, and imports under that name.
 *
 * The name is self-reported by the host, so it is never stored as the
 * device's DNS name — `dnsName` means "a record in DNS says so", and that is
 * the one thing a NetBIOS answer is not.
 */
describe("Discovery review names a host by its NetBIOS answer when nothing else names it", () => {
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
    expect(hint.getAttribute("title") || "").toContain(
      "reported this name itself",
    );
  });

  test("a host with only a NetBIOS name imports under it, with no DNS name", async () => {
    getItemSpy.mockResolvedValue(
      scan([netbiosHost("10.0.0.1", "accounts-pc01")]),
    );
    await renderPage();
    await openReview(scan([netbiosHost("10.0.0.1", "accounts-pc01")]));
    await importSelected();

    expect(createSpy).toHaveBeenCalledTimes(1);

    const device: NetworkDevice = createSpy.mock.calls[0]![0].model;

    expect(device.name).toBe("accounts-pc01");
    expect(device.hostname).toBe("10.0.0.1");
    expect(device.dnsName).toBeUndefined();
  });

  test("the short-name option imports a NetBIOS name unchanged", async () => {
    const value: NetworkDeviceDiscoveryScan = scan([
      netbiosHost("10.0.0.1", "accounts-pc01"),
    ]);
    value.useShortDeviceNames = true;
    getItemSpy.mockResolvedValue(value);
    await renderPage();
    await openReview(value);

    expect(screen.getByText(/NetBIOS name/)).toBeInTheDocument();

    await importSelected();

    const device: NetworkDevice = createSpy.mock.calls[0]![0].model;

    expect(device.name).toBe("accounts-pc01");
    expect(device.dnsName).toBeUndefined();
  });

  test("a host DNS names carries no NetBIOS hint, and imports under its DNS name", async () => {
    getItemSpy.mockResolvedValue(
      scan([
        {
          ...netbiosHost("10.0.0.1", "accounts-pc01"),
          dnsHostname: "core-gw.corp.example.com",
        },
      ]),
    );
    await renderPage();
    await openReview(scan([]));

    expect(screen.getByText("core-gw.corp.example.com")).toBeInTheDocument();
    expect(screen.queryByText(/NetBIOS name/)).not.toBeInTheDocument();

    await importSelected();

    const device: NetworkDevice = createSpy.mock.calls[0]![0].model;

    expect(device.name).toBe("core-gw.corp.example.com");
    expect(device.dnsName).toBe("core-gw.corp.example.com");
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

    await importSelected();

    expect(createSpy.mock.calls[0]![0].model.name).toBe("10.0.0.1");
  });
});

describe("Discovery review waits for a successful current response", () => {
  test("does not expose stale selection or import while the inventory read is pending", async () => {
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
    expect(submit()).toBeDisabled();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    await act(async () => {
      capturedModal?.onSubmit?.();
    });
    expect(createSpy).not.toHaveBeenCalled();

    await act(async () => {
      pending.resolve(scan([host("10.0.0.1", true)]));
      await opening;
    });
    expect(checkbox("10.0.0.1")).toBeDisabled();
  });

  test("a failed refresh cannot fall back to a stale importable row and can be retried by reopening", async () => {
    getItemSpy.mockRejectedValueOnce(new Error("Inventory refresh failed"));
    await renderPage();
    const oldScan: NetworkDeviceDiscoveryScan = scan([host("10.0.0.1", false)]);
    await openReview(oldScan);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Inventory refresh failed",
    );
    expect(submit()).toBeDisabled();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    await act(async () => {
      capturedModal?.onSubmit?.();
    });
    expect(createSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("Close review"));
    getItemSpy.mockResolvedValue(scan([host("10.0.0.1", false)]));
    await openReview(oldScan);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(checkbox("10.0.0.1")).toBeChecked();
    expect(submit()).toBeEnabled();
  });

  test("a scan deleted since the table loaded leaves import disabled", async () => {
    getItemSpy.mockResolvedValue(null);
    await renderPage();
    await openReview(scan([host("10.0.0.1", false)]));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "This discovery scan could not be found.",
    );
    expect(submit()).toBeDisabled();
    expect(createSpy).not.toHaveBeenCalled();
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

  test.each([false, true])(
    "an older response cannot replace a newer review (same scan: %s)",
    async (sameScan: boolean) => {
      const older: Deferred<NetworkDeviceDiscoveryScan | null> = deferred();
      getItemSpy.mockReturnValueOnce(older.promise);
      getItemSpy.mockResolvedValueOnce(
        scan([host("10.0.0.2", true)], sameScan ? SCAN_ID : OTHER_SCAN_ID),
      );
      await renderPage();
      let opening: Promise<void> = Promise.resolve();
      await act(async () => {
        opening = reviewAction().onClick(scan([]), () => {});
      });
      await openReview(scan([], sameScan ? SCAN_ID : OTHER_SCAN_ID));

      await act(async () => {
        older.resolve(scan([host("10.0.0.1", false)]));
        await opening;
      });

      expect(
        screen.queryByTestId("discovered-device-checkbox-10.0.0.1"),
      ).not.toBeInTheDocument();
      expect(checkbox("10.0.0.2")).toBeDisabled();
      expect(submit()).toBeDisabled();
    },
  );

  test("an older failure cannot show an error on the current review", async () => {
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
    expect(submit()).toBeEnabled();
  });

  test("an import finishing during a reopened review's read remains retired even if the read predates it", async () => {
    const importPending: Deferred<undefined> = deferred();
    const refreshPending: Deferred<NetworkDeviceDiscoveryScan | null> =
      deferred();
    const oldScan: NetworkDeviceDiscoveryScan = scan([host("10.0.0.1", false)]);
    getItemSpy
      .mockResolvedValueOnce(oldScan)
      .mockReturnValueOnce(refreshPending.promise);
    createSpy.mockReturnValueOnce(importPending.promise);
    await renderPage();
    await openReview(oldScan);
    fireEvent.click(submit());
    await waitFor(() => {
      expect(createSpy).toHaveBeenCalledTimes(1);
    });
    fireEvent.click(screen.getByText("Close review"));
    let opening: Promise<void> = Promise.resolve();
    await act(async () => {
      opening = reviewAction().onClick(oldScan, () => {});
    });

    await act(async () => {
      importPending.resolve(undefined);
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Refreshing inventory")).toBeInTheDocument();

    await act(async () => {
      refreshPending.resolve(scan([host("10.0.0.1", false)]));
      await opening;
    });
    expect(checkbox("10.0.0.1")).toBeDisabled();
    expect(submit()).toBeDisabled();
    expect(createSpy).toHaveBeenCalledTimes(1);
  });
});
