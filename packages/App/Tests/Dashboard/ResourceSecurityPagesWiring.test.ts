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
  RESOURCE_SECURITY_EVENTS_OWN_LOGS_LABEL,
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
 * A host's and a cluster's Security Events pages, a cluster's Data
 * Security and Compliance pages: pinned here without rendering - the
 * words their chip and switches work out, and their wiring into routes,
 * layouts, breadcrumbs, menus and Search (App's node environment cannot
 * render the pages; Common/Tests/App/Dashboard renders them).
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
    const ownLogs: ActiveFilter = getResourceSecurityEventsChip(
      scopeOf({
        kind: SecurityConnectionKind.Service,
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
    expect(readCode("Pages/Kubernetes/View/Compliance.tsx")).toContain(
      "<ResourceCompliancePage {...props} kind={DataStoreResourceKind.KubernetesCluster} />",
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
      '{dataSecurityMenu ? ( <SideMenuSection title="Security"> <SideMenuItem link={{ title: "Data Security", to: dataSecurityMenu.dataSecurityRoute, }}',
    );
    expect(kubernetes).toContain(
      'title: "Compliance", to: dataSecurityMenu.complianceRoute,',
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
