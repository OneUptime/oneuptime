import LLMContextWindow, {
  DEFAULT_MODEL_NAMES,
  LLM_CONTEXT_WINDOW_CATALOG,
  LLMContextWindowEntry,
  MAX_CONTEXT_WINDOW_TOKENS,
  MIN_CONTEXT_WINDOW_TOKENS,
} from "../../../../Server/Utils/LLM/LLMContextWindow";
import LLMService from "../../../../Server/Utils/LLM/LLMService";
import LlmType from "../../../../Types/LLM/LlmType";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * How many tokens one request to a model may hold, as OneUptime can tell
 * from the LLM provider's settings (issue #6530). The Runner's code agent
 * sizes its conversation to it: a model with a large window keeps more of a
 * long task whole, one with a small window is never sent more than it
 * holds. One block per provider type: where its window comes from, what a
 * blank Model Name means, and what OneUptime cannot tell - null, and the
 * agent keeps its default size.
 */

function windowOf(
  llmType: LlmType,
  modelName?: string,
  additionalParams?: Record<string, unknown>,
): number | null {
  return LLMContextWindow.getContextWindowTokens({
    llmType,
    modelName,
    additionalParams: additionalParams as never,
  });
}

describe("OpenAI", () => {
  test("its models, by id, dated or not", () => {
    expect(windowOf(LlmType.OpenAI, "gpt-5.1")).toBe(272_000);
    expect(windowOf(LlmType.OpenAI, "gpt-5")).toBe(272_000);
    expect(windowOf(LlmType.OpenAI, "gpt-5-mini")).toBe(272_000);
    expect(windowOf(LlmType.OpenAI, "gpt-5-2025-08-07")).toBe(272_000);
    expect(windowOf(LlmType.OpenAI, "gpt-5-chat-latest")).toBe(128_000);
    expect(windowOf(LlmType.OpenAI, "gpt-4.1")).toBe(1_047_576);
    expect(windowOf(LlmType.OpenAI, "gpt-4.1-mini")).toBe(1_047_576);
    expect(windowOf(LlmType.OpenAI, "gpt-4o")).toBe(128_000);
    expect(windowOf(LlmType.OpenAI, "gpt-4o-mini-2024-07-18")).toBe(128_000);
    expect(windowOf(LlmType.OpenAI, "o3")).toBe(200_000);
    expect(windowOf(LlmType.OpenAI, "o4-mini")).toBe(200_000);
    expect(windowOf(LlmType.OpenAI, "o1-mini")).toBe(128_000);
  });

  test("an id is never read as another version's: gpt-4 is not gpt-4o, gpt-4.5 or gpt-4.1", () => {
    expect(windowOf(LlmType.OpenAI, "gpt-4")).toBe(8_192);
    expect(windowOf(LlmType.OpenAI, "gpt-4-0613")).toBe(8_192);
    expect(windowOf(LlmType.OpenAI, "gpt-4-turbo-2024-04-09")).toBe(128_000);
    expect(windowOf(LlmType.OpenAI, "gpt-4.5-preview")).toBe(128_000);
    expect(windowOf(LlmType.OpenAI, "gpt-4.3")).toBeNull();
    // A version after the list: unknown, never the older model's window.
    expect(windowOf(LlmType.OpenAI, "gpt-5.7")).toBeNull();
    expect(windowOf(LlmType.OpenAI, "gpt-6-sol")).toBeNull();
  });

  test("a blank Model Name is the model LLMService asks for", () => {
    expect(windowOf(LlmType.OpenAI)).toBe(272_000);
    expect(windowOf(LlmType.OpenAI, "  ")).toBe(272_000);
  });
});

describe("Azure OpenAI", () => {
  test("a deployment named after its model has the model's window", () => {
    expect(windowOf(LlmType.AzureOpenAI, "gpt-4o")).toBe(128_000);
    expect(windowOf(LlmType.AzureOpenAI, "gpt-4.1-mini")).toBe(1_047_576);
  });

  test("a deployment of a name of its own cannot be told", () => {
    expect(windowOf(LlmType.AzureOpenAI, "prod-chat")).toBeNull();
  });

  test("a blank Model Name is the default deployment, gpt-4o", () => {
    expect(windowOf(LlmType.AzureOpenAI)).toBe(128_000);
  });
});

describe("Anthropic", () => {
  test("every Claude model since 2.1 takes 200,000 tokens", () => {
    for (const model of [
      "claude-sonnet-5-5",
      "claude-opus-4-1-20250805",
      "claude-3-5-sonnet-20241022",
      "claude-3-haiku-20240307",
      "claude-2.1",
    ]) {
      expect({ model, tokens: windowOf(LlmType.Anthropic, model) }).toEqual({
        model,
        tokens: 200_000,
      });
    }
  });

  test("the retired Claude 2.0 and Claude Instant took 100,000", () => {
    expect(windowOf(LlmType.Anthropic, "claude-2.0")).toBe(100_000);
    expect(windowOf(LlmType.Anthropic, "claude-2")).toBe(100_000);
    expect(windowOf(LlmType.Anthropic, "claude-instant-1.2")).toBe(100_000);
  });

  test("a blank Model Name is LLMService's default Claude model", () => {
    expect(windowOf(LlmType.Anthropic)).toBe(200_000);
  });
});

describe("Groq", () => {
  test("its models, under the ids Groq names them, provider path and all", () => {
    expect(windowOf(LlmType.Groq, "llama-3.3-70b-versatile")).toBe(131_072);
    expect(windowOf(LlmType.Groq, "openai/gpt-oss-120b")).toBe(131_072);
    expect(
      windowOf(LlmType.Groq, "meta-llama/llama-4-scout-17b-16e-instruct"),
    ).toBe(131_072);
    expect(windowOf(LlmType.Groq, "moonshotai/kimi-k2-instruct")).toBe(131_072);
    expect(windowOf(LlmType.Groq, "moonshotai/kimi-k2-instruct-0905")).toBe(
      262_144,
    );
  });

  test("its small-window models say so", () => {
    expect(windowOf(LlmType.Groq, "gemma2-9b-it")).toBe(8_192);
    expect(windowOf(LlmType.Groq, "mixtral-8x7b-32768")).toBe(32_768);
  });

  test("a blank Model Name is LLMService's default, llama-3.3-70b-versatile", () => {
    expect(windowOf(LlmType.Groq)).toBe(131_072);
  });
});

describe("Mistral", () => {
  test("its models, by family and by dated id", () => {
    expect(windowOf(LlmType.Mistral, "mistral-large-latest")).toBe(131_072);
    expect(windowOf(LlmType.Mistral, "mistral-medium-2505")).toBe(131_072);
    expect(windowOf(LlmType.Mistral, "codestral-latest")).toBe(256_000);
    expect(windowOf(LlmType.Mistral, "devstral-small-2507")).toBe(131_072);
  });

  test("the dated models with smaller windows say so", () => {
    expect(windowOf(LlmType.Mistral, "mistral-small-2402")).toBe(32_768);
    expect(windowOf(LlmType.Mistral, "codestral-2405")).toBe(32_768);
    expect(windowOf(LlmType.Mistral, "mistral-small-latest")).toBe(131_072);
  });

  test("a blank Model Name is LLMService's default, mistral-large-latest", () => {
    expect(windowOf(LlmType.Mistral)).toBe(131_072);
  });
});

describe("Ollama", () => {
  test("the window is the num_ctx the provider asks Ollama for", () => {
    expect(
      windowOf(LlmType.Ollama, "llama3.1", { options: { num_ctx: 32_768 } }),
    ).toBe(32_768);
    expect(
      windowOf(LlmType.Ollama, "qwen3:32b", { options: { num_ctx: "65536" } }),
    ).toBe(65_536);
  });

  test("without num_ctx it cannot be told: Ollama sizes the window by the GPU it finds", () => {
    expect(windowOf(LlmType.Ollama, "llama3.1")).toBeNull();
    expect(windowOf(LlmType.Ollama, "llama3.1", {})).toBeNull();
    expect(
      windowOf(LlmType.Ollama, "llama3.1", { options: { temperature: 0.2 } }),
    ).toBeNull();
    // The model's own window is not what Ollama serves it with.
    expect(windowOf(LlmType.Ollama, "gpt-oss-120b")).toBeNull();
  });

  test("a num_ctx that is not a number of tokens is none", () => {
    for (const numCtx of [0, -4096, 512, Number.NaN, "lots", true, null]) {
      expect(
        windowOf(LlmType.Ollama, "llama3.1", { options: { num_ctx: numCtx } }),
      ).toBeNull();
    }
    expect(
      windowOf(LlmType.Ollama, "llama3.1", { options: [{ num_ctx: 8192 }] }),
    ).toBeNull();
    expect(windowOf(LlmType.Ollama, "llama3.1", { num_ctx: 8192 })).toBeNull();
  });
});

describe("OpenAI-compatible servers", () => {
  test("a self-hosted model cannot be told: the server sets its window", () => {
    expect(
      windowOf(LlmType.OpenAICompatible, "Qwen/Qwen2.5-Coder-32B-Instruct"),
    ).toBeNull();
    expect(windowOf(LlmType.OpenAICompatible, "local-model")).toBeNull();
  });

  test("a hosted model a gateway serves has its window", () => {
    expect(
      windowOf(LlmType.OpenAICompatible, "anthropic/claude-sonnet-4-5"),
    ).toBe(200_000);
    expect(windowOf(LlmType.OpenAICompatible, "openai/gpt-4o")).toBe(128_000);
    expect(
      windowOf(
        LlmType.OpenAICompatible,
        "us.anthropic.claude-3-5-sonnet-20241022-v2:0",
      ),
    ).toBe(200_000);
  });

  test("a blank Model Name is the first model the server lists, which cannot be told", () => {
    expect(windowOf(LlmType.OpenAICompatible)).toBeNull();
  });
});

describe("no provider type", () => {
  test("is no window", () => {
    expect(
      LLMContextWindow.getContextWindowTokens({
        llmType: undefined,
        modelName: "gpt-4o",
      }),
    ).toBeNull();
  });
});

describe("the catalog", () => {
  test("every entry is a lower-case id and a window in bounds, each once", () => {
    const seen: Set<string> = new Set<string>();

    for (const entry of LLM_CONTEXT_WINDOW_CATALOG) {
      expect(entry.model).toBe(entry.model.toLowerCase().trim());
      expect(entry.model).not.toContain("/");
      expect(Number.isInteger(entry.tokens)).toBe(true);
      expect(entry.tokens).toBeGreaterThanOrEqual(MIN_CONTEXT_WINDOW_TOKENS);
      expect(entry.tokens).toBeLessThanOrEqual(MAX_CONTEXT_WINDOW_TOKENS);
      expect(seen.has(entry.model)).toBe(false);
      seen.add(entry.model);
    }
  });

  test("every entry reads back as itself", () => {
    for (const entry of LLM_CONTEXT_WINDOW_CATALOG) {
      expect({
        model: entry.model,
        tokens: LLMContextWindow.getCatalogWindow(entry.model),
      }).toEqual({ model: entry.model, tokens: entry.tokens });
    }
  });

  test("the longest entry that names a model wins", () => {
    const entries: Array<LLMContextWindowEntry> =
      LLM_CONTEXT_WINDOW_CATALOG.filter(
        (entry: LLMContextWindowEntry): boolean => {
          return entry.model.startsWith("o1");
        },
      );

    expect(entries.length).toBeGreaterThan(1);
    expect(LLMContextWindow.getCatalogWindow("o1-mini-2024-09-12")).toBe(
      128_000,
    );
    expect(LLMContextWindow.getCatalogWindow("o1-2024-12-17")).toBe(200_000);
  });

  test("a model id is read without its case, a gateway's path or Bedrock's region", () => {
    expect(LLMContextWindow.normalizeModelId(" GPT-4o ")).toBe("gpt-4o");
    expect(LLMContextWindow.normalizeModelId("openai/gpt-4o")).toBe("gpt-4o");
    expect(
      LLMContextWindow.normalizeModelId(
        "eu.anthropic.claude-3-7-sonnet-20250219-v1:0",
      ),
    ).toBe("claude-3-7-sonnet-20250219-v1:0");
    expect(
      LLMContextWindow.normalizeModelId(
        "anthropic.claude-3-haiku-20240307-v1:0",
      ),
    ).toBe("claude-3-haiku-20240307-v1:0");
  });
});

/*
 * A blank Model Name is read as the model LLMService asks for then: the two
 * must name the same model, or the window would be another model's.
 */
describe("the default models are LLMService's", () => {
  const source: string = fs.readFileSync(
    path.join(__dirname, "../../../../Server/Utils/LLM/LLMService.ts"),
    "utf8",
  );

  test("Anthropic's and Azure OpenAI's, from their constants", () => {
    expect(DEFAULT_MODEL_NAMES[LlmType.Anthropic]).toBe(
      LLMService.ANTHROPIC_DEFAULT_MODEL,
    );
    expect(DEFAULT_MODEL_NAMES[LlmType.AzureOpenAI]).toBe(
      LLMService.AZURE_OPENAI_DEFAULT_DEPLOYMENT,
    );
  });

  test.each([[LlmType.OpenAI], [LlmType.Groq], [LlmType.Mistral]])(
    "%s's, as its OpenAI-wire default",
    (llmType: LlmType) => {
      expect(source).toContain(
        `[LlmType.${llmType}]: "${DEFAULT_MODEL_NAMES[llmType]}",`,
      );
    },
  );

  test("Ollama and OpenAI-compatible servers have none here: their window is not the model's", () => {
    expect(DEFAULT_MODEL_NAMES[LlmType.Ollama]).toBeUndefined();
    expect(DEFAULT_MODEL_NAMES[LlmType.OpenAICompatible]).toBeUndefined();
  });
});
