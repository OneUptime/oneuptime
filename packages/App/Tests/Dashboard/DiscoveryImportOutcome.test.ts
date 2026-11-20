import { describe, expect, test } from "@jest/globals";
import { DiscoveredNetworkDevice } from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import {
  DEFAULT_DISCOVERY_IMPORT_SETTINGS,
  DISCOVERY_IMPORT_POLLING_INTERVALS_IN_MINUTES,
  DiscoveryImportAlerting,
  DiscoveryImportSettings,
} from "Common/Types/NetworkDevice/DiscoveryImport";
import MonitorType from "Common/Types/Monitor/MonitorType";
import { MonitorTemplateAlertSummary } from "Common/Utils/Monitor/MonitorTemplateAlertSummary";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import {
  DiscoveryImportAlertReach,
  DiscoveryImportOutcome,
  DiscoveryImportPolicyFact,
  DiscoveryImportTemplateChoice,
  EXISTING_DEVICES_NEED_A_TEMPLATE,
  RECOMMENDED_TEMPLATE_CHOICE_VALUE,
  checksDeviceAddress,
  checksDeviceUrl,
  checksFromProbe,
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
    monitorType: MonitorType.NetworkDevice,
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

/*
 * Issue #5145: a Ping, IP, Port or NTP template's monitor checks each
 * device's address itself, so a device that answers ping only is covered
 * as fully as any other - the walk-only caveat is a Network Device
 * template's alone.
 */
describe("a template whose monitors check each device's address", () => {
  test("tells the two kinds apart", () => {
    for (const monitorType of [
      MonitorType.Ping,
      MonitorType.IP,
      MonitorType.Port,
      MonitorType.NTP,
    ]) {
      expect(checksDeviceAddress(template({ monitorType: monitorType }))).toBe(
        true,
      );
    }

    expect(
      checksDeviceAddress(template({ monitorType: MonitorType.NetworkDevice })),
    ).toBe(false);
    expect(checksDeviceAddress(null)).toBe(false);
    expect(checksDeviceAddress(undefined)).toBe(false);
  });

  test("every ping-only device is covered: the monitor pings it itself", () => {
    const outcome: DiscoveryImportOutcome = outcomeOf({
      hosts: hosts(0, 516),
      settings: WITH_MONITORS,
      template: template({
        name: "WB KDS Ping Monitor Template",
        monitorType: MonitorType.Ping,
        // Even read as a Network Device template's would be.
        summary: summary({
          raisesIncidents: true,
          raisesIncidentsOnPingOnlyDevices: false,
        }),
      }),
    });

    expect(outcome.reach).toBe(DiscoveryImportAlertReach.Template);
    expect(outcome.monitorCount).toBe(516);
    expect(outcome.pingOnlyHostCount).toBe(516);
    expect(outcome.pingOnlyHostsWithoutAlerts).toBe(0);
    expect(outcome.template?.name).toBe("WB KDS Ping Monitor Template");
  });

  test("a Network Device template of walk checks still counts the ping-only devices it cannot alert on", () => {
    expect(
      outcomeOf({
        hosts: hosts(0, 516),
        settings: WITH_MONITORS,
        template: template({
          monitorType: MonitorType.NetworkDevice,
          summary: summary({
            raisesIncidents: true,
            raisesIncidentsOnPingOnlyDevices: false,
          }),
        }),
      }).pingOnlyHostsWithoutAlerts,
    ).toBe(516);
  });

  test("an address template that raises nothing reaches nobody, as any other", () => {
    const outcome: DiscoveryImportOutcome = outcomeOf({
      settings: WITH_MONITORS,
      template: template({
        monitorType: MonitorType.Port,
        ports: [9100],
        summary: summary({
          raisesIncidents: false,
          raisesIncidentsOnPingOnlyDevices: false,
        }),
      }),
    });

    expect(outcome.monitorCount).toBe(514);
    expect(outcome.reach).toBe(DiscoveryImportAlertReach.Nobody);
    expect(outcome.pingOnlyHostsWithoutAlerts).toBe(0);
  });

  /*
   * #5145's import was 516 kitchen displays and registers that answer ping
   * only: the recommended pack's alerts all read an SNMP walk, so none of
   * them can be created on these devices, and the summary must not say so.
   */
  test("every device answers ping only: what a Network Device template raises on them is what its ping-only checks raise", () => {
    const pack: DiscoveryImportTemplateChoice = template({
      summary: summary({
        raisesIncidents: true,
        raisesAlerts: true,
        raisesIncidentsOnPingOnlyDevices: true,
        raisesAlertsOnPingOnlyDevices: false,
      }),
    });

    const pingOnly: DiscoveryImportOutcome = outcomeOf({
      hosts: hosts(0, 516),
      settings: WITH_MONITORS,
      template: pack,
    });

    expect(pingOnly.raisesIncidents).toBe(true);
    expect(pingOnly.raisesAlerts).toBe(false);
    expect(pingOnly.reach).toBe(DiscoveryImportAlertReach.Template);

    // With one SNMP device among them, its alerts are the template's again.
    const mixed: DiscoveryImportOutcome = outcomeOf({
      hosts: hosts(1, 515),
      settings: WITH_MONITORS,
      template: pack,
    });

    expect(mixed.raisesAlerts).toBe(true);
  });

  test("every device answers ping only and nothing the template raises can fire on them: it reaches nobody, and says why", () => {
    const outcome: DiscoveryImportOutcome = outcomeOf({
      hosts: hosts(0, 516),
      settings: WITH_MONITORS,
      template: template({
        summary: summary({
          raisesIncidents: true,
          raisesAlerts: true,
          raisesIncidentsOnPingOnlyDevices: false,
          raisesAlertsOnPingOnlyDevices: false,
        }),
      }),
    });

    expect(outcome.raisesIncidents).toBe(false);
    expect(outcome.raisesAlerts).toBe(false);
    expect(outcome.reach).toBe(DiscoveryImportAlertReach.Nobody);
    expect(outcome.pingOnlyHostsWithoutAlerts).toBe(516);
  });

  test("an address template raises what it raises on every device, ping only or not", () => {
    const outcome: DiscoveryImportOutcome = outcomeOf({
      hosts: hosts(0, 516),
      settings: WITH_MONITORS,
      template: template({
        monitorType: MonitorType.Ping,
        summary: summary({
          raisesIncidents: true,
          raisesAlerts: true,
          raisesIncidentsOnPingOnlyDevices: false,
          raisesAlertsOnPingOnlyDevices: false,
        }),
      }),
    });

    expect(outcome.raisesIncidents).toBe(true);
    expect(outcome.raisesAlerts).toBe(true);
    expect(outcome.reach).toBe(DiscoveryImportAlertReach.Template);
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

/*
 * ISSUE #9544: devices already added, with no monitor, picked to get one.
 * They are counted apart from the hosts imported, and get the template's
 * monitor only when monitors are asked for.
 */
describe("devices already added, picked to get a monitor (#9544)", () => {
  const existing: Array<DiscoveredNetworkDevice> = [
    { ipAddress: "10.0.9.1", snmpReachable: true, isAlreadyRegistered: true },
    { ipAddress: "10.0.9.2", snmpReachable: false, isAlreadyRegistered: true },
  ];

  test("each gets the template's monitor: monitors are counted for the new devices and for them", () => {
    const outcome: DiscoveryImportOutcome = getDiscoveryImportOutcome({
      hosts: hosts(3, 1),
      existingHosts: existing,
      settings: WITH_MONITORS,
      template: template(),
      policies: [],
      monitorRoom: null,
    });

    expect(outcome.hostCount).toBe(4);
    expect(outcome.existingDeviceCount).toBe(2);
    expect(outcome.monitorCount).toBe(6);
    // They are not walked or pinged anew: the counts of devices are the new ones'.
    expect(outcome.snmpHostCount).toBe(3);
    expect(outcome.pingOnlyHostCount).toBe(1);
  });

  test("a plan's room is counted against their monitors too", () => {
    expect(
      getDiscoveryImportOutcome({
        hosts: hosts(3, 0),
        existingHosts: existing,
        settings: WITH_MONITORS,
        template: template(),
        policies: [],
        monitorRoom: 4,
      }).monitorsBeyondRoom,
    ).toBe(1);
  });

  test("with no monitor asked for, they get nothing", () => {
    const outcome: DiscoveryImportOutcome = getDiscoveryImportOutcome({
      hosts: hosts(3, 0),
      existingHosts: existing,
      settings: settings(),
      template: template(),
      policies: [],
      monitorRoom: null,
    });

    expect(outcome.existingDeviceCount).toBe(2);
    expect(outcome.monitorCount).toBe(0);
  });

  test("only devices already added, and no monitor asked for: nothing to do, and the blocker says what to change", () => {
    expect(
      getDiscoveryImportBlocker({
        hostCount: 0,
        existingDeviceCount: 2,
        settings: settings(),
        template: null,
      }),
    ).toBe(EXISTING_DEVICES_NEED_A_TEMPLATE);
    expect(EXISTING_DEVICES_NEED_A_TEMPLATE).toBe(
      "The devices you picked are already added. Give them a monitor from a template, or go back and pick new hosts.",
    );
  });

  test("only devices already added, with a template: nothing keeps Import from being pressed", () => {
    expect(
      getDiscoveryImportBlocker({
        hostCount: 0,
        existingDeviceCount: 2,
        settings: WITH_MONITORS,
        template: template(),
      }),
    ).toBeNull();
    // New hosts as well, with Status only: they are imported, the rest wait.
    expect(
      getDiscoveryImportBlocker({
        hostCount: 3,
        existingDeviceCount: 2,
        settings: settings(),
        template: null,
      }),
    ).toBeNull();
  });
});

/*
 * ISSUE #9546: a Website, API or SSL Certificate template's monitor checks
 * a URL on each device, from the scan's probe - like an address template's,
 * it fires on a device that answers ping only, and reads no walk.
 */
describe("a template whose monitors check a URL on each device (#9546)", () => {
  test("is told apart from the address kinds, and both check from the probe", () => {
    for (const monitorType of [
      MonitorType.Website,
      MonitorType.API,
      MonitorType.SSLCertificate,
    ]) {
      expect(checksDeviceUrl(template({ monitorType: monitorType }))).toBe(
        true,
      );
      expect(checksDeviceAddress(template({ monitorType: monitorType }))).toBe(
        false,
      );
      expect(checksFromProbe(template({ monitorType: monitorType }))).toBe(
        true,
      );
    }

    expect(checksFromProbe(template({ monitorType: MonitorType.Ping }))).toBe(
      true,
    );
    expect(
      checksFromProbe(template({ monitorType: MonitorType.NetworkDevice })),
    ).toBe(false);
    expect(checksDeviceUrl(null)).toBe(false);
  });

  test("every ping-only device is covered by what it raises", () => {
    const outcome: DiscoveryImportOutcome = outcomeOf({
      hosts: hosts(0, 12),
      settings: WITH_MONITORS,
      template: template({
        name: "Device status page",
        monitorType: MonitorType.Website,
        templateUrl: "https://device:8443/status",
        // Even read as a Network Device template's would be.
        summary: summary({
          raisesIncidents: true,
          raisesIncidentsOnPingOnlyDevices: false,
        }),
      }),
    });

    expect(outcome.raisesIncidents).toBe(true);
    expect(outcome.pingOnlyHostsWithoutAlerts).toBe(0);
    expect(outcome.reach).toBe(DiscoveryImportAlertReach.Template);
  });

  test("one no device's monitor can be made from keeps Import from being pressed, with the server's words", () => {
    const reason: string =
      "This template's URL names its host with a variable, which is read when the check runs, so each device's address cannot take its place. Write a host into the URL, such as https://device/, then pick it again.";

    expect(
      getDiscoveryImportBlocker({
        hostCount: 3,
        settings: WITH_MONITORS,
        template: template({
          monitorType: MonitorType.API,
          templateUrl: "https://{{monitorSecrets.host}}/",
          unusableReason: reason,
        }),
      }),
    ).toBe(reason);
    // Asked for no monitor, the template is not used: nothing waits for it.
    expect(
      getDiscoveryImportBlocker({
        hostCount: 3,
        settings: settings(),
        template: template({ unusableReason: reason }),
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
    expect(getPollingIntervalLabel(7)).toBe("Every 7\u00A0minutes");
  });
});
