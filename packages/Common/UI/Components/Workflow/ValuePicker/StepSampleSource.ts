/*
 * What the steps before this one held the last times they ran, added to the
 * picker's groups. The maintainer's example: a Webhook that has received a
 * request already - so the picker knows what is in its body, and offers
 * incident.title ("Database is down") rather than only "Request Body".
 *
 * Each step's group is the one StepValueSource made (same id), so this only
 * adds to it:
 * - beside each value, what it held: "production", "4 fields";
 * - inside a value with fields, those fields with what each held, for the
 *   picker to open the value to - a record's fields come from its model, and
 *   only get their samples from here;
 * - the same fields again, listed only by a search that names one, so typing
 *   "title" or "{{...request-body." finds them without opening anything;
 * - for a Webhook nothing has called yet, a note that says so, with a test
 *   request to copy, and the list asks again every few seconds while open.
 *
 * Loading needs the API, so the loader is handed in (DefaultValueSources);
 * this file stays testable on its own.
 */

import ObjectID from "../../../../Types/ObjectID";
import {
  ComponentInputType,
  NodeDataProp,
  ReturnValue,
} from "../../../../Types/Workflow/Component";
import ComponentID from "../../../../Types/Workflow/ComponentID";
import {
  StepSample,
  StepSampleField,
  StepSampleKind,
  StepSampleValue,
  sampleFieldReference,
} from "../../../../Types/Workflow/StepSamples";
import { componentReturnValueReference } from "../../../../Types/Workflow/TemplateSyntax";
import { getWebhookTriggerCurlExample } from "../../../../Types/Workflow/WebhookTrigger";
import OneUptimeDate from "../../../../Types/Date";
import { stepGroupId } from "./StepValueSource";
import {
  ValueSuggestion,
  ValueSuggestionContext,
  ValueSuggestionGroup,
  ValueSuggestionGroupKind,
  ValueSuggestionNote,
  ValueSuggestionSource,
  allowsPathInto,
} from "./ValueSuggestion";

export const STEP_SAMPLE_SOURCE_ID: string = "step-samples";

export type LoadStepSamplesFunction = (
  workflowId: ObjectID,
  componentIds: Array<string>,
) => Promise<Array<StepSample>>;

/** "5 minutes ago", for an ISO date. */
export type FormatWhenFunction = (isoDate: string) => string;

export const formatWhenDefault: FormatWhenFunction = (
  isoDate: string,
): string => {
  return OneUptimeDate.fromNow(new Date(isoDate));
};

export interface BuildStepSampleGroupsOptions {
  formatWhen?: FormatWhenFunction | undefined;
}

/*
 * The words the picker uses for a value's shape (see ValueSuggestion's
 * typeLabelForInputType). An empty field has none worth a badge.
 */
const KIND_LABELS: Record<StepSampleKind, string | undefined> = {
  [StepSampleKind.Text]: "Text",
  [StepSampleKind.Number]: "Number",
  [StepSampleKind.Boolean]: "Yes / No",
  [StepSampleKind.Empty]: undefined,
  [StepSampleKind.Object]: "JSON",
  [StepSampleKind.List]: "List",
};

export const StepSampleCopy: {
  readonly copyTestRequest: string;
  readonly waitingForRequest: string;
  readonly noRequestYetWithTest: string;
  readonly noRequestYet: string;
  readonly noRequestYetInside: string;
  readonly partial: string;
  readonly cutShortRequest: string;
  readonly cutShortRun: string;
} = {
  copyTestRequest: "Copy test request",
  waitingForRequest: "Waiting for a request…",
  noRequestYetWithTest:
    "No request has reached this webhook yet. Send a test request, and the fields it sends show up here.",
  noRequestYet:
    "No request has reached this webhook yet. The fields of the first one show up here.",
  noRequestYetInside:
    "No request has arrived yet. Its fields show up here after the first one.",
  partial: "It was large, so not every field is listed.",
  cutShortRequest:
    "The last request was too big to keep, so its fields show up here after the next one.",
  cutShortRun:
    "It was too big to keep in the last run, so its fields show up here after the next one.",
};

type IsWebhookFunction = (step: NodeDataProp) => boolean;

const isWebhook: IsWebhookFunction = (step: NodeDataProp): boolean => {
  return (
    step.metadataId === ComponentID.Webhook ||
    step.metadata?.id === ComponentID.Webhook
  );
};

type NotRunNoteFunction = (step: NodeDataProp) => string;

const notRunNote: NotRunNoteFunction = (step: NodeDataProp): string => {
  return `${step.metadata?.title || step.id} hasn't run yet. Its fields show up here after it does.`;
};

type WhereFromFunction = (data: {
  step: NodeDataProp;
  value: StepSampleValue;
  formatWhen: FormatWhenFunction;
}) => string;

/*
 * "From the request received 5 minutes ago." - the line above a value's
 * fields, so nobody takes one request's fields for a promise about the next.
 */
const whereFrom: WhereFromFunction = (data: {
  step: NodeDataProp;
  value: StepSampleValue;
  formatWhen: FormatWhenFunction;
}): string => {
  let when: string = "";

  if (data.value.ranAt && !isNaN(Date.parse(data.value.ranAt))) {
    try {
      when = data.formatWhen(data.value.ranAt);
    } catch {
      when = "";
    }
  }

  const webhook: boolean = isWebhook(data.step);
  const isEmpty: boolean = data.value.fields.length === 0;

  let sentence: string;

  if (webhook) {
    const request: string = when
      ? `the request received ${when}`
      : "the last request";

    sentence = isEmpty ? `It was empty in ${request}.` : `From ${request}.`;
  } else {
    const run: string = when ? `the last run, ${when}` : "the last run";

    sentence = isEmpty ? `It was empty in ${run}.` : `From ${run}.`;
  }

  return data.value.isPartial
    ? `${sentence} ${StepSampleCopy.partial}`
    : sentence;
};

type FieldSuggestionFunction = (data: {
  step: NodeDataProp;
  returnValue: ReturnValue;
  field: StepSampleField;
}) => ValueSuggestion;

const fieldSuggestion: FieldSuggestionFunction = (data: {
  step: NodeDataProp;
  returnValue: ReturnValue;
  field: StepSampleField;
}): ValueSuggestion => {
  const suggestion: ValueSuggestion = {
    reference: sampleFieldReference({
      componentId: data.step.id,
      returnValueId: data.returnValue.id,
      path: data.field.path,
    }),
    label: data.field.path,
    typeLabel: KIND_LABELS[data.field.kind],
  };

  if (data.field.isHidden) {
    suggestion.isSampleHidden = true;
  } else if (data.field.preview !== undefined) {
    suggestion.sample = data.field.preview;
  }

  if (!suggestion.typeLabel) {
    delete suggestion.typeLabel;
  }

  return suggestion;
};

type IsRecordValueFunction = (
  step: NodeDataProp,
  returnValue: ReturnValue,
) => boolean;

/*
 * A record a database step returns. Its fields are listed from its model,
 * named as the model names them; a run only adds what each held.
 */
const isRecordValue: IsRecordValueFunction = (
  step: NodeDataProp,
  returnValue: ReturnValue,
): boolean => {
  return (
    returnValue.type === ComponentInputType.BaseModel &&
    Boolean(step.metadata?.tableName)
  );
};

export type BuildStepSampleGroupsFunction = (
  context: ValueSuggestionContext,
  samples: Array<StepSample>,
  options?: BuildStepSampleGroupsOptions,
) => Array<ValueSuggestionGroup>;

/**
 * The samples as additions to the steps' groups: samples beside values,
 * fields inside them, search-only fields, and the Webhook's note while it
 * waits for its first request.
 */
export const buildStepSampleGroups: BuildStepSampleGroupsFunction = (
  context: ValueSuggestionContext,
  samples: Array<StepSample>,
  options: BuildStepSampleGroupsOptions = {},
): Array<ValueSuggestionGroup> => {
  const formatWhen: FormatWhenFunction =
    options.formatWhen || formatWhenDefault;

  const byComponentId: Map<string, StepSample> = new Map<string, StepSample>();

  for (const sample of samples || []) {
    if (sample && typeof sample.componentId === "string") {
      byComponentId.set(sample.componentId, sample);
    }
  }

  const steps: Array<NodeDataProp> = (context.upstreamComponents || []).filter(
    (step: NodeDataProp) => {
      return (
        Boolean(step?.id) &&
        step.id !== context.component?.id &&
        (step.metadata?.returnValues || []).length > 0
      );
    },
  );

  const groups: Array<ValueSuggestionGroup> = [];

  steps.forEach((step: NodeDataProp, index: number) => {
    const sample: StepSample | undefined = byComponentId.get(step.id);
    const items: Array<ValueSuggestion> = [];
    const fieldsToSearch: Array<ValueSuggestion> = [];

    for (const returnValue of step.metadata.returnValues || []) {
      const name: string = returnValue.name || returnValue.id;
      const reference: string = componentReturnValueReference(
        step.id,
        returnValue.id,
      );
      const value: StepSampleValue | undefined =
        sample?.returnValues?.[returnValue.id];

      if (!value) {
        /*
         * The step has not run, so nothing is known about what is inside
         * it: say why, where the picker would list the fields. (One that ran
         * and gave nothing back for it has nothing to say.)
         */
        if (
          !sample &&
          allowsPathInto(returnValue.type) &&
          !isRecordValue(step, returnValue)
        ) {
          items.push({
            reference: reference,
            label: name,
            drillIn: {
              wholeValueLabel: `The whole ${name}`,
              allowsPath: true,
              note: isWebhook(step)
                ? StepSampleCopy.noRequestYetInside
                : notRunNote(step),
            },
          });
        }

        continue;
      }

      const item: ValueSuggestion = {
        reference: reference,
        label: name,
      };

      if (value.isHidden) {
        item.isSampleHidden = true;
      } else if (value.preview !== undefined) {
        item.sample = value.preview;
      }

      const hasFields: boolean =
        value.kind === StepSampleKind.Object ||
        value.kind === StepSampleKind.List;

      if (value.isCutShort) {
        item.drillIn = {
          wholeValueLabel: `The whole ${name}`,
          allowsPath: true,
          note: isWebhook(step)
            ? StepSampleCopy.cutShortRequest
            : StepSampleCopy.cutShortRun,
        };
      } else if (hasFields) {
        const isRecord: boolean = isRecordValue(step, returnValue);

        const children: Array<ValueSuggestion> = value.fields.map(
          (field: StepSampleField): ValueSuggestion => {
            const child: ValueSuggestion = fieldSuggestion({
              step: step,
              returnValue: returnValue,
              field: field,
            });

            if (isRecord) {
              child.annotatesOnly = true;
            }

            return child;
          },
        );

        item.drillIn = {
          wholeValueLabel: `The whole ${name}`,
          allowsPath: true,
          note: whereFrom({ step: step, value: value, formatWhen: formatWhen }),
        };

        /*
         * With fields to list, picking the value opens it to them. An empty
         * one is still picked whole, and opened only to read why it is empty.
         */
        if (children.length > 0) {
          item.drillIn.loadChildren = async (): Promise<
            Array<ValueSuggestion>
          > => {
            return children;
          };
        }

        if (!isRecord) {
          for (const child of children) {
            fieldsToSearch.push({
              ...child,
              label: `${name} › ${child.label}`,
              searchOnly: { context: [name, reference] },
            });
          }
        }
      }

      items.push(item);
    }

    let note: ValueSuggestionNote | undefined = undefined;

    if (isWebhook(step) && !sample) {
      note = context.webhookUrl
        ? {
            text: StepSampleCopy.noRequestYetWithTest,
            copyText: getWebhookTriggerCurlExample(context.webhookUrl),
            copyLabel: StepSampleCopy.copyTestRequest,
            refreshSourceId: STEP_SAMPLE_SOURCE_ID,
            waitingText: StepSampleCopy.waitingForRequest,
          }
        : {
            text: StepSampleCopy.noRequestYet,
            refreshSourceId: STEP_SAMPLE_SOURCE_ID,
            waitingText: StepSampleCopy.waitingForRequest,
          };
    }

    if (items.length === 0 && fieldsToSearch.length === 0 && !note) {
      return;
    }

    const group: ValueSuggestionGroup = {
      id: stepGroupId(step.id),
      kind: ValueSuggestionGroupKind.Step,
      title: step.metadata.title || step.id,
      subtitle: step.id,
      iconProp: step.metadata.iconProp,
      order: index,
      items: [...items, ...fieldsToSearch],
    };

    if (note) {
      group.note = note;
    }

    groups.push(group);
  });

  return groups;
};

export interface CreateStepSampleSourceOptions {
  load: LoadStepSamplesFunction;
  formatWhen?: FormatWhenFunction | undefined;
}

export type CreateStepSampleSourceFunction = (
  options: CreateStepSampleSourceOptions,
) => ValueSuggestionSource;

/**
 * The source itself. It loads quietly: the picker works without it, so a
 * failure - or a reader who may not see the workflow's runs - leaves the list
 * as the steps' metadata makes it.
 */
export const createStepSampleSource: CreateStepSampleSourceFunction = (
  options: CreateStepSampleSourceOptions,
): ValueSuggestionSource => {
  return {
    id: STEP_SAMPLE_SOURCE_ID,
    isBackground: true,
    loadGroups: async (
      context: ValueSuggestionContext,
    ): Promise<Array<ValueSuggestionGroup>> => {
      if (!context.workflowId) {
        return [];
      }

      const componentIds: Array<string> = (context.upstreamComponents || [])
        .filter((step: NodeDataProp) => {
          return (
            Boolean(step?.id) &&
            step.id !== context.component?.id &&
            (step.metadata?.returnValues || []).length > 0
          );
        })
        .map((step: NodeDataProp) => {
          return step.id;
        });

      if (componentIds.length === 0) {
        return [];
      }

      const samples: Array<StepSample> = await options.load(
        context.workflowId,
        componentIds,
      );

      return buildStepSampleGroups(context, samples, {
        formatWhen: options.formatWhen,
      });
    },
  };
};
