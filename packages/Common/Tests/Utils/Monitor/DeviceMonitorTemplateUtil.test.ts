import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorTemplate from "../../../Models/DatabaseModels/MonitorTemplate";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import Hostname from "../../../Types/API/Hostname";
import URL from "../../../Types/API/URL";
import BadDataException from "../../../Types/Exception/BadDataException";
import IP from "../../../Types/IP/IP";
import { JSONObject } from "../../../Types/JSON";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import Port from "../../../Types/Port";
import DeviceMonitorTemplateUtil, {
  DEVICE_ADDRESS_MONITOR_TYPES,
  DEVICE_MONITOR_TEMPLATE_TYPES,
  DEVICE_MONITOR_TEMPLATE_TYPE_REFUSAL,
  IP_MONITOR_NEEDS_IP_ADDRESS,
  isDeviceAddressMonitorType,
  isDeviceMonitorTemplateType,
} from "../../../Utils/Monitor/DeviceMonitorTemplateUtil";
import NetworkDeviceMonitorTemplateUtil from "../../../Utils/Monitor/NetworkDeviceMonitorTemplateUtil";
import { describe, expect, it } from "@jest/globals";

/*
 * A MONITOR FOR ONE NETWORK DEVICE, FROM A TEMPLATE (OneUptime issue #5145).
 *
 * A discovery import gives each device a monitor from the template its
 * reader picks. Until #5145 only a Network Device template could be picked,
 * so a customer's own Ping template never showed. These pin what a Ping, IP,
 * Port or NTP template now makes for a device: a monitor that checks the
 * device's own address - every step, never the template's address - and
 * keeps everything else the template says; what a template sync keeps; and
 * what may carry a device's provenance at all.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const TEMPLATE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const DEVICE_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const OTHER_DEVICE_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const ONLINE_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const OFFLINE_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const SEVERITY_ID: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888888",
);

// The address the template was designed against: never a device's.
const TEMPLATE_ADDRESS: string = "192.0.2.10";

// A model with no id: as one is before it is saved.
function withoutId<T extends MonitorTemplate | NetworkDevice>(model: T): T {
  (model as unknown as Record<string, unknown>)["_id"] = undefined;
  return model;
}

function expectBadData(run: () => unknown, message: string): void {
  expect(run).toThrow(BadDataException);
  expect(run).toThrow(message);
}

// One step of the type's own defaults, the way the template form makes one.
function buildStep(data: {
  monitorType: MonitorType;
  id: string;
  destination?: IP | Hostname | URL | undefined;
  port?: number | undefined;
}): MonitorStep {
  const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
    monitorName: "Kitchen display",
    monitorType: data.monitorType,
    onlineMonitorStatusId: ONLINE_ID,
    offlineMonitorStatusId: OFFLINE_ID,
    defaultIncidentSeverityId: SEVERITY_ID,
    defaultAlertSeverityId: SEVERITY_ID,
  });
  step.data!.id = data.id;
  step.data!.requestTimeoutInMs = 4000;
  step.data!.retryCount = 2;

  if (data.destination) {
    step.setMonitorDestination(data.destination);
  }

  if (data.port) {
    step.setPort(new Port(data.port));
  }

  return step;
}

function buildSteps(
  monitorType: MonitorType,
  steps: Array<{
    destination?: IP | Hostname | URL | undefined;
    port?: number | undefined;
  }> = [{ destination: IP.fromString(TEMPLATE_ADDRESS) }],
): MonitorSteps {
  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: steps.map(
      (
        step: {
          destination?: IP | Hostname | URL | undefined;
          port?: number | undefined;
        },
        index: number,
      ): MonitorStep => {
        return buildStep({
          monitorType: monitorType,
          id: `step-${index + 1}`,
          destination: step.destination,
          port: step.port,
        });
      },
    ),
    defaultMonitorStatusId: ONLINE_ID,
  };
  return monitorSteps;
}

function buildLabel(id: string, name: string): Label {
  const label: Label = new Label();
  label.id = new ObjectID(id);
  label.name = name;
  return label;
}

// null: a template saved without steps.
function buildTemplate(
  monitorType: MonitorType,
  monitorSteps: MonitorSteps | null = buildSteps(monitorType),
): MonitorTemplate {
  const template: MonitorTemplate = new MonitorTemplate();
  template.id = TEMPLATE_ID;
  template.projectId = PROJECT_ID;
  template.templateName = "WB KDS Ping Monitor Template";
  template.monitorName = "Reachability";
  template.monitorDescription = "Pages the store when a display stops.";
  template.monitorType = monitorType;
  if (monitorSteps) {
    template.monitorSteps = monitorSteps;
  }
  template.monitoringInterval = "*/5 * * * *";
  template.minimumProbeAgreement = 1;
  template.customFields = { store: "WB0024", nested: { tier: [1, 2] } };
  template.labels = [
    buildLabel("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "kitchen"),
    buildLabel("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "stores"),
  ];
  return template;
}

function buildDevice(
  fields: { hostname?: string; name?: string; projectId?: ObjectID } = {},
): NetworkDevice {
  const device: NetworkDevice = new NetworkDevice();
  device.id = DEVICE_ID;
  device.projectId = fields.projectId || PROJECT_ID;
  device.name = fields.name ?? "WB0024KDS03";
  device.hostname = fields.hostname ?? "10.48.24.33";
  return device;
}

function destinationsOf(monitorSteps: MonitorSteps | undefined): Array<string> {
  return (monitorSteps?.data?.monitorStepsInstanceArray || []).map(
    (step: MonitorStep): string => {
      return step.data?.monitorDestination?.toString() || "";
    },
  );
}

function portsOf(monitorSteps: MonitorSteps | undefined): Array<string> {
  return (monitorSteps?.data?.monitorStepsInstanceArray || []).map(
    (step: MonitorStep): string => {
      return step.data?.monitorDestinationPort?.toString() || "";
    },
  );
}

function criteriaNamesOf(monitorSteps: MonitorSteps | undefined): string {
  return JSON.stringify(
    (monitorSteps?.data?.monitorStepsInstanceArray || []).map(
      (step: MonitorStep): Array<string> => {
        return (
          step.data?.monitorCriteria?.data?.monitorCriteriaInstanceArray || []
        ).map((instance: MonitorCriteriaInstance): string => {
          return instance.data?.name || "";
        });
      },
    ),
  );
}

describe("the kinds of template a device's monitor can be made from", () => {
  it("are a Network Device one, then the four that check an address", () => {
    expect([...DEVICE_ADDRESS_MONITOR_TYPES]).toEqual([
      MonitorType.Ping,
      MonitorType.IP,
      MonitorType.Port,
      MonitorType.NTP,
    ]);
    expect([...DEVICE_MONITOR_TEMPLATE_TYPES]).toEqual([
      MonitorType.NetworkDevice,
      MonitorType.Ping,
      MonitorType.IP,
      MonitorType.Port,
      MonitorType.NTP,
    ]);
  });

  it("no other monitor type is one of them", () => {
    const others: Array<MonitorType> = Object.values(MonitorType).filter(
      (monitorType: MonitorType): boolean => {
        return !DEVICE_MONITOR_TEMPLATE_TYPES.includes(monitorType);
      },
    );

    // Website, API, SSL Certificate, DNS, telemetry and the rest.
    expect(others.length).toBeGreaterThan(20);

    for (const monitorType of others) {
      expect(isDeviceMonitorTemplateType(monitorType)).toBe(false);
      expect(isDeviceAddressMonitorType(monitorType)).toBe(false);
    }
  });

  it("a Network Device template reads polls, so it is not an address one", () => {
    expect(isDeviceMonitorTemplateType(MonitorType.NetworkDevice)).toBe(true);
    expect(isDeviceAddressMonitorType(MonitorType.NetworkDevice)).toBe(false);

    for (const monitorType of DEVICE_ADDRESS_MONITOR_TYPES) {
      expect(isDeviceMonitorTemplateType(monitorType)).toBe(true);
      expect(isDeviceAddressMonitorType(monitorType)).toBe(true);
    }
  });

  it("reads a stored value as it is written, and nothing as nothing", () => {
    expect(isDeviceAddressMonitorType("Ping")).toBe(true);
    expect(isDeviceMonitorTemplateType("Network Device")).toBe(true);
    expect(isDeviceAddressMonitorType("ping")).toBe(false);
    expect(isDeviceAddressMonitorType("")).toBe(false);
    expect(isDeviceAddressMonitorType(null)).toBe(false);
    expect(isDeviceMonitorTemplateType(undefined)).toBe(false);
  });

  it("each address kind is a kind whose step must name a destination", () => {
    for (const monitorType of DEVICE_ADDRESS_MONITOR_TYPES) {
      const withoutDestination: MonitorStep = buildStep({
        monitorType: monitorType,
        id: "step-1",
        port: 9100,
      });

      expect(
        MonitorStep.getValidationError(withoutDestination, monitorType),
      ).toBeTruthy();
    }
  });

  it("the refusal names every kind that can be picked", () => {
    for (const monitorType of DEVICE_MONITOR_TEMPLATE_TYPES) {
      expect(DEVICE_MONITOR_TEMPLATE_TYPE_REFUSAL).toContain(monitorType);
    }
  });
});

describe("DeviceMonitorTemplateUtil.buildDestination", () => {
  it("an IP address is checked as one, by every kind", () => {
    for (const monitorType of DEVICE_ADDRESS_MONITOR_TYPES) {
      const destination: IP | Hostname =
        DeviceMonitorTemplateUtil.buildDestination({
          address: "10.48.24.33",
          monitorType: monitorType,
        });

      expect(destination).toBeInstanceOf(IP);
      expect(destination.toString()).toBe("10.48.24.33");
    }
  });

  it("an IPv6 address is an IP too", () => {
    const destination: IP | Hostname =
      DeviceMonitorTemplateUtil.buildDestination({
        address: "2001:db8::24",
        monitorType: MonitorType.IP,
      });

    expect(destination).toBeInstanceOf(IP);
    expect(destination.toString()).toBe("2001:db8::24");
  });

  it("a name is a host name for a Ping, Port or NTP monitor", () => {
    for (const monitorType of [
      MonitorType.Ping,
      MonitorType.Port,
      MonitorType.NTP,
    ]) {
      const destination: IP | Hostname =
        DeviceMonitorTemplateUtil.buildDestination({
          address: "  kds-03.wbhq.com ",
          monitorType: monitorType,
        });

      expect(destination).toBeInstanceOf(Hostname);
      expect(destination.toString()).toBe("kds-03.wbhq.com");
    }
  });

  it("an IP monitor cannot check a name, and says what can", () => {
    expectBadData(() => {
      return DeviceMonitorTemplateUtil.buildDestination({
        address: "kds-03.wbhq.com",
        monitorType: MonitorType.IP,
      });
    }, "An IP monitor checks an IP address, and this device's address is a name. Use a Ping template for it.");
  });

  /*
   * The import's list of failures groups devices by reason and names each
   * device's address under it: a reason that named the address would make
   * every such device a group of its own.
   */
  it("every device whose address is a name gets the same sentence, so the import lists them as one group", () => {
    const reasons: Array<string> = [
      "kds-03.wbhq.com",
      "printer-02.corp.example.com",
    ].map((address: string): string => {
      try {
        DeviceMonitorTemplateUtil.buildDestination({
          address: address,
          monitorType: MonitorType.IP,
        });
      } catch (err) {
        return (err as Error).message;
      }

      return "";
    });

    expect(reasons).toEqual([
      IP_MONITOR_NEEDS_IP_ADDRESS,
      IP_MONITOR_NEEDS_IP_ADDRESS,
    ]);
    expect(IP_MONITOR_NEEDS_IP_ADDRESS).not.toContain("kds-03");
  });

  it("a device with no address cannot be checked", () => {
    expectBadData(() => {
      return DeviceMonitorTemplateUtil.buildDestination({
        address: "   ",
        monitorType: MonitorType.Ping,
      });
    }, "This device has no address, so a monitor cannot check it.");
  });

  it("a kind that checks no address is refused", () => {
    for (const monitorType of [
      MonitorType.NetworkDevice,
      MonitorType.Website,
      MonitorType.API,
    ]) {
      expectBadData(() => {
        return DeviceMonitorTemplateUtil.buildDestination({
          address: "10.48.24.33",
          monitorType: monitorType,
        });
      }, `A ${monitorType} monitor does not check an address.`);
    }
  });
});

describe("DeviceMonitorTemplateUtil.retargetMonitorSteps", () => {
  it("every step checks the device's address; the template's steps are left as they were", () => {
    const template: MonitorSteps = buildSteps(MonitorType.Ping, [
      { destination: IP.fromString(TEMPLATE_ADDRESS) },
      { destination: new Hostname("template.example.com") },
    ]);
    const before: JSONObject = template.toJSON();

    const retargeted: MonitorSteps =
      DeviceMonitorTemplateUtil.retargetMonitorSteps({
        monitorSteps: template,
        address: "10.48.24.33",
        monitorType: MonitorType.Ping,
      });

    expect(destinationsOf(retargeted)).toEqual(["10.48.24.33", "10.48.24.33"]);
    expect(template.toJSON()).toEqual(before);
    expect(retargeted).not.toBe(template);
  });

  it("keeps the rest of each step: its id, port, timeout, retries and criteria", () => {
    const template: MonitorSteps = buildSteps(MonitorType.Port, [
      { destination: IP.fromString(TEMPLATE_ADDRESS), port: 9100 },
      { destination: IP.fromString(TEMPLATE_ADDRESS), port: 22 },
    ]);

    const retargeted: MonitorSteps =
      DeviceMonitorTemplateUtil.retargetMonitorSteps({
        monitorSteps: template,
        address: "10.48.24.33",
        monitorType: MonitorType.Port,
      });

    const steps: Array<MonitorStep> =
      retargeted.data!.monitorStepsInstanceArray;

    expect(
      steps.map((step: MonitorStep): string => {
        return step.data!.id;
      }),
    ).toEqual(["step-1", "step-2"]);
    expect(portsOf(retargeted)).toEqual(["9100", "22"]);
    expect(steps[0]!.data!.requestTimeoutInMs).toBe(4000);
    expect(steps[1]!.data!.retryCount).toBe(2);
    expect(criteriaNamesOf(retargeted)).toBe(criteriaNamesOf(template));
    expect(retargeted.data!.defaultMonitorStatusId?.toString()).toBe(
      ONLINE_ID.toString(),
    );
  });

  it("no two steps share one destination object", () => {
    const retargeted: MonitorSteps =
      DeviceMonitorTemplateUtil.retargetMonitorSteps({
        monitorSteps: buildSteps(MonitorType.Ping, [{}, {}]),
        address: "10.48.24.33",
        monitorType: MonitorType.Ping,
      });

    const [first, second] = retargeted.data!.monitorStepsInstanceArray;

    expect(first!.data!.monitorDestination).not.toBe(
      second!.data!.monitorDestination,
    );
  });

  it("a template with no steps has nothing to check", () => {
    const empty: MonitorSteps = new MonitorSteps();
    empty.data = {
      monitorStepsInstanceArray: [],
      defaultMonitorStatusId: ONLINE_ID,
    };

    for (const monitorSteps of [empty, undefined]) {
      expectBadData(() => {
        return DeviceMonitorTemplateUtil.retargetMonitorSteps({
          monitorSteps: monitorSteps,
          address: "10.48.24.33",
          monitorType: MonitorType.Ping,
        });
      }, "Monitor template monitor steps are required.");
    }
  });
});

describe("DeviceMonitorTemplateUtil.keepTargetAddress", () => {
  it("a sync brings the template's steps and keeps the address the monitor checks", () => {
    const template: MonitorSteps = buildSteps(MonitorType.Ping, [
      { destination: IP.fromString(TEMPLATE_ADDRESS) },
      { destination: IP.fromString(TEMPLATE_ADDRESS) },
    ]);
    // A criterion renamed in the template since the monitor was made.
    template.data!.monitorStepsInstanceArray[0]!.data!.monitorCriteria!.data!.monitorCriteriaInstanceArray[0]!.data!.name =
      "Display stops answering";
    const current: MonitorSteps = buildSteps(MonitorType.Ping, [
      { destination: IP.fromString("10.48.24.33") },
    ]);
    const before: JSONObject = template.toJSON();

    const synced: MonitorSteps = DeviceMonitorTemplateUtil.keepTargetAddress({
      templateMonitorSteps: template,
      currentMonitorSteps: current,
    });

    expect(destinationsOf(synced)).toEqual(["10.48.24.33", "10.48.24.33"]);
    expect(criteriaNamesOf(synced)).toBe(criteriaNamesOf(template));
    expect(criteriaNamesOf(synced)).toContain("Display stops answering");
    expect(template.toJSON()).toEqual(before);
  });

  it("reads the monitor's steps as stored, JSON and host names alike", () => {
    const current: JSONObject = buildSteps(MonitorType.NTP, [
      { destination: new Hostname("kds-03.wbhq.com") },
    ]).toJSON();

    const synced: MonitorSteps = DeviceMonitorTemplateUtil.keepTargetAddress({
      templateMonitorSteps: buildSteps(MonitorType.NTP, [
        { destination: new Hostname("time.example.com"), port: 123 },
      ]),
      currentMonitorSteps: current,
    });

    expect(destinationsOf(synced)).toEqual(["kds-03.wbhq.com"]);
    expect(
      synced.data!.monitorStepsInstanceArray[0]!.data!.monitorDestination,
    ).toBeInstanceOf(Hostname);
    expect(portsOf(synced)).toEqual(["123"]);
  });

  it("the first step that names an address is the one kept", () => {
    const current: MonitorSteps = buildSteps(MonitorType.Ping, [
      {},
      { destination: IP.fromString("10.48.24.34") },
    ]);

    const synced: MonitorSteps = DeviceMonitorTemplateUtil.keepTargetAddress({
      templateMonitorSteps: buildSteps(MonitorType.Ping),
      currentMonitorSteps: current,
    });

    expect(destinationsOf(synced)).toEqual(["10.48.24.34"]);
  });

  it("a monitor that checks no address is not guessed at", () => {
    expectBadData(() => {
      return DeviceMonitorTemplateUtil.keepTargetAddress({
        templateMonitorSteps: buildSteps(MonitorType.Ping),
        currentMonitorSteps: buildSteps(MonitorType.Ping, [{}]),
      });
    }, "This monitor was made for a network device but checks no address, so a sync cannot tell which address to keep. Set its destination to the device's address, then sync again.");

    expectBadData(() => {
      return DeviceMonitorTemplateUtil.keepTargetAddress({
        templateMonitorSteps: buildSteps(MonitorType.Ping),
        currentMonitorSteps: undefined,
      });
    }, "checks no address");
  });
});

describe("DeviceMonitorTemplateUtil.assertProvenanceFits", () => {
  function networkDeviceSteps(networkDeviceId: string): MonitorSteps {
    const step: MonitorStep = new MonitorStep();
    step.data!.networkDeviceMonitor = {
      networkDeviceId: networkDeviceId,
      monitorInterfaces: true,
      oids: [],
    };
    const steps: MonitorSteps = new MonitorSteps();
    steps.data = {
      monitorStepsInstanceArray: [step],
      defaultMonitorStatusId: ONLINE_ID,
    };
    return steps;
  }

  it("a Network Device monitor must name the device it was made for", () => {
    expect(() => {
      DeviceMonitorTemplateUtil.assertProvenanceFits({
        monitorType: MonitorType.NetworkDevice,
        monitorSteps: networkDeviceSteps(DEVICE_ID.toString()),
        networkDeviceId: DEVICE_ID,
      });
    }).not.toThrow();

    expectBadData(() => {
      DeviceMonitorTemplateUtil.assertProvenanceFits({
        monitorType: MonitorType.NetworkDevice,
        monitorSteps: networkDeviceSteps(OTHER_DEVICE_ID.toString()),
        networkDeviceId: DEVICE_ID,
      });
    }, "An auto-provisioned Network Device monitor cannot be retargeted.");
  });

  it("a Ping, IP, Port or NTP monitor must check an address in every step", () => {
    for (const monitorType of DEVICE_ADDRESS_MONITOR_TYPES) {
      expect(() => {
        DeviceMonitorTemplateUtil.assertProvenanceFits({
          monitorType: monitorType,
          monitorSteps: buildSteps(monitorType, [
            { destination: IP.fromString("10.48.24.33"), port: 9100 },
            { destination: IP.fromString("10.48.24.33"), port: 9100 },
          ]),
          networkDeviceId: DEVICE_ID,
        });
      }).not.toThrow();

      expectBadData(() => {
        DeviceMonitorTemplateUtil.assertProvenanceFits({
          monitorType: monitorType,
          monitorSteps: buildSteps(monitorType, [
            { destination: IP.fromString("10.48.24.33") },
            {},
          ]),
          networkDeviceId: DEVICE_ID,
        });
      }, "A Ping, IP, Port or NTP monitor made for a network device must check the device's address in every step.");
    }
  });

  it("an address monitor with no steps, or steps stored as JSON, is read the same way", () => {
    expectBadData(() => {
      DeviceMonitorTemplateUtil.assertProvenanceFits({
        monitorType: MonitorType.Ping,
        monitorSteps: undefined,
        networkDeviceId: DEVICE_ID,
      });
    }, "must check the device's address in every step");

    expect(() => {
      DeviceMonitorTemplateUtil.assertProvenanceFits({
        monitorType: MonitorType.Ping,
        monitorSteps: buildSteps(MonitorType.Ping).toJSON(),
        networkDeviceId: DEVICE_ID,
      });
    }).not.toThrow();
  });

  it("no other kind of monitor may carry a device's provenance", () => {
    for (const monitorType of [
      MonitorType.Website,
      MonitorType.API,
      MonitorType.Manual,
      undefined,
    ]) {
      expectBadData(() => {
        DeviceMonitorTemplateUtil.assertProvenanceFits({
          monitorType: monitorType,
          monitorSteps: buildSteps(MonitorType.Website, [
            { destination: URL.fromString("https://shop.example.com") },
          ]),
          networkDeviceId: DEVICE_ID,
        });
      }, "Only Network Device, Ping, IP, Port and NTP monitors can carry auto-provisioning provenance.");
    }
  });
});

describe("DeviceMonitorTemplateUtil.buildMonitor", () => {
  it("a Ping template makes a Ping monitor that checks the device's address, linked to both", () => {
    const template: MonitorTemplate = buildTemplate(MonitorType.Ping);
    const monitor: Monitor = DeviceMonitorTemplateUtil.buildMonitor({
      template: template,
      networkDevice: buildDevice(),
    });

    expect(monitor.monitorType).toBe(MonitorType.Ping);
    expect(monitor.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(monitor.name).toBe("WB0024KDS03 - Reachability");
    expect(monitor.description).toBe("Pages the store when a display stops.");
    expect(destinationsOf(monitor.monitorSteps)).toEqual(["10.48.24.33"]);
    expect(monitor.monitoringInterval).toBe("*/5 * * * *");
    expect(monitor.minimumProbeAgreement).toBe(1);
    expect(monitor.monitorTemplateId?.toString()).toBe(TEMPLATE_ID.toString());
    expect(monitor.autoProvisionedNetworkDeviceId?.toString()).toBe(
      DEVICE_ID.toString(),
    );
    expect(criteriaNamesOf(monitor.monitorSteps)).toBe(
      criteriaNamesOf(template.monitorSteps),
    );
  });

  it("is named after the device alone when the template has no monitor name, as Network Device monitors are", () => {
    const template: MonitorTemplate = buildTemplate(MonitorType.Ping);
    delete (template as unknown as Record<string, unknown>)["monitorName"];

    expect(
      DeviceMonitorTemplateUtil.buildMonitor({
        template: template,
        networkDevice: buildDevice(),
      }).name,
    ).toBe(
      NetworkDeviceMonitorTemplateUtil.buildDeviceIdentifiableName({
        monitorTemplate: template,
        networkDevice: buildDevice(),
      }),
    );
    expect(
      DeviceMonitorTemplateUtil.buildMonitor({
        template: template,
        networkDevice: buildDevice(),
      }).name,
    ).toBe("WB0024KDS03");
  });

  it("copies the template's labels and custom fields, never shares them", () => {
    const template: MonitorTemplate = buildTemplate(MonitorType.Ping);
    const monitor: Monitor = DeviceMonitorTemplateUtil.buildMonitor({
      template: template,
      networkDevice: buildDevice(),
    });

    expect(
      (monitor.labels || []).map((label: Label): string => {
        return label.name || "";
      }),
    ).toEqual(["kitchen", "stores"]);
    expect(monitor.labels).not.toBe(template.labels);
    expect(monitor.customFields).toEqual(template.customFields);
    expect(monitor.customFields).not.toBe(template.customFields);
  });

  it("a Port template keeps its ports; an NTP template checks a device named by DNS", () => {
    const port: Monitor = DeviceMonitorTemplateUtil.buildMonitor({
      template: buildTemplate(
        MonitorType.Port,
        buildSteps(MonitorType.Port, [
          { destination: IP.fromString(TEMPLATE_ADDRESS), port: 9100 },
        ]),
      ),
      networkDevice: buildDevice(),
    });

    expect(port.monitorType).toBe(MonitorType.Port);
    expect(destinationsOf(port.monitorSteps)).toEqual(["10.48.24.33"]);
    expect(portsOf(port.monitorSteps)).toEqual(["9100"]);

    const ntp: Monitor = DeviceMonitorTemplateUtil.buildMonitor({
      template: buildTemplate(
        MonitorType.NTP,
        buildSteps(MonitorType.NTP, [
          { destination: new Hostname("time.example.com") },
        ]),
      ),
      networkDevice: buildDevice({ hostname: "core-01.wbhq.com" }),
    });

    expect(ntp.monitorType).toBe(MonitorType.NTP);
    expect(destinationsOf(ntp.monitorSteps)).toEqual(["core-01.wbhq.com"]);
  });

  it("the monitors it makes are valid for their type", () => {
    for (const monitorType of DEVICE_ADDRESS_MONITOR_TYPES) {
      const monitor: Monitor = DeviceMonitorTemplateUtil.buildMonitor({
        template: buildTemplate(
          monitorType,
          buildSteps(monitorType, [
            { destination: IP.fromString(TEMPLATE_ADDRESS), port: 9100 },
          ]),
        ),
        networkDevice: buildDevice(),
      });

      for (const step of monitor.monitorSteps!.data!
        .monitorStepsInstanceArray) {
        expect(MonitorStep.getValidationError(step, monitorType)).toBeNull();
      }

      expect(() => {
        DeviceMonitorTemplateUtil.assertProvenanceFits({
          monitorType: monitor.monitorType,
          monitorSteps: monitor.monitorSteps,
          networkDeviceId: monitor.autoProvisionedNetworkDeviceId!,
        });
      }).not.toThrow();
    }
  });

  it("one template serves a whole estate: each device gets its own address, the template keeps its own", () => {
    const template: MonitorTemplate = buildTemplate(MonitorType.Ping);
    const before: JSONObject = template.monitorSteps!.toJSON();

    const first: Monitor = DeviceMonitorTemplateUtil.buildMonitor({
      template: template,
      networkDevice: buildDevice({ hostname: "10.48.24.33" }),
    });
    const second: Monitor = DeviceMonitorTemplateUtil.buildMonitor({
      template: template,
      networkDevice: buildDevice({ hostname: "10.48.25.33" }),
    });

    expect(destinationsOf(first.monitorSteps)).toEqual(["10.48.24.33"]);
    expect(destinationsOf(second.monitorSteps)).toEqual(["10.48.25.33"]);
    expect(template.monitorSteps!.toJSON()).toEqual(before);
    expect(destinationsOf(template.monitorSteps)).toEqual([TEMPLATE_ADDRESS]);
  });

  it("a Network Device template is built the Network Device way, bound to the device", () => {
    const step: MonitorStep = new MonitorStep();
    step.data!.networkDeviceMonitor = {
      networkDeviceId: OTHER_DEVICE_ID.toString(),
      monitorInterfaces: true,
      oids: [],
    };
    const steps: MonitorSteps = new MonitorSteps();
    steps.data = {
      monitorStepsInstanceArray: [step],
      defaultMonitorStatusId: ONLINE_ID,
    };

    const monitor: Monitor = DeviceMonitorTemplateUtil.buildMonitor({
      template: buildTemplate(MonitorType.NetworkDevice, steps),
      networkDevice: buildDevice(),
    });

    expect(monitor.monitorType).toBe(MonitorType.NetworkDevice);
    expect(
      monitor.monitorSteps!.data!.monitorStepsInstanceArray[0]!.data!
        .networkDeviceMonitor?.networkDeviceId,
    ).toBe(DEVICE_ID.toString());
  });

  it("an IP template cannot make a monitor for a device named by DNS", () => {
    expectBadData(() => {
      DeviceMonitorTemplateUtil.buildMonitor({
        template: buildTemplate(MonitorType.IP),
        networkDevice: buildDevice({ hostname: "kds-03.wbhq.com" }),
      });
    }, "An IP monitor checks an IP address");
  });

  it("refuses a template no device's monitor can be made from", () => {
    expectBadData(() => {
      DeviceMonitorTemplateUtil.buildMonitor({
        template: buildTemplate(
          MonitorType.Website,
          buildSteps(MonitorType.Website, [
            { destination: URL.fromString("https://shop.example.com") },
          ]),
        ),
        networkDevice: buildDevice(),
      });
    }, DEVICE_MONITOR_TEMPLATE_TYPE_REFUSAL);
  });

  it("refuses what it cannot link or place", () => {
    expectBadData(() => {
      DeviceMonitorTemplateUtil.buildMonitor({
        template: withoutId(buildTemplate(MonitorType.Ping)),
        networkDevice: buildDevice(),
      });
    }, "Monitor template ID is required to make a monitor for a device.");

    expectBadData(() => {
      DeviceMonitorTemplateUtil.buildMonitor({
        template: buildTemplate(MonitorType.Ping),
        networkDevice: withoutId(buildDevice()),
      });
    }, "Network Device ID is required to make a monitor for it.");

    const withoutProject: MonitorTemplate = buildTemplate(MonitorType.Ping);
    delete (withoutProject as unknown as Record<string, unknown>)["projectId"];
    expectBadData(() => {
      DeviceMonitorTemplateUtil.buildMonitor({
        template: withoutProject,
        networkDevice: buildDevice(),
      });
    }, "must both belong to a project");

    expectBadData(() => {
      DeviceMonitorTemplateUtil.buildMonitor({
        template: buildTemplate(MonitorType.Ping),
        networkDevice: buildDevice({ projectId: OTHER_PROJECT_ID }),
      });
    }, "Monitor template and Network Device must belong to the same project.");
  });

  it("refuses a template with no steps, and a device with no address", () => {
    expectBadData(() => {
      DeviceMonitorTemplateUtil.buildMonitor({
        template: buildTemplate(MonitorType.Ping, null),
        networkDevice: buildDevice(),
      });
    }, "Monitor template monitor steps are required.");

    expectBadData(() => {
      DeviceMonitorTemplateUtil.buildMonitor({
        template: buildTemplate(MonitorType.Ping),
        networkDevice: buildDevice({ hostname: "" }),
      });
    }, "This device has no address, so a monitor cannot check it.");
  });
});

describe("DeviceMonitorTemplateUtil.readPorts", () => {
  it("each port a Port template's steps check, once, in step order", () => {
    expect(
      DeviceMonitorTemplateUtil.readPorts(
        buildSteps(MonitorType.Port, [
          { destination: IP.fromString(TEMPLATE_ADDRESS), port: 9100 },
          { destination: IP.fromString(TEMPLATE_ADDRESS), port: 22 },
          { destination: IP.fromString(TEMPLATE_ADDRESS), port: 9100 },
        ]),
      ),
    ).toEqual([9100, 22]);
  });

  it("reads steps stored as JSON", () => {
    expect(
      DeviceMonitorTemplateUtil.readPorts(
        buildSteps(MonitorType.Port, [
          { destination: IP.fromString(TEMPLATE_ADDRESS), port: 443 },
        ]).toJSON(),
      ),
    ).toEqual([443]);
  });

  it("none for steps that name no port, no steps, or steps it cannot read", () => {
    expect(
      DeviceMonitorTemplateUtil.readPorts(buildSteps(MonitorType.Ping)),
    ).toEqual([]);
    expect(DeviceMonitorTemplateUtil.readPorts(undefined)).toEqual([]);
    expect(DeviceMonitorTemplateUtil.readPorts(null)).toEqual([]);
    expect(
      DeviceMonitorTemplateUtil.readPorts({
        _type: "Something else",
      } as JSONObject),
    ).toEqual([]);
  });
});
