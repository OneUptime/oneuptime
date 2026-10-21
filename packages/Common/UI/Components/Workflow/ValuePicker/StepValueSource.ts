/*
 * The values of the steps that run before the one being edited: one group per
 * step, one item per return value.
 *
 * A record (what a Find One or an On Create step returns) can be opened to its
 * fields, because the useful reference is almost never the whole record but
 * one column on it. The fields come from the model's schema, which needs a
 * request, so the loader is handed in: this file stays free of the API and can
 * be tested on its own.
 *
 * What can be used here, and what cannot, is told apart ("Pls make the
 * available and non-available variables a little more visually distinct"):
 *
 *   - a step before this one on some runs only - after If / Else's Yes, say -
 *     says so, as its values can be empty here;
 *   - the steps whose values are not there at all - they run after this one,
 *     or no path leads from them to it - are listed apart, each with why,
 *     and cannot be picked;
 *   - a record's fields that its step does not pass on are listed apart from
 *     the ones it does, under whose they are and how to pass them on.
 */

import { JSONObject } from "../../../../Types/JSON";
import {
  ComponentInputType,
  NodeDataProp,
  ReturnValue,
} from "../../../../Types/Workflow/Component";
import { SELECT_FIELDS_NAME } from "../../../../Types/Workflow/Components/BaseModel";
import { componentReturnValueReference } from "../../../../Types/Workflow/TemplateSyntax";
import type { ModelSchemaColumn } from "../ModelSchema";
import { columnTypeLabel } from "../ColumnEditor/ColumnControl";
import { isColumnDescriptionInformative } from "../ColumnEditor/ColumnPickerOptions";
import {
  SometimesBefore,
  UnavailableReason,
  UnavailableStep,
} from "./StepGraph";
import {
  ValueAvailabilityState,
  ValueDrillIn,
  ValueSuggestion,
  ValueSuggestionContext,
  ValueSuggestionGroup,
  ValueSuggestionGroupKind,
  ValueSuggestionSentence,
  ValueSuggestionSource,
  allowsPathInto,
  typeLabelForInputType,
} from "./ValueSuggestion";
import { translationKey } from "../../../Utils/TranslateTemplate";

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

// After the variables (order 1000 and 1001): the steps that cannot be read.
export const UNAVAILABLE_GROUP_ORDER: number = 2000;

// The record ID, which a record step always passes on.
const ID_COLUMN: string = "_id";

const RELATION_FIELD_SEPARATOR: string = ".";

export const StepValueCopy: {
  readonly sometimesWhen: string;
  readonly sometimes: string;
  readonly runsAfter: string;
  readonly notOnPath: string;
  readonly neverRuns: string;
  readonly notPassedOn: string;
  readonly onDeletePassesOnId: string;
} = {
  sometimesWhen: translationKey(
    "Runs only when {{step}} takes {{output}}, so its values can be empty here.",
  ),
  sometimes: translationKey(
    "Doesn't run on every path to this step, so its values can be empty here.",
  ),
  runsAfter: translationKey("Runs after this step."),
  notOnPath: translationKey(
    "Not on the path to this step. Connect it before this step to use its values.",
  ),
  neverRuns: translationKey("Not connected to the trigger, so it never runs."),
  notPassedOn: translationKey(
    "{{step}} doesn't pass these on, so they are empty here. Add them to its {{setting}} to use them.",
  ),
  onDeletePassesOnId: translationKey(
    "{{step}} passes on only the ID: the record is already gone.",
  ),
};

type SelectedColumnIdsFunction = (
  component: NodeDataProp,
) => Array<string> | null;

/**
 * The fields a database step actually reads, from its Fields to pass on
 * (stored as "select"); null when that cannot be told, in which case every
 * field is offered alike. A related record's fields are "relation.field".
 * The record's ID is always passed on.
 *
 * An On Delete trigger receives the record's ID and nothing else.
 */
export const selectedColumnIds: SelectedColumnIdsFunction = (
  component: NodeDataProp,
): Array<string> | null => {
  if ((component.metadataId || "").endsWith("-on-delete")) {
    return [ID_COLUMN];
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

  const ids: Array<string> = [];

  for (const key of Object.keys(select as JSONObject)) {
    const value: unknown = (select as JSONObject)[key];

    if (!value) {
      continue;
    }

    ids.push(key);

    if (typeof value === "object" && !Array.isArray(value)) {
      for (const subKey of Object.keys(value as JSONObject)) {
        if ((value as JSONObject)[subKey]) {
          ids.push(`${key}${RELATION_FIELD_SEPARATOR}${subKey}`);
        }
      }
    }
  }

  if (ids.length === 0) {
    return null;
  }

  return ids.includes(ID_COLUMN) ? ids : [ID_COLUMN, ...ids];
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
 * A record's fields as items. The fields the step passes on come first, a
 * related record's fields it passes on among them; the others are still
 * offered (Fields to pass on can be changed) but listed apart and marked
 * empty here (isEmptyHere), which the menu draws under whose they are.
 */
export const recordFieldSuggestions: RecordFieldSuggestionsFunction = (data: {
  component: NodeDataProp;
  returnValue: ReturnValue;
  columns: Array<ModelSchemaColumn>;
}): Array<ValueSuggestion> => {
  const selected: Array<string> | null = selectedColumnIds(data.component);

  const fields: Array<ValueSuggestion> = data.columns
    // A relation holds a whole other record; its fields are added below.
    .filter((column: ModelSchemaColumn) => {
      return !column.isRelation;
    })
    .map((column: ModelSchemaColumn): ValueSuggestion => {
      const isSelected: boolean = !selected || selected.includes(column.id);
      const suggestion: ValueSuggestion = {
        reference: componentReturnValueReference(
          data.component.id,
          data.returnValue.id,
          [column.id],
        ),
        label: column.title || column.id,
        description: isColumnDescriptionInformative(column)
          ? column.description
          : undefined,
        typeLabel: columnTypeLabel(column),
      };

      if (!isSelected) {
        suggestion.isEmptyHere = true;
      }

      return suggestion;
    });

  /*
   * The fields of a related record the step passes on - Current Incident
   * State › Name - are there too, under the record's name.
   */
  const relationFields: Array<ValueSuggestion> = [];

  for (const path of selected || []) {
    const separator: number = path.indexOf(RELATION_FIELD_SEPARATOR);

    if (separator <= 0) {
      continue;
    }

    const relationId: string = path.slice(0, separator);
    const fieldId: string = path.slice(separator + 1);
    const relation: ModelSchemaColumn | undefined = data.columns.find(
      (column: ModelSchemaColumn): boolean => {
        return column.id === relationId && column.isRelation;
      },
    );
    const field: ModelSchemaColumn | undefined = (
      relation?.relatedColumns || []
    ).find((column: ModelSchemaColumn): boolean => {
      return column.id === fieldId;
    });

    if (!relation || !field) {
      continue;
    }

    relationFields.push({
      reference: componentReturnValueReference(
        data.component.id,
        data.returnValue.id,
        [relationId, fieldId],
      ),
      label: `${relation.title || relation.id} › ${field.title || field.id}`,
      description: isColumnDescriptionInformative(field)
        ? field.description
        : undefined,
      typeLabel: columnTypeLabel(field),
    });
  }

  // Stable: each half keeps the schema's order.
  return [
    ...fields.filter((field: ValueSuggestion) => {
      return !field.isEmptyHere;
    }),
    ...relationFields,
    ...fields.filter((field: ValueSuggestion) => {
      return Boolean(field.isEmptyHere);
    }),
  ];
};

type EmptyHereNoteFunction = (
  component: NodeDataProp,
) => ValueSuggestionSentence;

// Why a record's other fields are empty here, and what makes them not.
const emptyHereNote: EmptyHereNoteFunction = (
  component: NodeDataProp,
): ValueSuggestionSentence => {
  const step: string = component.metadata?.title || component.id;

  if ((component.metadataId || "").endsWith("-on-delete")) {
    return {
      template: StepValueCopy.onDeletePassesOnId,
      values: { step: step },
    };
  }

  return {
    template: StepValueCopy.notPassedOn,
    values: { step: step, setting: SELECT_FIELDS_NAME },
  };
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

  const drillIn: ValueDrillIn = {
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

  if (isRecord) {
    drillIn.emptyHereNote = emptyHereNote(data.component);
  }

  return drillIn;
};

type SometimesReasonFunction = (
  before: SometimesBefore,
) => ValueSuggestionSentence;

// "Runs only when If / Else takes Yes, so its values can be empty here."
const sometimesReason: SometimesReasonFunction = (
  before: SometimesBefore,
): ValueSuggestionSentence => {
  if (before.portTitle) {
    return {
      template: StepValueCopy.sometimesWhen,
      values: {
        step: before.branchStep.metadata?.title || before.branchStep.id,
        output: before.portTitle,
      },
    };
  }

  return { template: StepValueCopy.sometimes };
};

const UNAVAILABLE_REASONS: Record<UnavailableReason, string> = {
  [UnavailableReason.RunsAfter]: StepValueCopy.runsAfter,
  [UnavailableReason.NotOnPath]: StepValueCopy.notOnPath,
  [UnavailableReason.NeverRuns]: StepValueCopy.neverRuns,
};

type StepItemsFunction = (data: {
  step: NodeDataProp;
  options: BuildStepValueGroupsOptions;
  isUnavailable: boolean;
}) => Array<ValueSuggestion>;

const stepItems: StepItemsFunction = (data: {
  step: NodeDataProp;
  options: BuildStepValueGroupsOptions;
  isUnavailable: boolean;
}): Array<ValueSuggestion> => {
  return (data.step.metadata.returnValues || []).map(
    (returnValue: ReturnValue): ValueSuggestion => {
      const item: ValueSuggestion = {
        reference: componentReturnValueReference(data.step.id, returnValue.id),
        label: returnValue.name || returnValue.id,
        description: returnValue.description,
        typeLabel: typeLabelForInputType(returnValue.type),
      };

      if (data.isUnavailable) {
        // Nothing to look inside, nor to pick.
        item.isUnavailable = true;
        return item;
      }

      item.drillIn = drillInFor({
        component: data.step,
        returnValue: returnValue,
        options: data.options,
      });

      return item;
    },
  );
};

export type BuildStepValueGroupsFunction = (
  context: ValueSuggestionContext,
  options?: BuildStepValueGroupsOptions,
) => Array<ValueSuggestionGroup>;

/**
 * One group per step this one can read from, in run order, then one per
 * step it cannot, each with why. A step that returns nothing (a Log, an
 * If/Else) has nothing to offer and is left out.
 */
export const buildStepValueGroups: BuildStepValueGroupsFunction = (
  context: ValueSuggestionContext,
  options: BuildStepValueGroupsOptions = {},
): Array<ValueSuggestionGroup> => {
  type HasValuesFunction = (step: NodeDataProp) => boolean;

  const hasValues: HasValuesFunction = (step: NodeDataProp): boolean => {
    return (
      Boolean(step?.id) &&
      step.id !== context.component?.id &&
      (step.metadata?.returnValues || []).length > 0
    );
  };

  const steps: Array<NodeDataProp> = (context.upstreamComponents || []).filter(
    hasValues,
  );

  const groups: Array<ValueSuggestionGroup> = steps.map(
    (step: NodeDataProp, index: number): ValueSuggestionGroup => {
      const group: ValueSuggestionGroup = {
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
        items: stepItems({
          step: step,
          options: options,
          isUnavailable: false,
        }),
      };

      const before: SometimesBefore | undefined =
        context.sometimesSteps?.[step.id];

      if (before) {
        group.availability = {
          state: ValueAvailabilityState.Sometimes,
          reason: sometimesReason(before),
        };
      }

      return group;
    },
  );

  const unavailable: Array<UnavailableStep> = (
    context.unavailableSteps || []
  ).filter((entry: UnavailableStep): boolean => {
    return hasValues(entry.step);
  });

  unavailable.forEach((entry: UnavailableStep, index: number) => {
    groups.push({
      id: stepGroupId(entry.step.id),
      kind: ValueSuggestionGroupKind.Step,
      title: entry.step.metadata.title || entry.step.id,
      subtitle: entry.step.id,
      iconProp: entry.step.metadata.iconProp,
      order: UNAVAILABLE_GROUP_ORDER + index,
      items: stepItems({
        step: entry.step,
        options: options,
        isUnavailable: true,
      }),
      availability: {
        state: ValueAvailabilityState.Unavailable,
        reason: { template: UNAVAILABLE_REASONS[entry.reason] },
      },
    });
  });

  return groups;
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
