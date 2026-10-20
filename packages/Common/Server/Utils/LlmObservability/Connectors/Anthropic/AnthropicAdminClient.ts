import Dictionary from "../../../../../Types/Dictionary";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import { LlmConnectorTransport } from "../../LlmConnectorTypes";
import LlmProviderHttp, {
  buildQueryString,
  readArray,
  readObject,
  readText,
} from "../../LlmProviderHttp";

/*
 * Anthropic's Admin API, the parts an AI / LLM connection reads:
 *
 *   GET /v1/organizations/usage_report/messages   tokens per day bucket,
 *                                                 grouped by model,
 *                                                 workspace, key and account
 *   GET /v1/organizations/cost_report             cost per day, by
 *                                                 workspace and description
 *   GET /v1/organizations/users                   account emails
 *   GET /v1/organizations/api_keys                key names and who they act as
 *   GET /v1/organizations/workspaces              workspace names
 *
 * Contracts relied on, from Anthropic's "Usage and Cost API" guide and API
 * reference: an admin key (sk-ant-admin01-...) in `x-api-key` with
 * `anthropic-version: 2023-06-01`; starting_at / ending_at as RFC 3339;
 * 1d buckets, at most 31 per page; lists as `name[]=value`; report pages
 * are { data: [{ starting_at, ending_at, results }], has_more, next_page }
 * followed with `page=next_page`; a cost `amount` is a decimal string in
 * CENTS of USD ("123.45" is $1.23); lists are { data, has_more, last_id }
 * followed with `after_id`, at most 1000 per page. Polling once a minute is
 * fine; data appears within about five minutes.
 */

export const ANTHROPIC_API_BASE_URL: string = "https://api.anthropic.com/v1";
export const ANTHROPIC_API_VERSION: string = "2023-06-01";

const REPORT_PAGE_LIMIT: number = 31;
const LIST_PAGE_LIMIT: number = 1000;
const MAX_REPORT_PAGES: number = 50;
const MAX_LIST_PAGES: number = 20;

const PROVIDER_TITLE: string = "Anthropic";

export interface AnthropicApiKeyInfo {
  name: string;
  // The user the key acts as, when it is bound to one.
  principalUserId: string;
}

export interface AnthropicAdminClientOptions {
  adminKey: string;
  transport: LlmConnectorTransport;
  requestTimeoutInMs?: number | undefined;
  baseUrl?: string | undefined;
}

export default class AnthropicAdminClient {
  private options: AnthropicAdminClientOptions;
  private requestCount: number = 0;

  public constructor(options: AnthropicAdminClientOptions) {
    AnthropicAdminClient.validateAdminKey(options.adminKey);
    this.options = options;
  }

  public getRequestCount(): number {
    return this.requestCount;
  }

  /*
   * Only an admin key reads the usage and cost reports. The Claude API key
   * (sk-ant-api03-) or a compliance key (sk-ant-api01-) is refused there;
   * naming the right one here saves the round trip.
   */
  public static validateAdminKey(adminKey: string): void {
    const key: string = (adminKey || "").trim();

    if (!key) {
      throw new BadDataException("Admin key is required.");
    }

    if (key.startsWith("sk-ant-api")) {
      throw new BadDataException(
        "This is a Claude API key. Reading usage and costs needs an Anthropic admin key, which starts with sk-ant-admin01-.",
      );
    }

    if (!key.startsWith("sk-ant-admin")) {
      throw new BadDataException(
        "An Anthropic admin key starts with sk-ant-admin01-. Create one in the Claude Console under Settings, Admin keys.",
      );
    }
  }

  private getBaseUrl(): string {
    return this.options.baseUrl || ANTHROPIC_API_BASE_URL;
  }

  private getHeaders(): Dictionary<string> {
    return {
      "x-api-key": this.options.adminKey.trim(),
      "anthropic-version": ANTHROPIC_API_VERSION,
      Accept: "application/json",
    };
  }

  private async get(path: string, query: string, step: string): Promise<JSONObject> {
    this.requestCount++;

    return await LlmProviderHttp.requestJson({
      transport: this.options.transport,
      method: "GET",
      url: `${this.getBaseUrl()}${path}${query ? `?${query}` : ""}`,
      headers: this.getHeaders(),
      timeoutInMs: this.options.requestTimeoutInMs,
      step: step,
      providerTitle: PROVIDER_TITLE,
      secretValues: [this.options.adminKey],
    });
  }

  private async listReportBuckets(data: {
    path: string;
    step: string;
    params: Array<[string, string | number]>;
  }): Promise<Array<JSONObject>> {
    const buckets: Array<JSONObject> = [];
    let page: string = "";

    for (let index: number = 0; index < MAX_REPORT_PAGES; index++) {
      const response: JSONObject = await this.get(
        data.path,
        buildQueryString([...data.params, ["page", page]]),
        data.step,
      );

      for (const bucket of readArray(response["data"])) {
        buckets.push(readObject(bucket));
      }

      const next: string = readText(response["next_page"]);

      if (response["has_more"] !== true || !next || next === page) {
        return buckets;
      }

      page = next;
    }

    return buckets;
  }

  // Day buckets of message usage for [startTime, endTime).
  public async listUsageBuckets(data: {
    startTime: Date;
    endTime: Date;
  }): Promise<Array<JSONObject>> {
    return await this.listReportBuckets({
      path: "/organizations/usage_report/messages",
      step: "usage report request",
      params: [
        ["starting_at", data.startTime.toISOString()],
        ["ending_at", data.endTime.toISOString()],
        ["bucket_width", "1d"],
        ["group_by[]", "model"],
        ["group_by[]", "workspace_id"],
        ["group_by[]", "api_key_id"],
        ["group_by[]", "account_id"],
        ["limit", REPORT_PAGE_LIMIT],
      ],
    });
  }

  // Day buckets of cost for [startTime, endTime), by workspace and description.
  public async listCostBuckets(data: {
    startTime: Date;
    endTime: Date;
  }): Promise<Array<JSONObject>> {
    return await this.listReportBuckets({
      path: "/organizations/cost_report",
      step: "cost report request",
      params: [
        ["starting_at", data.startTime.toISOString()],
        ["ending_at", data.endTime.toISOString()],
        ["bucket_width", "1d"],
        ["group_by[]", "workspace_id"],
        ["group_by[]", "description"],
        ["limit", REPORT_PAGE_LIMIT],
      ],
    });
  }

  private async listAll(
    path: string,
    step: string,
    extra: Array<[string, string | number]> = [],
  ): Promise<Array<JSONObject>> {
    const items: Array<JSONObject> = [];
    let afterId: string = "";

    for (let index: number = 0; index < MAX_LIST_PAGES; index++) {
      const response: JSONObject = await this.get(
        path,
        buildQueryString([
          ["limit", LIST_PAGE_LIMIT],
          ...extra,
          ["after_id", afterId],
        ]),
        step,
      );

      for (const item of readArray(response["data"])) {
        items.push(readObject(item));
      }

      const lastId: string = readText(response["last_id"]);

      if (response["has_more"] !== true || !lastId || lastId === afterId) {
        return items;
      }

      afterId = lastId;
    }

    return items;
  }

  // Account (user) id -> email.
  public async listUserEmails(): Promise<Map<string, string>> {
    const emails: Map<string, string> = new Map();

    for (const user of await this.listAll(
      "/organizations/users",
      "users request",
    )) {
      const id: string = readText(user["id"]);
      const email: string = readText(user["email"]) || readText(user["name"]);

      if (id && email) {
        emails.set(id, email);
      }
    }

    return emails;
  }

  // Key id -> name, and the user it acts as.
  public async listApiKeys(): Promise<Map<string, AnthropicApiKeyInfo>> {
    const keys: Map<string, AnthropicApiKeyInfo> = new Map();

    for (const key of await this.listAll(
      "/organizations/api_keys",
      "API keys request",
    )) {
      const id: string = readText(key["id"]);
      const principal: JSONObject = readObject(key["principal"]);

      if (id) {
        keys.set(id, {
          name: readText(key["name"]) || id,
          principalUserId:
            readText(principal["type"]) === "user_actor"
              ? readText(principal["user_id"])
              : "",
        });
      }
    }

    return keys;
  }

  // Workspace id -> name.
  public async listWorkspaceNames(): Promise<Map<string, string>> {
    const names: Map<string, string> = new Map();

    for (const workspace of await this.listAll(
      "/organizations/workspaces",
      "workspaces request",
      [["include_archived", "true"]],
    )) {
      const id: string = readText(workspace["id"]);

      if (id) {
        names.set(id, readText(workspace["name"]) || id);
      }
    }

    return names;
  }
}
