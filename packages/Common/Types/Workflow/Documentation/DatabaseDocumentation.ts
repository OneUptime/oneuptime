/*
 * Help for the eleven steps generated for every model a workflow can use:
 * Find, Create, Update and Delete (one and many), and the On Create, On Update
 * and On Delete triggers.
 *
 * This used to be five Markdown files shared by all 227 models, which is why
 * Create One Incident explained "Create Many" and On Delete described a Select
 * Fields setting it does not have. Each operation now has its own help, named
 * for the model and built from its real fields: the example on Find One
 * Incident reads the incident's title, and an Update step's query picks the
 * very record the workflow's trigger handed on, by that trigger's identifier.
 */

import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { JSONObject } from "../../JSON";
import { NodeDataProp } from "../Component";
import {
  CUSTOM_FIELDS_COLUMN,
  hasCustomFieldsColumn,
} from "../CustomFieldsColumn";
import { DatabaseOperation, getDatabaseOperation } from "../DatabaseOperation";
import { componentReturnValueReference } from "../TemplateSyntax";
import ComponentDocumentation, {
  ComponentDocumentationExample,
  ComponentDocumentationLink,
  ComponentDocumentationNoteType,
  ComponentDocumentationTopic,
} from "./ComponentDocumentation";
import {
  ComponentDocumentationContext,
  findRecordStep,
  ownReference,
} from "./DocumentationContext";
import {
  WorkflowDocsPaths,
  docsLink,
  modelReferenceLink,
} from "./DocumentationLinks";
import {
  EXAMPLE_ID,
  ExampleColumn,
  ID_COLUMN_ID,
  getDisplayColumn,
  getExampleRecord,
  getExampleUpdate,
  getRequiredCreateColumns,
  getWorkflowModel,
} from "./ModelExamples";

/*
 * Which of the eleven generated steps a component is, read off the end of
 * its id. It lives in Types/Workflow/DatabaseOperation so the Add Component
 * picker can use it without loading this help; re-exported here for the
 * code and tests that have always imported it from this file.
 */
export { DatabaseOperation, getDatabaseOperation };
export type { GetDatabaseOperationFunction } from "../DatabaseOperation";

/*
 * The words every page uses for the model. No sentence puts "a" or "an" in
 * front of a model's name: which one is right depends on how the name is
 * said (an Incident, a User, an SMS Log), and no rule on its letters gets
 * every one of 227 models right. "one", "the", "each" and "new" read the
 * same in front of any of them.
 */
interface ModelWords {
  model: BaseModel;
  /** "Incident" */
  one: string;
  /** "Incidents" */
  many: string;
  /** The column that names a record, or the ID. */
  display: ExampleColumn;
}

type FormatJSONFunction = (value: JSONObject | Array<JSONObject>) => string;

// One line for a small object, so an example is read at a glance.
const formatJSON: FormatJSONFunction = (
  value: JSONObject | Array<JSONObject>,
): string => {
  return JSON.stringify(value).replace(/":/g, '": ').replace(/,"/g, ', "');
};

type QueryExampleFunction = (data: {
  context: ComponentDocumentationContext;
  words: ModelWords;
  /*
   * Whether picking one record by its ID is the usual case. It is for the
   * One steps; the Many steps match on a field instead.
   */
  isOneRecord: boolean;
}) => ComponentDocumentationExample;

/*
 * What a Query looks like here. Where another step in this workflow hands on
 * one of these records, the query picks that record by its ID - which is how
 * these steps are mostly used: "update the incident that was just created".
 * Otherwise it matches on the field that names a record.
 */
const queryExample: QueryExampleFunction = (data: {
  context: ComponentDocumentationContext;
  words: ModelWords;
  isOneRecord: boolean;
}): ComponentDocumentationExample => {
  const recordStep: NodeDataProp | null = findRecordStep(
    data.context,
    data.words.model.tableName || "",
  );
  const hasNamingField: boolean = data.words.display.id !== ID_COLUMN_ID;

  if (recordStep && (data.isOneRecord || !hasNamingField)) {
    return {
      title: `Query: the ${data.words.one} from ${recordStep.id}`,
      code: formatJSON({
        [ID_COLUMN_ID]: componentReturnValueReference(recordStep.id, "model", [
          ID_COLUMN_ID,
        ]),
      }),
      description: `Picks the ${data.words.one} that \`${recordStep.id}\` handed on, by its ID.`,
    };
  }

  if (hasNamingField) {
    return {
      title: `Query: by ${data.words.display.title.toLowerCase()}`,
      code: formatJSON({ [data.words.display.id]: data.words.display.example }),
      description: "Keys are field names. Every key must match.",
    };
  }

  return {
    title: "Query: by ID",
    code: formatJSON({ [ID_COLUMN_ID]: EXAMPLE_ID }),
    description: `Put in the ID of the ${data.words.one}.`,
  };
};

type ModelLinksFunction = (
  words: ModelWords,
) => Array<ComponentDocumentationLink>;

const modelLinks: ModelLinksFunction = (
  words: ModelWords,
): Array<ComponentDocumentationLink> => {
  return [
    modelReferenceLink(words.model),
    docsLink("Working with records", WorkflowDocsPaths.records),
  ];
};

type TriggerLinksFunction = (
  words: ModelWords,
) => Array<ComponentDocumentationLink>;

const triggerLinks: TriggerLinksFunction = (
  words: ModelWords,
): Array<ComponentDocumentationLink> => {
  return [
    modelReferenceLink(words.model),
    docsLink("Record triggers guide", WorkflowDocsPaths.eventTriggers),
  ];
};

type TopicFunction = (words: ModelWords) => ComponentDocumentationTopic;

const whenItFailsTopic: TopicFunction = (
  words: ModelWords,
): ComponentDocumentationTopic => {
  return {
    title: "When it fails",
    paragraphs: [
      `The step takes **Error** and the run's log says why. If a key in **Query** is not one of the ${words.one}'s fields, the log lists the fields it does have.`,
    ],
  };
};

const thisProjectOnlyTopic: TopicFunction = (
  words: ModelWords,
): ComponentDocumentationTopic => {
  return {
    title: "Only this project",
    paragraphs: [
      `A query only ever matches ${words.many} in the project this workflow belongs to, so you never add the project to it yourself.`,
    ],
  };
};

const idSpellingTopic: TopicFunction = (
  words: ModelWords,
): ComponentDocumentationTopic => {
  return {
    title: "Writing the query as JSON",
    paragraphs: [
      `Keys are the ${words.one}'s field names, and its ID is \`_id\` (\`id\` works too). A value can be a reference to another step's value.`,
    ],
  };
};

type BuildFunction = (
  context: ComponentDocumentationContext,
  words: ModelWords,
) => ComponentDocumentation;

const findOne: BuildFunction = (
  context: ComponentDocumentationContext,
  words: ModelWords,
): ComponentDocumentation => {
  return {
    summary: `Finds one ${words.one} in this project and passes it to the next steps.`,
    steps: [
      `Under **Query**, add what the ${words.one} must match.`,
      "Under **Select Fields**, choose the fields later steps need. Only those come back.",
      "Connect **Success** to what runs next, and **Error** to handle a failure.",
    ],
    examples: [
      {
        title: `Read a field of the ${words.one} it found`,
        code: ownReference(context, "model", [words.display.id]),
        description:
          words.display.id === ID_COLUMN_ID
            ? undefined
            : `\`${words.display.id}\` must be one of the **Select Fields**.`,
      },
    ],
    notes: [
      {
        type: ComponentDocumentationNoteType.Tip,
        text: `Finding nothing is not an error: the step still takes **Success**, with no ${words.one}. Check for that with an **If / Else** step.`,
      },
    ],
    learnMore: [
      {
        ...idSpellingTopic(words),
        example: queryExample({ context, words, isOneRecord: true }),
      },
      thisProjectOnlyTopic(words),
      whenItFailsTopic(words),
    ],
    links: modelLinks(words),
  };
};

const findMany: BuildFunction = (
  context: ComponentDocumentationContext,
  words: ModelWords,
): ComponentDocumentation => {
  return {
    summary: `Finds the ${words.many} in this project that match a query, and passes them to the next steps as a list.`,
    steps: [
      `Under **Query**, add what the ${words.many} must match.`,
      "Under **Select Fields**, choose the fields later steps need. Only those come back.",
      "Connect **Success** to what runs next, and **Error** to handle a failure.",
    ],
    examples: [
      {
        title: `Read a field of the first ${words.one} found`,
        code: ownReference(context, "models[0]", [words.display.id]),
        description: "`[0]` is the first in the list, `[1]` the second.",
      },
    ],
    notes: [
      {
        type: ComponentDocumentationNoteType.Tip,
        text: `It returns at most 10 ${words.many}. Change that with **Limit**, under the advanced settings.`,
      },
    ],
    learnMore: [
      {
        title: `Using every ${words.one} in a message`,
        paragraphs: [
          "A message can repeat a line for each item in the list. Inside the loop, a field name on its own reads that item's field.",
        ],
        example: {
          title: "One line per item",
          code: `{{#each local.components.${context.stepId}.returnValues.models}}\n- {{${words.display.id}}}\n{{/each}}`,
        },
      },
      {
        ...idSpellingTopic(words),
        example: queryExample({ context, words, isOneRecord: false }),
      },
      thisProjectOnlyTopic(words),
      whenItFailsTopic(words),
    ],
    links: [
      ...modelLinks(words),
      docsLink("Looping over a list", WorkflowDocsPaths.loops),
    ],
  };
};

const createOne: BuildFunction = (
  context: ComponentDocumentationContext,
  words: ModelWords,
): ComponentDocumentation => {
  const required: Array<ExampleColumn> = getRequiredCreateColumns(words.model);

  return {
    summary: `Creates one ${words.one} in this project each time it runs.`,
    steps: [
      required.length > 0
        ? `Under **JSON Object**, fill in the ${words.one}'s fields. The ones it needs come first.`
        : `Under **JSON Object**, add the ${words.one}'s fields with **Add a field**.`,
      "Connect **Success** to what runs next, and **Error** to handle a failure.",
      `Use the new ${words.one} in later steps, starting with its ID.`,
    ],
    examples: [
      {
        title: `The new ${words.one}'s ID`,
        code: ownReference(context, "model", [ID_COLUMN_ID]),
      },
    ],
    notes: [
      {
        type: ComponentDocumentationNoteType.Tip,
        text: `The ${words.one} is always created in this workflow's project. There is no project to set.`,
      },
      {
        type: ComponentDocumentationNoteType.Warning,
        text: `A key that is not one of the ${words.one}'s fields is skipped, and the run's log names it. A missing required field takes **Error**.`,
      },
    ],
    learnMore: [
      {
        title: "Writing it as JSON",
        paragraphs: [
          "**Edit as JSON** shows the same fields as one JSON object, keyed by field name. A value can be a reference to another step's value.",
        ],
        example: {
          title: `One ${words.one}`,
          code: formatJSON(getExampleRecord(words.model)),
        },
      },
    ],
    links: modelLinks(words),
  };
};

const createMany: BuildFunction = (
  context: ComponentDocumentationContext,
  words: ModelWords,
): ComponentDocumentation => {
  const required: Array<ExampleColumn> = getRequiredCreateColumns(words.model);

  return {
    summary: `Creates several ${words.many} in this project at once, from a list.`,
    steps: [
      `Write the list in **JSON Array**: one object per ${words.one}, keyed by field name.`,
      "Connect **Success** to what runs next, and **Error** to handle a failure.",
      `Use the new ${words.many} in later steps, as a list.`,
    ],
    examples: [
      {
        title: `A list of one ${words.one}`,
        code: formatJSON([getExampleRecord(words.model)]),
        description:
          required.length > 0
            ? `Every ${words.one} needs ${required
                .map((column: ExampleColumn): string => {
                  return `\`${column.id}\``;
                })
                .join(", ")}.`
            : `Add another object for each further ${words.one}.`,
      },
    ],
    notes: [
      {
        type: ComponentDocumentationNoteType.Tip,
        text: `The ${words.many} are always created in this workflow's project. There is no project to set.`,
      },
      {
        type: ComponentDocumentationNoteType.Warning,
        text: `A key that is not one of the ${words.one}'s fields is skipped, and the run's log names it. A missing required field takes **Error**.`,
      },
    ],
    learnMore: [
      {
        title: "Reading what it created",
        paragraphs: [
          `\`${ownReference(context, "models[0]", [ID_COLUMN_ID])}\` is the first new ${words.one}'s ID, \`[1]\` the second's, and so on.`,
        ],
      },
    ],
    links: modelLinks(words),
  };
};

type UpdateOrDeleteFunction = (
  context: ComponentDocumentationContext,
  words: ModelWords,
  isMany: boolean,
) => ComponentDocumentation;

type CountTopicFunction = (data: {
  context: ComponentDocumentationContext;
  words: ModelWords;
  returnValueId: "items-updated" | "items-deleted";
}) => ComponentDocumentationTopic;

// How to act on the count an update or a delete returns.
const countTopic: CountTopicFunction = (data: {
  context: ComponentDocumentationContext;
  words: ModelWords;
  returnValueId: "items-updated" | "items-deleted";
}): ComponentDocumentationTopic => {
  const isUpdate: boolean = data.returnValueId === "items-updated";

  return {
    title: "Checking whether anything matched",
    paragraphs: [
      `${isUpdate ? "**Items Updated**" : "**Items Deleted**"} says how many ${data.words.many} were ${isUpdate ? "changed" : "deleted"}. To act on a query that matched nothing, compare it with \`0\` in an **If / Else** step.`,
    ],
    example: {
      title: `How many were ${isUpdate ? "changed" : "deleted"}`,
      code: ownReference(data.context, data.returnValueId),
    },
  };
};

/*
 * What an update does to custom fields, on a model that has them. They all
 * live in one column, and the step merges into it rather than replacing it -
 * which the help has to say, because writing a whole column is what every
 * other field does.
 */
const customFieldsTopic: TopicFunction = (
  words: ModelWords,
): ComponentDocumentationTopic => {
  return {
    title: "Custom fields",
    paragraphs: [
      `\`${CUSTOM_FIELDS_COLUMN}\` holds the ${words.one}'s custom fields, each under its name. Only the ones you name change. Every other custom field keeps its value.`,
      `To clear one, set it to \`null\`. To clear them all, set \`${CUSTOM_FIELDS_COLUMN}\` itself to \`null\`.`,
    ],
    example: {
      title: "Data (JSON Object)",
      code: formatJSON({
        [CUSTOM_FIELDS_COLUMN]: { "Notification Count": 1 },
      }),
    },
  };
};

const update: UpdateOrDeleteFunction = (
  context: ComponentDocumentationContext,
  words: ModelWords,
  isMany: boolean,
): ComponentDocumentation => {
  const example: JSONObject = getExampleUpdate(words.model);

  return {
    summary: isMany
      ? `Changes the ${words.many} in this project that match a query.`
      : `Changes one ${words.one} in this project that matches a query.`,
    steps: [
      isMany
        ? `Under **Query**, say which ${words.many} to change.`
        : `Under **Query**, say which ${words.one} to change, usually by its ID.`,
      "Under **Data (JSON Object)**, set the fields to change and their new values.",
      "Connect **Success** to what runs next, and **Error** to handle a failure.",
    ],
    examples: [queryExample({ context, words, isOneRecord: !isMany })],
    notes: [
      isMany
        ? {
            type: ComponentDocumentationNoteType.Warning,
            text: `It changes at most 10 ${words.many}, however many match. Raise **Limit**, under the advanced settings, to change more.`,
          }
        : {
            type: ComponentDocumentationNoteType.Tip,
            text: `If more than one ${words.one} matches, only one is changed. Query by ID to be sure which.`,
          },
      {
        type: ComponentDocumentationNoteType.Tip,
        text: "Matching nothing is not an error: **Items Updated** is `0` and the step takes **Success**.",
      },
    ],
    learnMore: [
      {
        title: "Writing the data as JSON",
        paragraphs: [
          "**Edit as JSON** shows the fields to change as one JSON object, keyed by field name. Fields you leave out keep their values.",
        ],
        example: Object.keys(example).length
          ? { title: "Data (JSON Object)", code: formatJSON(example) }
          : undefined,
      },
      ...(hasCustomFieldsColumn(words.model) ? [customFieldsTopic(words)] : []),
      countTopic({ context, words, returnValueId: "items-updated" }),
      idSpellingTopic(words),
      thisProjectOnlyTopic(words),
      whenItFailsTopic(words),
    ],
    links: modelLinks(words),
  };
};

const remove: UpdateOrDeleteFunction = (
  context: ComponentDocumentationContext,
  words: ModelWords,
  isMany: boolean,
): ComponentDocumentation => {
  return {
    summary: isMany
      ? `Deletes the ${words.many} in this project that match a query.`
      : `Deletes one ${words.one} in this project that matches a query.`,
    steps: [
      isMany
        ? `Under **Query**, say which ${words.many} to delete.`
        : `Under **Query**, say which ${words.one} to delete, usually by its ID.`,
      "Connect **Success** to what runs next, and **Error** to handle a failure.",
    ],
    examples: [queryExample({ context, words, isOneRecord: !isMany })],
    notes: isMany
      ? [
          {
            type: ComponentDocumentationNoteType.Warning,
            text: `Deleting cannot be undone, and an empty query matches every ${words.one} in the project. It deletes at most 10 per run; raise **Limit** to delete more.`,
          },
          {
            type: ComponentDocumentationNoteType.Tip,
            text: "Matching nothing is not an error: **Items Deleted** is `0` and the step takes **Success**.",
          },
        ]
      : [
          {
            type: ComponentDocumentationNoteType.Warning,
            text: "Deleting cannot be undone. Query by ID to be sure which one goes.",
          },
          {
            type: ComponentDocumentationNoteType.Tip,
            text: "Matching nothing is not an error: **Items Deleted** is `0` and the step takes **Success**.",
          },
        ],
    learnMore: [
      countTopic({ context, words, returnValueId: "items-deleted" }),
      idSpellingTopic(words),
      thisProjectOnlyTopic(words),
      whenItFailsTopic(words),
    ],
    links: modelLinks(words),
  };
};

const onCreateOrUpdate: UpdateOrDeleteFunction = (
  context: ComponentDocumentationContext,
  words: ModelWords,
  isUpdate: boolean,
): ComponentDocumentation => {
  const event: string = isUpdate ? "changed" : "created";

  return {
    summary: isUpdate
      ? `Starts this workflow each time one of this project's ${words.many} changes.`
      : `Starts this workflow each time a new ${words.one} is created in this project.`,
    steps: [
      ...(isUpdate
        ? [
            "To run only when particular fields change, choose them in **Listen on**. Leave it empty to run on any change.",
          ]
        : []),
      `Under **Select Fields**, choose the fields of the ${words.one} later steps need.`,
      "Connect **Success** to the steps to run.",
      `Turn the workflow on. Only ${words.many} ${event} while it is on start a run.`,
    ],
    examples: [
      {
        title: `Read a field of the ${words.one} in a later step`,
        code: ownReference(context, "model", [words.display.id]),
        description:
          words.display.id === ID_COLUMN_ID
            ? undefined
            : `\`${words.display.id}\` must be one of the **Select Fields**.`,
      },
    ],
    notes: [
      {
        type: ComponentDocumentationNoteType.Warning,
        text: `A field left out of **Select Fields** is empty in later steps, even though the ${words.one} has it.`,
      },
      ...(isUpdate
        ? [
            {
              type: ComponentDocumentationNoteType.Tip,
              text: "**Listen on** cuts out noise, but it is not a guarantee: when an update does not say which fields changed, the workflow runs anyway.",
            },
          ]
        : []),
    ],
    learnMore: [
      {
        title: "Testing it",
        paragraphs: [
          `Click **Run Workflow** in the builder's toolbar and enter the ID of any ${words.one}. The workflow runs as if that ${words.one} had just been ${event}.`,
        ],
      },
    ],
    links: triggerLinks(words),
  };
};

const onDelete: BuildFunction = (
  context: ComponentDocumentationContext,
  words: ModelWords,
): ComponentDocumentation => {
  return {
    summary: `Starts this workflow each time one of this project's ${words.many} is deleted.`,
    steps: [
      "Connect **Success** to the steps to run.",
      `Turn the workflow on. Only ${words.many} deleted while it is on start a run.`,
    ],
    examples: [
      {
        title: `The deleted ${words.one}'s ID`,
        code: ownReference(context, "model", [ID_COLUMN_ID]),
      },
    ],
    notes: [
      {
        type: ComponentDocumentationNoteType.Warning,
        text: `Only the ID is passed on. The ${words.one} is already gone, so its other fields cannot be read, and a find step will not find it.`,
      },
    ],
    learnMore: [
      {
        title: "Testing it",
        paragraphs: [
          `Click **Run Workflow** in the builder's toolbar and enter the ID of any ${words.one}. The workflow runs as if that ${words.one} had just been deleted.`,
        ],
      },
    ],
    links: triggerLinks(words),
  };
};

export type GetDatabaseDocumentationFunction = (
  context: ComponentDocumentationContext,
) => ComponentDocumentation | null;

/**
 * The help for a generated database step, or null when the step is not one of
 * the eleven or its model cannot be found.
 */
export const getDatabaseDocumentation: GetDatabaseDocumentationFunction = (
  context: ComponentDocumentationContext,
): ComponentDocumentation | null => {
  const tableName: string | undefined = context.metadata.tableName;

  if (!tableName) {
    return null;
  }

  const operation: DatabaseOperation | null = getDatabaseOperation({
    componentId: context.metadata.id,
    tableName: tableName,
  });
  const model: BaseModel | null = getWorkflowModel(tableName);

  if (!operation || !model) {
    return null;
  }

  const words: ModelWords = {
    model: model,
    one: model.singularName || tableName,
    many: model.pluralName || model.singularName || tableName,
    display: getDisplayColumn(model),
  };

  switch (operation) {
    case DatabaseOperation.FindOne:
      return findOne(context, words);
    case DatabaseOperation.FindMany:
      return findMany(context, words);
    case DatabaseOperation.CreateOne:
      return createOne(context, words);
    case DatabaseOperation.CreateMany:
      return createMany(context, words);
    case DatabaseOperation.UpdateOne:
      return update(context, words, false);
    case DatabaseOperation.UpdateMany:
      return update(context, words, true);
    case DatabaseOperation.DeleteOne:
      return remove(context, words, false);
    case DatabaseOperation.DeleteMany:
      return remove(context, words, true);
    case DatabaseOperation.OnCreate:
      return onCreateOrUpdate(context, words, false);
    case DatabaseOperation.OnUpdate:
      return onCreateOrUpdate(context, words, true);
    case DatabaseOperation.OnDelete:
      return onDelete(context, words);
  }
};
