import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorTemplate from "../../../Models/DatabaseModels/MonitorTemplate";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import ColumnLength from "../../../Types/Database/ColumnLength";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import NetworkDeviceMonitorTemplateUtil from "../../../Utils/Monitor/NetworkDeviceMonitorTemplateUtil";
import { describe, expect, it } from "@jest/globals";

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
const TEMPLATE_DEVICE_ID_ONE: string = "55555555-5555-4555-8555-555555555555";
const TEMPLATE_DEVICE_ID_TWO: string = "66666666-6666-4666-8666-666666666666";
const CURRENT_DEVICE_ID: string = "77777777-7777-4777-8777-777777777777";
const FALLBACK_DEVICE_ID: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888888",
);
const DEFAULT_MONITOR_STATUS_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);

function buildStep(
  networkDeviceId: string | undefined,
  suffix: string,
): MonitorStep {
  const step: MonitorStep = new MonitorStep();
  step.data!.id = `step-${suffix}`;
  step.data!.networkDeviceMonitor = {
    networkDeviceId,
    monitorInterfaces: false,
    collectEndpoints: true,
    oids: [
      {
        oid: `1.3.6.1.4.1.${suffix}`,
        name: `health-${suffix}`,
        description: `Health OID ${suffix}`,
      },
    ],
  };
  step.data!.requestBody = `preserve-${suffix}`;
  return step;
}

function buildSteps(
  bindings: Array<string | undefined> = [TEMPLATE_DEVICE_ID_ONE],
): MonitorSteps {
  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: bindings.map(
      (binding: string | undefined, index: number): MonitorStep => {
        return buildStep(binding, String(index + 1));
      },
    ),
    defaultMonitorStatusId: DEFAULT_MONITOR_STATUS_ID,
  };
  return monitorSteps;
}

function buildLabel(id: string, name: string): Label {
  const label: Label = new Label();
  label.id = new ObjectID(id);
  label.name = name;
  return label;
}

function buildTemplate(data?: {
  withId?: boolean | undefined;
  projectId?: ObjectID | undefined;
  monitorType?: MonitorType | undefined;
  monitorSteps?: MonitorSteps | undefined;
  monitorName?: string | undefined;
}): MonitorTemplate {
  const template: MonitorTemplate = new MonitorTemplate();

  if (data?.withId !== false) {
    template.id = TEMPLATE_ID;
  }

  if (!data || !("projectId" in data)) {
    template.projectId = PROJECT_ID;
  } else if (data.projectId) {
    template.projectId = data.projectId;
  }
  template.monitorType = data?.monitorType || MonitorType.NetworkDevice;
  if (!data || !("monitorName" in data)) {
    template.monitorName = "Standard Network Alerting";
  } else if (data.monitorName !== undefined) {
    template.monitorName = data.monitorName;
  }
  template.monitorDescription =
    "Alert on reachability, interfaces, and health OIDs.";
  if (!data || !("monitorSteps" in data)) {
    template.monitorSteps = buildSteps([
      TEMPLATE_DEVICE_ID_ONE,
      TEMPLATE_DEVICE_ID_TWO,
    ]);
  } else if (data.monitorSteps) {
    template.monitorSteps = data.monitorSteps;
  }
  template.monitoringInterval = "*/5 * * * *";
  template.minimumProbeAgreement = 2;
  template.customFields = {
    environment: "production",
    nested: {
      enabled: true,
      thresholds: [70, 90],
    },
  };
  template.labels = [
    buildLabel("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "network"),
    buildLabel("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "production"),
  ];

  return template;
}

function buildDevice(data?: {
  withId?: boolean | undefined;
  projectId?: ObjectID | undefined;
  name?: string | undefined;
  hostname?: string | undefined;
}): NetworkDevice {
  const networkDevice: NetworkDevice = new NetworkDevice();

  if (data?.withId !== false) {
    networkDevice.id = DEVICE_ID;
  }

  if (!data || !("projectId" in data)) {
    networkDevice.projectId = PROJECT_ID;
  } else if (data.projectId) {
    networkDevice.projectId = data.projectId;
  }
  if (!data || !("name" in data)) {
    networkDevice.name = "London Core Switch";
  } else if (data.name !== undefined) {
    networkDevice.name = data.name;
  }
  if (!data || !("hostname" in data)) {
    networkDevice.hostname = "10.10.0.1";
  } else if (data.hostname !== undefined) {
    networkDevice.hostname = data.hostname;
  }
  return networkDevice;
}

function getProvisionedDeviceId(monitor: Monitor): string | undefined {
  return monitor.autoProvisionedNetworkDeviceId?.toString();
}

function expectBadData(run: () => unknown, message: string): void {
  expect(run).toThrow(BadDataException);
  expect(run).toThrow(message);
}

describe("NetworkDeviceMonitorTemplateUtil.buildMonitor", () => {
  it("materializes and links every supported Monitor field", () => {
    const template: MonitorTemplate = buildTemplate();
    const monitor: Monitor = NetworkDeviceMonitorTemplateUtil.buildMonitor({
      template,
      networkDevice: buildDevice(),
    });

    expect(monitor.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(monitor.name).toBe("London Core Switch - Standard Network Alerting");
    expect(monitor.description).toBe(template.monitorDescription);
    expect(monitor.monitorType).toBe(MonitorType.NetworkDevice);
    expect(monitor.monitoringInterval).toBe(template.monitoringInterval);
    expect(monitor.minimumProbeAgreement).toBe(2);
    expect(monitor.customFields).toEqual(template.customFields);
    expect(
      monitor.labels?.map((label: Label): string => {
        return label.id!.toString();
      }),
    ).toEqual(
      template.labels?.map((label: Label): string => {
        return label.id!.toString();
      }),
    );
    expect(monitor.monitorTemplateId?.toString()).toBe(TEMPLATE_ID.toString());
    expect(getProvisionedDeviceId(monitor)).toBe(DEVICE_ID.toString());
  });

  it("rebinds every template step to the target device", () => {
    const monitor: Monitor = NetworkDeviceMonitorTemplateUtil.buildMonitor({
      template: buildTemplate(),
      networkDevice: buildDevice(),
    });

    expect(
      monitor.monitorSteps?.data?.monitorStepsInstanceArray.map(
        (step: MonitorStep): string | undefined => {
          return step.data?.networkDeviceMonitor?.networkDeviceId;
        },
      ),
    ).toEqual([DEVICE_ID.toString(), DEVICE_ID.toString()]);
    expect(monitor.monitorSteps?.data?.defaultMonitorStatusId?.toString()).toBe(
      DEFAULT_MONITOR_STATUS_ID.toString(),
    );
  });

  it("deep-clones steps and never mutates the reusable template", () => {
    const template: MonitorTemplate = buildTemplate();
    const originalStepsJson: JSONObject = template.monitorSteps!.toJSON();
    const monitor: Monitor = NetworkDeviceMonitorTemplateUtil.buildMonitor({
      template,
      networkDevice: buildDevice(),
    });

    expect(monitor.monitorSteps).not.toBe(template.monitorSteps);
    expect(monitor.monitorSteps?.data?.monitorStepsInstanceArray[0]).not.toBe(
      template.monitorSteps?.data?.monitorStepsInstanceArray[0],
    );
    expect(template.monitorSteps!.toJSON()).toEqual(originalStepsJson);

    monitor.monitorSteps!.data!.monitorStepsInstanceArray[0]!.data!.networkDeviceMonitor!.oids[0]!.name =
      "changed on monitor";

    expect(
      template.monitorSteps?.data?.monitorStepsInstanceArray[0]?.data
        ?.networkDeviceMonitor?.oids[0]?.name,
    ).toBe("health-1");
  });

  it("copies custom fields deeply and labels into a distinct relation array", () => {
    const template: MonitorTemplate = buildTemplate();
    const monitor: Monitor = NetworkDeviceMonitorTemplateUtil.buildMonitor({
      template,
      networkDevice: buildDevice(),
    });

    expect(monitor.customFields).not.toBe(template.customFields);
    expect(monitor.customFields?.["nested"]).not.toBe(
      template.customFields?.["nested"],
    );
    expect(monitor.labels).not.toBe(template.labels);

    (monitor.customFields!["nested"] as JSONObject)["enabled"] = false;
    monitor.labels!.pop();

    expect((template.customFields!["nested"] as JSONObject)["enabled"]).toBe(
      true,
    );
    expect(template.labels).toHaveLength(2);
  });

  it("preserves explicit empty labels and custom fields", () => {
    const template: MonitorTemplate = buildTemplate();
    template.labels = [];
    template.customFields = {};

    const monitor: Monitor = NetworkDeviceMonitorTemplateUtil.buildMonitor({
      template,
      networkDevice: buildDevice(),
    });

    expect(monitor.labels).toEqual([]);
    expect(monitor.customFields).toEqual({});
    expect(monitor.labels).not.toBe(template.labels);
    expect(monitor.customFields).not.toBe(template.customFields);
  });

  it("uses the hostname when the device name is blank", () => {
    const monitor: Monitor = NetworkDeviceMonitorTemplateUtil.buildMonitor({
      template: buildTemplate(),
      networkDevice: buildDevice({ name: "   ", hostname: "10.20.30.40" }),
    });

    expect(monitor.name).toBe("10.20.30.40 - Standard Network Alerting");
  });

  it("uses the device id when both friendly identity fields are blank", () => {
    const monitor: Monitor = NetworkDeviceMonitorTemplateUtil.buildMonitor({
      template: buildTemplate({ monitorName: "   " }),
      networkDevice: buildDevice({ name: " ", hostname: " " }),
    });

    expect(monitor.name).toBe(
      `Network Device ${DEVICE_ID.toString()} - Monitor`,
    );
    expect(monitor.name?.trim()).not.toBe("");
  });

  it("caps names at ShortText without leaving half a surrogate pair", () => {
    const monitor: Monitor = NetworkDeviceMonitorTemplateUtil.buildMonitor({
      template: buildTemplate({ monitorName: "🔥 alerting" }),
      networkDevice: buildDevice({ name: "d".repeat(96) }),
    });
    const loneSurrogate: RegExp =
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/;

    expect(monitor.name!.length).toBeLessThanOrEqual(ColumnLength.ShortText);
    expect(monitor.name!.length).toBe(99);
    expect(loneSurrogate.test(monitor.name!)).toBe(false);
    expect(monitor.name!.startsWith("d".repeat(96))).toBe(true);
  });

  it("keeps a composed name exactly at the column limit", () => {
    const deviceName: string = "d".repeat(80);
    const templateName: string = "t".repeat(17);
    const monitor: Monitor = NetworkDeviceMonitorTemplateUtil.buildMonitor({
      template: buildTemplate({ monitorName: templateName }),
      networkDevice: buildDevice({ name: deviceName }),
    });

    expect(monitor.name).toBe(`${deviceName} - ${templateName}`);
    expect(monitor.name).toHaveLength(ColumnLength.ShortText);
  });

  it("rejects a template without an id", () => {
    expectBadData(() => {
      return NetworkDeviceMonitorTemplateUtil.buildMonitor({
        template: buildTemplate({ withId: false }),
        networkDevice: buildDevice(),
      });
    }, "Monitor template ID is required");
  });

  it("rejects a Network Device without an id", () => {
    expectBadData(() => {
      return NetworkDeviceMonitorTemplateUtil.buildMonitor({
        template: buildTemplate(),
        networkDevice: buildDevice({ withId: false }),
      });
    }, "Network Device ID is required");
  });

  it("rejects a template without a project id", () => {
    expectBadData(() => {
      return NetworkDeviceMonitorTemplateUtil.buildMonitor({
        template: buildTemplate({ projectId: undefined }),
        networkDevice: buildDevice(),
      });
    }, "Monitor template project ID is required");
  });

  it("rejects a Network Device without a project id", () => {
    expectBadData(() => {
      return NetworkDeviceMonitorTemplateUtil.buildMonitor({
        template: buildTemplate(),
        networkDevice: buildDevice({ projectId: undefined }),
      });
    }, "Network Device project ID is required");
  });

  it("rejects cross-project materialization", () => {
    expectBadData(() => {
      return NetworkDeviceMonitorTemplateUtil.buildMonitor({
        template: buildTemplate(),
        networkDevice: buildDevice({ projectId: OTHER_PROJECT_ID }),
      });
    }, "must belong to the same project");
  });

  it("rejects templates for another Monitor type", () => {
    expectBadData(() => {
      return NetworkDeviceMonitorTemplateUtil.buildMonitor({
        template: buildTemplate({ monitorType: MonitorType.Ping }),
        networkDevice: buildDevice(),
      });
    }, 'must have type "Network Device"');
  });

  it("rejects an absent MonitorSteps object", () => {
    expectBadData(() => {
      return NetworkDeviceMonitorTemplateUtil.buildMonitor({
        template: buildTemplate({ monitorSteps: undefined }),
        networkDevice: buildDevice(),
      });
    }, "Monitor template monitor steps are required");
  });

  it("rejects MonitorSteps with no data", () => {
    const steps: MonitorSteps = buildSteps();
    steps.data = undefined;

    expectBadData(() => {
      return NetworkDeviceMonitorTemplateUtil.buildMonitor({
        template: buildTemplate({ monitorSteps: steps }),
        networkDevice: buildDevice(),
      });
    }, "Monitor template monitor steps are required");
  });

  it("rejects an empty step list", () => {
    expectBadData(() => {
      return NetworkDeviceMonitorTemplateUtil.buildMonitor({
        template: buildTemplate({ monitorSteps: buildSteps([]) }),
        networkDevice: buildDevice(),
      });
    }, "Monitor template monitor steps are required");
  });

  it.each([undefined, {}])(
    "rejects a malformed step-list value without leaking a TypeError",
    (stepList: unknown) => {
      const steps: MonitorSteps = new MonitorSteps();
      steps.data = {
        monitorStepsInstanceArray: stepList,
      } as never;

      expectBadData(() => {
        NetworkDeviceMonitorTemplateUtil.validateMonitorSteps(
          steps,
          "Monitor template",
        );
      }, "Monitor template monitor steps are required");
    },
  );
});

describe("NetworkDeviceMonitorTemplateUtil.rebindMonitorSteps", () => {
  it("returns an independent full clone with every step rebound", () => {
    const source: MonitorSteps = buildSteps([
      TEMPLATE_DEVICE_ID_ONE,
      TEMPLATE_DEVICE_ID_TWO,
    ]);
    const rebound: MonitorSteps =
      NetworkDeviceMonitorTemplateUtil.rebindMonitorSteps({
        monitorSteps: source,
        networkDeviceId: DEVICE_ID,
      });

    expect(rebound).not.toBe(source);
    expect(rebound.data?.defaultMonitorStatusId?.toString()).toBe(
      DEFAULT_MONITOR_STATUS_ID.toString(),
    );
    expect(
      rebound.data?.monitorStepsInstanceArray.map(
        (step: MonitorStep): string | undefined => {
          return step.data?.networkDeviceMonitor?.networkDeviceId;
        },
      ),
    ).toEqual([DEVICE_ID.toString(), DEVICE_ID.toString()]);
    expect(rebound.data?.monitorStepsInstanceArray[1]?.data?.requestBody).toBe(
      "preserve-2",
    );
    expect(
      source.data?.monitorStepsInstanceArray.map(
        (step: MonitorStep): string | undefined => {
          return step.data?.networkDeviceMonitor?.networkDeviceId;
        },
      ),
    ).toEqual([TEMPLATE_DEVICE_ID_ONE, TEMPLATE_DEVICE_ID_TWO]);
  });

  it("accepts a serialized target id", () => {
    const rebound: MonitorSteps =
      NetworkDeviceMonitorTemplateUtil.rebindMonitorSteps({
        monitorSteps: buildSteps(),
        networkDeviceId: DEVICE_ID.toString(),
      });

    expect(
      rebound.data?.monitorStepsInstanceArray[0]?.data?.networkDeviceMonitor
        ?.networkDeviceId,
    ).toBe(DEVICE_ID.toString());
  });

  it("rejects a blank target id", () => {
    expectBadData(() => {
      return NetworkDeviceMonitorTemplateUtil.rebindMonitorSteps({
        monitorSteps: buildSteps(),
        networkDeviceId: "   ",
      });
    }, "Network Device ID is required");
  });

  it("rejects a missing source step object", () => {
    expectBadData(() => {
      return NetworkDeviceMonitorTemplateUtil.rebindMonitorSteps({
        monitorSteps: undefined,
        networkDeviceId: DEVICE_ID,
      });
    }, "Monitor template monitor steps are required");
  });

  it("rejects a malformed Network Device step", () => {
    const steps: MonitorSteps = buildSteps();
    steps.data!.monitorStepsInstanceArray[0]!.data!.networkDeviceMonitor =
      undefined;

    expectBadData(() => {
      return NetworkDeviceMonitorTemplateUtil.rebindMonitorSteps({
        monitorSteps: steps,
        networkDeviceId: DEVICE_ID,
      });
    }, "without Network Device configuration");
  });
});

describe("NetworkDeviceMonitorTemplateUtil.assertMonitorStepsBoundToNetworkDevice", () => {
  it("accepts multiple steps that all retain the provisioned device", () => {
    expect(() => {
      NetworkDeviceMonitorTemplateUtil.assertMonitorStepsBoundToNetworkDevice({
        monitorSteps: buildSteps([DEVICE_ID.toString(), DEVICE_ID.toString()]),
        networkDeviceId: DEVICE_ID,
      });
    }).not.toThrow();
  });

  it("rejects a retargeted or mixed-device step set", () => {
    expectBadData(() => {
      NetworkDeviceMonitorTemplateUtil.assertMonitorStepsBoundToNetworkDevice({
        monitorSteps: buildSteps([
          DEVICE_ID.toString(),
          TEMPLATE_DEVICE_ID_ONE,
        ]),
        networkDeviceId: DEVICE_ID,
      });
    }, "cannot be retargeted");
  });
});

describe("NetworkDeviceMonitorTemplateUtil.buildSyncedMonitorSteps", () => {
  it("preserves one current binding across every newly-synced template step", () => {
    const templateSteps: MonitorSteps = buildSteps([
      TEMPLATE_DEVICE_ID_ONE,
      TEMPLATE_DEVICE_ID_TWO,
    ]);
    const templateJsonBefore: JSONObject = templateSteps.toJSON();
    const synced: MonitorSteps =
      NetworkDeviceMonitorTemplateUtil.buildSyncedMonitorSteps({
        templateMonitorSteps: templateSteps,
        currentMonitorSteps: buildSteps([CURRENT_DEVICE_ID, CURRENT_DEVICE_ID]),
      });

    expect(
      synced.data?.monitorStepsInstanceArray.map(
        (step: MonitorStep): string | undefined => {
          return step.data?.networkDeviceMonitor?.networkDeviceId;
        },
      ),
    ).toEqual([CURRENT_DEVICE_ID, CURRENT_DEVICE_ID]);
    expect(templateSteps.toJSON()).toEqual(templateJsonBefore);
    expect(synced).not.toBe(templateSteps);
  });

  it("prefers the current binding over a different fallback marker", () => {
    const synced: MonitorSteps =
      NetworkDeviceMonitorTemplateUtil.buildSyncedMonitorSteps({
        templateMonitorSteps: buildSteps(),
        currentMonitorSteps: buildSteps([CURRENT_DEVICE_ID]),
        fallbackNetworkDeviceId: FALLBACK_DEVICE_ID,
      });

    expect(
      synced.data?.monitorStepsInstanceArray[0]?.data?.networkDeviceMonitor
        ?.networkDeviceId,
    ).toBe(CURRENT_DEVICE_ID);
  });

  it("uses the fallback marker when current steps are absent", () => {
    const synced: MonitorSteps =
      NetworkDeviceMonitorTemplateUtil.buildSyncedMonitorSteps({
        templateMonitorSteps: buildSteps(),
        currentMonitorSteps: undefined,
        fallbackNetworkDeviceId: FALLBACK_DEVICE_ID,
      });

    expect(
      synced.data?.monitorStepsInstanceArray[0]?.data?.networkDeviceMonitor
        ?.networkDeviceId,
    ).toBe(FALLBACK_DEVICE_ID.toString());
  });

  it("uses the fallback marker when current steps carry no binding", () => {
    const synced: MonitorSteps =
      NetworkDeviceMonitorTemplateUtil.buildSyncedMonitorSteps({
        templateMonitorSteps: buildSteps(),
        currentMonitorSteps: buildSteps([undefined]),
        fallbackNetworkDeviceId: FALLBACK_DEVICE_ID.toString(),
      });

    expect(
      synced.data?.monitorStepsInstanceArray[0]?.data?.networkDeviceMonitor
        ?.networkDeviceId,
    ).toBe(FALLBACK_DEVICE_ID.toString());
  });

  it("rejects multiple distinct current bindings instead of guessing", () => {
    expectBadData(() => {
      return NetworkDeviceMonitorTemplateUtil.buildSyncedMonitorSteps({
        templateMonitorSteps: buildSteps(),
        currentMonitorSteps: buildSteps([
          CURRENT_DEVICE_ID,
          DEVICE_ID.toString(),
        ]),
        fallbackNetworkDeviceId: FALLBACK_DEVICE_ID,
      });
    }, "exactly one distinct Network Device binding");
  });

  it("rejects a sync with neither a current binding nor a fallback", () => {
    expectBadData(() => {
      return NetworkDeviceMonitorTemplateUtil.buildSyncedMonitorSteps({
        templateMonitorSteps: buildSteps(),
        currentMonitorSteps: buildSteps([undefined]),
      });
    }, "no Network Device binding to preserve");
  });

  it("validates template steps after resolving the binding", () => {
    expectBadData(() => {
      return NetworkDeviceMonitorTemplateUtil.buildSyncedMonitorSteps({
        templateMonitorSteps: undefined,
        currentMonitorSteps: buildSteps([CURRENT_DEVICE_ID]),
      });
    }, "Monitor template monitor steps are required");
  });
});
