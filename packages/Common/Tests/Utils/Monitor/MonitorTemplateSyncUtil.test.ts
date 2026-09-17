import HTTPMethod from "../../../Types/API/HTTPMethod";
import Hostname from "../../../Types/API/Hostname";
import URL from "../../../Types/API/URL";
import IP from "../../../Types/IP/IP";
import { JSONObject } from "../../../Types/JSON";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import { MonitorStepDatabaseMonitorUtil } from "../../../Types/Monitor/MonitorStepDatabaseMonitor";
import { MonitorStepDnsMonitorUtil } from "../../../Types/Monitor/MonitorStepDnsMonitor";
import { MonitorStepExternalStatusPageMonitorUtil } from "../../../Types/Monitor/MonitorStepExternalStatusPageMonitor";
import {
  MonitorStepKubernetesMonitorUtil,
  KubernetesResourceScope,
} from "../../../Types/Monitor/MonitorStepKubernetesMonitor";
import { MonitorStepLogMonitorUtil } from "../../../Types/Monitor/MonitorStepLogMonitor";
import { MonitorStepSqlMonitorUtil } from "../../../Types/Monitor/MonitorStepSqlMonitor";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import Port from "../../../Types/Port";
import MonitorTemplateSyncUtil from "../../../Utils/Monitor/MonitorTemplateSyncUtil";

function step(id: string, exclusions?: Array<string>): MonitorStep {
  const result: MonitorStep = new MonitorStep();
  result.data!.id = id;
  result.data!.doNotSyncFields = exclusions;
  result.data!.monitorDestination = URL.fromString(`https://${id}.example.com`);
  return result;
}

function steps(...items: Array<MonitorStep>): MonitorSteps {
  const result: MonitorSteps = new MonitorSteps();
  result.setMonitorStepsInstanceArray(items);
  result.setDefaultMonitorStatusId(ObjectID.generate());
  return result;
}

function sync(
  template: MonitorStep,
  current: MonitorStep | undefined,
  monitorType: MonitorType = MonitorType.API,
): MonitorStep {
  return MonitorTemplateSyncUtil.buildSyncedMonitorSteps({
    templateMonitorSteps: steps(template),
    currentMonitorSteps: current ? steps(current) : undefined,
    monitorType,
  }).data!.monitorStepsInstanceArray[0]!;
}

describe("MonitorTemplateSyncUtil", () => {
  test("criteria sync keeps each monitor's destination and headers while updating unchecked fields", (): void => {
    const template: MonitorStep = step("template", [
      "monitorDestination",
      "requestHeaders",
    ]);
    template.data!.requestHeaders = {
      "X-Template": "template",
      Authorization: "template-secret",
    };
    template.data!.requestType = HTTPMethod.POST;
    template.data!.requestBody = "template body";
    const current: MonitorStep = step("current");
    current.data!.requestHeaders = {
      Authorization: "{{monitorSecrets.productionToken}}",
    };
    current.data!.requestBody = "old body";
    const templateSteps: MonitorSteps = steps(template);
    const result: MonitorSteps =
      MonitorTemplateSyncUtil.buildSyncedMonitorSteps({
        templateMonitorSteps: templateSteps,
        currentMonitorSteps: steps(current),
        monitorType: MonitorType.API,
      });
    const synced: MonitorStep = result.data!.monitorStepsInstanceArray[0]!;

    expect(synced.data!.monitorDestination!.toString()).toBe(
      "https://current.example.com/",
    );
    expect(synced.data!.requestHeaders).toEqual(current.data!.requestHeaders);
    expect(synced.data!.requestHeaders).not.toHaveProperty("X-Template");
    expect(synced.data!.requestType).toBe(HTTPMethod.POST);
    expect(synced.data!.requestBody).toBe("template body");
    expect(synced.data!.monitorCriteria.toJSON()).toEqual(
      template.data!.monitorCriteria.toJSON(),
    );
    expect(synced.data!.id).toBe("template");
    expect(result.data!.defaultMonitorStatusId!.toString()).toBe(
      templateSteps.data!.defaultMonitorStatusId!.toString(),
    );
    expect(synced.data).not.toHaveProperty("doNotSyncFields");
  });

  test("separate monitors retain separate values across repeated syncs", (): void => {
    const template: MonitorStep = step("template", [
      "monitorDestination",
      "requestHeaders",
    ]);
    const currentA: MonitorStep = step("service-a");
    const currentB: MonitorStep = step("service-b");
    currentA.data!.requestHeaders = { Authorization: "token-a" };
    currentB.data!.requestHeaders = { Authorization: "token-b" };
    const first: MonitorStep = sync(template, currentA);
    template.data!.requestBody = "revised";
    const repeated: MonitorStep = sync(template, first);
    const other: MonitorStep = sync(template, currentB);
    expect(repeated.data!.requestHeaders).toEqual({ Authorization: "token-a" });
    expect(repeated.data!.requestBody).toBe("revised");
    expect(other.data!.requestHeaders).toEqual({ Authorization: "token-b" });
    expect(other.data!.monitorDestination!.toString()).toBe(
      "https://service-b.example.com/",
    );
  });

  test("unchecking a field restores template updates and monitor-only metadata is ignored", (): void => {
    const template: MonitorStep = step("template", []);
    template.data!.requestHeaders = { Authorization: "template" };
    const current: MonitorStep = step("current", [
      "requestHeaders",
      "monitorDestination",
    ]);
    current.data!.requestHeaders = { Authorization: "current" };
    const result: MonitorStep = sync(template, current);
    expect(result.data!.requestHeaders).toEqual(template.data!.requestHeaders);
    expect(result.data!.monitorDestination!.toString()).toBe(
      template.data!.monitorDestination!.toString(),
    );
    expect(result.data!.doNotSyncFields).toBeUndefined();
  });

  test("legacy templates without exclusions copy all template settings without needing existing steps", (): void => {
    const template: MonitorStep = step("template");
    template.data!.requestHeaders = { "X-Shared": "shared" };
    const result: MonitorStep = sync(template, undefined);
    expect(result.toJSON()).toEqual(template.toJSON());
    expect(result).not.toBe(template);
  });

  test.each([{}, undefined])(
    "protected headers retain the existing empty or absent dictionary %j",
    (headers: Record<string, string> | undefined): void => {
      const template: MonitorStep = step("template", ["requestHeaders"]);
      template.data!.requestHeaders = { Authorization: "template-secret" };
      const current: MonitorStep = step("current");
      current.data!.requestHeaders = headers;
      const result: MonitorStep = sync(template, current);
      expect(result.data!.requestHeaders).toEqual(headers);
      expect(
        (result.toJSON()["value"] as JSONObject)["requestHeaders"],
      ).toEqual(headers);
    },
  );

  test("a deleted protected property is not reintroduced", (): void => {
    const template: MonitorStep = step("template", ["requestBody"]);
    template.data!.requestBody = "sensitive template body";
    const current: MonitorStep = step("current");
    delete current.data!.requestBody;
    const result: MonitorStep = sync(template, current);
    expect(result.data).not.toHaveProperty("requestBody");
    expect(result.toJSON()["value"]).not.toHaveProperty("requestBody");
  });

  test("explicit false, empty strings and zero survive protected sync and persistence", (): void => {
    const template: MonitorStep = step("template", [
      "requestBody",
      "retryCount",
      "doNotFollowRedirects",
      "allowSelfSignedCertificates",
    ]);
    template.data!.requestBody = "template body";
    template.data!.retryCount = 3;
    template.data!.doNotFollowRedirects = true;
    template.data!.allowSelfSignedCertificates = true;
    const current: MonitorStep = step("current");
    current.data!.requestBody = "";
    current.data!.retryCount = 0;
    current.data!.doNotFollowRedirects = false;
    current.data!.allowSelfSignedCertificates = false;
    const restored: MonitorStep = MonitorStep.fromJSON(
      sync(template, current).toJSON(),
    );
    expect(restored.data).toMatchObject({
      requestBody: "",
      retryCount: 0,
      doNotFollowRedirects: false,
      allowSelfSignedCertificates: false,
    });
  });

  test("TLS certificate, key and passphrase remain a consistent set, including an absent passphrase", (): void => {
    const template: MonitorStep = step("template", ["tlsClientAuthentication"]);
    template.data!.tlsClientCertificate = "template-cert";
    template.data!.tlsClientKey = "template-key";
    template.data!.tlsClientKeyPassphrase = "template-password";
    const current: MonitorStep = step("current");
    current.data!.tlsClientCertificate = "{{monitorSecrets.cert}}";
    current.data!.tlsClientKey = "{{monitorSecrets.key}}";
    delete current.data!.tlsClientKeyPassphrase;
    const result: MonitorStep = sync(template, current);
    expect(result.data!.tlsClientCertificate).toBe(
      current.data!.tlsClientCertificate,
    );
    expect(result.data!.tlsClientKey).toBe(current.data!.tlsClientKey);
    expect(result.data).not.toHaveProperty("tlsClientKeyPassphrase");
  });

  test.each([
    new IP("192.0.2.10"),
    new Hostname("service.internal"),
    URL.fromString("https://production.example.com/health?key=value"),
  ])(
    "preserves typed destinations and ports",
    (destination: IP | Hostname | URL): void => {
      const template: MonitorStep = step("template", [
        "monitorDestination",
        "monitorDestinationPort",
      ]);
      template.data!.monitorDestinationPort = new Port(80);
      const current: MonitorStep = step("current");
      current.data!.monitorDestination = destination;
      current.data!.monitorDestinationPort = new Port(8443);
      const result: MonitorStep = sync(template, current, MonitorType.Port);
      expect(result.data!.monitorDestination).toBeInstanceOf(
        destination.constructor,
      );
      expect(result.data!.monitorDestination!.toString()).toBe(
        destination.toString(),
      );
      expect(result.data!.monitorDestination).not.toBe(destination);
      expect(result.data!.monitorDestinationPort).toBeInstanceOf(Port);
      expect(result.data!.monitorDestinationPort!.toString()).toBe("8443");
    },
  );

  test("matches protected steps by stable ID even when current steps are reordered", (): void => {
    const templateA: MonitorStep = step("a", ["requestHeaders"]);
    const templateB: MonitorStep = step("b", ["monitorDestination"]);
    const currentA: MonitorStep = step("a");
    currentA.data!.requestHeaders = { Authorization: "a-secret" };
    const currentB: MonitorStep = step("b");
    currentB.data!.monitorDestination = URL.fromString(
      "https://b-production.example.com",
    );
    const result: MonitorSteps =
      MonitorTemplateSyncUtil.buildSyncedMonitorSteps({
        templateMonitorSteps: steps(templateA, templateB),
        currentMonitorSteps: steps(currentB, currentA),
        monitorType: MonitorType.API,
      });
    expect(
      result.data!.monitorStepsInstanceArray[0]!.data!.requestHeaders,
    ).toEqual(currentA.data!.requestHeaders);
    expect(
      result.data!.monitorStepsInstanceArray[1]!.data!.monitorDestination!.toString(),
    ).toBe("https://b-production.example.com/");
  });

  test.each([
    [
      steps(step("a", ["requestHeaders"]), step("b")),
      steps(step("x"), step("y")),
    ],
    [steps(step("a", ["requestHeaders"])), steps(step("a"), step("a"))],
    [steps(step("a", ["requestHeaders"]), step("a")), steps(step("a"))],
    [steps(step("a", ["requestHeaders"])), steps()],
    [steps(step("a", ["requestHeaders"])), undefined],
  ])(
    "rejects ambiguous or absent protected step matches",
    (
      templateMonitorSteps: MonitorSteps,
      currentMonitorSteps: MonitorSteps | undefined,
    ): void => {
      expect((): void => {
        MonitorTemplateSyncUtil.buildSyncedMonitorSteps({
          templateMonitorSteps,
          currentMonitorSteps,
          monitorType: MonitorType.API,
        });
      }).toThrow("cannot be matched");
    },
  );

  test("rejects missing step identity even for a single-step fallback", (): void => {
    const template: MonitorStep = step("template", ["requestHeaders"]);
    template.data!.id = "";
    expect((): void => {
      sync(template, step("current"));
    }).toThrow("cannot be matched");
    template.data!.id = "template";
    const current: MonitorStep = step("current");
    current.data!.id = "";
    expect((): void => {
      sync(template, current);
    }).toThrow("cannot be matched");
  });

  test("new unprotected template steps do not require a matching old step", (): void => {
    const result: MonitorSteps =
      MonitorTemplateSyncUtil.buildSyncedMonitorSteps({
        templateMonitorSteps: steps(
          step("existing", ["requestHeaders"]),
          step("new"),
        ),
        currentMonitorSteps: steps(step("existing")),
        monitorType: MonitorType.API,
      });
    expect(
      result.data!.monitorStepsInstanceArray.map(
        (item: MonitorStep): string => {
          return item.data!.id;
        },
      ),
    ).toEqual(["existing", "new"]);
  });

  test("failed matching does not partially change either input", (): void => {
    const template: MonitorSteps = steps(
      step("matched", ["requestHeaders"]),
      step("new", ["requestBody"]),
    );
    const current: MonitorSteps = steps(step("matched"));
    const templateBefore: JSONObject = template.toJSON();
    const currentBefore: JSONObject = current.toJSON();
    expect((): void => {
      MonitorTemplateSyncUtil.buildSyncedMonitorSteps({
        templateMonitorSteps: template,
        currentMonitorSteps: current,
        monitorType: MonitorType.API,
      });
    }).toThrow();
    expect(template.toJSON()).toEqual(templateBefore);
    expect(current.toJSON()).toEqual(currentBefore);
  });

  test("deeply isolates criteria and nested configuration from both inputs", (): void => {
    const template: MonitorStep = step("template", ["requestHeaders"]);
    template.data!.kubernetesMonitor =
      MonitorStepKubernetesMonitorUtil.getDefault();
    template.data!.kubernetesMonitor.resourceFilters = {
      namespace: "template",
    };
    const current: MonitorStep = step("current");
    current.data!.requestHeaders = { Authorization: "current" };
    const templateBefore: JSONObject = template.toJSON();
    const currentBefore: JSONObject = current.toJSON();
    const result: MonitorStep = sync(template, current);
    result.data!.requestHeaders!["Authorization"] = "changed";
    result.data!.kubernetesMonitor!.resourceFilters.namespace = "changed";
    result.data!.monitorCriteria.data!.monitorCriteriaInstanceArray.splice(0);
    expect(template.toJSON()).toEqual(templateBefore);
    expect(current.toJSON()).toEqual(currentBefore);
  });

  test("nested DNS exclusions preserve the resolver while other check settings update", (): void => {
    const template: MonitorStep = step("template", [
      "dnsMonitor.queryName",
      "dnsMonitor.resolver",
    ]);
    template.data!.dnsMonitor = {
      ...MonitorStepDnsMonitorUtil.getDefault(),
      queryName: "template.example.com",
      hostname: "1.1.1.1",
      port: 53,
      timeout: 9000,
    };
    const current: MonitorStep = step("current");
    current.data!.dnsMonitor = {
      ...MonitorStepDnsMonitorUtil.getDefault(),
      queryName: "production.example.com",
      hostname: "192.0.2.53",
      port: 5353,
      timeout: 1000,
    };
    expect(
      sync(template, current, MonitorType.DNS).data!.dnsMonitor,
    ).toMatchObject({
      queryName: "production.example.com",
      hostname: "192.0.2.53",
      port: 5353,
      timeout: 9000,
    });
  });

  test("nested absent values remain absent without importing template defaults", (): void => {
    const template: MonitorStep = step("template", [
      "externalStatusPageMonitor.components",
    ]);
    template.data!.externalStatusPageMonitor = {
      ...MonitorStepExternalStatusPageMonitorUtil.getDefault(),
      statusPageUrl: "https://status.example.com",
      componentGroupName: "Template Group",
      componentName: "Template Component",
    };
    const current: MonitorStep = step("current");
    const result: MonitorStep = sync(
      template,
      current,
      MonitorType.ExternalStatusPage,
    );
    expect(result.data!.externalStatusPageMonitor!.statusPageUrl).toBe(
      "https://status.example.com",
    );
    expect(result.data!.externalStatusPageMonitor).not.toHaveProperty(
      "componentGroupName",
    );
    expect(result.data!.externalStatusPageMonitor).not.toHaveProperty(
      "componentName",
    );
    expect(
      (result.toJSON()["value"] as JSONObject)["externalStatusPageMonitor"],
    ).not.toHaveProperty("componentName");
  });

  test("can restore an excluded nested field when the template config is missing", (): void => {
    const template: MonitorStep = step("template", [
      "externalStatusPageMonitor.statusPageUrl",
    ]);
    const current: MonitorStep = step("current");
    current.data!.externalStatusPageMonitor = {
      ...MonitorStepExternalStatusPageMonitorUtil.getDefault(),
      statusPageUrl: "https://status.production.example.com",
    };
    expect(
      sync(template, current, MonitorType.ExternalStatusPage).data!
        .externalStatusPageMonitor,
    ).toEqual({ statusPageUrl: "https://status.production.example.com" });
  });

  test("does not create a nested config when the protected field is absent on both inputs", (): void => {
    const result: MonitorStep = sync(
      step("template", ["externalStatusPageMonitor.components"]),
      step("current"),
      MonitorType.ExternalStatusPage,
    );
    expect(result.data!.externalStatusPageMonitor).toBeUndefined();
  });

  test.each([MonitorType.SQLQuery, MonitorType.Database])(
    "%s preserves connection credentials while syncing check configuration",
    (monitorType: MonitorType): void => {
      const prefix: "sqlMonitor" | "databaseMonitor" =
        monitorType === MonitorType.SQLQuery ? "sqlMonitor" : "databaseMonitor";
      const template: MonitorStep = step("template", [`${prefix}.connection`]);
      const current: MonitorStep = step("current");
      const defaults:
        | ReturnType<typeof MonitorStepSqlMonitorUtil.getDefault>
        | ReturnType<typeof MonitorStepDatabaseMonitorUtil.getDefault> =
        monitorType === MonitorType.SQLQuery
          ? MonitorStepSqlMonitorUtil.getDefault()
          : MonitorStepDatabaseMonitorUtil.getDefault();
      template.data![prefix] = {
        ...defaults,
        host: "template.example.com",
        username: "template",
        password: "template",
        statementTimeoutInMs: 20000,
      } as never;
      current.data![prefix] = {
        ...defaults,
        host: "production.example.com",
        username: "production",
        password: "{{monitorSecrets.databasePassword}}",
        port: 5433,
        useSsl: true,
        rejectUnauthorizedSsl: false,
        statementTimeoutInMs: 1000,
      } as never;
      const result: MonitorStep = sync(template, current, monitorType);
      expect(result.data![prefix]).toMatchObject({
        host: "production.example.com",
        username: "production",
        password: "{{monitorSecrets.databasePassword}}",
        port: 5433,
        useSsl: true,
        rejectUnauthorizedSsl: false,
        statementTimeoutInMs: 20000,
      });
      expect(MonitorStep.fromJSON(result.toJSON()).data![prefix]).toEqual(
        result.data![prefix],
      );
    },
  );

  test("does not normalize missing DNSSEC values while copying protected fields", (): void => {
    const template: MonitorStep = step("template", [
      "dnssecMonitor.resolvers",
      "dnssecMonitor.checkNameserverConsistency",
    ]);
    template.data!.dnssecMonitor = {
      domainName: "template.example.com",
      resolvers: ["1.1.1.1"],
      checkNameserverConsistency: true,
      signatureExpiryWarningDays: 7,
      timeout: 10000,
      retries: 3,
    };
    const current: MonitorStep = step("current");
    current.data!.dnssecMonitor = {
      domainName: "current.example.com",
      checkNameserverConsistency: false,
    } as never;
    const result: MonitorStep = sync(template, current, MonitorType.DNSSEC);
    expect(result.data!.dnssecMonitor).not.toHaveProperty("resolvers");
    expect(result.data!.dnssecMonitor!.checkNameserverConsistency).toBe(false);
    expect(
      (result.toJSON()["value"] as JSONObject)["dnssecMonitor"],
    ).not.toHaveProperty("resolvers");
  });

  test("Kubernetes keeps the cluster and complete resource selectors without changing metric queries", (): void => {
    const template: MonitorStep = step("template", [
      "kubernetesMonitor.clusterIdentifier",
      "kubernetesMonitor.resources",
    ]);
    template.data!.kubernetesMonitor = {
      ...MonitorStepKubernetesMonitorUtil.getDefault(),
      clusterIdentifier: "template",
      resourceScope: KubernetesResourceScope.Cluster,
      resourceFilters: { namespace: "template" },
    };
    const current: MonitorStep = step("current");
    current.data!.kubernetesMonitor = {
      ...MonitorStepKubernetesMonitorUtil.getDefault(),
      clusterIdentifier: "production",
      resourceScope: KubernetesResourceScope.Pod,
      resourceFilters: { namespace: "production", podName: "app-1" },
    };
    const result: MonitorStep = sync(template, current, MonitorType.Kubernetes);
    expect(result.data!.kubernetesMonitor).toMatchObject({
      clusterIdentifier: "production",
      resourceScope: KubernetesResourceScope.Pod,
      resourceFilters: { namespace: "production", podName: "app-1" },
      metricViewConfig: template.data!.kubernetesMonitor.metricViewConfig,
    });
    result.data!.kubernetesMonitor!.resourceFilters.podName = "changed";
    expect(current.data!.kubernetesMonitor.resourceFilters.podName).toBe(
      "app-1",
    );
  });

  test("whole telemetry configuration retains nested arrays and typed service IDs without sharing references", (): void => {
    const template: MonitorStep = step("template", ["logMonitor"]);
    template.data!.logMonitor = MonitorStepLogMonitorUtil.getDefault();
    const current: MonitorStep = step("current");
    const serviceId: ObjectID = ObjectID.generate();
    current.data!.logMonitor = {
      ...MonitorStepLogMonitorUtil.getDefault(),
      telemetryServiceIds: [serviceId],
      entityKeys: ["production-host"],
      attributes: { environment: "production", accepted: false },
      body: "",
      lastXSecondsOfLogs: 300,
    };
    const result: MonitorStep = sync(template, current, MonitorType.Logs);
    expect(result.data!.logMonitor).toEqual(current.data!.logMonitor);
    expect(result.data!.logMonitor!.telemetryServiceIds[0]).toBeInstanceOf(
      ObjectID,
    );
    expect(result.data!.logMonitor!.telemetryServiceIds[0]).not.toBe(serviceId);
    result.data!.logMonitor!.entityKeys!.push("other-host");
    expect(current.data!.logMonitor.entityKeys).toEqual(["production-host"]);
  });

  test("detects exclusions and rejects invalid template policy before copying", (): void => {
    expect(MonitorTemplateSyncUtil.hasExcludedFields(undefined)).toBe(false);
    expect(
      MonitorTemplateSyncUtil.hasExcludedFields(steps(step("template"))),
    ).toBe(false);
    expect(
      MonitorTemplateSyncUtil.hasExcludedFields(steps(step("template", []))),
    ).toBe(false);
    expect(
      MonitorTemplateSyncUtil.hasExcludedFields(
        steps(step("template", ["requestHeaders"])),
      ),
    ).toBe(true);
    expect((): void => {
      sync(step("template", ["id"]), step("current"));
    }).toThrow("Unsupported do not sync field");
    expect((): void => {
      sync(step("template", ["dnsMonitor.queryName"]), step("current"));
    }).toThrow("Unsupported do not sync field");
    expect((): void => {
      MonitorTemplateSyncUtil.buildSyncedMonitorSteps({
        templateMonitorSteps: undefined,
        currentMonitorSteps: undefined,
        monitorType: MonitorType.API,
      });
    }).toThrow("Monitor template steps are required");
  });
});
