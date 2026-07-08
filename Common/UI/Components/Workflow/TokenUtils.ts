import { NodeDataProp, ReturnValue } from "../../../Types/Workflow/Component";

/*
 * Pure (React-free) helpers for the {{ … }} data-reference tokens used in
 * workflow arguments. These power the chip UI in DataReferenceInput while
 * keeping the stored value a plain string — so a workflow round-trips
 * byte-for-byte and nothing about storage or execution changes.
 *
 * Token formats (produced by the pickers today):
 *   {{local.components.<componentId>.returnValues.<returnValueId>}}
 *   {{local.variables.<name>}}  /  {{global.variables.<name>}}
 */

export interface ComponentToken {
  kind: "component";
  raw: string;
  componentId: string;
  returnValueId: string;
}

export interface VariableToken {
  kind: "variable";
  raw: string;
  scope: "local" | "global";
  name: string;
}

export interface UnknownToken {
  kind: "unknown";
  raw: string;
}

export type TokenValue = ComponentToken | VariableToken | UnknownToken;

export interface ParsedToken {
  token: TokenValue;
  start: number;
  end: number;
  // 0-based position among all tokens in the value (its occurrence order).
  occurrence: number;
}

// Matches a single {{ … }} token (no nested braces).
const TOKEN_REGEX: RegExp = /\{\{[^{}]*\}\}/g;
const COMPONENT_INNER_REGEX: RegExp =
  /^local\.components\.(.+)\.returnValues\.(.+)$/;
const VARIABLE_INNER_REGEX: RegExp = /^(local|global)\.variables\.(.+)$/;

export type ClassifyTokenFunction = (raw: string) => TokenValue;

export const classifyToken: ClassifyTokenFunction = (
  raw: string,
): TokenValue => {
  const inner: string = raw.slice(2, -2).trim();

  const component: RegExpExecArray | null = COMPONENT_INNER_REGEX.exec(inner);
  if (component && component[1] && component[2]) {
    return {
      kind: "component",
      raw: raw,
      componentId: component[1],
      returnValueId: component[2],
    };
  }

  const variable: RegExpExecArray | null = VARIABLE_INNER_REGEX.exec(inner);
  if (variable && variable[1] && variable[2]) {
    return {
      kind: "variable",
      raw: raw,
      scope: variable[1] === "global" ? "global" : "local",
      name: variable[2],
    };
  }

  return { kind: "unknown", raw: raw };
};

export type ParseTokensFunction = (value: string) => Array<ParsedToken>;

export const parseTokens: ParseTokensFunction = (
  value: string,
): Array<ParsedToken> => {
  const result: Array<ParsedToken> = [];
  if (!value) {
    return result;
  }

  TOKEN_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null = null;
  let occurrence: number = 0;

  while ((match = TOKEN_REGEX.exec(value)) !== null) {
    result.push({
      token: classifyToken(match[0]),
      start: match.index,
      end: match.index + match[0].length,
      occurrence: occurrence,
    });
    occurrence++;
  }

  return result;
};

export interface TokenDescription {
  label: string;
  // A reference whose source step/output can't be found in the graph.
  isBroken: boolean;
}

export type DescribeTokenFunction = (
  token: TokenValue,
  components: Array<NodeDataProp>,
) => TokenDescription;

export const describeToken: DescribeTokenFunction = (
  token: TokenValue,
  components: Array<NodeDataProp>,
): TokenDescription => {
  if (token.kind === "variable") {
    return {
      label: `${token.name} · ${token.scope} variable`,
      isBroken: false,
    };
  }

  if (token.kind === "unknown") {
    const inner: string = token.raw.slice(2, -2).trim();
    return { label: inner || "reference", isBroken: true };
  }

  const component: NodeDataProp | undefined = components.find(
    (c: NodeDataProp) => {
      return c.id === token.componentId;
    },
  );

  if (!component) {
    return {
      label: `${token.returnValueId} · from ${token.componentId}`,
      isBroken: true,
    };
  }

  const returnValue: ReturnValue | undefined = (
    component.metadata.returnValues || []
  ).find((r: ReturnValue) => {
    return r.id === token.returnValueId;
  });

  return {
    label: `${returnValue ? returnValue.name : token.returnValueId} · from ${
      component.metadata.title
    }`,
    isBroken: !returnValue,
  };
};

export type BuildComponentTokenFunction = (
  componentId: string,
  returnValueId: string,
) => string;

export const buildComponentToken: BuildComponentTokenFunction = (
  componentId: string,
  returnValueId: string,
): string => {
  return `{{local.components.${componentId}.returnValues.${returnValueId}}}`;
};

export type AppendTokenFunction = (value: string, token: string) => string;

/*
 * Append a token to the current value. Kept identical to the existing
 * "string append" behaviour of the pickers so nothing changes on disk.
 */
export const appendToken: AppendTokenFunction = (
  value: string,
  token: string,
): string => {
  return (value || "") + token;
};

export type RemoveTokenOccurrenceFunction = (
  value: string,
  occurrence: number,
) => string;

export const removeTokenOccurrence: RemoveTokenOccurrenceFunction = (
  value: string,
  occurrence: number,
): string => {
  const target: ParsedToken | undefined = parseTokens(value).find(
    (t: ParsedToken) => {
      return t.occurrence === occurrence;
    },
  );

  if (!target) {
    return value;
  }

  return value.slice(0, target.start) + value.slice(target.end);
};
