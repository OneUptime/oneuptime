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
import DiscoveryImportFakeServer from "./DiscoveryImportFakeServer";

/*
 * The discovery import's "Apply each SNMP host's vendor template" toggle -
 * the other half of the customer's first ask. "When we discover 30+ Cambium
 * switches, we currently need to open every single device ... and manually
 * assign the correct vendor template": that was because an import made by
 * hand left the vendor-template auto-apply off, so every device sat with an
 * empty health list and a banner recommending the template. An auto import
 * rule always turned it on; the import dialog does too, unless the operator
 * turns it off for the batch.
 *
 * Since the import moved to the server (issue #4812) the toggle sits on the
 * import's monitoring step, and what it decides travels with the import as
 * `applyVendorTemplates` - which the server applies to every SNMP device and
 * never to a ping-only one, which has nothing to match a template by
 * (DiscoveryImportRunner.test.ts: "vendor templates go to the SNMP devices
 * only, when asked for"). What has to hold here:
 *
 *   - the toggle is shown when the hosts being imported include SNMP ones,
 *     counts them, and starts on;
 *   - the import is asked for with it on, or - turned off - without it;
 *   - it is per dialog: the next review starts on again, whatever the last
 *     one was left at.
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

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SCAN_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const PROBE_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");

const TOGGLE_TEST_ID: string = "discovered-device-apply-vendor-templates";
const IMPORT_BUTTON: RegExp = /^Import \d+ devices?$/;

let getItemSpy: jest.SpyInstance;
let server: DiscoveryImportFakeServer;

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
  value._id = SCAN_ID.toString();
  value.projectId = PROJECT_ID;
  value.probeId = PROBE_ID;
  value.name = "Customer B - Building A";
  value.cidr = "10.20.0.0/24";
  value.status = "Completed";
  value.isSnmpEnabled = true;
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

// Review Results, then on to the monitoring step, where the toggle is.
async function openMonitoringStep(
  value: NetworkDeviceDiscoveryScan,
): Promise<void> {
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

  await waitFor(() => {
    expect(screen.getByTestId("discovery-import-next")).toBeEnabled();
  });

  fireEvent.click(screen.getByTestId("discovery-import-next"));

  await waitFor(() => {
    expect(
      screen.getByTestId("discovery-import-monitoring-step"),
    ).toBeInTheDocument();
  });
}

// The switch itself: its title is its accessible name, its description its description.
function toggle(): HTMLElement {
  return screen.getByTestId(TOGGLE_TEST_ID);
}

// The import's own submit: pressable once the step has read the project.
async function importDevices(): Promise<JSONObject> {
  const submit: HTMLElement = screen.getByRole("button", {
    name: IMPORT_BUTTON,
  });

  await waitFor(() => {
    expect(submit).toBeEnabled();
  });

  fireEvent.click(submit);

  await waitFor(() => {
    expect(server.startBodies.length).toBeGreaterThan(0);
  });

  return server.startBodies[server.startBodies.length - 1]!;
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

describe("Discovery import: each SNMP host's vendor template", () => {
  test("is offered for the SNMP hosts being imported, counted, and starts on", async () => {
    await renderPage();
    await openMonitoringStep(
      scan([
        snmpHost("10.20.0.11"),
        snmpHost("10.20.0.12"),
        snmpHost("10.20.0.13", true),
        pingHost("10.20.0.50"),
      ]),
    );

    // Two SNMP hosts to import: the one already added is not counted.
    expect(toggle()).toHaveAccessibleName(
      "Apply each SNMP host's vendor template on its first poll (recommended) — 2 hosts",
    );
    expect(toggle()).toHaveAttribute("aria-checked", "true");
  });

  test("says what it does, and that anything applied can be changed", async () => {
    await renderPage();
    await openMonitoringStep(scan([snmpHost("10.20.0.11")]));

    expect(toggle()).toHaveAccessibleDescription(
      "Each device gets the health OIDs and SNMP tables for its vendor — CPU, memory, temperature, fans — as auto import rules do. A device whose vendor has no template is left as it is, and anything applied can be changed on the device's Settings.",
    );
  });

  test("is not offered when no host being imported answered SNMP", async () => {
    await renderPage();
    await openMonitoringStep(
      scan([snmpHost("10.20.0.11", true), pingHost("10.20.0.50")]),
    );

    expect(screen.queryByTestId(TOGGLE_TEST_ID)).not.toBeInTheDocument();
  });

  test("on: the import is asked for with every SNMP host's vendor template", async () => {
    await renderPage();
    await openMonitoringStep(
      scan([
        snmpHost("10.20.0.11"),
        snmpHost("10.20.0.12"),
        pingHost("10.20.0.50"),
      ]),
    );

    const body: JSONObject = await importDevices();

    expect(body["ipAddresses"]).toEqual([
      "10.20.0.11",
      "10.20.0.12",
      "10.20.0.50",
    ]);
    expect((body["settings"] as JSONObject)["applyVendorTemplates"]).toBe(true);
  });

  test("off: the import is asked for without them", async () => {
    await renderPage();
    await openMonitoringStep(scan([snmpHost("10.20.0.11")]));

    fireEvent.click(toggle());

    expect(toggle()).toHaveAttribute("aria-checked", "false");

    const body: JSONObject = await importDevices();

    expect((body["settings"] as JSONObject)["applyVendorTemplates"]).toBe(
      false,
    );
  });

  test("is per dialog: the next review starts on again", async () => {
    await renderPage();
    await openMonitoringStep(scan([snmpHost("10.20.0.11")]));

    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute("aria-checked", "false");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(
        screen.queryByTestId("discovery-import-dialog"),
      ).not.toBeInTheDocument();
    });

    await openMonitoringStep(scan([snmpHost("10.20.0.11")]));

    expect(toggle()).toHaveAttribute("aria-checked", "true");
  });
});
