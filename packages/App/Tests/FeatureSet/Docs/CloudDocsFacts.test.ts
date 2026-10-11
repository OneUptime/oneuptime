import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import { CLOUD_ENVIRONMENT_DISCONNECTED_MINUTES } from "Common/Server/Services/CloudResourceService";
import CloudResourceInstanceService from "Common/Server/Services/CloudResourceInstanceService";
import {
  ONEUPTIME_LABEL_ATTRIBUTE_PREFIX,
  extractOneuptimeLabelNames,
} from "Common/Server/Utils/Telemetry/OneuptimeLabel";
import {
  CLOUD_PLATFORM_ALIASES,
  FaasCloudPlatform,
  ManagedCloudPlatform,
} from "Common/Types/Cloud/CloudPlatform";
import TelemetryIngestionKeyType from "Common/Types/Telemetry/TelemetryIngestionKeyType";
import {
  CLOUD_AWS_ECS,
  CLOUD_AZURE_CONTAINER_APPS,
  CLOUD_ENVIRONMENTS,
  CLOUD_GCP_CLOUD_RUN,
  CLOUD_OTHER_PLATFORMS,
  CLOUD_PAGE_NAMES,
  CLOUD_RESOURCES,
  CLOUD_TROUBLESHOOTING,
  CONSOLE_PATHS,
  SHAPE_TABS,
} from "./CloudDocsPages";
import {
  DocsFence,
  DocsHeading,
  readPage,
  scanMarkdown,
} from "./DocsContentSupport";
import { PATH_SEPARATOR, boldLabels, boldPaths, tabLabels } from "./DocsPageShape";
import { prose } from "./DocsTranslationChecks";
import { afterEach, describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What the English cloud pages say about the product, held to the code that
 * makes it true (docs task 23).
 *
 * CloudEnvironmentDocs and CloudResourcesDocs already hold the platform
 * registry, the instance identity chain, the resource catalog and the
 * discovery defaults to these pages, and Common's CloudSetupGuide and
 * CloudMonitoringSetupGuide tests hold the in-app guides' commands to them.
 * This suite holds the rest: every menu path is a path through the
 * product's own menus; the create form, the overview, the instances and the
 * status pills are named as the Dashboard names them; the clocks the pages
 * quote are the sweeps' own; the token check answers as the pages say; the
 * labels a resource attribute adds are the ones ingest makes; and every
 * code sample is valid and agrees with the others on its page (the ECS task
 * definition carries the very collector configuration the page shows).
 * The translations are held to these English pages by
 * CloudDocsTranslations.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");

const HUB: string = CLOUD_ENVIRONMENTS;
const ECS: string = CLOUD_AWS_ECS;
const CLOUD_RUN: string = CLOUD_GCP_CLOUD_RUN;
const CONTAINER_APPS: string = CLOUD_AZURE_CONTAINER_APPS;
const OTHER: string = CLOUD_OTHER_PLATFORMS;
const TROUBLESHOOTING: string = CLOUD_TROUBLESHOOTING;
const RESOURCES: string = CLOUD_RESOURCES;

const PAGES: ReadonlyArray<string> = CLOUD_PAGE_NAMES;

// The pages that walk one platform's setup, a step or tab per shape.
const PLATFORM_PAGES: ReadonlyArray<string> = [ECS, CLOUD_RUN, CONTAINER_APPS];

const DASHBOARD: string = "App/FeatureSet/Dashboard/src";
const CLOUD_SIDE_MENU: string = `${DASHBOARD}/Pages/Cloud/SideMenu.tsx`;
const CLOUD_VIEW_SIDE_MENU: string = `${DASHBOARD}/Pages/Cloud/View/SideMenu.tsx`;
const SETTINGS_SIDE_MENU: string = `${DASHBOARD}/Pages/Settings/SideMenu.tsx`;
const ENVIRONMENTS_PAGE: string = `${DASHBOARD}/Pages/Cloud/CloudResources.tsx`;
const RESOURCES_PAGE: string = `${DASHBOARD}/Pages/Cloud/MonitoredResources.tsx`;
const ENVIRONMENT_OVERVIEW: string = `${DASHBOARD}/Pages/Cloud/View/Overview.tsx`;
const RESOURCE_OVERVIEW: string = `${DASHBOARD}/Pages/Cloud/View/MonitoredResourceOverview.tsx`;
const INSTANCES_PAGE: string = `${DASHBOARD}/Pages/Cloud/View/Instances.tsx`;
const TELEMETRY_SCOPE: string = `${DASHBOARD}/Pages/Cloud/Utils/CloudResourceTelemetryScope.ts`;
const DISPLAY_NAME_FIELD: string = `${DASHBOARD}/Utils/Form/DiscoveredResourceFormFields.ts`;
const METRIC_EXPLORER: string = `${DASHBOARD}/Components/Metrics/MetricExplorer.tsx`;
const CLOUD_SETUP_GUIDE: string = `${DASHBOARD}/Components/Cloud/CloudSetupGuide.ts`;
const CLOUD_MONITORING_GUIDE: string = `${DASHBOARD}/Components/Cloud/CloudMonitoringSetupGuide.ts`;
const FOLDED_SECTION_TITLES: string =
  "Common/UI/Components/FoldedSection/FoldedSectionTitles.ts";
const EN_LOCALE: string = `${DASHBOARD}/Locales/en.json`;
const OTLP_INGEST_API: string = "App/FeatureSet/Telemetry/API/OTelIngest.ts";
const INGEST_BASE: string =
  "App/FeatureSet/Telemetry/Services/OtelIngestBaseService.ts";
const CLOUD_RESOURCE_SERVICE: string =
  "Common/Server/Services/CloudResourceService.ts";
const SERVERLESS_INSTANCE_SERVICE: string =
  "Common/Server/Services/ServerlessFunctionInstanceService.ts";
const INVENTORY_REGISTRY: string =
  "Common/Server/Utils/Telemetry/InventoryEntityRegistry.ts";

/*
 * The products a Dashboard path on these pages starts at, with the menu
 * that path goes through and the navbar key the product's title comes from.
 */
const PRODUCT_MENUS: Record<string, { menu: string; titleKey: string }> = {
  Cloud: { menu: CLOUD_SIDE_MENU, titleKey: "cloudTitle" },
  "Project Settings": {
    menu: SETTINGS_SIDE_MENU,
    titleKey: "projectSettingsTitle",
  },
};

const SECTION_OPEN: RegExp =
  /\{\s*title:\s*"([^"]+)",(?:\s*defaultCollapsed:\s*\w+,)?\s*items:/g;
const MENU_ITEM: RegExp = /link:\s*\{\s*title:\s*"([^"]+)"/g;
const VIEW_MENU_ITEM: RegExp = /title:\s*(?:isResource \? "([^"]+)" : )?"([^"]+)"/g;
const FENCE_INFO_TITLE: RegExp = /title="([^"]+)"/;

interface MenuSection {
  title: string;
  items: Array<string>;
}

interface JsYamlModule {
  load: (text: string) => unknown;
}

/*
 * js-yaml from Common/node_modules, as StorageArrayDocs and QueuesDocs load
 * it: Common declares js-yaml 4, App declares no YAML parser.
 */
/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
const jsYaml: JsYamlModule = require(
  path.join(PACKAGES_DIR, "Common", "node_modules", "js-yaml"),
);
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

type YamlMap = Record<string, unknown>;

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(PACKAGES_DIR, relativePath), "utf8");
}

function englishPage(page: string): string {
  return readPage("en", page);
}

// The text of an English page without its code samples.
function pageProse(page: string): string {
  return prose(englishPage(page));
}

// A side menu's sections, each with the titles of its items, in order.
function menuSections(relativePath: string): Array<MenuSection> {
  const source: string = readSource(relativePath);
  const starts: Array<{ title: string; at: number }> = Array.from(
    source.matchAll(SECTION_OPEN),
  ).map((match: RegExpMatchArray): { title: string; at: number } => {
    return { title: match[1] as string, at: match.index as number };
  });

  return starts.map(
    (start: { title: string; at: number }, index: number): MenuSection => {
      const end: number =
        index + 1 < starts.length
          ? (starts[index + 1] as { at: number }).at
          : source.length;

      return {
        title: start.title,
        items: Array.from(
          source.slice(start.at, end).matchAll(MENU_ITEM),
        ).map((match: RegExpMatchArray): string => {
          return match[1] as string;
        }),
      };
    },
  );
}

/*
 * Whether a path after the product's name goes through its menu: an item of
 * the section named after the product ("Cloud → All Environments"), or a
 * section and one of its items ("Cloud → Settings → Label Rules").
 */
function isMenuPath(product: string, rest: Array<string>): boolean {
  const sections: Array<MenuSection> = menuSections(
    (PRODUCT_MENUS[product] as { menu: string }).menu,
  );

  if (rest.length === 1) {
    return sections.some((section: MenuSection): boolean => {
      return section.title === product && section.items.includes(rest[0]!);
    });
  }

  if (rest.length === 2) {
    return sections.some((section: MenuSection): boolean => {
      return section.title === rest[0] && section.items.includes(rest[1]!);
    });
  }

  return false;
}

function englishLocale(): Record<string, unknown> {
  return JSON.parse(readSource(EN_LOCALE)) as Record<string, unknown>;
}

function navbarTitle(key: string): string {
  const navbar: Record<string, unknown> = englishLocale()[
    "navbar"
  ] as Record<string, unknown>;

  return (navbar["items"] as Record<string, string>)[key] as string;
}

function fencesOf(page: string): Array<DocsFence> {
  return scanMarkdown(englishPage(page)).fences;
}

// The code of the page's only fence with this title.
function titledFence(page: string, title: string): string {
  const found: Array<DocsFence> = fencesOf(page).filter(
    (fence: DocsFence): boolean => {
      return FENCE_INFO_TITLE.exec(fence.info)?.[1] === title;
    },
  );

  expect({ page, title, fences: found.length }).toEqual({
    page,
    title,
    fences: 1,
  });

  return (found[0] as DocsFence).code;
}

function yamlOf(code: string): YamlMap {
  const value: unknown = jsYaml.load(code);

  expect(typeof value === "object" && value !== null).toBe(true);

  return value as YamlMap;
}

function mapAt(value: unknown, ...keys: Array<string>): YamlMap {
  let current: unknown = value;

  for (const key of keys) {
    expect({ key, isMap: typeof current === "object" && current !== null }).toEqual({
      key,
      isMap: true,
    });
    current = (current as YamlMap)[key];
  }

  return current as YamlMap;
}

// The `KEY=value` lines of a bash block, as a map.
function shellVariables(code: string): Record<string, string> {
  const variables: Record<string, string> = {};

  for (const line of code.split("\n")) {
    const trimmed: string = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const equals: number = trimmed.indexOf("=");

    if (equals > 0) {
      variables[trimmed.slice(0, equals)] = trimmed.slice(equals + 1);
    }
  }

  return variables;
}

// Every collector configuration on a page: YAML blocks with exporters.
function collectorConfigs(page: string): Array<YamlMap> {
  const configs: Array<YamlMap> = [];

  for (const fence of fencesOf(page)) {
    if (fence.lang !== "yaml") {
      continue;
    }

    const parsed: YamlMap = yamlOf(fence.code);

    if (parsed["exporters"]) {
      configs.push(parsed);
    }

    // A Cloud Run service or a Container Apps app carries one in a variable.
    for (const container of collectorContainers(parsed)) {
      configs.push(embeddedCollectorConfig(container));
    }
  }

  return configs;
}

function collectorContainers(document: YamlMap): Array<YamlMap> {
  const containers: Array<YamlMap> = [];
  const candidates: Array<unknown> = [
    (
      ((document["spec"] as YamlMap | undefined)?.["template"] as
        | YamlMap
        | undefined)?.["spec"] as YamlMap | undefined
    )?.["containers"],
    (
      (document["properties"] as YamlMap | undefined)?.["template"] as
        | YamlMap
        | undefined
    )?.["containers"],
  ];

  for (const list of candidates) {
    if (Array.isArray(list)) {
      for (const container of list as Array<YamlMap>) {
        if (container["name"] === "otel-collector") {
          containers.push(container);
        }
      }
    }
  }

  return containers;
}

function containerEnvironment(container: YamlMap): Record<string, YamlMap> {
  const environment: Record<string, YamlMap> = {};

  for (const entry of (container["env"] as Array<YamlMap>) || []) {
    environment[entry["name"] as string] = entry;
  }

  return environment;
}

function embeddedCollectorConfig(container: YamlMap): YamlMap {
  const variable: YamlMap | undefined =
    containerEnvironment(container)["OTEL_COLLECTOR_CONFIG"];

  expect(variable).toBeDefined();

  return yamlOf((variable as YamlMap)["value"] as string);
}

describe("the menu paths", () => {
  it("lists the console paths only of pages in this group, each on its page", () => {
    for (const page of Object.keys(CONSOLE_PATHS)) {
      expect(PAGES).toContain(page);

      const written: Array<string> = boldPaths(englishPage(page)).map(
        (segments: Array<string>): string => {
          return segments.join(PATH_SEPARATOR);
        },
      );

      for (const consolePath of CONSOLE_PATHS[page] as Array<string>) {
        expect({ page, consolePath, found: written.includes(consolePath) }).toEqual({
          page,
          consolePath,
          found: true,
        });
      }
    }
  });

  it.each(PAGES)(
    "%s: every other path goes through OneUptime's own menus",
    (page: string) => {
      const consolePaths: Array<string> = CONSOLE_PATHS[page] || [];

      for (const segments of boldPaths(englishPage(page))) {
        const written: string = segments.join(PATH_SEPARATOR);

        if (consolePaths.includes(written)) {
          continue;
        }

        const product: string = segments[0] as string;

        expect({ written, product: Boolean(PRODUCT_MENUS[product]) }).toEqual({
          written,
          product: true,
        });
        expect(navbarTitle(PRODUCT_MENUS[product]!.titleKey)).toBe(product);
        expect({
          written,
          menuPath: isMenuPath(product, segments.slice(1)),
        }).toEqual({ written, menuPath: true });
      }
    },
  );

  it("reads the menus the way they are built (harness guard)", () => {
    expect(menuSections(CLOUD_SIDE_MENU)).toEqual([
      { title: "Cloud", items: ["All Environments", "All Resources"] },
      { title: "Settings", items: ["Owner Rules", "Label Rules"] },
      { title: "Advanced", items: ["Archived"] },
    ]);
    expect(isMenuPath("Cloud", ["All Environments"])).toBe(true);
    expect(isMenuPath("Cloud", ["Settings", "Label Rules"])).toBe(true);
    expect(isMenuPath("Cloud", ["Label Rules"])).toBe(false);
    expect(isMenuPath("Project Settings", ["Telemetry & APM", "Ingestion Keys"])).toBe(true);
    expect(isMenuPath("Project Settings", ["Ingestion Keys"])).toBe(false);
  });

  it("names the environment's and the resource's own tabs as their side menu does", () => {
    const items: Array<string> = Array.from(
      readSource(CLOUD_VIEW_SIDE_MENU).matchAll(VIEW_MENU_ITEM),
    ).flatMap((match: RegExpMatchArray): Array<string> => {
      return [match[1], match[2]].filter(
        (title: string | undefined): title is string => {
          return Boolean(title);
        },
      );
    });

    for (const tab of [
      "Overview",
      "Documentation",
      "Metrics",
      "Logs",
      "Traces",
      "Instances",
      "Settings",
      "Owners",
    ]) {
      expect(items).toContain(tab);
    }

    expect(pageProse(HUB)).toContain("environment's **Documentation** tab");
    expect(pageProse(HUB)).toContain("The **Instances** tab has one row each");
    expect(pageProse(RESOURCES)).toContain("its **Metrics** tab");
    expect(pageProse(RESOURCES)).toContain("on its **Settings** tab");
    expect(pageProse(RESOURCES)).toContain("resource's **Documentation** tab");
  });
});

describe("the environments list and its create form", () => {
  it("names the create button as the Cloud Environments table draws it", () => {
    const source: string = readSource(ENVIRONMENTS_PAGE);
    const button: string = `Create ${new CloudResource().singularName}`;

    // The table names no noun of its own, so the button takes the model's.
    expect(source).toContain("isCreateable={true}");
    expect(source).not.toContain("singularName=");
    expect(button).toBe("Create Cloud Resource");

    for (const page of [HUB, TROUBLESHOOTING]) {
      expect(boldLabels(englishPage(page))).toContain(button);
    }
  });

  it("names the form's fields, and the fold the display name is in", () => {
    const source: string = readSource(ENVIRONMENTS_PAGE);

    for (const field of ["Cloud Platform", "Cloud Account ID", "Cloud Region"]) {
      expect(source).toContain(`title: "${field}",`);
      expect(boldLabels(englishPage(HUB))).toContain(field);
      expect(boldLabels(englishPage(TROUBLESHOOTING))).toContain(field);
    }

    expect(readSource(DISPLAY_NAME_FIELD)).toContain('title: "Display Name",');
    expect(readSource(FOLDED_SECTION_TITLES)).toContain(
      'MORE_FIELDS_SECTION_TITLE: string = translationKey("More fields")',
    );
    expect(source).toContain("collapsibleSection: advancedSection");
    expect(pageProse(HUB)).toContain(
      "open **More fields** and type a **Display Name**",
    );
  });

  it("names the status pill as the list draws it", () => {
    expect(readSource(ENVIRONMENTS_PAGE)).toContain(
      'text={isConnected ? "Connected" : "Disconnected"}',
    );
    expect(pageProse(HUB)).toContain(
      "shows **Disconnected**, and the next span, log or metric brings it back to **Connected**",
    );
  });

  it("says the guide is in the dashboard until the first environment or resource arrives", () => {
    expect(readSource(ENVIRONMENTS_PAGE)).toContain(
      "{count === 0 && (\n        <CloudDocumentationCard",
    );
    expect(readSource(RESOURCES_PAGE)).toContain(
      "{count === 0 && (\n        <CloudMonitoringDocumentationCard",
    );
    expect(pageProse(HUB)).toContain(
      "under **Cloud → All Environments** until your first environment arrives",
    );
    expect(pageProse(RESOURCES)).toContain(
      "under **Cloud → All Resources** until the first resource arrives",
    );
  });
});

describe("an environment's overview and instances", () => {
  it("names the overview's tiles, list and details as the overview draws them", () => {
    const source: string = readSource(ENVIRONMENT_OVERVIEW);

    for (const tile of [
      "CPU",
      "Memory",
      "Instances",
      "Requests",
      "Error rate",
      "p95 latency",
    ]) {
      expect(source).toContain(`title: "${tile}",`);
    }

    expect(source).toContain(
      'const TOP_INSTANCES_TITLE: string = "Top instances by CPU";',
    );
    expect(source).toContain('{ label: "Environment Key", value: r.resourceIdentifier');

    const hub: Array<string> = boldLabels(englishPage(HUB));

    for (const label of [
      "Requests",
      "Error rate",
      "p95 latency",
      "CPU",
      "Memory",
      "Top instances by CPU",
      "Instances",
    ]) {
      expect(hub).toContain(label);
    }

    expect(boldLabels(englishPage(TROUBLESHOOTING))).toContain("Environment Key");
  });

  it("quotes the window an instance counts as live in, and the Stale pill", () => {
    const window: RegExpMatchArray | null = readSource(TELEMETRY_SCOPE).match(
      /CLOUD_INSTANCE_LIVE_WINDOW_MINUTES: number = (\d+);/,
    );

    expect(window).not.toBeNull();

    const minutes: string = (window as RegExpMatchArray)[1] as string;

    expect(readSource(INSTANCES_PAGE)).toContain(
      'text={isLive ? "Running" : "Stale"}',
    );
    expect(pageProse(HUB)).toContain(
      `how many reported in the last ${minutes} minutes`,
    );
    expect(pageProse(TROUBLESHOOTING)).toContain(
      `has not reported in the last ${minutes} minutes`,
    );
    expect(pageProse(ECS)).toContain("A task that stops reporting turns **Stale**");
  });
});

describe("the clocks the sweeps keep", () => {
  const savedEnv: NodeJS.ProcessEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it("quotes when an environment reads Disconnected, measured in time OneUptime was receiving", () => {
    const minutes: number = CLOUD_ENVIRONMENT_DISCONNECTED_MINUTES;

    expect(minutes).toBe(15);
    expect(pageProse(HUB)).toContain(
      `An environment whose telemetry stops for ${minutes} minutes shows **Disconnected**`,
    );
    expect(pageProse(TROUBLESHOOTING)).toContain(
      `when no telemetry has arrived for it in ${minutes} minutes`,
    );

    // Time OneUptime itself was down does not count (issue #2825).
    expect(readSource(CLOUD_RESOURCE_SERVICE)).toContain(
      "ReceivingCoverage.getSilenceCutoff({\n      silenceInMinutes: CLOUD_ENVIRONMENT_DISCONNECTED_MINUTES,",
    );
    expect(pageProse(HUB)).toContain(
      "Time when OneUptime itself was down or catching up does not count",
    );
    expect(pageProse(TROUBLESHOOTING)).toContain(
      "Time when OneUptime itself was down or catching up does not count",
    );
  });

  it("quotes the instance sweep's default, its floor and its variable", () => {
    delete process.env["CLOUD_INSTANCE_STALE_MINUTES"];
    const defaultMinutes: number =
      CloudResourceInstanceService.getStaleThresholdMinutes();

    process.env["CLOUD_INSTANCE_STALE_MINUTES"] = "9";
    const belowFloor: number =
      CloudResourceInstanceService.getStaleThresholdMinutes();

    process.env["CLOUD_INSTANCE_STALE_MINUTES"] = "10";
    const atFloor: number =
      CloudResourceInstanceService.getStaleThresholdMinutes();

    expect(defaultMinutes).toBe(15);
    expect(belowFloor).toBe(defaultMinutes);
    expect(atFloor).toBe(10);
    expect(pageProse(TROUBLESHOOTING)).toContain(
      `\`CLOUD_INSTANCE_STALE_MINUTES\` (default ${defaultMinutes}, at least ${atFloor})`,
    );
    expect(readSource(SERVERLESS_INSTANCE_SERVICE)).toContain(
      'process.env["SERVERLESS_INSTANCE_STALE_MINUTES"]',
    );
    expect(pageProse(TROUBLESHOOTING)).toContain(
      "Serverless functions use `SERVERLESS_INSTANCE_STALE_MINUTES`",
    );
  });
});

describe("the token check", () => {
  it("answers as the pages say: 200 and valid, or 401 for an unknown, revoked, disabled or expired key", () => {
    const api: string = readSource(OTLP_INGEST_API);

    expect(api).toContain('"/otlp/v1/validate"');
    expect(api).toContain("valid: true,");
    expect(api).toContain("This ingestion token is unknown or has been revoked.");
    expect(api).toContain("This ingestion key has been disabled.");
    expect(api).toContain("This ingestion key has expired.");
    expect(api).toContain("{ statusCode: new StatusCode(401) }");

    for (const page of [HUB, ECS, CLOUD_RUN, CONTAINER_APPS, OTHER]) {
      expect({
        page,
        says: pageProse(page).includes(
          "`401` means it is unknown, revoked, disabled or expired",
        ),
      }).toEqual({ page, says: true });
    }

    expect(pageProse(TROUBLESHOOTING)).toContain(
      "The token is missing, unknown, revoked, disabled or expired, and the answer's `message` says which.",
    );
  });

  it("names the key types the answer reports", () => {
    expect(Object.values(TelemetryIngestionKeyType)).toEqual(["Server", "Browser"]);
    expect(readSource(OTLP_INGEST_API)).toContain("keyType: policy.keyType,");
    expect(pageProse(TROUBLESHOOTING)).toContain(
      "Its `keyType` should be `Server`: a `Browser` key is refused from a collector or a backend service.",
    );
  });
});

describe("labels and owners", () => {
  it("adds the label a oneuptime.label attribute names, as ingest makes it", () => {
    expect(ONEUPTIME_LABEL_ATTRIBUTE_PREFIX).toBe("oneuptime.label.");
    expect(
      extractOneuptimeLabelNames([
        { key: "oneuptime.label.team", value: { stringValue: "payments" } },
      ]),
    ).toEqual(["team:payments"]);
    expect(readSource(INGEST_BASE)).toContain(
      "await this.promoteOneuptimeLabelsToCloudResource({",
    );
    expect(pageProse(HUB)).toContain(
      "a resource attribute such as `oneuptime.label.team=payments` adds the label `team:payments` to the environment",
    );
  });
});

describe("the platform spellings ingest rewrites", () => {
  it("names the dotted Azure spellings ingest maps to the underscore values", () => {
    expect(CLOUD_PLATFORM_ALIASES["azure.container_apps"]).toBe(
      ManagedCloudPlatform.AzureContainerApps,
    );
    expect(CLOUD_PLATFORM_ALIASES["azure.app_service"]).toBe(
      ManagedCloudPlatform.AzureAppService,
    );
    expect(CLOUD_PLATFORM_ALIASES["azure.functions"]).toBe(
      FaasCloudPlatform.AzureFunctions,
    );

    expect(pageProse(HUB)).toContain(
      "The Node.js and .NET Azure detectors write `azure.container_apps` and `azure.app_service`.",
    );
    expect(pageProse(TROUBLESHOOTING)).toContain(
      "write `azure.container_apps`, `azure.app_service` and `azure.functions`",
    );
    expect(pageProse(CONTAINER_APPS)).toContain("`azure.container_apps`, with a dot");
    expect(pageProse(OTHER)).toContain("`azure.app_service`, with a dot");
  });
});

describe("cloud resources", () => {
  it("names a resource's status as its overview draws it", () => {
    expect(readSource(RESOURCE_OVERVIEW)).toContain(
      'statusLabel={isReporting ? "Reporting" : "Not reporting"}',
    );

    const labels: Array<string> = boldLabels(englishPage(RESOURCES));

    expect(labels).toContain("Reporting");
    expect(labels).toContain("Not reporting");
  });

  it("names the metric explorer's button for a monitor", () => {
    expect(readSource(METRIC_EXPLORER)).toContain(
      'text="Create monitor from this view"',
    );
    expect(boldLabels(englishPage(RESOURCES))).toContain(
      "Create monitor from this view",
    );
  });

  it("names the attributes the inventory lists a resource under", () => {
    const registry: string = readSource(INVENTORY_REGISTRY);

    expect(registry).toContain('"cloud.resource.id": row.providerResourceId,');
    expect(registry).toContain('"cloud.resource.type": row.cloudResourceType,');
    expect(pageProse(RESOURCES)).toContain(
      "with the provider's ID as `cloud.resource.id` and the type as `cloud.resource.type`",
    );
  });

  /*
   * The in-app guide links #troubleshooting from every option, and #aws for
   * "the dimension that identifies a resource in each" namespace: the AWS
   * identity table, which owns that anchor alone now that the setup
   * section is "Connect AWS".
   */
  it("gives the anchors the in-app guide links to the sections it means", () => {
    const guide: string = readSource(CLOUD_MONITORING_GUIDE);
    const headings: Array<DocsHeading> = scanMarkdown(
      englishPage(RESOURCES),
    ).headings;
    const withSlug: (slug: string) => Array<DocsHeading> = (
      slug: string,
    ): Array<DocsHeading> => {
      return headings.filter((heading: DocsHeading): boolean => {
        return heading.slug === slug;
      });
    };

    expect(guide).toContain("(/docs/telemetry/cloud-resources#aws)");
    expect(guide).toContain("(${CLOUD_RESOURCES_DOCS_URL}#troubleshooting)");
    expect(withSlug("aws")).toEqual([
      expect.objectContaining({ level: 3, text: "AWS" }),
    ]);
    expect(withSlug("troubleshooting")).toEqual([
      expect.objectContaining({ level: 2, text: "Troubleshooting" }),
    ]);

    const aws: DocsHeading = withSlug("aws")[0] as DocsHeading;
    const parent: DocsHeading | undefined = headings
      .filter((heading: DocsHeading): boolean => {
        return heading.level === 2 && heading.line < aws.line;
      })
      .pop();

    expect(parent?.text).toBe("How a resource is identified");
  });
});

describe("the code samples", () => {
  it.each(PAGES)("%s: every YAML and JSON sample parses", (page: string) => {
    for (const fence of fencesOf(page)) {
      if (fence.lang === "yaml") {
        expect(() => {
          jsYaml.load(fence.code);
        }).not.toThrow();
      }

      if (fence.lang === "json") {
        expect(() => {
          JSON.parse(fence.code);
        }).not.toThrow();
      }
    }
  });

  it.each([HUB, ECS, CLOUD_RUN, CONTAINER_APPS, OTHER])(
    "%s: every collector exports to OneUptime with the token from its environment",
    (page: string) => {
      const configs: Array<YamlMap> = collectorConfigs(page);

      expect(configs.length).toBeGreaterThan(0);

      for (const config of configs) {
        const exporter: YamlMap = mapAt(config, "exporters", "otlphttp/oneuptime");

        expect(exporter["endpoint"]).toBe("https://oneuptime.com/otlp");
        expect(exporter["headers"]).toEqual({
          "x-oneuptime-token": "${env:ONEUPTIME_TOKEN}",
        });
      }
    },
  );

  it("ECS: the task definition carries the collector configuration the page shows", () => {
    const taskDefinition: YamlMap = JSON.parse(
      titledFence(ECS, "task-definition.json"),
    ) as YamlMap;
    const containers: Array<YamlMap> = taskDefinition[
      "containerDefinitions"
    ] as Array<YamlMap>;
    const collector: YamlMap = containers.find(
      (container: YamlMap): boolean => {
        return container["name"] === "otel-collector";
      },
    ) as YamlMap;
    const app: YamlMap = containers.find((container: YamlMap): boolean => {
      return container["name"] === "app";
    }) as YamlMap;

    // The jq command on the page writes containerDefinitions[1].environment[0].
    expect(containers.indexOf(collector)).toBe(1);

    const environment: Array<YamlMap> = collector["environment"] as Array<YamlMap>;

    expect(environment[0]!["name"]).toBe("OTEL_COLLECTOR_CONFIG");
    expect(yamlOf(environment[0]!["value"] as string)).toEqual(
      yamlOf(titledFence(ECS, "OTEL_COLLECTOR_CONFIG")),
    );
    expect(collector["command"]).toEqual(["--config=env:OTEL_COLLECTOR_CONFIG"]);
    expect((collector["secrets"] as Array<YamlMap>)[0]!["name"]).toBe(
      "ONEUPTIME_TOKEN",
    );

    // The application's variables are the sidecar tab's.
    const sidecarVariables: Record<string, string> = shellVariables(
      (
        fencesOf(ECS).find((fence: DocsFence): boolean => {
          return (
            fence.lang === "bash" &&
            fence.code.includes("OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318")
          );
        }) as DocsFence
      ).code,
    );
    const appVariables: Record<string, string> = {};

    for (const entry of app["environment"] as Array<YamlMap>) {
      appVariables[entry["name"] as string] = entry["value"] as string;
    }

    expect(appVariables).toEqual(sidecarVariables);
    expect(app["dependsOn"]).toEqual([
      { containerName: "otel-collector", condition: "START" },
    ]);
  });

  it("Cloud Run: the collector answers the startup probe the app waits for", () => {
    const service: YamlMap = yamlOf(titledFence(CLOUD_RUN, "service.yaml"));
    const template: YamlMap = mapAt(service, "spec", "template");
    const annotations: YamlMap = mapAt(template, "metadata", "annotations");
    const containers: Array<YamlMap> = mapAt(template, "spec")[
      "containers"
    ] as Array<YamlMap>;
    const names: Array<string> = containers.map((container: YamlMap): string => {
      return container["name"] as string;
    });
    const dependencies: Record<string, Array<string>> = JSON.parse(
      annotations["run.googleapis.com/container-dependencies"] as string,
    ) as Record<string, Array<string>>;

    for (const [container, dependsOn] of Object.entries(dependencies)) {
      expect(names).toContain(container);
      for (const dependency of dependsOn) {
        expect(names).toContain(dependency);
      }
    }

    const collector: YamlMap = collectorContainers(service)[0] as YamlMap;
    const config: YamlMap = embeddedCollectorConfig(collector);
    const healthCheck: YamlMap = mapAt(config, "extensions", "health_check");
    const probe: YamlMap = mapAt(collector, "startupProbe", "httpGet");

    expect(healthCheck["endpoint"]).toBe(`0.0.0.0:${probe["port"]}`);
    expect(mapAt(config, "service")["extensions"]).toEqual(["health_check"]);
    expect(
      mapAt(config, "processors", "resourcedetection")["detectors"],
    ).toEqual(["env", "gcp"]);

    // Only the container that receives requests declares ports.
    expect(
      containers
        .filter((container: YamlMap): boolean => {
          return Boolean(container["ports"]);
        })
        .map((container: YamlMap): string => {
          return container["name"] as string;
        }),
    ).toEqual(["app"]);
  });

  it("Container Apps: the sidecar's attributes are the SDK direct ones, and it keeps the app's service.name", () => {
    const app: YamlMap = yamlOf(titledFence(CONTAINER_APPS, "checkout-api.yaml"));
    const collector: YamlMap = collectorContainers(app)[0] as YamlMap;
    const attributes: string = containerEnvironment(collector)[
      "OTEL_RESOURCE_ATTRIBUTES"
    ]!["value"] as string;
    const update: DocsFence = fencesOf(CONTAINER_APPS).find(
      (fence: DocsFence): boolean => {
        return fence.code.startsWith("az containerapp update \\");
      },
    ) as DocsFence;

    expect(update.code).toContain(`"OTEL_RESOURCE_ATTRIBUTES=${attributes}"`);
    expect(
      containerEnvironment(collector)["ONEUPTIME_TOKEN"]!["secretRef"],
    ).toBe("oneuptime-token");

    const detection: YamlMap = mapAt(
      embeddedCollectorConfig(collector),
      "processors",
      "resourcedetection",
    );

    expect(detection["detectors"]).toEqual(["env", "azurecontainerapps"]);
    expect(detection["override"]).toBe(false);
  });

  it("Elastic Beanstalk: the collector drops the deployment-wide service.instance.id in every pipeline", () => {
    const config: YamlMap = yamlOf(titledFence(OTHER, "config.yaml"));
    const pipelines: YamlMap = mapAt(config, "service", "pipelines");

    expect(mapAt(config, "processors", "resource")["attributes"]).toEqual([
      { key: "service.instance.id", action: "delete" },
    ]);
    expect(
      mapAt(config, "processors", "resourcedetection")["detectors"],
    ).toEqual(["env", "elastic_beanstalk", "ec2"]);

    for (const signal of ["traces", "metrics", "logs"]) {
      expect(mapAt(pipelines, signal)["processors"]).toEqual([
        "resourcedetection",
        "resource",
        "batch",
      ]);
    }
  });
});

describe("the in-app guide's tabs", () => {
  it("are the tabs the platform pages offer, in the guide's words", () => {
    const guide: string = readSource(CLOUD_SETUP_GUIDE);

    expect(SHAPE_TABS).toEqual(["Sidecar collector", "SDK direct"]);
    expect(guide).toContain('const SIDECAR_COLLECTOR: string = "Sidecar collector";');
    expect(guide).toContain('const SDK_DIRECT: string = "SDK direct";');

    for (const page of [HUB, ...PLATFORM_PAGES]) {
      const labels: Array<string> = tabLabels(englishPage(page));

      expect(labels.length).toBeGreaterThan(0);
      expect(new Set(labels)).toEqual(new Set(SHAPE_TABS));
    }
  });
});
