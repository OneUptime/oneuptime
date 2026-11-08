import Entities, {
  getModelTypeByName,
} from "../../../../Models/DatabaseModels/Index";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Workflow from "../../../../Models/DatabaseModels/Workflow";
import { ColumnAccessControl } from "../../../../Types/BaseDatabase/AccessControl";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import WriteSource from "../../../../Types/BaseDatabase/WriteSource";
import { getCustomFieldRecordKind } from "../../../../Types/CustomField/CustomFieldRecordKinds";
import {
  CustomFieldDropdownOption,
  parseCustomFieldDropdownOptions,
} from "../../../../Types/CustomField/CustomFieldDropdownOption";
import {
  TableColumnMetadata,
  getTableColumns,
} from "../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import Dictionary from "../../../../Types/Dictionary";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ConflictException from "../../../../Types/Exception/ConflictException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import { AIChatCitationTargetType } from "../../../../Types/AI/AIChatTypes";
import {
  AIChatRecordKnown,
  AIChatRecordSeen,
  AIChatRecordSeenType,
  getAIChatRecordKnown,
} from "../../../../Types/AI/AIChatRecordSeen";
import AIChatPageContextType from "../../../../Types/AI/AIChatPageContext";
import {
  AI_ACTION_CARD_FACTS,
  AI_ACTION_CARD_KINDS,
  AI_ACTION_CARD_LINES,
  AI_ACTION_LINES,
  AI_ACTION_TERMS,
  AI_ACTION_TITLES,
  AIActionCardFact,
  AIActionSentence,
  aiActionCardFact,
  aiActionSentence,
  aiActionTerm,
} from "../../../../Types/AI/AIActionWords";
import ComponentMetadata, {
  Argument,
  ArgumentChoice,
  ComponentType,
  NodeDataProp,
  Port,
  ReturnValue,
} from "../../../../Types/Workflow/Component";
import BuiltInComponents from "../../../../Types/Workflow/Components";
import BaseModelComponentFactory from "../../../../Types/Workflow/Components/BaseModel";
import { getLinkedRecordColumn } from "../../../../Types/Workflow/LinkedRecord";
import { isSystemColumnId } from "../../../../Types/Workflow/SystemColumns";
import {
  WorkflowDraft,
  WorkflowDraftChanges,
  WorkflowDraftStep,
  buildGraphFromDraft,
  checkWorkflowDraft,
  describeDraftChanges,
  getDraftFromGraph,
  readWorkflowDraft,
} from "../../../../Types/Workflow/WorkflowDraft";
import { WORKFLOW_DRAFT_PROPOSED_ON_KEY } from "../../../../Types/Workflow/WorkflowDraftProposedOnKey";
import {
  WorkflowDraftDigestFunction,
  WorkflowDraftProposedOn,
  WorkflowDraftRebase,
  WorkflowDraftRebaseKind,
  proposeWorkflowDraft,
  readWorkflowDraftProposedOn,
  rebaseWorkflowDraft,
} from "../../../../Types/Workflow/WorkflowDraftRebase";
import {
  WorkflowStepsUndone,
  findWorkflowStepsUndoneUnseen,
  seeWorkflowParts,
  seeWorkflowPartsSaved,
} from "../../../../Types/Workflow/WorkflowDraftSeen";
import {
  WORKFLOW_GRAPH_REVISION_KEY,
  readWorkflowGraphRevision,
} from "../../../../Types/Workflow/WorkflowGraphRevision";
import lintWorkflowGraph, {
  LintGraphEdge,
  LintGraphNode,
  WorkflowLintIssue,
  WorkflowLintResult,
  WorkflowLintRule,
} from "../../../../UI/Components/Workflow/GraphLint";
import UUID from "../../../../Utils/UUID";
import AlertCustomFieldService from "../../../Services/AlertCustomFieldService";
import IncidentCustomFieldService from "../../../Services/IncidentCustomFieldService";
import InventoryItemCustomFieldService from "../../../Services/InventoryItemCustomFieldService";
import MonitorCustomFieldService from "../../../Services/MonitorCustomFieldService";
import OnCallDutyPolicyCustomFieldService from "../../../Services/OnCallDutyPolicyCustomFieldService";
import ScheduledMaintenanceCustomFieldService from "../../../Services/ScheduledMaintenanceCustomFieldService";
import SecurityCaseCustomFieldService from "../../../Services/SecurityCaseCustomFieldService";
import StatusPageCustomFieldService from "../../../Services/StatusPageCustomFieldService";
import TeamCustomFieldService from "../../../Services/TeamCustomFieldService";
import TeamMemberCustomFieldService from "../../../Services/TeamMemberCustomFieldService";
import WorkflowService from "../../../Services/WorkflowService";
import TokenSigningKey from "../../TokenSigningKey";
import {
  ObservabilityTool,
  PreparedMutation,
  ToolArgs,
  ToolContext,
  ToolExecutionResult,
} from "./ToolTypes";
import WidgetBuilder from "./WidgetBuilder";
import crypto from "crypto";

/*
 * ASK AI BUILDS A WORKFLOW, AND CHANGES ONE.
 *
 * https://github.com/OneUptime/oneuptime/issues/5945. Two reads - what steps
 * there are, and whether a draft holds together - and two writes.
 *
 * The writes are the ones the dashboard makes: WorkflowService.create and
 * updateOneById with the person's props, so what they may not do in the
 * Builder, this does not do, and the trigger is denormalized and a schedule
 * registered as for any other save. The conversation's permission mode gates
 * them like every other change (Toolbox/Index).
 *
 * A new workflow starts turned off, and nothing here turns one on. A person
 * reads it in the Builder and flips the switch: a workflow is a thing that acts
 * on its own afterwards, with nobody watching, and the first time it does should
 * be someone's decision. A secret is never asked for in chat either: the setting
 * is left empty, and the Builder's own checks say which to fill in.
 */

/*
 * Derived from the model's ACL so the gates can never drift from RBAC, and
 * resolved lazily: this module is pulled in through the service import graph
 * before the model classes are wired up.
 */
const resolveReadPermissions: () => Array<Permission> =
  (): Array<Permission> => {
    return new Workflow().getReadPermissions();
  };

const resolveCreatePermissions: () => Array<Permission> =
  (): Array<Permission> => {
    return new Workflow().getCreatePermissions();
  };

const resolveUpdatePermissions: () => Array<Permission> =
  (): Array<Permission> => {
    return new Workflow().getUpdatePermissions();
  };

let cachedCatalog: Map<string, ComponentMetadata> | null = null;

/*
 * Everything a workflow can be made of: the built-in steps, and each model's
 * record steps and triggers. Built once, on first use: the models must be loaded.
 */
const getCatalog: () => Map<string, ComponentMetadata> = (): Map<
  string,
  ComponentMetadata
> => {
  if (cachedCatalog) {
    return cachedCatalog;
  }

  const catalog: Map<string, ComponentMetadata> = new Map<
    string,
    ComponentMetadata
  >();

  for (const component of BuiltInComponents) {
    catalog.set(component.id, component);
  }

  for (const model of Entities) {
    for (const component of BaseModelComponentFactory.getComponents(
      new model(),
    )) {
      catalog.set(component.id, component);
    }
  }

  cachedCatalog = catalog;

  return catalog;
};

export const getWorkflowComponent: (
  componentId: string,
) => ComponentMetadata | undefined = (
  componentId: string,
): ComponentMetadata | undefined => {
  return getCatalog().get(componentId);
};

const MAX_SEARCH_RESULTS: number = 25;
const MAX_COMPONENTS_IN_DETAIL: number = 8;
const MAX_RECORD_COLUMNS: number = 80;
const MAX_ISSUES_TOLD: number = 30;
const MAX_WORKFLOW_NAME_LENGTH: number = 100;
const MAX_WORKFLOW_DESCRIPTION_LENGTH: number = 500;

type SearchComponentsFunction = (
  query: string,
  trigger?: boolean | undefined,
) => Array<ComponentMetadata>;

/*
 * The steps a search finds, the best first. Every word of it has to be found
 * somewhere: "incident create" should not bring up every step with either word.
 * There are thousands of record steps, so a title counts for most.
 */
export const searchWorkflowComponents: SearchComponentsFunction = (
  query: string,
  trigger?: boolean | undefined,
): Array<ComponentMetadata> => {
  const asked: string = query.trim().toLowerCase();
  const words: Array<string> = asked
    .split(/\s+/)
    .filter((word: string): boolean => {
      return word.length > 0;
    });

  const scored: Array<{ component: ComponentMetadata; score: number }> = [];

  for (const component of getCatalog().values()) {
    const isTrigger: boolean =
      component.componentType === ComponentType.Trigger;

    if (trigger !== undefined && trigger !== isTrigger) {
      continue;
    }

    const title: string = component.title.toLowerCase();
    const id: string = component.id.toLowerCase();
    const category: string = (component.category || "").toLowerCase();
    const description: string = (component.description || "").toLowerCase();

    let score: number = 0;
    let isEveryWordFound: boolean = true;

    for (const word of words) {
      const found: number =
        (title.includes(word) ? 4 : 0) +
        (id.includes(word) ? 3 : 0) +
        (category.includes(word) ? 2 : 0) +
        (description.includes(word) ? 1 : 0);

      if (found === 0) {
        isEveryWordFound = false;
        break;
      }

      score += found;
    }

    if (isEveryWordFound) {
      /*
       * What was asked for by its own name comes first, and a built-in step
       * before the many a record's name happens to contain the word in.
       */
      scored.push({
        component: component,
        score:
          score +
          (title === asked || id === asked ? 100 : 0) +
          (component.tableName ? 0 : 1),
      });
    }
  }

  return scored
    .sort(
      (
        a: { component: ComponentMetadata; score: number },
        b: { component: ComponentMetadata; score: number },
      ): number => {
        return (
          b.score - a.score ||
          a.component.title.localeCompare(b.component.title)
        );
      },
    )
    .map((item: { component: ComponentMetadata }): ComponentMetadata => {
      return item.component;
    });
};

type DescribeSettingFunction = (argument: Argument) => JSONObject;

const describeSetting: DescribeSettingFunction = (
  argument: Argument,
): JSONObject => {
  return {
    id: argument.id,
    name: argument.name,
    type: argument.type,
    required: argument.required,
    description: argument.description,
    ...(argument.placeholder ? { example: argument.placeholder } : {}),
    ...(argument.choices
      ? {
          choices: argument.choices.map((choice: ArgumentChoice): string => {
            return choice.value;
          }),
        }
      : {}),
    ...(argument.linkedTable ? { takesIdOf: argument.linkedTable } : {}),
    ...(argument.shownWhen
      ? {
          onlyWhen: {
            setting: argument.shownWhen.argumentId,
            isOneOf: argument.shownWhen.values,
          },
        }
      : {}),
  };
};

type DescribeRecordColumnsFunction = (tableName: string) => Array<string>;

/*
 * The columns a step of this table's record can be given, as the editor lists
 * them, each in a few words: "title: Text, required", "labels: takes IDs of
 * Label". A record can have eighty, and this is read on every call that asks.
 */
const describeRecordColumns: DescribeRecordColumnsFunction = (
  tableName: string,
): Array<string> => {
  const modelType: { new (): BaseModel } | null = getModelTypeByName(tableName);

  if (!modelType) {
    return [];
  }

  const model: BaseModel = new modelType();
  const columns: Dictionary<TableColumnMetadata> = getTableColumns(model);
  // The project: the run fills it in, whatever a step says.
  const tenantColumn: string | null = model.getTenantColumn();
  const rows: Array<string> = [];

  for (const columnId of Object.keys(columns)) {
    if (
      rows.length >= MAX_RECORD_COLUMNS ||
      isSystemColumnId(columnId) ||
      columnId === tenantColumn ||
      (tenantColumn &&
        columns[columnId]!.manyToOneRelationColumn === tenantColumn)
    ) {
      continue;
    }

    const column: TableColumnMetadata = columns[columnId]!;
    const access: ColumnAccessControl | null =
      model.getColumnAccessControlFor(columnId);

    if (!access || (access.create.length === 0 && access.update.length === 0)) {
      continue;
    }

    const linksTo: string | undefined = getLinkedRecordColumn(
      model,
      columnId,
    )?.tableName;

    // A relation is written through its own ID column, unless it lists records.
    if (
      !linksTo &&
      (column.type === TableColumnType.Entity ||
        column.type === TableColumnType.EntityArray)
    ) {
      continue;
    }

    rows.push(
      `${columnId}: ${linksTo ? `takes the ID of a ${linksTo}` : column.type}${column.required ? ", required" : ""}`,
    );
  }

  return rows;
};

interface CustomFieldDefinitionRow {
  name?: string | undefined;
  customFieldType?: string | undefined;
  dropdownOptions?: string | undefined;
}

type ReadCustomFieldDefinitionsFunction = (
  ctx: ToolContext,
) => Promise<Array<CustomFieldDefinitionRow>>;

/*
 * Read with the person's props, as the Builder lists them, in the order it does:
 * only an incident's custom fields have an order of their own. Written out rather
 * than looked up, so the service each table reads through is plain to see.
 */
export const CUSTOM_FIELD_READERS: Dictionary<ReadCustomFieldDefinitionsFunction> =
  {
    IncidentCustomField: async (ctx: ToolContext) => {
      return await IncidentCustomFieldService.findBy({
        query: { projectId: ctx.projectId },
        select: { name: true, customFieldType: true, dropdownOptions: true },
        sort: { sortOrder: SortOrder.Ascending },
        limit: 100,
        skip: 0,
        props: ctx.props,
      });
    },
    AlertCustomField: async (ctx: ToolContext) => {
      return await AlertCustomFieldService.findBy({
        query: { projectId: ctx.projectId },
        select: { name: true, customFieldType: true, dropdownOptions: true },
        sort: { createdAt: SortOrder.Ascending },
        limit: 100,
        skip: 0,
        props: ctx.props,
      });
    },
    MonitorCustomField: async (ctx: ToolContext) => {
      return await MonitorCustomFieldService.findBy({
        query: { projectId: ctx.projectId },
        select: { name: true, customFieldType: true, dropdownOptions: true },
        sort: { createdAt: SortOrder.Ascending },
        limit: 100,
        skip: 0,
        props: ctx.props,
      });
    },
    ScheduledMaintenanceCustomField: async (ctx: ToolContext) => {
      return await ScheduledMaintenanceCustomFieldService.findBy({
        query: { projectId: ctx.projectId },
        select: { name: true, customFieldType: true, dropdownOptions: true },
        sort: { createdAt: SortOrder.Ascending },
        limit: 100,
        skip: 0,
        props: ctx.props,
      });
    },
    StatusPageCustomField: async (ctx: ToolContext) => {
      return await StatusPageCustomFieldService.findBy({
        query: { projectId: ctx.projectId },
        select: { name: true, customFieldType: true, dropdownOptions: true },
        sort: { createdAt: SortOrder.Ascending },
        limit: 100,
        skip: 0,
        props: ctx.props,
      });
    },
    OnCallDutyPolicyCustomField: async (ctx: ToolContext) => {
      return await OnCallDutyPolicyCustomFieldService.findBy({
        query: { projectId: ctx.projectId },
        select: { name: true, customFieldType: true, dropdownOptions: true },
        sort: { createdAt: SortOrder.Ascending },
        limit: 100,
        skip: 0,
        props: ctx.props,
      });
    },
    TeamCustomField: async (ctx: ToolContext) => {
      return await TeamCustomFieldService.findBy({
        query: { projectId: ctx.projectId },
        select: { name: true, customFieldType: true, dropdownOptions: true },
        sort: { createdAt: SortOrder.Ascending },
        limit: 100,
        skip: 0,
        props: ctx.props,
      });
    },
    TeamMemberCustomField: async (ctx: ToolContext) => {
      return await TeamMemberCustomFieldService.findBy({
        query: { projectId: ctx.projectId },
        select: { name: true, customFieldType: true, dropdownOptions: true },
        sort: { createdAt: SortOrder.Ascending },
        limit: 100,
        skip: 0,
        props: ctx.props,
      });
    },
    InventoryItemCustomField: async (ctx: ToolContext) => {
      return await InventoryItemCustomFieldService.findBy({
        query: { projectId: ctx.projectId },
        select: { name: true, customFieldType: true, dropdownOptions: true },
        sort: { createdAt: SortOrder.Ascending },
        limit: 100,
        skip: 0,
        props: ctx.props,
      });
    },
    SecurityCaseCustomField: async (ctx: ToolContext) => {
      return await SecurityCaseCustomFieldService.findBy({
        query: { projectId: ctx.projectId },
        select: { name: true, customFieldType: true, dropdownOptions: true },
        sort: { createdAt: SortOrder.Ascending },
        limit: 100,
        skip: 0,
        props: ctx.props,
      });
    },
  };

type DescribeCustomFieldsFunction = (data: {
  tableName: string;
  ctx: ToolContext;
}) => Promise<Array<JSONObject>>;

// The project's custom fields of a table's records, or none when they cannot be read.
const describeCustomFields: DescribeCustomFieldsFunction = async (data: {
  tableName: string;
  ctx: ToolContext;
}): Promise<Array<JSONObject>> => {
  const definitionTable: string | undefined = getCustomFieldRecordKind(
    data.tableName,
  )?.definitionTableName;
  const read: ReadCustomFieldDefinitionsFunction | undefined = definitionTable
    ? CUSTOM_FIELD_READERS[definitionTable]
    : undefined;

  if (!read) {
    return [];
  }

  try {
    const rows: Array<CustomFieldDefinitionRow> = await read(data.ctx);

    return rows
      .filter((row: CustomFieldDefinitionRow): boolean => {
        return Boolean(row.name?.trim());
      })
      .map((row: CustomFieldDefinitionRow): JSONObject => {
        const options: Array<CustomFieldDropdownOption> =
          parseCustomFieldDropdownOptions(row.dropdownOptions);

        return {
          name: row.name as string,
          type: row.customFieldType || "Text",
          ...(options.length > 0
            ? {
                options: options.map(
                  (option: CustomFieldDropdownOption): string => {
                    return option.value;
                  },
                ),
              }
            : {}),
        };
      });
  } catch {
    // Not listed: the person may not read them, or their plan has none.
    return [];
  }
};

type DescribeComponentFunction = (data: {
  component: ComponentMetadata;
  ctx: ToolContext;
}) => Promise<JSONObject>;

const describeComponent: DescribeComponentFunction = async (data: {
  component: ComponentMetadata;
  ctx: ToolContext;
}): Promise<JSONObject> => {
  const component: ComponentMetadata = data.component;
  const tableName: string | undefined = component.tableName;
  const customFields: Array<JSONObject> = tableName
    ? await describeCustomFields({ tableName: tableName, ctx: data.ctx })
    : [];

  return {
    id: component.id,
    title: component.title,
    kind: component.componentType,
    category: component.category,
    description: component.description,
    settings: (component.arguments || []).map(describeSetting),
    outputs: (component.outPorts || []).map((port: Port): string => {
      return port.id;
    }),
    returnValues: (component.returnValues || []).map(
      (value: ReturnValue): JSONObject => {
        return { id: value.id, name: value.name, type: value.type };
      },
    ),
    ...(tableName ? { recordColumns: describeRecordColumns(tableName) } : {}),
    ...(customFields.length > 0
      ? {
          customFields: customFields,
          customFieldsAreWritten:
            'Under the column customFields, by name: {"customFields": {"Priority": "P1"}}. A trigger or a step passes them on when its select names customFields.',
        }
      : {}),
  };
};

export const FindWorkflowComponentsTool: ObservabilityTool = {
  name: "find_workflow_components",
  description:
    "What a workflow can be made of. Pass query to search the triggers and steps by what they do, and trigger=true for triggers only. Then pass componentIds for up to 8 of them to get each one's settings, outputs and return values, and for a record step the columns of its record and the project's custom fields. Do this before writing a draft for create_workflow or update_workflow: a setting's id, an output's id and a return value's id are all read from here.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Words to find: 'incident created', 'slack message', 'if else', 'webhook'.",
      },
      trigger: {
        type: "boolean",
        description: "true for triggers only, false for steps only.",
      },
      componentIds: {
        type: "array",
        items: { type: "string" },
        description: "The components to get in full, by their id.",
      },
    },
  },
  get requiredPermissions(): Array<Permission> {
    return resolveReadPermissions();
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const componentIds: Array<string> | undefined = ToolArgs.getStringArray(
      args,
      "componentIds",
    );

    let rows: Array<JSONObject>;

    if (componentIds) {
      const unknown: Array<string> = [];
      rows = [];

      for (const componentId of componentIds.slice(
        0,
        MAX_COMPONENTS_IN_DETAIL,
      )) {
        const component: ComponentMetadata | undefined =
          getWorkflowComponent(componentId);

        if (component) {
          rows.push(
            await describeComponent({ component: component, ctx: ctx }),
          );
        } else {
          unknown.push(componentId);
        }
      }

      if (unknown.length > 0) {
        rows.push({
          notFound: unknown,
          whatToDo: "Search for them with query.",
        });
      }
    } else {
      const query: string | undefined = ToolArgs.getString(args, "query");

      if (!query) {
        throw new BadDataException(
          "Pass query to search for a component, or componentIds to read some.",
        );
      }

      rows = searchWorkflowComponents(
        query,
        ToolArgs.getBoolean(args, "trigger"),
      )
        .slice(0, MAX_SEARCH_RESULTS)
        .map((component: ComponentMetadata): JSONObject => {
          return {
            id: component.id,
            title: component.title,
            kind: component.componentType,
            category: component.category,
            description: component.description,
          };
        });
    }

    /*
     * As one document rather than rows: a row's field is cut at a few thousand
     * characters, and a step's settings cut short are settings written wrong.
     * This is the product's own catalog, with the project's custom field names:
     * nothing in it is a secret, and an example reading [redacted-ip] helps no one.
     */
    const text: string = JSON.stringify(rows);

    return {
      dataForLlm: text,
      rowCount: rows.length,
      citationLabel: "Workflow components",
      redactionCount: 0,
      isTruncated: false,
    };
  },
};

type GetLintIssuesFunction = (graph: JSONObject) => Array<WorkflowLintIssue>;

/*
 * What the Builder's own checks say of a graph, so what the model is told and
 * what the person finds when they open it are the same list.
 */
const getLintIssues: GetLintIssuesFunction = (
  graph: JSONObject,
): Array<WorkflowLintIssue> => {
  const nodes: Array<LintGraphNode> = (
    graph["nodes"] as unknown as Array<{ id: string; data: NodeDataProp }>
  ).map((node: { id: string; data: NodeDataProp }): LintGraphNode => {
    return {
      id: node.id,
      data: {
        ...node.data,
        metadata: getWorkflowComponent(
          node.data.metadataId,
        ) as ComponentMetadata,
      },
    };
  });

  const result: WorkflowLintResult = lintWorkflowGraph({
    nodes: nodes,
    edges: graph["edges"] as unknown as Array<LintGraphEdge>,
  });

  return result.issues;
};

type DescribeIssuesFunction = (issues: Array<WorkflowLintIssue>) => string;

const describeIssues: DescribeIssuesFunction = (
  issues: Array<WorkflowLintIssue>,
): string => {
  return issues
    .slice(0, MAX_ISSUES_TOLD)
    .map((issue: WorkflowLintIssue): string => {
      return `- ${issue.componentId ? `${issue.componentId}: ` : ""}${issue.message}`;
    })
    .join("\n");
};

type IsToFillInFunction = (issue: WorkflowLintIssue) => boolean;

// What a person is left to finish, as opposed to what is wrong with the draft.
const isToFillIn: IsToFillInFunction = (issue: WorkflowLintIssue): boolean => {
  return issue.rule === WorkflowLintRule.MissingRequiredArgument;
};

const STEPS_ARGUMENT_SCHEMA: JSONObject = {
  type: "array",
  description:
    "Every step, the trigger first. id is yours to choose (letters, numbers, - and _), and is how later steps read it: {{local.components.<id>.returnValues.<returnValueId>}}. componentId and the keys of arguments come from find_workflow_components. Leave a password, token or webhook URL out: a person fills those in.",
  items: {
    type: "object",
    properties: {
      id: { type: "string" },
      componentId: { type: "string" },
      arguments: { type: "object" },
    },
    required: ["id", "componentId"],
  },
};

const CONNECTIONS_ARGUMENT_SCHEMA: JSONObject = {
  type: "array",
  description:
    "What leads to what, by step id. fromOutput is the output it leaves by. It can be left out where a step has one output, or for its success output.",
  items: {
    type: "object",
    properties: {
      from: { type: "string" },
      fromOutput: { type: "string" },
      to: { type: "string" },
    },
    required: ["from", "to"],
  },
};

export const CheckWorkflowDraftTool: ObservabilityTool = {
  name: "check_workflow_draft",
  description:
    "Check a draft before asking the user to approve create_workflow or update_workflow. It changes nothing. It says what stops the draft being saved, and what the Builder would say of it: settings still to fill in, a reference to a step or value that does not exist, a step nothing leads to. Fix what it finds, except settings only the user can fill in.",
  inputSchema: {
    type: "object",
    properties: {
      steps: STEPS_ARGUMENT_SCHEMA,
      connections: CONNECTIONS_ARGUMENT_SCHEMA,
    },
    required: ["steps", "connections"],
  },
  get requiredPermissions(): Array<Permission> {
    return resolveReadPermissions();
  },
  execute: async (args: JSONObject): Promise<ToolExecutionResult> => {
    const draft: WorkflowDraft = readWorkflowDraft(args);
    const problems: Array<string> = checkWorkflowDraft({
      draft: draft,
      getComponent: getWorkflowComponent,
    });

    let text: string;

    if (problems.length > 0) {
      text = `This draft cannot be saved yet:\n${problems
        .map((problem: string): string => {
          return `- ${problem}`;
        })
        .join("\n")}`;
    } else {
      const issues: Array<WorkflowLintIssue> = getLintIssues(
        buildGraphFromDraft({
          draft: draft,
          getComponent: getWorkflowComponent,
          generateId: UUID.generate,
        }),
      );

      text =
        issues.length > 0
          ? `This draft can be saved. The Builder would say:\n${describeIssues(issues)}`
          : "This draft can be saved, and the Builder finds nothing to say of it.";
    }

    return {
      dataForLlm: text,
      rowCount: problems.length,
      citationLabel: "Workflow draft",
      redactionCount: 0,
      isTruncated: false,
    };
  },
};

type TitleOfStepFunction = (step: WorkflowDraftStep) => string;

const titleOfStep: TitleOfStepFunction = (step: WorkflowDraftStep): string => {
  return getWorkflowComponent(step.componentId)?.title || step.componentId;
};

type GetStepTitlesFunction = (draft: WorkflowDraft) => string;

// A draft's steps in the words of the Builder: the trigger, then what follows.
const describeStepTitles: GetStepTitlesFunction = (
  draft: WorkflowDraft,
): string => {
  return draft.steps.map(titleOfStep).join(", ");
};

type GetWorkflowIdFunction = (
  args: JSONObject,
  ctx: ToolContext,
) => ObjectID | undefined;

// The workflow a call is about: its workflowId, or the workflow on screen.
const getWorkflowId: GetWorkflowIdFunction = (
  args: JSONObject,
  ctx: ToolContext,
): ObjectID | undefined => {
  const named: ObjectID | undefined = ToolArgs.getObjectID(args, "workflowId");

  if (named) {
    return named;
  }

  if (
    ctx.pageContext?.type === AIChatPageContextType.Workflow &&
    ctx.pageContext.entityId &&
    ObjectID.isValidUUID(ctx.pageContext.entityId)
  ) {
    return new ObjectID(ctx.pageContext.entityId);
  }

  return undefined;
};

type ReadWorkflowNameFunction = (args: JSONObject) => string;

const readWorkflowName: ReadWorkflowNameFunction = (
  args: JSONObject,
): string => {
  const name: string | undefined = ToolArgs.getString(args, "name");

  if (!name) {
    throw new BadDataException("name is required to create a workflow.");
  }

  if (name.length > MAX_WORKFLOW_NAME_LENGTH) {
    throw new BadDataException(
      `A workflow's name can be ${MAX_WORKFLOW_NAME_LENGTH} characters at most.`,
    );
  }

  return name;
};

type AssertDraftFunction = (draft: WorkflowDraft) => void;

// What the model made a mistake in comes back to it, in words it can act on.
const assertDraftCanBeSaved: AssertDraftFunction = (
  draft: WorkflowDraft,
): void => {
  const problems: Array<string> = checkWorkflowDraft({
    draft: draft,
    getComponent: getWorkflowComponent,
  });

  if (problems.length > 0) {
    throw new BadDataException(
      `Nothing was saved. Fix these and try again: ${problems.join(" ")}`,
    );
  }
};

type DescribeSavedFunction = (data: {
  saved: string;
  id: string;
  issues: Array<WorkflowLintIssue>;
  isOn: boolean;
}) => string;

const describeSaved: DescribeSavedFunction = (data: {
  saved: string;
  id: string;
  issues: Array<WorkflowLintIssue>;
  isOn: boolean;
}): string => {
  return `${data.saved} Its id is ${data.id}.${
    data.isOn
      ? " It is turned on, so its next run uses this."
      : " It is turned off: nothing starts it until someone turns it on, with the Enabled switch at the top of its Builder. Tell the user to read it there first, and that you cannot turn it on."
  }${
    data.issues.length > 0
      ? `\nThe Builder says:\n${describeIssues(data.issues)}\nTell the user which settings they have to fill in, by step. Do not ask them for a password, token or webhook URL here.`
      : ""
  }`;
};

type GetCardFactsFunction = (data: {
  draft: WorkflowDraft;
  issues: Array<WorkflowLintIssue>;
}) => Array<AIActionCardFact>;

const getCardFacts: GetCardFactsFunction = (data: {
  draft: WorkflowDraft;
  issues: Array<WorkflowLintIssue>;
}): Array<AIActionCardFact> => {
  const toFillIn: Array<string> = data.issues
    .filter(isToFillIn)
    .map((issue: WorkflowLintIssue): string => {
      return issue.message;
    });

  return [
    aiActionCardFact(
      AI_ACTION_CARD_FACTS.workflowSteps,
      describeStepTitles(data.draft),
    ),
    ...(toFillIn.length > 0
      ? [aiActionCardFact(AI_ACTION_CARD_FACTS.toFillIn, toFillIn.join(" "))]
      : []),
  ];
};

export const CreateWorkflowTool: ObservabilityTool = {
  name: "create_workflow",
  description:
    "Create a new workflow from a draft of its steps and connections, as the user describes it. It starts turned off, and you cannot turn it on: the user reads it in the Builder and does that. Find its components with find_workflow_components, and check the draft with check_workflow_draft first. Use this when the user asks you to build, make or set up a workflow or an automation.",
  inputSchema: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: `What the workflow is called, in ${MAX_WORKFLOW_NAME_LENGTH} characters at most.`,
      },
      description: {
        type: "string",
        description: "What it does, in a sentence.",
      },
      steps: STEPS_ARGUMENT_SCHEMA,
      connections: CONNECTIONS_ARGUMENT_SCHEMA,
    },
    required: ["name", "steps", "connections"],
  },
  get requiredPermissions(): Array<Permission> {
    return resolveCreatePermissions();
  },
  isMutation: true,
  buildActionTitle: (args: JSONObject): AIActionSentence => {
    return aiActionSentence(AI_ACTION_TITLES.createWorkflow, {
      name:
        ToolArgs.getString(args, "name") ||
        aiActionTerm(AI_ACTION_TERMS.untitled),
    });
  },
  // The steps and connections read as what they are, not as a line of JSON.
  prepareMutation: async (args: JSONObject): Promise<PreparedMutation> => {
    return {
      arguments: args,
      namedArguments: ["name"],
      describedArguments: ["steps", "connections"],
      description: [
        aiActionSentence(AI_ACTION_LINES.workflowSteps, {
          steps: describeStepTitles(readWorkflowDraft(args)),
        }),
        aiActionSentence(AI_ACTION_LINES.workflowStartsOff),
      ],
    };
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const name: string = readWorkflowName(args);
    const draft: WorkflowDraft = readWorkflowDraft(args);

    assertDraftCanBeSaved(draft);

    const graph: JSONObject = buildGraphFromDraft({
      draft: draft,
      getComponent: getWorkflowComponent,
      generateId: UUID.generate,
    });

    const description: string | undefined = ToolArgs.getString(
      args,
      "description",
    )?.slice(0, MAX_WORKFLOW_DESCRIPTION_LENGTH);

    const workflow: Workflow = new Workflow();
    workflow.projectId = ctx.projectId;
    workflow.name = name;
    workflow.graph = graph;

    if (description) {
      workflow.description = description;
    }

    /*
     * As the person: what they may not create in the dashboard, this does
     * not. Saying the workflow is Ask AI's work, for its first version
     * (writeSource: attribution only, issue #6258).
     */
    const created: Workflow = await WorkflowService.create({
      data: workflow,
      props: { ...ctx.props, writeSource: WriteSource.AskAi },
    });

    const id: string = created.id!.toString();
    const issues: Array<WorkflowLintIssue> = getLintIssues(graph);

    return {
      dataForLlm: describeSaved({
        saved: `Created workflow "${name}".`,
        id: id,
        issues: issues,
        isOn: false,
      }),
      rowCount: 1,
      citationLabel: `Created workflow "${name}"`,
      citationTarget: {
        type: AIChatCitationTargetType.WorkflowBuilder,
        params: { workflowId: id },
      },
      redactionCount: 0,
      isTruncated: false,
      widget: WidgetBuilder.actionCard({
        title: "Workflow created",
        heading: name,
        words: {
          kind: aiActionTerm(AI_ACTION_CARD_KINDS.workflow),
          line: [aiActionSentence(AI_ACTION_CARD_LINES.workflowTurnedOff)],
          facts: getCardFacts({ draft: draft, issues: issues }),
        },
        link: {
          type: AIChatCitationTargetType.WorkflowBuilder,
          params: { workflowId: id },
        },
      }),
      /*
       * Ask AI knows the steps it made, as they were saved: a new workflow's
       * graph has been saved no times yet (issue #6291).
       */
      recordSeen: getWorkflowSeen({
        workflowId: id,
        graph: graph,
        revision: readWorkflowGraphRevision(created.graphRevision) ?? 0,
      }),
    };
  },
};

type ReadWorkflowToChangeFunction = (data: {
  workflowId: ObjectID;
  ctx: ToolContext;
}) => Promise<Workflow | null>;

const readWorkflowToChange: ReadWorkflowToChangeFunction = async (data: {
  workflowId: ObjectID;
  ctx: ToolContext;
}): Promise<Workflow | null> => {
  return await WorkflowService.findOneById({
    id: data.workflowId,
    select: {
      _id: true,
      name: true,
      graph: true,
      // Which graph a change is proposed on, and saved over (issue #6274).
      graphRevision: true,
      isEnabled: true,
      isArchived: true,
    },
    props: data.ctx.props,
  });
};

type ReadWorkflowToSaveFunction = (data: {
  workflowId: ObjectID;
  ctx: ToolContext;
}) => Promise<Workflow>;

// The workflow a change is saved to: one the person can read, and not archived.
const readWorkflowToSave: ReadWorkflowToSaveFunction = async (data: {
  workflowId: ObjectID;
  ctx: ToolContext;
}): Promise<Workflow> => {
  const workflow: Workflow | null = await readWorkflowToChange(data);

  if (!workflow) {
    throw new BadDataException(
      `There is no workflow ${data.workflowId.toString()} that this user can read.`,
    );
  }

  if (workflow.isArchived) {
    throw new BadDataException(
      "This workflow is archived. Ask the user to unarchive it first.",
    );
  }

  return workflow;
};

type GetGraphRevisionFunction = (workflow: Workflow) => number;

// A workflow's graph revision as read: 0 for one saved before they were counted.
const getGraphRevision: GetGraphRevisionFunction = (
  workflow: Workflow,
): number => {
  return readWorkflowGraphRevision(workflow.graphRevision) ?? 0;
};

const STEP_FINGERPRINT_KEY_LABEL: string = "workflow-draft-step-fingerprint";

// 64 bits: enough to tell a step that changed from one that did not.
const STEP_FINGERPRINT_LENGTH: number = 16;

/*
 * A step's fingerprint (WorkflowDraftRebase): what a change is proposed on
 * is kept in its arguments, and so goes back to the model with the change,
 * and the text is a step's settings as saved, a secret's too. So it is keyed,
 * with a key of the installation's own for this alone (TokenSigningKey).
 */
export const fingerprintWorkflowStep: WorkflowDraftDigestFunction = (
  text: string,
): string => {
  return crypto
    .createHmac("sha256", TokenSigningKey.deriveKey(STEP_FINGERPRINT_KEY_LABEL))
    .update(text, "utf8")
    .digest("hex")
    .slice(0, STEP_FINGERPRINT_LENGTH);
};

type GetWorkflowSeenFunction = (data: {
  workflowId: string;
  graph: JSONObject | null | undefined;
  revision: number;
}) => AIChatRecordSeen;

/*
 * What a result showed the model of a workflow: every step and connection
 * of it (WorkflowDraftSeen), each step by a fingerprint keyed as a change's
 * record is (fingerprintWorkflowStep), at the revision read - its steps
 * read by query_workflows, or the workflow create_workflow made. Kept with
 * the result's citation, so a change Ask AI proposes later can say what it
 * would undo that was saved since (AIChatRecordSeen, issue #6291).
 */
export const getWorkflowSeen: GetWorkflowSeenFunction = (data: {
  workflowId: string;
  graph: JSONObject | null | undefined;
  revision: number;
}): AIChatRecordSeen => {
  return {
    recordType: AIChatRecordSeenType.Workflow,
    recordId: data.workflowId,
    revision: data.revision,
    parts: seeWorkflowParts({
      graph: data.graph,
      digest: fingerprintWorkflowStep,
    }),
  };
};

// A change is made again this many times while the workflow is saved under it.
const MAX_SAVE_ATTEMPTS: number = 3;

const MAX_STEPS_NAMED: number = 5;

const PROPOSE_AGAIN: string =
  "Read the workflow again with query_workflows and includeSteps, tell the user it changed after you proposed this, and propose the change again on the workflow as it is now.";

// Why a change to a workflow's steps was not made, for the model and the person.
export const UPDATE_WORKFLOW_PROBLEMS: {
  notProposed: string;
  keptBeingSaved: string;
} = {
  /*
   * A change with no record of what it was proposed on: proposed before
   * OneUptime kept one, or one whose prepare did not run.
   */
  notProposed:
    "OneUptime cannot tell which version of this workflow this change was proposed on, so it was not made, and nothing was changed. Read the workflow again with query_workflows and includeSteps, and propose the change again.",
  keptBeingSaved: `This workflow kept being saved while this change was being made, so it was not made, and nothing was changed. ${PROPOSE_AGAIN}`,
};

type NameStepsFunction = (data: {
  stepIds: Array<string>;
  graph: JSONObject | null | undefined;
  draft: WorkflowDraft;
}) => string;

// Steps as a version's changes name them, "Log" (log-1): the first few, and how many more.
const nameSteps: NameStepsFunction = (data: {
  stepIds: Array<string>;
  graph: JSONObject | null | undefined;
  draft: WorkflowDraft;
}): string => {
  const current: WorkflowDraft = getDraftFromGraph({
    graph: data.graph,
    getComponent: getWorkflowComponent,
  });

  const named: Array<string> = data.stepIds
    .slice(0, MAX_STEPS_NAMED)
    .map((stepId: string): string => {
      const step: WorkflowDraftStep | undefined = [
        ...current.steps,
        ...data.draft.steps,
      ].find((candidate: WorkflowDraftStep): boolean => {
        return candidate.id === stepId;
      });

      return `"${step ? titleOfStep(step) : stepId}" (${stepId})`;
    });

  const more: number = data.stepIds.length - named.length;

  return more > 0 ? `${named.join(", ")} and ${more} more` : named.join(", ");
};

type DescribeConflictFunction = (steps: string) => string;

export const describeStepsChangedSince: DescribeConflictFunction = (
  steps: string,
): string => {
  return `This workflow was saved again after this change was proposed, and that save changed steps this change touches too: ${steps}. So this change was not made, and nothing was changed. ${PROPOSE_AGAIN}`;
};

type DescribeProblemsFunction = (problems: Array<string>) => string;

export const describeNotMadeOnTop: DescribeProblemsFunction = (
  problems: Array<string>,
): string => {
  return `This workflow was saved again after this change was proposed, and this change cannot be made on top of what was saved: ${problems.join(" ")} Nothing was changed. ${PROPOSE_AGAIN}`;
};

type DescribeIssueLeftFunction = (issue: WorkflowLintIssue) => string;

export const describeIssueLeftByBoth: DescribeIssueLeftFunction = (
  issue: WorkflowLintIssue,
): string => {
  return `This workflow was saved again after this change was proposed. Made on top of what was saved, this change would leave something to fix that neither had on its own: ${issue.componentId ? `${issue.componentId}: ` : ""}${issue.message} So it was not made, and nothing was changed. ${PROPOSE_AGAIN}`;
};

type DescribeUnseenFunction = (steps: string) => string;

/*
 * For the model, in a conversation that runs actions without asking: the
 * change was written from steps it read before someone saved the workflow,
 * and would undo their save, so it was not made (issue #6291).
 */
export const describeSavedSinceRead: DescribeUnseenFunction = (
  steps: string,
): string => {
  return `This workflow was saved after you last read its steps, and this change would undo what was saved since: ${steps}. So it was not made, and nothing was changed. Read the workflow again with query_workflows and includeSteps, tell the user it changed since you read it, and make your change on the workflow as it is now.`;
};

// Or it never read the steps at all.
export const describeStepsNotRead: DescribeUnseenFunction = (
  steps: string,
): string => {
  return `You have not read this workflow's steps, so this change would remove or change steps you have not seen: ${steps}. So it was not made, and nothing was changed. Read its steps with query_workflows and includeSteps first, then make your change on the workflow as it is.`;
};

// What the record of such an action says of it (resultSummary): it was not made.
export const UNSEEN_CHANGE_SUMMARIES: {
  savedSinceRead: string;
  stepsNotRead: string;
} = {
  savedSinceRead: "Not made: the workflow was saved after Ask AI read it.",
  stepsNotRead: "Not made: Ask AI had not read the workflow's steps.",
};

type TitlesOfStepsFunction = (data: {
  stepIds: Array<string>;
  graph: JSONObject | null | undefined;
  draft: WorkflowDraft;
}) => string;

// Steps by the Builder's titles for them, as the card's lines name steps.
const titlesOfSteps: TitlesOfStepsFunction = (data: {
  stepIds: Array<string>;
  graph: JSONObject | null | undefined;
  draft: WorkflowDraft;
}): string => {
  const steps: Array<WorkflowDraftStep> = [
    ...getDraftFromGraph({
      graph: data.graph,
      getComponent: getWorkflowComponent,
    }).steps,
    ...data.draft.steps,
  ];

  return data.stepIds
    .map((stepId: string): string => {
      const step: WorkflowDraftStep | undefined = steps.find(
        (candidate: WorkflowDraftStep): boolean => {
          return candidate.id === stepId;
        },
      );

      return step ? titleOfStep(step) : stepId;
    })
    .join(", ");
};

// What a change undoes of what Ask AI never saw, and what that means for it.
interface UnseenChange {
  line: AIActionSentence;
  notRunWithoutApproval: { toldModel: string; summary: string };
}

type FindUnseenChangeFunction = (data: {
  workflowId: ObjectID;
  // The workflow as it is now, read as the person.
  workflow: Workflow;
  draft: WorkflowDraft;
  // The draft built over it: the workflow as the change leaves it.
  changed: JSONObject;
  ctx: ToolContext;
}) => UnseenChange | null;

/*
 * What the change would undo that was saved after Ask AI last saw the
 * workflow's steps (issue #6291): from what the conversation showed the
 * model (ToolContext.recordsSeen) - its read, or the workflow as it created
 * or changed it itself - never from anything the model says. Null when it
 * undoes nothing of the kind: nobody saved since, only cards moved, or the
 * change leaves alone each step that was saved. Null too for a caller that
 * keeps no record of what the model saw, whose card is as it always was.
 */
const findUnseenChange: FindUnseenChangeFunction = (data: {
  workflowId: ObjectID;
  workflow: Workflow;
  draft: WorkflowDraft;
  changed: JSONObject;
  ctx: ToolContext;
}): UnseenChange | null => {
  if (!data.ctx.recordsSeen) {
    return null;
  }

  const known: AIChatRecordKnown | null = getAIChatRecordKnown({
    records: data.ctx.recordsSeen,
    recordType: AIChatRecordSeenType.Workflow,
    recordId: data.workflowId.toString(),
  });

  const undone: WorkflowStepsUndone = findWorkflowStepsUndoneUnseen({
    seen: known ? known.parts : null,
    graph: data.workflow.graph,
    changed: data.changed,
    digest: fingerprintWorkflowStep,
  });

  if (undone.partIds.length === 0) {
    return null;
  }

  const named: string = nameSteps({
    stepIds: undone.namedStepIds,
    graph: data.workflow.graph,
    draft: data.draft,
  });

  if (!known) {
    return {
      line: aiActionSentence(AI_ACTION_LINES.workflowNotRead),
      notRunWithoutApproval: {
        toldModel: `Not done: ${describeStepsNotRead(named)}`,
        summary: UNSEEN_CHANGE_SUMMARIES.stepsNotRead,
      },
    };
  }

  return {
    line: aiActionSentence(AI_ACTION_LINES.workflowUndoesSavedSince, {
      steps: titlesOfSteps({
        stepIds: undone.namedStepIds,
        graph: data.workflow.graph,
        draft: data.draft,
      }),
    }),
    notRunWithoutApproval: {
      toldModel: `Not done: ${describeSavedSinceRead(named)}`,
      summary: UNSEEN_CHANGE_SUMMARIES.savedSinceRead,
    },
  };
};

// When a graph cannot be checked at all: nothing is saved that was not checked.
const CANNOT_BE_CHECKED: string =
  "The Builder's checks could not be run on the two together.";

type DescribeKeptFunction = (kept: WorkflowDraftChanges) => string;

// For the model: what was saved since the change was proposed, and kept.
export const describeKeptSince: DescribeKeptFunction = (
  kept: WorkflowDraftChanges,
): string => {
  const parts: Array<string> = [
    ...(kept.added.length > 0 ? [`it added ${kept.added.join(", ")}`] : []),
    ...(kept.removed.length > 0
      ? [`it removed ${kept.removed.join(", ")}`]
      : []),
    ...(kept.changed.length > 0
      ? [`it changed ${kept.changed.join(", ")}`]
      : []),
  ];

  return `It had been saved again after this change was proposed${
    parts.length > 0 ? ` (${parts.join("; ")})` : ""
  }. That save changed other steps, so it was kept, and this change was made on top of it. Tell the user the workflow had changed since you proposed this, and that what was saved then was kept.`;
};

type GetIssuesByKeyFunction = (
  graph: JSONObject | null | undefined,
) => Map<string, WorkflowLintIssue> | null;

/*
 * What the Builder's checks say of a graph, each by what it says; null when
 * they cannot be run. A step of a component OneUptime no longer has is left
 * out: no check can read it.
 */
const getIssuesByKey: GetIssuesByKeyFunction = (
  graph: JSONObject | null | undefined,
): Map<string, WorkflowLintIssue> | null => {
  try {
    const nodes: Array<{ data?: NodeDataProp }> = (Array.isArray(
      graph?.["nodes"],
    )
      ? graph?.["nodes"]
      : []) as unknown as Array<{ data?: NodeDataProp }>;

    const issues: Array<WorkflowLintIssue> = getLintIssues({
      nodes: nodes.filter((node: { data?: NodeDataProp }): boolean => {
        return Boolean(
          node?.data?.metadataId && getWorkflowComponent(node.data.metadataId),
        );
      }) as unknown as JSONObject,
      edges: (Array.isArray(graph?.["edges"])
        ? graph?.["edges"]
        : []) as unknown as JSONObject,
    });

    const byKey: Map<string, WorkflowLintIssue> = new Map<
      string,
      WorkflowLintIssue
    >();

    for (const issue of issues) {
      byKey.set(
        [
          issue.rule,
          issue.componentId || "",
          issue.argumentId || "",
          issue.message,
        ].join("\u0000"),
        issue,
      );
    }

    return byKey;
  } catch {
    return null;
  }
};

type FindIssueOfRebaseFunction = (data: {
  rebased: JSONObject;
  replacing: JSONObject;
  current: JSONObject | null | undefined;
}) => WorkflowLintIssue | null | undefined;

/*
 * The first thing the Builder's checks would say of the change made on top
 * of what was saved that they say neither of the change saved as it is nor
 * of the workflow as it is: what the two changes leave between them - a
 * step one adds reading a step the other takes out, a step that runs before
 * the one it reads. Null when there is none; undefined when the checks
 * cannot be run.
 */
const findIssueOfRebase: FindIssueOfRebaseFunction = (data: {
  rebased: JSONObject;
  replacing: JSONObject;
  current: JSONObject | null | undefined;
}): WorkflowLintIssue | null | undefined => {
  const rebased: Map<string, WorkflowLintIssue> | null = getIssuesByKey(
    data.rebased,
  );
  const replacing: Map<string, WorkflowLintIssue> | null = getIssuesByKey(
    data.replacing,
  );
  const current: Map<string, WorkflowLintIssue> | null = getIssuesByKey(
    data.current,
  );

  if (!rebased || !replacing || !current) {
    return undefined;
  }

  for (const [key, issue] of rebased) {
    if (!replacing.has(key) && !current.has(key)) {
      return issue;
    }
  }

  return null;
};

// A change to a workflow's graph, as it is saved.
interface GraphChange {
  graph: JSONObject;
  // The revision of the graph it is saved over: it is saved only while the workflow is at it.
  revision: number;
  // What was saved since the change was proposed, and kept; null when nothing was.
  keptSince: WorkflowDraftChanges | null;
}

type MakeGraphChangeFunction = (data: {
  draft: WorkflowDraft;
  proposedOn: WorkflowDraftProposedOn;
  workflow: Workflow;
}) => GraphChange;

/*
 * The graph a change saves, over the workflow as it was just read. Nobody
 * saved it since the change was proposed: the draft, as the card said.
 * Somebody did: the change made on top of what they saved, when the two
 * touch different steps and leave nothing between them to fix; otherwise
 * a ConflictException, saving nothing (issue #6274).
 */
const makeGraphChange: MakeGraphChangeFunction = (data: {
  draft: WorkflowDraft;
  proposedOn: WorkflowDraftProposedOn;
  workflow: Workflow;
}): GraphChange => {
  const revision: number = getGraphRevision(data.workflow);

  // The draft saved as it is: what Ask AI saved before issue #6274.
  const replacing: JSONObject = buildGraphFromDraft({
    draft: data.draft,
    getComponent: getWorkflowComponent,
    generateId: UUID.generate,
    existingGraph: data.workflow.graph,
  });

  if (revision === data.proposedOn.graphRevision) {
    return { graph: replacing, revision: revision, keptSince: null };
  }

  const rebase: WorkflowDraftRebase = rebaseWorkflowDraft({
    draft: data.draft,
    proposedOn: data.proposedOn,
    graph: data.workflow.graph,
    getComponent: getWorkflowComponent,
    generateId: UUID.generate,
    digest: fingerprintWorkflowStep,
  });

  if (rebase.kind === WorkflowDraftRebaseKind.Conflict) {
    throw new ConflictException(
      rebase.stepIds.length > 0
        ? describeStepsChangedSince(
            nameSteps({
              stepIds: rebase.stepIds,
              graph: data.workflow.graph,
              draft: data.draft,
            }),
          )
        : describeNotMadeOnTop(rebase.problems),
    );
  }

  const issue: WorkflowLintIssue | null | undefined = findIssueOfRebase({
    rebased: rebase.graph,
    replacing: replacing,
    current: data.workflow.graph,
  });

  if (issue === undefined) {
    throw new ConflictException(describeNotMadeOnTop([CANNOT_BE_CHECKED]));
  }

  if (issue) {
    throw new ConflictException(describeIssueLeftByBoth(issue));
  }

  return {
    graph: rebase.graph,
    revision: revision,
    keptSince: describeDraftChanges({
      before: getDraftFromGraph({
        graph: replacing,
        getComponent: getWorkflowComponent,
      }),
      after: getDraftFromGraph({
        graph: rebase.graph,
        getComponent: getWorkflowComponent,
      }),
      titleOf: titleOfStep,
    }),
  };
};

type SaveGraphChangeFunction = (
  data: {
    workflowId: ObjectID;
    workflow: Workflow;
    draft: WorkflowDraft;
    proposedOn: WorkflowDraftProposedOn;
    // The rest of the change: a name, a description.
    data: Record<string, unknown>;
  },
  ctx: ToolContext,
) => Promise<{ change: GraphChange; workflow: Workflow }>;

/*
 * A change to the steps, saved only while the workflow is at the revision
 * its graph was made over (miscDataProps.graphRevision, issue #6257): a
 * save that lands in between is never replaced unseen. Refused for that, it
 * is made again over the workflow as it is then, a few times at most.
 */
const saveGraphChange: SaveGraphChangeFunction = async (
  data: {
    workflowId: ObjectID;
    workflow: Workflow;
    draft: WorkflowDraft;
    proposedOn: WorkflowDraftProposedOn;
    data: Record<string, unknown>;
  },
  ctx: ToolContext,
): Promise<{ change: GraphChange; workflow: Workflow }> => {
  let workflow: Workflow = data.workflow;

  for (let attempt: number = 1; ; attempt++) {
    const change: GraphChange = makeGraphChange({
      draft: data.draft,
      proposedOn: data.proposedOn,
      workflow: workflow,
    });

    try {
      /*
       * As the person: what they may not change in the Builder, this does
       * not. Saying the change is Ask AI's (writeSource: attribution only),
       * so the version history keeps it as a version of its own (issue
       * #6258), and the version before it is the workflow just as Ask AI
       * found it.
       */
      await WorkflowService.updateOneById({
        id: data.workflowId,
        data: { ...data.data, graph: change.graph } as never,
        miscDataProps: { [WORKFLOW_GRAPH_REVISION_KEY]: change.revision },
        props: { ...ctx.props, writeSource: WriteSource.AskAi },
      });

      return { change: change, workflow: workflow };
    } catch (error) {
      if (!(error instanceof ConflictException)) {
        throw error;
      }

      if (attempt >= MAX_SAVE_ATTEMPTS) {
        throw new ConflictException(UPDATE_WORKFLOW_PROBLEMS.keptBeingSaved);
      }
    }

    workflow = await readWorkflowToSave({
      workflowId: data.workflowId,
      ctx: ctx,
    });
  }
};

type DescribeChangesFunction = (
  changes: WorkflowDraftChanges,
) => Array<AIActionSentence>;

const describeChangesForPerson: DescribeChangesFunction = (
  changes: WorkflowDraftChanges,
): Array<AIActionSentence> => {
  return [
    ...(changes.added.length > 0
      ? [
          aiActionSentence(AI_ACTION_LINES.workflowAddsSteps, {
            steps: changes.added.join(", "),
          }),
        ]
      : []),
    ...(changes.removed.length > 0
      ? [
          aiActionSentence(AI_ACTION_LINES.workflowRemovesSteps, {
            steps: changes.removed.join(", "),
          }),
        ]
      : []),
    ...(changes.changed.length > 0
      ? [
          aiActionSentence(AI_ACTION_LINES.workflowChangesSteps, {
            steps: changes.changed.join(", "),
          }),
        ]
      : []),
  ];
};

export const UpdateWorkflowTool: ObservabilityTool = {
  name: "update_workflow",
  description:
    "Change a workflow: its name, its description, or its steps and connections. Read it first with query_workflows and includeSteps. To change the steps, pass the whole draft as it should be: a step left out is removed, and a step with the same id keeps its place on the canvas. Leave out the arguments of a step you are not changing, and it keeps them. A setting reading [hidden] or [redacted...] stays as saved. A workflow that is on takes the change at its next run. Asked from a workflow's page, workflowId can be left out. Use this when the user asks you to change, fix or add to a workflow.",
  inputSchema: {
    type: "object",
    properties: {
      workflowId: {
        type: "string",
        description:
          "The workflow to change. Defaults to the one on the user's page.",
      },
      name: { type: "string", description: "A new name." },
      description: { type: "string", description: "A new description." },
      steps: STEPS_ARGUMENT_SCHEMA,
      connections: CONNECTIONS_ARGUMENT_SCHEMA,
    },
  },
  get requiredPermissions(): Array<Permission> {
    return resolveUpdatePermissions();
  },
  isMutation: true,
  // Named by its name once the prepare has read it, as the person.
  buildActionTitle: (): AIActionSentence => {
    return aiActionSentence(AI_ACTION_TITLES.updateWorkflowUnnamed);
  },
  /*
   * The workflow on screen written out, and what the change does to its steps
   * in the Builder's words, read as the person. A workflow that is on takes the
   * change at its next run, so the card says that before anyone approves it.
   *
   * And what the change is proposed on (issue #6274): the workflow's graph
   * revision, and the fingerprints of the steps the change touches, written
   * by OneUptime into the arguments that run once it is approved - over
   * whatever the model sent, which could only make a stale change look like
   * a current one. Approved after someone saved the workflow, the change is
   * made on top of what they saved, or not at all (execute).
   *
   * And what it would undo that was saved before it was proposed, after Ask
   * AI last saw the steps (issue #6291): the model writes the draft from
   * what it read, which knows nothing of a step added since. From what the
   * conversation showed the model (ToolContext.recordsSeen), the card names
   * the steps it would take out or put back as they were, before anyone
   * approves it; in Auto-run it is not made unasked (notRunWithoutApproval).
   * It only ever adds a line: what is saved is still held to what the change
   * was proposed on, as above.
   */
  prepareMutation: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<PreparedMutation> => {
    const workflowId: ObjectID | undefined = getWorkflowId(args, ctx);
    const prepared: JSONObject = { ...args };

    delete prepared[WORKFLOW_DRAFT_PROPOSED_ON_KEY];

    if (workflowId) {
      prepared["workflowId"] = workflowId.toString();
    }

    let workflow: Workflow | null = null;

    try {
      workflow = workflowId
        ? await readWorkflowToChange({ workflowId: workflowId, ctx: ctx })
        : null;
    } catch {
      // Running the action says why it cannot be read.
    }

    const draft: WorkflowDraft | null = Array.isArray(args["steps"])
      ? readWorkflowDraft(args)
      : null;

    /*
     * Compared as they would be saved, so a setting read back hidden is no
     * change. A draft that cannot be saved says so when it runs.
     */
    const canCompare: boolean =
      Boolean(workflow && draft) &&
      checkWorkflowDraft({
        draft: draft as WorkflowDraft,
        getComponent: getWorkflowComponent,
      }).length === 0;

    let changes: Array<AIActionSentence> = [];
    // What it would undo that was saved after Ask AI saw the steps (issue #6291).
    let unseen: UnseenChange | null = null;

    if (workflowId && workflow && draft && canCompare) {
      const changed: JSONObject = buildGraphFromDraft({
        draft: draft,
        getComponent: getWorkflowComponent,
        generateId: UUID.generate,
        existingGraph: workflow.graph,
      });

      changes = describeChangesForPerson(
        describeDraftChanges({
          before: getDraftFromGraph({
            graph: workflow.graph,
            getComponent: getWorkflowComponent,
          }),
          after: getDraftFromGraph({
            graph: changed,
            getComponent: getWorkflowComponent,
          }),
          titleOf: titleOfStep,
        }),
      );

      unseen = findUnseenChange({
        workflowId: workflowId,
        workflow: workflow,
        draft: draft,
        changed: changed,
        ctx: ctx,
      });

      const proposedOn: WorkflowDraftProposedOn = proposeWorkflowDraft({
        draft: draft,
        graph: workflow.graph,
        graphRevision: getGraphRevision(workflow),
        getComponent: getWorkflowComponent,
        generateId: UUID.generate,
        digest: fingerprintWorkflowStep,
      });

      prepared[WORKFLOW_DRAFT_PROPOSED_ON_KEY] =
        proposedOn as unknown as JSONObject;
    }

    const description: Array<AIActionSentence> = [
      ...changes,
      ...(unseen ? [unseen.line] : []),
      ...(workflow?.isEnabled
        ? [aiActionSentence(AI_ACTION_LINES.workflowIsOn)]
        : []),
    ];

    return {
      arguments: prepared,
      describedArguments: ["steps", "connections"],
      ...(workflow?.name
        ? {
            title: aiActionSentence(AI_ACTION_TITLES.updateWorkflow, {
              workflow: workflow.name,
            }),
            namedArguments: ["workflowId"],
          }
        : {}),
      description: description,
      ...(unseen
        ? { notRunWithoutApproval: unseen.notRunWithoutApproval }
        : {}),
    };
  },
  execute: async (
    args: JSONObject,
    ctx: ToolContext,
  ): Promise<ToolExecutionResult> => {
    const workflowId: ObjectID | undefined = getWorkflowId(args, ctx);

    if (!workflowId) {
      throw new BadDataException(
        "workflowId is required: find it with query_workflows.",
      );
    }

    let workflow: Workflow = await readWorkflowToSave({
      workflowId: workflowId,
      ctx: ctx,
    });

    const data: Record<string, unknown> = {};
    const name: string | undefined = ToolArgs.getString(args, "name");
    const description: string | undefined = ToolArgs.getString(
      args,
      "description",
    )?.slice(0, MAX_WORKFLOW_DESCRIPTION_LENGTH);

    if (name) {
      data["name"] = readWorkflowName(args);
    }

    if (description) {
      data["description"] = description;
    }

    const draft: WorkflowDraft | null = Array.isArray(args["steps"])
      ? readWorkflowDraft(args)
      : null;

    if (draft) {
      assertDraftCanBeSaved(draft);
    }

    if (Object.keys(data).length === 0 && !draft) {
      throw new BadDataException(
        "Nothing to change: pass a name, a description, or steps and connections.",
      );
    }

    let change: GraphChange | null = null;
    // What Ask AI now knows of the steps: the ones this change wrote, as saved.
    let seen: AIChatRecordSeen | null = null;

    if (draft) {
      // OneUptime's record of what the change was proposed on, written as it was proposed.
      const proposedOn: WorkflowDraftProposedOn | null =
        readWorkflowDraftProposedOn(args[WORKFLOW_DRAFT_PROPOSED_ON_KEY]);

      if (!proposedOn) {
        throw new BadDataException(UPDATE_WORKFLOW_PROBLEMS.notProposed);
      }

      const saved: { change: GraphChange; workflow: Workflow } =
        await saveGraphChange(
          {
            workflowId: workflowId,
            workflow: workflow,
            draft: draft,
            proposedOn: proposedOn,
            data: data,
          },
          ctx,
        );

      change = saved.change;
      workflow = saved.workflow;

      /*
       * Ask AI saw the steps this change touches, and what leads to and from
       * them, as it saved them; every other part as it saw it before -
       * whatever this save kept of someone else's (issue #6291). The save
       * was held to change.revision, so it left the workflow at the next one.
       */
      seen = {
        recordType: AIChatRecordSeenType.Workflow,
        recordId: workflowId.toString(),
        revision: change.revision + 1,
        isPartial: true,
        parts: seeWorkflowPartsSaved({
          stepIds: proposedOn.steps.map((step: { id: string }): string => {
            return step.id;
          }),
          replaced: saved.workflow.graph,
          saved: change.graph,
          digest: fingerprintWorkflowStep,
        }),
      };
    } else {
      /*
       * A name or a description alone saves no graph, so it names no
       * revision: saved over whatever the workflow holds, as it always was.
       * As the person, saying the change is Ask AI's (issue #6258).
       */
      await WorkflowService.updateOneById({
        id: workflowId,
        data: data as never,
        props: { ...ctx.props, writeSource: WriteSource.AskAi },
      });
    }

    const shownName: string = name || workflow.name || "";
    const id: string = workflowId.toString();
    const graph: JSONObject | null = change ? change.graph : null;
    const issues: Array<WorkflowLintIssue> = graph ? getLintIssues(graph) : [];
    // The steps the workflow has now: with what was kept, when it was made on top of a save.
    const steps: WorkflowDraft | null = graph
      ? getDraftFromGraph({ graph: graph, getComponent: getWorkflowComponent })
      : null;
    const keptSince: WorkflowDraftChanges | null = change
      ? change.keptSince
      : null;

    return {
      dataForLlm: describeSaved({
        saved: `Updated workflow "${shownName}".${
          keptSince ? ` ${describeKeptSince(keptSince)}` : ""
        }`,
        id: id,
        issues: issues,
        isOn: Boolean(workflow.isEnabled),
      }),
      rowCount: 1,
      citationLabel: `Updated workflow "${shownName}"`,
      citationTarget: {
        type: AIChatCitationTargetType.WorkflowBuilder,
        params: { workflowId: id },
      },
      redactionCount: 0,
      isTruncated: false,
      widget: WidgetBuilder.actionCard({
        title: "Workflow updated",
        heading: shownName,
        words: {
          kind: aiActionTerm(AI_ACTION_CARD_KINDS.workflow),
          line: [
            aiActionSentence(
              workflow.isEnabled
                ? AI_ACTION_CARD_LINES.workflowOnNextRun
                : AI_ACTION_CARD_LINES.workflowTurnedOff,
            ),
            ...(keptSince
              ? [aiActionSentence(AI_ACTION_CARD_LINES.workflowSavedSinceKept)]
              : []),
          ],
          ...(steps
            ? { facts: getCardFacts({ draft: steps, issues: issues }) }
            : {}),
        },
        link: {
          type: AIChatCitationTargetType.WorkflowBuilder,
          params: { workflowId: id },
        },
      }),
      ...(seen ? { recordSeen: seen } : {}),
    };
  },
};
