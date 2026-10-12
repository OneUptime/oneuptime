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
 * The discovery import's "Apply each SNMP host's vendor template" toggle -
 * the other half of the customer's first ask. "When we discover 30+ Cambium
 * switches, we currently need to open every single device ... and manually
 * assign the correct vendor template": that was because an import made by
 * hand left the vendor-template auto-apply off, so every device sat with an
 * empty health list and a banner recommending the template. An auto import
 * rule always turned it on; the Review dialog now does too, unless the
 * operator turns it off for the batch.
 *
 * What has to hold:
 *
 *   - the toggle is shown when the review has importable SNMP hosts, counts
 *     them, and starts on;
 *   - importing with it on turns the auto-apply on for every SNMP host - and
 *     never for a ping-only one, which has nothing to match a template by;
 *   - turning it off leaves the import exactly as it was before the toggle;
 *   - like the Ping-monitor option, it is per dialog: the next review starts
 *     on again, whatever the last one was left at.
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
    ModalWidth: { Medium: 1 },
    default: (props: ModalProps) => {
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
const PROBE_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");

const TOGGLE_TEST_ID: string = "discovered-device-apply-vendor-templates";

let getItemSpy: jest.SpyInstance;
let createSpy: jest.SpyInstance;

function snmpHost(
  ipAddress: string,
  isAlreadyRegistered: boolean = false,
): DiscoveredNetworkDevice {
  return {
    ipAddress,
    isAlreadyRegistered,
    snmpReachable: true,
    sysName: `cnmatrix-${ipAddress.split(".").pop()}`,
    sysObjectId: "1.3.6.1.4.1.17713.24.1.2",
  } as DiscoveredNetworkDevice;
}

function pingHost(ipAddress: string): DiscoveredNetworkDevice {
  return { ipAddress, isAlreadyRegistered: false, snmpReachable: false };
}

function scan(
  hosts: Array<DiscoveredNetworkDevice>,
): NetworkDeviceDiscoveryScan {
  const value: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan();
  value.id = SCAN_ID;
  value.projectId = PROJECT_ID;
  value.probeId = PROBE_ID;
  value.name = "Customer B - Building A";
  value.cidr = "10.20.0.0/24";
  value.status = "Completed";
  value.isSnmpEnabled = true;
  value.snmpVersion = "2c";
  value.snmpCommunityString = "public";
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

async function openReview(value: NetworkDeviceDiscoveryScan): Promise<void> {
  getItemSpy.mockResolvedValue(value);

  const action: TableProps["actionButtons"][number] | undefined =
    capturedTable?.actionButtons.find(
      (button: TableProps["actionButtons"][number]) => {
        return button.title === "Review Results";
      },
    );

  if (!action) {
    throw new Error("Review Results action was not rendered");
  }

  await act(async () => {
    await action.onClick(value, () => {});
  });
}

// The switch itself: its title is its accessible name, its description its description.
function toggle(): HTMLElement {
  return screen.getByTestId(TOGGLE_TEST_ID);
}

async function importSelected(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: /Import Selected/ }));
  await waitFor(() => {
    expect(createSpy).toHaveBeenCalled();
  });
  await waitFor(() => {
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
}

function createdDevices(): Array<NetworkDevice> {
  return createSpy.mock.calls.map((call: Array<any>): NetworkDevice => {
    return call[0].model;
  });
}

function createdByHostname(hostname: string): NetworkDevice {
  const device: NetworkDevice | undefined = createdDevices().find(
    (candidate: NetworkDevice): boolean => {
      return candidate.hostname === hostname;
    },
  );

  if (!device) {
    throw new Error(`No device was created for ${hostname}.`);
  }

  return device;
}

beforeEach(() => {
  capturedTable = null;
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

describe("Discovery import: each SNMP host's vendor template", () => {
  test("is offered for the importable SNMP hosts, counted, and starts on", async () => {
    await renderPage();
    await openReview(
      scan([
        snmpHost("10.20.0.1"),
        snmpHost("10.20.0.2"),
        snmpHost("10.20.0.3", true),
        pingHost("10.20.0.9"),
      ]),
    );

    // Two importable SNMP hosts: the registered one and the ping-only one do not count.
    expect(toggle()).toHaveAttribute("role", "switch");
    expect(toggle()).toHaveAccessibleName(
      "Apply each SNMP host's vendor template on its first poll (recommended) — 2 hosts",
    );
    expect(toggle()).toHaveAttribute("aria-checked", "true");
  });

  test("says what it does, and that anything applied can be changed", async () => {
    await renderPage();
    await openReview(scan([snmpHost("10.20.0.1")]));

    expect(toggle()).toHaveAccessibleName(
      "Apply each SNMP host's vendor template on its first poll (recommended) — 1 host",
    );
    expect(toggle()).toHaveAccessibleDescription(/as auto import rules do/);
    expect(toggle()).toHaveAccessibleDescription(/device's Settings/);
  });

  test("is not offered when the review has no SNMP host to import", async () => {
    await renderPage();
    await openReview(
      scan([pingHost("10.20.0.8"), snmpHost("10.20.0.3", true)]),
    );

    expect(screen.queryByTestId(TOGGLE_TEST_ID)).toBeNull();
  });

  test("on: every SNMP host imports with the vendor template auto-apply on, a ping-only host never", async () => {
    await renderPage();
    await openReview(
      scan([
        snmpHost("10.20.0.1"),
        snmpHost("10.20.0.2"),
        pingHost("10.20.0.9"),
      ]),
    );

    await importSelected();

    expect(createdDevices()).toHaveLength(3);
    expect(createdByHostname("10.20.0.1").autoApplyVendorHealthTemplate).toBe(
      true,
    );
    expect(createdByHostname("10.20.0.2").autoApplyVendorHealthTemplate).toBe(
      true,
    );
    expect(
      createdByHostname("10.20.0.9").autoApplyVendorHealthTemplate,
    ).toBeFalsy();
  });

  test("off: the import is exactly what it was before the toggle", async () => {
    await renderPage();
    await openReview(scan([snmpHost("10.20.0.1"), snmpHost("10.20.0.2")]));

    fireEvent.click(toggle());

    await waitFor(() => {
      expect(toggle()).toHaveAttribute("aria-checked", "false");
    });

    await importSelected();

    for (const device of createdDevices()) {
      expect(device.autoApplyVendorHealthTemplate).toBeFalsy();
    }
  });

  test("is per dialog: the next review starts on again", async () => {
    await renderPage();
    await openReview(scan([snmpHost("10.20.0.1")]));

    fireEvent.click(toggle());

    await waitFor(() => {
      expect(toggle()).toHaveAttribute("aria-checked", "false");
    });

    fireEvent.click(screen.getByRole("button", { name: "Close review" }));

    await openReview(scan([snmpHost("10.20.0.1")]));

    expect(toggle()).toHaveAttribute("aria-checked", "true");
  });
});
