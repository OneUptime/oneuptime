/*
 * Parsing helpers for the {{...}} template syntax that workflow arguments use.
 *
 * The runtime implementation lives in Common/Server/Utils/VM/VMAPI.ts
 * (replaceValueInPlace, expandEachLoops, deepFind). Everything in this file
 * mirrors that behaviour so the builder can warn about a broken reference
 * before a run does — VMAPI deliberately skips a reference it cannot resolve
 * ("Skip replacement if the variable is not found in the storageMap"), which
 * means a typo like {{local.componets.api-get-1.returnValues.response-body}}
 * is sent as literal text in the outgoing request and the run still reports
 * Success. That silence is the bug this module exists to end.
 *
 * This lives in Common/Types (not Common/UI) because both the builder and the
 * server-side runner need it, and Common/Types has no UI or server deps.
 */

import JSON5 from "json5";

/**
 * The exact expression matcher the runtime uses (VMAPI.ts: `/{{(.*?)}}/g`).
 * Non-greedy, so `{{a}} and {{b}}` yields two matches rather than one.
 * Built fresh on each use because a global RegExp carries lastIndex state.
 */
export type GetTemplateExpressionRegexFunction = () => RegExp;

export const getTemplateExpressionRegex: GetTemplateExpressionRegexFunction =
  (): RegExp => {
    return /{{(.*?)}}/g;
  };

export enum TemplateExpressionKind {
  /** A value reference, e.g. {{local.variables.apiKey}}. */
  Reference = "Reference",
  /** The opening tag of a loop, e.g. {{#each local.components.x.returnValues.items}}. */
  EachOpen = "EachOpen",
  /** The closing tag of a loop: {{/each}}. */
  EachClose = "EachClose",
  /** The loop index helper: {{@index}}. */
  LoopIndex = "LoopIndex",
  /** The current primitive element inside a loop: {{this}}. */
  LoopThis = "LoopThis",
}

export interface TemplateExpression {
  /** The full matched text, including the braces. */
  raw: string;
  /** The text between the braces, trimmed. */
  inner: string;
  /**
   * The text between the braces exactly as written. Worth keeping separate,
   * because the runtime is inconsistent about trimming: at the top level
   * VMAPI.replaceValueInPlace hands the raw capture to deepFind, so
   * `{{ local.variables.x }}` resolves nothing and leaves the braces in the
   * output, while inside an {{#each}} body replaceLoopVariables trims first and
   * the same spacing is harmless.
   */
  innerRaw: string;
  kind: TemplateExpressionKind;
  /** Index of the first `{` in the source string. */
  startIndex: number;
  /** Index one past the final `}` in the source string. */
  endIndex: number;
  /**
   * True when this expression sits between an {{#each}} and its {{/each}}.
   * Inside a loop, VMAPI resolves a reference against the current array
   * element first and only then against the storage map
   * (VMAPI.replaceLoopVariables), so a bare {{status}} is legitimate there and
   * must never be reported as unknown.
   */
  isInsideEachBlock: boolean;
}

type ClassifyExpressionFunction = (inner: string) => TemplateExpressionKind;

const classifyExpression: ClassifyExpressionFunction = (
  inner: string,
): TemplateExpressionKind => {
  if (inner.startsWith("#each")) {
    return TemplateExpressionKind.EachOpen;
  }

  if (inner === "/each") {
    return TemplateExpressionKind.EachClose;
  }

  if (inner === "@index") {
    return TemplateExpressionKind.LoopIndex;
  }

  if (inner === "this") {
    return TemplateExpressionKind.LoopThis;
  }

  return TemplateExpressionKind.Reference;
};

export type ParseTemplateExpressionsFunction = (
  value: string,
) => Array<TemplateExpression>;

/**
 * Every {{...}} expression in `value`, in source order, each tagged with what
 * it is and whether it sits inside a loop body.
 */
export const parseTemplateExpressions: ParseTemplateExpressionsFunction = (
  value: string,
): Array<TemplateExpression> => {
  if (!value || typeof value !== "string") {
    return [];
  }

  const expressions: Array<TemplateExpression> = [];
  const regex: RegExp = getTemplateExpressionRegex();
  let match: RegExpExecArray | null = null;
  let eachDepth: number = 0;

  while ((match = regex.exec(value)) !== null) {
    const raw: string = match[0];
    const innerRaw: string = match[1] || "";
    const inner: string = innerRaw.trim();
    const kind: TemplateExpressionKind = classifyExpression(inner);

    /*
     * A closing tag is not itself "inside" the block it closes, and an opening
     * tag is not inside the block it opens — but the array path on an opening
     * tag IS resolved against the enclosing scope, so nested opens still count
     * as inside their parent.
     */
    if (kind === TemplateExpressionKind.EachClose) {
      eachDepth = Math.max(0, eachDepth - 1);
    }

    expressions.push({
      raw: raw,
      inner: inner,
      innerRaw: innerRaw,
      kind: kind,
      startIndex: match.index,
      endIndex: match.index + raw.length,
      isInsideEachBlock: eachDepth > 0,
    });

    if (kind === TemplateExpressionKind.EachOpen) {
      eachDepth++;
    }
  }

  return expressions;
};

export type HasEachBlockFunction = (value: string) => boolean;

/**
 * True when the value contains a loop. A loop expands to a variable number of
 * repetitions of its body, so the shape of the final string is not knowable
 * statically — callers that check structure (e.g. JSON validity) must bail out.
 */
export const hasEachBlock: HasEachBlockFunction = (value: string): boolean => {
  if (!value || typeof value !== "string") {
    return false;
  }

  return value.includes("{{#each") || value.includes("{{/each}}");
};

/*
 * Substituted into a JSON document in place of every {{...}} expression before
 * the document is parsed. `1` is chosen because it is simultaneously a legal
 * JSON value (`{"n": {{x}}}` -> `{"n": 1}`), legal inside a string literal
 * (`{"s": "{{x}}"}` -> `{"s": "1"}`), and legal as an object key
 * (`{"{{x}}": 2}` -> `{"1": 2}`). Any of those three is a real thing people
 * write, and all three have to survive masking or the check reports a
 * syntax error where none exists.
 */
const TEMPLATE_MASK_TOKEN: string = "1";

export type MaskTemplateExpressionsFunction = (value: string) => string;

/**
 * Replace every {{...}} expression with a neutral literal, so what remains can
 * be checked for JSON syntax without the (unknown, run-time) substituted
 * values.
 */
export const maskTemplateExpressions: MaskTemplateExpressionsFunction = (
  value: string,
): string => {
  if (!value || typeof value !== "string") {
    return value;
  }

  return value.replace(getTemplateExpressionRegex(), TEMPLATE_MASK_TOKEN);
};

export interface JSONSyntaxCheckResult {
  /**
   * False only when the value is definitely malformed. A value this module
   * cannot decide about (a loop, a non-string, an empty box) is reported
   * valid — the builder must never block on a guess.
   */
  isValid: boolean;
  /**
   * The JSON parser's own message ("Unexpected token } in JSON at position
   * 24"), with no framing around it — callers phrase the sentence, since a
   * form field and a canvas badge word it differently. Null when valid.
   */
  errorMessage: string | null;
  /**
   * True when the check was skipped rather than passed. Callers that want to
   * explain themselves ("not checked: contains a loop") can use this.
   */
  wasSkipped: boolean;
}

export interface JSONSyntaxCheckOptions {
  /**
   * Judge the value by JSON5's rules instead of JSON's — unquoted keys, single
   * quotes and trailing commas allowed. Set this wherever the code that will
   * actually read the value uses JSONFunctions.parse, so the check cannot be
   * stricter than the thing it is predicting.
   */
  allowJSON5?: boolean | undefined;
}

export type CheckJSONSyntaxFunction = (
  value: unknown,
  options?: JSONSyntaxCheckOptions | undefined,
) => JSONSyntaxCheckResult;

/**
 * Is `value` a JSON document, once its {{...}} placeholders are accounted for?
 *
 * Deliberately permissive. It returns invalid only for a string that cannot
 * become JSON no matter what the placeholders resolve to, because a false
 * positive here disables the Save button on a workflow that actually works.
 */
export const checkJSONSyntax: CheckJSONSyntaxFunction = (
  value: unknown,
  options?: JSONSyntaxCheckOptions | undefined,
): JSONSyntaxCheckResult => {
  const skipped: JSONSyntaxCheckResult = {
    isValid: true,
    errorMessage: null,
    wasSkipped: true,
  };

  /*
   * Not a string: the field already holds a parsed object (the Dictionary
   * editor and imported graphs both produce these). Nothing to parse.
   */
  if (typeof value !== "string") {
    return skipped;
  }

  // Empty is the job of the required-field check, not this one.
  if (value.trim() === "") {
    return skipped;
  }

  /*
   * A loop emits its body once per array element, so the document's structure
   * depends on data that only exists at run time. Checking the unexpanded text
   * would flag every correct loop ever written.
   */
  if (hasEachBlock(value)) {
    return skipped;
  }

  const masked: string = maskTemplateExpressions(value);

  try {
    if (options?.allowJSON5) {
      JSON5.parse(masked);
    } else {
      JSON.parse(masked);
    }
    return { isValid: true, errorMessage: null, wasSkipped: false };
  } catch (err: unknown) {
    const parserMessage: string =
      err instanceof Error ? err.message : "Invalid JSON.";

    return {
      isValid: false,
      errorMessage: parserMessage,
      wasSkipped: false,
    };
  }
};

/* ------------------------------------------------------------------------ */
/* Reference paths                                                           */
/* ------------------------------------------------------------------------ */

export enum ReferenceRootType {
  LocalVariable = "LocalVariable",
  GlobalVariable = "GlobalVariable",
  ComponentReturnValue = "ComponentReturnValue",
  /** Well-formed-looking but not a root the runtime storage map has. */
  Unknown = "Unknown",
}

export interface ParsedReferencePath {
  rootType: ReferenceRootType;
  /** Populated for LocalVariable / GlobalVariable. */
  variableName?: string | undefined;
  /** Populated for ComponentReturnValue: the component's user-facing id. */
  componentId?: string | undefined;
  /** Populated for ComponentReturnValue: the return value's id. */
  returnValueId?: string | undefined;
  /**
   * Why this path could not be understood. Only set when rootType is Unknown,
   * and phrased for a builder to read.
   */
  reason?: string | undefined;
}

type StripArrayAccessorFunction = (segment: string) => string;

/**
 * `items[0]` -> `items`. VMUtil.deepFind splits a path on "." and then looks
 * for a `[index]` suffix on each segment, so the name to match against
 * metadata is whatever precedes the bracket.
 */
const stripArrayAccessor: StripArrayAccessorFunction = (
  segment: string,
): string => {
  const bracketIndex: number = segment.indexOf("[");

  if (bracketIndex === -1) {
    return segment;
  }

  return segment.slice(0, bracketIndex);
};

/*
 * Characters that appear in code but never in a reference path. A workflow's
 * JavaScript component is templated like every other argument
 * (RunWorkflow.getComponentArguments runs on all of them), so its source is
 * scanned by the same regex — and JavaScript really can contain `{{` and `}}`
 * on one line, e.g. `if (x) {{ return 1; }}`. Anything carrying these is code
 * that happened to match, not a reference somebody typo'd, and reporting it
 * would put a red badge on a component that works.
 */
const NON_REFERENCE_CHARACTERS: RegExp = /[{}()[\];=+*/&|!<>"'`,]/;

export type LooksLikeReferencePathFunction = (capture: string) => boolean;

/**
 * Whether a template capture was plausibly *meant* to be a value reference.
 * Used to decide whether an unrecognized path is worth complaining about.
 *
 * Array accessors are stripped first, since `items[0]` is a legitimate path
 * segment even though it contains brackets.
 */
export const looksLikeReferencePath: LooksLikeReferencePathFunction = (
  capture: string,
): boolean => {
  const trimmed: string = capture.trim();

  if (trimmed === "") {
    return false;
  }

  const withoutAccessors: string = trimmed.replace(/\[(\d+|last)\]/g, "");

  return !NON_REFERENCE_CHARACTERS.test(withoutAccessors);
};

export type ParseReferencePathFunction = (path: string) => ParsedReferencePath;

/**
 * Break a reference path into the parts the builder can check against the
 * graph. Mirrors the StorageMap shape built in RunWorkflow.getVariables:
 *
 *   local.variables.<name>
 *   local.components.<componentId>.returnValues.<returnValueId>[...deeper]
 *   global.variables.<name>
 *
 * Anything past the return value id is a drill-in to whatever that value
 * happens to contain at run time, so it is not inspected here.
 */
export const parseReferencePath: ParseReferencePathFunction = (
  path: string,
): ParsedReferencePath => {
  if (path.trim() === "") {
    return {
      rootType: ReferenceRootType.Unknown,
      reason: "the reference is empty",
    };
  }

  const rawSegments: Array<string> = path.split(".").map((segment: string) => {
    return segment.trim();
  });

  /*
   * deepFind splits on "." and bails on the first empty key, so a doubled dot
   * silently resolves to nothing. Catch it here rather than filtering the
   * empties out, which would make "local..variables.x" look perfectly fine.
   */
  if (
    rawSegments.some((segment: string) => {
      return segment.length === 0;
    })
  ) {
    return {
      rootType: ReferenceRootType.Unknown,
      reason: "it has an empty part between two dots",
    };
  }

  const segments: Array<string> = rawSegments;

  const root: string = stripArrayAccessor(segments[0] as string);

  if (root === "global") {
    if (stripArrayAccessor(segments[1] || "") !== "variables") {
      return {
        rootType: ReferenceRootType.Unknown,
        reason: '"global" must be followed by "variables"',
      };
    }

    if (!segments[2]) {
      return {
        rootType: ReferenceRootType.Unknown,
        reason: "no global variable name was given",
      };
    }

    return {
      rootType: ReferenceRootType.GlobalVariable,
      variableName: stripArrayAccessor(segments[2]),
    };
  }

  if (root !== "local") {
    return {
      rootType: ReferenceRootType.Unknown,
      reason: `"${root}" is not a thing a reference can start with — use "local" or "global"`,
    };
  }

  const second: string = stripArrayAccessor(segments[1] || "");

  if (second === "variables") {
    if (!segments[2]) {
      return {
        rootType: ReferenceRootType.Unknown,
        reason: "no variable name was given",
      };
    }

    return {
      rootType: ReferenceRootType.LocalVariable,
      variableName: stripArrayAccessor(segments[2]),
    };
  }

  if (second !== "components") {
    return {
      rootType: ReferenceRootType.Unknown,
      reason: `"local.${second}" is not valid — use "local.variables" or "local.components"`,
    };
  }

  const componentId: string = stripArrayAccessor(segments[2] || "");

  if (!componentId) {
    return {
      rootType: ReferenceRootType.Unknown,
      reason: "no component id was given",
    };
  }

  const third: string = stripArrayAccessor(segments[3] || "");

  if (third !== "returnValues") {
    return {
      rootType: ReferenceRootType.Unknown,
      reason: `"local.components.${componentId}" must be followed by "returnValues"`,
    };
  }

  const returnValueId: string = stripArrayAccessor(segments[4] || "");

  if (!returnValueId) {
    return {
      rootType: ReferenceRootType.Unknown,
      reason: `no return value was named on "${componentId}"`,
    };
  }

  return {
    rootType: ReferenceRootType.ComponentReturnValue,
    componentId: componentId,
    returnValueId: returnValueId,
  };
};
