import { readPage } from "./DocsContentSupport";
import {
  DASHBOARD_RESOURCE_SCOPES,
  DashboardResourceScope,
} from "Common/Types/Dashboard/DashboardResourceScope";
import {
  DashboardTemplate,
  DashboardTemplateCategory,
  DashboardTemplates,
  getTemplateConfig,
} from "Common/Types/Dashboard/DashboardTemplates";
import DashboardBaseComponent from "Common/Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardViewConfig from "Common/Types/Dashboard/DashboardViewConfig";
import { JSONObject } from "Common/Types/JSON";
import MonitorMetricType from "Common/Types/Monitor/MonitorMetricType";
import { Translator } from "Common/Types/Translator";
import {
  getDashboardResourceScopeAllLabel,
  getDashboardResourceScopeName,
  getDashboardResourceScopeSetUpLabel,
} from "Common/UI/Components/Dashboard/DashboardResourceScopeWords";
import {
  APPLICATION_SDK_ATTRIBUTE_KEYS,
  CONTAINER_ATTRIBUTE_KEYS,
  CONTAINER_ENGINE_ATTRIBUTE_KEYS,
  KUBERNETES_IDENTITY_ATTRIBUTE_KEYS,
  NOT_A_HOST_RESOURCE_ATTRIBUTE_KEYS,
} from "Common/Utils/Telemetry/HostResource";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What the docs say about a dashboard variable's Resource Type and about
 * which telemetry adds a host (issues #11257, #11258), held to the code
 * that does it: the types the Variables dialog lists and the words the
 * toolbar and the empty dashboard use, the templates that show only their
 * kind, the resource attributes that keep telemetry off Hosts, and the way
 * back to an archived host.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "../../../FeatureSet/Dashboard/src",
);

// The dashboard's own English words: an English reader's translator.
const ENGLISH: Translator = {
  language: "en",
  translateText: (text: string | undefined): string | undefined => {
    return text;
  },
  hasTranslation: (): boolean => {
    return true;
  },
} as unknown as Translator;

function bold(text: string): string {
  return `**${text}**`;
}

function sectionOf(markdown: string, heading: string): string {
  const lines: Array<string> = markdown.split("\n");
  const start: number = lines.indexOf(heading);

  expect({ heading, found: start >= 0 }).toEqual({ heading, found: true });

  const level: number = heading.indexOf(" ");
  const body: Array<string> = [];

  for (const line of lines.slice(start + 1)) {
    const match: RegExpMatchArray | null = line.match(/^(#+) /);

    if (match && (match[1] as string).length <= level) {
      break;
    }

    body.push(line);
  }

  return body.join("\n");
}

function codeSpans(text: string): Array<string> {
  return Array.from(text.matchAll(/`([^`]+)`/g)).map(
    (match: RegExpMatchArray) => {
      return match[1]!;
    },
  );
}

describe("Dashboard docs: a variable's Resource Type", () => {
  const variables: string = readPage("en", "dashboards/variables");
  const telemetryAttribute: string = sectionOf(
    variables,
    "### Telemetry Attribute",
  );

  test("lists every type the Variables dialog offers, by the dialog's names, in its order", () => {
    const names: Array<string> = DASHBOARD_RESOURCE_SCOPES.map(
      (scope: DashboardResourceScope) => {
        return bold(getDashboardResourceScopeName(ENGLISH, scope));
      },
    );
    const last: string = names[names.length - 1]!;

    expect(telemetryAttribute).toContain(
      `A Telemetry Attribute variable can also have a ${bold("Resource Type")}: ${names
        .slice(0, -1)
        .join(", ")} or ${last}.`,
    );
  });

  test("quotes All as the toolbar reads it for hosts and for clusters", () => {
    expect(telemetryAttribute).toContain(
      `${bold("All")} reads ${bold(
        getDashboardResourceScopeAllLabel(ENGLISH, DashboardResourceScope.Host),
      )}, ${bold(
        getDashboardResourceScopeAllLabel(
          ENGLISH,
          DashboardResourceScope.KubernetesCluster,
        ),
      )} and so on`,
    );
  });

  test("names the empty dashboard's button and the dialog's choice that names no type as they read", () => {
    expect(telemetryAttribute).toContain(
      `such as ${bold(
        getDashboardResourceScopeSetUpLabel(
          ENGLISH,
          DashboardResourceScope.KubernetesCluster,
        ),
      )}.`,
    );

    const dialog: string = fs.readFileSync(
      path.join(
        DASHBOARD_SRC,
        "Components/Dashboard/Toolbar/DashboardVariablesModal.tsx",
      ),
      "utf8",
    );

    expect(telemetryAttribute).toContain(
      `set the variable's ${bold("Resource Type")} to ${bold("Any resource type")}.`,
    );
    expect(dialog).toContain('translator.translateText("Any resource type")');
    expect(dialog).toContain('translator.translateText("Resource Type")');
  });

  test("says the infrastructure templates give their variable its type, and every one of them shows only its kind", () => {
    expect(telemetryAttribute).toContain(
      "The infrastructure templates give their variable its type",
    );

    const infrastructure: Array<DashboardTemplate> = (
      DashboardTemplates as Array<DashboardTemplate>
    ).filter((template: DashboardTemplate) => {
      return template.category === DashboardTemplateCategory.Infrastructure;
    });

    expect(infrastructure.length).toBeGreaterThan(0);

    const monitorMetrics: Set<string> = new Set<string>(
      Object.values(MonitorMetricType) as Array<string>,
    );

    for (const template of infrastructure) {
      const config: DashboardViewConfig = getTemplateConfig(template.type)!;
      const scoped: boolean = (config.variables || []).some(
        (variable: { resourceScope?: unknown }) => {
          return Boolean(variable.resourceScope);
        },
      );

      if (scoped) {
        continue;
      }

      // Unscoped, it may only read what OneUptime's own monitors write.
      const metricNames: Array<string> = config.components.flatMap(
        (component: DashboardBaseComponent): Array<string> => {
          const args: JSONObject = (component.arguments ||
            {}) as unknown as JSONObject;
          const query: JSONObject | undefined = args["metricQueryConfig"] as
            | JSONObject
            | undefined;
          const name: unknown = (
            (query?.["metricQueryData"] as JSONObject | undefined)?.[
              "filterData"
            ] as JSONObject | undefined
          )?.["metricName"];

          return typeof name === "string" ? [name] : [];
        },
      );

      expect({
        template: template.type,
        readsOthers: metricNames.filter((name: string) => {
          return !monitorMetrics.has(name);
        }),
        hasLogStream: config.components.some(
          (component: DashboardBaseComponent) => {
            return component.componentType === "LogStream";
          },
        ),
      }).toEqual({
        template: template.type,
        readsOthers: [],
        hasLogStream: false,
      });
    }

    expect(readPage("en", "dashboards/authoring")).toContain(
      "Each infrastructure template shows only its own kind of resource, through its variable's [Resource Type](/docs/dashboards/variables#telemetry-attribute)",
    );
  });

  test("keeps saying All on a variable with no type removes its filter, and says what it shows with one", () => {
    expect(sectionOf(variables, "## Multi-select and defaults")).toContain(
      `${bold("All")} removes the variable's filter, so the widgets show everything. On a variable with a ${bold(
        "Resource Type",
      )}, they show everything of that type.`,
    );
  });
});

describe("Hosts docs: what counts as a host", () => {
  const hosts: string = readPage("en", "telemetry/hosts");
  const section: string = sectionOf(hosts, "## What counts as a host");

  test("each attribute it names keeps telemetry off Hosts, in the group it is named in", () => {
    const lines: Array<string> = section.split("\n").filter((line: string) => {
      return line.startsWith("- ");
    });

    expect(lines).toHaveLength(3);

    expect(codeSpans(lines[0]!)).toEqual([...CONTAINER_ENGINE_ATTRIBUTE_KEYS]);

    for (const key of codeSpans(lines[1]!)) {
      expect(KUBERNETES_IDENTITY_ATTRIBUTE_KEYS).toContain(key);
    }

    const [container, sdk] = codeSpans(lines[2]!);
    expect(CONTAINER_ATTRIBUTE_KEYS).toContain(container);
    expect(APPLICATION_SDK_ATTRIBUTE_KEYS).toContain(sdk);

    for (const key of codeSpans(lines.join("\n"))) {
      expect(NOT_A_HOST_RESOURCE_ATTRIBUTE_KEYS).toContain(key);
    }
  });

  test("the way back to an archived host is the Hosts list's own", () => {
    expect(section).toContain(
      `${bold("Advanced → Archived")} on the ${bold("Hosts")} list, where ${bold(
        "Unarchive",
      )} brings one back`,
    );

    const sideMenu: string = fs.readFileSync(
      path.join(DASHBOARD_SRC, "Pages/Host/SideMenu.tsx"),
      "utf8",
    );

    expect(sideMenu).toMatch(
      /title: "Advanced",\s+items: \[\s+\{\s+link: \{\s+title: "Archived",/,
    );
  });

  test("the Hosts widget's row points at it", () => {
    expect(readPage("en", "dashboards/widgets")).toContain(
      "| **Hosts** | **Hosts**, with their connection status, OS, CPU and memory | The collector on each host: see [What counts as a host](/docs/telemetry/hosts#what-counts-as-a-host) |",
    );
  });
});
