import {
  appendToken,
  buildComponentToken,
  classifyToken,
  describeToken,
  parseTokens,
  removeTokenOccurrence,
  ParsedToken,
} from "../../../../UI/Components/Workflow/TokenUtils";
import { NodeDataProp } from "../../../../Types/Workflow/Component";
import { describe, expect, test } from "@jest/globals";

const components: Array<NodeDataProp> = [
  {
    id: "slack-1",
    metadata: {
      title: "Send to Slack",
      returnValues: [
        { id: "error", name: "Error", description: "", required: false },
      ],
    },
  } as unknown as NodeDataProp,
];

describe("TokenUtils.classifyToken", () => {
  test("classifies a component return-value token", () => {
    expect(
      classifyToken("{{local.components.slack-1.returnValues.error}}"),
    ).toEqual({
      kind: "component",
      raw: "{{local.components.slack-1.returnValues.error}}",
      componentId: "slack-1",
      returnValueId: "error",
    });
  });

  test("classifies local and global variable tokens", () => {
    expect(classifyToken("{{local.variables.apiKey}}")).toMatchObject({
      kind: "variable",
      scope: "local",
      name: "apiKey",
    });
    expect(classifyToken("{{global.variables.region}}")).toMatchObject({
      kind: "variable",
      scope: "global",
      name: "region",
    });
  });

  test("falls back to unknown for anything else", () => {
    expect(classifyToken("{{something.else}}").kind).toBe("unknown");
  });
});

describe("TokenUtils.parseTokens", () => {
  test("returns tokens in order with correct offsets and occurrence index", () => {
    const value: string =
      "Hi {{local.components.slack-1.returnValues.error}} and {{local.variables.x}}";
    const tokens: Array<ParsedToken> = parseTokens(value);

    expect(tokens).toHaveLength(2);
    expect(tokens[0]!.occurrence).toBe(0);
    expect(tokens[0]!.token.kind).toBe("component");
    expect(value.slice(tokens[0]!.start, tokens[0]!.end)).toBe(
      "{{local.components.slack-1.returnValues.error}}",
    );
    expect(tokens[1]!.occurrence).toBe(1);
    expect(tokens[1]!.token.kind).toBe("variable");
  });

  test("returns nothing for empty or token-free values", () => {
    expect(parseTokens("")).toHaveLength(0);
    expect(parseTokens("just some text")).toHaveLength(0);
  });
});

describe("TokenUtils.describeToken", () => {
  test("gives a friendly label for a resolvable component token", () => {
    const token: ParsedToken = parseTokens(
      "{{local.components.slack-1.returnValues.error}}",
    )[0]!;
    expect(describeToken(token.token, components)).toEqual({
      label: "Error · from Send to Slack",
      isBroken: false,
    });
  });

  test("marks a token whose source step is missing as broken", () => {
    const token: ParsedToken = parseTokens(
      "{{local.components.deleted-9.returnValues.error}}",
    )[0]!;
    const described: { isBroken: boolean } = describeToken(
      token.token,
      components,
    );
    expect(described.isBroken).toBe(true);
  });

  test("marks a token whose output is missing as broken", () => {
    const token: ParsedToken = parseTokens(
      "{{local.components.slack-1.returnValues.gone}}",
    )[0]!;
    expect(describeToken(token.token, components).isBroken).toBe(true);
  });

  test("labels variables and never marks them broken", () => {
    const token: ParsedToken = parseTokens("{{global.variables.region}}")[0]!;
    expect(describeToken(token.token, components)).toEqual({
      label: "region · global variable",
      isBroken: false,
    });
  });
});

describe("TokenUtils.buildComponentToken / appendToken", () => {
  test("builds the exact stored token format", () => {
    expect(buildComponentToken("slack-1", "error")).toBe(
      "{{local.components.slack-1.returnValues.error}}",
    );
  });

  test("appends a token to the existing value verbatim", () => {
    expect(appendToken("Hello", "{{x}}")).toBe("Hello{{x}}");
    expect(appendToken("", "{{x}}")).toBe("{{x}}");
  });
});

describe("TokenUtils.removeTokenOccurrence", () => {
  test("removes exactly the chosen occurrence, leaving the rest byte-identical", () => {
    const value: string = "a {{local.variables.x}} b {{local.variables.y}} c";
    expect(removeTokenOccurrence(value, 0)).toBe(
      "a  b {{local.variables.y}} c",
    );
    expect(removeTokenOccurrence(value, 1)).toBe(
      "a {{local.variables.x}} b  c",
    );
  });

  test("distinguishes two identical tokens by position", () => {
    const value: string = "{{local.variables.x}}{{local.variables.x}}";
    expect(removeTokenOccurrence(value, 0)).toBe("{{local.variables.x}}");
    expect(removeTokenOccurrence(value, 1)).toBe("{{local.variables.x}}");
  });

  test("is a no-op for an out-of-range occurrence", () => {
    const value: string = "{{local.variables.x}}";
    expect(removeTokenOccurrence(value, 5)).toBe(value);
  });
});
