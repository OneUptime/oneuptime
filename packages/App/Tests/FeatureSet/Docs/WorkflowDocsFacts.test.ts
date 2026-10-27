import { readPage } from "./DocsContentSupport";
import { boldSpans } from "./DocsTranslationChecks";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseModels from "Common/Models/DatabaseModels/Index";
import Incident from "Common/Models/DatabaseModels/Incident";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import { PermissionHelper } from "Common/Types/Permission";
import ComponentMetadata, {
  Argument,
  ComponentType,
  Port,
  ReturnValue,
} from "Common/Types/Workflow/Component";
import ComponentID from "Common/Types/Workflow/ComponentID";
import Components from "Common/Types/Workflow/Components";
import RecordComponents, {
  SELECT_FIELDS_NAME,
  WATCHED_FIELDS_NAME,
} from "Common/Types/Workflow/Components/BaseModel";
import { getNewStepArguments } from "Common/Types/Workflow/ComponentOutPorts";
import {
  RunRecordColumns,
  getRunRecordColumns,
} from "Common/Types/Workflow/RunRecord";
import {
  CONDITION_COMPARE_AS_OPTIONS,
  CONDITION_COMPARISONS,
  ConditionCompareAsOption,
  ConditionComparison,
} from "Common/Types/Workflow/Components/ConditionComparison";
import {
  MAX_TRACE_STEPS,
  MAX_TRACE_VALUE_LENGTH,
  TRUNCATED_VALUE_SUFFIX,
} from "Common/Types/Workflow/StepTrace";
import WorkflowPlan from "Common/Types/Workflow/WorkflowPlan";
import { FormValidationMessage } from "Common/UI/Components/Forms/Utils/FormValidationMessages";
import { describeUnresolvedIdReference } from "Common/Server/Types/Workflow/Components/BaseModel/UnresolvedIdReference";
import WorkflowStatus, {
  getWorkflowStatusLabel,
} from "Common/Types/Workflow/WorkflowStatus";
import {
  OAUTH2_TOKEN_REFRESH_SKEW_IN_MS,
  OAuth2TokenStatus,
} from "Common/Types/Workflow/WorkflowVariableOAuth";
import { TRUNCATED_TEXT_NOTE } from "Common/Utils/MessageFit";
import {
  describeRowsKeptByDelete,
  KEPT_STATUS_HISTORY_DAYS,
  ROWS_KEPT_ON_DELETE_BY_QUERY,
  RowsKeptOnDelete,
} from "Common/Types/StateTimeline/RowsKeptOnDelete";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What the English Workflows pages say about the product, held to the code
 * that makes it true. Markdown is not compiled, so nothing else notices when a
 * menu entry moves, a step's setting is renamed, a default or a limit changes,
 * or a run status is added. Each test reads the source of truth - the step's
 * metadata, the shared constant, the server code, the dashboard page (read as
 * text: an App test does not import the Dashboard's React components) - and
 * checks the page still says what it does.
 *
 * The translations are held to these English pages by
 * WorkflowDocsTranslations. Several facts have suites of their own
 * (WorkflowTurnOnDocs, WorkflowRunsDocs, WorkflowWebhookUrlDocs,
 * WorkflowIncomingEmailDocs, WorkflowIRCStepDocs, WorkflowOAuthVariableDocs,
 * WorkflowVariablesListDocs, WorkflowTemplatePickerDocs, WorkflowNewStepDocs,
 * WorkflowComponentPickerDocs, WorkflowStepsProjectAdminDocs,
 * WorkflowCustomFieldsAndJSONReferencesDocs, ArchivedUnderAdvancedDocs,
 * DuplicateFillsInNameDocs and AiLeavesOutEmbeddedImagesDocs).
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(PACKAGES_DIR, relativePath), "utf8");
}

function readDashboard(relativePath: string): string {
  return readSource(`App/FeatureSet/Dashboard/src/${relativePath}`);
}

const INDEX: string = readPage("en", "workflows/index");
const AUTHORING: string = readPage("en", "workflows/authoring");
const TRIGGERS: string = readPage("en", "workflows/triggers");
const COMPONENTS: string = readPage("en", "workflows/components");
const VARIABLES: string = readPage("en", "workflows/variables");
const RUNS: string = readPage("en", "workflows/runs-and-logs");
const CONFIGURATION: string = readPage("en", "workflows/configuration");

const WORKFLOWS_MENU: string = readDashboard("Pages/Workflow/SideMenu.tsx");
const WORKFLOW_MENU: string = readDashboard("Pages/Workflow/View/SideMenu.tsx");
const SETTINGS_MENU: string = readDashboard("Pages/Settings/SideMenu.tsx");
const AI_SETTINGS_COPY: string = readDashboard(
  "Components/AISettings/ProjectAiSettingsCopy.ts",
);
const ENVIRONMENT_CONFIG: string = readSource(
  "Common/Server/EnvironmentConfig.ts",
);
const GENERATE_TEXT: string = readSource(
  "Common/Server/Types/Workflow/Components/AI/GenerateText.ts",
);
const AI_SERVICE: string = readSource("Common/Server/Services/AIService.ts");
const PROJECT_AI_DAILY_LIMITS: string = readSource(
  "Common/Types/AI/ProjectAiDailyLimits.ts",
);
const WEBHOOK_TRIGGER: string = readSource(
  "Common/Server/Types/Workflow/Components/Webhook.ts",
);
const SLEEP: string = readSource(
  "Common/Server/Types/Workflow/Components/Sleep.ts",
);
const COMPONENT_CODE: string = readSource(
  "Common/Server/Types/Workflow/ComponentCode.ts",
);
const SLACK_UTIL: string = readSource(
  "Common/Server/Utils/Workspace/Slack/Slack.ts",
);
const OAUTH2_TOKEN_CLIENT: string = readSource(
  "Common/Server/Utils/Workflow/OAuth2TokenClient.ts",
);
const PRIVATE_NETWORK_WEBHOOK_CONFIG: string = readSource(
  "Common/Server/Utils/PrivateNetworkWebhookConfig.ts",
);
const EGRESS_GUARD: string = readSource(
  "Common/Server/Utils/DataSource/EgressGuard.ts",
);
const WORKFLOW_LOG_SERVICE: string = readSource(
  "Common/Server/Services/WorkflowLogService.ts",
);
const TIMEOUT_JOBS: string = readSource(
  "App/FeatureSet/Workers/Jobs/Workflow/TimeoutJobs.ts",
);
const WORKFLOW_VARIABLE_MODEL: string = readSource(
  "Common/Models/DatabaseModels/WorkflowVariable.ts",
);
const WORKFLOW_VARIABLE_UTIL: string = readDashboard(
  "Utils/Workflow/WorkflowVariableUtil.ts",
);
const FORM_VALIDATION: string = readSource(
  "Common/UI/Components/Forms/Validation.ts",
);
const MODEL_IMPORT_EXPORT: string = readSource(
  "Common/UI/Utils/ModelImportExport.ts",
);
const BUILDER_CANVAS: string = readSource(
  "Common/UI/Components/Workflow/Workflow.tsx",
);
const TEMPLATES: string = readSource("Common/Types/Workflow/Templates.ts");
const RECORD_COMPONENTS: string = readSource(
  "Common/Types/Workflow/Components/BaseModel.ts",
);

const NUMBER_CONSTANT: RegExp =
  /export const ([A-Z0-9_]+): number =\s*([0-9_. *]+);/g;
const DIGIT_SEPARATOR: RegExp = /_/g;
const MENU_TITLE: RegExp = /title(?:=|: )"([^"]+)"/g;
const TABLE_SEPARATOR_CELL: RegExp = /^:?-+:?$/;
const TEMPLATE_GRAPH_NODE: RegExp =
  /componentId: "([a-z0-9-]+)",\s*metadataId: (?:"([a-z0-9-]+)"|ComponentID\.([A-Za-z]+)),/g;
const AUTONOMOUS: RegExp = /autonomous/i;

// The value of a number constant a source file exports, such as 50_000 or 60 * 1000.
function numberConstant(source: string, name: string): number {
  for (const match of source.matchAll(NUMBER_CONSTANT)) {
    if (match[1] !== name) {
      continue;
    }

    return (match[2] as string)
      .split("*")
      .map((factor: string): number => {
        return Number(factor.replace(DIGIT_SEPARATOR, "").trim());
      })
      .reduce((product: number, factor: number): number => {
        return product * factor;
      }, 1);
  }

  throw new Error(`${name} is not an exported number constant`);
}

// A page's section: its heading line up to the next heading of the same or a higher level.
function section(page: string, heading: string): string {
  const level: number = heading.indexOf(" ");
  const start: number = page.indexOf(`\n${heading}\n`);

  expect({ heading, found: start >= 0 }).toEqual({ heading, found: true });

  const rest: string = page.slice(start + 1);
  const next: RegExp = new RegExp(`\\n#{1,${level}} `);
  const end: number = rest.slice(heading.length).search(next);

  return end < 0 ? rest : rest.slice(0, heading.length + end);
}

// Everything a menu file names with `title`, in order.
function menuTitles(source: string): Array<string> {
  return [...source.matchAll(MENU_TITLE)].map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

// The rows of a section's tables, as their trimmed cells, without header separators.
function tableRows(markdown: string): Array<Array<string>> {
  return markdown
    .split("\n")
    .filter((line: string): boolean => {
      return line.startsWith("|");
    })
    .map((line: string): Array<string> => {
      return line
        .split("|")
        .slice(1, -1)
        .map((cell: string): string => {
          return cell.trim();
        });
    })
    .filter((cells: Array<string>): boolean => {
      return !cells.every((cell: string): boolean => {
        return TABLE_SEPARATOR_CELL.test(cell);
      });
    });
}

// The row whose first cell is this, as its cells.
function tableRow(markdown: string, firstCell: string): Array<string> {
  const row: Array<string> | undefined = tableRows(markdown).find(
    (cells: Array<string>): boolean => {
      return cells[0] === firstCell;
    },
  );

  expect({ firstCell, found: Boolean(row) }).toEqual({
    firstCell,
    found: true,
  });

  return row as Array<string>;
}

// The bold names that open a section's table rows, in order.
function tableRowLabels(markdown: string): Array<string> {
  return tableRows(markdown)
    .map((cells: Array<string>): string => {
      const spans: Array<string> = boldSpans(cells[0] || "");
      return (cells[0] || "").startsWith("**") ? spans[0] || "" : "";
    })
    .filter((label: string): boolean => {
      return label !== "";
    });
}

function component(id: string): ComponentMetadata {
  const found: ComponentMetadata | undefined = (
    Components as Array<ComponentMetadata>
  ).find((item: ComponentMetadata): boolean => {
    return item.id === id;
  });

  expect({ id, found: Boolean(found) }).toEqual({ id, found: true });

  return found as ComponentMetadata;
}

/*
 * The built-in steps, and the record steps and triggers of the two records the
 * pages take their examples from, as the builder lists them
 * (UI/Components/Workflow/Utils loadComponentsAndCategories).
 */
const CATALOG: Array<ComponentMetadata> = [
  ...(Components as Array<ComponentMetadata>),
  ...RecordComponents.getComponents(new Incident()),
  ...RecordComponents.getComponents(new Monitor()),
];

function componentByTitle(title: string): ComponentMetadata {
  const found: ComponentMetadata | undefined = CATALOG.find(
    (item: ComponentMetadata): boolean => {
      return item.title === title;
    },
  );

  expect({ title, found: Boolean(found) }).toEqual({ title, found: true });

  return found as ComponentMetadata;
}

function settingNames(metadata: ComponentMetadata): Array<string> {
  return metadata.arguments.map((argument: Argument): string => {
    return argument.name;
  });
}

function returnValueNames(metadata: ComponentMetadata): Array<string> {
  return metadata.returnValues.map((value: ReturnValue): string => {
    return value.name;
  });
}

function outputTitles(metadata: ComponentMetadata): Array<string> {
  return metadata.outPorts.map((port: Port): string => {
    return port.title;
  });
}

function returnValueId(metadata: ComponentMetadata, name: string): string {
  const value: ReturnValue | undefined = metadata.returnValues.find(
    (item: ReturnValue): boolean => {
      return item.name === name;
    },
  );

  expect({ name, found: Boolean(value) }).toEqual({ name, found: true });

  return (value as ReturnValue).id;
}

// What the builder calls the first block of a kind it adds: `<metadata id>-1`.
function firstBlockId(metadataId: string): string {
  expect(BUILDER_CANVAS).toContain(
    "const id: string = `${metaDataId}-${idCounter}`;",
  );
  expect(BUILDER_CANVAS).toContain("let idCounter: number = 1;");

  return `${metadataId}-1`;
}

// A model of the table: the record type a data component is generated from.
function modelByTableName(tableName: string): BaseModel {
  const modelType: (new () => BaseModel) | undefined = (
    DatabaseModels as Array<new () => BaseModel>
  ).find((model: new () => BaseModel): boolean => {
    return new model().tableName === tableName;
  });

  expect({ tableName, found: Boolean(modelType) }).toEqual({
    tableName,
    found: true,
  });

  return new modelType!();
}

function isPermissionTitle(title: string): boolean {
  return PermissionHelper.getAllPermissionProps().some(
    (props: { title: string }): boolean => {
      return props.title === title;
    },
  );
}

function withThousands(value: number): string {
  return value.toLocaleString("en-US");
}

describe("the overview", () => {
  const menus: string = section(
    INDEX,
    "## Where to find workflows in OneUptime",
  );

  it("lists the Workflows menu as its side menu builds it", () => {
    const titles: Array<string> = menuTitles(WORKFLOWS_MENU);

    for (const title of [
      "Workflows",
      "Global Variables",
      "Logs",
      "Runs",
      "Settings",
      "Owner Rules",
      "Label Rules",
      "Advanced",
      "Archived",
    ]) {
      expect(titles).toContain(title);
    }

    expect(WORKFLOWS_MENU).toContain("getDeveloperSideMenuSectionProps({");

    for (const entry of [
      "- **Workflows** — ",
      "- **Global Variables** — ",
      "- **Logs → Runs** — ",
      "- **Settings → Label Rules** and **Owner Rules** — ",
      "- **Advanced → Archived** — ",
      "- **Developer** — how to manage workflows with Terraform, the API or an AI assistant.",
    ]) {
      expect(menus).toContain(entry);
    }
  });

  it("lists a workflow's own menu as its side menu builds it, Settings under Advanced", () => {
    const titles: Array<string> = menuTitles(WORKFLOW_MENU);

    for (const title of [
      "Overview",
      "Builder",
      "Workflow Variables",
      "Logs",
      "Runs",
      "Owners",
    ]) {
      expect(titles).toContain(title);
    }

    const advanced: string = WORKFLOW_MENU.slice(
      WORKFLOW_MENU.indexOf('<SideMenuSection title="Advanced">'),
    );

    expect(menuTitles(advanced)).toEqual([
      "Advanced",
      "Settings",
      "Audit Logs",
      "Delete Workflow",
    ]);
    expect(WORKFLOW_MENU).toContain("getDeveloperSideMenuSection({");

    for (const entry of [
      "- **Overview** — ",
      "- **Builder** — ",
      "- **Workflow Variables** — ",
      "- **Logs → Runs** — every run of this workflow",
      "- **Owners** — ",
      "- **Developer** — how to manage this workflow with Terraform, the API or an AI assistant.",
      "- **Settings** — duplicate, export and archive.",
      "**Settings** sits in the menu's **Advanced** section with **Audit Logs** and **Delete Workflow**.",
    ]) {
      expect(menus).toContain(entry);
    }
  });

  it("names the template that builds the example, under Incidents, built as the example is", () => {
    const start: number = TEMPLATES.indexOf(
      'name: "Forward new incidents to another system"',
    );

    expect(start).toBeGreaterThan(0);

    const template: string = TEMPLATES.slice(
      start,
      TEMPLATES.indexOf("\n  {\n    id: ", start),
    );

    expect(template).toContain("category: WorkflowTemplateCategory.Incidents");
    expect(
      [...template.matchAll(TEMPLATE_GRAPH_NODE)].map(
        (match: RegExpMatchArray): string => {
          return `${match[1]} ${match[2] || match[3]}`;
        },
      ),
    ).toEqual([
      "incident-on-create-1 incident-on-create",
      "api-post-1 ApiPost",
      "log-failed Log",
    ]);
    expect(template).toContain(
      'fromComponentId: "incident-on-create-1",\n          toComponentId: "api-post-1",\n          fromPort: "success",',
    );
    expect(template).toContain(
      'fromComponentId: "api-post-1",\n          toComponentId: "log-failed",\n          fromPort: "error",',
    );

    expect(
      section(INDEX, "## Example: send new incidents to a webhook"),
    ).toContain(
      "> The **Forward new incidents to another system** template builds the same workflow for you. Find it under **Incidents** when you create a workflow.",
    );
  });

  it("refers to the example's blocks by the IDs the builder gives them", () => {
    const example: string = section(
      INDEX,
      "## Example: send new incidents to a webhook",
    );
    const trigger: ComponentMetadata = componentByTitle("On Create Incident");
    const post: ComponentMetadata = component(ComponentID.ApiPost);
    const log: ComponentMetadata = component(ComponentID.Log);

    expect(trigger.id).toBe("incident-on-create");
    expect(trigger.componentType).toBe(ComponentType.Trigger);
    expect(outputTitles(trigger)).toEqual(["Success"]);
    expect(example).toContain(
      `The ID on it, \`${firstBlockId(trigger.id)}\`, is how later blocks refer to it.`,
    );
    expect(example).toContain(
      `{{local.components.${firstBlockId(trigger.id)}.returnValues.${returnValueId(trigger, "Incident")}.title}}`,
    );
    /*
     * Run Workflow asks for the trigger's record, and names the field after
     * the record ("Incident"), where the record is picked rather than its ID
     * typed (RunForm, RunRecordField).
     */
    expect(
      (trigger.runWorkflowManuallyArguments || []).map(
        (argument: Argument): string => {
          return argument.id;
        },
      ),
    ).toEqual(["_id"]);
    expect(new Incident().singularName).toBe("Incident");
    expect(readSource("Common/UI/Components/Workflow/RunForm.tsx")).toContain(
      "title: info.singularName,",
    );
    expect(example).toContain(
      "Click **Run Workflow** and pick an incident in this project under **Incident**",
    );

    expect(post.title).toBe("API Post (JSON)");
    expect(settingNames(post)).toEqual([
      "URL",
      "Request Body",
      "Request Headers",
    ]);
    expect(outputTitles(post)).toEqual(["Success", "Error"]);
    expect(example).toContain(
      "Put your endpoint in **URL**. In **Request Body**",
    );
    expect(example).toContain(
      `{{local.components.${firstBlockId(post.id)}.returnValues.${returnValueId(post, "Error")}}}`,
    );

    expect(settingNames(log)).toEqual(["Value"]);
    expect(example).toContain("set the Log block's **Value**");
  });

  it("says workflows need Growth on OneUptime Cloud, as the Free plan allows no runs", () => {
    expect(WorkflowPlan.Free).toBe(0);
    expect(WorkflowPlan.Growth).toBeGreaterThan(0);
    expect(section(INDEX, "## Before you begin")).toContain(
      "workflows need the **Growth** plan or above",
    );
  });
});

describe("the authoring page", () => {
  it("names the Manual trigger's output and value, and the reference its first block gets", () => {
    const manual: ComponentMetadata = component(ComponentID.Manual);
    const first: string = section(AUTHORING, "## Your first workflow");

    expect(outputTitles(manual)).toEqual(["Execute"]);
    expect(first).toContain("Connect the trigger's **Execute** dot");
    expect(returnValueNames(manual)).toEqual(["JSON"]);
    expect(first).toContain("click **JSON** under **Manual**");
    expect(first).toContain(
      `\`{{local.components.${firstBlockId(manual.id)}.returnValues.${returnValueId(manual, "JSON")}}}\``,
    );
  });

  it("reads one field of the Manual trigger's JSON by adding its name to the reference", () => {
    const manual: ComponentMetadata = component(ComponentID.Manual);

    expect(returnValueNames(manual)).toEqual(["JSON"]);
    expect(AUTHORING).toContain(
      `\`{{local.components.${firstBlockId(manual.id)}.returnValues.${returnValueId(manual, "JSON")}.name}}\``,
    );
    // And the picker lists the fields under the trigger's own names.
    expect(AUTHORING).toContain("open **JSON** under **Manual**");
  });

  it("still describes Text to JSON by the block's own names, for JSON that arrives as text", () => {
    const textToJson: ComponentMetadata = component(ComponentID.TextToJson);

    expect(settingNames(textToJson)).toEqual(["Text"]);
    expect(returnValueNames(textToJson)).toEqual(["JSON"]);
    expect(COMPONENTS).toContain("Use it on JSON that arrived as text.");
  });
});

describe("the triggers page", () => {
  it("has a section for each kind of trigger the picker offers", () => {
    for (const title of ["Manual", "Schedule", "Webhook", "Incoming Email"]) {
      expect(
        (Components as Array<ComponentMetadata>).some(
          (item: ComponentMetadata): boolean => {
            return (
              item.title === title &&
              item.componentType === ComponentType.Trigger
            );
          },
        ),
      ).toBe(true);
      expect(TRIGGERS).toContain(`\n## ${title}\n`);
    }

    expect(TRIGGERS).toContain("\n## OneUptime event triggers\n");
  });

  it("names the Schedule trigger's setting as the step does", () => {
    expect(settingNames(component(ComponentID.Schedule))).toEqual([
      "Schedule at",
    ]);
    expect(section(TRIGGERS, "## Schedule")).toContain(
      "Set how often in **Schedule at**",
    );
  });

  it("says the webhook URL takes GET and POST, and answers Scheduled straight away", () => {
    expect(WEBHOOK_TRIGGER).toContain(
      "props.router.get(\n      `/trigger/:secretkey`",
    );
    expect(WEBHOOK_TRIGGER).toContain(
      "props.router.post(\n      `/trigger/:secretkey`",
    );
    expect(WEBHOOK_TRIGGER).toContain(
      'Response.sendJsonObjectResponse(req, res, { status: "Scheduled" });',
    );

    const webhook: string = section(TRIGGERS, "## Webhook");

    expect(webhook).toContain("The URL accepts both `GET` and `POST`.");
    expect(webhook).toContain('`{"status": "Scheduled"}`');
    expect(webhook).toContain(
      "https://oneuptime.example.com/workflow/trigger/<secret key>",
    );
  });

  it("lists exactly the values the Webhook trigger returns, and reads the body by its ID", () => {
    const webhook: ComponentMetadata = component(ComponentID.Webhook);
    const page: string = section(TRIGGERS, "## Webhook");

    expect(tableRowLabels(page)).toEqual(returnValueNames(webhook));
    expect(page).toContain(
      `{{local.components.${firstBlockId(webhook.id)}.returnValues.${returnValueId(webhook, "Request Body")}.message}}`,
    );
  });

  it("hands Execute Workflow's arguments to the Manual trigger, one value per key", () => {
    expect(settingNames(component(ComponentID.WorkflowRun))).toEqual([
      "Workflow",
      "Arguments",
    ]);
    expect(section(TRIGGERS, "## Manual")).toContain(
      `\`{{local.components.${firstBlockId(ComponentID.Manual)}.returnValues.customerId}}\``,
    );
  });

  it("names the record triggers and On Update's two field lists as the catalog does", () => {
    for (const title of [
      "On Create Incident",
      "On Update Incident",
      "On Delete Incident",
    ]) {
      expect(componentByTitle(title).componentType).toBe(ComponentType.Trigger);
    }

    const onUpdate: ComponentMetadata = componentByTitle("On Update Incident");

    expect(WATCHED_FIELDS_NAME).toBe("Fields to watch");
    expect(SELECT_FIELDS_NAME).toBe("Fields to pass on");
    expect(settingNames(onUpdate)).toContain(WATCHED_FIELDS_NAME);
    expect(settingNames(onUpdate)).toContain(SELECT_FIELDS_NAME);
    expect(TRIGGERS).toContain(
      `**On Update** can be narrowed to some fields with **${WATCHED_FIELDS_NAME}**`,
    );
    expect(TRIGGERS).toContain(
      `with the fields you pick in the trigger's **${SELECT_FIELDS_NAME}**`,
    );
  });

  /*
   * The names these two settings had are gone from the builder, so a page
   * that still used one would send its reader looking for a setting that is
   * not there.
   */
  it("no workflow page names the settings as they used to be called", () => {
    for (const page of [
      INDEX,
      AUTHORING,
      TRIGGERS,
      COMPONENTS,
      VARIABLES,
      RUNS,
      CONFIGURATION,
    ]) {
      expect(page).not.toContain("Listen on");
      expect(page).not.toContain("Select Fields");
    }
  });

  it("a new record trigger's Fields to pass on starts with the title, as the first workflow says", () => {
    expect(getNewStepArguments("incident-on-create", "Incident")).toEqual({
      select: { title: true },
    });
    expect(INDEX).toContain(
      `**${SELECT_FIELDS_NAME}** starts with the title: click **Add field**`,
    );
    // The button that opens the list, as the field list draws it.
    expect(
      readSource("Common/UI/Components/Workflow/ModelFieldPicker.tsx"),
    ).toContain('addField: translationKey("Add field")');
  });

  it("the field lists have a JSON view, which the components page and the integrations point to", () => {
    expect(
      readSource("Common/UI/Components/Workflow/ModelFieldPicker.tsx"),
    ).toContain('editAsJson: translationKey("Edit as JSON")');
    expect(COMPONENTS).toContain(
      `**${SELECT_FIELDS_NAME}**, on the Find components and the triggers, is picked from a list; its **Edit as JSON** shows the same column keys`,
    );
  });

  it("Run Workflow picks an event trigger's record by number or name, or among the most recent", () => {
    const columns: RunRecordColumns = getRunRecordColumns(new Incident());

    // An incident has a number and a name to search by.
    expect(columns.number).toBeDefined();
    expect(columns.nameColumn).toBe("title");

    const field: string = readSource(
      "Common/UI/Components/Workflow/RunRecordField.tsx",
    );

    expect(field).toContain('mostRecent: translationKey("Most recent")');
    expect(field).toContain(
      'searchByNumberOrName: translationKey("Search by number or name")',
    );
    expect(TRIGGERS).toContain(
      "pick an existing record: the most recent ones are listed, and typing a record's number or part of its name finds another",
    );
    expect(INDEX).toContain(
      "pick an incident in this project under **Incident**: the most recent ones are listed, and typing its number or part of its title finds another",
    );
    // The field is named after the record, not "Incident ID" any more.
    expect(INDEX).not.toContain("**Incident ID**");
    expect(TRIGGERS).not.toContain("**Incident ID**");
  });

  it("JSON typed into Run Workflow reaches the Manual trigger as JSON", () => {
    const runValues: string = readSource(
      "Common/UI/Components/Workflow/RunValues.ts",
    );

    expect(runValues).toContain(
      "values[argument.id] = JSONFunctions.parse(value) as JSONValue;",
    );
    expect(section(TRIGGERS, "## Manual")).toContain(
      `- From **Run Workflow**, it is the JSON you typed. To read one field of it, add the field's name to the reference, as in \`{{local.components.${firstBlockId(ComponentID.Manual)}.returnValues.value.name}}\`.`,
    );
    expect(AUTHORING).toContain(
      `> JSON typed into **Run Workflow** reaches the Manual trigger as JSON. To read one field of it, such as \`name\`, add the field's name to the reference: \`{{local.components.${firstBlockId(ComponentID.Manual)}.returnValues.value.name}}\`.`,
    );
    // No page still sends the reader through a Text to JSON block for it.
    expect(section(TRIGGERS, "## Manual")).not.toContain("Text to JSON");
  });

  it("the value picker lists what is not available apart, and says which fields a block does not pass on", () => {
    const menu: string = readSource(
      "Common/UI/Components/Workflow/ValuePicker/ValuePickerMenu.tsx",
    );
    const stepValues: string = readSource(
      "Common/UI/Components/Workflow/ValuePicker/StepValueSource.ts",
    );
    const samples: string = readSource(
      "Common/UI/Components/Workflow/ValuePicker/StepSampleSource.ts",
    );

    // Folded at the end, with why; a block before this one on some runs says so.
    expect(menu).toContain('other: "{{count}} steps aren\'t available here"');
    expect(stepValues).toContain(
      '"Runs only when {{step}} takes {{output}}, so its values can be empty here."',
    );
    expect(AUTHORING).toContain(
      "- **Values that are there come first, and the rest are listed apart.**",
    );
    expect(AUTHORING).toContain(
      "is listed at the end, folded and greyed, with why, and its values can't be picked",
    );
    // A record's fields its block does not pass on.
    expect(AUTHORING).toContain(
      `first the ones the block passes on, which its **${SELECT_FIELDS_NAME}** names, then, apart, the ones it doesn't, which are empty here`,
    );
    // While the workflow is off, a test run instead of a test request.
    expect(samples).toContain(
      'testWithRunWorkflow: translationKey("Test with Run Workflow")',
    );
    expect(AUTHORING).toContain(
      "While the workflow is off, its URL turns requests away, so the list offers **Test with Run Workflow** instead",
    );
  });
});

describe("the components page", () => {
  it("names the five API blocks, their settings, outputs and values", () => {
    const api: string = section(COMPONENTS, "## API");

    for (const id of [
      ComponentID.ApiGet,
      ComponentID.ApiPost,
      ComponentID.ApiPut,
      ComponentID.ApiPatch,
      ComponentID.ApiDelete,
    ]) {
      const block: ComponentMetadata = component(id);

      expect(api).toContain(`**${block.title}**`);
      expect(settingNames(block)).toEqual(tableRowLabels(api).slice(0, 3));
      expect(outputTitles(block)).toEqual(tableRowLabels(api).slice(3));
      expect([...returnValueNames(block)].sort()).toEqual(
        [
          "Error",
          "Response Body",
          "Response Headers",
          "Response Status",
        ].sort(),
      );
    }

    const headers: Argument | undefined = component(
      ComponentID.ApiGet,
    ).arguments.find((argument: Argument): boolean => {
      return argument.name === "Request Headers";
    });

    expect(headers?.isAdvanced).toBe(true);
    expect(headers?.isSensitive).toBe(true);
    expect(tableRow(api, "**Request Headers**")[1]).toBe(
      "Headers to send, such as an API key. Under **More fields**. Their values are hidden in the run's log.",
    );
  });

  it("gives Generate Text with AI's settings, values, defaults and limits as the step has them", () => {
    const ai: ComponentMetadata = component(ComponentID.AIGenerateText);
    const page: string = section(COMPONENTS, "### Generate Text with AI");

    expect(tableRowLabels(page)).toEqual(settingNames(ai));

    for (const name of returnValueNames(ai)) {
      expect({ name, named: page.includes(`**${name}**`) }).toEqual({
        name,
        named: true,
      });
    }

    expect(
      numberConstant(GENERATE_TEXT, "DEFAULT_WORKFLOW_AI_TEMPERATURE"),
    ).toBe(0.2);
    expect(numberConstant(GENERATE_TEXT, "MIN_WORKFLOW_AI_TEMPERATURE")).toBe(
      0,
    );
    expect(numberConstant(GENERATE_TEXT, "MAX_WORKFLOW_AI_TEMPERATURE")).toBe(
      1,
    );
    expect(page).toContain("Variation from `0` to `1`; the default is `0.2`");
    expect(page).toContain(
      `From \`${numberConstant(GENERATE_TEXT, "MIN_WORKFLOW_AI_MAX_OUTPUT_TOKENS")}\` to \`${numberConstant(GENERATE_TEXT, "MAX_WORKFLOW_AI_MAX_OUTPUT_TOKENS")}\`; the default is \`${numberConstant(GENERATE_TEXT, "DEFAULT_WORKFLOW_AI_MAX_OUTPUT_TOKENS")}\`.`,
    );
    expect(page).toContain(
      `are limited to ${withThousands(numberConstant(GENERATE_TEXT, "MAX_WORKFLOW_AI_INPUT_CHARACTERS"))} characters`,
    );
    expect(page).toContain(
      `has a ${numberConstant(GENERATE_TEXT, "MAX_WORKFLOW_AI_REQUEST_TIMEOUT_IN_MS") / 1000}-second maximum duration`,
    );
    expect(
      numberConstant(
        GENERATE_TEXT,
        "MAX_CONCURRENT_WORKFLOW_AI_CALLS_PER_PROJECT",
      ),
    ).toBe(3);
    expect(page).toContain("At most three workflow AI requests");
  });

  it("names every setting of each chat and email block as the block does", () => {
    const blocks: Array<[string, string]> = [
      [ComponentID.SlackSendMessageToChannel, "## Slack"],
      [ComponentID.MicrosoftTeamsSendMessageToChannel, "## Microsoft Teams"],
      [ComponentID.DiscordSendMessageToChannel, "## Discord"],
      [ComponentID.TelegramSendMessageToChat, "## Telegram"],
      [ComponentID.IRCSendMessageToChannel, "## IRC"],
      [ComponentID.MattermostSendMessageToChannel, "## Mattermost"],
      [ComponentID.SendEmail, "## Email"],
    ];

    for (const [id, heading] of blocks) {
      const block: ComponentMetadata = component(id);
      const page: string = section(COMPONENTS, heading);

      expect(outputTitles(block)).toEqual(["Success", "Error"]);

      for (const name of settingNames(block)) {
        expect({ heading, name, named: page.includes(`**${name}**`) }).toEqual({
          heading,
          name,
          named: true,
        });
      }
    }

    expect(section(COMPONENTS, "## Microsoft Teams")).toContain(
      `The block is called **${component(ComponentID.MicrosoftTeamsSendMessageToChannel).title}**.`,
    );
    expect(section(COMPONENTS, "## Email")).toContain(
      `The block is called **${component(ComponentID.SendEmail).title}**.`,
    );
  });

  it("gives Slack's section size and count, and the note a cut message ends with", () => {
    expect(SLACK_UTIL).toContain(
      "public static readonly SECTION_TEXT_MAX_LENGTH: number = 3000;",
    );
    expect(SLACK_UTIL).toContain(
      "public static readonly MAX_SECTIONS_PER_MARKDOWN_BLOCK: number = 10;",
    );

    const slack: string = section(COMPONENTS, "## Slack");

    expect(slack).toContain("one Slack section (3,000 characters)");
    expect(slack).toContain("past ten sections it is cut");
    expect(slack).toContain(`"${TRUNCATED_TEXT_NOTE}"`);
  });

  it("names Run Custom JavaScript's settings and value, and its default time", () => {
    const javascript: ComponentMetadata = component(ComponentID.JavaScriptCode);
    const page: string = section(COMPONENTS, "## Custom Code");

    expect(page).toContain(`The block is called **${javascript.title}**.`);
    expect(tableRowLabels(page)).toEqual(settingNames(javascript));
    expect(returnValueNames(javascript)).toEqual(["Value", "Error"]);
    expect(page).toContain(
      `{{local.components.${firstBlockId(javascript.id)}.returnValues.${returnValueId(javascript, "Value")}.shortTitle}}`,
    );
    expect(ENVIRONMENT_CONFIG).toContain(
      'process.env["WORKFLOW_SCRIPT_TIMEOUT_IN_MS"].toString())\n  : 5000;',
    );
    expect(page).toContain(
      "It has 5 seconds by default; a self-hosted install changes that with `WORKFLOW_SCRIPT_TIMEOUT_IN_MS`.",
    );
  });

  it("names the three JSON blocks, what each takes and returns", () => {
    const page: string = section(COMPONENTS, "## JSON");
    const blocks: Array<ComponentMetadata> = [
      component(ComponentID.JsonToText),
      component(ComponentID.TextToJson),
      component(ComponentID.MergeJson),
    ];

    expect(tableRowLabels(page)).toEqual(
      blocks.map((block: ComponentMetadata): string => {
        return block.title;
      }),
    );

    for (const block of blocks) {
      const row: Array<string> = tableRow(page, `**${block.title}**`);

      for (const name of settingNames(block)) {
        expect(row[1]).toContain(`**${name}**`);
      }

      for (const name of returnValueNames(block)) {
        expect(row[2]).toContain(`**${name}**`);
      }
    }
  });

  it("lists every comparison If / Else offers, and the three ways to compare", () => {
    const page: string = section(COMPONENTS, "## Conditions");
    const condition: ComponentMetadata = component(ComponentID.IfElse);

    expect(page).toContain(`this block is called **${condition.title}**`);
    expect(outputTitles(condition)).toEqual(["Yes", "No"]);
    expect(tableRowLabels(page).slice(0, 3)).toEqual(
      settingNames(condition).slice(0, 3),
    );

    const comparisons: Array<string> = boldSpans(
      page.slice(
        page.indexOf("The comparisons:"),
        page.indexOf("The number comparisons"),
      ),
    );

    expect([...comparisons].sort()).toEqual(
      CONDITION_COMPARISONS.map((comparison: ConditionComparison): string => {
        return comparison.label;
      }).sort(),
    );

    const compareAs: Array<string> = tableRow(page, "**Compare as**");

    for (const option of CONDITION_COMPARE_AS_OPTIONS as Array<ConditionCompareAsOption>) {
      expect(compareAs[1]).toContain(`**${option.label}**`);
    }
  });

  it("says Sleep waits 30 days at most and Execute Workflow chains stop at 10", () => {
    expect(SLEEP).toContain(
      "export const MAX_SLEEP_IN_MS: number = 30 * 24 * 60 * 60 * 1000; // 30 days",
    );
    expect(settingNames(component(ComponentID.Sleep))).toEqual([
      "Days",
      "Hours",
      "Minutes",
      "Seconds",
    ]);
    expect(section(COMPONENTS, "## Sleep")).toContain(
      "The longest wait is 30 days",
    );

    expect(COMPONENT_CODE).toContain(
      "export const MAX_WORKFLOW_CALL_DEPTH: number = 10;",
    );
    expect(outputTitles(component(ComponentID.WorkflowRun))).toEqual([
      "Out",
      "Error",
    ]);
    expect(section(COMPONENTS, "## Execute Workflow")).toContain(
      "is at most 10 deep",
    );
  });

  it("names the record components as the catalog titles them, with Limit defaulting to 10", () => {
    const page: string = section(COMPONENTS, "## OneUptime data components");
    const titles: Array<string> = tableRowLabels(page);

    expect(titles).toHaveLength(8);

    for (const title of titles) {
      expect(componentByTitle(title).componentType).toBe(
        ComponentType.Component,
      );
    }

    expect(RECORD_COMPONENTS).toContain(
      "Defaults to 10, so a query that matches 500 records still only affects 10.",
    );
    expect(section(COMPONENTS, "## Working with records")).toContain(
      "**Limit** defaults to `10`",
    );
  });

  it("says what a delete by query of a status or state timeline keeps, as the product keeps it", () => {
    const page: string = section(COMPONENTS, "## Working with records");

    // Each timeline a workflow can delete from, by the words the page names it in.
    const NAMED_AS: Record<string, string> = {
      MonitorStatusTimeline: "a monitor's status events",
      IncidentStateTimeline: "incidents",
      AlertStateTimeline: "alerts",
      ScheduledMaintenanceStateTimeline: "scheduled maintenance events",
      IncidentEpisodeStateTimeline: "episodes",
      AlertEpisodeStateTimeline: "episodes",
    };

    const withDeleteSteps: Array<string> = Object.keys(
      ROWS_KEPT_ON_DELETE_BY_QUERY,
    ).filter((tableName: string): boolean => {
      return RecordComponents.getComponents(modelByTableName(tableName)).some(
        (component: ComponentMetadata): boolean => {
          return component.id.endsWith("-delete-many");
        },
      );
    });

    expect(withDeleteSteps.sort()).toEqual(Object.keys(NAMED_AS).sort());

    for (const tableName of withDeleteSteps) {
      expect(page).toContain(NAMED_AS[tableName]!);

      const kept: RowsKeptOnDelete = ROWS_KEPT_ON_DELETE_BY_QUERY[tableName]!;

      // Every one keeps its records' current state, and a single event can go by its id.
      expect(kept.whatStays).toContain("current");
      expect(kept.oneRowByIdCanGo).toBe(true);

      // Only a monitor's status events keep the history a status page draws.
      expect({ tableName, history: kept.keepsHistoryInEffect }).toEqual({
        tableName,
        history: tableName === "MonitorStatusTimeline",
      });
    }

    expect(page).toContain(
      `never remove a record's current state, and they keep every monitor status event that covers part of the last ${KEPT_STATUS_HISTORY_DAYS} days`,
    );

    // The run log line the steps write.
    expect(page).toContain("The run log says how many were kept.");
    expect(
      describeRowsKeptByDelete({
        count: 2,
        kept: ROWS_KEPT_ON_DELETE_BY_QUERY["MonitorStatusTimeline"]!,
        one: "Monitor Status Event",
        many: "Monitor Status Events",
      }),
    ).toContain("Kept 2 Monitor Status Events, because some always stay: ");

    expect(page).toContain(
      "To delete one particular event, query it by its `_id`.",
    );
  });
});

describe("the variables page", () => {
  it("states the rule a variable's name is held to", () => {
    expect(WORKFLOW_VARIABLE_UTIL).toContain(
      "validation: {\n      minLength: 2,\n      noSpaces: true,\n      noSpecialCharacters: true,\n    },",
    );
    // Validation says it from the shared list of form messages.
    expect(FORM_VALIDATION).toContain(
      "FormValidationMessage.NoSpecialCharacters",
    );
    expect(FormValidationMessage.NoSpecialCharacters).toContain(
      "can only contain letters, numbers, hyphens (-), and underscores (_).",
    );
    expect(VARIABLES).toContain(
      "At least two characters, no spaces, and only letters, numbers, hyphens and underscores.",
    );
  });

  it("refreshes a token a minute before it expires, and gives the token endpoint 20 seconds", () => {
    expect(OAUTH2_TOKEN_REFRESH_SKEW_IN_MS).toBe(60 * 1000);
    expect(VARIABLES).toContain(
      "If it has expired, or expires within the next minute, a new one is fetched before the step runs.",
    );
    expect(
      numberConstant(OAUTH2_TOKEN_CLIENT, "OAUTH2_TOKEN_REQUEST_TIMEOUT_IN_MS"),
    ).toBe(20 * 1000);
    expect(VARIABLES).toContain("A token request gives up after 20 seconds.");
    expect(CONFIGURATION).toContain("an OAuth 2.0 token request after 20.");
  });

  it("lists every status the Access Token card can show", () => {
    expect(
      [
        ...tableRowLabels(section(VARIABLES, "### The Access Token card")),
      ].sort(),
    ).toEqual(Object.values(OAuth2TokenStatus).sort());
  });

  it("updates a variable at the API path the model serves, with a permission that exists", () => {
    expect(WORKFLOW_VARIABLE_MODEL).toContain(
      '@CrudApiEndpoint(new Route("/workflow-variable"))',
    );
    expect(VARIABLES).toContain(
      "Send `PUT /api/workflow-variable/<variable-id>`",
    );
    expect(isPermissionTitle("Edit Workflow Variables")).toBe(true);
    expect(VARIABLES).toContain(
      "The API key needs **Edit Workflow Variables**.",
    );
  });

  /*
   * The one place a reference that did not resolve is not left as text: an
   * ID a data component reads or writes. Every data component reads its IDs
   * before anything else and stops on one that is still a reference; the
   * step says so first, and takes its Error output (logComponentError, with
   * the message as the reason the run's Steps view shows).
   */
  it("says an ID that did not resolve stops a data component, as the step itself says", () => {
    const sentence: string =
      "The exception is an ID that a data component reads or writes, such as `_id` in its **Query**: there the step stops before reading or writing anything, takes its **Error** output, and says which reference did not resolve and what to check.";

    expect(VARIABLES).toContain(sentence);

    const message: string = describeUnresolvedIdReference({
      unresolved: {
        columnName: "_id",
        reference:
          "{{local.components.incident-find-one-1.returnValues.model._id}}",
      },
      argumentName: "Query",
    });

    expect(
      message.startsWith(
        "The step stopped before reading or writing anything:",
      ),
    ).toBe(true);
    expect(message).toContain(
      '{{local.components.incident-find-one-1.returnValues.model._id}} in "Query" did not resolve',
    );
    expect(message).toContain("Check the step id and the return value name");

    for (const step of [
      "FindOne",
      "FindMany",
      "CreateOne",
      "CreateMany",
      "UpdateOne",
      "UpdateMany",
      "DeleteOne",
      "DeleteMany",
    ]) {
      const source: string = readSource(
        `Common/Server/Types/Workflow/Components/BaseModel/${step}BaseModel.ts`,
      );

      expect({
        step,
        checksIds: source.includes("assertIdsAreResolved({"),
      }).toEqual({
        step,
        checksIds: true,
      });
      expect({
        step,
        takesError: source.includes(
          "executePort: errorPort,\n        executePortReason: reason,",
        ),
      }).toEqual({ step, takesError: true });
    }
  });

  it("says no variable's value can be read back, as the model's read list makes true", () => {
    const beforeContent: string = WORKFLOW_VARIABLE_MODEL.slice(
      0,
      WORKFLOW_VARIABLE_MODEL.indexOf("public content?: string"),
    );
    const contentAccess: string = beforeContent.slice(
      beforeContent.lastIndexOf("@ColumnAccessControl({"),
    );

    expect(contentAccess).toContain("read: [],");
    expect(VARIABLES).toContain(
      "`content` is write-only over the API for every variable, secret or not.",
    );
    expect(section(CONFIGURATION, "## Secrets")).toContain(
      "No variable's value can be read back once it is saved, secret or not",
    );
  });
});

describe("the runs page", () => {
  it("explains every status a run can have, by the label the run list draws", () => {
    expect(
      [...tableRowLabels(section(RUNS, "## Run statuses"))].sort(),
    ).toEqual(
      Object.values(WorkflowStatus)
        .map((status: WorkflowStatus): string => {
          return getWorkflowStatusLabel(status);
        })
        .sort(),
    );
  });

  it("fails a run no runner picked up within 5 minutes", () => {
    expect(TIMEOUT_JOBS).toContain(
      "createdAt: QueryHelper.lessThan(OneUptimeDate.getSomeMinutesAgo(5)),\n          workflowStatus: WorkflowStatus.Scheduled,",
    );
    expect(section(RUNS, "## Run statuses")).toContain(
      "A run still scheduled after 5 minutes fails: nothing picked it up.",
    );
  });

  it("cuts long values, and keeps the last steps, as the step trace does", () => {
    const page: string = section(RUNS, "### The Steps tab");

    expect(page).toContain(
      `a value longer than ${withThousands(MAX_TRACE_VALUE_LENGTH)} characters is cut short with "${TRUNCATED_VALUE_SUFFIX}"`,
    );
    expect(page).toContain(`A run keeps its last ${MAX_TRACE_STEPS} steps`);
  });

  it("keeps runs 30 days where billing is on, as both run lists say", () => {
    expect(WORKFLOW_LOG_SERVICE).toContain(
      'if (IsBillingEnabled) {\n      this.hardDeleteItemsOlderThanInDays("createdAt", 30);',
    );

    for (const list of [
      "Pages/Workflow/Logs.tsx",
      "Pages/Workflow/View/Logs.tsx",
    ]) {
      expect(readDashboard(list)).toContain("from the last 30 days.");
    }

    expect(section(RUNS, "## How long are runs kept?")).toContain(
      "On OneUptime Cloud, runs are kept for **30 days** and then deleted",
    );
  });
});

describe("the configuration and safety page", () => {
  it("gives each plan's runs in the last 30 days", () => {
    const limits: string = section(CONFIGURATION, "## Plan limits");

    expect(tableRow(limits, "Growth")[1]).toBe(
      withThousands(WorkflowPlan.Growth),
    );
    expect(tableRow(limits, "Scale")[1]).toBe(
      withThousands(WorkflowPlan.Scale),
    );
    expect(WorkflowPlan.Enterprise).toBeGreaterThan(1_000_000);
    expect(tableRow(limits, "Enterprise")[1]).toBe("No practical limit");
  });

  /*
   * A plan that runs no workflows (Free) is said on the Builder and the
   * Workflows page (WorkflowPlanNotice), and someone who may not change a
   * workflow sees the Builder as a view (WorkflowViewOnly).
   */
  it("says a plan that runs no workflows is said in the product, and the Builder is a view for a Workflow Member", () => {
    expect(WorkflowPlan.Free).toBe(0);
    expect(readDashboard("Pages/Workflow/View/Builder.tsx")).toContain(
      "<WorkflowPlanNotice",
    );
    expect(readDashboard("Pages/Workflow/Workflows.tsx")).toContain(
      "<WorkflowPlanNotice",
    );
    expect(section(CONFIGURATION, "## Plan limits")).toContain(
      "On a plan that runs no workflows, the **Builder** and the **Workflows** page say so, with a link to upgrade.",
    );

    expect(
      readSource("Common/UI/Components/Workflow/WorkflowStatusBar.tsx"),
    ).toContain(
      'WORKFLOW_VIEW_ONLY_TEXT: string = translationKey("View only")',
    );
    expect(CONFIGURATION).toContain(
      "The **Builder** shows them a workflow as it is, marked **View only**: a step opens to be read, and nothing they do there is saved.",
    );
  });

  it("gives a run's and a script's default time, and the settings that change them", () => {
    expect(ENVIRONMENT_CONFIG).toContain(
      'process.env["WORKFLOW_TIMEOUT_IN_MS"].toString())\n  : 120000;',
    );

    const page: string = section(CONFIGURATION, "## How long a run can take");

    expect(
      tableRow(
        page,
        "A run, from its start or from waking after a **Sleep**",
      ).slice(1),
    ).toEqual(["2 minutes", "`WORKFLOW_TIMEOUT_IN_MS`"]);
    expect(
      tableRow(page, "A **Run Custom JavaScript** block").slice(1),
    ).toEqual(["5 seconds", "`WORKFLOW_SCRIPT_TIMEOUT_IN_MS`"]);
    expect(tableRow(page, "A **Sleep** block")[1]).toBe("30 days at most");
  });

  it("names only network settings the server reads", () => {
    const page: string = section(CONFIGURATION, "## Outbound network access");

    expect(PRIVATE_NETWORK_WEBHOOK_CONFIG).toContain(
      'const ALLOW_PRIVATE_NETWORK_ENV_VAR: string = "ALLOW_PRIVATE_NETWORK_WEBHOOKS";',
    );
    expect(PRIVATE_NETWORK_WEBHOOK_CONFIG).toContain(
      'const ALLOWLIST_ENV_VAR: string = "PRIVATE_NETWORK_WEBHOOK_ALLOWLIST";',
    );
    expect(EGRESS_GUARD).toContain(
      'process.env["DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES"] === "true"',
    );

    for (const variable of [
      "PRIVATE_NETWORK_WEBHOOK_ALLOWLIST",
      "ALLOW_PRIVATE_NETWORK_WEBHOOKS",
      "DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES",
    ]) {
      expect(page).toContain(`\`${variable}\``);
    }
  });

  it("names an imported copy of an existing workflow as the importer does", () => {
    expect(MODEL_IMPORT_EXPORT).toContain(" (Imported)`,");
    expect(
      section(CONFIGURATION, "## Exporting and importing workflows"),
    ).toContain('is imported with "(Imported)" after its name');
  });

  it("names roles and permissions that exist", () => {
    const page: string = section(CONFIGURATION, "## Permissions");

    for (const title of [
      "Workflow Admin",
      "Workflow Member",
      "Workflow Viewer",
      "Project Owner",
      "Project Admin",
      "Project Member",
      "Edit Workflow",
      "Delete Workflow",
      "Read Workflow Log",
    ]) {
      expect({ title, exists: isPermissionTitle(title) }).toEqual({
        title,
        exists: true,
      });
      expect(page).toContain(`**${title}**`);
    }
  });

  describe("on AI components", () => {
    const page: string = section(CONFIGURATION, "## AI components");

    it("finds the AI settings where the Project Settings menu has them", () => {
      const titles: Array<string> = menuTitles(SETTINGS_MENU);

      for (const title of ["AI", "AI Features", "LLM Providers", "AI Logs"]) {
        expect(titles).toContain(title);
      }

      expect(AI_SETTINGS_COPY).toContain(
        'switchTitle: translationKey("Enable AI"),',
      );
      expect(page).toContain(
        "**Enable AI** must be on, under **Project Settings → AI → AI Features**.",
      );
      expect(page).toContain("**Project Settings → AI → LLM Providers**");
      expect(page).toContain("**Project Settings → AI → AI Logs**");
    });

    it("asks for Growth and a paid subscription, as the step's check does", () => {
      expect(GENERATE_TEXT).toContain(
        "await AIService.assertProjectCanUseAI(options.projectId);",
      );
      expect(AI_SERVICE).toContain(
        "Your subscription is unpaid. Please update your payment method to use AI in workflows.",
      );
      expect(AI_SERVICE).toContain(
        "Please upgrade your plan to Growth to use AI in workflows.",
      );
      expect(page).toContain(
        "On OneUptime Cloud, the project also needs the Growth plan or above and a paid subscription.",
      );
    });

    it("counts a call toward the project's own daily AI limits, not the retired autonomous budget", () => {
      expect(PROJECT_AI_DAILY_LIMITS).toContain(
        "insight triage, workflows, runbooks and",
      );
      expect(AI_SERVICE).toContain(
        "// Subjectless autonomous work has no daily token limit.",
      );
      expect(page).toContain(
        "Every call counts toward the [project's own daily AI limits](/docs/ai/ai-sre#the-projects-own-daily-limits)",
      );
      expect(page).not.toMatch(AUTONOMOUS);
    });

    it("gives the step's limits as the step enforces them", () => {
      expect(
        tableRow(
          page,
          "**System Instructions**, **Prompt** and **Context** together",
        )[1],
      ).toBe(
        `${withThousands(numberConstant(GENERATE_TEXT, "MAX_WORKFLOW_AI_INPUT_CHARACTERS"))} characters`,
      );
      expect(tableRow(page, "**Temperature**")[1]).toBe(
        `From \`${numberConstant(GENERATE_TEXT, "MIN_WORKFLOW_AI_TEMPERATURE")}\` to \`${numberConstant(GENERATE_TEXT, "MAX_WORKFLOW_AI_TEMPERATURE")}\``,
      );
      expect(tableRow(page, "**Maximum Output Tokens**")[1]).toBe(
        `From \`${numberConstant(GENERATE_TEXT, "MIN_WORKFLOW_AI_MAX_OUTPUT_TOKENS")}\` to \`${numberConstant(GENERATE_TEXT, "MAX_WORKFLOW_AI_MAX_OUTPUT_TOKENS")}\`, \`${numberConstant(GENERATE_TEXT, "DEFAULT_WORKFLOW_AI_MAX_OUTPUT_TOKENS")}\` by default`,
      );
      expect(tableRow(page, "One request")[1]).toBe(
        `Tried once, for ${numberConstant(GENERATE_TEXT, "MAX_WORKFLOW_AI_REQUEST_TIMEOUT_IN_MS") / 1000} seconds at most`,
      );
      expect(tableRow(page, "Calls at the same time")[1]).toContain(
        `${numberConstant(GENERATE_TEXT, "MAX_CONCURRENT_WORKFLOW_AI_CALLS_PER_PROJECT")} per project. Any more take **Error**`,
      );
    });

    it("names the step's settings and values by the names the step gives them", () => {
      const ai: ComponentMetadata = component(ComponentID.AIGenerateText);

      for (const name of [
        "System Instructions",
        "Prompt",
        "Context",
        "Temperature",
        "Maximum Output Tokens",
      ]) {
        expect(settingNames(ai)).toContain(name);
        expect(page).toContain(`**${name}**`);
      }

      for (const name of ["Response", "LLM Log ID", "Error"]) {
        expect(returnValueNames(ai)).toContain(name);
        expect(page).toContain(`**${name}**`);
      }
    });
  });
});
