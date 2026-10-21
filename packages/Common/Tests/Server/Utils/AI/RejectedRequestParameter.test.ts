import RejectedRequestParameter from "../../../../Server/Utils/LLM/RejectedRequestParameter";
import { describe, expect, test } from "@jest/globals";

/*
 * RejectedRequestParameter reads a provider's error in words and says which
 * parameter it rejected. Anthropic's 400 has no `param` field, only a
 * sentence, so this is the whole of what makes the Anthropic wire recover
 * from a sampling parameter a model no longer takes (issue #4583).
 *
 * The positives are verbatim errors from the providers and gateways that sit
 * in front of Claude. The negatives are the errors that name a parameter for
 * some other reason: leaving the parameter out would not fix them, it would
 * only bury what the provider said.
 */

const SAMPLING: Array<string> = ["temperature", "top_p", "top_k"];

function rejected(errorText: string, candidates?: Array<string>): unknown {
  return RejectedRequestParameter.findIn({
    errorText: errorText,
    candidates: candidates || SAMPLING,
  });
}

describe("RejectedRequestParameter — errors that reject a parameter", () => {
  test.each([
    // Anthropic, verbatim from issue #4583 (claude-sonnet-5-5).
    ["`temperature` is deprecated for this model.", "temperature"],
    ["`top_p` is deprecated for this model.", "top_p"],
    ["`top_k` is deprecated for this model.", "top_k"],
    // OpenAI's two codes for the same thing.
    [
      "Unsupported parameter: 'top_p' is not supported with this model.",
      "top_p",
    ],
    [
      "Unsupported value: 'temperature' does not support 0.7 with this model. Only the default (1) value is supported.",
      "temperature",
    ],
    // Azure OpenAI, singular and plural.
    ["Unrecognized request argument supplied: top_k", "top_k"],
    ["Unrecognized request arguments supplied: top_k, temperature", "top_k"],
    // Databricks in front of Bedrock.
    [
      "Model us.anthropic.claude-opus-4-7 does not support the temperature parameter.",
      "temperature",
    ],
    // Pydantic-style validation, as FastAPI gateways answer an unknown field.
    ["top_k: Extra inputs are not permitted", "top_k"],
    [
      '{"detail":[{"loc":["body","top_k"],"msg":"extra fields not permitted","type":"value_error.extra"}]}',
      "top_k",
    ],
    // LiteLLM passing Anthropic's complaint on inside its own.
    [
      'litellm.BadRequestError: AnthropicException - {"type":"error","error":{"type":"invalid_request_error","message":"`temperature` is deprecated for this model."}}. Received Model Group=claude-opus-4-7',
      "temperature",
    ],
    // Other wordings a provider could reasonably use.
    ["temperature is no longer supported for this model", "temperature"],
    ["This model doesn't support top_p.", "top_p"],
    ["Parameter 'top_k' is unsupported for claude-haiku-5-5", "top_k"],
  ])("%p rejects %p", (errorText: string, expected: string) => {
    expect(rejected(errorText)).toBe(expected);
  });

  test("the wording may be in any case, the parameter is named as written", () => {
    // The rejection phrase is prose; the parameter is an identifier.
    expect(rejected("`temperature` IS DEPRECATED FOR THIS MODEL.")).toBe(
      "temperature",
    );
    expect(
      rejected("TEMPERATURE IS DEPRECATED FOR THIS MODEL"),
    ).toBeUndefined();
  });

  test("the parameter named first is the one rejected", () => {
    // Each retry drops one; the next 400 names the next one.
    expect(
      rejected("Unrecognized request arguments supplied: top_p, top_k"),
    ).toBe("top_p");
    expect(rejected("top_k is not supported; neither is temperature")).toBe(
      "top_k",
    );
  });
});

describe("RejectedRequestParameter — errors that are about something else", () => {
  test.each([
    // A value out of range: the operator's value is wrong, not the parameter.
    "temperature: Input should be less than or equal to 1",
    "temperature: range: 0..1",
    "top_p must be between 0 and 1",
    "Invalid value for top_k: -3",
    // Two parameters that cannot be combined: neither alone is refused.
    "`temperature` and `top_p` cannot both be specified for this model. Please use only one.",
    // Rejections of something that is not a sampling parameter.
    '"thinking.type.disabled" is not supported for this model. Use "thinking.type.adaptive" and "output_config.effort" to control thinking behavior.',
    'tool_choice: type "tool" and "any" are not supported for this model.',
    "'claude-opus-5-5' does not support tool types: computer_20251124.",
    "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.",
    // Errors that have nothing to do with parameters.
    "model: claude-sonnet-9-9",
    "invalid x-api-key",
    "Number of request tokens has exceeded your per-minute rate limit",
    "prompt is too long: 250000 tokens > 200000 maximum",
    "",
  ])("%p rejects nothing", (errorText: string) => {
    expect(rejected(errorText)).toBeUndefined();
  });

  test("a parameter the request did not carry cannot be the one rejected", () => {
    expect(
      rejected("`top_k` is deprecated for this model.", ["temperature"]),
    ).toBeUndefined();
  });

  test("a name inside a longer name is not that parameter", () => {
    expect(
      rejected("top_p_threshold is not supported", ["top_p"]),
    ).toBeUndefined();
    expect(
      rejected("max_temperature is not supported", ["temperature"]),
    ).toBeUndefined();
    // ...but the same text naming it on its own still counts.
    expect(
      rejected("max_temperature and temperature are not supported", [
        "temperature",
      ]),
    ).toBe("temperature");
  });

  test("no candidates, no answer", () => {
    expect(
      rejected("`temperature` is deprecated for this model.", []),
    ).toBeUndefined();
  });
});

describe("RejectedRequestParameter.saysParameterIsNotAccepted", () => {
  test("recognizes the rejection wording, in any case", () => {
    expect(
      RejectedRequestParameter.saysParameterIsNotAccepted(
        "`temperature` IS DEPRECATED for this model.",
      ),
    ).toBe(true);
    expect(
      RejectedRequestParameter.saysParameterIsNotAccepted(
        "Extra inputs are not permitted",
      ),
    ).toBe(true);
  });

  test("does not mistake a range error for one", () => {
    expect(
      RejectedRequestParameter.saysParameterIsNotAccepted(
        "temperature: Input should be less than or equal to 1",
      ),
    ).toBe(false);
  });
});
