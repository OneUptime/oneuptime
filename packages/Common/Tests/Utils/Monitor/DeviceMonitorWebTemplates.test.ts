import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorTemplate from "../../../Models/DatabaseModels/MonitorTemplate";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import URL from "../../../Types/API/URL";
import BadDataException from "../../../Types/Exception/BadDataException";
import IP from "../../../Types/IP/IP";
import { JSONObject } from "../../../Types/JSON";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import DeviceMonitorTemplateUtil, {
  DEVICE_URL_MONITOR_TYPES,
} from "../../../Utils/Monitor/DeviceMonitorTemplateUtil";
import {
  URL_TEMPLATE_HOST_IS_VARIABLE,
  URL_TEMPLATE_NEEDS_HOST,
  URL_TEMPLATE_NEEDS_URL,
  URL_TEMPLATE_NEEDS_WEB_SCHEME,
  URL_TEMPLATE_PORT_NOT_A_NUMBER,
} from "../../../Utils/Monitor/DeviceUrlTarget";
import { describe, expect, it } from "@jest/globals";

/*
 * A WEBSITE, API OR SSL CERTIFICATE TEMPLATE, ON EACH DEVICE (OneUptime issue
 * #9546).
 *
 * A discovery import and an auto import rule give each device a monitor from
 * a template. A web template's steps check a URL: each device's monitor
 * checks that URL with the device's address as its host, and every other
 * part of it as the template wrote it, so whoever writes the template
 * decides the scheme, the port and the path on every device. A template sync
 * keeps each device's host, provenance takes the new kinds, and a template
 * whose URL has no host a device's address can take is refused, with what to
 * change. (DeviceUrlTarget's own suite holds the URL arithmetic.)
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const TEMPLATE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const DEVICE_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
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

function expectBadData(run: () => unknown, message: string): void {
  expect(run).toThrow(BadDataException);
  expect(run).toThrow(message);
}

interface StepInput {
  destination?: URL | IP | undefined;
}

// One step of the type's own defaults, the way the template form makes one.
function buildStep(data: {
  monitorType: MonitorType;
  id: string;
  destination?: URL | IP | undefined;
}): MonitorStep {
  const step: MonitorStep = MonitorStep.getDefaultMonitorStep({
    monitorName: "Printer web UI",
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

  return step;
}

function buildSteps(
  monitorType: MonitorType,
  steps: Array<StepInput>,
): MonitorSteps {
  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: steps.map(
      (step: StepInput, index: number): MonitorStep => {
        return buildStep({
          monitorType: monitorType,
          id: `step-${index + 1}`,
          destination: step.destination,
        });
      },
    ),
    defaultMonitorStatusId: ONLINE_ID,
  };
  return monitorSteps;
}

/*
 * As a stored step's URL is read (URL.fromJSON is lenient): a host written
 * as a variable is no valid host, and comes back as the URL it was written.
 */
function urlStep(url: string): StepInput {
  return { destination: URL.fromStringLenient(url) };
}

function buildTemplate(
  monitorType: MonitorType,
  monitorSteps: MonitorSteps,
): MonitorTemplate {
  const template: MonitorTemplate = new MonitorTemplate();
  template.id = TEMPLATE_ID;
  template.projectId = PROJECT_ID;
  template.templateName = "Printer web UI";
  template.monitorName = "Web UI";
  template.monitorType = monitorType;
  template.monitorSteps = monitorSteps;
  template.monitoringInterval = "*/5 * * * *";
  template.minimumProbeAgreement = 1;
  return template;
}

function buildDevice(hostname: string = "10.48.24.33"): NetworkDevice {
  const device: NetworkDevice = new NetworkDevice();
  device.id = DEVICE_ID;
  device.projectId = PROJECT_ID;
  device.name = "PRN-0024";
  device.hostname = hostname;
  return device;
}

function destinationsOf(monitorSteps: MonitorSteps | undefined): Array<string> {
  return (monitorSteps?.data?.monitorStepsInstanceArray || []).map(
    (step: MonitorStep): string => {
      return step.data?.monitorDestination?.toString() || "";
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

describe("retargetMonitorSteps, for a web template", () => {
  it("puts the device's address in the host of every step's URL, and keeps the scheme, port, path and query", () => {
    for (const monitorType of DEVICE_URL_MONITOR_TYPES) {
      const steps: MonitorSteps = buildSteps(monitorType, [
        urlStep("https://device:8443/status?verbose=1"),
        urlStep("http://device/hp/device/info"),
      ]);

      const retargeted: MonitorSteps =
        DeviceMonitorTemplateUtil.retargetMonitorSteps({
          monitorSteps: steps,
          address: "10.48.24.33",
          monitorType: monitorType,
        });

      expect(destinationsOf(retargeted)).toEqual([
        "https://10.48.24.33:8443/status?verbose=1",
        "http://10.48.24.33/hp/device/info",
      ]);
      // The template's steps stay the template's: one serves every device.
      expect(destinationsOf(steps)).toEqual([
        "https://device:8443/status?verbose=1",
        "http://device/hp/device/info",
      ]);
    }
  });

  it("keeps a secret in the query or the password exactly as written, for the probe to put in", () => {
    const retargeted: MonitorSteps =
      DeviceMonitorTemplateUtil.retargetMonitorSteps({
        monitorSteps: buildSteps(MonitorType.API, [
          urlStep(
            "https://admin:{{monitorSecrets.UpsPassword}}@ups:8443/api/status?token={{monitorSecrets.UpsToken}}",
          ),
        ]),
        address: "10.20.0.9",
        monitorType: MonitorType.API,
      });

    expect(destinationsOf(retargeted)).toEqual([
      "https://admin:{{monitorSecrets.UpsPassword}}@10.20.0.9:8443/api/status?token={{monitorSecrets.UpsToken}}",
    ]);
  });

  it("writes an IPv6 address in brackets and a name as it is, and the template decides the port", () => {
    const retarget: (address: string) => string = (address: string): string => {
      return destinationsOf(
        DeviceMonitorTemplateUtil.retargetMonitorSteps({
          monitorSteps: buildSteps(MonitorType.Website, [
            urlStep("https://device:8443/"),
          ]),
          address: address,
          monitorType: MonitorType.Website,
        }),
      )[0]!;
    };

    expect(retarget("2001:db8::1")).toBe("https://[2001:db8::1]:8443/");
    expect(retarget("[2001:db8::1]")).toBe("https://[2001:db8::1]:8443/");
    expect(retarget("printer-01.example.net")).toBe(
      "https://printer-01.example.net:8443/",
    );
    expect(retarget("10.48.24.33:8080")).toBe("https://10.48.24.33:8443/");
  });

  it("keeps the rest of each step: its id, timeout, retries, criteria and self-signed choice", () => {
    const steps: MonitorSteps = buildSteps(MonitorType.Website, [
      urlStep("https://device/"),
    ]);
    steps.data!.monitorStepsInstanceArray[0]!.data!.allowSelfSignedCertificates =
      true;

    const retargeted: MonitorSteps =
      DeviceMonitorTemplateUtil.retargetMonitorSteps({
        monitorSteps: steps,
        address: "10.48.24.33",
        monitorType: MonitorType.Website,
      });
    const step: MonitorStep = retargeted.data!.monitorStepsInstanceArray[0]!;

    expect(step.data?.id).toBe("step-1");
    expect(step.data?.requestTimeoutInMs).toBe(4000);
    expect(step.data?.retryCount).toBe(2);
    expect(step.data?.allowSelfSignedCertificates).toBe(true);
    expect(criteriaNamesOf(retargeted)).toBe(criteriaNamesOf(steps));
  });

  it("refuses a step whose URL a device's address cannot be put in, with what to change", () => {
    const cases: Array<[Array<StepInput>, string]> = [
      [
        [urlStep("https://{{monitorSecrets.host}}/status")],
        URL_TEMPLATE_HOST_IS_VARIABLE,
      ],
      [[{ destination: IP.fromString("192.0.2.10") }], URL_TEMPLATE_NEEDS_URL],
      [[{}], URL_TEMPLATE_NEEDS_URL],
    ];

    for (const [steps, message] of cases) {
      expectBadData(() => {
        DeviceMonitorTemplateUtil.retargetMonitorSteps({
          monitorSteps: buildSteps(MonitorType.Website, steps),
          address: "10.48.24.33",
          monitorType: MonitorType.Website,
        });
      }, message);
    }
  });

  it("a device with no address cannot be checked", () => {
    expectBadData(() => {
      DeviceMonitorTemplateUtil.retargetMonitorSteps({
        monitorSteps: buildSteps(MonitorType.SSLCertificate, [
          urlStep("https://device/"),
        ]),
        address: " ",
        monitorType: MonitorType.SSLCertificate,
      });
    }, "This device has no address, so a monitor cannot check it.");
  });
});

describe("keepTargetAddress, for a web monitor", () => {
  it("a sync brings the template's scheme, port and path, and keeps the device's host", () => {
    const synced: MonitorSteps = DeviceMonitorTemplateUtil.keepTargetAddress({
      templateMonitorSteps: buildSteps(MonitorType.Website, [
        urlStep("http://device:8080/new/status"),
      ]),
      currentMonitorSteps: buildSteps(MonitorType.Website, [
        urlStep("https://10.48.24.33:8443/old"),
      ]).toJSON(),
      monitorType: MonitorType.Website,
    });

    expect(destinationsOf(synced)).toEqual([
      "http://10.48.24.33:8080/new/status",
    ]);
  });

  it("reads the kind from the template's steps when it is not handed one", () => {
    const synced: MonitorSteps = DeviceMonitorTemplateUtil.keepTargetAddress({
      templateMonitorSteps: buildSteps(MonitorType.API, [
        urlStep("https://device/api/health"),
      ]),
      currentMonitorSteps: buildSteps(MonitorType.API, [
        urlStep("https://[2001:db8::1]/api/health"),
      ]),
    });

    expect(destinationsOf(synced)).toEqual([
      "https://[2001:db8::1]/api/health",
    ]);
  });

  it("a monitor whose URL names no device is not guessed at", () => {
    expectBadData(() => {
      DeviceMonitorTemplateUtil.keepTargetAddress({
        templateMonitorSteps: buildSteps(MonitorType.Website, [
          urlStep("https://device/"),
        ]),
        currentMonitorSteps: buildSteps(MonitorType.Website, [{}]),
        monitorType: MonitorType.Website,
      });
    }, "its URL names no host, so a sync cannot tell which device to keep checking");
  });

  it("an address monitor still keeps its address, as before", () => {
    const synced: MonitorSteps = DeviceMonitorTemplateUtil.keepTargetAddress({
      templateMonitorSteps: buildSteps(MonitorType.Ping, [
        { destination: IP.fromString("192.0.2.10") },
      ]),
      currentMonitorSteps: buildSteps(MonitorType.Ping, [
        { destination: IP.fromString("10.48.24.33") },
      ]),
      monitorType: MonitorType.Ping,
    });

    expect(destinationsOf(synced)).toEqual(["10.48.24.33"]);
  });
});

describe("buildMonitor, from a web template", () => {
  it("a Website template makes a Website monitor of the device's own page, linked to both", () => {
    const template: MonitorTemplate = buildTemplate(
      MonitorType.Website,
      buildSteps(MonitorType.Website, [urlStep("https://printer:8443/status")]),
    );
    const monitor: Monitor = DeviceMonitorTemplateUtil.buildMonitor({
      template: template,
      networkDevice: buildDevice(),
    });

    expect(monitor.monitorType).toBe(MonitorType.Website);
    expect(destinationsOf(monitor.monitorSteps)).toEqual([
      "https://10.48.24.33:8443/status",
    ]);
    expect(monitor.name).toBe("PRN-0024 - Web UI");
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

  it("the monitors it makes are valid for their type, and fit the device's provenance", () => {
    for (const monitorType of DEVICE_URL_MONITOR_TYPES) {
      const monitor: Monitor = DeviceMonitorTemplateUtil.buildMonitor({
        template: buildTemplate(
          monitorType,
          buildSteps(monitorType, [urlStep("https://device/")]),
        ),
        networkDevice: buildDevice("ups-01.example.net"),
      });

      expect(monitor.monitorType).toBe(monitorType);
      expect(destinationsOf(monitor.monitorSteps)).toEqual([
        "https://ups-01.example.net/",
      ]);

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

  it("one template serves a whole estate: each device gets its own host, the template keeps its own", () => {
    const template: MonitorTemplate = buildTemplate(
      MonitorType.SSLCertificate,
      buildSteps(MonitorType.SSLCertificate, [urlStep("https://camera/")]),
    );
    const before: JSONObject = template.monitorSteps!.toJSON();

    const first: Monitor = DeviceMonitorTemplateUtil.buildMonitor({
      template: template,
      networkDevice: buildDevice("10.48.24.33"),
    });
    const second: Monitor = DeviceMonitorTemplateUtil.buildMonitor({
      template: template,
      networkDevice: buildDevice("10.48.25.33"),
    });

    expect(destinationsOf(first.monitorSteps)).toEqual([
      "https://10.48.24.33/",
    ]);
    expect(destinationsOf(second.monitorSteps)).toEqual([
      "https://10.48.25.33/",
    ]);
    expect(template.monitorSteps!.toJSON()).toEqual(before);
  });

  it("refuses a template whose URL has no host a device's address can take", () => {
    expectBadData(() => {
      DeviceMonitorTemplateUtil.buildMonitor({
        template: buildTemplate(
          MonitorType.Website,
          buildSteps(MonitorType.Website, [
            urlStep("https://{{monitorSecrets.host}}/"),
          ]),
        ),
        networkDevice: buildDevice(),
      });
    }, URL_TEMPLATE_HOST_IS_VARIABLE);
  });
});

describe("assertProvenanceFits, for a web monitor", () => {
  it("accepts one that checks a URL with a host in every step", () => {
    for (const monitorType of DEVICE_URL_MONITOR_TYPES) {
      expect(() => {
        DeviceMonitorTemplateUtil.assertProvenanceFits({
          monitorType: monitorType,
          monitorSteps: buildSteps(monitorType, [
            urlStep("https://10.48.24.33:8443/status"),
          ]).toJSON(),
          networkDeviceId: DEVICE_ID,
        });
      }).not.toThrow();
    }
  });

  it("refuses one with a step on an address, or with no steps", () => {
    for (const monitorType of DEVICE_URL_MONITOR_TYPES) {
      expectBadData(() => {
        DeviceMonitorTemplateUtil.assertProvenanceFits({
          monitorType: monitorType,
          monitorSteps: buildSteps(monitorType, [
            urlStep("https://10.48.24.33/"),
            { destination: IP.fromString("10.48.24.33") },
          ]),
          networkDeviceId: DEVICE_ID,
        });
      }, "A Website, API or SSL Certificate monitor made for a network device must check a URL on the device's address in every step.");

      expectBadData(() => {
        DeviceMonitorTemplateUtil.assertProvenanceFits({
          monitorType: monitorType,
          monitorSteps: buildSteps(monitorType, []),
          networkDeviceId: DEVICE_ID,
        });
      }, "must check a URL on the device's address in every step");
    }
  });
});

describe("assertDeviceTemplateSteps, for a web template", () => {
  it("accepts one whose every step checks a URL with a host", () => {
    for (const monitorType of DEVICE_URL_MONITOR_TYPES) {
      expect(() => {
        DeviceMonitorTemplateUtil.assertDeviceTemplateSteps({
          monitorType: monitorType,
          monitorSteps: buildSteps(monitorType, [
            urlStep("https://device:8443/status"),
            urlStep("http://device/"),
          ]).toJSON(),
        });
      }).not.toThrow();
    }
  });

  it("refuses each URL a device's address cannot be put in, saying what to change", () => {
    const cases: Array<[Array<StepInput>, string]> = [
      [
        [urlStep("https://{{monitorSecrets.host}}/")],
        URL_TEMPLATE_HOST_IS_VARIABLE,
      ],
      [[urlStep("https://device/"), {}], URL_TEMPLATE_NEEDS_URL],
      [
        [
          urlStep("https://device/"),
          { destination: IP.fromString("192.0.2.10") },
        ],
        URL_TEMPLATE_NEEDS_URL,
      ],
    ];

    for (const [steps, message] of cases) {
      expectBadData(() => {
        DeviceMonitorTemplateUtil.assertDeviceTemplateSteps({
          monitorType: MonitorType.API,
          monitorSteps: buildSteps(MonitorType.API, steps),
        });
      }, message);
    }
  });

  it("every refusal is a sentence that says what to do about the template", () => {
    for (const message of [
      URL_TEMPLATE_HOST_IS_VARIABLE,
      URL_TEMPLATE_NEEDS_URL,
      URL_TEMPLATE_NEEDS_HOST,
      URL_TEMPLATE_NEEDS_WEB_SCHEME,
      URL_TEMPLATE_PORT_NOT_A_NUMBER,
    ]) {
      expect(message).toMatch(/^[A-Z].*\.$/);
      expect(message).toContain("then pick it again");
    }
  });

  it("refuses a web template with no steps, as it does an address one", () => {
    expectBadData(() => {
      DeviceMonitorTemplateUtil.assertDeviceTemplateSteps({
        monitorType: MonitorType.SSLCertificate,
        monitorSteps: undefined,
      });
    }, "This monitor template has no steps");
  });
});

describe("readTemplateUrl", () => {
  it("is the URL the first step that names one checks, as written", () => {
    expect(
      DeviceMonitorTemplateUtil.readTemplateUrl(
        buildSteps(MonitorType.Website, [
          {},
          urlStep("https://device:8443/status"),
          urlStep("https://device/other"),
        ]).toJSON(),
      ),
    ).toBe("https://device:8443/status");
  });

  it("is empty for steps that name no URL, no steps, or steps it cannot read", () => {
    expect(
      DeviceMonitorTemplateUtil.readTemplateUrl(
        buildSteps(MonitorType.Ping, [
          { destination: IP.fromString("192.0.2.10") },
        ]),
      ),
    ).toBe("");
    expect(DeviceMonitorTemplateUtil.readTemplateUrl(undefined)).toBe("");
    expect(
      DeviceMonitorTemplateUtil.readTemplateUrl({
        nonsense: true,
      } as unknown as JSONObject),
    ).toBe("");
  });
});
