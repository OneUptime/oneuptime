import HTTPMethod from "../../../Types/API/HTTPMethod";
import Hostname from "../../../Types/API/Hostname";
import URL from "../../../Types/API/URL";
import BadDataException from "../../../Types/Exception/BadDataException";
import IP from "../../../Types/IP/IP";
import { JSONObject } from "../../../Types/JSON";
import { CheckOn, FilterType } from "../../../Types/Monitor/CriteriaFilter";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import MonitorTemplateTargetPolicy, {
  MonitorTemplateTargetField,
} from "../../../Types/Monitor/MonitorTemplateTargetPolicy";
import { MonitorStepDnsMonitorUtil } from "../../../Types/Monitor/MonitorStepDnsMonitor";
import { MonitorStepDnssecMonitorUtil } from "../../../Types/Monitor/MonitorStepDnssecMonitor";
import { MonitorStepDomainMonitorUtil } from "../../../Types/Monitor/MonitorStepDomainMonitor";
import { MonitorStepExternalStatusPageMonitorUtil } from "../../../Types/Monitor/MonitorStepExternalStatusPageMonitor";
import { MonitorStepSqlMonitorUtil } from "../../../Types/Monitor/MonitorStepSqlMonitor";
import { MonitorStepDatabaseMonitorUtil } from "../../../Types/Monitor/MonitorStepDatabaseMonitor";
import { MonitorStepKubernetesMonitorUtil } from "../../../Types/Monitor/MonitorStepKubernetesMonitor";
import { MonitorStepDockerMonitorUtil } from "../../../Types/Monitor/MonitorStepDockerMonitor";
import { MonitorStepPodmanMonitorUtil } from "../../../Types/Monitor/MonitorStepPodmanMonitor";
import { MonitorStepHostMonitorUtil } from "../../../Types/Monitor/MonitorStepHostMonitor";
import { MonitorStepProxmoxMonitorUtil } from "../../../Types/Monitor/MonitorStepProxmoxMonitor";
import { MonitorStepDockerSwarmMonitorUtil } from "../../../Types/Monitor/MonitorStepDockerSwarmMonitor";
import { MonitorStepCephMonitorUtil } from "../../../Types/Monitor/MonitorStepCephMonitor";
import { MonitorStepIoTMonitorUtil } from "../../../Types/Monitor/MonitorStepIoTMonitor";
import ObjectID from "../../../Types/ObjectID";
import Port from "../../../Types/Port";
import MonitorTemplateDestinationUtil from "../../../Utils/Monitor/MonitorTemplateDestinationUtil";
import { describe, expect, it } from "@jest/globals";

function buildStep(
  id: string,
  destination?: URL | IP | Hostname,
  port?: number,
): MonitorStep {
  const step: MonitorStep = new MonitorStep();
  step.data!.id = id;
  step.data!.monitorDestination = destination;
  step.data!.monitorDestinationPort =
    port === undefined ? undefined : new Port(port);
  return step;
}

function buildSteps(steps: Array<MonitorStep>): MonitorSteps {
  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.setMonitorStepsInstanceArray(steps);
  return monitorSteps;
}

function sync(
  templateMonitorSteps: MonitorSteps | undefined,
  currentMonitorSteps: MonitorSteps | undefined,
  monitorType: MonitorType = MonitorType.SSLCertificate,
): MonitorSteps {
  return MonitorTemplateDestinationUtil.buildSyncedMonitorSteps({
    templateMonitorSteps,
    currentMonitorSteps,
    monitorType,
  });
}

function destinations(steps: MonitorSteps): Array<string | undefined> {
  return steps.data!.monitorStepsInstanceArray.map(
    (step: MonitorStep): string | undefined => {
      return step.data!.monitorDestination?.toString();
    },
  );
}

describe("MonitorTemplateDestinationUtil", () => {
  it.each([
    MonitorType.SSLCertificate,
    MonitorType.Website,
    MonitorType.API,
    MonitorType.Ping,
    MonitorType.IP,
    MonitorType.Port,
  ])("supports preserving the destination for %s", (type: MonitorType) => {
    expect(MonitorTemplateDestinationUtil.supportsMonitorType(type)).toBe(true);
  });

  it.each([undefined, MonitorType.NetworkDevice, MonitorType.Manual])(
    "does not claim support for %s",
    (type: MonitorType | undefined) => {
      expect(MonitorTemplateDestinationUtil.supportsMonitorType(type)).toBe(
        false,
      );
    },
  );

  it("syncs changed SSL criteria to five monitors without replacing their URLs", () => {
    const templateStep: MonitorStep = buildStep("certificate");
    templateStep.data!.monitorCriteria.data!.monitorCriteriaInstanceArray[0]!.data!.filters =
      [
        {
          checkOn: CheckOn.ExpiresInDays,
          filterType: FilterType.LessThan,
          value: 30,
        },
      ];
    templateStep.data!.retryCount = 1;
    templateStep.data!.requestTimeoutInMs = 10000;
    const template: MonitorSteps = buildSteps([templateStep]);
    template.setDefaultMonitorStatusId(
      new ObjectID("11111111-1111-4111-8111-111111111111"),
    );
    const templateBefore: JSONObject = template.toJSON();

    for (const host of ["one", "two", "three", "four", "five"]) {
      const destination: URL = URL.fromString(`https://${host}.example.com`);
      const current: MonitorSteps = buildSteps([
        buildStep("certificate", destination),
      ]);
      const currentBefore: JSONObject = current.toJSON();
      const result: MonitorSteps = sync(template, current);
      const resultStep: MonitorStep =
        result.data!.monitorStepsInstanceArray[0]!;

      expect(destinations(result)).toEqual([destination.toString()]);
      expect(resultStep.data!.monitorCriteria.toJSON()).toEqual(
        templateStep.data!.monitorCriteria.toJSON(),
      );
      expect(resultStep.data!.retryCount).toBe(1);
      expect(resultStep.data!.requestTimeoutInMs).toBe(10000);
      expect(result.data!.defaultMonitorStatusId?.toString()).toBe(
        template.data!.defaultMonitorStatusId!.toString(),
      );
      expect(sync(template, result).toJSON()).toEqual(result.toJSON());
      expect(current.toJSON()).toEqual(currentBefore);
      expect(template.toJSON()).toEqual(templateBefore);
      expect(resultStep.data!.monitorDestination).not.toBe(destination);
      expect(resultStep.data!.monitorCriteria).not.toBe(
        templateStep.data!.monitorCriteria,
      );
    }
  });

  it("preserves a single destination when a monitor was linked after creation", () => {
    const current: MonitorSteps = buildSteps([
      buildStep(
        "original-monitor-step",
        URL.fromString("https://one.example.com"),
      ),
    ]);
    const result: MonitorSteps = sync(
      buildSteps([buildStep("template-step")]),
      current,
    );

    expect(destinations(result)).toEqual(destinations(current));
    expect(result.data!.monitorStepsInstanceArray[0]!.data!.id).toBe(
      "template-step",
    );
  });

  it("keeps step bindings when template steps are reordered and removed", () => {
    const current: MonitorSteps = buildSteps([
      buildStep("first", URL.fromString("https://one.example.com")),
      buildStep("second", URL.fromString("https://two.example.com")),
      buildStep("removed", URL.fromString("https://three.example.com")),
    ]);
    const result: MonitorSteps = sync(
      buildSteps([buildStep("second"), buildStep("first")]),
      current,
    );

    expect(destinations(result)).toEqual([
      "https://two.example.com/",
      "https://one.example.com/",
    ]);
  });

  it("reuses the one distinct destination for added and recreated steps", () => {
    const current: MonitorSteps = buildSteps([
      buildStep("first", URL.fromString("https://one.example.com")),
      buildStep("second", URL.fromString("https://one.example.com")),
    ]);
    const result: MonitorSteps = sync(
      buildSteps([
        buildStep("first"),
        buildStep("recreated"),
        buildStep("added"),
      ]),
      current,
    );

    expect(destinations(result)).toEqual([
      "https://one.example.com/",
      "https://one.example.com/",
      "https://one.example.com/",
    ]);
    expect(
      result.data!.monitorStepsInstanceArray[0]!.data!.monitorDestination,
    ).not.toBe(
      result.data!.monitorStepsInstanceArray[1]!.data!.monitorDestination,
    );
  });

  it.each([
    ["first", "added"],
    ["recreated", "second"],
    ["new-first", "new-second"],
  ])(
    "rejects ambiguous bindings for template step IDs %j instead of guessing by position",
    (...ids: Array<string>) => {
      const template: MonitorSteps = buildSteps(
        ids.map((id: string): MonitorStep => {
          return buildStep(id);
        }),
      );
      const current: MonitorSteps = buildSteps([
        buildStep("first", URL.fromString("https://one.example.com")),
        buildStep("second", URL.fromString("https://two.example.com")),
      ]);
      const before: JSONObject = current.toJSON();

      expect(() => {
        sync(template, current);
      }).toThrow(BadDataException);
      expect(current.toJSON()).toEqual(before);
    },
  );

  it.each([
    [MonitorType.Website, URL.fromString("https://website.example.com/health")],
    [
      MonitorType.API,
      URL.fromString("https://api.example.com/check?region=eu"),
    ],
    [MonitorType.Ping, new Hostname("ping.example.com")],
    [MonitorType.IP, new IP("192.0.2.25")],
  ])(
    "preserves the %s target while propagating other template settings",
    (
      type: MonitorType | URL | IP | Hostname,
      destination: MonitorType | URL | IP | Hostname,
    ) => {
      const templateStep: MonitorStep = buildStep("step");
      templateStep.data!.requestType = HTTPMethod.POST;
      templateStep.data!.requestHeaders = { "X-Health-Check": "template" };
      templateStep.data!.requestBody = "updated request";
      templateStep.data!.allowSelfSignedCertificates = true;
      const result: MonitorSteps = sync(
        buildSteps([templateStep]),
        buildSteps([buildStep("step", destination as URL | IP | Hostname)]),
        type as MonitorType,
      );
      const resultStep: MonitorStep =
        result.data!.monitorStepsInstanceArray[0]!;

      expect(destinations(result)).toEqual([destination.toString()]);
      expect(resultStep.data!.requestType).toBe(HTTPMethod.POST);
      expect(resultStep.data!.requestHeaders).toEqual({
        "X-Health-Check": "template",
      });
      expect(resultStep.data!.requestBody).toBe("updated request");
      expect(resultStep.data!.allowSelfSignedCertificates).toBe(true);
    },
  );

  it("preserves different ports on the same host by step ID", () => {
    const current: MonitorSteps = buildSteps([
      buildStep("https", new Hostname("server.example.com"), 443),
      buildStep("postgres", new Hostname("server.example.com"), 5432),
    ]);
    const result: MonitorSteps = sync(
      buildSteps([buildStep("postgres"), buildStep("https")]),
      current,
      MonitorType.Port,
    );

    expect(destinations(result)).toEqual([
      "server.example.com",
      "server.example.com",
    ]);
    expect(
      result.data!.monitorStepsInstanceArray.map(
        (step: MonitorStep): number | undefined => {
          return step.data!.monitorDestinationPort?.toNumber();
        },
      ),
    ).toEqual([5432, 443]);
    expect(
      result.data!.monitorStepsInstanceArray[0]!.data!.monitorDestinationPort,
    ).not.toBe(
      current.data!.monitorStepsInstanceArray[1]!.data!.monitorDestinationPort,
    );
  });

  it("includes the port when deciding whether fallback is unambiguous", () => {
    expect(() => {
      sync(
        buildSteps([buildStep("new")]),
        buildSteps([
          buildStep("https", new Hostname("server.example.com"), 443),
          buildStep("postgres", new Hostname("server.example.com"), 5432),
        ]),
        MonitorType.Port,
      );
    }).toThrow(BadDataException);
  });

  it("preserves a single port binding when step IDs change", () => {
    const result: MonitorSteps = sync(
      buildSteps([buildStep("new")]),
      buildSteps([buildStep("old", new IP("192.0.2.25"), 8443)]),
      MonitorType.Port,
    );

    expect(destinations(result)).toEqual(["192.0.2.25"]);
    expect(
      result.data!.monitorStepsInstanceArray[0]!.data!.monitorDestinationPort?.toNumber(),
    ).toBe(8443);
  });

  it("rejects a Port monitor without a current port", () => {
    expect(() => {
      sync(
        buildSteps([buildStep("step")]),
        buildSteps([buildStep("step", new Hostname("server.example.com"))]),
        MonitorType.Port,
      );
    }).toThrow(BadDataException);
  });

  it("rejects a step without a current destination even when other steps have one", () => {
    const current: MonitorSteps = buildSteps([
      buildStep("first"),
      buildStep("missing"),
    ]);
    current.data!.monitorStepsInstanceArray[1]!.data!.monitorDestination =
      undefined;

    expect(() => {
      sync(buildSteps([buildStep("missing")]), current);
    }).toThrow("without a monitor destination to preserve");
  });

  it("does not require the template placeholder destination to apply shared criteria", () => {
    const templateStep: MonitorStep = buildStep("step");
    templateStep.data!.monitorDestination = undefined;
    const current: MonitorSteps = buildSteps([
      buildStep("step", URL.fromString("https://current.example.com")),
    ]);

    expect(destinations(sync(buildSteps([templateStep]), current))).toEqual(
      destinations(current),
    );
  });

  it.each(["template", "current"])(
    "rejects absent or malformed %s steps with BadDataException",
    (subject: string) => {
      const missingData: MonitorSteps = new MonitorSteps();
      missingData.data = undefined;
      const invalidArray: MonitorSteps = new MonitorSteps();
      invalidArray.data = { monitorStepsInstanceArray: {} } as never;
      const missingStepData: MonitorStep = buildStep("step");
      missingStepData.data = undefined;
      const invalidCriteria: MonitorStep = buildStep("step");
      invalidCriteria.data!.monitorCriteria = undefined as never;
      const cases: Array<MonitorSteps | undefined> = [
        undefined,
        {} as MonitorSteps,
        missingData,
        invalidArray,
        buildSteps([]),
        buildSteps([null as never]),
        buildSteps([{} as MonitorStep]),
        buildSteps([missingStepData]),
        buildSteps([invalidCriteria]),
        buildSteps([buildStep("")]),
        buildSteps([buildStep(" ")]),
        buildSteps([buildStep("duplicate"), buildStep("duplicate")]),
      ];

      for (const invalid of cases) {
        expect(() => {
          sync(
            subject === "template" ? invalid : buildSteps([buildStep("step")]),
            subject === "current" ? invalid : buildSteps([buildStep("step")]),
          );
        }).toThrow(BadDataException);
      }
    },
  );

  it("rejects unsupported monitor types", () => {
    expect(() => {
      sync(
        buildSteps([buildStep("step")]),
        buildSteps([buildStep("step")]),
        MonitorType.NetworkDevice,
      );
    }).toThrow(BadDataException);
  });
});

interface NestedTargetCase {
  type: MonitorType;
  config: string;
  target: string;
  defaults: () => unknown;
}

const nestedTargets: Array<NestedTargetCase> = [
  {
    type: MonitorType.DNS,
    config: "dnsMonitor",
    target: "queryName",
    defaults: MonitorStepDnsMonitorUtil.getDefault,
  },
  {
    type: MonitorType.DNSSEC,
    config: "dnssecMonitor",
    target: "domainName",
    defaults: MonitorStepDnssecMonitorUtil.getDefault,
  },
  {
    type: MonitorType.Domain,
    config: "domainMonitor",
    target: "domainName",
    defaults: MonitorStepDomainMonitorUtil.getDefault,
  },
  {
    type: MonitorType.ExternalStatusPage,
    config: "externalStatusPageMonitor",
    target: "statusPageUrl",
    defaults: MonitorStepExternalStatusPageMonitorUtil.getDefault,
  },
  {
    type: MonitorType.SQLQuery,
    config: "sqlMonitor",
    target: "host",
    defaults: MonitorStepSqlMonitorUtil.getDefault,
  },
  {
    type: MonitorType.Database,
    config: "databaseMonitor",
    target: "host",
    defaults: MonitorStepDatabaseMonitorUtil.getDefault,
  },
  {
    type: MonitorType.Kubernetes,
    config: "kubernetesMonitor",
    target: "clusterIdentifier",
    defaults: MonitorStepKubernetesMonitorUtil.getDefault,
  },
  {
    type: MonitorType.Docker,
    config: "dockerMonitor",
    target: "hostIdentifier",
    defaults: MonitorStepDockerMonitorUtil.getDefault,
  },
  {
    type: MonitorType.Podman,
    config: "podmanMonitor",
    target: "hostIdentifier",
    defaults: MonitorStepPodmanMonitorUtil.getDefault,
  },
  {
    type: MonitorType.Host,
    config: "hostMonitor",
    target: "hostIdentifier",
    defaults: MonitorStepHostMonitorUtil.getDefault,
  },
  {
    type: MonitorType.Proxmox,
    config: "proxmoxMonitor",
    target: "clusterIdentifier",
    defaults: MonitorStepProxmoxMonitorUtil.getDefault,
  },
  {
    type: MonitorType.DockerSwarm,
    config: "dockerSwarmMonitor",
    target: "clusterIdentifier",
    defaults: MonitorStepDockerSwarmMonitorUtil.getDefault,
  },
  {
    type: MonitorType.Ceph,
    config: "cephMonitor",
    target: "clusterIdentifier",
    defaults: MonitorStepCephMonitorUtil.getDefault,
  },
  {
    type: MonitorType.IoTDevice,
    config: "iotMonitor",
    target: "fleetIdentifier",
    defaults: MonitorStepIoTMonitorUtil.getDefault,
  },
];

function setNestedValue(
  data: unknown,
  path: ReadonlyArray<string>,
  value: unknown,
): void {
  let current: Record<string, unknown> = data as Record<string, unknown>;
  for (const part of path.slice(0, -1)) {
    current[part] = current[part] || {};
    current = current[part] as Record<string, unknown>;
  }
  current[path[path.length - 1]!] = value;
}

function nestedStep(
  testCase: NestedTargetCase,
  id: string,
  target: string,
): MonitorStep {
  const step: MonitorStep = buildStep(id);
  const config: Record<string, unknown> = {
    ...(testCase.defaults() as Record<string, unknown>),
    [testCase.target]: target,
  };
  if (
    testCase.type === MonitorType.Database ||
    testCase.type === MonitorType.SQLQuery
  ) {
    config["databaseName"] = "monitoring";
  }
  (step.data as unknown as Record<string, unknown>)[testCase.config] = config;
  return step;
}

function configFor(step: MonitorStep, config: string): Record<string, unknown> {
  return (step.data as unknown as Record<string, unknown>)[config] as Record<
    string,
    unknown
  >;
}

describe("optional template targets", () => {
  it.each<[MonitorType, URL | Hostname | IP]>([
    [MonitorType.Website, URL.fromString("https://new.example.com")],
    [MonitorType.API, URL.fromString("https://new.example.com/api")],
    [MonitorType.SSLCertificate, URL.fromString("https://new.example.com")],
    [MonitorType.Ping, new Hostname("new.example.com")],
    [MonitorType.IP, new IP("192.0.2.20")],
  ])(
    "syncs an explicit %s target without requiring any current steps",
    (type: MonitorType, destination: URL | Hostname | IP) => {
      const result: MonitorSteps = sync(
        buildSteps([buildStep("new", destination as URL | Hostname | IP)]),
        undefined,
        type as MonitorType,
      );
      expect(destinations(result)).toEqual([destination.toString()]);
    },
  );

  it("syncs explicit targets despite ambiguous or missing old targets", () => {
    const result: MonitorSteps = sync(
      buildSteps([
        buildStep("new", URL.fromString("https://shared.example.com")),
      ]),
      buildSteps([
        buildStep("first"),
        buildStep("second", URL.fromString("https://second.example.com")),
      ]),
    );
    expect(destinations(result)).toEqual(["https://shared.example.com/"]);
  });

  it("retains only an omitted port while replacing the destination", () => {
    const result: MonitorSteps = sync(
      buildSteps([buildStep("step", new Hostname("new.example.com"))]),
      buildSteps([buildStep("step", undefined, 8443)]),
      MonitorType.Port,
    );
    expect(destinations(result)).toEqual(["new.example.com"]);
    expect(
      result.data!.monitorStepsInstanceArray[0]!.data!.monitorDestinationPort!.toNumber(),
    ).toBe(8443);
  });

  it("retains only an omitted destination while replacing the port", () => {
    const result: MonitorSteps = sync(
      buildSteps([buildStep("step", undefined, 443)]),
      buildSteps([buildStep("step", new Hostname("current.example.com"))]),
      MonitorType.Port,
    );
    expect(destinations(result)).toEqual(["current.example.com"]);
    expect(
      result.data!.monitorStepsInstanceArray[0]!.data!.monitorDestinationPort!.toNumber(),
    ).toBe(443);
  });

  it("allows fallback when only omitted fields are unambiguous", () => {
    const result: MonitorSteps = sync(
      buildSteps([buildStep("new", new Hostname("new.example.com"))]),
      buildSteps([
        buildStep("first", new Hostname("first.example.com"), 443),
        buildStep("second", new Hostname("second.example.com"), 443),
      ]),
      MonitorType.Port,
    );
    expect(destinations(result)).toEqual(["new.example.com"]);
    expect(
      result.data!.monitorStepsInstanceArray[0]!.data!.monitorDestinationPort!.toNumber(),
    ).toBe(443);
  });

  it.each(nestedTargets)(
    "preserves omitted nested targets and syncs criteria for $type",
    (testCase: NestedTargetCase) => {
      const templateStep: MonitorStep = nestedStep(testCase, "step", "   ");
      templateStep.data!.retryCount = 1;
      const currentStep: MonitorStep = nestedStep(
        testCase,
        "step",
        "current.example.com",
      );
      const result: MonitorSteps = sync(
        buildSteps([templateStep]),
        buildSteps([currentStep]),
        testCase.type,
      );
      expect(
        configFor(result.data!.monitorStepsInstanceArray[0]!, testCase.config)[
          testCase.target
        ],
      ).toBe("current.example.com");
      expect(result.data!.monitorStepsInstanceArray[0]!.data!.retryCount).toBe(
        1,
      );
      expect(
        result.data!.monitorStepsInstanceArray[0]!.data!.monitorCriteria.toJSON(),
      ).toEqual(templateStep.data!.monitorCriteria.toJSON());
    },
  );

  it.each(nestedTargets)(
    "syncs explicit nested targets for $type",
    (testCase: NestedTargetCase) => {
      const templateStep: MonitorStep = nestedStep(
        testCase,
        "step",
        "shared.example.com",
      );
      const currentStep: MonitorStep = nestedStep(
        testCase,
        "step",
        "current.example.com",
      );
      const result: MonitorSteps = sync(
        buildSteps([templateStep]),
        buildSteps([currentStep]),
        testCase.type,
      );
      expect(
        configFor(result.data!.monitorStepsInstanceArray[0]!, testCase.config)[
          testCase.target
        ],
      ).toBe("shared.example.com");
    },
  );

  it.each(nestedTargets)(
    "preserves an entirely omitted configuration block for $type",
    (testCase: NestedTargetCase) => {
      const currentStep: MonitorStep = nestedStep(
        testCase,
        "step",
        "current.example.com",
      );
      const current: MonitorSteps = buildSteps([currentStep]);
      const result: MonitorSteps = sync(
        buildSteps([buildStep("step")]),
        current,
        testCase.type,
      );
      const resultConfig: Record<string, unknown> = configFor(
        result.data!.monitorStepsInstanceArray[0]!,
        testCase.config,
      );
      expect(resultConfig).toEqual(configFor(currentStep, testCase.config));
      expect(resultConfig).not.toBe(configFor(currentStep, testCase.config));
    },
  );

  it("rejects ambiguous whole configurations when template step IDs are recreated", () => {
    const testCase: NestedTargetCase = nestedTargets.find(
      (item: NestedTargetCase): boolean => {
        return item.type === MonitorType.DNS;
      },
    )!;
    const first: MonitorStep = nestedStep(
      testCase,
      "first",
      "same.example.com",
    );
    const second: MonitorStep = nestedStep(
      testCase,
      "second",
      "same.example.com",
    );
    configFor(second, testCase.config)["timeout"] = 15000;
    expect(() => {
      sync(
        buildSteps([buildStep("new")]),
        buildSteps([first, second]),
        testCase.type,
      );
    }).toThrow(BadDataException);
  });

  it.each(nestedTargets)(
    "rejects a missing required nested target for $type",
    (testCase: NestedTargetCase) => {
      expect(() => {
        sync(
          buildSteps([nestedStep(testCase, "step", "")]),
          buildSteps([nestedStep(testCase, "step", "")]),
          testCase.type,
        );
      }).toThrow(BadDataException);
    },
  );

  it.each([MonitorType.SQLQuery, MonitorType.Database])(
    "merges each %s connection field independently",
    (type: MonitorType) => {
      const testCase: NestedTargetCase = nestedTargets.find(
        (item: NestedTargetCase): boolean => {
          return item.type === type;
        },
      )!;
      const templateStep: MonitorStep = nestedStep(
        testCase,
        "step",
        "shared.example.com",
      );
      Object.assign(configFor(templateStep, testCase.config), {
        port: undefined,
        databaseName: " ",
        username: "",
        password: "",
        useSsl: true,
      });
      const currentStep: MonitorStep = nestedStep(
        testCase,
        "step",
        "current.example.com",
      );
      Object.assign(configFor(currentStep, testCase.config), {
        port: 6432,
        databaseName: "tenant_db",
        username: "tenant_user",
        password: "{{monitorSecrets.databasePassword}}",
        useSsl: false,
      });
      const result: MonitorSteps = sync(
        buildSteps([templateStep]),
        buildSteps([currentStep]),
        type,
      );
      expect(
        configFor(result.data!.monitorStepsInstanceArray[0]!, testCase.config),
      ).toMatchObject({
        host: "shared.example.com",
        port: 6432,
        databaseName: "tenant_db",
        username: "tenant_user",
        password: "{{monitorSecrets.databasePassword}}",
        useSsl: true,
      });
    },
  );

  it.each(
    nestedTargets.filter((testCase: NestedTargetCase): boolean => {
      return MonitorTemplateTargetPolicy.getTargetFields(testCase.type).some(
        (field: MonitorTemplateTargetField): boolean => {
          return field.path.length > 2;
        },
      );
    }),
  )(
    "merges individual resource filters and deeply clones $type configuration",
    (testCase: NestedTargetCase) => {
      const nestedField: MonitorTemplateTargetField =
        MonitorTemplateTargetPolicy.getTargetFields(testCase.type).find(
          (field: MonitorTemplateTargetField): boolean => {
            return field.path.length > 2;
          },
        )!;
      const templateStep: MonitorStep = nestedStep(testCase, "step", "");
      const currentStep: MonitorStep = nestedStep(testCase, "step", "current");
      setNestedValue(currentStep.data, nestedField.path, "resource-1");
      const template: MonitorSteps = buildSteps([templateStep]);
      const current: MonitorSteps = buildSteps([currentStep]);
      const result: MonitorSteps = sync(template, current, testCase.type);
      const resultStep: MonitorStep =
        result.data!.monitorStepsInstanceArray[0]!;
      expect(
        MonitorTemplateTargetPolicy.getValue(resultStep.data, nestedField.path),
      ).toBe("resource-1");
      setNestedValue(resultStep.data, nestedField.path, "changed");
      expect(
        MonitorTemplateTargetPolicy.getValue(
          currentStep.data,
          nestedField.path,
        ),
      ).toBe("resource-1");
      expect(
        MonitorTemplateTargetPolicy.getValue(
          templateStep.data,
          nestedField.path,
        ),
      ).toBeUndefined();
      expect(
        configFor(resultStep, testCase.config)["metricViewConfig"],
      ).not.toBe(configFor(templateStep, testCase.config)["metricViewConfig"]);
    },
  );

  it("does not require absent optional selections on current monitors", () => {
    const testCase: NestedTargetCase = nestedTargets.find(
      (item: NestedTargetCase): boolean => {
        return item.type === MonitorType.ExternalStatusPage;
      },
    )!;
    const result: MonitorSteps = sync(
      buildSteps([nestedStep(testCase, "step", "")]),
      buildSteps([nestedStep(testCase, "step", "https://status.example.com")]),
      testCase.type,
    );
    expect(
      configFor(result.data!.monitorStepsInstanceArray[0]!, testCase.config)[
        "componentName"
      ],
    ).toBeUndefined();
  });

  it("preserves blanks independently in mixed explicit and inherited multi-step templates", () => {
    const result: MonitorSteps = sync(
      buildSteps([
        buildStep("explicit-new", URL.fromString("https://shared.example.com")),
        buildStep("second"),
      ]),
      buildSteps([
        buildStep("first", URL.fromString("https://first.example.com")),
        buildStep("second", URL.fromString("https://second.example.com")),
      ]),
    );
    expect(destinations(result)).toEqual([
      "https://shared.example.com/",
      "https://second.example.com/",
    ]);
  });
});

describe("MonitorTemplateTargetPolicy", () => {
  it("clears new template connection defaults while retaining shared settings", () => {
    const step: MonitorStep = buildStep("step");
    step.data!.databaseMonitor = MonitorStepDatabaseMonitorUtil.getDefault();
    const timeout: number = step.data!.databaseMonitor.connectionTimeoutInMs;
    MonitorTemplateTargetPolicy.clearTargets(step.data, MonitorType.Database);
    expect(step.data!.databaseMonitor.port).toBeUndefined();
    expect(step.data!.databaseMonitor.host).toBeUndefined();
    expect(step.data!.databaseMonitor.connectionTimeoutInMs).toBe(timeout);
    expect(step.data!.monitorCriteria).toBeDefined();
  });
  it("clears only existing nested target keys without creating missing configs", () => {
    const data: Record<string, unknown> = {};
    MonitorTemplateTargetPolicy.clearTargets(data, MonitorType.Kubernetes);
    expect(data).toEqual({});
  });
  it.each([undefined, null, "", " ", [], "\n\t"])(
    "treats blank target %j as omitted",
    (value: unknown) => {
      expect(MonitorTemplateTargetPolicy.isBlankTargetValue(value)).toBe(true);
    },
  );
  it.each([
    false,
    0,
    "0",
    "target",
    ["target"],
    new Port(443),
    URL.fromString("https://example.com"),
  ])("does not treat explicit target %j as omitted", (value: unknown) => {
    expect(MonitorTemplateTargetPolicy.isBlankTargetValue(value)).toBe(false);
  });
  it("does not classify ordinary check settings as target fields", () => {
    for (const type of Object.values(MonitorType)) {
      const paths: Array<string> = MonitorTemplateTargetPolicy.getTargetFields(
        type,
      ).map((field: MonitorTemplateTargetField): string => {
        return field.path.join(".");
      });
      expect(new Set(paths).size).toBe(paths.length);
      expect(paths).not.toContain("monitorCriteria");
      expect(paths).not.toContain("retryCount");
      expect(paths).not.toContain("requestTimeoutInMs");
      expect(paths).not.toContain("sqlMonitor.query");
      expect(paths).not.toContain("databaseMonitor.enabledMetricGroups");
    }
  });
});
