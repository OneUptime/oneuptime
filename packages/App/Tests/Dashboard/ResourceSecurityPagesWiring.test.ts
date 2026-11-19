import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ComplianceFramework from "Common/Types/DataSecurity/ComplianceFramework";
import { ComplianceRequirementStatus } from "Common/Types/DataSecurity/ComplianceRequirementCatalog";
import { DataSecurityResourceComplianceFramework } from "Common/Types/DataSecurity/DataSecurityApiTypes";
import {
  ALL_DATA_STORE_RESOURCE_KINDS,
  DataStoreResourceKind,
} from "Common/Types/DataSecurity/DataStoreResource";
import {
  ResourceSecurityScopeJson,
  SECURITY_LOG_DOCKER_HOST_ATTRIBUTE,
  SecurityConnectionKind,
} from "Common/Types/SecurityCase/SecurityConnection";
import { SECURITY_EVENT_SCOPE_QUERY_KEY } from "Common/Types/SecurityEvent/SecurityEventScope";
import { ActiveFilter } from "Common/UI/Components/TelemetryViewer/types";
import {
  RESOURCE_SECURITY_EVENTS_CHIP_KEYS,
  RESOURCE_SECURITY_EVENTS_NAMING_DESCRIPTION,
  RESOURCE_SECURITY_EVENTS_NAMING_LABEL,
  RESOURCE_SECURITY_EVENTS_NO_SEARCH_REASON,
  RESOURCE_SECURITY_EVENTS_OWN_LOGS_DESCRIPTION,
  RESOURCE_SECURITY_EVENTS_OWN_LOGS_DESCRIPTIONS,
  RESOURCE_SECURITY_EVENTS_OWN_LOGS_LABEL,
  RESOURCE_SECURITY_EVENTS_SUMMARIES_BOTH,
  RESOURCE_SECURITY_EVENTS_SUMMARIES_OWN_LOGS,
  RESOURCE_SECURITY_EVENTS_SUMMARY_BOTH,
  RESOURCE_SECURITY_EVENTS_SUMMARY_NAMING,
  RESOURCE_SECURITY_EVENTS_SUMMARY_OWN_LOGS,
  getResourceSecurityEventsChip,
  isResourceSecurityEventsScopeReadable,
} from "../../FeatureSet/Dashboard/src/Components/ResourceSecurity/ResourceSecurityEventsScope";
import {
  OWNER_NOTICE_TEMPLATES,
  SET_ON_OWNER_SENTENCES,
  getAppliesSwitchState,
  getComplianceSwitchKey,
  splitResourceFrameworks,
} from "../../FeatureSet/Dashboard/src/Components/ResourceDataSecurity/ResourceComplianceModel";

/*
 * SECURITY EVENTS AND DATA SECURITY INSIDE RESOURCES (#9547, #9555).
 *
 * A host's and a cluster's Security Events pages, and the Data Security
 * and Compliance pages of every resource a data store belongs to: pinned
 * here without rendering - the words their chip and switches work out, and
 * their wiring into routes, layouts, breadcrumbs, menus and Search (App's
 * node environment cannot render the pages; Common/Tests/App/Dashboard
 * renders them).
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /(^|[^:])\/\/[^\n]*/g;
const WHITESPACE: RegExp = /\s+/g;

function readCode(relativePath: string): string {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, relativePath), "utf8")
    .replace(BLOCK_COMMENT, " ")
    .replace(LINE_COMMENT, "$1")
    .replace(WHITESPACE, " ");
}

// The route map holds `/*`, which a comment stripper misreads: read whole.
function readWhole(relativePath: string): string {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, relativePath), "utf8")
    .replace(WHITESPACE, " ");
}

const ID: string = "55555555-5555-4555-8555-555555555555";

function scopeOf(
  overrides: Partial<ResourceSecurityScopeJson> = {},
): ResourceSecurityScopeJson {
  return {
    kind: SecurityConnectionKind.KubernetesCluster,
    id: ID,
    name: "prod-eu",
    values: ["prod-eu"],
    isSearchedByLogs: false,
    scope: { observables: ["prod-eu", "PROD-EU"] },
    ...overrides,
  };
}

describe("a record's Security Events chip", () => {
  test("names the record by its kind and name, locked", () => {
    const chip: ActiveFilter = getResourceSecurityEventsChip(scopeOf());

    expect(chip).toMatchObject({
      facetKey: SECURITY_EVENT_SCOPE_QUERY_KEY,
      value: ID,
      displayKey: "Kubernetes Cluster",
      displayValue: "prod-eu",
      readOnly: true,
    });
  });

  test("every kind of record has its own name on the chip", () => {
    for (const kind of Object.values(SecurityConnectionKind)) {
      expect(RESOURCE_SECURITY_EVENTS_CHIP_KEYS[kind]).toBeTruthy();
      expect(getResourceSecurityEventsChip(scopeOf({ kind })).displayKey).toBe(
        RESOURCE_SECURITY_EVENTS_CHIP_KEYS[kind],
      );
    }

    expect(
      getResourceSecurityEventsChip(
        scopeOf({ kind: SecurityConnectionKind.Host }),
      ).displayKey,
    ).toBe("Host");
  });

  test("a record that names itself: one match, Naming it, with its identities", () => {
    const chip: ActiveFilter = getResourceSecurityEventsChip(scopeOf());

    expect(chip.lockedDetail?.scopeSummary).toBe(
      RESOURCE_SECURITY_EVENTS_SUMMARY_NAMING,
    );
    expect(chip.lockedDetail?.scopeMatches).toEqual([
      {
        label: RESOURCE_SECURITY_EVENTS_NAMING_LABEL,
        description: RESOURCE_SECURITY_EVENTS_NAMING_DESCRIPTION,
        values: ["prod-eu"],
      },
    ]);
    expect(chip.lockedDetail?.searchToken).toBeUndefined();
    expect(chip.lockedDetail?.searchTokenUnavailableReason).toBe(
      RESOURCE_SECURITY_EVENTS_NO_SEARCH_REASON,
    );
  });

  test("a record read by its own logs, and one read both ways", () => {
    // A serverless function's own logs are its logs: the shared words.
    const ownLogs: ActiveFilter = getResourceSecurityEventsChip(
      scopeOf({
        kind: SecurityConnectionKind.ServerlessFunction,
        values: [],
        isSearchedByLogs: true,
        scope: {
          observables: [],
          attributeKey: "oneuptime.log.resource.id",
          attributeValues: [ID],
        },
      }),
    );

    expect(ownLogs.lockedDetail?.scopeSummary).toBe(
      RESOURCE_SECURITY_EVENTS_SUMMARY_OWN_LOGS,
    );
    expect(ownLogs.lockedDetail?.scopeMatches).toEqual([
      {
        label: RESOURCE_SECURITY_EVENTS_OWN_LOGS_LABEL,
        description: RESOURCE_SECURITY_EVENTS_OWN_LOGS_DESCRIPTION,
        values: ["prod-eu"],
      },
    ]);

    const both: ActiveFilter = getResourceSecurityEventsChip(
      scopeOf({
        scope: {
          observables: ["prod-eu"],
          attributeKey: "networkDevice.id",
          attributeValues: [ID],
        },
      }),
    );

    expect(both.lockedDetail?.scopeSummary).toBe(
      RESOURCE_SECURITY_EVENTS_SUMMARY_BOTH,
    );
    expect(both.lockedDetail?.scopeMatches).toHaveLength(2);
  });

  test("a Docker or Podman host's own logs are its containers' logs (#9628)", () => {
    for (const kind of [
      SecurityConnectionKind.DockerHost,
      SecurityConnectionKind.PodmanHost,
    ]) {
      const chip: ActiveFilter = getResourceSecurityEventsChip(
        scopeOf({
          kind,
          name: "build-1",
          values: ["build-1"],
          scope: {
            observables: ["build-1", "BUILD-1"],
            attributeKey: SECURITY_LOG_DOCKER_HOST_ATTRIBUTE,
            attributeValues: ["build-1"],
          },
        }),
      );

      expect(chip.lockedDetail?.scopeSummary).toBe(
        RESOURCE_SECURITY_EVENTS_SUMMARIES_BOTH[kind],
      );
      expect(chip.lockedDetail?.scopeSummary).toBe(
        "The security events about it: read from its containers' logs, or naming it.",
      );
      expect(chip.lockedDetail?.scopeMatches?.[0]).toEqual({
        label: RESOURCE_SECURITY_EVENTS_OWN_LOGS_LABEL,
        description:
          "Every security event read from its containers' logs, whatever it names.",
        values: ["build-1"],
      });
    }
  });

  test("a container host known by its name alone is said to be named, not read", () => {
    const chip: ActiveFilter = getResourceSecurityEventsChip(
      scopeOf({
        kind: SecurityConnectionKind.DockerHost,
        name: "Build Box",
        values: ["build box"],
        scope: { observables: ["build box", "BUILD BOX"] },
      }),
    );

    expect(chip.lockedDetail?.scopeSummary).toBe(
      RESOURCE_SECURITY_EVENTS_SUMMARY_NAMING,
    );
  });

  test("a service's own logs are its logs and its traces (#9628)", () => {
    const chip: ActiveFilter = getResourceSecurityEventsChip(
      scopeOf({
        kind: SecurityConnectionKind.Service,
        name: "checkout",
        values: [],
        isSearchedByLogs: true,
        scope: {
          observables: [],
          attributeKey: "oneuptime.log.resource.id",
          attributeValues: [ID],
        },
      }),
    );

    expect(chip.displayKey).toBe("Service");
    expect(chip.lockedDetail?.scopeSummary).toBe(
      RESOURCE_SECURITY_EVENTS_SUMMARIES_OWN_LOGS[
        SecurityConnectionKind.Service
      ],
    );
    expect(chip.lockedDetail?.scopeMatches).toEqual([
      {
        label: RESOURCE_SECURITY_EVENTS_OWN_LOGS_LABEL,
        description:
          RESOURCE_SECURITY_EVENTS_OWN_LOGS_DESCRIPTIONS[
            SecurityConnectionKind.Service
          ],
        values: ["checkout"],
      },
    ]);
  });

  test("an OpenStack cloud is read both ways, in the shared words", () => {
    const chip: ActiveFilter = getResourceSecurityEventsChip(
      scopeOf({
        kind: SecurityConnectionKind.OpenStackCloud,
        name: "production",
        values: ["production"],
        scope: {
          observables: ["production", "PRODUCTION"],
          attributeKey: "oneuptime.log.resource.id",
          attributeValues: [ID],
        },
      }),
    );

    expect(chip.displayKey).toBe("OpenStack Cloud");
    expect(chip.lockedDetail?.scopeSummary).toBe(
      RESOURCE_SECURITY_EVENTS_SUMMARY_BOTH,
    );
    expect(chip.lockedDetail?.scopeMatches?.[0]?.description).toBe(
      RESOURCE_SECURITY_EVENTS_OWN_LOGS_DESCRIPTION,
    );
  });

  test("a page's own words win: a device's syslog", () => {
    const chip: ActiveFilter = getResourceSecurityEventsChip(scopeOf(), {
      chipKey: "Network Device",
      summary: "About this device.",
      noSearchReason: "Not one search.",
    });

    expect(chip.displayKey).toBe("Network Device");
    expect(chip.lockedDetail?.scopeSummary).toBe("About this device.");
    expect(chip.lockedDetail?.searchTokenUnavailableReason).toBe(
      "Not one search.",
    );
  });

  test("a record with no name is named by its id; a scope with nothing to match is not readable", () => {
    expect(
      getResourceSecurityEventsChip(scopeOf({ name: " " })).displayValue,
    ).toBe(ID);
    expect(isResourceSecurityEventsScopeReadable(scopeOf())).toBe(true);
    expect(
      isResourceSecurityEventsScopeReadable(
        scopeOf({ values: [], scope: { observables: [] } }),
      ),
    ).toBe(false);
  });
});

describe("a resource's Compliance page, worked out", () => {
  function frameworkOf(
    framework: ComplianceFramework,
    extra: Partial<DataSecurityResourceComplianceFramework> = {},
  ): DataSecurityResourceComplianceFramework {
    return {
      framework,
      score: 80,
      storesInScope: 1,
      storesTurnedOff: 0,
      requirements: [
        {
          requirement: "CC6.1",
          title: "Logical access security",
          status: ComplianceRequirementStatus.Passing,
          checkIds: [],
          failingIssueCount: 0,
        },
      ],
      fullName: framework,
      scope: "",
      isTurnedOff: false,
      turnedOffRequirements: [],
      ...extra,
    };
  }

  test("frameworks in scope come first, those turned off and those out of scope fold away, in the catalog's order", () => {
    const sections: ReturnType<typeof splitResourceFrameworks> =
      splitResourceFrameworks([
        frameworkOf(ComplianceFramework.GDPR, { storesInScope: 0 }),
        frameworkOf(ComplianceFramework.HIPAA, {
          isTurnedOff: true,
          storesInScope: 0,
          storesTurnedOff: 1,
        }),
        frameworkOf(ComplianceFramework.SOC2),
        frameworkOf(ComplianceFramework.ISO27001),
      ]);

    expect(
      sections.applying.map((each: DataSecurityResourceComplianceFramework) => {
        return each.framework;
      }),
    ).toEqual([ComplianceFramework.SOC2, ComplianceFramework.ISO27001]);
    expect(sections.turnedOff[0]?.framework).toBe(ComplianceFramework.HIPAA);
    expect(sections.notInScope[0]?.framework).toBe(ComplianceFramework.GDPR);
  });

  test("a switch is on until the resource turned it off: the framework, or its requirement", () => {
    const on: DataSecurityResourceComplianceFramework = frameworkOf(
      ComplianceFramework.SOC2,
      { turnedOffRequirements: ["A1.2"] },
    );

    expect(
      getAppliesSwitchState(on, { framework: ComplianceFramework.SOC2 }),
    ).toBe(true);
    expect(
      getAppliesSwitchState(on, {
        framework: ComplianceFramework.SOC2,
        requirement: "CC6.1",
      }),
    ).toBe(true);
    expect(
      getAppliesSwitchState(on, {
        framework: ComplianceFramework.SOC2,
        requirement: " A1.2 ",
      }),
    ).toBe(false);

    const off: DataSecurityResourceComplianceFramework = frameworkOf(
      ComplianceFramework.SOC2,
      { isTurnedOff: true },
    );

    expect(
      getAppliesSwitchState(off, {
        framework: ComplianceFramework.SOC2,
        requirement: "CC6.1",
      }),
    ).toBe(false);
  });

  test("one switch per framework and requirement", () => {
    expect(
      getComplianceSwitchKey({ framework: ComplianceFramework.SOC2 }),
    ).toBe("SOC 2|");
    expect(
      getComplianceSwitchKey({
        framework: ComplianceFramework.SOC2,
        requirement: " CC6.1 ",
      }),
    ).toBe("SOC 2|CC6.1");
  });

  test("a database's switches are said to be on the cluster or host it runs on, in a sentence of each", () => {
    for (const kind of [
      DataStoreResourceKind.KubernetesCluster,
      DataStoreResourceKind.DockerHost,
      DataStoreResourceKind.PodmanHost,
    ]) {
      expect(SET_ON_OWNER_SENTENCES[kind]).toMatch(/this database runs on\.$/);
      expect(OWNER_NOTICE_TEMPLATES[kind]).toContain("{{name}}");
    }
  });
});

describe("the pages' wiring", () => {
  const PAGES: Array<{
    page: string;
    path: string;
    root: string;
    pathDictionary: string;
  }> = [
    {
      page: "HOST_VIEW_SECURITY_EVENTS",
      path: "security-events",
      root: "host",
      pathDictionary: "HostRoutePath",
    },
    {
      page: "KUBERNETES_CLUSTER_VIEW_SECURITY_EVENTS",
      path: "security-events",
      root: "kubernetes",
      pathDictionary: "KubernetesRoutePath",
    },
    {
      page: "KUBERNETES_CLUSTER_VIEW_DATA_SECURITY",
      path: "data-security",
      root: "kubernetes",
      pathDictionary: "KubernetesRoutePath",
    },
    {
      page: "KUBERNETES_CLUSTER_VIEW_COMPLIANCE",
      path: "compliance",
      root: "kubernetes",
      pathDictionary: "KubernetesRoutePath",
    },
  ];

  test.each(PAGES)(
    "$page is a page of its record at :id/$path",
    (entry: {
      page: string;
      path: string;
      root: string;
      pathDictionary: string;
    }) => {
      expect(readCode("Utils/PageMap.ts")).toContain(
        `${entry.page} = "${entry.page}",`,
      );
      expect(readCode("Utils/RouteMap.ts")).toContain(
        `[PageMap.${entry.page}]: \`\${RouteParams.ModelID}/${entry.path}\`,`,
      );
      expect(readWhole("Utils/RouteMap.ts")).toContain(
        `[PageMap.${entry.page}]: new Route( \`/dashboard/\${RouteParams.ProjectID}/${entry.root}/\${ ${entry.pathDictionary}[PageMap.${entry.page}] }\`, ),`,
      );
    },
  );

  test("each is routed to its page", () => {
    const host: string = readCode("Routes/HostRoutes.tsx");
    const kubernetes: string = readCode("Routes/KubernetesRoutes.tsx");

    expect(host).toMatch(
      /HostSecurityEvents[^;]*from "\.\.\/Pages\/Host\/View\/SecurityEvents"/,
    );
    expect(host).toContain("PageMap.HOST_VIEW_SECURITY_EVENTS");
    expect(host).toContain("<HostSecurityEvents");

    for (const [component, file, page] of [
      [
        "KubernetesClusterViewSecurityEvents",
        "SecurityEvents",
        "KUBERNETES_CLUSTER_VIEW_SECURITY_EVENTS",
      ],
      [
        "KubernetesClusterViewDataSecurity",
        "DataSecurity",
        "KUBERNETES_CLUSTER_VIEW_DATA_SECURITY",
      ],
      [
        "KubernetesClusterViewCompliance",
        "Compliance",
        "KUBERNETES_CLUSTER_VIEW_COMPLIANCE",
      ],
    ] as Array<[string, string, string]>) {
      expect(kubernetes).toContain(
        `import ${component} from "../Pages/Kubernetes/View/${file}";`,
      );
      expect(kubernetes).toContain(`<${component}`);
      expect(kubernetes).toContain(`PageMap.${page}`);
    }
  });

  test("each page hands its record's kind to the shared page", () => {
    expect(readCode("Pages/Host/View/SecurityEvents.tsx")).toContain(
      "<ResourceSecurityEventsPage {...props} kind={SecurityConnectionKind.Host} />",
    );
    expect(readCode("Pages/Kubernetes/View/SecurityEvents.tsx")).toContain(
      "kind={SecurityConnectionKind.KubernetesCluster}",
    );
    expect(readCode("Pages/Kubernetes/View/DataSecurity.tsx")).toContain(
      "<ResourceDataSecurityPage {...props} kind={DataStoreResourceKind.KubernetesCluster} />",
    );
    // A cluster's scores the cluster itself first, and its databases while Data Security is shown (#9627).
    expect(readCode("Pages/Kubernetes/View/Compliance.tsx")).toContain(
      "<KubernetesComplianceSection clusterId={modelId} /> {dataSecurity ? ( <ResourceCompliancePage {...props} kind={DataStoreResourceKind.KubernetesCluster} title={DATABASES_TITLE} />",
    );
  });

  test("their breadcrumbs end in their names, under their record", () => {
    expect(readCode("Utils/Breadcrumbs/HostBreadcrumbs.ts")).toContain(
      'BuildBreadcrumbLinksByTitles(PageMap.HOST_VIEW_SECURITY_EVENTS, [ "Project", "Hosts", "View Host", "Security Events", ])',
    );

    const kubernetes: string = readCode(
      "Utils/Breadcrumbs/KubernetesBreadcrumbs.ts",
    );

    for (const [page, title] of [
      ["KUBERNETES_CLUSTER_VIEW_SECURITY_EVENTS", "Security Events"],
      ["KUBERNETES_CLUSTER_VIEW_DATA_SECURITY", "Data Security"],
      ["KUBERNETES_CLUSTER_VIEW_COMPLIANCE", "Compliance"],
    ] as Array<[string, string]>) {
      expect(kubernetes).toMatch(
        new RegExp(
          `PageMap\\.${page},?\\s*\\[\\s*"Project",\\s*"Kubernetes",\\s*"View Cluster",\\s*"${title}",?\\s*\\]`,
        ),
      );
    }
  });

  test("each menu draws its entries itself, behind its product's gate", () => {
    const host: string = readCode("Pages/Host/View/SideMenu.tsx");
    const kubernetes: string = readCode("Pages/Kubernetes/View/SideMenu.tsx");
    const device: string = readCode("Pages/NetworkDevice/View/SideMenu.tsx");

    for (const menu of [host, kubernetes, device]) {
      expect(menu).toContain(
        "const showSecurityEvents: boolean = useResourceSecurityEventsMenu();",
      );
      expect(menu).toContain(
        '{showSecurityEvents ? ( <SideMenuItem link={{ title: "Security Events",',
      );
    }

    expect(kubernetes).toContain(
      "useResourceDataSecurityMenu({ kind: DataStoreResourceKind.KubernetesCluster, modelId: props.modelId, })",
    );
    expect(kubernetes).toContain(
      '{dataSecurityMenu || counts.pods ? ( <SideMenuSection title="Security"> {dataSecurityMenu ? ( <SideMenuItem link={{ title: "Data Security", to: dataSecurityMenu.dataSecurityRoute, }}',
    );
    expect(kubernetes).toContain(
      'title: "Compliance", to: RouteUtil.populateRouteParams( RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_COMPLIANCE] as Route, { modelId: props.modelId }, ),',
    );
  });

  test("in each menu, Security Events sits right after Logs (a host) or Events (a cluster), and Security after Activity", () => {
    const host: string = readCode("Pages/Host/View/SideMenu.tsx");
    const kubernetes: string = readCode("Pages/Kubernetes/View/SideMenu.tsx");

    expect(host.indexOf('title: "Security Events"')).toBeGreaterThan(
      host.indexOf(
        'title: "Logs"',
        host.indexOf("PageMap.HOST_VIEW_PROCESSES"),
      ),
    );
    expect(host.indexOf('title: "Security Events"')).toBeLessThan(
      host.indexOf(
        'title: "Traces"',
        host.indexOf("PageMap.HOST_VIEW_PROCESSES"),
      ),
    );
    expect(kubernetes.indexOf('title: "Security Events"')).toBeGreaterThan(
      kubernetes.indexOf('title: "Events"'),
    );
    expect(kubernetes.indexOf('title: "Security Events"')).toBeLessThan(
      kubernetes.indexOf('title: "Profiles"'),
    );
    expect(
      kubernetes.indexOf('<SideMenuSection title="Security">'),
    ).toBeGreaterThan(kubernetes.indexOf('<SideMenuSection title="Activity">'));
  });

  test("Search finds each page under its menu's section and title", () => {
    const index: string = readCode(
      "Components/CommandPalette/RecordPageSearchIndex.ts",
    );

    expect(index).toContain(
      'page: PageMap.HOST_VIEW_SECURITY_EVENTS, section: "Observability", title: "Security Events",',
    );
    expect(index).toContain(
      'page: PageMap.KUBERNETES_CLUSTER_VIEW_SECURITY_EVENTS, section: "Telemetry", title: "Security Events",',
    );
    expect(index).toContain(
      'page: PageMap.KUBERNETES_CLUSTER_VIEW_DATA_SECURITY, section: "Security", title: "Data Security",',
    );
    expect(index).toContain(
      'page: PageMap.KUBERNETES_CLUSTER_VIEW_COMPLIANCE, section: "Security", title: "Compliance",',
    );
  });

  test("Search offers a record's pages as its menu does", () => {
    const palette: string = readCode(
      "Components/CommandPalette/DashboardCommandPalette.tsx",
    );

    expect(palette).toContain(
      "return withResourcePagesShown(kind, products.answer);",
    );
    expect(palette).toContain(
      "kind: withResourcePagesShown(openRecord.kind, products.answer),",
    );
  });

  test("a resource's Security Events card opens its own page", () => {
    const model: string = readCode(
      "Components/SecurityConnections/SecurityConnectionsModel.ts",
    );

    expect(model).toContain(
      "[SecurityConnectionKind.Host]: PageMap.HOST_VIEW_SECURITY_EVENTS,",
    );
    expect(model).toContain(
      "[SecurityConnectionKind.KubernetesCluster]: PageMap.KUBERNETES_CLUSTER_VIEW_SECURITY_EVENTS,",
    );
  });

  test("every kind a store belongs to has its words on the pages", () => {
    const pages: string = readCode(
      "Components/ResourceDataSecurity/ResourceDataSecurityPages.ts",
    );

    for (const kind of ALL_DATA_STORE_RESOURCE_KINDS) {
      // Each of the four word tables names every kind.
      expect(
        pages.split(`[DataStoreResourceKind.${kind}]:`).length - 1,
      ).toBeGreaterThanOrEqual(4);
    }
  });
});

/*
 * A Docker or Podman host, an OpenStack cloud and a service have a Security
 * Events page of their own too (#9628), wired as a host's is: a page of the
 * record at :id/security-events, routed beside its Logs, crumbed under it,
 * in its menu right after Logs behind the product's gate, found by Search
 * under the menu's section, gated on Security Events, and opened by the
 * record's Security card. A cloud resource and a serverless function have
 * none: nothing ties their own events to them reliably yet.
 */
describe("Security Events on a Docker or Podman host, an OpenStack cloud and a service", () => {
  interface SecurityEventsWiring {
    kind: SecurityConnectionKind;
    prefix: string;
    root: string;
    pathDictionary: string;
    folder: string;
    routes: string;
    crumbs: string;
    trail: [string, string];
    component: string;
    logsComponent: string;
    section: string;
  }

  const RECORDS: Array<SecurityEventsWiring> = [
    {
      kind: SecurityConnectionKind.DockerHost,
      prefix: "DOCKER_HOST_VIEW",
      root: "docker",
      pathDictionary: "DockerRoutePath",
      folder: "Docker",
      routes: "DockerRoutes.tsx",
      crumbs: "DockerBreadcrumbs.ts",
      trail: ["Docker", "View Host"],
      component: "DockerHostSecurityEvents",
      logsComponent: "DockerHostLogs",
      section: "Observability",
    },
    {
      kind: SecurityConnectionKind.PodmanHost,
      prefix: "PODMAN_HOST_VIEW",
      root: "podman",
      pathDictionary: "PodmanRoutePath",
      folder: "Podman",
      routes: "PodmanRoutes.tsx",
      crumbs: "PodmanBreadcrumbs.ts",
      trail: ["Podman", "View Host"],
      component: "PodmanHostSecurityEvents",
      logsComponent: "PodmanHostLogs",
      section: "Observability",
    },
    {
      kind: SecurityConnectionKind.OpenStackCloud,
      prefix: "OPENSTACK_CLOUD_VIEW",
      root: "openstack",
      pathDictionary: "OpenStackRoutePath",
      folder: "OpenStack",
      routes: "OpenStackRoutes.tsx",
      crumbs: "OpenStackBreadcrumbs.ts",
      trail: ["OpenStack", "View Cloud"],
      component: "OpenStackCloudSecurityEvents",
      logsComponent: "OpenStackCloudLogs",
      section: "Telemetry",
    },
    {
      kind: SecurityConnectionKind.Service,
      prefix: "SERVICE_VIEW",
      root: "service",
      pathDictionary: "ServiceRoutePath",
      folder: "Service",
      routes: "ServiceRoutes.tsx",
      crumbs: "ServiceBreadcrumbs.ts",
      trail: ["Services", "View Service"],
      component: "ServiceViewSecurityEvents",
      logsComponent: "ServiceViewLogs",
      section: "Telemetry",
    },
  ];

  describe.each(RECORDS)("$kind", (record: SecurityEventsWiring) => {
    const page: string = `${record.prefix}_SECURITY_EVENTS`;

    test("its page is a page of the record at :id/security-events", () => {
      expect(readCode("Utils/PageMap.ts")).toContain(`${page} = "${page}",`);
      expect(readCode("Utils/RouteMap.ts")).toContain(
        `[PageMap.${page}]: \`\${RouteParams.ModelID}/security-events\`,`,
      );
      expect(readWhole("Utils/RouteMap.ts")).toContain(
        `[PageMap.${page}]: new Route( \`/dashboard/\${RouteParams.ProjectID}/${record.root}/\${ ${record.pathDictionary}[PageMap.${page}] }\`, ),`,
      );
    });

    test("it is routed beside its Logs, to a page that hands the shared page this kind", () => {
      const routes: string = readCode(`Routes/${record.routes}`);

      expect(routes).toContain(
        `import ${record.component} from "../Pages/${record.folder}/View/SecurityEvents";`,
      );
      // However the formatter breaks the element, its route is this page's.
      expect(routes).toMatch(
        new RegExp(
          `<${record.component} \\{\\.\\.\\.props\\} pageRoute=\\{ ?RouteMap\\[PageMap\\.${page}\\] as Route ?\\} />`,
        ),
      );
      expect(routes.indexOf(`PageMap.${page}`)).toBeGreaterThan(
        routes.indexOf(`<${record.logsComponent}`),
      );
      expect(
        readCode(`Pages/${record.folder}/View/SecurityEvents.tsx`),
      ).toContain(
        `<ResourceSecurityEventsPage {...props} kind={SecurityConnectionKind.${record.kind}} />`,
      );
    });

    test("its breadcrumbs end in Security Events, under the record", () => {
      expect(readCode(`Utils/Breadcrumbs/${record.crumbs}`)).toMatch(
        new RegExp(
          `PageMap\\.${page},?\\s*\\[\\s*"Project",\\s*"${record.trail[0]}",\\s*"${record.trail[1]}",\\s*"Security Events",?\\s*\\]`,
        ),
      );
    });

    test("its menu draws it right after Logs, behind the product's gate", () => {
      const menu: string = readCode(`Pages/${record.folder}/View/SideMenu.tsx`);
      const logs: number = menu.indexOf(
        `RouteMap[PageMap.${record.prefix}_LOGS] as Route`,
      );
      const entry: number = menu.indexOf(`RouteMap[PageMap.${page}] as Route`);

      expect(menu).toContain(
        "const showSecurityEvents: boolean = useResourceSecurityEventsMenu();",
      );
      expect(menu).toContain(
        '{showSecurityEvents ? ( <SideMenuItem link={{ title: "Security Events",',
      );
      expect(logs).toBeGreaterThan(-1);
      expect(entry).toBeGreaterThan(logs);
      // Nothing of the menu sits between Logs and it.
      expect(menu.slice(logs, entry).split("<SideMenuItem").length).toBe(2);
    });

    test("Search finds it under its menu's section, and it needs Security Events", () => {
      expect(
        readCode("Components/CommandPalette/RecordPageSearchIndex.ts"),
      ).toContain(
        `page: PageMap.${page}, section: "${record.section}", title: "Security Events",`,
      );
      expect(readCode("Utils/ProjectProducts/ProductOfRoute.ts")).toContain(
        `[PageMap.${page}]: ProductKey.SecurityEvents,`,
      );
    });

    test("its Security card opens it", () => {
      expect(
        readCode("Components/SecurityConnections/SecurityConnectionsModel.ts"),
      ).toMatch(
        new RegExp(
          `\\[SecurityConnectionKind\\.${record.kind}\\]:\\s*PageMap\\.${page},`,
        ),
      );
    });
  });

  test("a cloud resource and a serverless function have no page of their own", () => {
    const pageMap: string = readCode("Utils/PageMap.ts");
    const model: string = readCode(
      "Components/SecurityConnections/SecurityConnectionsModel.ts",
    );
    const pages: string = model.slice(
      model.indexOf("export const RECORD_SECURITY_EVENTS_PAGES"),
      model.indexOf(
        "};",
        model.indexOf("export const RECORD_SECURITY_EVENTS_PAGES"),
      ),
    );

    expect(pageMap).not.toContain("CLOUD_RESOURCE_VIEW_SECURITY_EVENTS");
    expect(pageMap).not.toContain("SERVERLESS_FUNCTION_VIEW_SECURITY_EVENTS");
    expect(pages).not.toContain("SecurityConnectionKind.CloudResource]");
    expect(pages).not.toContain("SecurityConnectionKind.ServerlessFunction]");
  });
});

/*
 * Every kind of resource a data store belongs to (DataStoreResource) has
 * the two pages, wired the same way: a cluster, the Docker or Podman host a
 * database runs on, a database, a service and a cloud resource. A
 * database's notice links to its cluster's or host's Compliance page, so
 * none of them may be left without one.
 */
describe("Data Security and Compliance on every resource a store belongs to", () => {
  interface DataStoreResourceWiring {
    kind: DataStoreResourceKind;
    prefix: string;
    root: string;
    pathDictionary: string;
    folder: string;
    routes: string;
    crumbs: string;
    trail: [string, string];
    components: [string, string];
  }

  const RESOURCES: Array<DataStoreResourceWiring> = [
    {
      kind: DataStoreResourceKind.KubernetesCluster,
      prefix: "KUBERNETES_CLUSTER_VIEW",
      root: "kubernetes",
      pathDictionary: "KubernetesRoutePath",
      folder: "Kubernetes",
      routes: "KubernetesRoutes.tsx",
      crumbs: "KubernetesBreadcrumbs.ts",
      trail: ["Kubernetes", "View Cluster"],
      components: [
        "KubernetesClusterViewDataSecurity",
        "KubernetesClusterViewCompliance",
      ],
    },
    {
      kind: DataStoreResourceKind.DockerHost,
      prefix: "DOCKER_HOST_VIEW",
      root: "docker",
      pathDictionary: "DockerRoutePath",
      folder: "Docker",
      routes: "DockerRoutes.tsx",
      crumbs: "DockerBreadcrumbs.ts",
      trail: ["Docker", "View Host"],
      components: ["DockerHostDataSecurity", "DockerHostCompliance"],
    },
    {
      kind: DataStoreResourceKind.PodmanHost,
      prefix: "PODMAN_HOST_VIEW",
      root: "podman",
      pathDictionary: "PodmanRoutePath",
      folder: "Podman",
      routes: "PodmanRoutes.tsx",
      crumbs: "PodmanBreadcrumbs.ts",
      trail: ["Podman", "View Host"],
      components: ["PodmanHostDataSecurity", "PodmanHostCompliance"],
    },
    {
      kind: DataStoreResourceKind.DatabaseServer,
      prefix: "DATABASE_SERVER_VIEW",
      root: "databases",
      pathDictionary: "DatabaseRoutePath",
      folder: "Database",
      routes: "DatabaseRoutes.tsx",
      crumbs: "DatabaseBreadcrumbs.ts",
      trail: ["Databases", "View Database"],
      components: ["DatabaseServerDataSecurity", "DatabaseServerCompliance"],
    },
    {
      kind: DataStoreResourceKind.Service,
      prefix: "SERVICE_VIEW",
      root: "service",
      pathDictionary: "ServiceRoutePath",
      folder: "Service",
      routes: "ServiceRoutes.tsx",
      crumbs: "ServiceBreadcrumbs.ts",
      trail: ["Services", "View Service"],
      components: ["ServiceViewDataSecurity", "ServiceViewCompliance"],
    },
    {
      kind: DataStoreResourceKind.CloudResource,
      prefix: "CLOUD_RESOURCE_VIEW",
      root: "cloud",
      pathDictionary: "CloudRoutePath",
      folder: "Cloud",
      routes: "CloudResourceRoutes.tsx",
      crumbs: "CloudBreadcrumbs.ts",
      trail: ["Cloud", "View Resource"],
      components: ["CloudResourceDataSecurity", "CloudResourceCompliance"],
    },
  ];

  // Each page of a resource: its key's end, its path, its file, its title, its shared page.
  const PAGES: Array<[string, string, string, string, string]> = [
    [
      "DATA_SECURITY",
      "data-security",
      "DataSecurity",
      "Data Security",
      "ResourceDataSecurityPage",
    ],
    [
      "COMPLIANCE",
      "compliance",
      "Compliance",
      "Compliance",
      "ResourceCompliancePage",
    ],
  ];

  // A cluster's Compliance also scores the cluster itself (#9627), so it is wired its own way.
  function isClusterCompliance(
    resource: DataStoreResourceWiring,
    end: string,
  ): boolean {
    return (
      resource.kind === DataStoreResourceKind.KubernetesCluster &&
      end === "COMPLIANCE"
    );
  }

  test("every kind a store belongs to is one of these, once", () => {
    expect(
      RESOURCES.map((resource: DataStoreResourceWiring): string => {
        return resource.kind;
      }).sort(),
    ).toEqual([...ALL_DATA_STORE_RESOURCE_KINDS].sort());
  });

  describe.each(RESOURCES)("$kind", (resource: DataStoreResourceWiring) => {
    test("its two pages are pages of the record, at :id/data-security and :id/compliance", () => {
      for (const [end, pagePath] of PAGES) {
        const page: string = `${resource.prefix}_${end}`;

        expect(readCode("Utils/PageMap.ts")).toContain(`${page} = "${page}",`);
        expect(readCode("Utils/RouteMap.ts")).toContain(
          `[PageMap.${page}]: \`\${RouteParams.ModelID}/${pagePath}\`,`,
        );
        expect(readWhole("Utils/RouteMap.ts")).toContain(
          `[PageMap.${page}]: new Route( \`/dashboard/\${RouteParams.ProjectID}/${resource.root}/\${ ${resource.pathDictionary}[PageMap.${page}] }\`, ),`,
        );
      }
    });

    test("each is routed to its page, which hands the shared page this kind", () => {
      const routes: string = readCode(`Routes/${resource.routes}`);

      PAGES.forEach(
        (
          [end, , file, , shared]: [string, string, string, string, string],
          index: number,
        ) => {
          const component: string = resource.components[index]!;

          expect(routes).toContain(
            `import ${component} from "../Pages/${resource.folder}/View/${file}";`,
          );
          expect(routes).toContain(`<${component}`);
          expect(routes).toContain(`PageMap.${resource.prefix}_${end}`);
          expect(
            readCode(`Pages/${resource.folder}/View/${file}.tsx`),
          ).toContain(
            isClusterCompliance(resource, end)
              ? // It scores the cluster itself first (#9627), then its databases' frameworks.
                `<${shared} {...props} kind={DataStoreResourceKind.${resource.kind}} title={DATABASES_TITLE} />`
              : `<${shared} {...props} kind={DataStoreResourceKind.${resource.kind}} />`,
          );
        },
      );
    });

    test("their breadcrumbs end in their names, under the record", () => {
      const crumbs: string = readCode(`Utils/Breadcrumbs/${resource.crumbs}`);

      for (const [end, , , title] of PAGES) {
        expect(crumbs).toMatch(
          new RegExp(
            `PageMap\\.${resource.prefix}_${end},?\\s*\\[\\s*"Project",\\s*"${resource.trail[0]}",\\s*"${resource.trail[1]}",\\s*"${title}",?\\s*\\]`,
          ),
        );
      }
    });

    test("its menu draws a Security section with both, after Activity, behind Data Security's gate", () => {
      const menu: string = readCode(
        `Pages/${resource.folder}/View/SideMenu.tsx`,
      );

      expect(menu).toContain(
        `useResourceDataSecurityMenu({ kind: DataStoreResourceKind.${resource.kind}, modelId: props.modelId, })`,
      );

      if (resource.kind === DataStoreResourceKind.KubernetesCluster) {
        // Its Compliance scores the cluster itself (#9627): drawn once it reports pods.
        expect(menu).toContain(
          '{dataSecurityMenu || counts.pods ? ( <SideMenuSection title="Security"> {dataSecurityMenu ? ( <SideMenuItem link={{ title: "Data Security", to: dataSecurityMenu.dataSecurityRoute, }}',
        );
      } else {
        expect(menu).toContain(
          '{dataSecurityMenu ? ( <SideMenuSection title="Security"> <SideMenuItem link={{ title: "Data Security", to: dataSecurityMenu.dataSecurityRoute, }}',
        );
        expect(menu).toContain(
          'title: "Compliance", to: dataSecurityMenu.complianceRoute,',
        );
      }
      expect(
        menu.indexOf('<SideMenuSection title="Security">'),
      ).toBeGreaterThan(menu.indexOf('<SideMenuSection title="Activity">'));
      expect(menu.indexOf('<SideMenuSection title="Security">')).toBeLessThan(
        menu.indexOf('<SideMenuSection title="Advanced">'),
      );
    });

    test("Search finds both under Security, and offers them only where Data Security is", () => {
      const index: string = readCode(
        "Components/CommandPalette/RecordPageSearchIndex.ts",
      );
      const products: string = readCode(
        "Utils/ProjectProducts/ProductOfRoute.ts",
      );

      for (const [end, , , title] of PAGES) {
        expect(index).toContain(
          `page: PageMap.${resource.prefix}_${end}, section: "Security", title: "${title}",`,
        );

        // A cluster's Compliance is the cluster's own (#9627): offered without Data Security.
        if (isClusterCompliance(resource, end)) {
          expect(products).not.toContain(
            `[PageMap.${resource.prefix}_${end}]: ProductKey.DataSecurity,`,
          );
        } else {
          expect(products).toContain(
            `[PageMap.${resource.prefix}_${end}]: ProductKey.DataSecurity,`,
          );
        }
      }
    });

    test("the kind's pages are the ones its menu and notices open", () => {
      expect(
        readCode(
          "Components/ResourceDataSecurity/ResourceDataSecurityPages.ts",
        ),
      ).toContain(
        `[DataStoreResourceKind.${resource.kind}]: { dataSecurity: PageMap.${resource.prefix}_DATA_SECURITY, compliance: PageMap.${resource.prefix}_COMPLIANCE, },`,
      );
    });
  });
});

describe("the pages' words are keys of every locale", () => {
  const LOCALES: string = path.join(DASHBOARD_SRC, "Locales");
  const KEYS: Array<string> = [
    RESOURCE_SECURITY_EVENTS_SUMMARY_BOTH,
    RESOURCE_SECURITY_EVENTS_SUMMARY_NAMING,
    RESOURCE_SECURITY_EVENTS_SUMMARY_OWN_LOGS,
    RESOURCE_SECURITY_EVENTS_OWN_LOGS_DESCRIPTION,
    RESOURCE_SECURITY_EVENTS_NO_SEARCH_REASON,
    "No security events about this cluster yet",
    "No security events about this host yet",
    "No security events about this cloud yet",
    "No security events about this service yet",
    "No data stores here yet",
    "Nothing to score yet",
    "Turned Off and Not in Scope",
    "Applies Here",
    "Open in Data Security",
    "Data Security",
    "Compliance",
    "Security Events",
    "Kubernetes Cluster",
    "Turned off",
  ];

  test.each(
    fs
      .readdirSync(LOCALES)
      .filter((file: string): boolean => {
        return file.endsWith(".json");
      })
      .sort(),
  )("%s", (file: string) => {
    const locale: Record<string, unknown> = JSON.parse(
      fs.readFileSync(path.join(LOCALES, file), "utf8"),
    ) as Record<string, unknown>;

    for (const key of KEYS) {
      expect({
        key,
        has: Object.prototype.hasOwnProperty.call(locale, key),
      }).toEqual({ key, has: true });
    }
  });
});
