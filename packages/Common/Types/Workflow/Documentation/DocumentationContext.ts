/*
 * What a step's help is written from: the step itself, the identifier it has
 * in this workflow right now, and the other steps around it. That is what
 * lets an example read "{{local.components.incident-create-one-1...}}" - the
 * reference the user would actually paste - instead of a placeholder they
 * have to work out how to fill in.
 */

import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ComponentMetadata, {
  ComponentType,
  NodeDataProp,
  NodeType,
} from "../Component";
import ComponentID from "../ComponentID";
import { componentReturnValueReference } from "../TemplateSyntax";
import ComponentDocumentation from "./ComponentDocumentation";
import {
  ExampleColumn,
  ID_COLUMN_ID,
  getDisplayColumn,
  getWorkflowModel,
} from "./ModelExamples";

export interface ComponentDocumentationContext {
  metadata: ComponentMetadata;
  /** This step's identifier, as it stands in the dialog. */
  stepId: string;
  /** Every step in the workflow. This one is skipped wherever that matters. */
  graphComponents: Array<NodeDataProp>;
}

export type ComponentDocumentationBuilder = (
  context: ComponentDocumentationContext,
) => ComponentDocumentation;

export type OwnReferenceFunction = (
  context: ComponentDocumentationContext,
  returnValueId: string,
  path?: Array<string> | undefined,
) => string;

/** A reference to one of this step's own return values. */
export const ownReference: OwnReferenceFunction = (
  context: ComponentDocumentationContext,
  returnValueId: string,
  path?: Array<string> | undefined,
): string => {
  return componentReturnValueReference(context.stepId, returnValueId, path);
};

/** A value from another step that an example can put in a message. */
export interface SampleValue {
  /** The reference itself. */
  reference: string;
  /** The step it comes from. */
  stepId: string;
  /*
   * What it holds, to finish the sentence "It puts in ...": help text, with
   * the step's identifier as a literal.
   */
  description: string;
}

/*
 * The return value a step is mostly read for, where that is not simply its
 * first one. API steps lead with "Error", which is the last thing a message
 * should be built from.
 */
const MAIN_RETURN_VALUE_BY_COMPONENT: Partial<Record<string, string>> = {
  [ComponentID.ApiGet]: "response-body",
  [ComponentID.ApiPost]: "response-body",
  [ComponentID.ApiPut]: "response-body",
  [ComponentID.ApiPatch]: "response-body",
  [ComponentID.ApiDelete]: "response-body",
  [ComponentID.AIGenerateText]: "response",
  [ComponentID.JavaScriptCode]: "returnValue",
};

type SampleValueOfStepFunction = (step: NodeDataProp) => SampleValue | null;

// What an example would read from one particular step, if anything.
const sampleValueOfStep: SampleValueOfStepFunction = (
  step: NodeDataProp,
): SampleValue | null => {
  const metadata: ComponentMetadata = step.metadata;
  const returnValueIds: Array<string> = (metadata.returnValues || []).map(
    (returnValue: { id: string }): string => {
      return returnValue.id;
    },
  );

  if (metadata.tableName) {
    const model: BaseModel | null = getWorkflowModel(metadata.tableName);
    const display: ExampleColumn | null = model
      ? getDisplayColumn(model)
      : null;
    const column: string = display ? display.id : ID_COLUMN_ID;
    const name: string = model?.singularName || metadata.tableName;
    const columnTitle: string = display ? display.title : "ID";

    if (returnValueIds.includes("model")) {
      return {
        reference: componentReturnValueReference(step.id, "model", [column]),
        stepId: step.id,
        description: `the ${columnTitle} of the ${name} from \`${step.id}\``,
      };
    }

    if (returnValueIds.includes("models")) {
      // The runtime reads list items as models[0] (VMAPI.deepFind).
      return {
        reference: componentReturnValueReference(step.id, "models[0]", [
          column,
        ]),
        stepId: step.id,
        description: `the ${columnTitle} of the first ${name} from \`${step.id}\``,
      };
    }

    return null;
  }

  if (metadata.id === ComponentID.Webhook) {
    return {
      reference: componentReturnValueReference(step.id, "request-body", [
        "message",
      ]),
      stepId: step.id,
      description: `the message field of the request body \`${step.id}\` received`,
    };
  }

  const main: string | undefined =
    MAIN_RETURN_VALUE_BY_COMPONENT[metadata.id] ||
    returnValueIds.find((id: string): boolean => {
      return id !== "error";
    });

  if (!main) {
    return null;
  }

  const returnValue: { id: string; name: string } | undefined = (
    metadata.returnValues || []
  ).find((candidate: { id: string }): boolean => {
    return candidate.id === main;
  });

  return {
    reference: componentReturnValueReference(step.id, main),
    stepId: step.id,
    description: `the ${returnValue?.name || main} from \`${step.id}\``,
  };
};

export type OtherStepsFunction = (
  context: ComponentDocumentationContext,
) => Array<NodeDataProp>;

/** The workflow's other real steps: not this one, not a placeholder. */
export const otherSteps: OtherStepsFunction = (
  context: ComponentDocumentationContext,
): Array<NodeDataProp> => {
  return (context.graphComponents || []).filter(
    (step: NodeDataProp): boolean => {
      return (
        Boolean(step) &&
        Boolean(step.metadata) &&
        step.nodeType !== NodeType.PlaceholderNode &&
        step.id !== context.stepId
      );
    },
  );
};

export type GetSampleValueFunction = (
  context: ComponentDocumentationContext,
) => SampleValue | null;

/**
 * A value from another step of this workflow, for an example to put in a
 * message or a setting: the trigger's first, since that is what most steps
 * are about, then any other step's. Null when no other step returns anything,
 * and the example then does without one.
 */
export const getSampleValue: GetSampleValueFunction = (
  context: ComponentDocumentationContext,
): SampleValue | null => {
  const steps: Array<NodeDataProp> = otherSteps(context);
  const ordered: Array<NodeDataProp> = [
    ...steps.filter((step: NodeDataProp): boolean => {
      return step.metadata.componentType === ComponentType.Trigger;
    }),
    ...steps.filter((step: NodeDataProp): boolean => {
      return step.metadata.componentType !== ComponentType.Trigger;
    }),
  ];

  for (const step of ordered) {
    const sample: SampleValue | null = sampleValueOfStep(step);

    if (sample) {
      return sample;
    }
  }

  return null;
};

export type FindRecordStepFunction = (
  context: ComponentDocumentationContext,
  tableName: string,
) => NodeDataProp | null;

/**
 * Another step that hands on one record of this table - a trigger, a Find One
 * or a Create One - so a query can pick that same record by its ID.
 */
export const findRecordStep: FindRecordStepFunction = (
  context: ComponentDocumentationContext,
  tableName: string,
): NodeDataProp | null => {
  const steps: Array<NodeDataProp> = otherSteps(context).filter(
    (step: NodeDataProp): boolean => {
      return (
        step.metadata.tableName === tableName &&
        (step.metadata.returnValues || []).some(
          (returnValue: { id: string }): boolean => {
            return returnValue.id === "model";
          },
        )
      );
    },
  );

  return (
    steps.find((step: NodeDataProp): boolean => {
      return step.metadata.componentType === ComponentType.Trigger;
    }) ||
    steps[0] ||
    null
  );
};
