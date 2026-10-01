/*
 * The values of the steps that run before the one being edited: one group per
 * step, one item per return value.
 *
 * A record (what a Find One or an On Create step returns) can be opened to its
 * fields, because the useful reference is almost never the whole record but
 * one column on it. The fields come from the model's schema, which needs a
 * request, so the loader is handed in: this file stays free of the API and can
 * be tested on its own.
 */

import { JSONObject } from "../../../../Types/JSON";
import {
  ComponentInputType,
  NodeDataProp,
  ReturnValue,
} from "../../../../Types/Workflow/Component";
import { componentReturnValueReference } from "../../../../Types/Workflow/TemplateSyntax";
import type { ModelSchemaColumn } from "../ModelSchema";
import { columnTypeLabel } from "../ColumnEditor/ColumnControl";
import { isColumnDescriptionInformative } from "../ColumnEditor/ColumnPickerOptions";
import {
  ValueDrillIn,
  ValueSuggestion,
  ValueSuggestionContext,
  ValueSuggestionGroup,
  ValueSuggestionGroupKind,
  ValueSuggestionSource,
  allowsPathInto,
  typeLabelForInputType,
} from "./ValueSuggestion";

export type LoadRecordColumnsFunction = (
  tableName: string,
) => Promise<Array<ModelSchemaColumn>>;

export const STEP_VALUE_SOURCE_ID: string = "steps";

export type StepGroupIdFunction = (componentId: string) => string;

/** The group id for one step, for a source that wants to add to it. */
export const stepGroupId: StepGroupIdFunction = (
  componentId: string,
): string => {
  return `step:${componentId}`;
};

/*
 * The badge on a field the step does not read. It will be empty at run time,
 * which is the mistake this exists to head off.
 */
export const NOT_SELECTED_BADGE: string = "Not selected";

type SelectedColumnIdsFunction = (
  component: NodeDataProp,
) => Array<string> | null;

/**
 * The fields a database step actually reads, from its Select Fields setting;
 * null when that cannot be told, in which case every field is offered alike.
 *
 * An On Delete trigger receives the record's ID and nothing else.
 */
export const selectedColumnIds: SelectedColumnIdsFunction = (
  component: NodeDataProp,
): Array<string> | null => {
  if ((component.metadataId || "").endsWith("-on-delete")) {
    return ["_id"];
  }

  const hasSelectArgument: boolean = Boolean(
    component.metadata?.arguments?.some((arg: { id: string }) => {
      return arg.id === "select";
    }),
  );

  if (!hasSelectArgument) {
    return null;
  }

  let select: unknown = component.arguments?.["select"];

  if (typeof select === "string") {
    if (select.trim() === "") {
      return null;
    }

    try {
      select = JSON.parse(select);
    } catch {
      return null;
    }
  }

  if (!select || typeof select !== "object" || Array.isArray(select)) {
    return null;
  }

  const ids: Array<string> = Object.keys(select as JSONObject).filter(
    (key: string) => {
      return Boolean((select as JSONObject)[key]);
    },
  );

  return ids.length > 0 ? ids : null;
};

export interface BuildStepValueGroupsOptions {
  /** Loads a model's columns, so a record can be opened to its fields. */
  loadRecordColumns?: LoadRecordColumnsFunction | undefined;
}

type RecordFieldSuggestionsFunction = (data: {
  component: NodeDataProp;
  returnValue: ReturnValue;
  columns: Array<ModelSchemaColumn>;
}) => Array<ValueSuggestion>;

/*
 * A record's fields as items. The fields the step reads come first; the
 * others are still offered (the Select Fields setting can be changed) but say
 * that they will be empty as things stand.
 */
export const recordFieldSuggestions: RecordFieldSuggestionsFunction = (data: {
  component: NodeDataProp;
  returnValue: ReturnValue;
  columns: Array<ModelSchemaColumn>;
}): Array<ValueSuggestion> => {
  const selected: Array<string> | null = selectedColumnIds(data.component);

  const fields: Array<ValueSuggestion> = data.columns
    // A relation holds a whole other record; its ID column is the useful part.
    .filter((column: ModelSchemaColumn) => {
      return !column.isRelation;
    })
    .map((column: ModelSchemaColumn): ValueSuggestion => {
      const isSelected: boolean = !selected || selected.includes(column.id);

      return {
        reference: componentReturnValueReference(
          data.component.id,
          data.returnValue.id,
          [column.id],
        ),
        label: column.title || column.id,
        description: isSelected
          ? isColumnDescriptionInformative(column)
            ? column.description
            : undefined
          : "This step does not read it, so it is empty. Add it to Select Fields to use it.",
        typeLabel: columnTypeLabel(column),
        badges: isSelected ? undefined : [NOT_SELECTED_BADGE],
      };
    });

  if (!selected) {
    return fields;
  }

  // Stable: each half keeps the schema's order.
  return [
    ...fields.filter((field: ValueSuggestion) => {
      return !field.badges?.includes(NOT_SELECTED_BADGE);
    }),
    ...fields.filter((field: ValueSuggestion) => {
      return Boolean(field.badges?.includes(NOT_SELECTED_BADGE));
    }),
  ];
};

type DrillInForFunction = (data: {
  component: NodeDataProp;
  returnValue: ReturnValue;
  options: BuildStepValueGroupsOptions;
}) => ValueDrillIn | undefined;

const drillInFor: DrillInForFunction = (data: {
  component: NodeDataProp;
  returnValue: ReturnValue;
  options: BuildStepValueGroupsOptions;
}): ValueDrillIn | undefined => {
  const type: ComponentInputType = data.returnValue.type;

  if (!allowsPathInto(type)) {
    return undefined;
  }

  const tableName: string | undefined = data.component.metadata?.tableName;
  const loadRecordColumns: LoadRecordColumnsFunction | undefined =
    data.options.loadRecordColumns;

  const isRecord: boolean =
    type === ComponentInputType.BaseModel && Boolean(tableName);

  return {
    wholeValueLabel: `The whole ${data.returnValue.name}`,
    allowsPath: true,
    pathPlaceholder:
      type === ComponentInputType.StringDictionary
        ? "e.g. content-type"
        : type === ComponentInputType.JSONArray ||
            type === ComponentInputType.BaseModelArray
          ? "e.g. [0].name"
          : "e.g. title or items[0].name",
    loadChildren:
      isRecord && loadRecordColumns
        ? async (): Promise<Array<ValueSuggestion>> => {
            const columns: Array<ModelSchemaColumn> = await loadRecordColumns(
              tableName as string,
            );

            return recordFieldSuggestions({
              component: data.component,
              returnValue: data.returnValue,
              columns: columns,
            });
          }
        : undefined,
  };
};

export type BuildStepValueGroupsFunction = (
  context: ValueSuggestionContext,
  options?: BuildStepValueGroupsOptions,
) => Array<ValueSuggestionGroup>;

/**
 * One group per step this one can read from, in run order. A step that
 * returns nothing (a Log, an If/Else) has nothing to offer and is left out.
 */
export const buildStepValueGroups: BuildStepValueGroupsFunction = (
  context: ValueSuggestionContext,
  options: BuildStepValueGroupsOptions = {},
): Array<ValueSuggestionGroup> => {
  const steps: Array<NodeDataProp> = (context.upstreamComponents || []).filter(
    (step: NodeDataProp) => {
      return (
        Boolean(step?.id) &&
        step.id !== context.component?.id &&
        (step.metadata?.returnValues || []).length > 0
      );
    },
  );

  return steps.map(
    (step: NodeDataProp, index: number): ValueSuggestionGroup => {
      return {
        id: stepGroupId(step.id),
        kind: ValueSuggestionGroupKind.Step,
        title: step.metadata.title || step.id,
        /*
         * Two steps of the same kind - two HTTP POSTs - share a title, and the
         * id is what tells them apart.
         */
        subtitle: step.id,
        iconProp: step.metadata.iconProp,
        order: index,
        items: (step.metadata.returnValues || []).map(
          (returnValue: ReturnValue): ValueSuggestion => {
            return {
              reference: componentReturnValueReference(step.id, returnValue.id),
              label: returnValue.name || returnValue.id,
              description: returnValue.description,
              typeLabel: typeLabelForInputType(returnValue.type),
              drillIn: drillInFor({
                component: step,
                returnValue: returnValue,
                options: options,
              }),
            };
          },
        ),
      };
    },
  );
};

export type CreateStepValueSourceFunction = (
  options?: BuildStepValueGroupsOptions,
) => ValueSuggestionSource;

export const createStepValueSource: CreateStepValueSourceFunction = (
  options: BuildStepValueGroupsOptions = {},
): ValueSuggestionSource => {
  return {
    id: STEP_VALUE_SOURCE_ID,
    getGroups: (context: ValueSuggestionContext) => {
      return buildStepValueGroups(context, options);
    },
  };
};
