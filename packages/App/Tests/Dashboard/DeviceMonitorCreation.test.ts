import { describe, expect, test } from "@jest/globals";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import MonitorType from "Common/Types/Monitor/MonitorType";
import {
  DiscoveryImportAlerting,
  DiscoveryImportSource,
  DiscoveryImportStatus,
  DiscoveryImportView,
  MAX_DEVICES_PER_MONITOR_CREATION,
  emptyDiscoveryImportProgress,
} from "Common/Types/NetworkDevice/DiscoveryImport";
import NetworkDeviceMonitoringMethod from "Common/Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import ObjectID from "Common/Types/ObjectID";
import { Translator, createTranslator } from "Common/Types/Translator";
import {
  DropdownOption,
  DropdownOptionGroup,
} from "Common/UI/Components/Dropdown/Dropdown";
import { MonitorTemplateAlertSummary } from "Common/Utils/Monitor/MonitorTemplateAlertSummary";
import {
  CREATE_MONITORS_ACTION_TITLE,
  NO_DEVICES_SELECTED,
  PICK_A_TEMPLATE,
  countMonitorBackedDevices,
  findTemplateChoice,
  getDefaultTemplateValue,
  getDeviceMonitorCreationBlocker,
  getSelectedDeviceIds,
  getTemplateOptions,
  readsDevicePolls,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceMonitorCreation/DeviceMonitorCreationModel";
import {
  getActiveDeviceMonitorCreations,
  getActiveDiscoveredDeviceImports,
  indexActiveImportsByScan,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveryImport/DiscoveryImportActive";
import { DiscoveryImportTemplateChoice } from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveryImport/DiscoveryImportOutcome";
import {
  ADDRESS_TEMPLATES_GROUP_TITLE,
  POLL_TEMPLATES_GROUP_TITLE,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveryImport/DiscoveryImportTemplateCopy";

/*
 * CREATE MONITORS ON THE DEVICES LIST (OneUptime issue #10990).
 *
 * The rules the dialog decides before anything is sent - which devices,
 * whether it can start, which template it starts on and how the templates
 * are listed - and which running imports the Devices list, the Discovered
 * Devices list and the scans each own.
 */

const ENGLISH: Translator = createTranslator((): string | undefined => {
  return undefined;
}, "en");

const SUMMARY: MonitorTemplateAlertSummary = {
  criteria: [],
  raisesIncidents: false,
  raisesAlerts: false,
  raisesIncidentsOnPingOnlyDevices: false,
  raisesAlertsOnPingOnlyDevices: false,
};

function device(data: {
  id: string;
  name?: string;
  monitoringMethod?: NetworkDeviceMonitoringMethod;
}): NetworkDevice {
  const item: NetworkDevice = new NetworkDevice();
  item._id = data.id;
  item.name = data.name || data.id;
  item.monitoringMethod =
    data.monitoringMethod || NetworkDeviceMonitoringMethod.Probe;
  return item;
}

function choice(
  overrides: Partial<DiscoveryImportTemplateChoice>,
): DiscoveryImportTemplateChoice {
  return {
    id: ObjectID.generate().toString(),
    name: "Enterprise Switch Monitoring",
    monitorType: MonitorType.NetworkDevice,
    summary: SUMMARY,
    ...overrides,
  };
}

function view(overrides: Partial<DiscoveryImportView>): DiscoveryImportView {
  return {
    id: ObjectID.generate().toString(),
    scanId: "",
    source: DiscoveryImportSource.Scan,
    status: DiscoveryImportStatus.Running,
    settings: {
      pollingIntervalInMinutes: 5,
      applyVendorTemplates: false,
      alerting: DiscoveryImportAlerting.MonitorTemplate,
    },
    progress: emptyDiscoveryImportProgress(),
    createdAt: "2026-11-26T09:00:00.000Z",
    isMine: true,
    ...overrides,
  };
}

const A: string = "aa100000-0000-4000-8000-000000000001";
const B: string = "aa100000-0000-4000-8000-000000000002";

describe("the devices Create Monitors is for", () => {
  test("are the selection's ids, each once, in the order selected", () => {
    expect(
      getSelectedDeviceIds([
        device({ id: B }),
        device({ id: A }),
        device({ id: B.toUpperCase() }),
      ]),
    ).toEqual([B, A]);
  });

  test("leave out a row with no id", () => {
    const unsaved: NetworkDevice = new NetworkDevice();

    expect(getSelectedDeviceIds([unsaved, device({ id: A })])).toEqual([A]);
  });

  test("count the ones that take their status from a bound monitor", () => {
    expect(
      countMonitorBackedDevices([
        device({ id: A }),
        device({
          id: B,
          monitoringMethod: NetworkDeviceMonitoringMethod.Monitor,
        }),
      ]),
    ).toBe(1);
  });

  test("the action is called Create Monitors", () => {
    expect(CREATE_MONITORS_ACTION_TITLE).toBe("Create Monitors");
  });
});

describe("whether Create Monitors can start", () => {
  test("it cannot with no devices", () => {
    expect(
      getDeviceMonitorCreationBlocker({ deviceCount: 0, template: choice({}) }),
    ).toBe(NO_DEVICES_SELECTED);
  });

  test("it cannot with more devices than one run gives monitors to, and says how to go on", () => {
    const blocker: string | null = getDeviceMonitorCreationBlocker({
      deviceCount: MAX_DEVICES_PER_MONITOR_CREATION + 1,
      template: choice({}),
    });

    expect(blocker).toContain("up to 5,000 devices at a time");
    expect(blocker).toContain("by site, role or label");
    expect(
      getDeviceMonitorCreationBlocker({
        deviceCount: MAX_DEVICES_PER_MONITOR_CREATION,
        template: choice({}),
      }),
    ).toBeNull();
  });

  test("the limit it states is the server's", () => {
    expect(MAX_DEVICES_PER_MONITOR_CREATION).toBe(5000);
  });

  test("it cannot without a template", () => {
    expect(
      getDeviceMonitorCreationBlocker({ deviceCount: 3, template: null }),
    ).toBe(PICK_A_TEMPLATE);
  });

  test("it cannot with a template no device's monitor can be made from, and says why", () => {
    expect(
      getDeviceMonitorCreationBlocker({
        deviceCount: 3,
        template: choice({
          monitorType: MonitorType.Website,
          unusableReason: "The template's URL has no host.",
        }),
      }),
    ).toBe("The template's URL has no host.");
  });

  test("it can with devices and a template", () => {
    expect(
      getDeviceMonitorCreationBlocker({
        deviceCount: 3033,
        template: choice({}),
      }),
    ).toBeNull();
  });
});

describe("the templates it offers", () => {
  test("one kind alone is one list, no headings", () => {
    const options: Array<DropdownOption | DropdownOptionGroup> =
      getTemplateOptions(ENGLISH, [
        choice({ name: "Core switches" }),
        choice({ name: "Access switches" }),
      ]);

    expect(
      options.map((option: DropdownOption | DropdownOptionGroup): string => {
        return option.label;
      }),
    ).toEqual(["Core switches", "Access switches"]);
  });

  test("two kinds are told apart under the import's headings, polls first", () => {
    const options: Array<DropdownOption | DropdownOptionGroup> =
      getTemplateOptions(ENGLISH, [
        choice({ name: "Ping the switch", monitorType: MonitorType.Ping }),
        choice({ name: "Switch health" }),
      ]);

    expect(
      options.map((option: DropdownOption | DropdownOptionGroup): string => {
        return option.label;
      }),
    ).toEqual([POLL_TEMPLATES_GROUP_TITLE, ADDRESS_TEMPLATES_GROUP_TITLE]);
    expect((options[0] as DropdownOptionGroup).options[0]!.label).toBe(
      "Switch health",
    );
  });

  test("names are drawn as written, and the recommended one says it is created when you start", () => {
    const options: Array<DropdownOption | DropdownOptionGroup> =
      getTemplateOptions(ENGLISH, [
        choice({ id: "", name: "Network device", isCreatedOnImport: true }),
      ]);
    const option: DropdownOption = options[0] as DropdownOption;

    expect(option.label).toBe("Network device - created when you start");
    expect(option.isUserContent).toBe(true);
  });

  test("it starts on the first listed - the recommended one when there is one", () => {
    const recommended: DiscoveryImportTemplateChoice = choice({
      id: "",
      isCreatedOnImport: true,
    });
    const other: DiscoveryImportTemplateChoice = choice({});

    expect(getDefaultTemplateValue([recommended, other])).toBe("recommended");
    expect(getDefaultTemplateValue([other])).toBe(other.id);
    expect(getDefaultTemplateValue([])).toBe("");
  });

  test("a picked value finds its template", () => {
    const picked: DiscoveryImportTemplateChoice = choice({});

    expect(findTemplateChoice([choice({}), picked], picked.id)).toBe(picked);
    expect(findTemplateChoice([picked], "gone")).toBeNull();
  });

  test("only a Network Device template's monitors read the devices' polls", () => {
    expect(readsDevicePolls(choice({}))).toBe(true);
    expect(readsDevicePolls(choice({ monitorType: MonitorType.Ping }))).toBe(
      false,
    );
    expect(readsDevicePolls(null)).toBe(false);
  });
});

describe("whose running imports are whose", () => {
  const scanImport: DiscoveryImportView = view({
    scanId: "cc000000-0000-4000-8000-000000000001",
  });
  const listImport: DiscoveryImportView = view({
    source: DiscoveryImportSource.DiscoveredDevices,
  });
  const createMonitors: DiscoveryImportView = view({
    source: DiscoveryImportSource.Devices,
  });
  const finished: DiscoveryImportView = view({
    source: DiscoveryImportSource.Devices,
    status: DiscoveryImportStatus.Completed,
  });

  test("the Discovered Devices list owns its own imports, never Create Monitors'", () => {
    expect(
      getActiveDiscoveredDeviceImports([
        scanImport,
        listImport,
        createMonitors,
      ]),
    ).toEqual([listImport]);
  });

  test("the Devices list owns the runs of Create Monitors still going", () => {
    expect(
      getActiveDeviceMonitorCreations([
        scanImport,
        listImport,
        createMonitors,
        finished,
      ]),
    ).toEqual([createMonitors]);
  });

  test("a scan's row owns only its scan's import", () => {
    const byScan: Map<string, DiscoveryImportView> = indexActiveImportsByScan([
      scanImport,
      listImport,
      createMonitors,
    ]);

    expect(Array.from(byScan.values())).toEqual([scanImport]);
  });
});
