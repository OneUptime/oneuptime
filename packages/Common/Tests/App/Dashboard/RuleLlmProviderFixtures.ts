import { jest } from "@jest/globals";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import API from "../../../UI/Utils/API/API";

/*
 * The project's LLM providers as POST /ai-chat/providers answers them
 * (Common/Server/API/AIChatAPI), for the tests of the rule forms whose
 * "LLM Provider" field reads them (RuleLlmProviderField).
 */

export interface ProviderRow {
  id: string;
  name: string;
  modelName: string | null;
  isDefault: boolean;
  isGlobal: boolean;
}

export const AZURE_PROVIDER: ProviderRow = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
  name: "Azure GPT-4o",
  modelName: "gpt-4o",
  isDefault: true,
  isGlobal: false,
};

export const OPUS_PROVIDER: ProviderRow = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
  name: "Claude Opus",
  modelName: "claude-opus-4-5",
  isDefault: false,
  isGlobal: false,
};

export const ONEUPTIME_AI_PROVIDER: ProviderRow = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3",
  name: "OneUptime AI",
  modelName: null,
  isDefault: false,
  isGlobal: true,
};

export function providersAnswer(
  providers: Array<ProviderRow>,
  defaultProviderId: string | null,
): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(
    200,
    {
      isAIEnabledForProject: true,
      defaultProviderId,
      providers: providers.map((provider: ProviderRow): JSONObject => {
        return { ...provider, description: null, llmType: null };
      }),
    } as unknown as JSONObject,
    {},
  );
}

// A project with a default of its own, another of its own, and the global one.
export function projectProvidersAnswer(): HTTPResponse<JSONObject> {
  return providersAnswer(
    [AZURE_PROVIDER, OPUS_PROVIDER, ONEUPTIME_AI_PROVIDER],
    AZURE_PROVIDER.id,
  );
}

/*
 * Answers the providers route with `answer` (by default, never: the field
 * waits); every other post goes where it always went.
 */
export function mockRuleLlmProviders(
  answer?: HTTPResponse<JSONObject> | HTTPErrorResponse,
): ReturnType<typeof jest.spyOn> {
  const original: typeof API.post = API.post.bind(API);

  return jest.spyOn(API, "post").mockImplementation(((
    options: Parameters<typeof API.post>[0],
  ) => {
    if (String(options.url).endsWith("/ai-chat/providers")) {
      // With no answer, one that never comes: the field keeps waiting.
      return answer ? Promise.resolve(answer) : new Promise<never>(() => {});
    }

    return original(options);
  }) as typeof API.post);
}
