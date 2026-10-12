import ClaudeModels, {
  ClaudeModelFamily,
  ClaudeModelVersion,
} from "../../../../Server/Utils/LLM/ClaudeModels";
import { describe, expect, test } from "@jest/globals";

/*
 * ClaudeModels reads a model id the way the Anthropic wire needs it read: does
 * this model refuse temperature, top_p and top_k (issue #4583: every Claude
 * model since Opus 4.7 answers them with "`temperature` is deprecated for this
 * model."), and does it think before answering, sharing max_tokens with its
 * thinking.
 *
 * The ids below are the ones in Anthropic's model list on 2026-10-09, plus the
 * shapes clouds and gateways give them. A wrong answer is never fatal - the
 * error-driven retry in LLMService covers it - but a "no" for a current model
 * costs every first request a rejected round trip, and a "yes" for an old one
 * would silently drop the temperature graders and summarisers rely on.
 */

interface ModelCase {
  modelName: string;
  rejectsSampling: boolean;
  thinksByDefault: boolean;
}

const CURRENT_MODELS: Array<ModelCase> = [
  // The current lineup.
  {
    modelName: "claude-fable-5-1",
    rejectsSampling: true,
    thinksByDefault: true,
  },
  {
    modelName: "claude-opus-5-5",
    rejectsSampling: true,
    thinksByDefault: true,
  },
  {
    modelName: "claude-sonnet-5-5",
    rejectsSampling: true,
    thinksByDefault: true,
  },
  {
    modelName: "claude-haiku-5-5",
    rejectsSampling: true,
    thinksByDefault: true,
  },
  // Legacy, still served.
  { modelName: "claude-fable-5", rejectsSampling: true, thinksByDefault: true },
  { modelName: "claude-opus-5", rejectsSampling: true, thinksByDefault: true },
  {
    modelName: "claude-sonnet-5",
    rejectsSampling: true,
    thinksByDefault: true,
  },
  {
    modelName: "claude-mythos-5",
    rejectsSampling: true,
    thinksByDefault: true,
  },
  {
    modelName: "claude-mythos-5-1",
    rejectsSampling: true,
    thinksByDefault: true,
  },
  {
    modelName: "claude-mythos-preview",
    rejectsSampling: true,
    thinksByDefault: true,
  },
  /*
   * Opus 4.7 and 4.8 refuse sampling parameters but do not think unless the
   * request asks them to.
   */
  {
    modelName: "claude-opus-4-8",
    rejectsSampling: true,
    thinksByDefault: false,
  },
  {
    modelName: "claude-opus-4-7",
    rejectsSampling: true,
    thinksByDefault: false,
  },
];

const OLDER_MODELS: Array<ModelCase> = [
  {
    modelName: "claude-opus-4-6",
    rejectsSampling: false,
    thinksByDefault: false,
  },
  {
    modelName: "claude-sonnet-4-6",
    rejectsSampling: false,
    thinksByDefault: false,
  },
  {
    modelName: "claude-opus-4-5",
    rejectsSampling: false,
    thinksByDefault: false,
  },
  {
    modelName: "claude-opus-4-5-20251101",
    rejectsSampling: false,
    thinksByDefault: false,
  },
  {
    modelName: "claude-sonnet-4-5",
    rejectsSampling: false,
    thinksByDefault: false,
  },
  {
    modelName: "claude-sonnet-4-5-20250929",
    rejectsSampling: false,
    thinksByDefault: false,
  },
  {
    modelName: "claude-haiku-4-5",
    rejectsSampling: false,
    thinksByDefault: false,
  },
  {
    modelName: "claude-haiku-4-5-20251001",
    rejectsSampling: false,
    thinksByDefault: false,
  },
  {
    modelName: "claude-opus-4-1-20250805",
    rejectsSampling: false,
    thinksByDefault: false,
  },
  {
    modelName: "claude-sonnet-4-0",
    rejectsSampling: false,
    thinksByDefault: false,
  },
  // A dated id whose date must not be read as a minor version.
  {
    modelName: "claude-sonnet-4-20250514",
    rejectsSampling: false,
    thinksByDefault: false,
  },
  {
    modelName: "claude-opus-4-20250514",
    rejectsSampling: false,
    thinksByDefault: false,
  },
  // The older naming scheme puts the version before the family.
  {
    modelName: "claude-3-7-sonnet-20250219",
    rejectsSampling: false,
    thinksByDefault: false,
  },
  {
    modelName: "claude-3-5-haiku-20241022",
    rejectsSampling: false,
    thinksByDefault: false,
  },
  {
    modelName: "claude-3-haiku-20240307",
    rejectsSampling: false,
    thinksByDefault: false,
  },
];

const NOT_CLAUDE: Array<string> = [
  "",
  "gpt-5.1",
  "gpt-4o",
  "o3-mini",
  "llama3.1",
  "mistral-large-latest",
  "my-deployment",
  // A gateway's own name for a Claude model says nothing a hint can use.
  "prod-claude",
  "claude",
  "claude-instant-1.2",
  "claude-2.1",
  // No version: an Opus, Sonnet or Haiku we cannot place.
  "claude-sonnet",
  "claude-opus-latest",
];

describe("ClaudeModels — current models", () => {
  test.each(CURRENT_MODELS)(
    "$modelName: refuses sampling $rejectsSampling, thinks unasked $thinksByDefault",
    (modelCase: ModelCase) => {
      expect(ClaudeModels.rejectsSamplingParameters(modelCase.modelName)).toBe(
        modelCase.rejectsSampling,
      );
      expect(ClaudeModels.thinksByDefault(modelCase.modelName)).toBe(
        modelCase.thinksByDefault,
      );
    },
  );

  test("the model the issue was reported on is covered", () => {
    // Issue #4583: claude-sonnet-5-5 answered temperature with a 400.
    expect(ClaudeModels.rejectsSamplingParameters("claude-sonnet-5-5")).toBe(
      true,
    );
  });
});

describe("ClaudeModels — older models keep their sampling parameters", () => {
  test.each(OLDER_MODELS)(
    "$modelName takes temperature and does not think unasked",
    (modelCase: ModelCase) => {
      expect(ClaudeModels.rejectsSamplingParameters(modelCase.modelName)).toBe(
        false,
      );
      expect(ClaudeModels.thinksByDefault(modelCase.modelName)).toBe(false);
    },
  );
});

describe("ClaudeModels — ids that are not a Claude model it can place", () => {
  test.each(NOT_CLAUDE)("%p gets no hint either way", (modelName: string) => {
    expect(ClaudeModels.rejectsSamplingParameters(modelName)).toBe(false);
    expect(ClaudeModels.thinksByDefault(modelName)).toBe(false);
  });

  test("an undefined model name gets no hint", () => {
    expect(ClaudeModels.parse(undefined)).toBeNull();
    expect(ClaudeModels.rejectsSamplingParameters(undefined)).toBe(false);
    expect(ClaudeModels.thinksByDefault(undefined)).toBe(false);
  });
});

describe("ClaudeModels — the shapes clouds and gateways give an id", () => {
  test.each([
    // Amazon Bedrock's Messages-API ids.
    ["anthropic.claude-sonnet-5-5", true, true],
    ["anthropic.claude-haiku-5-5", true, true],
    // Bedrock cross-region inference profiles.
    ["us.anthropic.claude-opus-4-7", true, false],
    ["global.anthropic.claude-opus-5-5", true, true],
    // Bedrock's InvokeModel ids carry a version suffix.
    ["anthropic.claude-sonnet-4-5-20250929-v1:0", false, false],
    ["us.anthropic.claude-haiku-4-5-20251001-v1:0", false, false],
    // Google Cloud writes a dated snapshot with "@".
    ["claude-haiku-4-5@20251001", false, false],
    ["claude-opus-4-5@20251101", false, false],
    // OpenRouter writes the provider in front and the version with a dot.
    ["anthropic/claude-sonnet-5.5", true, true],
    ["anthropic/claude-opus-4.7", true, false],
    ["anthropic/claude-sonnet-4.5", false, false],
    // LiteLLM model groups and other gateway prefixes.
    ["bedrock/anthropic.claude-opus-5-5", true, true],
    ["vertex_ai/claude-sonnet-5-5", true, true],
    // Case does not matter.
    ["Claude-Sonnet-5-5", true, true],
  ])(
    "%p: refuses sampling %p, thinks unasked %p",
    (modelName: string, rejectsSampling: boolean, thinks: boolean) => {
      expect(ClaudeModels.rejectsSamplingParameters(modelName)).toBe(
        rejectsSampling,
      );
      expect(ClaudeModels.thinksByDefault(modelName)).toBe(thinks);
    },
  );
});

describe("ClaudeModels.parse", () => {
  test.each([
    ["claude-sonnet-5-5", ClaudeModelFamily.Sonnet, 5, 5],
    ["claude-opus-4-7", ClaudeModelFamily.Opus, 4, 7],
    ["claude-haiku-4-5-20251001", ClaudeModelFamily.Haiku, 4, 5],
    ["claude-opus-4-20250514", ClaudeModelFamily.Opus, 4, 0],
    ["claude-sonnet-5", ClaudeModelFamily.Sonnet, 5, 0],
    ["anthropic/claude-sonnet-5.5", ClaudeModelFamily.Sonnet, 5, 5],
    ["claude-fable-5-1", ClaudeModelFamily.Fable, 5, 1],
  ])(
    "%p is %p %p.%p",
    (
      modelName: string,
      family: ClaudeModelFamily,
      major: number,
      minor: number,
    ) => {
      const version: ClaudeModelVersion | null = ClaudeModels.parse(modelName);

      expect(version).toEqual({ family, major, minor });
    },
  );

  test("a versionless id keeps its family and no major version", () => {
    expect(ClaudeModels.parse("claude-mythos-preview")).toEqual({
      family: ClaudeModelFamily.Mythos,
      major: undefined,
      minor: 0,
    });
  });

  test("a family name must stand on its own", () => {
    /*
     * "claude-sonnetx-5" and "my-claude-opus-5-5x" are not the models their
     * prefixes look like.
     */
    expect(ClaudeModels.parse("claude-sonnetx-5")).toBeNull();
    expect(ClaudeModels.parse("xclaude-opus-5-5")).toBeNull();
  });
});

describe("ClaudeModels — the version boundaries", () => {
  test("Opus refuses sampling from 4.7 on", () => {
    expect(ClaudeModels.rejectsSamplingParameters("claude-opus-4-6")).toBe(
      false,
    );
    expect(ClaudeModels.rejectsSamplingParameters("claude-opus-4-7")).toBe(
      true,
    );
    expect(ClaudeModels.rejectsSamplingParameters("claude-opus-6")).toBe(true);
  });

  test("Sonnet and Haiku refuse sampling from 5 on", () => {
    expect(ClaudeModels.rejectsSamplingParameters("claude-sonnet-4-6")).toBe(
      false,
    );
    expect(ClaudeModels.rejectsSamplingParameters("claude-sonnet-4-9")).toBe(
      false,
    );
    expect(ClaudeModels.rejectsSamplingParameters("claude-haiku-5")).toBe(true);
    expect(ClaudeModels.rejectsSamplingParameters("claude-haiku-6-1")).toBe(
      true,
    );
  });

  test("Opus, Sonnet and Haiku think unasked from 5 on, and only from 5", () => {
    expect(ClaudeModels.thinksByDefault("claude-opus-4-8")).toBe(false);
    expect(ClaudeModels.thinksByDefault("claude-opus-5")).toBe(true);
    expect(ClaudeModels.thinksByDefault("claude-sonnet-4-6")).toBe(false);
    expect(ClaudeModels.thinksByDefault("claude-sonnet-5")).toBe(true);
    expect(ClaudeModels.thinksByDefault("claude-haiku-4-5")).toBe(false);
    expect(ClaudeModels.thinksByDefault("claude-haiku-5-5")).toBe(true);
  });
});
