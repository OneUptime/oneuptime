import Dictionary from "../../../../../Types/Dictionary";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import { LlmConnectorTransport } from "../../LlmConnectorTypes";
import LlmProviderError from "../../LlmProviderError";
import LlmProviderHttp, {
  readArray,
  readCount,
  readObject,
  readText,
} from "../../LlmProviderHttp";

/*
 * Cursor's Admin API, the parts a Cursor connection reads:
 *
 *   GET  /teams/members                the team's members: teamMembers[]
 *                                      with email and isRemoved
 *   POST /teams/filtered-usage-events  one event per request: timestamp,
 *                                      userEmail, model, tokenUsage,
 *                                      chargedCents, serviceAccountName -
 *                                      a page at a time
 *   POST /teams/daily-usage-data       each member's day, with isActive
 *                                      when asked for page and pageSize
 *
 * Contracts relied on, from Cursor's Admin API reference
 * (cursor.com/docs/account/teams/admin-api) and API overview
 * (cursor.com/docs/api): Basic authentication with the key as the user name
 * and no password; startDate and endDate in epoch milliseconds, both
 * inclusive for usage events; pages numbered from 1, at most 1000 usage
 * events a page, the answer carrying totalUsageEventsCount and
 * pagination.numPages; 60 usage-event requests a minute per team and 20 a
 * minute for the other endpoints, a 429 answered with Retry-After: 60; error
 * bodies { error, message }.
 */

export const CURSOR_API_BASE_URL: string = "https://api.cursor.com";

// Cursor's largest usage-events page.
export const CURSOR_EVENTS_PAGE_SIZE: number = 1000;
// Members a daily usage page holds (a row per member and day).
export const CURSOR_DAILY_USAGE_PAGE_SIZE: number = 250;
const MAX_DAILY_USAGE_PAGES: number = 40;

/*
 * Requests start at least this far apart, endpoint by endpoint: at most 50
 * usage-event requests a minute of Cursor's 60, and 17 of the other
 * endpoints' 20, so the team's own tools keep some of its limit.
 */
export const CURSOR_EVENTS_REQUEST_SPACING_MS: number = 1200;
export const CURSOR_OTHER_REQUEST_SPACING_MS: number = 3500;
// What Cursor's 429 asks for (Retry-After: 60); waited out once in a read.
export const CURSOR_RATE_LIMIT_WAIT_MS: number = 60 * 1000;
const SERVER_ERROR_WAIT_MS: number = 2000;

const PROVIDER_TITLE: string = "Cursor";
// A pasted key with a space or a line break in it.
const WHITESPACE_REGEX: RegExp = /\s/;

export interface CursorMember {
  id: string;
  email: string;
  name: string;
  role: string;
  isRemoved: boolean;
}

export interface CursorUsageEventsPage {
  events: Array<JSONObject>;
  // totalUsageEventsCount: every event of the range, all pages.
  total: number;
  // How many pages the range has, at CURSOR_EVENTS_PAGE_SIZE.
  pages: number;
}

export interface CursorAdminClientOptions {
  apiKey: string;
  transport: LlmConnectorTransport;
  requestTimeoutInMs?: number | undefined;
  baseUrl?: string | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
  clock?: (() => number) | undefined;
  /*
   * A read's deadline (epoch ms): a 429 or a server error is waited out
   * once when the wait ends before it. Without one - a test - nothing is
   * waited for, and the answer is the failure.
   */
  waitUntilMs?: number | undefined;
}

export const CURSOR_DEFAULT_SLEEP: (ms: number) => Promise<void> = (
  ms: number,
): Promise<void> => {
  return new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, Math.max(0, ms));
  });
};

export default class CursorAdminClient {
  private options: CursorAdminClientOptions;
  private requestCount: number = 0;
  private rateLimited: boolean = false;
  // When each endpoint was last asked, for its pace.
  private lastRequestAt: Map<string, number> = new Map();

  public constructor(options: CursorAdminClientOptions) {
    CursorAdminClient.validateApiKey(options.apiKey);
    this.options = options;
  }

  public getRequestCount(): number {
    return this.requestCount;
  }

  // Whether Cursor answered any request with a 429.
  public wasRateLimited(): boolean {
    return this.rateLimited;
  }

  /*
   * Only what can be told without asking Cursor: a key is there, and it is
   * one word. Cursor's own answer says the rest - its Admin API keys start
   * with crsr_, and a personal key is refused - in the words explain() puts
   * on a 401 or a 403.
   */
  public static validateApiKey(apiKey: string): void {
    const key: string = (apiKey || "").trim();

    if (!key) {
      throw new BadDataException("Admin API key is required.");
    }

    if (WHITESPACE_REGEX.test(key)) {
      throw new BadDataException(
        "The Admin API key has a space or a line break in it. Paste the key alone.",
      );
    }
  }

  private getKey(): string {
    return this.options.apiKey.trim();
  }

  private getAuthorization(): string {
    return Buffer.from(`${this.getKey()}:`).toString("base64");
  }

  // The key and its Basic form: neither may appear in an error.
  public getSecretValues(): Array<string> {
    return [this.getKey(), this.getAuthorization()];
  }

  private getHeaders(): Dictionary<string> {
    return {
      Authorization: `Basic ${this.getAuthorization()}`,
      Accept: "application/json",
    };
  }

  private clock(): number {
    return this.options.clock ? this.options.clock() : Date.now();
  }

  private async sleep(ms: number): Promise<void> {
    await (this.options.sleep || CURSOR_DEFAULT_SLEEP)(ms);
  }

  // A wait the read's deadline still has room for.
  private canWait(ms: number): boolean {
    return (
      this.options.waitUntilMs !== undefined &&
      this.clock() + ms < this.options.waitUntilMs
    );
  }

  // Waits for this endpoint's turn, then takes it.
  private async takeTurn(path: string, spacingMs: number): Promise<void> {
    const last: number | undefined = this.lastRequestAt.get(path);

    if (last !== undefined) {
      const waited: number = this.clock() - last;

      if (waited < spacingMs) {
        await this.sleep(spacingMs - waited);
      }
    }

    this.lastRequestAt.set(path, this.clock());
  }

  private async request(data: {
    method: "GET" | "POST";
    path: string;
    body?: JSONObject | undefined;
    step: string;
    spacingMs: number;
  }): Promise<JSONObject> {
    let rateLimitWaits: number = 0;
    let serverErrorWaits: number = 0;

    for (;;) {
      await this.takeTurn(data.path, data.spacingMs);
      this.requestCount++;

      try {
        return await LlmProviderHttp.requestJson({
          transport: this.options.transport,
          method: data.method,
          url: `${this.options.baseUrl || CURSOR_API_BASE_URL}${data.path}`,
          headers: this.getHeaders(),
          ...(data.body ? { body: JSON.stringify(data.body) } : {}),
          timeoutInMs: this.options.requestTimeoutInMs,
          step: data.step,
          providerTitle: PROVIDER_TITLE,
          secretValues: this.getSecretValues(),
        });
      } catch (error) {
        const failure: LlmProviderError = LlmProviderError.from({
          error,
          step: data.step,
          providerTitle: PROVIDER_TITLE,
          secretValues: this.getSecretValues(),
        });

        if (failure.statusCode === 429) {
          this.rateLimited = true;

          if (rateLimitWaits < 1 && this.canWait(CURSOR_RATE_LIMIT_WAIT_MS)) {
            rateLimitWaits++;
            await this.sleep(CURSOR_RATE_LIMIT_WAIT_MS);
            continue;
          }
        } else if (
          failure.statusCode !== undefined &&
          failure.statusCode >= 500 &&
          serverErrorWaits < 1 &&
          this.canWait(SERVER_ERROR_WAIT_MS)
        ) {
          serverErrorWaits++;
          await this.sleep(SERVER_ERROR_WAIT_MS);
          continue;
        }

        throw CursorAdminClient.explain(failure, data.step);
      }
    }
  }

  // Cursor's reason for a failure: the message of its { error, message } body.
  public static readReason(body: string | undefined): string {
    if (!body) {
      return "";
    }

    try {
      const parsed: JSONObject = readObject(JSON.parse(body));
      return readText(parsed["message"]) || readText(parsed["error"]);
    } catch {
      return "";
    }
  }

  /*
   * A refused key, a key that may not read the team, and a rate limit, in
   * words that say what to do. Anything else stays as Cursor answered it.
   */
  public static explain(
    error: LlmProviderError,
    step: string,
  ): LlmProviderError {
    const reason: string = CursorAdminClient.readReason(error.responseBody);
    const said: string = reason ? `: ${reason}` : "";
    let message: string;

    if (error.statusCode === 401) {
      message = `Cursor did not accept the key for the ${step} (HTTP 401${said}). Use a Cursor Admin API key, which starts with crsr_: a team admin creates it in the Cursor dashboard under Settings, Cursor Admin API Keys.`;
    } else if (error.statusCode === 403) {
      message = `Cursor accepted the key but refused the ${step} (HTTP 403${said}). Reading a team's usage takes an Admin API key of a team on the Teams or Enterprise plan, which a team admin creates under Settings, Cursor Admin API Keys.`;
    } else if (error.statusCode === 429) {
      message = `Cursor asked OneUptime to slow down (HTTP 429) on the ${step}. Its Admin API takes 20 requests a minute from a team, 60 for usage events, shared with every other tool that reads it.`;
    } else {
      return error;
    }

    return new LlmProviderError({
      message: LlmProviderError.redact(message),
      kind: error.kind,
      statusCode: error.statusCode,
      responseBody: error.responseBody,
    });
  }

  // The team's members, removed ones included (isRemoved).
  public async listMembers(): Promise<Array<CursorMember>> {
    const response: JSONObject = await this.request({
      method: "GET",
      path: "/teams/members",
      step: "team members request",
      spacingMs: CURSOR_OTHER_REQUEST_SPACING_MS,
    });

    return readArray(response["teamMembers"]).map(
      (value: unknown): CursorMember => {
        const member: JSONObject = readObject(value);

        return {
          id: readText(member["id"]),
          email: readText(member["email"]),
          name: readText(member["name"]),
          role: readText(member["role"]),
          isRemoved: member["isRemoved"] === true,
        };
      },
    );
  }

  /*
   * One page of the team's usage events between two instants, both
   * included (Cursor's bounds), newest first as Cursor returns them.
   */
  public async getUsageEventsPage(data: {
    startMs: number;
    endMs: number;
    page: number;
  }): Promise<CursorUsageEventsPage> {
    const response: JSONObject = await this.request({
      method: "POST",
      path: "/teams/filtered-usage-events",
      body: {
        startDate: data.startMs,
        endDate: data.endMs,
        page: data.page,
        pageSize: CURSOR_EVENTS_PAGE_SIZE,
      },
      step: "usage events request",
      spacingMs: CURSOR_EVENTS_REQUEST_SPACING_MS,
    });

    const pagination: JSONObject = readObject(response["pagination"]);
    const total: number = Math.round(
      readCount(response["totalUsageEventsCount"]),
    );
    const numPages: number = Math.round(readCount(pagination["numPages"]));

    return {
      events: readArray(response["usageEvents"]).map(readObject),
      total,
      pages: Math.max(
        1,
        numPages || Math.ceil(total / CURSOR_EVENTS_PAGE_SIZE),
        pagination["hasNextPage"] === true ? data.page + 1 : 1,
      ),
    };
  }

  /*
   * A member's day counts as active when Cursor says so (isActive, given
   * with pagination) - or, in an answer without it, when it shows any use.
   */
  public static isActiveDay(row: JSONObject): boolean {
    if (typeof row["isActive"] === "boolean") {
      return row["isActive"];
    }

    return [
      "agentRequests",
      "chatRequests",
      "composerRequests",
      "cmdkUsages",
      "totalApplies",
      "totalTabsAccepted",
      "bugbotUsages",
    ].some((key: string): boolean => {
      return readCount(row[key]) > 0;
    });
  }

  /*
   * The lowercased emails of the members active on any day between two
   * instants (Cursor allows 30 days at most), page by page - complete false
   * when the team has more members than MAX_DAILY_USAGE_PAGES pages hold.
   */
  public async listActiveEmails(data: {
    startMs: number;
    endMs: number;
  }): Promise<{ emails: Set<string>; complete: boolean }> {
    const active: Set<string> = new Set<string>();

    for (let page: number = 1; page <= MAX_DAILY_USAGE_PAGES; page++) {
      const response: JSONObject = await this.request({
        method: "POST",
        path: "/teams/daily-usage-data",
        body: {
          startDate: data.startMs,
          endDate: data.endMs,
          page,
          pageSize: CURSOR_DAILY_USAGE_PAGE_SIZE,
        },
        step: "daily usage request",
        spacingMs: CURSOR_OTHER_REQUEST_SPACING_MS,
      });

      for (const value of readArray(response["data"])) {
        const row: JSONObject = readObject(value);
        const email: string = readText(row["email"]).toLowerCase();

        if (email && CursorAdminClient.isActiveDay(row)) {
          active.add(email);
        }
      }

      const pagination: JSONObject = readObject(response["pagination"]);
      const totalPages: number = readCount(pagination["totalPages"]);

      if (
        pagination["hasNextPage"] !== true ||
        (totalPages > 0 && page >= totalPages)
      ) {
        return { emails: active, complete: true };
      }
    }

    return { emails: active, complete: false };
  }
}

// Members the daily usage pages hold at most.
export const CURSOR_MAX_DAILY_USAGE_MEMBERS: number =
  MAX_DAILY_USAGE_PAGES * CURSOR_DAILY_USAGE_PAGE_SIZE;
