import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import {
  ALERTING_PAGES,
  CHAT_STEP_PAGES,
  DYNAMICS,
  GROUPING_VARIABLES,
  INTEGRATIONS_PAGES,
  ISSUE_PAGES,
  IntegrationsDocsPageEntry,
  JIRA,
  OPSGENIE,
  OVERVIEW,
  PAGERDUTY,
  SERVICENOW,
  STEP_NAMES,
  TEMPLATE_NAMES,
  ZABBIX,
} from "./IntegrationsDocsPages";
import { scanMarkdown } from "./DocsContentSupport";
import { tables } from "./DocsPageShape";
import {
  bold,
  codeIn,
  englishPage,
  englishSection,
  lineStartingWith,
  readRepoFile,
  rowStartingWith,
  tableWithHeader,
} from "./InventoryAndApiDocsSupport";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertInternalNote from "Common/Models/DatabaseModels/AlertInternalNote";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentInternalNote from "Common/Models/DatabaseModels/IncidentInternalNote";
import IncidentPublicNote from "Common/Models/DatabaseModels/IncidentPublicNote";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import IncomingRequestIncidentGrouping from "Common/Server/Utils/Monitor/IncomingRequestIncidentGrouping";
import { JSONObject } from "Common/Types/JSON";
import MonitorCriteria from "Common/Types/Monitor/MonitorCriteria";
import { CheckOn, FilterType } from "Common/Types/Monitor/CriteriaFilter";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import SecurityEventConnectorProvider, {
  AllSecurityEventConnectorProviders,
} from "Common/Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import {
  SecurityEventConnectorCatalog,
  SecurityEventConnectorDefinition,
} from "Common/Types/SecurityEvent/Connectors/SecurityEventConnectorCatalog";
import {
  ToolImportCatalog,
  ToolImportCategory,
} from "Common/Types/ToolImport/ToolImportCatalog";
import ToolImportSource, {
  AllToolImportSources,
} from "Common/Types/ToolImport/ToolImportSource";
import { AllSecurityEventDestinationProviders } from "Common/Types/SecurityEvent/Destinations/SecurityEventDestinationProvider";
import ComponentMetadata, {
  Argument,
  Port,
  ReturnValue,
} from "Common/Types/Workflow/Component";
import ComponentID from "Common/Types/Workflow/ComponentID";
import Components from "Common/Types/Workflow/Components";
import RecordComponents, {
  SELECT_FIELDS_NAME,
  WATCHED_FIELDS_NAME,
} from "Common/Types/Workflow/Components/BaseModel";
import {
  CONDITION_COMPARISONS,
  ConditionComparison,
} from "Common/Types/Workflow/Components/ConditionComparison";
import {
  DYNAMICS_ACCESS_TOKEN_VARIABLE_NAME,
  DYNAMICS_SYNCED_FROM_ONEUPTIME_MARKER,
  JIRA_ALERT_LABEL_PREFIX,
  JIRA_INCIDENT_LABEL_PREFIX,
  JIRA_LINK_LABEL,
  JIRA_SYNCED_FROM_ONEUPTIME_MARKER,
  ONEUPTIME_SYNCED_FROM_DYNAMICS_MARKER,
  ONEUPTIME_SYNCED_FROM_JIRA_MARKER,
  WorkflowTemplate,
  WorkflowTemplateCategory,
  WorkflowTemplateOAuth2Variable,
  WorkflowTemplateVariable,
  ZABBIX_EVENT_ID_CUSTOM_FIELD,
  ZABBIX_PAGE_FROM_SEVERITY,
  ZABBIX_SEVERITY_NAMES,
  ZABBIX_URL_PATTERN,
  ZabbixEventKind,
  getTemplateGraphSpec,
  getWorkflowTemplateCategoryInfo,
  getWorkflowTemplatesByCategory,
} from "Common/Types/Workflow/Templates";
import {
  ALERT,
  INCIDENT,
  ZABBIX_URL,
  quoted,
  runZabbixScript,
  zabbixMacroValues,
  zabbixPostedBody,
} from "Common/Tests/Types/Workflow/ZabbixTemplateFixtures";
import {
  WEBHOOK_TRIGGER_HTTP_METHODS,
  getWebhookTriggerUrl,
} from "Common/Types/Workflow/WebhookTrigger";
import { pickSeverityIndex } from "Common/Types/Workflow/Components/FromAnotherTool";
import {
  ZABBIX_CANNOT_CLOSE_SENTENCE,
  ZABBIX_UPDATE_ARGUMENT_IDS,
  ZabbixProblemUpdate,
  chooseZabbixUpdate,
  getZabbixApiUrl,
  getZabbixRequestBody,
} from "Common/Types/Workflow/Components/Zabbix";
import {
  OAuth2ClientAuthenticationMethod,
  OAuth2GrantType,
} from "Common/Types/Workflow/WorkflowVariableOAuth";
import { describe, expect, it } from "@jest/globals";
import vm from "vm";

/*
 * Docs overhaul task 28a: what the integration pages say, held to the code
 * that makes it true. IntegrationsDocsTranslations holds the 16
 * translations to these English pages, line for line, so a fact that
 * changes here changes in every language with the English.
 *
 * The pages describe workflows, an Incoming Request monitor and the Jira
 * and Dynamics 365 templates, so this suite reads those: the workflow
 * steps' own metadata (the names the pages give each step, setting and
 * output), the templates' graphs and scripts (their names, settings,
 * blocks, constants, markers and the lines their runs log), the monitor's
 * default criteria and its incident grouping (it runs the Zabbix media
 * type's script from the page and groups what it posts), and the catalogs
 * the overview lists (the Integrations nav group, the Security Events
 * connections and the tools an import brings a team over from).
 *
 * The older suites keep holding what they held: JiraTemplateSettingsDocs
 * (the Jira settings each template asks for), WorkflowTemplatePickerDocs,
 * WorkflowWebhookUrlDocs, WorkflowRunsDocs, WorkflowTurnOnDocs,
 * DeclareIncidentStepsDocs, HuntressIntegrationDocs, IrcIntegrationDocs
 * and TemplateMissingValueClaims. IssueAndChatIntegrationsDocsFacts holds
 * how every integrations page tests its workflow with Run Workflow, these
 * pages' too, in every language, and what the Overview's chat rows say.
 */

const DASHBOARD: string = "App/FeatureSet/Dashboard/src";

function dashboardSource(relativePath: string): string {
  return readRepoFile(`${DASHBOARD}/${relativePath}`);
}

// A {{...}} reference, as the workflow runtime reads one.
const REFERENCE: RegExp = /\{\{([^{}]+?)\}\}/g;
// A block's identifier in a reference: local.components.<id>.returnValues.
const BLOCK_REFERENCE: RegExp =
  /local\.components\.([a-z0-9-]+)\.returnValues/g;
// The default identifier the Builder gives the first block of a kind.
const FIRST_BLOCK: RegExp = /^(.+)-1$/;
const CONSTANT_DECLARATION: RegExp = /^const ([A-Z_]+) = (.+);$/gm;
// A row of the Zabbix media type's parameters: | `event_id` | `{EVENT.ID}` |.
const PARAMETER_ROW: RegExp = /^\s*\| `([a-z_]+)` \| `(\{[A-Z.]+\})` \|\s*$/;
// A parameter the media type's script reads: params.event_id.
const SCRIPT_PARAMETER: RegExp = /params\.([a-z_]+)/g;
// What the pages used to say about writing custom fields from a workflow.
const REPLACES_CUSTOM_FIELDS: RegExp = /replaces? every (other )?custom field/;
// A regular expression literal as a script declares one: /.../i.
const CASELESS_PATTERN: RegExp = /^\/(.+)\/i$/;
// The trigger of either PagerDuty workflow, in its dedup_key.
const TRIGGER_REFERENCE: RegExp =
  /local\.components\.incident-on-(create|update)-1/;
const UUID_LENGTH: number = "00000000-0000-0000-0000-000000000000".length;

const JIRA_TEMPLATES: Array<WorkflowTemplate> = getWorkflowTemplatesByCategory(
  WorkflowTemplateCategory.Jira,
);
const DYNAMICS_TEMPLATES: Array<WorkflowTemplate> =
  getWorkflowTemplatesByCategory(WorkflowTemplateCategory.Dynamics365);

interface TemplateNode {
  componentId: string;
  metadataId: string;
  args?: JSONObject | undefined;
}

function nodesOf(template: WorkflowTemplate): Array<TemplateNode> {
  const spec: { nodes: Array<TemplateNode> } | null = getTemplateGraphSpec(
    template.id,
  );

  if (!spec) {
    throw new Error(`No graph for the template ${template.id}`);
  }

  return spec.nodes;
}

function nodeOf(template: WorkflowTemplate, componentId: string): TemplateNode {
  const node: TemplateNode | undefined = nodesOf(template).find(
    (candidate: TemplateNode): boolean => {
      return candidate.componentId === componentId;
    },
  );

  if (!node) {
    throw new Error(`${template.id} has no block ${componentId}`);
  }

  return node;
}

// A template's block's JavaScript Code.
function codeOf(template: WorkflowTemplate, componentId: string): string {
  const code: unknown = nodeOf(template, componentId).args?.["code"];

  if (typeof code !== "string") {
    throw new Error(`${template.id} ${componentId} has no code`);
  }

  return code;
}

// Everything a template's blocks are set to, as one text.
function argumentsText(template: WorkflowTemplate): string {
  return nodesOf(template)
    .map((node: TemplateNode): string => {
      return JSON.stringify(node.args || {});
    })
    .join("\n");
}

// The value a script assigns a top-level constant, as written.
function constantValue(code: string, name: string): string {
  for (const match of Array.from(code.matchAll(CONSTANT_DECLARATION))) {
    if (match[1] === name) {
      return match[2] as string;
    }
  }

  throw new Error(`No constant ${name}`);
}

function templateNamed(
  templates: Array<WorkflowTemplate>,
  name: string,
): WorkflowTemplate {
  const template: WorkflowTemplate | undefined = templates.find(
    (candidate: WorkflowTemplate): boolean => {
      return candidate.name === name;
    },
  );

  if (!template) {
    throw new Error(`No template is named "${name}"`);
  }

  return template;
}

// Whether a template starts from another tool's webhook, or from OneUptime.
function startsFromWebhook(template: WorkflowTemplate): boolean {
  return (
    (nodesOf(template)[0] as TemplateNode).metadataId === ComponentID.Webhook
  );
}

/*
 * The rows of the tables that list templates: a group row ("**OneUptime →
 * Jira**") then the templates of that group, as [group, template name].
 */
function templateRows(section: string): Array<{ group: string; name: string }> {
  const rows: Array<{ group: string; name: string }> = [];
  let group: string = "";

  for (const table of tables(section)) {
    for (const row of table.slice(1)) {
      const first: string = (row[0] as string).trim();

      if (first.startsWith("**") && first.endsWith("**")) {
        group = first.slice(2, -2);
        continue;
      }

      rows.push({ group, name: first });
    }
  }

  return rows;
}

// Every step-defined name: a step's title, settings, outputs and returns.
function stepDefinedNames(): Set<string> {
  const names: Set<string> = new Set<string>();
  const components: Array<ComponentMetadata> = [
    ...(Components as Array<ComponentMetadata>),
    ...RecordComponents.getComponents(new Incident()),
    ...RecordComponents.getComponents(new Alert()),
    ...RecordComponents.getComponents(new IncidentState()),
    ...RecordComponents.getComponents(new AlertState()),
    ...RecordComponents.getComponents(new IncidentInternalNote()),
    ...RecordComponents.getComponents(new IncidentPublicNote()),
    ...RecordComponents.getComponents(new AlertInternalNote()),
  ];

  for (const component of components) {
    names.add(component.title);

    for (const argument of component.arguments as Array<Argument>) {
      names.add(argument.name);
    }

    for (const port of [
      ...component.inPorts,
      ...component.outPorts,
    ] as Array<Port>) {
      names.add(port.title);
    }

    for (const returnValue of component.returnValues as Array<ReturnValue>) {
      names.add(returnValue.name);
    }
  }

  for (const comparison of CONDITION_COMPARISONS as Array<ConditionComparison>) {
    names.add(comparison.label);
  }

  return names;
}

// The default ids of every step a page can add: "webhook", "incident-on-create".
function stepIds(): Set<string> {
  return new Set<string>(
    [
      ...(Components as Array<ComponentMetadata>),
      ...RecordComponents.getComponents(new Incident()),
      ...RecordComponents.getComponents(new Alert()),
      ...RecordComponents.getComponents(new IncidentState()),
      ...RecordComponents.getComponents(new AlertState()),
    ].map((component: ComponentMetadata): string => {
      return component.id;
    }),
  );
}

// Every {{...}} reference a page writes, in its code and its prose.
function referencesOf(page: string): Array<string> {
  return Array.from(englishPage(page).matchAll(REFERENCE)).map(
    (match: RegExpMatchArray): string => {
      return (match[1] as string).trim();
    },
  );
}

describe("every page: the workflow steps it names", () => {
  const steps: Set<string> = stepDefinedNames();

  it.each(INTEGRATIONS_PAGES)(
    "$page keeps in English only names a workflow step defines",
    (entry: IntegrationsDocsPageEntry) => {
      const unknown: Array<string> = (STEP_NAMES[entry.page] || []).filter(
        (name: string): boolean => {
          return !steps.has(name);
        },
      );

      expect(unknown).toEqual([]);
    },
  );

  it.each(INTEGRATIONS_PAGES)(
    "$page reads values only the ways the runtime does: a step's values, a workflow or global variable",
    (entry: IntegrationsDocsPageEntry) => {
      const roots: Array<string> = [
        "local.components.",
        "local.variables.",
        "global.variables.",
        // An Incoming Request monitor's incident template reads the request.
        "requestBody.",
        // A Jira automation rule's smart values, sent back to the workflow.
        "issue.",
      ];
      /*
       * And the variable a monitor's grouping adds, named after the last
       * segment of its path (AlertingIntegrationsDocsFacts holds each to
       * the grouping the page sets).
       */
      const groupingVariables: ReadonlyArray<string> =
        GROUPING_VARIABLES[entry.page] || [];
      const wrong: Array<string> = referencesOf(entry.page).filter(
        (reference: string): boolean => {
          return (
            !groupingVariables.includes(reference) &&
            !roots.some((root: string): boolean => {
              return reference.startsWith(root);
            })
          );
        },
      );

      expect(wrong).toEqual([]);
      // The old forms these pages used, which never resolved.
      expect(englishPage(entry.page)).not.toContain("{{variable.");
      expect(englishPage(entry.page)).not.toContain("{{Incident.");
    },
  );

  it.each([
    OVERVIEW,
    PAGERDUTY,
    OPSGENIE,
    SERVICENOW,
    ...ALERTING_PAGES,
    ...ISSUE_PAGES,
    ...CHAT_STEP_PAGES,
  ])(
    "%s names each block by the identifier the Builder gives it: its step's id, then -1",
    (page: string) => {
      const ids: Set<string> = stepIds();
      const blocks: Array<string> = Array.from(
        new Set(
          Array.from(englishPage(page).matchAll(BLOCK_REFERENCE)).map(
            (match: RegExpMatchArray): string => {
              return match[1] as string;
            },
          ),
        ),
      );

      expect(blocks.length).toBeGreaterThan(0);

      for (const block of blocks) {
        const step: string | undefined = block.match(FIRST_BLOCK)?.[1];

        expect({
          block,
          isFirstOfAStep: Boolean(step && ids.has(step)),
        }).toEqual({
          block,
          isFirstOfAStep: true,
        });
      }
    },
  );

  it("an API block's Request Headers are folded under More fields and hidden in run logs, as the pages say", () => {
    const post: ComponentMetadata = (
      Components as Array<ComponentMetadata>
    ).find((component: ComponentMetadata): boolean => {
      return component.id === ComponentID.ApiPost;
    }) as ComponentMetadata;
    const headers: Argument = (post.arguments as Array<Argument>).find(
      (argument: Argument): boolean => {
        return argument.id === "request-headers";
      },
    ) as Argument;

    expect(headers.name).toBe("Request Headers");
    expect(headers.isAdvanced).toBe(true);
    expect(headers.isSensitive).toBe(true);

    for (const page of [OPSGENIE, SERVICENOW]) {
      expect(englishPage(page)).toContain(
        `Under ${bold("More fields")}, set its ${bold("Request Headers")} to:`,
      );
    }
  });

  it("an API block sends JSON on its own, so the PagerDuty body needs no Content-Type", () => {
    expect(readRepoFile("Common/Utils/API.ts")).toContain(
      '"Content-Type": "application/json;charset=UTF-8"',
    );
    expect(englishPage(PAGERDUTY)).toContain(
      "The block sends JSON, so it needs no `Content-Type` header.",
    );
  });

  it("a Run Custom JavaScript block hands on what it returns as returnValue", () => {
    const javascript: ComponentMetadata = (
      Components as Array<ComponentMetadata>
    ).find((component: ComponentMetadata): boolean => {
      return component.id === ComponentID.JavaScriptCode;
    }) as ComponentMetadata;

    expect(javascript.title).toBe("Run Custom JavaScript");
    expect(
      (javascript.returnValues as Array<ReturnValue>).map(
        (value: ReturnValue): string => {
          return value.id;
        },
      ),
    ).toContain("returnValue");

    for (const page of [PAGERDUTY, OPSGENIE]) {
      expect(englishPage(page)).toContain(
        "{{local.components.javascript-1.returnValues.returnValue.",
      );
    }
  });

  it("the waiting step is Sleep: there is no Delay step", () => {
    const titles: Array<string> = (Components as Array<ComponentMetadata>).map(
      (component: ComponentMetadata): string => {
        return component.title;
      },
    );

    expect(titles).toContain("Sleep");
    expect(titles).not.toContain("Delay");

    for (const entry of INTEGRATIONS_PAGES) {
      expect(englishPage(entry.page)).not.toContain(bold("Delay"));
    }
  });

  it("a workflow's webhook URL is the workflow service's /trigger/ and the key, and takes POST", () => {
    expect(
      getWebhookTriggerUrl({
        workflowServiceUrl: "https://oneuptime.com/workflow",
        secretKey: "KEY",
      }),
    ).toBe("https://oneuptime.com/workflow/trigger/KEY");
    expect(WEBHOOK_TRIGGER_HTTP_METHODS).toContain("POST");

    for (const page of [JIRA, DYNAMICS]) {
      expect(englishPage(page)).toContain(
        "https://oneuptime.com/workflow/trigger/<webhook secret key>",
      );
    }
  });

  it("an Update step merges the custom fields it writes, so no page says it replaces them all", () => {
    expect(
      readRepoFile(
        "Common/Server/Types/Workflow/Components/BaseModel/CustomFieldsArgument.ts",
      ),
    ).toContain("So the Update steps merge");

    for (const entry of INTEGRATIONS_PAGES) {
      expect(englishPage(entry.page)).not.toMatch(REPLACES_CUSTOM_FIELDS);
    }
  });

  it("a URL is sent as written, which is why the pages post JQL and encode a $filter's spaces", () => {
    expect(readRepoFile("Common/Types/API/URL.ts")).toContain(
      "Values go back out verbatim",
    );
    expect(englishPage(JIRA)).toContain(
      "a URL is sent exactly as written, not encoded for you",
    );
    expect(englishPage(DYNAMICS)).toContain(
      "The URL is sent exactly as written, so the spaces in `$filter` are written as `%20`.",
    );
    expect(englishPage(DYNAMICS)).toContain(
      "$filter=new_oneuptimelink%20eq%20'oneuptime-incident-",
    );
  });
});

describe("Integrations Overview", () => {
  const page: string = englishPage(OVERVIEW);

  // Every row of the catalog's tables that opens a docs page, as its target.
  function catalogTargets(): Array<string> {
    return scanMarkdown(englishSection(OVERVIEW, "## Catalog")).links.map(
      (link: { target: string }): string => {
        return link.target;
      },
    );
  }

  function integrationsGroup(): NavGroup {
    return DocsNav.find((group: NavGroup): boolean => {
      return group.title === "Integrations";
    }) as NavGroup;
  }

  it("lists every page of the Integrations nav group once, besides itself", () => {
    const targets: Array<string> = catalogTargets();
    const navPages: Array<string> = integrationsGroup()
      .links.map((link: NavLink): string => {
        return link.url;
      })
      .filter((url: string): boolean => {
        return url !== `/docs/${OVERVIEW}`;
      });

    for (const url of navPages) {
      expect({
        url,
        times: targets.filter((target: string): boolean => {
          return target === url;
        }).length,
      }).toEqual({ url, times: 1 });
    }

    // And the chat tools that are not integration pages.
    expect(targets).toEqual(
      expect.arrayContaining([
        "/docs/workspace-connections/slack",
        "/docs/workspace-connections/microsoft-teams",
        "/docs/workflows/components#mattermost",
      ]),
    );
  });

  it("lists every Security Events connection under Security tools, by its own name, in the nav's order", () => {
    const rows: Array<Array<string>> = tableWithHeader(
      englishSection(OVERVIEW, "### Security tools"),
      "Tool",
    );
    const connections: Array<string> = rows
      .map((row: Array<string>): string => {
        return row[0] as string;
      })
      .filter((cell: string): boolean => {
        return !cell.includes("/docs/integrations/huntress");
      });
    const catalog: Array<string> = AllSecurityEventConnectorProviders.map(
      (provider: SecurityEventConnectorProvider): string => {
        const definition: SecurityEventConnectorDefinition =
          SecurityEventConnectorCatalog.find(
            (candidate: SecurityEventConnectorDefinition): boolean => {
              return candidate.provider === provider;
            },
          ) as SecurityEventConnectorDefinition;

        return `[${definition.title}](${definition.docsPath})`;
      },
    );
    const navOrder: Array<string> = integrationsGroup().links.map(
      (link: NavLink): string => {
        return link.url;
      },
    );

    expect([...connections].sort()).toEqual([...catalog].sort());

    /*
     * A tool OneUptime also sends to - a SIEM of Send to your SIEM, the same
     * product value as its connection - works both ways; the rest only
     * bring their records in.
     */
    const sentTo: Array<string> = AllSecurityEventDestinationProviders.map(
      (provider: string): string => {
        const definition: SecurityEventConnectorDefinition =
          SecurityEventConnectorCatalog.find(
            (candidate: SecurityEventConnectorDefinition): boolean => {
              return candidate.provider === (provider as string);
            },
          ) as SecurityEventConnectorDefinition;

        return `[${definition.title}](${definition.docsPath})`;
      },
    );

    expect(sentTo).toHaveLength(4);
    for (const row of rows) {
      expect({ tool: row[0], direction: row[1] }).toEqual({
        tool: row[0],
        direction: sentTo.includes(row[0] as string) ? "Both" : "Inbound",
      });

      if (sentTo.includes(row[0] as string)) {
        expect(row[2]).toContain("send it what OneUptime finds");
      }
    }

    const urls: Array<string> = connections.map((cell: string): string => {
      return cell.slice(cell.indexOf("(") + 1, -1);
    });

    expect(urls).toEqual(
      [...urls].sort((a: string, b: string): number => {
        return navOrder.indexOf(a) - navOrder.indexOf(b);
      }),
    );
  });

  it("sends a team moving over to every tool's guide, in the order the import page lists them, on-call tools first", () => {
    const section: string = englishSection(
      OVERVIEW,
      "## Moving from another tool",
    );
    const onCall: string = lineStartingWith(
      section,
      "- On-call and incident tools:",
    );
    const monitoring: string = lineStartingWith(
      section,
      "- Uptime and status page tools:",
    );
    const linked: (line: string) => Array<string> = (
      line: string,
    ): Array<string> => {
      return scanMarkdown(line).links.map((link: { target: string }) => {
        return link.target;
      });
    };
    const guides: (category: ToolImportCategory) => Array<string> = (
      category: ToolImportCategory,
    ): Array<string> => {
      return AllToolImportSources.filter((source: ToolImportSource) => {
        return ToolImportCatalog[source].category === category;
      }).map((source: ToolImportSource): string => {
        return ToolImportCatalog[source].docsPath;
      });
    };

    expect(linked(onCall)).toEqual(guides(ToolImportCategory.OnCall));
    expect(linked(monitoring)).toEqual(guides(ToolImportCategory.Monitoring));

    /*
     * The page they open: Project Settings > Advanced > Import from another
     * tool, the last entry of the folded Advanced section.
     */
    const settingsMenu: string = dashboardSource("Pages/Settings/SideMenu.tsx");
    const advancedAt: number = settingsMenu.indexOf('title: "Advanced"');
    const securityAt: number = settingsMenu.indexOf('title: "Security"');

    expect(advancedAt).toBeGreaterThan(-1);
    expect(securityAt).toBeGreaterThan(advancedAt);
    expect(settingsMenu.slice(advancedAt, securityAt)).toContain(
      'title: "Import from another tool"',
    );
    expect(section).toContain(
      bold("Project Settings → Advanced → Import from another tool"),
    );
    expect(section).not.toContain(
      bold("Project Settings → Import from another tool"),
    );
  });

  it("writes Opsgenie's header as the import does: GenieKey and the key", () => {
    expect(
      ToolImportCatalog[ToolImportSource.OpsGenie].authorizationScheme,
    ).toBe("GenieKey");
    expect(
      rowStartingWith(
        tableWithHeader(
          englishSection(OVERVIEW, "### Authentication cheat sheet"),
          "Scheme",
        ),
        "API key header",
      )[1],
    ).toBe("`Authorization: GenieKey {{global.variables.OPSGENIE_KEY}}`");
  });

  it("saves a key as the variables page creates one: Name, Next, Content, Secret, and a secret is redacted from runs", () => {
    const variableForm: string = dashboardSource(
      "Utils/Workflow/WorkflowVariableUtil.ts",
    );
    const steps: string = englishSection(OVERVIEW, "## Keep credentials safe");

    expect(variableForm).toContain('title: "Content"');
    expect(variableForm).toContain('title: "Secret"');
    expect(variableForm).toContain('title: "Value"');
    expect(variableForm).toContain(
      "Replace this value with [REDACTED] in future workflow run logs.",
    );
    expect(steps).toContain(
      `Paste the key into ${bold("Content")}, turn on ${bold("Secret")}, and click ${bold("Create Workflow Variable")}.`,
    );
    expect(steps).toContain("replaced with `[REDACTED]` in run logs");
    expect(page).toContain(bold("Workflows → Global Variables"));
  });
});

describe("Zabbix", () => {
  const page: string = englishPage(ZABBIX);

  // The JavaScript of the media type, as the page gives it.
  function mediaTypeScript(): string {
    const fence: { lang: string; code: string } | undefined = scanMarkdown(
      page,
    ).fences.find((candidate: { lang: string }): boolean => {
      return candidate.lang === "javascript";
    });

    if (!fence) {
      throw new Error("The Zabbix page has no media type script");
    }

    return fence.code;
  }

  /*
   * The parameters the page tells Zabbix to send, and their macros: the
   * rows of the table inside the media type's step, as [name, macro].
   */
  function parameters(): Array<Array<string>> {
    return englishSection(ZABBIX, "## Configure Zabbix")
      .split("\n")
      .map((line: string): RegExpMatchArray | null => {
        return line.match(PARAMETER_ROW);
      })
      .filter((match: RegExpMatchArray | null): match is RegExpMatchArray => {
        return match !== null;
      })
      .map((match: RegExpMatchArray): Array<string> => {
        return [match[1] as string, match[2] as string];
      });
  }

  /*
   * What the media type posts for an event, run as Zabbix runs it: the
   * script is a function of `value`, the parameters as JSON, with an
   * HttpRequest object that sends the body.
   */
  function postedFor(values: Record<string, string>): {
    url: string;
    headers: Array<string>;
    body: JSONObject;
    returned: unknown;
  } {
    const sent: { url: string; headers: Array<string>; body: string } = {
      url: "",
      headers: [],
      body: "",
    };

    class HttpRequest {
      public addHeader(header: string): void {
        sent.headers.push(header);
      }

      public post(url: string, body: string): string {
        sent.url = url;
        sent.body = body;
        return "{}";
      }

      public getStatus(): number {
        return 200;
      }
    }

    const returned: unknown = vm.runInNewContext(
      `(function (value) {\n${mediaTypeScript()}\n})(parameters)`,
      { HttpRequest, parameters: JSON.stringify(values) },
    );

    return {
      url: sent.url,
      headers: sent.headers,
      body: JSON.parse(sent.body) as JSONObject,
      returned,
    };
  }

  function zabbixEvent(eventValue: string): Record<string, string> {
    return zabbixMacroValues({
      kind:
        eventValue === "0" ? ZabbixEventKind.Recovery : ZabbixEventKind.Problem,
    });
  }

  // The grouping settings the page's table gives the criteria.
  function groupingSettings(): { group: string; field: string; value: string } {
    const rows: Array<Array<string>> = tableWithHeader(
      englishSection(ZABBIX, "## Receive problems with a monitor"),
      "Field",
    );
    const code: (label: string) => string = (label: string): string => {
      return (codeIn(rowStartingWith(rows, bold(label))[1] as string)[0] ||
        "") as string;
    };

    return {
      group: code("Open a separate incident for each…"),
      field: code("Field that signals recovery"),
      value: code("Value that means recovered"),
    };
  }

  const ZABBIX_TEMPLATES: Array<WorkflowTemplate> =
    getWorkflowTemplatesByCategory(WorkflowTemplateCategory.Zabbix);

  function zabbixTemplate(templateId: string): WorkflowTemplate {
    const found: WorkflowTemplate | undefined = ZABBIX_TEMPLATES.find(
      (candidate: WorkflowTemplate): boolean => {
        return candidate.id === templateId;
      },
    );

    if (!found) {
      throw new Error(`No Zabbix template ${templateId}`);
    }

    return found;
  }

  const PROBLEM_TEMPLATE: WorkflowTemplate = zabbixTemplate(
    "zabbix-declare-incident-from-problem",
  );
  const STATE_TEMPLATE: WorkflowTemplate = zabbixTemplate(
    "zabbix-update-problem-on-incident-state",
  );
  const NOTE_TEMPLATE: WorkflowTemplate = zabbixTemplate(
    "zabbix-message-from-incident-private-note",
  );

  it("sends every parameter the script reads, each from a Zabbix macro", () => {
    const names: Array<string> = parameters().map((row: Array<string>) => {
      return row[0] as string;
    });
    const read: Array<string> = Array.from(
      new Set(
        Array.from(mediaTypeScript().matchAll(SCRIPT_PARAMETER)).map(
          (match: RegExpMatchArray): string => {
            return match[1] as string;
          },
        ),
      ),
    );

    expect(names).toHaveLength(16);
    expect([...names].sort()).toEqual([...read].sort());
    expect(parameters()).toEqual([
      ["url", "{ALERT.SENDTO}"],
      ["event_id", "{EVENT.ID}"],
      ["event_name", "{EVENT.NAME}"],
      ["event_value", "{EVENT.VALUE}"],
      ["event_severity", "{EVENT.SEVERITY}"],
      ["event_nseverity", "{EVENT.NSEVERITY}"],
      ["host", "{HOST.NAME}"],
      ["event_date", "{EVENT.DATE}"],
      ["event_time", "{EVENT.TIME}"],
      ["event_opdata", "{EVENT.OPDATA}"],
      ["event_tags", "{EVENT.TAGSJSON}"],
      ["trigger_id", "{TRIGGER.ID}"],
      ["event_update_status", "{EVENT.UPDATE.STATUS}"],
      ["event_update_action", "{EVENT.UPDATE.ACTION}"],
      ["event_update_message", "{EVENT.UPDATE.MESSAGE}"],
      ["event_update_user", "{USER.FULLNAME}"],
    ]);
  });

  /*
   * The templates are tested on what this media type posts
   * (ZabbixTemplateFixtures.zabbixPostedBody): the page's own script, given
   * what Zabbix fills its parameters with for each kind of event, posts
   * exactly that.
   */
  it.each([
    ZabbixEventKind.Problem,
    ZabbixEventKind.Recovery,
    ZabbixEventKind.Update,
  ])(
    "posts a %s as JSON to the URL a user's media sends to, exactly as the templates are tested on, and says OK",
    (kind: ZabbixEventKind) => {
      const values: Record<string, string> = zabbixMacroValues({ kind });
      const posted: ReturnType<typeof postedFor> = postedFor(values);

      expect(posted.url).toBe(values["url"]);
      expect(posted.headers).toEqual(["Content-Type: application/json"]);
      expect(posted.returned).toBe("OK");
      expect(posted.body).toEqual(zabbixPostedBody({ kind }));
    },
  );

  it("sends a macro Zabbix left as written as nothing, and tags Zabbix could not read as none", () => {
    const posted: JSONObject = postedFor({
      ...zabbixMacroValues({ kind: ZabbixEventKind.Problem }),
      event_opdata: "{EVENT.OPDATA}",
      event_tags: "*UNKNOWN*",
    }).body;

    expect(posted["opdata"]).toBe("");
    expect(posted["tags"]).toEqual([]);
    expect(posted["update"]).toBeUndefined();
  });

  it.each([
    ZabbixEventKind.Problem,
    ZabbixEventKind.Recovery,
    ZabbixEventKind.Update,
  ])(
    "what it posts for a %s is read by the template Zabbix sends its problems to as that event",
    async (kind: ZabbixEventKind) => {
      const read: JSONObject = await runZabbixScript({
        templateId: PROBLEM_TEMPLATE.id,
        componentId: "read-event-1",
        args: {
          severities: quoted(INCIDENT.severities),
          zabbixUrl: ZABBIX_URL,
          payload: quoted(postedFor(zabbixMacroValues({ kind })).body),
        },
      });

      expect(read["kind"]).toBe(kind);
      expect(read["eventId"]).toBe(zabbixMacroValues()["event_id"]);
    },
  );

  it("the request the troubleshooting sends by hand is read as a problem", async () => {
    const curl: string = lineStartingWith(
      englishSection(ZABBIX, "## Troubleshooting"),
      "- From the Zabbix server, send a request yourself:",
    );
    const body: string = (curl.split(" -d '")[1] as string).split(
      "'`",
    )[0] as string;
    const read: JSONObject = await runZabbixScript({
      templateId: PROBLEM_TEMPLATE.id,
      componentId: "read-event-1",
      args: {
        severities: quoted(INCIDENT.severities),
        zabbixUrl: ZABBIX_URL,
        payload: quoted(JSON.parse(body) as JSONObject),
      },
    });

    expect(read["kind"]).toBe("problem");
    expect(read["severityNumber"]).toBe(4);
  });

  it('matches the criteria\'s filters as the page writes them: "status":"1" for a problem, "status":"0" for its recovery', () => {
    /*
     * The monitor compares an object body as compact JSON, which is what
     * the script sends.
     */
    const problem: string = JSON.stringify(postedFor(zabbixEvent("1")).body);
    const recovery: string = JSON.stringify(postedFor(zabbixEvent("0")).body);
    const update: string = JSON.stringify(
      postedFor(zabbixMacroValues({ kind: ZabbixEventKind.Update })).body,
    );

    expect(problem).toContain('"status":"1"');
    expect(problem).not.toContain('"status":"0"');
    expect(recovery).toContain('"status":"0"');
    expect(recovery).not.toContain('"status":"1"');
    // An update is the problem again, to the monitor, as the page says.
    expect(update).toContain('"status":"1"');
    expect(page).toContain(
      'An update made in Zabbix is sent with `"status":"1"` too',
    );
    expect(page).toContain(
      `Set its filter to ${bold("Request Body")}, ${bold("Contains")}, \`"status":"1"\`.`,
    );
    expect(page).toContain(
      `set its filter to ${bold("Request Body")}, ${bold("Contains")}, \`"status":"0"\`.`,
    );
  });

  it("with the page's grouping settings, opens one incident per problem and resolves that incident on its recovery", () => {
    const settings: { group: string; field: string; value: string } =
      groupingSettings();
    const grouping: {
      groupByJSONPath: string;
      resolvedWhenJSONPath: string;
      resolvedWhenValue: string;
    } = {
      groupByJSONPath: settings.group,
      resolvedWhenJSONPath: settings.field,
      resolvedWhenValue: settings.value,
    };
    const problem: ReturnType<
      typeof IncomingRequestIncidentGrouping.extractItems
    > = IncomingRequestIncidentGrouping.extractItems({
      requestBody: postedFor(zabbixEvent("1")).body,
      grouping: grouping,
    });
    const recovery: ReturnType<
      typeof IncomingRequestIncidentGrouping.extractItems
    > = IncomingRequestIncidentGrouping.extractItems({
      requestBody: postedFor(zabbixEvent("0")).body,
      grouping: grouping,
    });
    const another: ReturnType<
      typeof IncomingRequestIncidentGrouping.extractItems
    > = IncomingRequestIncidentGrouping.extractItems({
      requestBody: postedFor({ ...zabbixEvent("1"), event_id: "67890" }).body,
      grouping: grouping,
    });

    expect(settings).toEqual({
      group: "requestBody.event_id",
      field: "requestBody.status",
      value: "0",
    });
    expect(problem).toHaveLength(1);
    expect(problem[0]?.isResolved).toBe(false);
    expect(problem[0]?.keyValue).toBe("12345");
    expect(recovery).toHaveLength(1);
    expect(recovery[0]?.isResolved).toBe(true);
    expect(recovery[0]?.fingerprint).toBe(problem[0]?.fingerprint);
    // Another problem is another incident.
    expect(another[0]?.fingerprint).not.toBe(problem[0]?.fingerprint);
  });

  it("starts from the monitor's default criteria: the first marks it offline and declares an incident that resolves itself, the second marks it online", () => {
    const criteria: MonitorCriteria = MonitorCriteria.getDefaultMonitorCriteria(
      {
        monitorType: MonitorType.IncomingRequest,
        monitorName: "Zabbix",
        onlineMonitorStatusId: ObjectID.generate(),
        offlineMonitorStatusId: ObjectID.generate(),
        defaultIncidentSeverityId: ObjectID.generate(),
        defaultAlertSeverityId: ObjectID.generate(),
      },
    );
    const instances: Array<{ data?: JSONObject | undefined }> = criteria.data
      ?.monitorCriteriaInstanceArray as unknown as Array<{
      data?: JSONObject | undefined;
    }>;
    const offline: JSONObject = instances[0]?.data as JSONObject;
    const online: JSONObject = instances[1]?.data as JSONObject;

    expect(instances).toHaveLength(2);
    expect(offline["createIncidents"]).toBe(true);
    expect(
      ((offline["incidents"] as Array<JSONObject>)[0] as JSONObject)[
        "autoResolveIncident"
      ],
    ).toBe(true);
    expect((offline["filters"] as Array<JSONObject>)[0]).toEqual(
      expect.objectContaining({
        checkOn: CheckOn.RequestBody,
        filterType: FilterType.Contains,
      }),
    );
    expect(online["createIncidents"]).toBe(false);
    expect((online["filters"] as Array<JSONObject>)[0]).toEqual(
      expect.objectContaining({ checkOn: CheckOn.RequestBody }),
    );

    expect(page).toContain(
      "open the first criteria, the one that marks the monitor offline",
    );
    expect(page).toContain(
      "Open the second criteria, the one that marks the monitor online",
    );
    expect(page).toContain(
      `${bold("Auto Resolve Incident")}, under ${bold("More fields")}: leave it on, as it starts.`,
    );
  });

  it("names the criteria's grouping settings as the form draws them", () => {
    const form: string = dashboardSource(
      "Components/Form/Monitor/MonitorCriteriaInstance.tsx",
    );

    for (const label of [
      "Group incidents and alerts by a payload field",
      "Open a separate incident for each…",
      "Field that signals recovery",
      "Value that means recovered",
    ]) {
      expect(form).toContain(label);
      expect(page).toContain(bold(label));
    }
  });

  it("names the incident's fields as the criteria's incident form draws them", () => {
    const form: string = dashboardSource(
      "Components/Form/Monitor/MonitorCriteriaIncidentForm.tsx",
    );

    for (const label of [
      "Incident Title",
      "Severity",
      "On-Call Policies",
      "Auto Resolve Incident",
    ]) {
      expect(form).toContain(`title="${label}"`);
    }

    expect(form).toContain('title="On-Call"');
  });

  /* ------------------------------ The templates ------------------------------ */

  // The template table's rows, under their part's heading: [part, name, asks for].
  function templateRows(): Array<[string, string, string]> {
    const rows: Array<Array<string>> = tableWithHeader(
      englishSection(ZABBIX, "## Start from the templates"),
      "Template",
    );
    const listed: Array<[string, string, string]> = [];
    let part: string = "";

    for (const row of rows) {
      const first: string = row[0] as string;

      if (first.startsWith("**")) {
        part = first.slice(2, -2);
        continue;
      }

      listed.push([part, first, row[2] as string]);
    }

    return listed;
  }

  it("lists the six templates under Zabbix, by name, in the picker's order and parts, with the settings each asks for", () => {
    expect(templateRows()).toEqual(
      ZABBIX_TEMPLATES.map(
        (template: WorkflowTemplate): [string, string, string] => {
          return [
            template.subcategory || "",
            template.name,
            template.variables
              .map((variable: WorkflowTemplateVariable): string => {
                return variable.title;
              })
              .join(", "),
          ];
        },
      ),
    );
    expect(page).toContain(
      `The ${bold("Create a workflow")} dialog has six Zabbix templates, under ${bold("Zabbix")} in its category list: three for incidents, then the same three for alerts.`,
    );
    expect(
      getWorkflowTemplateCategoryInfo(WorkflowTemplateCategory.Zabbix).label,
    ).toBe("Zabbix");
  });

  it("names each setting by the wizard's title for it, and says the token is the secret, sent only in its header", () => {
    const settings: string = englishSection(
      ZABBIX,
      "### What the templates ask for",
    );
    const titles: Array<string> = STATE_TEMPLATE.variables.map(
      (variable: WorkflowTemplateVariable): string => {
        return variable.title;
      },
    );

    expect(titles).toEqual(["Zabbix URL", "Zabbix API Token"]);

    for (const title of titles) {
      expect(settings).toContain(`- ${bold(title)}: `);
    }

    expect(
      STATE_TEMPLATE.variables.map(
        (variable: WorkflowTemplateVariable): boolean => {
          return variable.isSecret;
        },
      ),
    ).toEqual([false, true]);
    expect(settings).toContain(
      "It is saved as a secret variable, and sent only to Zabbix: in the `Authorization` header, or in the request's body on Zabbix 6.0.",
    );

    // The templates hand it to Update Zabbix Problem, which sends it as a Bearer token, or in the body on Zabbix 6.0.
    for (const template of [STATE_TEMPLATE, NOTE_TEMPLATE]) {
      const update: TemplateNode = nodeOf(template, "update-problem-1");

      expect(update.metadataId).toBe(ComponentID.ZabbixUpdateProblem);
      expect(update.args?.[ZABBIX_UPDATE_ARGUMENT_IDS.apiToken]).toBe(
        "{{local.variables.zabbixApiToken}}",
      );
      expect(argumentsText(template).split("zabbixApiToken")).toHaveLength(2);
    }

    expect(
      readRepoFile("Common/Server/Types/Workflow/Components/Zabbix/UpdateProblem.ts"),
    ).toContain("{ Authorization: `Bearer ${data.token}` }");
  });

  it("the examples of a Zabbix URL are ones the wizard takes, and a page in Zabbix is one it refuses", () => {
    const settings: string = englishSection(
      ZABBIX,
      "### What the templates ask for",
    );
    const url: string = lineStartingWith(settings, `- ${bold("Zabbix URL")}`);

    for (const example of codeIn(url).filter((code: string): boolean => {
      return code.startsWith("https://");
    })) {
      expect({ example, taken: ZABBIX_URL_PATTERN.test(example) }).toEqual({
        example,
        taken: true,
      });
    }

    expect(codeIn(url)).toContain("api_jsonrpc.php");
    expect(
      nodeOf(STATE_TEMPLATE, "update-problem-1").args?.[
        ZABBIX_UPDATE_ARGUMENT_IDS.zabbixUrl
      ],
    ).toBe("{{local.variables.zabbixUrl}}");
    expect(getZabbixApiUrl("https://example.com/zabbix/")).toBe(
      "https://example.com/zabbix/api_jsonrpc.php",
    );
    expect(
      ZABBIX_URL_PATTERN.test("https://zabbix.example.com/zabbix.php"),
    ).toBe(false);
    expect(url).toContain("The field refuses the address of a page in Zabbix.");
  });

  it("names the custom field the record keeps the event ID in", () => {
    expect(page).toContain(
      `in its custom field \`${ZABBIX_EVENT_ID_CUSTOM_FIELD}\``,
    );
  });

  it("names the steps the reader opens by the template's own ids", () => {
    for (const componentId of ["read-event-1", "if-page-1"]) {
      expect(page).toContain(`\`${componentId}\``);
      expect(() => {
        return nodeOf(PROBLEM_TEMPLATE, componentId);
      }).not.toThrow();
    }

    expect(codeOf(PROBLEM_TEMPLATE, "read-event-1")).toContain(
      "const SEVERITY_BY_NAME = {};",
    );
    expect(page).toContain(
      "edit `SEVERITY_BY_NAME` in the `read-event-1` step",
    );
  });

  it("pages for High and Disaster: the If / Else in front of the Page step compares the Zabbix severity with 4, and Average is 3", () => {
    const condition: JSONObject = nodeOf(PROBLEM_TEMPLATE, "if-page-1")
      .args as JSONObject;

    expect(condition["operator"]).toBe(">=");
    expect(condition["input-2"]).toBe(String(ZABBIX_PAGE_FROM_SEVERITY));
    expect(ZABBIX_SEVERITY_NAMES[ZABBIX_PAGE_FROM_SEVERITY]).toBe("High");
    expect(ZABBIX_SEVERITY_NAMES.indexOf("Average")).toBe(3);
    expect(page).toContain(
      `To page for Average problems too, set ${bold("Compare with")} of the \`if-page-1\` ${bold("If / Else")} step to \`3\`.`,
    );
  });

  /*
   * The severity table, as the template maps a new project's severities:
   * the page's rows are run through the template's own script.
   */
  it("maps each Zabbix severity as the severity table says, for a new project's incident and alert severities, and pages as it says", async () => {
    const rows: Array<Array<string>> = tableWithHeader(
      englishSection(ZABBIX, "### Severities"),
      "Zabbix severity",
    );

    expect(
      rows.map((row: Array<string>): string => {
        return row[0] as string;
      }),
    ).toEqual([...ZABBIX_SEVERITY_NAMES].reverse());

    for (const row of rows) {
      const severityNumber: number = ZABBIX_SEVERITY_NAMES.indexOf(
        row[0] as string,
      );
      const mapped: Array<string> = [];

      for (const kind of [INCIDENT, ALERT]) {
        const read: JSONObject = await runZabbixScript({
          templateId: kind.problemTemplateId,
          componentId: "read-event-1",
          args: {
            zabbixUrl: ZABBIX_URL,
            payload: quoted(zabbixPostedBody({ severityNumber })),
          },
        });
        // The project's severities, most severe first, as the step reads them.
        const severities: Array<{ id: string; name: string }> = [
          ...kind.severities,
        ]
          .sort((a: JSONObject, b: JSONObject): number => {
            return Number(a["order"]) - Number(b["order"]);
          })
          .map((severity: JSONObject): { id: string; name: string } => {
            return {
              id: String(severity["_id"]),
              name: String(severity["name"]),
            };
          });

        mapped.push(
          (
            severities[
              pickSeverityIndex({
                given: String(read["severity"]),
                severities: severities,
              }).index
            ] as { name: string }
          ).name,
        );
      }

      expect({
        zabbix: row[0],
        incident: mapped[0],
        alert: mapped[1],
        pages:
          severityNumber >= ZABBIX_PAGE_FROM_SEVERITY ? "Paged" : "Not paged",
      }).toEqual({
        zabbix: row[0],
        incident: row[1],
        alert: row[2],
        pages: row[3],
      });
    }
  });

  it("says what each event does, by the events read-event-1 reads, and what Incident From Another Tool does with them", () => {
    const rows: Array<Array<string>> = tableWithHeader(
      englishSection(ZABBIX, "### What the workflow does"),
      "Event",
    );
    const read: TemplateNode = nodeOf(PROBLEM_TEMPLATE, "read-event-1");

    expect(read.metadataId).toBe(ComponentID.JavaScriptCheck);
    expect(codeOf(PROBLEM_TEMPLATE, "read-event-1")).toContain(
      `const KINDS = ${JSON.stringify([
        ZabbixEventKind.Problem,
        ZabbixEventKind.Recovery,
        ZabbixEventKind.Update,
      ])};`,
    );
    expect(
      rows.map((row: Array<string>): string => {
        return row[0] as string;
      }),
    ).toEqual(
      [
        ZabbixEventKind.Problem,
        ZabbixEventKind.Recovery,
        ZabbixEventKind.Update,
      ].map((kind: string): string => {
        return `\`${kind}\``;
      }),
    );
    expect(rows[0]?.[1]).toContain("titled `Zabbix: <problem> on <host>`");
    expect(nodeOf(PROBLEM_TEMPLATE, "incident-from-another-tool-1").metadataId).toBe(
      ComponentID.IncidentFromAnotherTool,
    );
    expect(page).toContain(
      `the \`read-event-1\` ${bold("Check With JavaScript")} step reads the \`event\` the media type sends, and ${bold("Incident From Another Tool")}, or ${bold("Alert From Another Tool")} in the alert template, does what it means`,
    );
  });

  it("says why Zabbix refuses, in the words Update Zabbix Problem's Steps entry shows", () => {
    const choice: ReturnType<typeof chooseZabbixUpdate> = chooseZabbixUpdate({
      wanted: ZabbixProblemUpdate.Close,
      eventId: "40312",
      message: "",
      events: [],
    });

    expect(choice.send).toBe(false);
    expect(choice.send === false && choice.reason).toContain(
      "Zabbix has no problem with event ID 40312",
    );
    expect(page).toContain(
      "- `Zabbix has no problem with event ID`: the user cannot see the problem's host.",
    );
    // What the step adds when a trigger refuses a close.
    expect(ZABBIX_CANNOT_CLOSE_SENTENCE).toContain(
      "does not allow closing problems by hand",
    );
  });

  it("tells Zabbix 6.0 where its token goes: the Update Zabbix Problem step's Zabbix 6.0 switch, under More fields", () => {
    const step: ComponentMetadata = (Components as Array<ComponentMetadata>).find(
      (component: ComponentMetadata): boolean => {
        return component.id === ComponentID.ZabbixUpdateProblem;
      },
    ) as ComponentMetadata;
    const setting: Argument | undefined = (step.arguments as Array<Argument>).find(
      (argument: Argument): boolean => {
        return argument.id === ZABBIX_UPDATE_ARGUMENT_IDS.zabbix60;
      },
    );

    expect(step.title).toBe("Update Zabbix Problem");
    expect(setting?.name).toBe("Zabbix 6.0");
    expect(setting?.isAdvanced).toBe(true);
    // The token goes in right after jsonrpc, as Zabbix 6.0 reads it.
    expect(
      Object.keys(getZabbixRequestBody("event.get", {}, "token")).slice(0, 2),
    ).toEqual(["jsonrpc", "auth"]);
    expect(Object.keys(getZabbixRequestBody("event.get", {}))).not.toContain(
      "auth",
    );

    // Every template that calls Zabbix does it through that step.
    for (const template of ZABBIX_TEMPLATES) {
      for (const node of nodesOf(template)) {
        expect(node.metadataId).not.toBe(ComponentID.ApiPost);
      }
    }

    expect(page).toContain(
      `In the ${bold("Update Zabbix Problem")} step of each template that calls Zabbix, turn on ${bold("Zabbix 6.0")}, under ${bold("More fields")}.`,
    );
  });

  it("says a workflow that is off answers 400, as the webhook route does", () => {
    expect(
      readRepoFile("App/FeatureSet/Workflow/Services/QueueWorkflow.ts"),
    ).toContain("throw new BadDataException(WORKFLOW_TURNED_OFF_MESSAGE)");
    expect(page).toContain("A workflow that is off answers Zabbix with `400`.");
  });

  it("leaves a reference to a missing field as written, never empty", () => {
    expect(page).toContain(
      "A reference to a field the request does not have is left as written, braces and all, rather than being emptied.",
    );
  });

  it("no longer says a workflow cannot resolve an incident on recovery", () => {
    expect(page).not.toContain("does not resolve the incident on recovery");
    expect(page).not.toContain(
      "To resolve incidents on recovery, use the monitor",
    );
    expect(page).not.toContain(
      "A workflow does not resolve incidents on recovery",
    );
  });
});

describe("PagerDuty, Opsgenie and ServiceNow", () => {
  const OUTBOUND: Array<string> = [PAGERDUTY, OPSGENIE, SERVICENOW];

  // The page's JavaScript Code for a severity map, run with a severity.
  function mapped(page: string, severity: string): JSONObject {
    const fence: { lang: string; code: string } | undefined = scanMarkdown(
      englishPage(page),
    ).fences.find((candidate: { lang: string }): boolean => {
      return candidate.lang === "javascript";
    });

    if (!fence) {
      throw new Error(`${page} has no JavaScript Code`);
    }

    return vm.runInNewContext(`(function (args) {\n${fence.code}\n})(input)`, {
      input: { severity },
    }) as JSONObject;
  }

  it.each(OUTBOUND)(
    "%s resolves by the state's isResolvedState, listening on the incident's current state",
    (page: string) => {
      const incident: Incident = new Incident();
      const state: IncidentState = new IncidentState();
      const onUpdate: ComponentMetadata = RecordComponents.getComponents(
        incident,
      ).find((component: ComponentMetadata): boolean => {
        return component.id === "incident-on-update";
      }) as ComponentMetadata;

      expect(
        incident.getTableColumnMetadata("currentIncidentStateId"),
      ).toBeTruthy();
      expect(state.getTableColumnMetadata("isResolvedState")).toBeTruthy();
      /*
       * The trigger's two settings, by the names the builder draws them
       * with: Fields to watch and Fields to pass on (they were Listen on
       * and Select Fields).
       */
      expect(WATCHED_FIELDS_NAME).toBe("Fields to watch");
      expect(SELECT_FIELDS_NAME).toBe("Fields to pass on");
      expect(
        (onUpdate.arguments as Array<Argument>).map((argument: Argument) => {
          return argument.name;
        }),
      ).toEqual(
        expect.arrayContaining([WATCHED_FIELDS_NAME, SELECT_FIELDS_NAME]),
      );

      const markdown: string = englishPage(page);

      /*
       * Both are built in the list the Builder draws: the state is watched
       * by its name in Add field's list, the column an update reports
       * (IntegrationsFieldListsDocs holds the fields to the real list), and
       * the JSON is given for Edit as JSON, where it goes in.
       */
      expect(markdown).toContain(
        `In ${bold(WATCHED_FIELDS_NAME)}, click ${bold("Add field")} and pick ${bold("Current Incident State")}, so it runs only when the state changes.`,
      );
      // Its other setting is named on the page too, and neither by its old name.
      expect(markdown).toContain(`In ${bold(SELECT_FIELDS_NAME)}, ask for`);
      expect(markdown).toContain(
        `open ${bold("Current Incident State")} and pick ${bold("Is Resolved State")}. Or click ${bold("Edit as JSON")} and replace the JSON with:`,
      );
      expect(markdown).not.toContain("Listen on");
      expect(markdown).not.toContain("Select Fields");
      expect(markdown).toContain(
        '{ "_id": true, "currentIncidentState": { "isResolvedState": true } }',
      );
      expect(markdown).toContain(
        "{{local.components.incident-on-update-1.returnValues.model.currentIncidentState.isResolvedState}}",
      );
      expect(markdown).toContain(`${bold("Comparison")} to ${bold("is true")}`);
    },
  );

  it.each(OUTBOUND)(
    "%s keeps the tool's key in a secret global variable, and reads it by the runtime's own reference",
    (page: string) => {
      const markdown: string = englishPage(page);

      expect(markdown).toContain(
        `turn on ${bold("Secret")}, and click ${bold("Create Workflow Variable")}`,
      );
      expect(markdown).toContain("{{global.variables.");
    },
  );

  it("PagerDuty sends one dedup_key from both workflows, so the resolve closes the incident the trigger opened", () => {
    const fences: Array<string> = scanMarkdown(englishPage(PAGERDUTY))
      .fences.filter((fence: { lang: string }): boolean => {
        return fence.lang === "json";
      })
      .map((fence: { code: string }): string => {
        return fence.code;
      });
    const trigger: JSONObject = JSON.parse(
      fences.find((code: string): boolean => {
        return code.includes('"event_action": "trigger"');
      }) as string,
    ) as JSONObject;
    const resolve: JSONObject = JSON.parse(
      fences.find((code: string): boolean => {
        return code.includes('"event_action": "resolve"');
      }) as string,
    ) as JSONObject;
    const key: (body: JSONObject) => string = (body: JSONObject): string => {
      return (body["dedup_key"] as string).replace(
        TRIGGER_REFERENCE,
        "TRIGGER",
      );
    };

    expect(key(trigger)).toBe(key(resolve));
    expect(trigger["routing_key"]).toBe(resolve["routing_key"]);
  });

  it("maps the three severities a new project starts with, by their names", () => {
    const projectService: string = readRepoFile(
      "Common/Server/Services/ProjectService.ts",
    );

    for (const name of [
      "Critical Incident",
      "Major Incident",
      "Minor Incident",
    ]) {
      expect(projectService).toContain(`"${name}"`);
    }

    expect(mapped(PAGERDUTY, "Critical Incident")).toEqual({
      severity: "critical",
    });
    expect(mapped(PAGERDUTY, "Major Incident")).toEqual({ severity: "error" });
    expect(mapped(PAGERDUTY, "Minor Incident")).toEqual({
      severity: "warning",
    });
    expect(mapped(PAGERDUTY, "Something else")).toEqual({ severity: "info" });
    expect(mapped(OPSGENIE, "Critical Incident")).toEqual({ priority: "P1" });
    expect(mapped(OPSGENIE, "Minor Incident")).toEqual({ priority: "P3" });

    for (const page of [PAGERDUTY, OPSGENIE]) {
      expect(englishPage(page)).toContain(
        "The names above are the three severities a new project starts with.",
      );
    }
  });

  it("Opsgenie closes the alert by the alias the create call gave it", () => {
    const markdown: string = englishPage(OPSGENIE);

    expect(markdown).toContain(
      '"alias": "oneuptime-{{local.components.incident-on-create-1.returnValues.model._id}}"',
    );
    expect(markdown).toContain(
      "/v2/alerts/oneuptime-{{local.components.incident-on-update-1.returnValues.model._id}}/close?identifierType=alias",
    );
    expect(markdown).toContain(
      '{ "Authorization": "GenieKey {{global.variables.OPSGENIE_KEY}}" }',
    );
  });

  it("ServiceNow finds the record by the correlation_id the create call wrote, and resolves the first match", () => {
    const markdown: string = englishPage(SERVICENOW);

    expect(markdown).toContain(
      '"correlation_id": "oneuptime-{{local.components.incident-on-create-1.returnValues.model._id}}"',
    );
    expect(markdown).toContain(
      "sysparm_query=correlation_id=oneuptime-{{local.components.incident-on-update-1.returnValues.model._id}}",
    );
    expect(markdown).toContain(
      "{{local.components.api-get-1.returnValues.response-body.result[0].sys_id}}",
    );
  });
});

describe("Jira", () => {
  const page: string = englishPage(JIRA);

  it("has 17 templates, nine for incidents then eight for alerts, as the tables list them", () => {
    const incidents: Array<WorkflowTemplate> = JIRA_TEMPLATES.filter(
      (template: WorkflowTemplate): boolean => {
        return template.subcategory === "Incidents";
      },
    );
    const alerts: Array<WorkflowTemplate> = JIRA_TEMPLATES.filter(
      (template: WorkflowTemplate): boolean => {
        return template.subcategory === "Alerts";
      },
    );

    expect(JIRA_TEMPLATES).toHaveLength(17);
    expect(incidents).toHaveLength(9);
    expect(alerts).toHaveLength(8);
    expect(page).toContain(
      `The ${bold("Create a workflow")} dialog has 17 Jira templates, under ${bold("Jira")} in its category list: nine for incidents, then eight for alerts`,
    );

    for (const [heading, templates] of [
      ["### Incident templates", incidents],
      ["### Alert templates", alerts],
    ] as Array<[string, Array<WorkflowTemplate>]>) {
      const rows: Array<{ group: string; name: string }> = templateRows(
        englishSection(JIRA, heading),
      );

      expect(
        rows.map((row: { name: string }): string => {
          return row.name;
        }),
      ).toEqual(
        templates.map((template: WorkflowTemplate): string => {
          return template.name;
        }),
      );

      // Each sits under the direction its trigger runs in.
      for (const row of rows) {
        const template: WorkflowTemplate = templateNamed(templates, row.name);

        expect({ template: row.name, group: row.group }).toEqual({
          template: row.name,
          group: startsFromWebhook(template)
            ? "Jira → OneUptime"
            : "OneUptime → Jira",
        });
      }
    }
  });

  it("keeps in English only names the templates have: their names and the settings the wizard asks for", () => {
    const names: Set<string> = new Set<string>();

    for (const template of JIRA_TEMPLATES) {
      names.add(template.name);

      for (const variable of template.variables) {
        names.add(variable.title);
      }
    }

    for (const name of TEMPLATE_NAMES[JIRA] || []) {
      expect({ name, real: names.has(name) }).toEqual({ name, real: true });
    }
  });

  it("registers a Jira webhook for each Jira → OneUptime template, for the event its script reads", () => {
    const rows: Array<Array<string>> = tableWithHeader(
      englishSection(JIRA, "### Connect the webhook templates"),
      "Template",
    ).filter((row: Array<string>): boolean => {
      return !(row[0] as string).startsWith("**");
    });
    const EVENT: Record<string, string> = {
      "**Issue created**": "jira:issue_created",
      "**Issue updated**": "jira:issue_updated",
      "**Comment created**": "comment_created",
    };
    const fromJira: Array<WorkflowTemplate> =
      JIRA_TEMPLATES.filter(startsFromWebhook);

    expect(
      rows.map((row: Array<string>): string => {
        return row[0] as string;
      }),
    ).toEqual(
      fromJira.map((template: WorkflowTemplate): string => {
        return template.name;
      }),
    );

    for (const row of rows) {
      const template: WorkflowTemplate = templateNamed(
        JIRA_TEMPLATES,
        row[0] as string,
      );
      const event: string = EVENT[row[1] as string] as string;

      expect({
        template: template.id,
        reads: argumentsText(template).includes(event),
      }).toEqual({
        template: template.id,
        reads: true,
      });
    }
  });

  it("links a record and an issue by the labels the templates write, and marks what each side writes", () => {
    expect(JIRA_LINK_LABEL).toBe("oneuptime");
    expect(JIRA_INCIDENT_LABEL_PREFIX).toBe("oneuptime-incident-");
    expect(JIRA_ALERT_LABEL_PREFIX).toBe("oneuptime-alert-");
    expect(JIRA_SYNCED_FROM_ONEUPTIME_MARKER).toBe("Synced from OneUptime");
    expect(ONEUPTIME_SYNCED_FROM_JIRA_MARKER).toBe("Synced from Jira");

    const linked: string = englishSection(
      JIRA,
      "### How the two sides stay linked",
    );

    expect(linked).toContain(
      `\`${JIRA_LINK_LABEL}\`, which marks the issue as linked.`,
    );
    expect(linked).toContain(`\`${JIRA_INCIDENT_LABEL_PREFIX}<incident id>\``);
    expect(linked).toContain(`\`${JIRA_ALERT_LABEL_PREFIX}<alert id>\``);
    expect(page).toContain(
      `Every comment the templates post in Jira starts with \`${JIRA_SYNCED_FROM_ONEUPTIME_MARKER}\``,
    );
    expect(page).toContain(
      `starts with \`${ONEUPTIME_SYNCED_FROM_JIRA_MARKER}\``,
    );

    // A record created from Jira keeps its issue's key.
    for (const name of [
      "Declare an incident when a Jira issue is created",
      "Create an alert when a Jira issue is created",
    ]) {
      expect(argumentsText(templateNamed(JIRA_TEMPLATES, name))).toContain(
        "jiraIssueKey",
      );
    }
  });

  /*
   * The templates have no Log step any more: a skip is a Check With
   * JavaScript step's reason, which the run's Steps show, and a run that
   * did its job ends Executed on the Jira call - create-issue-1, whose
   * Response Body names the new issue.
   */
  it("quotes the reasons the templates' checks give as the scripts write them, and where a run's new issue shows", () => {
    const scripts: string = JIRA_TEMPLATES.map(argumentsText).join("\n");
    const create: WorkflowTemplate = templateNamed(
      JIRA_TEMPLATES,
      "Create a Jira issue when an incident is declared",
    );
    const last: TemplateNode = nodesOf(create)[
      nodesOf(create).length - 1
    ] as TemplateNode;

    expect(last.componentId).toBe("create-issue-1");
    expect(last.metadataId).toBe(ComponentID.ApiPost);
    expect(page).toContain(
      `The run should end ${bold("Executed")}, and the ${bold("Response Body")} of its last step, \`create-issue-1\`, names the new issue.`,
    );
    expect(page).not.toContain("✅");

    for (const fragment of [
      "More than one Jira issue is labelled ",
      "A cloned issue copies the label: remove it from every issue except the one filed for the ",
      "No Jira issue is labelled ",
      ", or the Jira credentials cannot see it.",
      " could move to ",
      "Name the one to use in STATE_TO_JIRA_STATUS.",
      " that can be chosen without naming it in STATE_TO_JIRA_STATUS.",
      ", so it was not moved back to ",
    ]) {
      expect({ fragment, inScripts: scripts.includes(fragment) }).toEqual({
        fragment,
        inScripts: true,
      });
      expect({ fragment, onPage: page.includes(fragment) }).toEqual({
        fragment,
        onPage: true,
      });
    }
  });

  it("names the statuses the transition template prefers and never guesses, as its regular expressions read them", () => {
    const code: string = codeOf(
      templateNamed(
        JIRA_TEMPLATES,
        "Move the Jira issue when the incident is acknowledged or resolved",
      ),
      "plan-transition-1",
    );
    const preferred: string = constantValue(code, "PREFERRED_STATUS");
    const neverGuess: RegExp = new RegExp(
      (
        constantValue(code, "NEVER_GUESS").match(
          CASELESS_PATTERN,
        ) as RegExpMatchArray
      )[1] as string,
      "i",
    );

    for (const name of [
      "Done",
      "Resolved",
      "Closed",
      "Complete",
      "Completed",
      "Fixed",
    ]) {
      expect(preferred).toContain(name.toLowerCase());
    }

    expect(preferred).toContain("in progress|work in progress");

    for (const name of [
      "Canceled",
      "Declined",
      "Rejected",
      "Won't Do",
      "Duplicate",
      "Obsolete",
      "Waiting",
      "Pending",
      "Escalated",
      "On Hold",
      "Blocked",
    ]) {
      expect({ name, neverGuessed: neverGuess.test(name) }).toEqual({
        name,
        neverGuessed: true,
      });
    }

    expect(neverGuess.test("Resolved")).toBe(false);
    expect(page).toContain(
      "a status named Done, Resolved, Closed, Complete, Completed or Fixed wins. For an acknowledged one, In Progress or Work in Progress wins.",
    );
  });

  it("spreads Jira's priorities as the create templates' PRIORITY_RANK does, Medium to Low on two alert severities", () => {
    const rank: string = constantValue(
      codeOf(
        templateNamed(
          JIRA_TEMPLATES,
          "Create an alert when a Jira issue is created",
        ),
        "prepare-alert-1",
      ),
      "PRIORITY_RANK",
    );

    for (const priority of ["highest", "high", "critical", "blocker"]) {
      expect(rank).toContain(`${priority}: 0`);
    }

    expect(rank).toContain("medium: 1");
    expect(rank).toContain("major: 1");
    expect(page).toContain(
      "On the default two, Highest, High, Critical and Blocker become High, and every other priority becomes Low, Medium and Major included.",
    );
    expect(page).toContain(
      "change `medium: 1` to `medium: 0` in `PRIORITY_RANK` in the `prepare-alert-1` script",
    );
  });

  it("names each constant's block, in every template of both kinds the table names it for", () => {
    const rows: Array<Array<string>> = tableWithHeader(
      englishSection(JIRA, "### Changing what a template does"),
      "Constant",
    );
    const BLOCKS: Record<
      string,
      { blocks: Array<string>; templates: Array<string> }
    > = {
      STATE_TO_JIRA_STATUS: {
        blocks: ["plan-transition-1"],
        templates: [
          "Move the Jira issue when the incident is acknowledged or resolved",
          "Move the Jira issue when the alert is acknowledged or resolved",
        ],
      },
      PREFERRED_STATUS: {
        blocks: ["plan-transition-1"],
        templates: [
          "Move the Jira issue when the incident is acknowledged or resolved",
          "Move the Jira issue when the alert is acknowledged or resolved",
        ],
      },
      NEVER_GUESS: {
        blocks: ["plan-transition-1"],
        templates: [
          "Move the Jira issue when the incident is acknowledged or resolved",
          "Move the Jira issue when the alert is acknowledged or resolved",
        ],
      },
      SYNC_PRIVATE_INCIDENTS: {
        blocks: ["prepare-issue-1", "plan-transition-1", "build-comment-1"],
        templates: JIRA_TEMPLATES.filter((template: WorkflowTemplate) => {
          return (
            template.subcategory === "Incidents" && !startsFromWebhook(template)
          );
        }).map((template: WorkflowTemplate): string => {
          return template.name;
        }),
      },
      SYNC_PRIVATE_ALERTS: {
        blocks: ["prepare-issue-1", "plan-transition-1", "build-comment-1"],
        templates: JIRA_TEMPLATES.filter((template: WorkflowTemplate) => {
          return (
            template.subcategory === "Alerts" && !startsFromWebhook(template)
          );
        }).map((template: WorkflowTemplate): string => {
          return template.name;
        }),
      },
      JIRA_STATUS_TO_STATE: {
        blocks: ["read-event-1"],
        templates: [
          "Acknowledge or resolve the incident when its Jira issue moves",
          "Acknowledge or resolve the alert when its Jira issue moves",
        ],
      },
      PRIORITY_RANK: {
        blocks: ["prepare-incident-1", "prepare-alert-1"],
        templates: [
          "Declare an incident when a Jira issue is created",
          "Create an alert when a Jira issue is created",
        ],
      },
      EVENTS: {
        blocks: ["read-comment-1"],
        templates: [
          "Add Jira comments to the incident as private notes",
          "Add Jira comments to the alert as private notes",
        ],
      },
      IGNORED_FIELDS: {
        blocks: ["read-changes-1"],
        templates: [
          "Add Jira issue changes to the incident as private notes",
          "Add Jira issue changes to the alert as private notes",
        ],
      },
    };

    expect(
      rows.flatMap((row: Array<string>): Array<string> => {
        return codeIn(row[0] as string);
      }),
    ).toEqual(Object.keys(BLOCKS));

    for (const row of rows) {
      for (const constant of codeIn(row[0] as string)) {
        const expected: { blocks: Array<string>; templates: Array<string> } =
          BLOCKS[constant] as {
            blocks: Array<string>;
            templates: Array<string>;
          };

        // The table names the blocks.
        expect({ constant, blocks: codeIn(row[1] as string) }).toEqual({
          constant,
          blocks: expected.blocks,
        });

        // And each template declares the constant in one of them.
        for (const name of expected.templates) {
          const template: WorkflowTemplate = templateNamed(
            JIRA_TEMPLATES,
            name,
          );
          const declared: boolean = expected.blocks.some(
            (block: string): boolean => {
              try {
                constantValue(codeOf(template, block), constant);
                return true;
              } catch {
                return false;
              }
            },
          );

          expect({ constant, template: name, declared }).toEqual({
            constant,
            template: name,
            declared: true,
          });
        }
      }
    }
  });

  it("keeps a comment internal by the property Jira Service Management reads, and an incident from Jira off status pages", () => {
    expect(
      argumentsText(
        templateNamed(
          JIRA_TEMPLATES,
          "Copy incident private notes to the Jira issue",
        ),
      ),
    ).toContain("sd.public.comment");
    expect(page).toContain("`sd.public.comment`");

    /*
     * Incident From Another Tool keeps a new incident off status pages, and
     * their subscribers untold, unless Show On Status Pages is on - which
     * the template leaves off.
     */
    const declare: TemplateNode = nodeOf(
      templateNamed(
        JIRA_TEMPLATES,
        "Declare an incident when a Jira issue is created",
      ),
      "incident-from-another-tool-1",
    );

    expect(declare.metadataId).toBe(ComponentID.IncidentFromAnotherTool);
    expect(declare.args?.["show-on-status-pages"]).toBeUndefined();
    expect(
      readRepoFile(
        "Common/Server/Types/Workflow/Components/FromAnotherTool/RecordFromAnotherTool.ts",
      ),
    ).toContain(
      'statusPageColumns: [\n    "isVisibleOnStatusPage",\n    "shouldStatusPageSubscribersBeNotifiedOnIncidentCreated",\n  ],',
    );
    expect(page).toContain(
      `or turn on ${bold("Show On Status Pages")}, under ${bold("More fields")}, in the template's \`incident-from-another-tool-1\` block.`,
    );
  });

  it("keeps the API token a secret that only ever goes into the Authorization header", () => {
    const token: WorkflowTemplateVariable = JIRA_TEMPLATES.flatMap(
      (template: WorkflowTemplate): Array<WorkflowTemplateVariable> => {
        return template.variables;
      },
    ).find((variable: WorkflowTemplateVariable): boolean => {
      return variable.name === "jiraBasicAuthToken";
    }) as WorkflowTemplateVariable;

    expect(token.isSecret).toBe(true);

    for (const template of JIRA_TEMPLATES) {
      for (const node of nodesOf(template)) {
        const args: JSONObject = node.args || {};

        for (const [key, value] of Object.entries(args)) {
          if (JSON.stringify(value).includes("jiraBasicAuthToken")) {
            expect({ template: template.id, key }).toEqual({
              template: template.id,
              key: "request-headers",
            });
            expect((value as JSONObject)["Authorization"]).toBe(
              "Basic {{local.variables.jiraBasicAuthToken}}",
            );
          }
        }
      }
    }

    expect(page).toContain(
      "The API token is saved as a secret: it is redacted from **Logs → Runs**, and only ever goes into the `Authorization` header of the Jira calls.",
    );
  });

  it("finds a record's issue by posting JQL to /search/jql, as the templates do", () => {
    const find: TemplateNode = nodeOf(
      templateNamed(
        JIRA_TEMPLATES,
        "Move the Jira issue when the incident is acknowledged or resolved",
      ),
      "find-issue-1",
    );

    expect(find.metadataId).toBe(ComponentID.ApiPost);
    expect(find.args?.["url"]).toBe(
      "{{local.variables.jiraBaseUrl}}/rest/api/3/search/jql",
    );
    expect(page).toContain(
      "posting to `{{global.variables.JIRA_URL}}/rest/api/3/search/jql`",
    );
  });

  it("builds a manual workflow from steps that exist, with identifiers the Builder gives or the page sets", () => {
    const ids: Set<string> = stepIds();
    const SET_BY_THE_PAGE: Array<string> = ["create-issue", "find-issue"];
    const section: string = englishSection(JIRA, "## Build it yourself");

    for (const match of Array.from(section.matchAll(BLOCK_REFERENCE))) {
      const block: string = match[1] as string;
      const step: string | undefined = block.match(FIRST_BLOCK)?.[1];

      expect({
        block,
        known:
          SET_BY_THE_PAGE.includes(block) || Boolean(step && ids.has(step)),
      }).toEqual({ block, known: true });
    }

    expect(section).toContain(
      `Set its ${bold("Identifier")} to \`create-issue\``,
    );
    expect(section).toContain(`whose ${bold("Identifier")} is \`find-issue\``);
  });
});

describe("Microsoft Dynamics 365", () => {
  const page: string = englishPage(DYNAMICS);

  function variableNamed(name: string): WorkflowTemplateVariable {
    const variable: WorkflowTemplateVariable | undefined =
      DYNAMICS_TEMPLATES.flatMap(
        (template: WorkflowTemplate): Array<WorkflowTemplateVariable> => {
          return template.variables;
        },
      ).find((candidate: WorkflowTemplateVariable): boolean => {
        return candidate.name === name;
      });

    if (!variable) {
      throw new Error(`No Dynamics 365 setting ${name}`);
    }

    return variable;
  }

  function accepts(name: string, value: string): boolean {
    return (variableNamed(name).format?.pattern as RegExp).test(value);
  }

  it("has 13 templates, seven for incidents then six for alerts, as the tables list them", () => {
    const incidents: Array<WorkflowTemplate> = DYNAMICS_TEMPLATES.filter(
      (template: WorkflowTemplate): boolean => {
        return template.subcategory === "Incidents";
      },
    );
    const alerts: Array<WorkflowTemplate> = DYNAMICS_TEMPLATES.filter(
      (template: WorkflowTemplate): boolean => {
        return template.subcategory === "Alerts";
      },
    );

    expect(DYNAMICS_TEMPLATES).toHaveLength(13);
    expect(incidents).toHaveLength(7);
    expect(alerts).toHaveLength(6);

    for (const [heading, templates] of [
      ["### Incident templates", incidents],
      ["### Alert templates", alerts],
    ] as Array<[string, Array<WorkflowTemplate>]>) {
      const rows: Array<{ group: string; name: string }> = templateRows(
        englishSection(DYNAMICS, heading),
      );

      expect(
        rows.map((row: { name: string }): string => {
          return row.name;
        }),
      ).toEqual(
        templates.map((template: WorkflowTemplate): string => {
          return template.name;
        }),
      );

      for (const row of rows) {
        const template: WorkflowTemplate = templateNamed(templates, row.name);

        expect({ template: row.name, group: row.group }).toEqual({
          template: row.name,
          group: startsFromWebhook(template)
            ? "Dynamics 365 → OneUptime"
            : "OneUptime → Dynamics 365",
        });
      }
    }
  });

  it("asks every template for the five Dynamics 365 settings, and the create-case templates for the customer and the OneUptime URL too", () => {
    const FIVE: Array<string> = [
      "dynamicsUrl",
      "dynamicsTenantId",
      "dynamicsClientId",
      "dynamicsClientSecret",
      "dynamicsLinkColumn",
    ];

    for (const template of DYNAMICS_TEMPLATES) {
      const names: Array<string> = template.variables.map(
        (variable: WorkflowTemplateVariable): string => {
          return variable.name;
        },
      );
      const createsCases: boolean = template.name.startsWith(
        "Create a Dynamics 365 case",
      );

      expect({ template: template.id, names }).toEqual({
        template: template.id,
        names: createsCases
          ? [...FIVE, "dynamicsCustomer", "oneuptimeUrl"]
          : FIVE,
      });
    }

    const list: string = englishSection(
      DYNAMICS,
      "### What the templates ask for",
    );

    for (const name of [...FIVE, "dynamicsCustomer", "oneuptimeUrl"]) {
      expect(list).toContain(`\n- ${bold(variableNamed(name).title)} — `);
    }

    for (const name of TEMPLATE_NAMES[DYNAMICS] || []) {
      const real: boolean = DYNAMICS_TEMPLATES.some(
        (template: WorkflowTemplate): boolean => {
          return (
            template.name === name ||
            template.variables.some((variable: WorkflowTemplateVariable) => {
              return variable.title === name;
            })
          );
        },
      );

      expect({ name, real }).toEqual({ name, real: true });
    }
  });

  it("checks each setting's shape as the page says", () => {
    expect(accepts("dynamicsUrl", "https://yourorg.crm.dynamics.com")).toBe(
      true,
    );
    expect(
      accepts("dynamicsUrl", "https://yourorg.crm.dynamics.com/api/data/v9.2"),
    ).toBe(false);
    expect(accepts("dynamicsUrl", "https://yourorg.crm.dynamics.com/")).toBe(
      false,
    );
    expect(
      accepts("dynamicsClientSecret", "9f2c1d44-7a3b-4c5d-8e6f-0a1b2c3d4e5f"),
    ).toBe(false);
    expect(accepts("dynamicsClientSecret", "Abc8Q~secretvalue")).toBe(true);
    expect(accepts("dynamicsLinkColumn", "new_oneuptimelink")).toBe(true);
    expect(accepts("dynamicsLinkColumn", "cr4f2_oneuptimelink")).toBe(true);
    expect(accepts("dynamicsLinkColumn", "OneUptime Link")).toBe(false);
    expect(
      accepts("dynamicsCustomer", "4f7e6c3a-1b2d-4e5f-8a9b-0c1d2e3f4a5b"),
    ).toBe(true);
    expect(
      accepts(
        "dynamicsCustomer",
        "contacts(4f7e6c3a-1b2d-4e5f-8a9b-0c1d2e3f4a5b)",
      ),
    ).toBe(true);

    expect(page).toContain("the wizard refuses a GUID here");
    expect(page).toContain(
      "not the Web API endpoint, which ends in `/api/data/v9.2`, and no slash at the end",
    );
    expect(page).toContain("or `contacts(<id>)` for a contact");
  });

  it("signs in through one OAuth 2.0 variable, with the client credentials, and sends its token as Bearer", () => {
    const create: WorkflowTemplate = templateNamed(
      DYNAMICS_TEMPLATES,
      "Create a Dynamics 365 case when an incident is declared",
    );
    const oauth: WorkflowTemplateOAuth2Variable = (create.oauth2Variables ||
      [])[0] as WorkflowTemplateOAuth2Variable;

    expect(oauth.name).toBe(DYNAMICS_ACCESS_TOKEN_VARIABLE_NAME);
    expect(oauth.name).toBe("dynamicsAccessToken");
    expect(oauth.grantType).toBe(OAuth2GrantType.ClientCredentials);
    expect(oauth.clientAuthenticationMethod).toBe(
      OAuth2ClientAuthenticationMethod.RequestBody,
    );
    expect(oauth.tokenUrl).toBe(
      "https://login.microsoftonline.com/{dynamicsTenantId}/oauth2/v2.0/token",
    );
    expect(oauth.scope).toBe("{dynamicsUrl}/.default");
    expect(argumentsText(create)).toContain(
      "Bearer {{local.variables.dynamicsAccessToken}}",
    );

    expect(page).toContain(
      "Client Credentials, the token URL `https://login.microsoftonline.com/<tenant>/oauth2/v2.0/token`, the scope `<environment URL>/.default`, and the client secret, sent in the request body and stored encrypted.",
    );
    expect(page).toContain(
      "Every call to Dynamics 365 sends `Authorization: Bearer {{local.variables.dynamicsAccessToken}}`.",
    );
    expect(
      readRepoFile("App/FeatureSet/Workflow/Services/RunWorkflow.ts"),
    ).toContain("Could not get an OAuth 2.0 access token for");
    expect(page).toContain(
      "`Could not get an OAuth 2.0 access token for {{local.variables.dynamicsAccessToken}}`",
    );
  });

  it("names each constant's block, in every template the table names it for, with the defaults the page gives", () => {
    const rows: Array<Array<string>> = tableWithHeader(
      englishSection(DYNAMICS, "### Changing what a template does"),
      "Constant",
    );
    const all: (kind: string) => Array<string> = (kind: string) => {
      return DYNAMICS_TEMPLATES.filter((template: WorkflowTemplate) => {
        return template.subcategory === kind && !startsFromWebhook(template);
      }).map((template: WorkflowTemplate): string => {
        return template.name;
      });
    };
    const fromCases: Array<string> = DYNAMICS_TEMPLATES.filter(
      startsFromWebhook,
    ).map((template: WorkflowTemplate): string => {
      return template.name;
    });
    const createCase: Array<string> = [
      "Create a Dynamics 365 case when an incident is declared",
      "Create a Dynamics 365 case when an alert is created",
    ];
    const resolveCase: Array<string> = [
      "Resolve the Dynamics 365 case when the incident is resolved",
      "Resolve the Dynamics 365 case when the alert is resolved",
    ];
    const createRecord: Array<string> = [
      "Declare an incident when a Dynamics 365 case is created",
      "Create an alert when a Dynamics 365 case is created",
    ];
    const BLOCKS: Record<
      string,
      { blocks: Array<string>; templates: Array<string> }
    > = {
      SYNC_PRIVATE_INCIDENTS: {
        blocks: ["prepare-case-1", "plan-case-1", "build-note-1"],
        templates: all("Incidents"),
      },
      SYNC_PRIVATE_ALERTS: {
        blocks: ["prepare-case-1", "plan-case-1", "build-note-1"],
        templates: all("Alerts"),
      },
      SEVERITY_TO_PRIORITY: {
        blocks: ["prepare-case-1"],
        templates: createCase,
      },
      DEFAULT_PRIORITY: { blocks: ["prepare-case-1"], templates: createCase },
      CASE_ORIGIN: { blocks: ["prepare-case-1"], templates: createCase },
      CASE_TYPE: { blocks: ["prepare-case-1"], templates: createCase },
      MAX_TITLE_LENGTH: { blocks: ["prepare-case-1"], templates: createCase },
      MAX_DESCRIPTION_LENGTH: {
        blocks: ["prepare-case-1"],
        templates: createCase,
      },
      RESOLVED_CASE_STATUS: { blocks: ["plan-case-1"], templates: resolveCase },
      STATE_TO_CASE_STATUS: { blocks: ["plan-case-1"], templates: resolveCase },
      PRIORITY_RANK: {
        blocks: ["prepare-incident-1", "prepare-alert-1"],
        templates: createRecord,
      },
      ONLY_PRIORITIES: {
        blocks: ["prepare-incident-1", "prepare-alert-1"],
        templates: createRecord,
      },
      CASE_STATUS_TO_STATE: {
        blocks: ["decide-state-1"],
        templates: [
          "Resolve the incident when its Dynamics 365 case is resolved",
          "Resolve the alert when its Dynamics 365 case is resolved",
        ],
      },
      CASE_STATE_TO_STATE_FLAG: {
        blocks: ["decide-state-1"],
        templates: [
          "Resolve the incident when its Dynamics 365 case is resolved",
          "Resolve the alert when its Dynamics 365 case is resolved",
        ],
      },
      // The create-from-case templates read the event beside the case, in prepare-*-1.
      MESSAGES: {
        blocks: ["read-event-1", "prepare-incident-1", "prepare-alert-1"],
        templates: fromCases,
      },
      MAX_NOTE_LENGTH: {
        blocks: ["build-note-1", "read-note-1"],
        templates: [
          "Copy incident private notes to the Dynamics 365 case",
          "Add Dynamics 365 case notes to the incident as private notes",
        ],
      },
    };

    expect(
      rows.flatMap((row: Array<string>): Array<string> => {
        return codeIn(row[0] as string);
      }),
    ).toEqual(Object.keys(BLOCKS));

    for (const row of rows) {
      const blocks: Array<string> = codeIn(row[1] as string).filter(
        (span: string): boolean => {
          return span.endsWith("-1");
        },
      );

      for (const constant of codeIn(row[0] as string)) {
        const expected: { blocks: Array<string>; templates: Array<string> } =
          BLOCKS[constant] as {
            blocks: Array<string>;
            templates: Array<string>;
          };

        expect({ constant, blocks }).toEqual({
          constant,
          blocks: expected.blocks,
        });

        for (const name of expected.templates) {
          const template: WorkflowTemplate = templateNamed(
            DYNAMICS_TEMPLATES,
            name,
          );
          const declared: boolean = expected.blocks.some(
            (block: string): boolean => {
              try {
                constantValue(codeOf(template, block), constant);
                return true;
              } catch {
                return false;
              }
            },
          );

          expect({ constant, template: name, declared }).toEqual({
            constant,
            template: name,
            declared: true,
          });
        }
      }
    }

    // The defaults the table states.
    const prepare: string = codeOf(
      templateNamed(DYNAMICS_TEMPLATES, createCase[0] as string),
      "prepare-case-1",
    );
    const plan: string = codeOf(
      templateNamed(DYNAMICS_TEMPLATES, resolveCase[0] as string),
      "plan-case-1",
    );
    const toCase: string = codeOf(
      templateNamed(
        DYNAMICS_TEMPLATES,
        "Copy incident private notes to the Dynamics 365 case",
      ),
      "build-note-1",
    );
    const fromCase: string = codeOf(
      templateNamed(
        DYNAMICS_TEMPLATES,
        "Add Dynamics 365 case notes to the incident as private notes",
      ),
      "read-note-1",
    );

    expect(constantValue(prepare, "DEFAULT_PRIORITY")).toBe("2");
    expect(constantValue(prepare, "CASE_ORIGIN")).toBe("3");
    expect(constantValue(prepare, "CASE_TYPE")).toBe("2");
    expect(constantValue(prepare, "MAX_TITLE_LENGTH")).toBe("200");
    expect(constantValue(prepare, "MAX_DESCRIPTION_LENGTH")).toBe("2000");
    expect(constantValue(plan, "RESOLVED_CASE_STATUS")).toBe("5");
    expect(constantValue(toCase, "MAX_NOTE_LENGTH")).toBe("100000");
    expect(constantValue(fromCase, "MAX_NOTE_LENGTH")).toBe("30000");
    expect(
      constantValue(
        codeOf(
          templateNamed(DYNAMICS_TEMPLATES, createRecord[0] as string),
          "prepare-incident-1",
        ),
        "PRIORITY_RANK",
      ),
    ).toBe("{ 1: 0, 2: 1, 3: 2 }");
    expect(
      constantValue(
        codeOf(
          templateNamed(DYNAMICS_TEMPLATES, createRecord[0] as string),
          "prepare-incident-1",
        ),
        "ONLY_PRIORITIES",
      ),
    ).toBe("[]");
  });

  it("links a case by the value the templates write, never longer than the 55 characters the page gives", () => {
    const longest: number =
      Math.max(
        JIRA_INCIDENT_LABEL_PREFIX.length,
        JIRA_ALERT_LABEL_PREFIX.length,
      ) + UUID_LENGTH;

    expect(longest).toBe(55);
    expect(page).toContain("the templates write at most 55 characters");
    expect(DYNAMICS_SYNCED_FROM_ONEUPTIME_MARKER).toBe("Synced from OneUptime");
    expect(ONEUPTIME_SYNCED_FROM_DYNAMICS_MARKER).toBe(
      "Synced from Dynamics 365",
    );
    expect(page).toContain("starts with `Synced from Dynamics 365`");
  });

  /*
   * The templates have no Log step any more: a run that did its job ends
   * Executed on its Dynamics 365 call, whose Response Body names the case,
   * and one Dynamics 365 refuses fails at that call, with its reason.
   */
  it("says where a run shows the new case and Dynamics 365's refusals, and quotes the skips as the scripts write them", () => {
    const createTemplate: WorkflowTemplate = templateNamed(
      DYNAMICS_TEMPLATES,
      "Create a Dynamics 365 case when an incident is declared",
    );
    const resolveTemplate: WorkflowTemplate = templateNamed(
      DYNAMICS_TEMPLATES,
      "Resolve the Dynamics 365 case when the incident is resolved",
    );
    const resolve: string = argumentsText(resolveTemplate);
    const lastOf: (template: WorkflowTemplate) => TemplateNode = (
      template: WorkflowTemplate,
    ): TemplateNode => {
      return nodesOf(template)[nodesOf(template).length - 1] as TemplateNode;
    };
    const createCase: TemplateNode = lastOf(createTemplate);
    const closeCase: TemplateNode = lastOf(resolveTemplate);

    expect([createCase.componentId, createCase.metadataId]).toEqual([
      "create-case-1",
      ComponentID.ApiPost,
    ]);
    // The new case comes back, its number with it.
    expect(String(createCase.args?.["url"])).toContain(
      "$select=incidentid,ticketnumber,title",
    );
    expect(JSON.stringify(createCase.args?.["request-headers"])).toContain(
      "return=representation",
    );
    expect(page).toContain(
      `The run should end ${bold("Executed")}, and the ${bold("Response Body")} of its last step, \`create-case-1\`, holds the new case's \`ticketnumber\`, such as \`CAS-01001-X1Y2Z3\`.`,
    );
    expect([closeCase.componentId, closeCase.metadataId]).toEqual([
      "close-case-1",
      ComponentID.ApiPost,
    ]);
    expect(String(closeCase.args?.["url"])).toContain("/CloseIncident");
    expect(page).toContain(
      "The run fails at `close-case-1`, with Dynamics 365's reason, and the case stays as it was.",
    );
    expect(page).not.toContain("✅");
    expect(resolve).toContain(
      "More than one Dynamics 365 case holds the link ",
    );
    expect(page).toContain(
      "More than one Dynamics 365 case holds the link oneuptime-incident-<id>",
    );
  });

  it("looks a case up with the spaces of its $filter encoded, as the templates do", () => {
    const find: TemplateNode = nodeOf(
      templateNamed(
        DYNAMICS_TEMPLATES,
        "Resolve the Dynamics 365 case when the incident is resolved",
      ),
      "find-case-1",
    );

    expect(String(find.args?.["url"])).toContain(
      "&$filter={{local.variables.dynamicsLinkColumn}}%20eq%20'oneuptime-incident-",
    );
  });

  it("keeps a token out of run logs: the templates and the manual build sign in with an OAuth 2.0 variable", () => {
    for (const template of DYNAMICS_TEMPLATES) {
      expect({
        template: template.id,
        oauth: (template.oauth2Variables || []).map(
          (variable: WorkflowTemplateOAuth2Variable): string => {
            return variable.name;
          },
        ),
      }).toEqual({ template: template.id, oauth: ["dynamicsAccessToken"] });
    }

    expect(page).toContain(`choose ${bold("Create OAuth 2.0 Variable")}`);
    expect(page).toContain("`Bearer {{global.variables.DYNAMICS_TOKEN}}`");
    expect(page).not.toContain("access_token}}");
  });
});
