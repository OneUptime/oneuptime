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
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import PermissionUtil from "../../../UI/Utils/Permission";
import { ComponentProps as ModalProps } from "../../../UI/Components/Modal/Modal";

// Keep the page's review, selection and import handlers real. The table mock
// exposes its actual row action; the modal mock removes animation and portals.
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

    // The inventory no longer contains the device; the page still remembers
    // importing it, but a successful new read supersedes that old record.
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
