/*
 * Where OneUptime sends an LLM provider's requests, worked out from the Base
 * URL the provider was saved with.
 *
 * People paste whatever their cloud's portal shows them, so a Base URL comes
 * in several shapes for the same endpoint. For Microsoft Foundry and Azure
 * OpenAI, that is the resource's endpoint
 * (https://contoso.openai.azure.com), its v1 API
 * (https://contoso.openai.azure.com/openai/v1), a deployment
 * (.../openai/deployments/gpt-4o), or a deployment's whole Target URI
 * (.../chat/completions?api-version=...). For Claude in Foundry it is the
 * SDK's base URL (https://contoso.services.ai.azure.com/anthropic) or the
 * Target URI (.../anthropic/v1/messages). Each of them is taken to mean the
 * endpoint it names, rather than having the path appended to it a second
 * time and answering 404.
 *
 * Plain functions of the text, with no network and no server dependency:
 * LLMService sends to what they return, and the tests (and the docs that
 * quote them) hold every documented Base URL to the request it produces.
 */

export interface SplitBaseUrl {
  // Scheme (lower-cased) and authority: "https://contoso.openai.azure.com".
  origin: string;
  // The host alone, lower-cased: "contoso.openai.azure.com".
  host: string;
  // The path with no trailing slash, "" at the root: "/openai/v1".
  path: string;
  // "?" and the query, or "": "?api-version=preview".
  query: string;
}

export interface AzureOpenAIRequestEndpoint {
  // The URL the chat completion is posted to.
  requestUrl: string;
  /*
   * True when the request goes to Azure's v1 API (/openai/v1), which names
   * the deployment in the request's `model` and takes no dated api-version.
   * False for a deployment URL (/openai/deployments/<name>) and any other
   * path, such as a gateway's, which carry their own api-version.
   */
  usesV1Api: boolean;
}

// "https://host:port" and the rest. The authority ends at the first slash.
const ORIGIN_AND_PATH: RegExp = /^([a-z][a-z0-9+.-]*:\/\/)([^/]*)(.*)$/i;

const TRAILING_SLASHES: RegExp = /\/+$/;

const USER_INFO: RegExp = /^.*@/;

const PORT: RegExp = /:\d+$/;

const LEADING_QUESTION_MARK: RegExp = /^\?/;

// A deployment's Target URI ends in the operation; the Base URL does not.
const CHAT_COMPLETIONS_SUFFIX: RegExp = /\/chat\/completions$/i;

// The root of Azure OpenAI's API on every Azure host.
const AZURE_OPENAI_ROOT: RegExp = /^\/openai$/i;

const AZURE_OPENAI_V1_PATH: RegExp = /\/openai\/v1$/i;

const MESSAGES_SUFFIX: RegExp = /\/messages$/i;

// The Anthropic SDKs' base URL for Claude in Foundry and for gateways.
const ANTHROPIC_ROOT_SUFFIX: RegExp = /\/anthropic$/i;

/*
 * Claude's Messages API on a Foundry resource (or a gateway's): its base
 * URL, the same with the API version, or a deployment's Target URI.
 */
const ANTHROPIC_API_PATH: RegExp = /\/anthropic(?:\/v1)?(?:\/messages)?$/i;

// A Microsoft Foundry resource's own host name.
const FOUNDRY_HOST: RegExp = /\.services\.ai\.azure\.(com|us|cn)$/i;

export default class LlmProviderEndpoint {
  /*
   * The api-version OneUptime asks for when a Base URL names a deployment
   * (/openai/deployments/<name>) but no api-version: Azure OpenAI's newest
   * generally available dated version. The v1 API takes none.
   */
  public static readonly AZURE_OPENAI_DEFAULT_API_VERSION: string =
    "2024-10-21";

  // Anthropic's own API, used when an Anthropic provider has no Base URL.
  public static readonly ANTHROPIC_DEFAULT_BASE_URL: string =
    "https://api.anthropic.com/v1";

  /*
   * A Base URL in parts. Leading and trailing spaces are ignored, the scheme
   * is lower-cased (URL schemes are case-insensitive, URL parsing downstream
   * is not), trailing slashes are dropped from the path, and a #fragment is
   * dropped: a browser never sends one, and appending a path after it would
   * land inside it.
   */
  public static splitBaseUrl(baseUrl: string): SplitBaseUrl {
    const raw: string = (baseUrl || "").trim();

    const fragmentIndex: number = raw.indexOf("#");
    const withoutFragment: string =
      fragmentIndex >= 0 ? raw.substring(0, fragmentIndex) : raw;

    const queryIndex: number = withoutFragment.indexOf("?");
    const rawQuery: string =
      queryIndex >= 0 ? withoutFragment.substring(queryIndex) : "";
    const beforeQuery: string =
      queryIndex >= 0
        ? withoutFragment.substring(0, queryIndex)
        : withoutFragment;
    const query: string = rawQuery === "?" ? "" : rawQuery;

    const match: RegExpMatchArray | null = beforeQuery.match(ORIGIN_AND_PATH);

    if (!match) {
      // No scheme: nothing to tell the host from the path.
      return {
        origin: "",
        host: "",
        path: beforeQuery.replace(TRAILING_SLASHES, ""),
        query: query,
      };
    }

    const scheme: string = match[1]!.toLowerCase();
    const authority: string = match[2]!;

    return {
      origin: `${scheme}${authority}`,
      host: authority.replace(USER_INFO, "").replace(PORT, "").toLowerCase(),
      path: match[3]!.replace(TRAILING_SLASHES, ""),
      query: query,
    };
  }

  /*
   * The chat completions URL of an Azure OpenAI provider: a Microsoft
   * Foundry or Azure OpenAI resource, or a gateway in front of one.
   *
   *   - The resource's endpoint alone (https://contoso.openai.azure.com, as
   *     the Azure portal shows it), or its /openai root, goes to Azure's v1
   *     API: .../openai/v1/chat/completions. The deployment is the
   *     provider's Model Name.
   *   - A Base URL that already ends in /openai/v1 goes to its
   *     /chat/completions. The v1 API takes no dated api-version, so none is
   *     added; one the Base URL carries (such as api-version=preview) is
   *     kept.
   *   - Any other path, a deployment's (/openai/deployments/gpt-4o) above
   *     all, gets /chat/completions and, unless the Base URL names one, the
   *     api-version AZURE_OPENAI_DEFAULT_API_VERSION. That is what every
   *     deployment Base URL has always been sent to, so saved providers keep
   *     working as they did.
   *   - A Target URI pasted whole (it already ends in /chat/completions) is
   *     the same endpoint as the Base URL before it.
   */
  public static resolveAzureOpenAI(
    baseUrl: string,
  ): AzureOpenAIRequestEndpoint {
    const parts: SplitBaseUrl = LlmProviderEndpoint.splitBaseUrl(baseUrl);

    let path: string = parts.path
      .replace(CHAT_COMPLETIONS_SUFFIX, "")
      .replace(TRAILING_SLASHES, "");

    if (path === "") {
      path = "/openai/v1";
    } else if (AZURE_OPENAI_ROOT.test(path)) {
      path = `${path}/v1`;
    }

    const usesV1Api: boolean = AZURE_OPENAI_V1_PATH.test(path);

    const params: URLSearchParams = new URLSearchParams(
      parts.query.replace(LEADING_QUESTION_MARK, ""),
    );

    if (!usesV1Api && !params.has("api-version")) {
      params.set(
        "api-version",
        LlmProviderEndpoint.AZURE_OPENAI_DEFAULT_API_VERSION,
      );
    }

    const queryString: string = params.toString();

    return {
      requestUrl: `${parts.origin}${path}/chat/completions${
        queryString ? `?${queryString}` : ""
      }`,
      usesV1Api: usesV1Api,
    };
  }

  /*
   * The Messages URL of an Anthropic provider: Anthropic's own API, Claude
   * in Microsoft Foundry, or a gateway that speaks the Messages API.
   *
   *   - No Base URL: Anthropic's API, https://api.anthropic.com/v1/messages.
   *   - A Base URL that ends in /messages (a Foundry deployment's Target
   *     URI) is the endpoint itself.
   *   - One that ends in /anthropic, the base URL the Anthropic SDKs take for
   *     Foundry and for gateways, gets /v1/messages.
   *   - A Foundry resource's endpoint alone
   *     (https://contoso.services.ai.azure.com) goes to its Claude API,
   *     /anthropic/v1/messages.
   *   - Anything else gets /messages, as it always has: a Base URL that ends
   *     in its API version, such as https://api.anthropic.com/v1 or a
   *     Foundry resource's .../anthropic/v1.
   */
  public static resolveAnthropicMessagesUrl(
    baseUrl: string | undefined,
  ): string {
    const parts: SplitBaseUrl = LlmProviderEndpoint.splitBaseUrl(
      baseUrl || LlmProviderEndpoint.ANTHROPIC_DEFAULT_BASE_URL,
    );

    let path: string = parts.path;

    if (MESSAGES_SUFFIX.test(path)) {
      // Already the endpoint.
    } else if (ANTHROPIC_ROOT_SUFFIX.test(path)) {
      path = `${path}/v1/messages`;
    } else if (path === "" && FOUNDRY_HOST.test(parts.host)) {
      path = "/anthropic/v1/messages";
    } else {
      path = `${path}/messages`;
    }

    return `${parts.origin}${path}${parts.query}`;
  }

  // Whether a host is a Microsoft Foundry resource's (*.services.ai.azure.com).
  public static isFoundryHost(host: string): boolean {
    return FOUNDRY_HOST.test(host);
  }

  /*
   * Whether a Base URL names an Anthropic Messages API: Claude in Microsoft
   * Foundry (https://contoso.services.ai.azure.com/anthropic, .../anthropic/v1
   * or a deployment's Target URI .../anthropic/v1/messages), or a gateway's
   * /anthropic route. Foundry serves Claude only through that API, so an
   * Azure OpenAI provider pointed there speaks it (LLMService.getCompletion),
   * and one provider type covers every deployment on a Foundry resource.
   */
  public static isAnthropicApiBaseUrl(baseUrl: string): boolean {
    return ANTHROPIC_API_PATH.test(LlmProviderEndpoint.splitBaseUrl(baseUrl).path);
  }
}
