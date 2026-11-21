import APIException from "../../../../Types/Exception/ApiException";
import { JSONObject } from "../../../../Types/JSON";
import { ConnectorTransport } from "../Connectors/Types";
import { getCrowdStrikeFalconBaseUrl } from "../Connectors/CrowdStrikeFalcon/CrowdStrikeFalconClient";
import ResponseHttp, { ResponseHttpResult } from "./ResponseHttp";

/*
 * The Falcon calls a playbook makes to network-contain a host, and to lift
 * that, from the Falcon API (Hosts collection):
 *
 *   POST {base}/oauth2/token                              client credentials
 *   GET  {base}/devices/queries/devices/v1?filter=hostname:'<host>'
 *                                                          device ids for a hostname
 *   POST {base}/devices/entities/devices-actions/v2?action_name=contain
 *        { "ids": [...] }                                  contain them
 *   POST {base}/devices/entities/devices-actions/v2?action_name=lift_containment
 *        { "ids": [...] }                                  lift their containment
 *
 * The API client needs the Hosts: Write scope (and Hosts: Read to find the
 * device); a client made for importing alerts has only Alerts: Read and is
 * answered 403, which the error says.
 */

const DEVICE_QUERY_LIMIT: number = 10;

// FQL string literal: backslashes and single quotes escaped.
export function falconQuotedValue(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

/*
 * ---------- Custom IOCs (#10346) ----------
 *
 * The blocklist's CrowdStrike destination blocks files on every machine
 * through IOC Management (https://developer.crowdstrike.com/api-reference/
 * collections/ioc/):
 *
 *   GET    {base}/iocs/combined/indicator/v1?filter=source:'OneUptime'
 *                                      OneUptime's IOCs, a page at a time
 *   POST   {base}/iocs/entities/indicators/v1   { comment, indicators }
 *   PATCH  {base}/iocs/entities/indicators/v1   { comment, indicators: [{ id, ... }] }
 *   DELETE {base}/iocs/entities/indicators/v1?ids=...
 *
 * Only a file's hash (sha256, md5) can be set to prevent on Windows, Mac
 * and Linux: a domain or an address is detected there, never blocked, so
 * the destination holds files alone and says so of the rest. An IOC past
 * its expiration is not deleted: Falcon sets it to no action. The API
 * client needs the IOC Management: Read and Write scopes; the error says so
 * when Falcon answers 403. Falcon answers 429 with X-RateLimit-RetryAfter
 * (seconds since the epoch) when it is called too often.
 */

// What the IOCs OneUptime adds say they come from, which its list reads them back by.
export const CROWDSTRIKE_IOC_SOURCE: string = "OneUptime";

// The most IOCs one create, one update or one page of the list holds.
export const CROWDSTRIKE_IOC_BATCH_SIZE: number = 200;
export const CROWDSTRIKE_IOC_PAGE_SIZE: number = 500;

// The most IOC IDs one delete names, so its address stays short.
export const CROWDSTRIKE_IOC_DELETE_BATCH_SIZE: number = 100;

// The platforms a file's IOC applies to: every computer.
export const CROWDSTRIKE_IOC_PLATFORMS: ReadonlyArray<string> = [
  "windows",
  "mac",
  "linux",
];

export const CROWDSTRIKE_IOC_SCOPE_HINT: string =
  "The connection's API client needs the IOC Management: Read and Write scopes.";

// The longest description OneUptime writes on an IOC.
const CROWDSTRIKE_IOC_DESCRIPTION_MAX_LENGTH: number = 500;

export type CrowdStrikeIocType = "sha256" | "md5";

// One IOC, as Falcon lists it.
export interface CrowdStrikeIoc {
  id: string;
  type: string;
  value: string;
  // "prevent", "detect", "no_action"...
  action: string;
  description: string;
  source: string;
  expiration: Date | null;
  // Past its expiration: Falcon set it to no action.
  isExpired: boolean;
}

export interface CrowdStrikeIocSubmission {
  type: CrowdStrikeIocType;
  value: string;
  description: string;
  expiration: Date | null;
}

export interface CrowdStrikeIocUpdate {
  id: string;
  description: string;
  expiration: Date | null;
}

// What became of one IOC a create sent.
export interface CrowdStrikeIocWriteResult {
  value: string;
  id: string | null;
  isDone: boolean;
  error: string | null;
}

/*
 * How long Falcon asked OneUptime to wait, from a throttled answer's
 * X-RateLimit-RetryAfter (seconds since the epoch, as Falcon's own SDKs
 * read it), in words: "30 seconds". Null without one.
 */
export function readFalconRetryAfter(
  headers: Record<string, string> | undefined,
  now: Date = new Date(),
): string | null {
  const epochSeconds: number = Number(
    (headers || {})["x-ratelimit-retryafter"],
  );

  if (!Number.isFinite(epochSeconds) || epochSeconds <= 0) {
    return null;
  }

  const seconds: number = Math.max(1, epochSeconds - now.getTime() / 1000);

  return seconds < 120
    ? `${Math.ceil(seconds)} seconds`
    : `${Math.ceil(seconds / 60)} minutes`;
}

function readIocText(record: JSONObject, key: string): string {
  const value: unknown = record[key];

  return typeof value === "string" ? value : "";
}

function readIocTime(value: unknown): Date | null {
  if (typeof value !== "string" || !value) {
    return null;
  }

  const time: Date = new Date(value);

  // Falcon writes "no expiration" as the zero time.
  return Number.isNaN(time.getTime()) || time.getUTCFullYear() < 1971
    ? null
    : time;
}

export default class CrowdStrikeFalconResponseClient {
  private baseUrl: string;
  private clientId: string;
  private clientSecret: string;
  private transport: ConnectorTransport;
  private accessToken: string | null = null;

  public constructor(options: {
    cloud: string;
    clientId: string;
    clientSecret: string;
    transport: ConnectorTransport;
  }) {
    const baseUrl: string | null = getCrowdStrikeFalconBaseUrl(options.cloud);

    if (!baseUrl) {
      throw new APIException(
        `The connection's Falcon cloud "${options.cloud}" is not one OneUptime knows.`,
      );
    }

    this.baseUrl = baseUrl;
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.transport = options.transport;
  }

  private secrets(): Array<string> {
    return [this.clientSecret, this.accessToken || ""];
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken) {
      return this.accessToken;
    }

    const step: string = "CrowdStrike Falcon token request";
    const result: ResponseHttpResult = await ResponseHttp.send({
      transport: this.transport,
      request: {
        method: "POST",
        url: `${this.baseUrl}/oauth2/token`,
        headers: { Accept: "application/json" },
        body: { client_id: this.clientId, client_secret: this.clientSecret },
        formUrlEncoded: true,
      },
      step,
      secrets: this.secrets(),
    });

    if (!ResponseHttp.isSuccess(result)) {
      throw ResponseHttp.failure({ step, result, secrets: this.secrets() });
    }

    const token: unknown = (result.bodyJson as JSONObject | undefined)?.[
      "access_token"
    ];

    if (typeof token !== "string" || !token) {
      throw new APIException(`${step} returned no access_token.`);
    }

    this.accessToken = token;
    return token;
  }

  private async sendAuthenticated(
    step: string,
    method: "GET" | "POST" | "PATCH" | "DELETE",
    url: string,
    body?: string,
    options?: { acceptAnyStatus?: boolean | undefined },
  ): Promise<ResponseHttpResult> {
    const token: string = await this.getAccessToken();

    return await ResponseHttp.send({
      transport: this.transport,
      request: {
        method,
        url,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body,
        ...(options?.acceptAnyStatus ? { acceptAnyStatus: true } : {}),
      },
      step,
      secrets: this.secrets(),
    });
  }

  // An IOC call that failed, in words that say what to do: throttled (and for how long), or missing its scope.
  private iocFailure(step: string, result: ResponseHttpResult): Error {
    if (result.statusCode === 429) {
      const wait: string | null = readFalconRetryAfter(result.headers);

      return new APIException(
        `${step} was throttled by CrowdStrike Falcon${wait ? `, which asked OneUptime to wait ${wait}` : ""}. OneUptime tries again later.`,
      );
    }

    return ResponseHttp.failure({
      step,
      result,
      secrets: this.secrets(),
      hint:
        result.statusCode === 403 || result.statusCode === 401
          ? CROWDSTRIKE_IOC_SCOPE_HINT
          : undefined,
    });
  }

  /*
   * The IOCs OneUptime added - their source is CROWDSTRIKE_IOC_SOURCE -
   * every page of them, expired ones too: Falcon keeps an IOC past its
   * expiration, set to no action.
   */
  public async listIocs(): Promise<Array<CrowdStrikeIoc>> {
    const step: string = "CrowdStrike Falcon IOC list";
    const iocs: Array<CrowdStrikeIoc> = [];
    let after: string = "";

    for (;;) {
      const params: URLSearchParams = new URLSearchParams();
      params.set("filter", `source:${falconQuotedValue(CROWDSTRIKE_IOC_SOURCE)}`);
      params.set("limit", String(CROWDSTRIKE_IOC_PAGE_SIZE));

      if (after) {
        params.set("after", after);
      }

      const result: ResponseHttpResult = await this.sendAuthenticated(
        step,
        "GET",
        `${this.baseUrl}/iocs/combined/indicator/v1?${params.toString()}`,
        undefined,
        { acceptAnyStatus: true },
      );

      if (!ResponseHttp.isSuccess(result)) {
        throw this.iocFailure(step, result);
      }

      const body: JSONObject = (result.bodyJson as JSONObject) || {};
      const resources: unknown = body["resources"];
      const page: Array<unknown> = Array.isArray(resources) ? resources : [];

      for (const resource of page) {
        if (!resource || typeof resource !== "object") {
          continue;
        }

        const record: JSONObject = resource as JSONObject;
        const id: string = readIocText(record, "id");

        if (!id || record["deleted"] === true) {
          continue;
        }

        iocs.push({
          id,
          type: readIocText(record, "type"),
          value: readIocText(record, "value"),
          action: readIocText(record, "action"),
          description: readIocText(record, "description"),
          source: readIocText(record, "source"),
          expiration: readIocTime(record["expiration"]),
          isExpired: record["expired"] === true,
        });
      }

      const pagination: unknown = (body["meta"] as JSONObject | undefined)?.[
        "pagination"
      ];
      const next: unknown =
        pagination && typeof pagination === "object"
          ? (pagination as JSONObject)["after"]
          : undefined;

      if (
        page.length < CROWDSTRIKE_IOC_PAGE_SIZE ||
        typeof next !== "string" ||
        !next ||
        next === after
      ) {
        return iocs;
      }

      after = next;
    }
  }

  /*
   * Adds file IOCs set to prevent, on every computer, CROWDSTRIKE_IOC_
   * BATCH_SIZE a call. Says per IOC whether Falcon took it: a create Falcon
   * refuses in part (400) names the rows it refused and why, and a
   * duplicate - an IOC of the value OneUptime did not add - is one of them.
   */
  public async createIocs(
    submissions: Array<CrowdStrikeIocSubmission>,
    comment: string,
  ): Promise<Array<CrowdStrikeIocWriteResult>> {
    const step: string = "CrowdStrike Falcon IOC create";
    const results: Array<CrowdStrikeIocWriteResult> = [];

    for (
      let start: number = 0;
      start < submissions.length;
      start += CROWDSTRIKE_IOC_BATCH_SIZE
    ) {
      const batch: Array<CrowdStrikeIocSubmission> = submissions.slice(
        start,
        start + CROWDSTRIKE_IOC_BATCH_SIZE,
      );

      const result: ResponseHttpResult = await this.sendAuthenticated(
        step,
        "POST",
        `${this.baseUrl}/iocs/entities/indicators/v1`,
        JSON.stringify({
          comment,
          indicators: batch.map(
            (submission: CrowdStrikeIocSubmission): JSONObject => {
              return {
                type: submission.type,
                value: submission.value,
                action: "prevent",
                severity: "high",
                platforms: [...CROWDSTRIKE_IOC_PLATFORMS],
                applied_globally: true,
                source: CROWDSTRIKE_IOC_SOURCE,
                description: submission.description.slice(
                  0,
                  CROWDSTRIKE_IOC_DESCRIPTION_MAX_LENGTH,
                ),
                ...(submission.expiration
                  ? { expiration: submission.expiration.toISOString() }
                  : {}),
              };
            },
          ),
        }),
        { acceptAnyStatus: true },
      );

      if (result.statusCode !== 400 && !ResponseHttp.isSuccess(result)) {
        throw this.iocFailure(step, result);
      }

      const resources: unknown = (result.bodyJson as JSONObject | undefined)?.[
        "resources"
      ];
      const refused: Map<string, string> = new Map();
      const created: Map<string, string> = new Map();

      for (const resource of Array.isArray(resources) ? resources : []) {
        if (!resource || typeof resource !== "object") {
          continue;
        }

        const record: JSONObject = resource as JSONObject;
        const value: string = readIocText(record, "value").toLowerCase();
        const messageType: string = readIocText(record, "message_type");

        if (messageType === "error" || messageType === "warning") {
          refused.set(
            value,
            readIocText(record, "message") || "CrowdStrike Falcon refused it",
          );
        } else if (readIocText(record, "id")) {
          created.set(value, readIocText(record, "id"));
        }
      }

      // A 400 that names no row refused the whole batch.
      const batchError: string | null =
        result.statusCode === 400 && refused.size === 0
          ? ResponseHttp.describeBody(result, [])
          : null;

      for (const submission of batch) {
        const value: string = submission.value.toLowerCase();
        const error: string | null = refused.get(value) || batchError;

        results.push({
          value: submission.value,
          id: created.get(value) || null,
          isDone: !error,
          error,
        });
      }
    }

    return results;
  }

  /*
   * Moves IOCs' expiration to their blocks', and sets them to prevent
   * again: one past its expiration was set to no action by Falcon.
   */
  public async updateIocs(
    updates: Array<CrowdStrikeIocUpdate>,
    comment: string,
  ): Promise<void> {
    const step: string = "CrowdStrike Falcon IOC update";

    for (
      let start: number = 0;
      start < updates.length;
      start += CROWDSTRIKE_IOC_BATCH_SIZE
    ) {
      const batch: Array<CrowdStrikeIocUpdate> = updates.slice(
        start,
        start + CROWDSTRIKE_IOC_BATCH_SIZE,
      );

      const result: ResponseHttpResult = await this.sendAuthenticated(
        step,
        "PATCH",
        `${this.baseUrl}/iocs/entities/indicators/v1`,
        JSON.stringify({
          comment,
          indicators: batch.map((update: CrowdStrikeIocUpdate): JSONObject => {
            return {
              id: update.id,
              action: "prevent",
              severity: "high",
              description: update.description.slice(
                0,
                CROWDSTRIKE_IOC_DESCRIPTION_MAX_LENGTH,
              ),
              ...(update.expiration
                ? { expiration: update.expiration.toISOString() }
                : {}),
            };
          }),
        }),
        { acceptAnyStatus: true },
      );

      if (!ResponseHttp.isSuccess(result)) {
        throw this.iocFailure(step, result);
      }
    }
  }

  // Deletes IOCs by their IDs, CROWDSTRIKE_IOC_DELETE_BATCH_SIZE a call.
  public async deleteIocs(ids: Array<string>, comment: string): Promise<void> {
    const step: string = "CrowdStrike Falcon IOC delete";

    for (
      let start: number = 0;
      start < ids.length;
      start += CROWDSTRIKE_IOC_DELETE_BATCH_SIZE
    ) {
      const params: URLSearchParams = new URLSearchParams();

      for (const id of ids.slice(
        start,
        start + CROWDSTRIKE_IOC_DELETE_BATCH_SIZE,
      )) {
        params.append("ids", id);
      }

      params.set("comment", comment);

      const result: ResponseHttpResult = await this.sendAuthenticated(
        step,
        "DELETE",
        `${this.baseUrl}/iocs/entities/indicators/v1?${params.toString()}`,
        undefined,
        { acceptAnyStatus: true },
      );

      // An IOC already gone is what was asked.
      if (!ResponseHttp.isSuccess(result) && result.statusCode !== 404) {
        throw this.iocFailure(step, result);
      }
    }
  }

  /*
   * Whether the API client holds the IOC Management scopes, asked without
   * changing anything: Read lists one IOC ID; Write is asked with an
   * update of no IOC, which Falcon refuses 403 without the scope and
   * answers otherwise (a 400 for the empty list, or a 200).
   */
  public async checkIocScopes(): Promise<{
    canRead: boolean;
    canWrite: boolean;
  }> {
    const read: ResponseHttpResult = await this.sendAuthenticated(
      "CrowdStrike Falcon IOC read check",
      "GET",
      `${this.baseUrl}/iocs/queries/indicators/v1?limit=1`,
      undefined,
      { acceptAnyStatus: true },
    );

    if (read.statusCode === 429) {
      throw this.iocFailure("CrowdStrike Falcon IOC read check", read);
    }

    const write: ResponseHttpResult = await this.sendAuthenticated(
      "CrowdStrike Falcon IOC write check",
      "PATCH",
      `${this.baseUrl}/iocs/entities/indicators/v1`,
      JSON.stringify({ comment: "OneUptime connection test", indicators: [] }),
      { acceptAnyStatus: true },
    );

    if (write.statusCode === 429) {
      throw this.iocFailure("CrowdStrike Falcon IOC write check", write);
    }

    return {
      canRead: ResponseHttp.isSuccess(read),
      canWrite: write.statusCode !== 403 && write.statusCode !== 401,
    };
  }

  public async findDeviceIds(hostname: string): Promise<Array<string>> {
    const step: string = "CrowdStrike Falcon device lookup";
    const params: URLSearchParams = new URLSearchParams();
    params.set("filter", `hostname:${falconQuotedValue(hostname)}`);
    params.set("limit", String(DEVICE_QUERY_LIMIT));

    const result: ResponseHttpResult = await this.sendAuthenticated(
      step,
      "GET",
      `${this.baseUrl}/devices/queries/devices/v1?${params.toString()}`,
    );

    if (!ResponseHttp.isSuccess(result)) {
      throw ResponseHttp.failure({
        step,
        result,
        secrets: this.secrets(),
        hint:
          result.statusCode === 403
            ? "The connection's API client needs the Hosts: Read scope."
            : undefined,
      });
    }

    const resources: unknown = (result.bodyJson as JSONObject | undefined)?.[
      "resources"
    ];

    return Array.isArray(resources)
      ? resources.filter((id: unknown): id is string => {
          return typeof id === "string" && id.length > 0;
        })
      : [];
  }

  /*
   * Each device's network containment as Falcon reports it - "normal",
   * "containment_pending", "contained", "lift_containment_pending" - read
   * back by a Response Plan step's check (#10340). Needs Hosts: Read, as the
   * lookup does.
   */
  public async getContainmentStatuses(
    deviceIds: Array<string>,
  ): Promise<Array<{ id: string; status: string }>> {
    if (deviceIds.length === 0) {
      return [];
    }

    const step: string = "CrowdStrike Falcon device details";
    const params: URLSearchParams = new URLSearchParams();

    for (const id of deviceIds.slice(0, DEVICE_QUERY_LIMIT)) {
      params.append("ids", id);
    }

    const result: ResponseHttpResult = await this.sendAuthenticated(
      step,
      "GET",
      `${this.baseUrl}/devices/entities/devices/v2?${params.toString()}`,
    );

    if (!ResponseHttp.isSuccess(result)) {
      throw ResponseHttp.failure({
        step,
        result,
        secrets: this.secrets(),
        hint:
          result.statusCode === 403
            ? "The connection's API client needs the Hosts: Read scope."
            : undefined,
      });
    }

    const resources: unknown = (result.bodyJson as JSONObject | undefined)?.[
      "resources"
    ];

    if (!Array.isArray(resources)) {
      return [];
    }

    const statuses: Array<{ id: string; status: string }> = [];

    for (const resource of resources) {
      if (!resource || typeof resource !== "object") {
        continue;
      }

      const device: JSONObject = resource as JSONObject;
      const id: unknown = device["device_id"];
      const status: unknown = device["status"];

      if (typeof id === "string" && id) {
        statuses.push({
          id,
          status: typeof status === "string" ? status.toLowerCase() : "",
        });
      }
    }

    return statuses;
  }

  public async containDevices(deviceIds: Array<string>): Promise<void> {
    await this.sendDeviceAction({
      step: "CrowdStrike Falcon contain",
      actionName: "contain",
      deviceIds,
      scopeHint:
        "The connection's API client needs the Hosts: Write scope to contain hosts.",
    });
  }

  public async liftContainment(deviceIds: Array<string>): Promise<void> {
    await this.sendDeviceAction({
      step: "CrowdStrike Falcon lift containment",
      actionName: "lift_containment",
      deviceIds,
      scopeHint:
        "The connection's API client needs the Hosts: Write scope to lift containment.",
    });
  }

  private async sendDeviceAction(data: {
    step: string;
    actionName: "contain" | "lift_containment";
    deviceIds: Array<string>;
    scopeHint: string;
  }): Promise<void> {
    const result: ResponseHttpResult = await this.sendAuthenticated(
      data.step,
      "POST",
      `${this.baseUrl}/devices/entities/devices-actions/v2?action_name=${data.actionName}`,
      JSON.stringify({ ids: data.deviceIds }),
    );

    if (!ResponseHttp.isSuccess(result)) {
      throw ResponseHttp.failure({
        step: data.step,
        result,
        secrets: this.secrets(),
        hint: result.statusCode === 403 ? data.scopeHint : undefined,
      });
    }
  }
}
