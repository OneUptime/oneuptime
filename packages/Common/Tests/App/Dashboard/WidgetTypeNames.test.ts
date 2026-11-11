import { describe, expect, test } from "@jest/globals";
import {
  WIDGET_CATALOG,
  WIDGET_CATEGORY_GROUP_LABELS,
  WIDGET_CATEGORY_GROUP_ORDER,
  WidgetCatalogCategory,
  WidgetCatalogItem,
  getWidgetTypeBadgeText,
  getWidgetTypeName,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Toolbar/WidgetCatalog";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import { createTranslator, Translator } from "../../../Types/Translator";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * A widget's name, as people know it (issue #6720). A widget's settings
 * badge, and the badge on it while the board is edited, printed its stored
 * type - "ProductAnalyticsFunnel", "LogStream", "DataSourceChart" - in
 * English in every language. They now print its name from the widget
 * catalog: its label where that says it alone, its own name where the
 * label is another widget's too or says too little away from its category
 * ("Docker Hosts", "Data Source Chart"), as the product names those
 * resources elsewhere. Every type has one, no two share one, none is an
 * identifier, and every one is worded in every Dashboard language.
 */

const ALL_TYPES: Array<DashboardComponentType> = Object.values(
  DashboardComponentType,
);

/*
 * Every type's name, written out: a type added to the enum fails to
 * compile here until it is named, and a name changed by mistake fails.
 */
const EXPECTED_NAMES: Record<DashboardComponentType, string> = {
  [DashboardComponentType.Chart]: "Chart",
  [DashboardComponentType.Value]: "Value",
  [DashboardComponentType.Text]: "Text",
  [DashboardComponentType.Clock]: "Clock",
  [DashboardComponentType.Table]: "Table",
  [DashboardComponentType.Gauge]: "Gauge",
  [DashboardComponentType.DataSourceChart]: "Data Source Chart",
  [DashboardComponentType.DataSourceValue]: "Data Source Value",
  [DashboardComponentType.DataSourceGauge]: "Data Source Gauge",
  [DashboardComponentType.DataSourceTable]: "Data Source Table",
  [DashboardComponentType.LogStream]: "Log Stream",
  [DashboardComponentType.LogChart]: "Log Chart",
  [DashboardComponentType.SecurityEventsList]: "Security Events",
  [DashboardComponentType.SecurityEventsFlow]: "Security Events Flow",
  [DashboardComponentType.ProductAnalyticsFunnel]: "Funnel",
  [DashboardComponentType.ProductAnalyticsRetention]: "User Retention",
  [DashboardComponentType.TraceList]: "Trace List",
  [DashboardComponentType.TraceChart]: "Trace Chart",
  [DashboardComponentType.TraceTable]: "Trace Table",
  [DashboardComponentType.IncidentList]: "Incident List",
  [DashboardComponentType.AlertList]: "Alert List",
  [DashboardComponentType.MonitorList]: "Monitor List",
  [DashboardComponentType.Slo]: "SLO",
  [DashboardComponentType.SloList]: "SLO List",
  [DashboardComponentType.KubernetesPodList]: "Kubernetes Pods",
  [DashboardComponentType.KubernetesNodeList]: "Kubernetes Nodes",
  [DashboardComponentType.KubernetesNamespaceList]: "Kubernetes Namespaces",
  [DashboardComponentType.KubernetesDeploymentList]: "Kubernetes Deployments",
  [DashboardComponentType.KubernetesStatefulSetList]: "Kubernetes StatefulSets",
  [DashboardComponentType.KubernetesDaemonSetList]: "Kubernetes DaemonSets",
  [DashboardComponentType.KubernetesJobList]: "Kubernetes Jobs",
  [DashboardComponentType.KubernetesCronJobList]: "Kubernetes CronJobs",
  [DashboardComponentType.DockerHostList]: "Docker Hosts",
  [DashboardComponentType.DockerContainerList]: "Docker Containers",
  [DashboardComponentType.DockerImageList]: "Docker Images",
  [DashboardComponentType.DockerNetworkList]: "Docker Networks",
  [DashboardComponentType.DockerVolumeList]: "Docker Volumes",
  [DashboardComponentType.PodmanHostList]: "Podman Hosts",
  [DashboardComponentType.PodmanContainerList]: "Podman Containers",
  [DashboardComponentType.PodmanImageList]: "Podman Images",
  [DashboardComponentType.PodmanNetworkList]: "Podman Networks",
  [DashboardComponentType.PodmanVolumeList]: "Podman Volumes",
  [DashboardComponentType.HostList]: "Hosts",
  [DashboardComponentType.ProxmoxNodeList]: "Proxmox Nodes",
  [DashboardComponentType.ProxmoxGuestList]: "Proxmox Guests",
  [DashboardComponentType.VMwareHostList]: "ESXi Hosts",
  [DashboardComponentType.VMwareVirtualMachineList]: "VMware Virtual Machines",
  [DashboardComponentType.DockerSwarmNodeList]: "Swarm Nodes",
  [DashboardComponentType.DockerSwarmServiceList]: "Swarm Services",
  [DashboardComponentType.CephOsdList]: "Ceph OSDs",
  [DashboardComponentType.CephPoolList]: "Ceph Pools",
  [DashboardComponentType.StorageArrayVolumeList]: "Storage Array Volumes",
  [DashboardComponentType.StorageArrayHardwareList]: "Storage Array Hardware",
  [DashboardComponentType.NetworkMap]: "Network Map",
  [DashboardComponentType.Html]: "HTML",
};

/*
 * The types whose stored identifier is a plain word people read as it is:
 * their name may be that word. Every other type's name is no identifier.
 */
const PLAIN_WORD_TYPES: ReadonlyArray<DashboardComponentType> = [
  DashboardComponentType.Chart,
  DashboardComponentType.Value,
  DashboardComponentType.Text,
  DashboardComponentType.Clock,
  DashboardComponentType.Table,
  DashboardComponentType.Gauge,
];

const CATALOG_ITEMS: Array<WidgetCatalogItem> = WIDGET_CATALOG.flatMap(
  (category: WidgetCatalogCategory): Array<WidgetCatalogItem> => {
    return [...category.items];
  },
);

function catalogItem(type: DashboardComponentType): WidgetCatalogItem {
  const item: WidgetCatalogItem | undefined = CATALOG_ITEMS.find(
    (candidate: WidgetCatalogItem): boolean => {
      return candidate.type === type;
    },
  );

  if (!item) {
    throw new Error(`${type} is not in the widget catalog.`);
  }

  return item;
}

function nameOf(type: DashboardComponentType): string {
  const name: string | null = getWidgetTypeName(type);

  if (name === null) {
    throw new Error(`${type} has no name.`);
  }

  return name;
}

/*
 * The names that two or more types share, lower-cased - none, unless a
 * catalog entry is changed to read like another's.
 */
function sharedNames(names: ReadonlyArray<string>): Array<string> {
  const seen: Set<string> = new Set<string>();
  const shared: Set<string> = new Set<string>();

  for (const name of names) {
    const key: string = name.trim().toLowerCase();

    if (seen.has(key)) {
      shared.add(key);
    }

    seen.add(key);
  }

  return [...shared].sort();
}

describe("a widget type's name", () => {
  test("every type has one, as written out", () => {
    const names: Record<string, string | null> = {};

    for (const type of ALL_TYPES) {
      names[type] = getWidgetTypeName(type);
    }

    expect(names).toEqual(EXPECTED_NAMES);
  });

  test("no two types share one", () => {
    expect(sharedNames(ALL_TYPES.map(nameOf))).toEqual([]);
  });

  test("the uniqueness check sees two widgets that read alike", () => {
    // The External Data Sources chart left with its catalog label alone.
    expect(
      sharedNames([
        ...ALL_TYPES.filter((type: DashboardComponentType): boolean => {
          return type !== DashboardComponentType.DataSourceChart;
        }).map(nameOf),
        catalogItem(DashboardComponentType.DataSourceChart).label,
      ]),
    ).toEqual(["chart"]);
  });

  test("none is a stored identifier, but for the types whose identifier is a plain word", () => {
    const identifiers: Set<string> = new Set<string>(ALL_TYPES);

    for (const type of ALL_TYPES) {
      const name: string = nameOf(type);

      if (PLAIN_WORD_TYPES.includes(type)) {
        expect(name).toBe(type);
        continue;
      }

      expect(name).not.toBe(type);
      expect(identifiers.has(name)).toBe(false);
      // Words, as the product writes them: never an identifier's run.
      expect(name).not.toMatch(/^[A-Z][a-z]+(?:[A-Z][a-z]+)+$/);
      expect(name).toBe(name.trim());
      expect(name.length).toBeGreaterThan(0);
    }
  });

  test("is the catalog's own: its label, or the name it gives where the label is not enough", () => {
    for (const type of ALL_TYPES) {
      const item: WidgetCatalogItem = catalogItem(type);

      expect(nameOf(type)).toBe(item.name || item.label);

      // A name of its own only where it says more than the label.
      if (item.name !== undefined) {
        expect(item.name).not.toBe(item.label);
        expect(item.name.trim()).toBe(item.name);
      }
    }
  });

  test("a label two widgets share in the picker names neither alone but one", () => {
    const byLabel: Map<string, Array<DashboardComponentType>> = new Map<
      string,
      Array<DashboardComponentType>
    >();

    for (const item of CATALOG_ITEMS) {
      byLabel.set(item.label, [...(byLabel.get(item.label) || []), item.type]);
    }

    for (const [label, types] of byLabel) {
      if (types.length < 2) {
        continue;
      }

      const namedByTheLabel: Array<DashboardComponentType> = types.filter(
        (type: DashboardComponentType): boolean => {
          return nameOf(type) === label;
        },
      );

      expect(namedByTheLabel.length).toBeLessThanOrEqual(1);
    }
  });

  test.each([
    [DashboardComponentType.ProductAnalyticsFunnel, "Funnel"],
    [DashboardComponentType.ProductAnalyticsRetention, "User Retention"],
    [DashboardComponentType.LogStream, "Log Stream"],
    [DashboardComponentType.TraceTable, "Trace Table"],
    [DashboardComponentType.DockerHostList, "Docker Hosts"],
    [DashboardComponentType.PodmanHostList, "Podman Hosts"],
    [DashboardComponentType.VMwareHostList, "ESXi Hosts"],
    [DashboardComponentType.HostList, "Hosts"],
    [DashboardComponentType.DataSourceChart, "Data Source Chart"],
    [DashboardComponentType.Chart, "Chart"],
    [DashboardComponentType.KubernetesNodeList, "Kubernetes Nodes"],
    [DashboardComponentType.DockerSwarmNodeList, "Swarm Nodes"],
    [DashboardComponentType.ProxmoxNodeList, "Proxmox Nodes"],
    [DashboardComponentType.StorageArrayVolumeList, "Storage Array Volumes"],
    [DashboardComponentType.Html, "HTML"],
    [DashboardComponentType.Slo, "SLO"],
  ])("%s is called %s", (type: DashboardComponentType, name: string) => {
    expect(getWidgetTypeName(type)).toBe(name);
  });

  test.each([
    ["a removed widget", "HostMetricChart"],
    ["a misspelt one", "chart"],
    ["one with spaces around it", " Chart "],
    ["none", ""],
    ["an object's own key", "constructor"],
    ["another", "__proto__"],
    ["and another", "toString"],
  ])("%s (%j) has none", (_what: string, stored: string) => {
    expect(getWidgetTypeName(stored)).toBeNull();
  });

  test.each([
    ["undefined", undefined],
    ["null", null],
    ["a number", 42],
    ["an object", { type: "Chart" }],
    ["a list", ["Chart"]],
  ])("a type that is %s has none", (_what: string, stored: unknown) => {
    expect(getWidgetTypeName(stored)).toBeNull();
  });
});

describe("the badge's text", () => {
  const LOOKED_UP: Translator = createTranslator(
    (text: string): string | undefined => {
      return `«${text}»`;
    },
    "de",
  );

  test("a known type: its name, looked up in the reader's language", () => {
    expect(
      getWidgetTypeBadgeText(
        DashboardComponentType.ProductAnalyticsFunnel,
        LOOKED_UP,
      ),
    ).toBe("«Funnel»");
    expect(
      getWidgetTypeBadgeText(DashboardComponentType.DockerHostList, LOOKED_UP),
    ).toBe("«Docker Hosts»");
  });

  test("in English, where nothing is looked up: the name as the catalog writes it", () => {
    const english: Translator = createTranslator(undefined, "en");

    for (const type of ALL_TYPES) {
      expect(getWidgetTypeBadgeText(type, english)).toBe(EXPECTED_NAMES[type]);
    }
  });

  test("a type OneUptime has no widget of: as stored, trimmed, and never looked up", () => {
    expect(getWidgetTypeBadgeText("HostMetricChart", LOOKED_UP)).toBe(
      "HostMetricChart",
    );
    expect(getWidgetTypeBadgeText("  HostMetricChart  ", LOOKED_UP)).toBe(
      "HostMetricChart",
    );
  });

  test.each([
    ["no type", undefined],
    ["an empty one", ""],
    ["one of spaces", "   "],
    ["one that is no text", 7],
  ])("%s: no text, so no badge", (_what: string, stored: unknown) => {
    expect(getWidgetTypeBadgeText(stored, LOOKED_UP)).toBe("");
  });

  test.each([
    ["de", DashboardComponentType.DockerHostList],
    ["fa", DashboardComponentType.ProductAnalyticsRetention],
    ["ja", DashboardComponentType.KubernetesJobList],
    ["ar", DashboardComponentType.DataSourceChart],
  ])(
    "in %s, %s reads as that language's Dashboard words it",
    (language: string, type: DashboardComponentType) => {
      const translator: Translator = dashboardTranslator(language);
      const words: Record<string, string> = readDashboardLocale(language);

      expect(getWidgetTypeBadgeText(type, translator)).toBe(
        words[EXPECTED_NAMES[type]],
      );
      expect(getWidgetTypeBadgeText(type, translator)).not.toBe(
        EXPECTED_NAMES[type],
      );
    },
  );
});

describe("every name in every Dashboard language", () => {
  const ENGLISH: Record<string, string> = readDashboardLocale("en");

  /*
   * What the badge and the widget picker look up: every type's name, and
   * the picker's category names and group headings, which it looks up too.
   */
  const KEYS: Array<string> = [
    ...ALL_TYPES.map(nameOf),
    ...WIDGET_CATALOG.map((category: WidgetCatalogCategory): string => {
      return category.name;
    }),
    ...WIDGET_CATEGORY_GROUP_ORDER.map((group: string): string => {
      return WIDGET_CATEGORY_GROUP_LABELS[
        group as keyof typeof WIDGET_CATEGORY_GROUP_LABELS
      ];
    }),
  ];

  test("each is a key of en.json, so the extractor saw it", () => {
    const missing: Array<string> = KEYS.filter((key: string): boolean => {
      return ENGLISH[key] !== key;
    });

    expect(missing).toEqual([]);
  });

  test("every group has its heading, as a key", () => {
    expect(Object.keys(WIDGET_CATEGORY_GROUP_LABELS).sort()).toEqual(
      [...WIDGET_CATEGORY_GROUP_ORDER].sort(),
    );

    for (const group of WIDGET_CATEGORY_GROUP_ORDER) {
      expect(WIDGET_CATEGORY_GROUP_LABELS[group]).toBe(group);
    }
  });

  test.each([...DASHBOARD_LANGUAGES])(
    "%s words each one, or keeps the English on purpose",
    (language: string) => {
      const notWorded: Array<string> = KEYS.filter((key: string): boolean => {
        return !isWordedInDashboardLocale(key, language);
      });

      expect(notWorded).toEqual([]);
    },
  );
});
