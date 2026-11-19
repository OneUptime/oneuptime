import LlmType from "../../../Types/LLM/LlmType";
import { JSONObject } from "../../../Types/JSON";

/*
 * How many tokens one request to a model may hold - its prompt and its
 * answer together - as far as OneUptime can tell from the LLM provider's
 * settings (issue #6530). The Runner's code agent sizes its conversation to
 * it, so a model with a large window keeps more of a long task whole, and
 * one with a small window is never sent more than it holds.
 *
 * Where it comes from:
 *
 *   - Ollama: the provider's own `num_ctx` (Additional Parameters →
 *     `options`), which is the window Ollama serves the model with. Without
 *     it, Ollama picks the window by the GPU memory it finds, which
 *     OneUptime cannot know.
 *   - Every other provider: the model, by the catalog below - the hosted
 *     providers' models, under the ids their APIs, Azure deployments and
 *     gateways (OpenRouter's "openai/gpt-4o", Bedrock's
 *     "us.anthropic.claude-...") name them.
 *
 * Unknown is null - a self-hosted model on an OpenAI-compatible server, a
 * model released after this list - and the agent keeps its default size,
 * and halves it when the model says a conversation was too long. Every
 * number here is the model's whole window as its provider documents it,
 * or less where the provider holds a request's prompt to less (the GPT-5
 * models take 272,000 prompt tokens of their 400,000): never more, so a
 * conversation sized to it fits.
 */

// The default models, as LLMService asks for them when Model Name is blank.
export const DEFAULT_MODEL_NAMES: Readonly<Partial<Record<LlmType, string>>> = {
  [LlmType.OpenAI]: "gpt-5.1",
  [LlmType.AzureOpenAI]: "gpt-4o",
  [LlmType.Anthropic]: "claude-sonnet-5-5",
  [LlmType.Groq]: "llama-3.3-70b-versatile",
  [LlmType.Mistral]: "mistral-large-latest",
};

export interface LLMContextWindowEntry {
  /*
   * A model id, lower case, as its provider names it. It names the model
   * itself and the ids that go on from it after a "-", ":" or "@" (a date,
   * a size, a tag) - never one that goes on to a later version ("gpt-4" is
   * never "gpt-4.5" or "gpt-4o").
   */
  model: string;
  // The most tokens one request may hold, prompt and answer together.
  tokens: number;
}

export const LLM_CONTEXT_WINDOW_CATALOG: ReadonlyArray<LLMContextWindowEntry> =
  [
    // ---- OpenAI (and Azure OpenAI deployments named after their model) ----
    { model: "gpt-5", tokens: 272_000 },
    { model: "gpt-5.1", tokens: 272_000 },
    { model: "gpt-5.2", tokens: 272_000 },
    // ChatGPT's own GPT-5 models take 128,000.
    { model: "gpt-5-chat", tokens: 128_000 },
    { model: "gpt-5.1-chat", tokens: 128_000 },
    { model: "gpt-4.1", tokens: 1_047_576 },
    { model: "gpt-4o", tokens: 128_000 },
    { model: "chatgpt-4o", tokens: 128_000 },
    { model: "gpt-4.5", tokens: 128_000 },
    { model: "gpt-4-turbo", tokens: 128_000 },
    { model: "gpt-4-1106", tokens: 128_000 },
    { model: "gpt-4-0125", tokens: 128_000 },
    { model: "gpt-4-32k", tokens: 32_768 },
    { model: "gpt-4", tokens: 8_192 },
    { model: "gpt-3.5-turbo", tokens: 16_385 },
    { model: "o1", tokens: 200_000 },
    { model: "o1-mini", tokens: 128_000 },
    { model: "o1-preview", tokens: 128_000 },
    { model: "o3", tokens: 200_000 },
    { model: "o3-mini", tokens: 200_000 },
    { model: "o4-mini", tokens: 200_000 },
    { model: "codex-mini", tokens: 200_000 },
    { model: "gpt-oss-120b", tokens: 131_072 },
    { model: "gpt-oss-20b", tokens: 131_072 },

    // ---- Anthropic: every Claude model since Claude 2.1 takes 200,000 ----
    { model: "claude", tokens: 200_000 },
    { model: "claude-2", tokens: 100_000 },
    { model: "claude-2.0", tokens: 100_000 },
    { model: "claude-instant", tokens: 100_000 },

    // ---- Groq ----
    { model: "llama-3.3-70b-versatile", tokens: 131_072 },
    { model: "llama-3.1-8b-instant", tokens: 131_072 },
    { model: "llama-4-scout-17b-16e-instruct", tokens: 131_072 },
    { model: "llama-4-maverick-17b-128e-instruct", tokens: 131_072 },
    { model: "llama3-70b-8192", tokens: 8_192 },
    { model: "llama3-8b-8192", tokens: 8_192 },
    { model: "mixtral-8x7b-32768", tokens: 32_768 },
    { model: "gemma2-9b-it", tokens: 8_192 },
    { model: "qwen3-32b", tokens: 131_072 },
    { model: "kimi-k2-instruct", tokens: 131_072 },
    { model: "kimi-k2-instruct-0905", tokens: 262_144 },
    { model: "deepseek-r1-distill-llama-70b", tokens: 131_072 },

    // ---- Mistral ----
    { model: "mistral-large", tokens: 131_072 },
    { model: "mistral-medium", tokens: 131_072 },
    { model: "mistral-small", tokens: 131_072 },
    { model: "mistral-small-2402", tokens: 32_768 },
    { model: "codestral", tokens: 256_000 },
    { model: "codestral-2405", tokens: 32_768 },
    { model: "devstral", tokens: 131_072 },
    { model: "ministral", tokens: 131_072 },
    { model: "open-mistral-nemo", tokens: 131_072 },
    { model: "pixtral-large", tokens: 131_072 },
  ];

// The least a window may be to be one: a number below it is a typo.
export const MIN_CONTEXT_WINDOW_TOKENS: number = 1_024;

// The most: past every model's window, inside a Postgres integer.
export const MAX_CONTEXT_WINDOW_TOKENS: number = 100_000_000;

// What may follow a model's id in a longer id of the same model.
const ID_CONTINUES: RegExp = /^[-:@_]/;

// A cloud's region before a Bedrock id: "us.", "eu.", "apac.", "global.".
const BEDROCK_REGION: RegExp = /^(?:[a-z]{2,6}\.)?anthropic\./;

export default class LLMContextWindow {
  /*
   * The window of the model a request went to, or null when OneUptime cannot
   * tell. `modelName` is the model the request asked for (the AI Log's, which
   * LLMService fills in when Model Name is blank); the provider type's
   * default stands in for a blank one.
   */
  public static getContextWindowTokens(data: {
    llmType: LlmType | null | undefined;
    modelName?: string | null | undefined;
    additionalParams?: JSONObject | null | undefined;
  }): number | null {
    if (!data.llmType) {
      return null;
    }

    if (data.llmType === LlmType.Ollama) {
      return this.getOllamaNumCtx(data.additionalParams);
    }

    const modelName: string =
      (data.modelName || "").trim() || DEFAULT_MODEL_NAMES[data.llmType] || "";

    return this.getCatalogWindow(modelName);
  }

  /*
   * The num_ctx an Ollama provider asks for in its Additional Parameters
   * (`{"options": {"num_ctx": 65536}}`), or null when it asks for none or for
   * something that is not a number of tokens.
   */
  public static getOllamaNumCtx(
    additionalParams: JSONObject | null | undefined,
  ): number | null {
    const options: unknown = additionalParams?.["options"];

    if (!options || typeof options !== "object" || Array.isArray(options)) {
      return null;
    }

    return this.readTokens((options as JSONObject)["num_ctx"]);
  }

  /*
   * The catalog's window for a model id, or null for a model it does not
   * know. The longest entry that names the model wins: gpt-4o-mini is
   * gpt-4o's, gpt-4-0613 is gpt-4's, gpt-4.5-preview neither.
   */
  public static getCatalogWindow(modelName: string): number | null {
    const id: string = this.normalizeModelId(modelName);

    if (!id) {
      return null;
    }

    let best: LLMContextWindowEntry | null = null;

    for (const entry of LLM_CONTEXT_WINDOW_CATALOG) {
      if (!this.namesModel(entry.model, id)) {
        continue;
      }

      if (!best || entry.model.length > best.model.length) {
        best = entry;
      }
    }

    return best ? best.tokens : null;
  }

  /*
   * A model id as the catalog lists it: lower case, without the provider's
   * path a gateway or Groq puts before it ("openai/", "meta-llama/",
   * "anthropic/") and without Bedrock's region and namespace
   * ("us.anthropic.").
   */
  public static normalizeModelId(modelName: string): string {
    const lower: string = (modelName || "").trim().toLowerCase();
    const lastSegment: string = lower.substring(lower.lastIndexOf("/") + 1);

    return lastSegment.replace(BEDROCK_REGION, "");
  }

  // A number of tokens a window may be, or null.
  public static readTokens(value: unknown): number | null {
    const tokens: number =
      typeof value === "number"
        ? value
        : typeof value === "string" && value.trim().length > 0
          ? Number(value.trim())
          : Number.NaN;

    if (
      !Number.isFinite(tokens) ||
      tokens < MIN_CONTEXT_WINDOW_TOKENS ||
      tokens > MAX_CONTEXT_WINDOW_TOKENS
    ) {
      return null;
    }

    return Math.floor(tokens);
  }

  private static namesModel(entry: string, id: string): boolean {
    if (id === entry) {
      return true;
    }

    return (
      id.startsWith(entry) && ID_CONTINUES.test(id.substring(entry.length))
    );
  }
}
