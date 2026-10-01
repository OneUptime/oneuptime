/*
 * What a {{...}} reference reads, in words: the chip a setting shows in place
 * of {{local.components.webhook-1.returnValues.request-body}} says
 * "Webhook › Request Body", and its tooltip has the reference itself.
 *
 * A reference that points at nothing - a step that is not in the workflow, a
 * value the step does not return, a step that runs later - is still a chip,
 * so it can be seen and removed, but a warning one that says what is wrong.
 * These mirror GraphLint's rules, so the chip and the issues panel agree.
 *
 * Pure: no DOM, no API.
 */

import {
  NodeDataProp,
  ReturnValue,
} from "../../../../Types/Workflow/Component";
import {
  ParsedReferencePath,
  ReferenceRootType,
  TemplateExpression,
  TemplateExpressionKind,
  looksLikeReferencePath,
  parseReferencePath,
  parseTemplateExpressions,
} from "../../../../Types/Workflow/TemplateSyntax";

export enum ReferenceKind {
  StepValue = "StepValue",
  Variable = "Variable",
  GlobalVariable = "GlobalVariable",
}

export enum ReferenceTone {
  Normal = "Normal",
  Warning = "Warning",
}

export const LABEL_SEPARATOR: string = " › ";

export interface ReferenceDescription {
  /** The reference exactly as written. */
  reference: string;
  kind: ReferenceKind;
  /** Where it comes from: the step's title, or "Variable". */
  source: string;
  /** What it is: the value's name and any path into it, or the variable's name. */
  parts: Array<string>;
  /** source and parts, joined by " › ". */
  label: string;
  tone: ReferenceTone;
  /** Why the tone is a warning, in a sentence. */
  problem?: string | undefined;
}

export interface ReferenceDescriptionContext {
  /**
   * Every step in the workflow. Undefined when the editor does not know the
   * workflow (it is used on its own): a step reference is then named by its
   * ids and not judged.
   */
  graphComponents?: Array<NodeDataProp> | undefined;
  /** The step whose settings hold the reference. */
  editedComponentId?: string | undefined;
  /** Ids of the steps that run after it. */
  downstreamIds?: Array<string> | undefined;
  /**
   * The variable names that exist, once they have been loaded. Until then a
   * variable reference is not judged: nobody knows yet.
   */
  variableNames?:
    | { workflow: Array<string>; global: Array<string> }
    | undefined;
}

type SingleReferenceFunction = (text: string) => TemplateExpression | null;

/*
 * The one reference `text` consists of, when it is exactly one well-formed
 * reference: no spaces inside the braces (the runtime would not resolve it),
 * a root the runtime has, and nothing loop-specific.
 */
const singleReference: SingleReferenceFunction = (
  text: string,
): TemplateExpression | null => {
  if (typeof text !== "string" || !text.startsWith("{{")) {
    return null;
  }

  const expressions: Array<TemplateExpression> = parseTemplateExpressions(text);

  if (expressions.length !== 1) {
    return null;
  }

  const expression: TemplateExpression = expressions[0]!;

  if (
    expression.startIndex !== 0 ||
    expression.endIndex !== text.length ||
    expression.kind !== TemplateExpressionKind.Reference ||
    expression.innerRaw !== expression.inner ||
    !looksLikeReferencePath(expression.inner)
  ) {
    return null;
  }

  if (
    parseReferencePath(expression.inner).rootType === ReferenceRootType.Unknown
  ) {
    return null;
  }

  return expression;
};

export type IsChipReferenceFunction = (text: string) => boolean;

/**
 * Whether a {{...}} expression is a reference to show as a chip. Anything
 * else - a loop tag, a relative {{name}} inside a loop, a reference with a
 * space in it - stays text, so it can be read and fixed as written.
 */
export const isChipReference: IsChipReferenceFunction = (
  text: string,
): boolean => {
  return singleReference(text) !== null;
};

type PathAfterFunction = (inner: string, nameSegment: number) => string;

/*
 * What a path reads past the name it starts with. For
 * local.components.x.returnValues.body.title, past segment 4 ("body"), that is
 * "title"; for ...returnValues.body[0].title it is "[0].title", since an index
 * written on the name is part of the way in too.
 */
const pathAfter: PathAfterFunction = (
  inner: string,
  nameSegment: number,
): string => {
  const segments: Array<string> = inner.split(".");
  const name: string = segments[nameSegment] || "";
  const bracket: number = name.indexOf("[");
  const index: string = bracket === -1 ? "" : name.slice(bracket);
  const rest: string = segments.slice(nameSegment + 1).join(".");

  if (!index) {
    return rest;
  }

  return rest ? `${index}.${rest}` : index;
};

type JoinFunction = (source: string, parts: Array<string>) => string;

const join: JoinFunction = (source: string, parts: Array<string>): string => {
  return [source, ...parts].join(LABEL_SEPARATOR);
};

export type DescribeReferenceFunction = (
  reference: string,
  context: ReferenceDescriptionContext,
) => ReferenceDescription | null;

/**
 * The words for a reference, or null when it is not one to show as a chip
 * (see isChipReference).
 */
export const describeReference: DescribeReferenceFunction = (
  reference: string,
  context: ReferenceDescriptionContext,
): ReferenceDescription | null => {
  const expression: TemplateExpression | null = singleReference(reference);

  if (!expression) {
    return null;
  }

  const parsed: ParsedReferencePath = parseReferencePath(expression.inner);

  if (
    parsed.rootType === ReferenceRootType.LocalVariable ||
    parsed.rootType === ReferenceRootType.GlobalVariable
  ) {
    const isGlobal: boolean =
      parsed.rootType === ReferenceRootType.GlobalVariable;
    const name: string = parsed.variableName || "";
    // Anything after the name: a path into a JSON variable.
    const deeper: string = pathAfter(expression.inner, 2);
    const parts: Array<string> = deeper ? [name, deeper] : [name];
    const source: string = isGlobal ? "Global variable" : "Variable";

    const known: Array<string> | undefined = isGlobal
      ? context.variableNames?.global
      : context.variableNames?.workflow;

    // local.variables only reads this workflow's, global.variables the project's.
    const isMissing: boolean = Boolean(known) && !known!.includes(name);

    return {
      reference: reference,
      kind: isGlobal ? ReferenceKind.GlobalVariable : ReferenceKind.Variable,
      source: source,
      parts: parts,
      label: join(source, parts),
      tone: isMissing ? ReferenceTone.Warning : ReferenceTone.Normal,
      problem: isMissing
        ? `There is no ${isGlobal ? "global" : "workflow"} variable called "${name}".`
        : undefined,
    };
  }

  // A step's return value.
  const componentId: string = parsed.componentId as string;
  const returnValueId: string = parsed.returnValueId as string;
  const deeper: string = pathAfter(expression.inner, 4);

  if (!context.graphComponents) {
    const parts: Array<string> = deeper
      ? [returnValueId, deeper]
      : [returnValueId];

    return {
      reference: reference,
      kind: ReferenceKind.StepValue,
      source: componentId,
      parts: parts,
      label: join(componentId, parts),
      tone: ReferenceTone.Normal,
    };
  }

  const steps: Array<NodeDataProp> = context.graphComponents.filter(
    (step: NodeDataProp) => {
      return Boolean(step?.id && step.metadata);
    },
  );

  const step: NodeDataProp | undefined = steps.find(
    (candidate: NodeDataProp) => {
      return candidate.id === componentId;
    },
  );

  if (!step) {
    const parts: Array<string> = deeper
      ? [returnValueId, deeper]
      : [returnValueId];

    return {
      reference: reference,
      kind: ReferenceKind.StepValue,
      source: componentId,
      parts: parts,
      label: join(componentId, parts),
      tone: ReferenceTone.Warning,
      problem: `No step in this workflow has the ID "${componentId}".`,
    };
  }

  const title: string = step.metadata.title || step.id;
  const sharesTitle: boolean =
    steps.filter((candidate: NodeDataProp) => {
      return (candidate.metadata.title || candidate.id) === title;
    }).length > 1;
  const source: string = sharesTitle ? `${title} (${step.id})` : title;

  const returnValue: ReturnValue | undefined = (
    step.metadata.returnValues || []
  ).find((candidate: ReturnValue) => {
    return candidate.id === returnValueId;
  });

  const parts: Array<string> = [
    returnValue ? returnValue.name || returnValue.id : returnValueId,
    ...(deeper ? [deeper] : []),
  ];

  let problem: string | undefined = undefined;

  if (!returnValue) {
    problem = `"${title}" does not return anything called "${returnValueId}".`;
  } else if (
    context.editedComponentId &&
    componentId === context.editedComponentId
  ) {
    problem =
      "This is this step's own value, which does not exist yet while its settings are read.";
  } else if ((context.downstreamIds || []).includes(componentId)) {
    problem = `"${title}" runs after this step, so this value is empty here.`;
  }

  return {
    reference: reference,
    kind: ReferenceKind.StepValue,
    source: source,
    parts: parts,
    label: join(source, parts),
    tone: problem ? ReferenceTone.Warning : ReferenceTone.Normal,
    problem: problem,
  };
};
