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
 * OpenAI's organization Admin API, the parts an AI / LLM connection reads:
 *
 *   GET /v1/organization/usage/completions   tokens and requests per bucket,
 *   GET /v1/organization/usage/embeddings    grouped by model, project, key
 *                                            and user (group_by[]=...)
 *   GET /v1/organization/costs               USD per day, by project and
 *                                            line item (1d buckets only)
 *   GET /v1/organization/projects            project names
 *   GET /v1/organization/projects/{id}/api_keys   key names and owners
 *   GET /v1/organization/users               user emails
 *
 * Contracts relied on, from OpenAI's API reference and SDK: an admin key in
 * `Authorization: Bearer sk-admin-...`; start_time inclusive and end_time
 * exclusive, in Unix seconds; bucket_width 1d with at most 31 buckets per
 * page for usage and 180 for costs; list parameters as `name[]=value`;
 * usage and cost pages are { data: [{ start_time, end_time, results }],
 * has_more, next_page } followed with `page=next_page`; the list endpoints
 * are { data, has_more, last_id } followed with `after=last_id`, at most
 * 100 per page.
 */

export const OPENAI_API_BASE_URL: string = "https://api.openai.com/v1";

const USAGE_PAGE_LIMIT: number = 31;
const COSTS_PAGE_LIMIT: number = 31;
const LIST_PAGE_LIMIT: number = 100;

// Bounds on one read's pages, so a broken cursor cannot loop forever.
const MAX_USAGE_PAGES: number = 50;
const MAX_LIST_PAGES: number = 50;

export type OpenAIUsageKind = "completions" | "embeddings";

export interface OpenAIApiKeyInfo {
  name: string;
  ownerEmail: string;
}

export interface OpenAIAdminClientOptions {
  adminKey: string;
  transport: LlmConnectorTransport;
  requestTimeoutInMs?: number | undefined;
  baseUrl?: string | undefined;
}

const PROVIDER_TITLE: string = "OpenAI";

export default class OpenAIAdminClient {
  private options: OpenAIAdminClientOptions;
  private requestCount: number = 0;

  public constructor(options: OpenAIAdminClientOptions) {
    OpenAIAdminClient.validateAdminKey(options.adminKey);
    this.options = options;
  }

  public getRequestCount(): number {
    return this.requestCount;
  }

  /*
   * The usage and costs API takes an ADMIN key. The keys people usually
   * have to hand are project keys, which OpenAI refuses there with a 401 or
   * 403 that does not say why; naming the right key here saves the round
   * trip.
   */
  public static validateAdminKey(adminKey: string): void {
    const key: string = (adminKey || "").trim();

    if (!key) {
      throw new BadDataException("Admin key is required.");
    }

    if (key.startsWith("sk-proj-") || key.startsWith("sk-svcacct-")) {
      throw new BadDataException(
        "This is a project API key. Reading usage and costs needs an OpenAI admin key, which starts with sk-admin-.",
      );
    }

    if (!key.startsWith("sk-admin-")) {
      throw new BadDataException(
        "An OpenAI admin key starts with sk-admin-. Create one under Settings, Organization, Admin keys.",
      );
    }
  }

  private getBaseUrl(): string {
    return this.options.baseUrl || OPENAI_API_BASE_URL;
  }

  private getHeaders(): Dictionary<string> {
    return {
      Authorization: `Bearer ${this.options.adminKey.trim()}`,
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

  /*
   * Every day bucket of a usage endpoint for [startTime, endTime), grouped
   * by model, project, key and user.
   */
  public async listUsageBuckets(data: {
    kind: OpenAIUsageKind;
    startTime: Date;
    endTime: Date;
  }): Promise<Array<JSONObject>> {
    return await this.listPagedBuckets({
      path: `/organization/usage/${data.kind}`,
      step: `${data.kind} usage request`,
      params: [
        ["start_time", Math.floor(data.startTime.getTime() / 1000)],
        ["end_time", Math.floor(data.endTime.getTime() / 1000)],
        ["bucket_width", "1d"],
        ["group_by[]", "model"],
        ["group_by[]", "project_id"],
        ["group_by[]", "api_key_id"],
        ["group_by[]", "user_id"],
        ["limit", USAGE_PAGE_LIMIT],
      ],
    });
  }

  // Every day bucket of costs for [startTime, endTime), by project and line item.
  public async listCostBuckets(data: {
    startTime: Date;
    endTime: Date;
  }): Promise<Array<JSONObject>> {
    return await this.listPagedBuckets({
      path: "/organization/costs",
      step: "costs request",
      params: [
        ["start_time", Math.floor(data.startTime.getTime() / 1000)],
        ["end_time", Math.floor(data.endTime.getTime() / 1000)],
        ["bucket_width", "1d"],
        ["group_by[]", "project_id"],
        ["group_by[]", "line_item"],
        ["limit", COSTS_PAGE_LIMIT],
      ],
    });
  }

  private async listPagedBuckets(data: {
    path: string;
    step: string;
    params: Array<[string, string | number]>;
  }): Promise<Array<JSONObject>> {
    const buckets: Array<JSONObject> = [];
    let page: string = "";

    for (let index: number = 0; index < MAX_USAGE_PAGES; index++) {
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

  private async listAll(
    path: string,
    step: string,
    extra: Array<[string, string | number]> = [],
  ): Promise<Array<JSONObject>> {
    const items: Array<JSONObject> = [];
    let after: string = "";

    for (let index: number = 0; index < MAX_LIST_PAGES; index++) {
      const response: JSONObject = await this.get(
        path,
        buildQueryString([
          ["limit", LIST_PAGE_LIMIT],
          ...extra,
          ["after", after],
        ]),
        step,
      );

      for (const item of readArray(response["data"])) {
        items.push(readObject(item));
      }

      const lastId: string = readText(response["last_id"]);

      if (response["has_more"] !== true || !lastId || lastId === after) {
        return items;
      }

      after = lastId;
    }

    return items;
  }

  // Project id -> name, archived projects included (old usage names them).
  public async listProjectNames(): Promise<Map<string, string>> {
    const names: Map<string, string> = new Map();

    for (const project of await this.listAll(
      "/organization/projects",
      "projects request",
      [["include_archived", "true"]],
    )) {
      const id: string = readText(project["id"]);

      if (id) {
        names.set(id, readText(project["name"]) || id);
      }
    }

    return names;
  }

  // User id -> email (or name, when the email is hidden).
  public async listUserEmails(): Promise<Map<string, string>> {
    const emails: Map<string, string> = new Map();

    for (const user of await this.listAll(
      "/organization/users",
      "users request",
    )) {
      const id: string = readText(user["id"]);
      const nested: JSONObject = readObject(user["user"]);
      const email: string =
        readText(user["email"]) ||
        readText(nested["email"]) ||
        readText(user["name"]);

      if (id && email) {
        emails.set(id, email);
      }
    }

    return emails;
  }

  // Key id -> name and owner's email, for one project's keys.
  public async listProjectApiKeys(
    projectId: string,
  ): Promise<Map<string, OpenAIApiKeyInfo>> {
    const keys: Map<string, OpenAIApiKeyInfo> = new Map();

    for (const key of await this.listAll(
      `/organization/projects/${encodeURIComponent(projectId)}/api_keys`,
      "API keys request",
      [["owner_project_access", "any"]],
    )) {
      const id: string = readText(key["id"]);
      const owner: JSONObject = readObject(key["owner"]);
      const user: JSONObject = readObject(owner["user"]);

      if (id) {
        keys.set(id, {
          name: readText(key["name"]) || id,
          ownerEmail: readText(user["email"]),
        });
      }
    }

    return keys;
  }
}
