import LLMPromptCacheKey, {
  PROMPT_CACHE_KEY_LENGTH,
} from "../../../../Server/Utils/LLM/LLMPromptCacheKey";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * The prompt_cache_key OneUptime sends to OpenAI: one per project and kind
 * of AI work. No project's prompts share a cache with another's, and the
 * calls that start with the same system prompt and tools - every call of a
 * kind of work, every call of one investigation or chat - share one.
 */

const PROJECT_A: ObjectID = new ObjectID(
  "6f1d2c3b-4a59-4e8f-9a7b-1c2d3e4f5a6b",
);
const PROJECT_B: ObjectID = new ObjectID(
  "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
);

const HEX: RegExp = /^[0-9a-f]+$/;

describe("LLMPromptCacheKey.build", () => {
  test("is a hash of fixed length, in lowercase hex", () => {
    const key: string = LLMPromptCacheKey.build({
      projectId: PROJECT_A,
      feature: "AI Incident Investigation",
    });

    expect(key).toHaveLength(PROMPT_CACHE_KEY_LENGTH);
    expect(PROMPT_CACHE_KEY_LENGTH).toBe(32);
    expect(HEX.test(key)).toBe(true);
  });

  test("is the same for every call of a project's kind of work", () => {
    expect(
      LLMPromptCacheKey.build({ projectId: PROJECT_A, feature: "AI Chat" }),
    ).toBe(
      LLMPromptCacheKey.build({
        projectId: new ObjectID(PROJECT_A.toString().toUpperCase()),
        feature: " AI Chat ",
      }),
    );
  });

  test("differs between projects, so no two share a cache", () => {
    expect(
      LLMPromptCacheKey.build({ projectId: PROJECT_A, feature: "AI Chat" }),
    ).not.toBe(
      LLMPromptCacheKey.build({ projectId: PROJECT_B, feature: "AI Chat" }),
    );
  });

  test("differs between kinds of work, whose prompts start differently", () => {
    const keys: Set<string> = new Set(
      [
        "AI Chat",
        "AI Incident Investigation",
        "AI Alert Investigation",
        "AI Incident Postmortem",
        "",
      ].map((feature: string): string => {
        return LLMPromptCacheKey.build({ projectId: PROJECT_A, feature });
      }),
    );

    expect(keys.size).toBe(5);
  });

  test("tells OpenAI neither the project's id nor the work", () => {
    const key: string = LLMPromptCacheKey.build({
      projectId: PROJECT_A,
      feature: "AI Chat",
    });

    expect(key).not.toContain(PROJECT_A.toString().substring(0, 8));
    expect(key.toLowerCase()).not.toContain("chat");
  });
});
