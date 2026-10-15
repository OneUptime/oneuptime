import { describe, expect, test } from "@jest/globals";
import { DiscoveredNetworkDevice } from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import {
  DEFAULT_DISCOVERY_IMPORT_SETTINGS,
  DISCOVERY_IMPORT_POLLING_INTERVALS_IN_MINUTES,
  DiscoveryImportAlerting,
  DiscoveryImportSettings,
} from "Common/Types/NetworkDevice/DiscoveryImport";
import { MonitorTemplateAlertSummary } from "Common/Utils/Monitor/MonitorTemplateAlertSummary";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import {
  DiscoveryImportAlertReach,
  DiscoveryImportOutcome,
  DiscoveryImportPolicyFact,
  DiscoveryImportTemplateChoice,
  RECOMMENDED_TEMPLATE_CHOICE_VALUE,
  countPingOnlyHosts,
  getDiscoveryImportBlocker,
  getDiscoveryImportOutcome,
  getTemplateChoiceValue,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveryImport/DiscoveryImportOutcome";
import {
  POLLING_INTERVAL_LABELS,
  getPollingIntervalLabel,
  getPollingIntervalOptions,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveryImport/PollingIntervalLabels";

/*
 * What an import will do, worked out before it does it (OneUptime issue
 * #4811): the monitoring step's account of the outcome - how many devices
 * are walked and how many pinged, how often, which template their monitors
 * come from and whether a problem reaches anyone - is drawn from this, from
 * the very settings the import is sent with. Every combination that changes
 * a sentence is pinned here.
 */

const TEMPLATE_ID: string = "6f1d3c2b-4a5e-4f60-8b7c-9d0e1f2a3b4c";

function summary(
  overrides: Partial<MonitorTemplateAlertSummary> = {},
): MonitorTemplateAlertSummary {
  return {
    criteria: [],
    raisesIncidents: true,
    raisesAlerts: false,
    raisesIncidentsOnPingOnlyDevices: true,
    raisesAlertsOnPingOnlyDevices: false,
    ...overrides,
  };
}

function template(
  overrides: Partial<DiscoveryImportTemplateChoice> = {},
): DiscoveryImportTemplateChoice {
  return {
    id: TEMPLATE_ID,
    name: "Network device alert pack",
    summary: summary(),
    ...overrides,
  };
}

function hosts(snmp: number, pingOnly: number): Array<DiscoveredNetworkDevice> {
  const list: Array<DiscoveredNetworkDevice> = [];

  for (let index: number = 0; index < snmp; index++) {
    list.push({
      ipAddress: `10.0.0.${index + 1}`,
      sysName: `switch-${index + 1}`,
      snmpReachable: true,
    });
  }

  for (let index: number = 0; index < pingOnly; index++) {
    list.push({ ipAddress: `10.0.1.${index + 1}`, snmpReachable: false });
  }

  return list;
}

function settings(
  overrides: Partial<DiscoveryImportSettings> = {},
): DiscoveryImportSettings {
  return { ...DEFAULT_DISCOVERY_IMPORT_SETTINGS, ...overrides };
}

const WITH_MONITORS: DiscoveryImportSettings = settings({
  alerting: DiscoveryImportAlerting.MonitorTemplate,
  monitorTemplateId: TEMPLATE_ID,
});

function policy(
  overrides: Partial<DiscoveryImportPolicyFact> = {},
): DiscoveryImportPolicyFact {
  return {
    name: "Every device",
    isEnabled: true,
    isUnscoped: true,
    hasTemplate: true,
    templateName: "Network device alert pack",
    ...overrides,
  };
}

function outcomeOf(data: {
  hosts?: Array<DiscoveredNetworkDevice>;
  settings?: DiscoveryImportSettings;
  template?: DiscoveryImportTemplateChoice | null;
  policies?: Array<DiscoveryImportPolicyFact>;
  monitorRoom?: number | null;
}): DiscoveryImportOutcome {
  return getDiscoveryImportOutcome({
    hosts: data.hosts || hosts(480, 34),
    settings: data.settings || settings(),
    template: data.template === undefined ? template() : data.template,
    policies: data.policies || [],
    monitorRoom: data.monitorRoom === undefined ? null : data.monitorRoom,
  });
}

describe("what the devices are", () => {
  test("walked over SNMP or pinged, counted apart, checked as often as chosen", () => {
    const outcome: DiscoveryImportOutcome = outcomeOf({
      settings: settings({ pollingIntervalInMinutes: 1 }),
    });

    expect(outcome.hostCount).toBe(514);
    expect(outcome.snmpHostCount).toBe(480);
    expect(outcome.pingOnlyHostCount).toBe(34);
    expect(outcome.pollingIntervalInMinutes).toBe(1);
    expect(countPingOnlyHosts(hosts(2, 3))).toBe(3);
  });

  test("vendor templates are promised only when an SNMP device is there to take one", () => {
    expect(outcomeOf({}).appliesVendorTemplates).toBe(true);
    expect(
      outcomeOf({ settings: settings({ applyVendorTemplates: false }) })
        .appliesVendorTemplates,
    ).toBe(false);
    expect(outcomeOf({ hosts: hosts(0, 514) }).appliesVendorTemplates).toBe(
      false,
    );
  });
});

describe("who hears about a problem", () => {
  test("no monitors and no policy: nobody, whatever template happens to be picked", () => {
    const outcome: DiscoveryImportOutcome = outcomeOf({});

    expect(outcome.reach).toBe(DiscoveryImportAlertReach.Nobody);
    expect(outcome.monitorCount).toBe(0);
    expect(outcome.template).toBeNull();
    expect(outcome.raisesIncidents).toBe(false);
  });

  test("a monitor per device from a template that raises incidents", () => {
    const outcome: DiscoveryImportOutcome = outcomeOf({
      settings: WITH_MONITORS,
    });

    expect(outcome.reach).toBe(DiscoveryImportAlertReach.Template);
    expect(outcome.monitorCount).toBe(514);
    expect(outcome.template?.name).toBe("Network device alert pack");
    expect(outcome.raisesIncidents).toBe(true);
    expect(outcome.raisesAlerts).toBe(false);
    expect(outcome.pingOnlyHostsWithoutAlerts).toBe(0);
  });

  test("monitors asked for with no template picked: none, and the blocker says so", () => {
    const outcome: DiscoveryImportOutcome = outcomeOf({
      settings: WITH_MONITORS,
      template: null,
    });

    expect(outcome.monitorCount).toBe(0);
    expect(
      getDiscoveryImportBlocker({
        hostCount: 514,
        settings: WITH_MONITORS,
        template: null,
      }),
    ).toBe("Pick the monitor template each device is monitored with.");
  });

  test("a template that raises nothing reaches nobody, though it makes monitors", () => {
    const outcome: DiscoveryImportOutcome = outcomeOf({
      settings: WITH_MONITORS,
      template: template({
        summary: summary({
          raisesIncidents: false,
          raisesIncidentsOnPingOnlyDevices: false,
        }),
      }),
    });

    expect(outcome.monitorCount).toBe(514);
    expect(outcome.reach).toBe(DiscoveryImportAlertReach.Nobody);
  });

  test("ping-only devices a walk-only template can raise nothing for are counted", () => {
    const outcome: DiscoveryImportOutcome = outcomeOf({
      settings: WITH_MONITORS,
      template: template({
        summary: summary({
          raisesIncidents: true,
          raisesIncidentsOnPingOnlyDevices: false,
        }),
      }),
    });

    expect(outcome.reach).toBe(DiscoveryImportAlertReach.Template);
    expect(outcome.pingOnlyHostsWithoutAlerts).toBe(34);
  });

  test("an alert on a ping-only device is enough to count it covered", () => {
    expect(
      outcomeOf({
        settings: WITH_MONITORS,
        template: template({
          summary: summary({
            raisesIncidents: true,
            raisesAlerts: true,
            raisesIncidentsOnPingOnlyDevices: false,
            raisesAlertsOnPingOnlyDevices: true,
          }),
        }),
      }).pingOnlyHostsWithoutAlerts,
    ).toBe(0);
  });

  test("no monitors, but a policy covering every device: the policy's monitors reach people", () => {
    const outcome: DiscoveryImportOutcome = outcomeOf({
      policies: [
        policy({ name: "Every device" }),
        policy({ name: "Core sites", isUnscoped: false }),
        policy({ name: "Switched off", isEnabled: false }),
        policy({ name: "No template", hasTemplate: false }),
      ],
    });

    expect(outcome.reach).toBe(DiscoveryImportAlertReach.Policies);
    expect(outcome.coveringPolicyNames).toEqual(["Every device"]);
    expect(outcome.scopedPolicyCount).toBe(1);
  });

  test("a policy scoped to sites, roles or labels is counted, never promised", () => {
    const outcome: DiscoveryImportOutcome = outcomeOf({
      policies: [policy({ isUnscoped: false })],
    });

    expect(outcome.reach).toBe(DiscoveryImportAlertReach.Nobody);
    expect(outcome.scopedPolicyCount).toBe(1);
    expect(outcome.coveringPolicyNames).toEqual([]);
  });
});

describe("the plan's room for monitors", () => {
  test("monitors past the room are devices imported without one", () => {
    expect(
      outcomeOf({ settings: WITH_MONITORS, monitorRoom: 100 })
        .monitorsBeyondRoom,
    ).toBe(414);
    expect(
      outcomeOf({ settings: WITH_MONITORS, monitorRoom: 600 })
        .monitorsBeyondRoom,
    ).toBe(0);
    // A plan already past its limit has no room at all.
    expect(
      outcomeOf({ settings: WITH_MONITORS, monitorRoom: -5 })
        .monitorsBeyondRoom,
    ).toBe(514);
  });

  test("no limit, or no monitors asked for, is never short of room", () => {
    expect(
      outcomeOf({ settings: WITH_MONITORS, monitorRoom: null })
        .monitorsBeyondRoom,
    ).toBe(0);
    expect(outcomeOf({ monitorRoom: 0 }).monitorsBeyondRoom).toBe(0);
  });
});

describe("what keeps Import from being pressed", () => {
  test("nothing to import", () => {
    expect(
      getDiscoveryImportBlocker({
        hostCount: 0,
        settings: settings(),
        template: null,
      }),
    ).toBe("Select at least one host to import.");
  });

  test("nothing, when hosts are picked and monitors are not asked for", () => {
    expect(
      getDiscoveryImportBlocker({
        hostCount: 3,
        settings: settings(),
        template: null,
      }),
    ).toBeNull();
    expect(
      getDiscoveryImportBlocker({
        hostCount: 3,
        settings: WITH_MONITORS,
        template: template(),
      }),
    ).toBeNull();
  });
});

describe("how a template is picked", () => {
  test("by its id, or - the recommended one Import would create - by its own value", () => {
    expect(getTemplateChoiceValue(template())).toBe(TEMPLATE_ID);
    expect(
      getTemplateChoiceValue(template({ id: "", isCreatedOnImport: true })),
    ).toBe(RECOMMENDED_TEMPLATE_CHOICE_VALUE);
  });
});

describe("how often, in words", () => {
  test("every choice has a whole phrase of its own, in order", () => {
    const options: Array<DropdownOption> = getPollingIntervalOptions();

    expect(
      options.map((option: DropdownOption) => {
        return [option.value, option.label];
      }),
    ).toEqual([
      [1, "Every minute"],
      [2, "Every 2 minutes"],
      [5, "Every 5 minutes"],
      [10, "Every 10 minutes"],
      [15, "Every 15 minutes"],
      [30, "Every 30 minutes"],
      [60, "Every hour"],
    ]);
    expect(Object.keys(POLLING_INTERVAL_LABELS).map(Number)).toEqual([
      ...DISCOVERY_IMPORT_POLLING_INTERVALS_IN_MINUTES,
    ]);
  });

  test("a value that is no choice still reads as minutes", () => {
    expect(getPollingIntervalLabel(7)).toBe("Every 7 minutes");
  });
});
