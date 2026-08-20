import TemplateVariablesCatalog, {
  TemplateVariable,
  TemplateVariableGroup,
} from "../../../../UI/Components/MonitorTemplateVariables/TemplateVariablesCatalog";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import { describe, expect, it } from "@jest/globals";

/*
 * Title of the monitor-identity group that getVariables always emits first,
 * and the title of the per-series labels group that only infrastructure
 * monitor types emit last. Declared once so the expectations below stay in
 * lockstep with the source strings.
 */
const MONITOR_GROUP_TITLE: string = "Monitor";
const SERIES_GROUP_TITLE: string = "Series Labels (per-host / per-container)";
const METRIC_GROUP_TITLE: string = "Metric";

/*
 * The eight infrastructure/telemetry monitor types that (a) get the single
 * "Metric" per-type group AND (b) additionally get the "Series Labels" group.
 * Both lists in the source are identical, so one constant covers both.
 */
const INFRA_TYPES: Array<MonitorType> = [
  MonitorType.Metrics,
  MonitorType.Kubernetes,
  MonitorType.Docker,
  MonitorType.Host,
  MonitorType.Podman,
  MonitorType.DockerSwarm,
  MonitorType.Proxmox,
  MonitorType.Ceph,
];

/*
 * Monitor types that hit the `default` arm of perTypeGroup (returns null) and
 * are NOT in the infrastructure list, so getVariables returns the identity
 * group and nothing else. IoTDevice is the notable trap here: it is a
 * telemetry monitor elsewhere in the codebase but is deliberately absent from
 * both the "Metric" and "Series Labels" branches.
 */
const IDENTITY_ONLY_TYPES: Array<MonitorType> = [
  MonitorType.Manual,
  MonitorType.IoTDevice,
  MonitorType.IncomingEmail,
  MonitorType.SQLQuery,
  MonitorType.Logs,
  MonitorType.Traces,
  MonitorType.Exceptions,
  MonitorType.Profiles,
];

interface PerTypeExpectation {
  monitorType: MonitorType;
  title: string;
  keys: Array<string>;
}

/*
 * Every monitor type that produces a per-type group, with the exact ordered
 * key list the source declares. Verifying the whole list (not just a sample)
 * guards against silent additions/removals and reordering.
 */
const PER_TYPE_EXPECTATIONS: Array<PerTypeExpectation> = [
  {
    monitorType: MonitorType.API,
    title: "Response",
    keys: [
      "isOnline",
      "responseStatusCode",
      "responseTimeInMs",
      "responseBody",
      "responseHeaders",
    ],
  },
  {
    monitorType: MonitorType.Website,
    title: "Response",
    keys: [
      "isOnline",
      "responseStatusCode",
      "responseTimeInMs",
      "responseBody",
      "responseHeaders",
    ],
  },
  {
    monitorType: MonitorType.IncomingRequest,
    title: "Incoming Request",
    keys: [
      "requestMethod",
      "requestBody",
      "requestHeaders",
      "incomingRequestReceivedAt",
    ],
  },
  {
    monitorType: MonitorType.Ping,
    title: "Connectivity",
    keys: ["isOnline", "responseTimeInMs", "isTimeout", "failureCause"],
  },
  {
    monitorType: MonitorType.IP,
    title: "Connectivity",
    keys: ["isOnline", "responseTimeInMs", "isTimeout", "failureCause"],
  },
  {
    monitorType: MonitorType.Port,
    title: "Connectivity",
    keys: ["isOnline", "responseTimeInMs", "isTimeout", "failureCause"],
  },
  {
    monitorType: MonitorType.SSLCertificate,
    title: "SSL Certificate",
    keys: [
      "commonName",
      "organization",
      "organizationalUnit",
      "locality",
      "state",
      "country",
      "expiresAt",
      "createdAt",
      "isSelfSigned",
      "serialNumber",
      "fingerprint",
      "fingerprint256",
      "isOnline",
      "failureCause",
    ],
  },
  {
    monitorType: MonitorType.Server,
    title: "Server Metrics",
    keys: [
      "hostname",
      "cpuUsagePercent",
      "cpuCores",
      "memoryUsagePercent",
      "memoryFreePercent",
      "memoryTotalBytes",
      "diskMetrics",
      "processes",
      "requestReceivedAt",
      "failureCause",
    ],
  },
  {
    monitorType: MonitorType.CustomJavaScriptCode,
    title: "Custom Code",
    keys: [
      "result",
      "executionTimeInMs",
      "scriptError",
      "logMessages",
      "failureCause",
    ],
  },
  {
    monitorType: MonitorType.SyntheticMonitor,
    title: "Synthetic Monitor",
    keys: ["syntheticResponses", "failureCause"],
  },
  {
    monitorType: MonitorType.NetworkDevice,
    title: "Network Device (SNMP)",
    keys: [
      "isOnline",
      "responseTimeInMs",
      "isTimeout",
      "failureCause",
      "oidResponses",
      "sysName",
      "sysDescr",
      "sysObjectId",
      "sysLocation",
      "downInterfaces",
      "interfacesTotal",
      "interfacesUp",
      "interfacesDown",
      "interfaceWalkFailure",
      "trapOid",
      "trapSourceIp",
      "trapVarbinds",
    ],
  },
  {
    monitorType: MonitorType.DNS,
    title: "DNS",
    keys: [
      "isOnline",
      "responseTimeInMs",
      "isTimeout",
      "isDnssecValid",
      "failureCause",
      "records",
      "recordValues",
    ],
  },
  {
    monitorType: MonitorType.Domain,
    title: "Domain",
    keys: [
      "isOnline",
      "domainName",
      "lookupMethod",
      "registrar",
      "createdDate",
      "updatedDate",
      "expiresDate",
      "nameServers",
      "domainStatus",
      "dnssec",
      "responseTimeInMs",
      "failureCause",
    ],
  },
  {
    monitorType: MonitorType.DNSSEC,
    title: "DNSSEC",
    keys: [
      "isOnline",
      "domainName",
      "isZoneSigned",
      "isParentDsPresent",
      "isChainValid",
      "resolverConsensusAd",
      "isNameserverConsistent",
      "earliestSignatureExpiration",
      "daysUntilSignatureExpiry",
      "dnskeyCount",
      "dsRecordCount",
      "rrsigCount",
      "responseTimeInMs",
      "failureCause",
    ],
  },
  {
    monitorType: MonitorType.ExternalStatusPage,
    title: "External Status Page",
    keys: [
      "overallStatus",
      "activeIncidentCount",
      "componentStatuses",
      "provider",
      "componentGroup",
      "componentName",
      "isOnline",
      "responseTimeInMs",
      "failureCause",
    ],
  },
];

/*
 * Small helpers so each `it` stays about a single behaviour. These are plain
 * function declarations (not arrow consts) to keep the typedef rule happy
 * without annotating the variable itself.
 */
function keysOf(group: TemplateVariableGroup): Array<string> {
  return group.variables.map((variable: TemplateVariable): string => {
    return variable.key;
  });
}

function titlesOf(groups: Array<TemplateVariableGroup>): Array<string> {
  return groups.map((group: TemplateVariableGroup): string => {
    return group.title;
  });
}

function findGroup(
  groups: Array<TemplateVariableGroup>,
  title: string,
): TemplateVariableGroup | undefined {
  return groups.find((group: TemplateVariableGroup): boolean => {
    return group.title === title;
  });
}

describe("TemplateVariablesCatalog.getVariables - monitor identity group", () => {
  it("always emits the identity group first, for every monitor type in the enum", () => {
    const allTypes: Array<MonitorType> = Object.values(
      MonitorType,
    ) as Array<MonitorType>;

    for (const monitorType of allTypes) {
      const groups: Array<TemplateVariableGroup> =
        TemplateVariablesCatalog.getVariables({ monitorType });

      expect(groups.length).toBeGreaterThanOrEqual(1);
      expect(groups[0]?.title).toBe(MONITOR_GROUP_TITLE);
    }
  });

  it("exposes exactly monitorName and monitorId with their example values", () => {
    const groups: Array<TemplateVariableGroup> =
      TemplateVariablesCatalog.getVariables({ monitorType: MonitorType.API });

    const identity: TemplateVariableGroup | undefined = findGroup(
      groups,
      MONITOR_GROUP_TITLE,
    );

    expect(identity).toBeDefined();
    expect(keysOf(identity as TemplateVariableGroup)).toEqual([
      "monitorName",
      "monitorId",
    ]);
    expect(identity?.variables[0]?.example).toBe("Production API");
    expect(identity?.variables[1]?.example).toBe(
      "a0f78958-da0a-4775-9fd9-c9fc63d3456f",
    );
    expect(identity?.description).toContain("Identity of the monitor");
  });
});

describe("TemplateVariablesCatalog.getVariables - per-type groups", () => {
  for (const expectation of PER_TYPE_EXPECTATIONS) {
    it(`emits the "${expectation.title}" group with the expected keys for ${expectation.monitorType}`, () => {
      const groups: Array<TemplateVariableGroup> =
        TemplateVariablesCatalog.getVariables({
          monitorType: expectation.monitorType,
        });

      const perType: TemplateVariableGroup | undefined = findGroup(
        groups,
        expectation.title,
      );

      expect(perType).toBeDefined();
      expect(keysOf(perType as TemplateVariableGroup)).toEqual(
        expectation.keys,
      );
    });
  }

  it("orders the identity group before the per-type group", () => {
    const groups: Array<TemplateVariableGroup> =
      TemplateVariablesCatalog.getVariables({ monitorType: MonitorType.DNS });

    expect(titlesOf(groups)).toEqual([MONITOR_GROUP_TITLE, "DNS"]);
  });

  it("treats API and Website as the same case (identical Response group)", () => {
    const apiGroups: Array<TemplateVariableGroup> =
      TemplateVariablesCatalog.getVariables({ monitorType: MonitorType.API });
    const websiteGroups: Array<TemplateVariableGroup> =
      TemplateVariablesCatalog.getVariables({
        monitorType: MonitorType.Website,
      });

    expect(findGroup(apiGroups, "Response")).toEqual(
      findGroup(websiteGroups, "Response"),
    );
  });

  it("treats Ping, IP and Port as the same Connectivity case", () => {
    const pingResponse: TemplateVariableGroup | undefined = findGroup(
      TemplateVariablesCatalog.getVariables({ monitorType: MonitorType.Ping }),
      "Connectivity",
    );
    const ipResponse: TemplateVariableGroup | undefined = findGroup(
      TemplateVariablesCatalog.getVariables({ monitorType: MonitorType.IP }),
      "Connectivity",
    );
    const portResponse: TemplateVariableGroup | undefined = findGroup(
      TemplateVariablesCatalog.getVariables({ monitorType: MonitorType.Port }),
      "Connectivity",
    );

    expect(pingResponse).toEqual(ipResponse);
    expect(ipResponse).toEqual(portResponse);
  });

  it("gives the Response group a description while the Incoming Request group has none", () => {
    const responseGroup: TemplateVariableGroup | undefined = findGroup(
      TemplateVariablesCatalog.getVariables({ monitorType: MonitorType.API }),
      "Response",
    );
    const incomingGroup: TemplateVariableGroup | undefined = findGroup(
      TemplateVariablesCatalog.getVariables({
        monitorType: MonitorType.IncomingRequest,
      }),
      "Incoming Request",
    );

    expect(responseGroup?.description).toBeDefined();
    expect(responseGroup?.description?.length).toBeGreaterThan(0);
    expect(incomingGroup?.description).toBeUndefined();
  });

  it("leaves responseHeaders without an example while responseBody has one", () => {
    const responseGroup: TemplateVariableGroup | undefined = findGroup(
      TemplateVariablesCatalog.getVariables({ monitorType: MonitorType.API }),
      "Response",
    );

    const responseHeaders: TemplateVariable | undefined =
      responseGroup?.variables.find((variable: TemplateVariable): boolean => {
        return variable.key === "responseHeaders";
      });
    const responseBody: TemplateVariable | undefined =
      responseGroup?.variables.find((variable: TemplateVariable): boolean => {
        return variable.key === "responseBody";
      });

    expect(responseHeaders?.example).toBeUndefined();
    expect(responseBody?.example).toBe('{"status":"degraded"}');
  });

  it("includes SNMP trap and interface variables for a Network Device monitor", () => {
    const snmpGroup: TemplateVariableGroup | undefined = findGroup(
      TemplateVariablesCatalog.getVariables({
        monitorType: MonitorType.NetworkDevice,
      }),
      "Network Device (SNMP)",
    );

    const keys: Array<string> = keysOf(snmpGroup as TemplateVariableGroup);

    expect(keys).toEqual(expect.arrayContaining(["trapOid", "trapVarbinds"]));
    expect(keys).toEqual(
      expect.arrayContaining(["interfacesUp", "interfacesDown"]),
    );
  });
});

describe("TemplateVariablesCatalog.getVariables - identity-only monitor types", () => {
  for (const monitorType of IDENTITY_ONLY_TYPES) {
    it(`returns only the identity group for ${monitorType} (default branch, no series labels)`, () => {
      const groups: Array<TemplateVariableGroup> =
        TemplateVariablesCatalog.getVariables({ monitorType });

      expect(groups.length).toBe(1);
      expect(titlesOf(groups)).toEqual([MONITOR_GROUP_TITLE]);
    });
  }

  it("does not emit a series-labels group for IoTDevice even when attribute keys are supplied", () => {
    const groups: Array<TemplateVariableGroup> =
      TemplateVariablesCatalog.getVariables({
        monitorType: MonitorType.IoTDevice,
        seriesAttributeKeys: ["host.name"],
      });

    expect(findGroup(groups, SERIES_GROUP_TITLE)).toBeUndefined();
    expect(groups.length).toBe(1);
  });
});

describe("TemplateVariablesCatalog.getVariables - infrastructure series labels", () => {
  for (const monitorType of INFRA_TYPES) {
    it(`emits identity, Metric and series-labels groups in order for ${monitorType}`, () => {
      const groups: Array<TemplateVariableGroup> =
        TemplateVariablesCatalog.getVariables({
          monitorType,
          seriesAttributeKeys: ["region"],
        });

      expect(titlesOf(groups)).toEqual([
        MONITOR_GROUP_TITLE,
        METRIC_GROUP_TITLE,
        SERIES_GROUP_TITLE,
      ]);
    });
  }

  it("exposes the single metricName variable in the Metric group", () => {
    const metricGroup: TemplateVariableGroup | undefined = findGroup(
      TemplateVariablesCatalog.getVariables({
        monitorType: MonitorType.Metrics,
      }),
      METRIC_GROUP_TITLE,
    );

    expect(keysOf(metricGroup as TemplateVariableGroup)).toEqual([
      "metricName",
    ]);
    expect(metricGroup?.variables[0]?.example).toBe("container.cpu.time");
  });

  it("returns an empty series group with the 'Group By' guidance when no attribute keys are given", () => {
    const groups: Array<TemplateVariableGroup> =
      TemplateVariablesCatalog.getVariables({
        monitorType: MonitorType.Kubernetes,
      });

    const seriesGroup: TemplateVariableGroup | undefined = findGroup(
      groups,
      SERIES_GROUP_TITLE,
    );

    expect(seriesGroup).toBeDefined();
    expect(seriesGroup?.variables).toEqual([]);
    expect(seriesGroup?.description).toContain("Group By");
  });

  it("treats an explicit empty array the same as omitting the keys", () => {
    const omitted: TemplateVariableGroup | undefined = findGroup(
      TemplateVariablesCatalog.getVariables({ monitorType: MonitorType.Host }),
      SERIES_GROUP_TITLE,
    );
    const emptyArray: TemplateVariableGroup | undefined = findGroup(
      TemplateVariablesCatalog.getVariables({
        monitorType: MonitorType.Host,
        seriesAttributeKeys: [],
      }),
      SERIES_GROUP_TITLE,
    );

    expect(emptyArray).toEqual(omitted);
    expect(emptyArray?.variables).toEqual([]);
  });

  it("maps each attribute key to a variable, preserving order and count", () => {
    const seriesGroup: TemplateVariableGroup | undefined = findGroup(
      TemplateVariablesCatalog.getVariables({
        monitorType: MonitorType.Docker,
        seriesAttributeKeys: ["region", "host.name", "az"],
      }),
      SERIES_GROUP_TITLE,
    );

    expect(keysOf(seriesGroup as TemplateVariableGroup)).toEqual([
      "region",
      "host.name",
      "az",
    ]);
  });

  it("preserves duplicate attribute keys as separate variables (no dedupe)", () => {
    const seriesGroup: TemplateVariableGroup | undefined = findGroup(
      TemplateVariablesCatalog.getVariables({
        monitorType: MonitorType.Ceph,
        seriesAttributeKeys: ["host.name", "host.name"],
      }),
      SERIES_GROUP_TITLE,
    );

    expect(seriesGroup?.variables.length).toBe(2);
  });

  it("wraps each attribute key in backticks inside its description", () => {
    const seriesGroup: TemplateVariableGroup | undefined = findGroup(
      TemplateVariablesCatalog.getVariables({
        monitorType: MonitorType.Proxmox,
        seriesAttributeKeys: ["region"],
      }),
      SERIES_GROUP_TITLE,
    );

    expect(seriesGroup?.variables[0]?.description).toBe(
      "Value of `region` for the series that breached the threshold.",
    );
  });

  it("uses the curated example for host.name, container name, and undefined otherwise", () => {
    const seriesGroup: TemplateVariableGroup | undefined = findGroup(
      TemplateVariablesCatalog.getVariables({
        monitorType: MonitorType.Metrics,
        seriesAttributeKeys: [
          "host.name",
          "resource.k8s.container.name",
          "region",
        ],
      }),
      SERIES_GROUP_TITLE,
    );

    expect(seriesGroup?.variables[0]?.example).toBe("prod-db-01");
    expect(seriesGroup?.variables[1]?.example).toBe("mariadb");
    expect(seriesGroup?.variables[2]?.example).toBeUndefined();
  });

  it("swaps the description to the per-series wording once keys exist", () => {
    const seriesGroup: TemplateVariableGroup | undefined = findGroup(
      TemplateVariablesCatalog.getVariables({
        monitorType: MonitorType.DockerSwarm,
        seriesAttributeKeys: ["host.name"],
      }),
      SERIES_GROUP_TITLE,
    );

    expect(seriesGroup?.description).toContain(
      "One incident fires per unique combination",
    );
    expect(seriesGroup?.description).not.toContain("Group By");
  });
});

describe("TemplateVariablesCatalog.getVariables - non-infra types ignore series keys", () => {
  it("does not add a series group for an API monitor even with attribute keys", () => {
    const groups: Array<TemplateVariableGroup> =
      TemplateVariablesCatalog.getVariables({
        monitorType: MonitorType.API,
        seriesAttributeKeys: ["host.name", "region"],
      });

    expect(findGroup(groups, SERIES_GROUP_TITLE)).toBeUndefined();
    expect(titlesOf(groups)).toEqual([MONITOR_GROUP_TITLE, "Response"]);
  });
});

describe("TemplateVariablesCatalog.getVariables - structural invariants", () => {
  const allTypes: Array<MonitorType> = Object.values(
    MonitorType,
  ) as Array<MonitorType>;

  it("returns between one and three groups for every monitor type", () => {
    for (const monitorType of allTypes) {
      const groups: Array<TemplateVariableGroup> =
        TemplateVariablesCatalog.getVariables({
          monitorType,
          seriesAttributeKeys: ["host.name"],
        });

      expect(groups.length).toBeGreaterThanOrEqual(1);
      expect(groups.length).toBeLessThanOrEqual(3);
    }
  });

  it("gives every variable a non-empty key and description, with example being a string or undefined", () => {
    for (const monitorType of allTypes) {
      const groups: Array<TemplateVariableGroup> =
        TemplateVariablesCatalog.getVariables({
          monitorType,
          seriesAttributeKeys: ["host.name", "region"],
        });

      for (const group of groups) {
        expect(group.title.length).toBeGreaterThan(0);

        for (const variable of group.variables) {
          expect(typeof variable.key).toBe("string");
          expect(variable.key.length).toBeGreaterThan(0);
          expect(typeof variable.description).toBe("string");
          expect(variable.description.length).toBeGreaterThan(0);

          if (variable.example !== undefined) {
            expect(typeof variable.example).toBe("string");
          }
        }
      }
    }
  });

  it("keeps variable keys unique within every non-series group", () => {
    for (const monitorType of allTypes) {
      const groups: Array<TemplateVariableGroup> =
        TemplateVariablesCatalog.getVariables({ monitorType });

      for (const group of groups) {
        if (group.title === SERIES_GROUP_TITLE) {
          continue;
        }

        const keys: Array<string> = keysOf(group);
        const uniqueKeys: Set<string> = new Set<string>(keys);
        expect(uniqueKeys.size).toBe(keys.length);
      }
    }
  });
});

describe("TemplateVariablesCatalog.getVariables - determinism and isolation", () => {
  it("returns deeply equal output across repeated calls with the same input", () => {
    const first: Array<TemplateVariableGroup> =
      TemplateVariablesCatalog.getVariables({
        monitorType: MonitorType.Kubernetes,
        seriesAttributeKeys: ["host.name", "region"],
      });
    const second: Array<TemplateVariableGroup> =
      TemplateVariablesCatalog.getVariables({
        monitorType: MonitorType.Kubernetes,
        seriesAttributeKeys: ["host.name", "region"],
      });

    expect(first).toEqual(second);
  });

  it("hands back a fresh array instance each call (no shared mutable state)", () => {
    const first: Array<TemplateVariableGroup> =
      TemplateVariablesCatalog.getVariables({ monitorType: MonitorType.DNS });
    const second: Array<TemplateVariableGroup> =
      TemplateVariablesCatalog.getVariables({ monitorType: MonitorType.DNS });

    expect(first).not.toBe(second);

    first.push({ title: "Injected", variables: [] });
    expect(titlesOf(second)).not.toContain("Injected");
  });
});
