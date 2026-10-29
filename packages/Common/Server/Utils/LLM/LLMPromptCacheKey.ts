import ObjectID from "../../../Types/ObjectID";
import crypto from "crypto";

/*
 * The prompt_cache_key OneUptime sends to OpenAI (LLMService, the OpenAI
 * provider type only).
 *
 * OpenAI caches a repeated prompt on its own. The key says which requests
 * belong together, and OpenAI's guide asks for one key per customer: a
 * key's cache is kept apart from every other key's, and on models before
 * GPT-5.6 requests with the same key are routed to where the earlier ones
 * were cached. So the key is one per project and kind of AI work (the
 * call's feature, such as "AI Incident Investigation" or "AI Chat"):
 *
 *  - No project's prompts share a cache with another project's - on the
 *    OneUptime-hosted provider every project's calls go to one OpenAI
 *    account, and a shared cache would let one project's calls tell, by how
 *    fast they come back, what another's sent.
 *  - The calls that send the same long prefix share a key: every call of a
 *    kind of work starts with the same system prompt and tools, and every
 *    call of one investigation or chat sends its conversation again. One key
 *    per conversation would keep apart what they share, and OpenAI would
 *    write the system prompt and tools to its cache again for each one (a
 *    quarter more than a fresh token from GPT-5.6).
 *
 * The key is a hash: OpenAI sees neither the project's id nor the feature.
 * It is the same for every call of a project's kind of work, whatever the
 * provider or model, and changes with neither.
 */

// Hex characters of the hash the key keeps: 128 bits, far past any collision.
export const PROMPT_CACHE_KEY_LENGTH: number = 32;

export default class LLMPromptCacheKey {
  public static build(data: { projectId: ObjectID; feature: string }): string {
    return crypto
      .createHash("sha256")
      .update("prompt-cache-key\n")
      .update(data.projectId.toString().trim().toLowerCase())
      .update("\n")
      .update((data.feature || "").trim())
      .digest("hex")
      .substring(0, PROMPT_CACHE_KEY_LENGTH);
  }
}
