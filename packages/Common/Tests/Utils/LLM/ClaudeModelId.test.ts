import ClaudeModelId, {
  ClaudeModelFamily,
  ClaudeModelVersion,
} from "../../../Utils/LLM/ClaudeModelId";
import ClaudeModels from "../../../Server/Utils/LLM/ClaudeModels";
import { describe, expect, test } from "@jest/globals";

/*
 * ClaudeModelId reads which Claude model an id names, whatever shape a cloud
 * or gateway gives it. Two readers depend on it agreeing with itself: the
 * Anthropic wire (ClaudeModels: does this model refuse temperature, does it
 * think unasked) and the LLM cost catalog (which price does this call pay).
 * A shape this parser misreads is a call priced at another model's rate, so
 * every shape the platforms document is pinned here.
 *
 * The shapes are Anthropic's own (platform.claude.com, "Model IDs and
 * versioning" and "Claude in Amazon Bedrock", read 2026-10-12): the 4.6
 * generation on is dateless (claude-opus-4-6), earlier ones carry a date
 * (claude-opus-4-5-20251101); Bedrock adds "anthropic." and, up to Opus 4.6,
 * a "-v1" or "-v1:0" suffix, and a cross-region inference profile adds a
 * geography; Google Cloud dates with "@". OpenRouter's ids
 * (anthropic/claude-opus-4.5) are its public model list's.
 */

interface IdShape {
  modelName: string;
  canonicalId: string;
}

const EVERY_SHAPE_OF_A_MODEL: Array<IdShape> = [
  // The current lineup, as the Claude API, Foundry and Claude Platform on AWS write it.
  { modelName: "claude-fable-5-1", canonicalId: "claude-fable-5-1" },
  { modelName: "claude-opus-5-5", canonicalId: "claude-opus-5-5" },
  { modelName: "claude-sonnet-5-5", canonicalId: "claude-sonnet-5-5" },
  { modelName: "claude-haiku-5-5", canonicalId: "claude-haiku-5-5" },
  { modelName: "claude-mythos-5-1", canonicalId: "claude-mythos-5-1" },
  // A whole major version has no minor.
  { modelName: "claude-opus-5", canonicalId: "claude-opus-5" },
  { modelName: "claude-sonnet-5", canonicalId: "claude-sonnet-5" },
  { modelName: "claude-fable-5", canonicalId: "claude-fable-5" },
  { modelName: "claude-mythos-5", canonicalId: "claude-mythos-5" },
  // Dateless from the 4.6 generation on.
  { modelName: "claude-opus-4-8", canonicalId: "claude-opus-4-8" },
  { modelName: "claude-opus-4-7", canonicalId: "claude-opus-4-7" },
  { modelName: "claude-opus-4-6", canonicalId: "claude-opus-4-6" },
  { modelName: "claude-sonnet-4-6", canonicalId: "claude-sonnet-4-6" },
  // Dated snapshots, and the aliases that point at them.
  { modelName: "claude-opus-4-5-20251101", canonicalId: "claude-opus-4-5" },
  { modelName: "claude-opus-4-5", canonicalId: "claude-opus-4-5" },
  { modelName: "claude-haiku-4-5-20251001", canonicalId: "claude-haiku-4-5" },
  { modelName: "claude-sonnet-4-5-20250929", canonicalId: "claude-sonnet-4-5" },
  { modelName: "claude-opus-4-1-20250805", canonicalId: "claude-opus-4-1" },
  // Opus 4 and Sonnet 4: the date is not a minor version, and -0 is 4.0.
  { modelName: "claude-opus-4-20250514", canonicalId: "claude-opus-4" },
  { modelName: "claude-opus-4-0", canonicalId: "claude-opus-4" },
  { modelName: "claude-sonnet-4-20250514", canonicalId: "claude-sonnet-4" },
  { modelName: "claude-sonnet-4-0", canonicalId: "claude-sonnet-4" },
  // Amazon Bedrock: the namespace, the version suffix, the inference profiles.
  { modelName: "anthropic.claude-opus-5-5", canonicalId: "claude-opus-5-5" },
  { modelName: "anthropic.claude-opus-4-6-v1", canonicalId: "claude-opus-4-6" },
  {
    modelName: "anthropic.claude-sonnet-4-5-20250929-v1:0",
    canonicalId: "claude-sonnet-4-5",
  },
  {
    modelName: "us.anthropic.claude-sonnet-4-5-20250929-v1:0",
    canonicalId: "claude-sonnet-4-5",
  },
  {
    modelName: "global.anthropic.claude-opus-4-6-v1",
    canonicalId: "claude-opus-4-6",
  },
  {
    modelName: "eu.anthropic.claude-haiku-4-5-20251001-v1:0",
    canonicalId: "claude-haiku-4-5",
  },
  {
    modelName: "apac.anthropic.claude-opus-4-20250514-v1:0",
    canonicalId: "claude-opus-4",
  },
  {
    modelName: "au.anthropic.claude-sonnet-4-5-20250929-v1:0",
    canonicalId: "claude-sonnet-4-5",
  },
  {
    modelName: "jp.anthropic.claude-haiku-5-5",
    canonicalId: "claude-haiku-5-5",
  },
  // Google Cloud dates a snapshot with "@".
  { modelName: "claude-opus-4-5@20251101", canonicalId: "claude-opus-4-5" },
  { modelName: "claude-haiku-4-5@20251001", canonicalId: "claude-haiku-4-5" },
  { modelName: "claude-opus-4@20250514", canonicalId: "claude-opus-4" },
  {
    modelName: "publishers/anthropic/models/claude-sonnet-4-6",
    canonicalId: "claude-sonnet-4-6",
  },
  // OpenRouter writes the provider in front and the version with a dot.
  { modelName: "anthropic/claude-opus-4.5", canonicalId: "claude-opus-4-5" },
  { modelName: "anthropic/claude-sonnet-5.5", canonicalId: "claude-sonnet-5-5" },
  { modelName: "anthropic/claude-fable-5.1", canonicalId: "claude-fable-5-1" },
  { modelName: "anthropic/claude-opus-4.1", canonicalId: "claude-opus-4-1" },
  { modelName: "anthropic/claude-opus-4", canonicalId: "claude-opus-4" },
  { modelName: "anthropic/claude-opus-5", canonicalId: "claude-opus-5" },
  {
    modelName: "anthropic/claude-haiku-5.5:batch",
    canonicalId: "claude-haiku-5-5",
  },
  // LiteLLM model groups and gateways' own prefixes.
  {
    modelName: "bedrock/us.anthropic.claude-opus-4-5-20251101-v1:0",
    canonicalId: "claude-opus-4-5",
  },
  { modelName: "vertex_ai/claude-opus-4-8", canonicalId: "claude-opus-4-8" },
  {
    modelName: "databricks-claude-sonnet-4-5",
    canonicalId: "claude-sonnet-4-5",
  },
  // Claude Code's 1M-context and other suffixes; case does not matter.
  { modelName: "claude-sonnet-4-5[1m]", canonicalId: "claude-sonnet-4-5" },
  { modelName: "Claude-Opus-4-8", canonicalId: "claude-opus-4-8" },
  { modelName: "  claude-opus-5-5  ", canonicalId: "claude-opus-5-5" },
];

const NAMES_NO_VERSIONED_CLAUDE_MODEL: Array<string | undefined> = [
  undefined,
  "",
  "gpt-5.1",
  "gemini-2.5-pro",
  "my-deployment",
  // A gateway's own name for a model says nothing.
  "prod-claude",
  "claude",
  "claude-instant-1.2",
  "claude-2.1",
  // No version: an Opus, Sonnet or Haiku nobody can place.
  "claude-opus",
  "claude-opus-latest",
  "claude-mythos-preview",
  // The older scheme, version first, deliberately does not parse.
  "claude-3-5-sonnet-20241022",
  "claude-3-7-sonnet-20250219",
  "claude-3-haiku-20240307",
  "anthropic/claude-3.5-sonnet",
  // A family name must stand on its own.
  "claude-sonnetx-5",
  "xclaude-opus-5-5",
];

describe("ClaudeModelId.canonicalId: every shape of a model reads as that model", () => {
  test.each(EVERY_SHAPE_OF_A_MODEL)(
    "$modelName is $canonicalId",
    (shape: IdShape) => {
      expect(ClaudeModelId.canonicalId(shape.modelName)).toBe(
        shape.canonicalId,
      );
    },
  );

  test.each(NAMES_NO_VERSIONED_CLAUDE_MODEL)(
    "%p names no versioned Claude model",
    (modelName: string | undefined) => {
      expect(ClaudeModelId.canonicalId(modelName)).toBeNull();
    },
  );

  test("a newer model than any released one still reads as itself, never as an older one", () => {
    expect(ClaudeModelId.canonicalId("claude-opus-4-9")).toBe(
      "claude-opus-4-9",
    );
    expect(ClaudeModelId.canonicalId("claude-opus-6")).toBe("claude-opus-6");
    expect(ClaudeModelId.canonicalId("anthropic/claude-sonnet-5.6")).toBe(
      "claude-sonnet-5-6",
    );
    expect(ClaudeModelId.canonicalId("claude-opus-4-10")).toBe(
      "claude-opus-4-10",
    );
  });
});

describe("ClaudeModelId.parse", () => {
  test.each([
    ["claude-sonnet-5-5", ClaudeModelFamily.Sonnet, 5, 5],
    ["claude-opus-4-7", ClaudeModelFamily.Opus, 4, 7],
    ["claude-haiku-4-5-20251001", ClaudeModelFamily.Haiku, 4, 5],
    ["claude-opus-4-20250514", ClaudeModelFamily.Opus, 4, 0],
    ["claude-sonnet-5", ClaudeModelFamily.Sonnet, 5, 0],
    ["anthropic/claude-sonnet-5.5", ClaudeModelFamily.Sonnet, 5, 5],
    ["claude-fable-5-1", ClaudeModelFamily.Fable, 5, 1],
    ["claude-mythos-5-1", ClaudeModelFamily.Mythos, 5, 1],
  ])(
    "%p is %p %p.%p",
    (
      modelName: string,
      family: ClaudeModelFamily,
      major: number,
      minor: number,
    ) => {
      const version: ClaudeModelVersion | null =
        ClaudeModelId.parse(modelName);

      expect(version).toEqual({ family, major, minor });
    },
  );

  test("a versionless id keeps its family and no major version", () => {
    expect(ClaudeModelId.parse("claude-mythos-preview")).toEqual({
      family: ClaudeModelFamily.Mythos,
      major: undefined,
      minor: 0,
    });
  });
});

describe("one reading of a Claude id", () => {
  /*
   * ClaudeModels (the Anthropic wire's sampling and thinking rules) reads
   * ids through ClaudeModelId. If it ever grew a parser of its own again,
   * the price a call is charged at and the request it is sent with could
   * disagree about which model it is.
   */
  test.each([
    ...EVERY_SHAPE_OF_A_MODEL.map((shape: IdShape): string => {
      return shape.modelName;
    }),
    ...NAMES_NO_VERSIONED_CLAUDE_MODEL.filter(
      (modelName: string | undefined): modelName is string => {
        return modelName !== undefined;
      },
    ),
  ])("ClaudeModels.parse(%p) is ClaudeModelId.parse's", (modelName: string) => {
    expect(ClaudeModels.parse(modelName)).toEqual(
      ClaudeModelId.parse(modelName),
    );
  });

  test("ClaudeModels' family enum is ClaudeModelId's", () => {
    expect(ClaudeModels.parse("claude-opus-5-5")?.family).toBe(
      ClaudeModelFamily.Opus,
    );
  });
});
