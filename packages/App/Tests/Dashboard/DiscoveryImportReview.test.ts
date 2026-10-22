import { describe, expect, test } from "@jest/globals";
import NetworkDeviceDiscoveryScan, {
  DiscoveredNetworkDevice,
} from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import {
  DEFAULT_DISCOVERY_IMPORT_SETTINGS,
  DiscoveryImportAlerting,
  DiscoveryImportDeviceOutcome,
  DiscoveryImportHostResult,
  DiscoveryImportMonitorOutcome,
} from "Common/Types/NetworkDevice/DiscoveryImport";
import MonitorType from "Common/Types/Monitor/MonitorType";
import { MonitorTemplateAlertSummary } from "Common/Utils/Monitor/MonitorTemplateAlertSummary";
import {
  DiscoveredHostFilter,
  DiscoveredHostNameFilter,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveredHostFilter";
import {
  DiscoveryImportTemplateChoice,
  RECOMMENDED_TEMPLATE_CHOICE_VALUE,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveryImport/DiscoveryImportOutcome";
import {
  DEFAULT_DISCOVERY_REVIEW_QUERY,
  DISCOVERY_REVIEW_SCAN_SELECT,
  getImportedAddresses,
  getPickedTemplate,
  getReviewHosts,
  keepPickedTemplate,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveryImport/DiscoveryImportReview";

/*
 * What the import dialog reads before it sends anything: the scan's columns
 * (the row names and explanations read them), the hosts it lists (a scan
 * still waiting for its first report offers none), what an import put in the
 * inventory, and the template the settings pick.
 */

function scan(
  overrides: Partial<NetworkDeviceDiscoveryScan> = {},
): NetworkDeviceDiscoveryScan {
  return Object.assign(new NetworkDeviceDiscoveryScan(), {
    status: "Completed",
    discoveredDevices: [
      { ipAddress: "10.0.0.1", sysName: "core-sw-01", snmpReachable: true },
      { ipAddress: " 10.0.0.2 ", snmpReachable: false },
      {
        ipAddress: "10.0.0.3",
        snmpReachable: false,
        isAlreadyRegistered: true,
      },
    ],
    ...overrides,
  });
}

// A column that would carry the scan's SNMP credentials.
const CREDENTIAL_COLUMN: RegExp =
  /community|authkey|privkey|password|snmpconfigs/;

function addressesOf(hosts: Array<DiscoveredNetworkDevice>): Array<string> {
  return hosts.map((host: DiscoveredNetworkDevice): string => {
    return host.ipAddress;
  });
}

const SUMMARY: MonitorTemplateAlertSummary = {
  criteria: [],
  raisesIncidents: true,
  raisesAlerts: false,
  raisesIncidentsOnPingOnlyDevices: true,
  raisesAlertsOnPingOnlyDevices: false,
};

const RECOMMENDED: DiscoveryImportTemplateChoice = {
  id: "",
  name: "Network device alert pack",
  monitorType: MonitorType.NetworkDevice,
  summary: SUMMARY,
  isCreatedOnImport: true,
};

const POS_TEMPLATE: DiscoveryImportTemplateChoice = {
  id: "9b2f4d6e-1a3c-4e5f-8a7b-0c1d2e3f4a5b",
  name: "POS ping availability",
  monitorType: MonitorType.NetworkDevice,
  summary: SUMMARY,
};

describe("the scan the dialog reads", () => {
  test("carries what the rows are named and explained by, and the hosts", () => {
    for (const column of [
      "_id",
      "status",
      "statusMessage",
      "discoveredDevices",
      "probeId",
      "isSnmpEnabled",
      "useShortDeviceNames",
      "isNetbiosLookupEnabled",
    ]) {
      expect({
        column,
        selected: DISCOVERY_REVIEW_SCAN_SELECT[column],
      }).toEqual({ column, selected: true });
    }
  });

  test("never asks for the scan's credentials: the server reads those itself", () => {
    for (const column of Object.keys(DISCOVERY_REVIEW_SCAN_SELECT)) {
      expect(column.toLowerCase()).not.toMatch(CREDENTIAL_COLUMN);
    }
  });

  test("starts on every host, in every facet, with nothing searched or hidden", () => {
    expect(DEFAULT_DISCOVERY_REVIEW_QUERY).toEqual({
      answered: DiscoveredHostFilter.All,
      name: DiscoveredHostNameFilter.Any,
      search: "",
      hideAlreadyAdded: false,
    });
  });
});

describe("the hosts it lists", () => {
  test("the probe's hosts, normalised, in the scan's order", () => {
    expect(
      addressesOf(
        getReviewHosts({ scan: scan(), importedAddresses: new Set<string>() }),
      ),
    ).toEqual(["10.0.0.1", "10.0.0.2", "10.0.0.3"]);
  });

  test("an import's addresses read as already added at once", () => {
    const hosts: Array<DiscoveredNetworkDevice> = getReviewHosts({
      scan: scan(),
      importedAddresses: new Set<string>(["10.0.0.2"]),
    });

    expect(
      hosts.map((host: DiscoveredNetworkDevice) => {
        return [host.ipAddress, Boolean(host.isAlreadyRegistered)];
      }),
    ).toEqual([
      ["10.0.0.1", false],
      ["10.0.0.2", true],
      ["10.0.0.3", true],
    ]);
  });

  test("none before the scan is read, while it is queued, or while it waits for its first report", () => {
    expect(
      getReviewHosts({ scan: null, importedAddresses: new Set<string>() }),
    ).toEqual([]);
    expect(
      getReviewHosts({
        scan: scan({ status: "Pending" }),
        importedAddresses: new Set<string>(),
      }),
    ).toEqual([]);
    expect(
      getReviewHosts({
        scan: scan({
          status: "In Progress",
          statusMessage: "Scan started. Waiting for the first progress update.",
        }),
        importedAddresses: new Set<string>(),
      }),
    ).toEqual([]);
  });

  test("a running scan's hosts found so far, and a failed scan's partial results", () => {
    expect(
      getReviewHosts({
        scan: scan({ status: "In Progress", statusMessage: "Sweeping." }),
        importedAddresses: new Set<string>(),
      }),
    ).toHaveLength(3);
    expect(
      getReviewHosts({
        scan: scan({ status: "Failed" }),
        importedAddresses: new Set<string>(),
      }),
    ).toHaveLength(3);
  });
});

describe("what an import put in the inventory", () => {
  test("the devices it created and the ones it found there, not the ones that failed", () => {
    const results: Array<DiscoveryImportHostResult> = [
      {
        ipAddress: "10.0.0.1",
        name: "a",
        isPingOnly: false,
        device: DiscoveryImportDeviceOutcome.Created,
        monitor: DiscoveryImportMonitorOutcome.Failed,
      },
      {
        ipAddress: "10.0.0.2",
        name: "b",
        isPingOnly: true,
        device: DiscoveryImportDeviceOutcome.AlreadyAdded,
        monitor: DiscoveryImportMonitorOutcome.NotRequested,
      },
      {
        ipAddress: "10.0.0.3",
        name: "c",
        isPingOnly: true,
        device: DiscoveryImportDeviceOutcome.Failed,
        monitor: DiscoveryImportMonitorOutcome.Skipped,
      },
      {
        ipAddress: "10.0.0.4",
        name: "d",
        isPingOnly: true,
        device: DiscoveryImportDeviceOutcome.NotReached,
        monitor: DiscoveryImportMonitorOutcome.Skipped,
      },
    ];

    expect(getImportedAddresses(results)).toEqual(["10.0.0.1", "10.0.0.2"]);
    expect(getImportedAddresses(undefined)).toEqual([]);
  });
});

describe("the template the settings pick", () => {
  test("none when the import makes no monitors", () => {
    expect(
      getPickedTemplate({
        settings: {
          ...DEFAULT_DISCOVERY_IMPORT_SETTINGS,
          monitorTemplateId: POS_TEMPLATE.id,
        },
        templates: [RECOMMENDED, POS_TEMPLATE],
      }),
    ).toBeNull();
  });

  test("the one its id names, or the recommended one Import would create", () => {
    const monitors: typeof DEFAULT_DISCOVERY_IMPORT_SETTINGS = {
      ...DEFAULT_DISCOVERY_IMPORT_SETTINGS,
      alerting: DiscoveryImportAlerting.MonitorTemplate,
    };

    expect(
      getPickedTemplate({
        settings: { ...monitors, monitorTemplateId: POS_TEMPLATE.id },
        templates: [RECOMMENDED, POS_TEMPLATE],
      }),
    ).toBe(POS_TEMPLATE);
    expect(
      getPickedTemplate({
        settings: {
          ...monitors,
          monitorTemplateId: RECOMMENDED_TEMPLATE_CHOICE_VALUE,
        },
        templates: [RECOMMENDED, POS_TEMPLATE],
      }),
    ).toBe(RECOMMENDED);
  });

  test("none when the template it names is not one of the choices", () => {
    expect(
      getPickedTemplate({
        settings: {
          ...DEFAULT_DISCOVERY_IMPORT_SETTINGS,
          alerting: DiscoveryImportAlerting.MonitorTemplate,
          monitorTemplateId: "0e0e0e0e-0e0e-4e0e-8e0e-0e0e0e0e0e0e",
        },
        templates: [RECOMMENDED, POS_TEMPLATE],
      }),
    ).toBeNull();
    expect(
      getPickedTemplate({
        settings: {
          ...DEFAULT_DISCOVERY_IMPORT_SETTINGS,
          alerting: DiscoveryImportAlerting.MonitorTemplate,
        },
        templates: [POS_TEMPLATE],
      }),
    ).toBeNull();
  });
});

/*
 * The templates are read when the step opens, and again each time the
 * reader comes back to the dialog's window (issue #5145: "Manage templates"
 * opens the templates in a new tab). What stays picked:
 */
describe("the pick, once the templates are read again", () => {
  const KDS: DiscoveryImportTemplateChoice = {
    id: "1c3e5a7b-2d4f-4a6b-8c9d-0e1f2a3b4c5d",
    name: "WB KDS Ping Monitor Template",
    monitorType: MonitorType.Ping,
    summary: SUMMARY,
  };
  const SAVED_RECOMMENDED: DiscoveryImportTemplateChoice = {
    id: "2d4f6a8b-3e5a-4b7c-9d0e-1f2a3b4c5d6e",
    name: "Network device alert pack",
    monitorType: MonitorType.NetworkDevice,
    summary: SUMMARY,
  };
  const MONITORS: typeof DEFAULT_DISCOVERY_IMPORT_SETTINGS = {
    ...DEFAULT_DISCOVERY_IMPORT_SETTINGS,
    alerting: DiscoveryImportAlerting.MonitorTemplate,
  };

  test("the template picked stays picked while it is listed - the very settings, unchanged", () => {
    const settings: typeof DEFAULT_DISCOVERY_IMPORT_SETTINGS = {
      ...MONITORS,
      monitorTemplateId: KDS.id,
    };

    expect(
      keepPickedTemplate({
        settings: settings,
        templates: [RECOMMENDED, POS_TEMPLATE, KDS],
      }),
    ).toBe(settings);
  });

  test("nothing picked yet: the first template, the recommended one, is", () => {
    expect(
      keepPickedTemplate({
        settings: DEFAULT_DISCOVERY_IMPORT_SETTINGS,
        templates: [RECOMMENDED, KDS],
      }),
    ).toEqual({
      ...DEFAULT_DISCOVERY_IMPORT_SETTINGS,
      monitorTemplateId: RECOMMENDED_TEMPLATE_CHOICE_VALUE,
    });
  });

  test("a template deleted meanwhile gives way to the first", () => {
    expect(
      keepPickedTemplate({
        settings: { ...MONITORS, monitorTemplateId: KDS.id },
        templates: [RECOMMENDED, POS_TEMPLATE],
      }),
    ).toEqual({
      ...MONITORS,
      monitorTemplateId: RECOMMENDED_TEMPLATE_CHOICE_VALUE,
    });
  });

  test("the recommended one, made meanwhile, is picked as itself", () => {
    expect(
      keepPickedTemplate({
        settings: {
          ...MONITORS,
          monitorTemplateId: RECOMMENDED_TEMPLATE_CHOICE_VALUE,
        },
        templates: [SAVED_RECOMMENDED, KDS],
      }),
    ).toEqual({ ...MONITORS, monitorTemplateId: SAVED_RECOMMENDED.id });
  });

  test("with no template left, nothing is picked and the import makes no monitors", () => {
    expect(
      keepPickedTemplate({
        settings: { ...MONITORS, monitorTemplateId: KDS.id },
        templates: [],
      }),
    ).toEqual({
      ...MONITORS,
      alerting: DiscoveryImportAlerting.None,
      monitorTemplateId: undefined,
    });

    // Settings that already ask for nothing are handed back as they are.
    expect(
      keepPickedTemplate({
        settings: DEFAULT_DISCOVERY_IMPORT_SETTINGS,
        templates: [],
      }),
    ).toBe(DEFAULT_DISCOVERY_IMPORT_SETTINGS);
  });

  test("the interval and vendor template switch are never touched", () => {
    const settings: typeof DEFAULT_DISCOVERY_IMPORT_SETTINGS = {
      ...MONITORS,
      pollingIntervalInMinutes: 1,
      applyVendorTemplates: false,
      monitorTemplateId: "0e0e0e0e-0e0e-4e0e-8e0e-0e0e0e0e0e0e",
    };

    expect(
      keepPickedTemplate({ settings: settings, templates: [KDS] }),
    ).toEqual({ ...settings, monitorTemplateId: KDS.id });
  });
});
