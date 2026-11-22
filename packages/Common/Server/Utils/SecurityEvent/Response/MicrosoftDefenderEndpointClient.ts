import APIException from "../../../../Types/Exception/ApiException";
import { JSONObject } from "../../../../Types/JSON";
import { ConnectorTransport } from "../Connectors/Types";
import lookupTable from "../../../../Utils/LookupTable";
import ResponseHttp, { ResponseHttpResult } from "./ResponseHttp";

/*
 * The Microsoft Defender for Endpoint calls a playbook makes to isolate a
 * device, and to release it (https://learn.microsoft.com/defender-endpoint/api/get-machines,
 * .../api/isolate-machine, .../api/unisolate-machine):
 *
 *   POST {login}/{tenant}/oauth2/v2.0/token   client credentials, scope {api resource}/.default
 *   GET  {api}/api/machines?$filter=...         the device by its DNS name
 *   POST {api}/api/machines/{id}/isolate        { Comment, IsolationType }
 *   POST {api}/api/machines/{id}/unisolate      { Comment }
 *
 * The connection's app registration is the one the Defender XDR connection
 * imports alerts with; isolating and releasing need the WindowsDefenderATP
 * application permissions Machine.Read.All and Machine.Isolate besides, with
 * admin consent, and the error says so when Defender answers 403.
 */

interface CloudEndpoints {
  loginHost: string;
  apiHost: string;
  resource: string;
}

const CLOUDS: ReadonlyMap<string, CloudEndpoints> = lookupTable({
  public: {
    loginHost: "https://login.microsoftonline.com",
    apiHost: "https://api.security.microsoft.com",
    resource: "https://api.securitycenter.microsoft.com",
  },
  usgov: {
    loginHost: "https://login.microsoftonline.us",
    apiHost: "https://api-gov.securitycenter.microsoft.us",
    resource: "https://api-gov.securitycenter.microsoft.us",
  },
});

export interface DefenderMachine {
  id: string;
  computerDnsName: string;
}

/*
 * ---------- Indicators (#10346) ----------
 *
 * The blocklist's Microsoft Defender destination blocks domains, URLs,
 * addresses and files on every machine through Defender for Endpoint's
 * indicators (https://learn.microsoft.com/defender-endpoint/api/ti-indicator):
 *
 *   GET  {api}/api/indicators?$filter=application eq 'OneUptime'
 *                                     OneUptime's indicators, 10,000 a page
 *   POST {api}/api/indicators/import  { Indicators: [...] }, 500 a call
 *   POST {api}/api/indicators/BatchDelete
 *                                     { IndicatorIds: [...] }, 500 a call
 *   DELETE {api}/api/indicators/{id}  one, when a batch meets one gone
 *
 * They take the WindowsDefenderATP application permission Ti.ReadWrite.All,
 * with admin consent; the error says so when Defender answers 403. Defender
 * holds 15,000 active indicators a tenant, takes 100 calls a minute and
 * 1,500 an hour (the import and the batch delete 30 a minute), deletes an
 * indicator past its expirationTime by itself, and answers 429 with a
 * Retry-After when it is called too often.
 */

export enum DefenderIndicatorType {
  FileSha256 = "FileSha256",
  FileSha1 = "FileSha1",
  FileMd5 = "FileMd5",
  IpAddress = "IpAddress",
  DomainName = "DomainName",
  Url = "Url",
}

export enum DefenderIndicatorAction {
  Block = "Block",
  // Files only: blocks the file and quarantines the copies Defender finds.
  BlockAndRemediate = "BlockAndRemediate",
}

// One indicator, as Defender lists it.
export interface DefenderIndicator {
  id: string;
  indicatorValue: string;
  indicatorType: string;
  action: string;
  application: string;
  title: string;
  description: string;
  // When Defender deletes it by itself: null for never.
  expirationTime: Date | null;
}

// One indicator to add.
export interface DefenderIndicatorSubmission {
  indicatorValue: string;
  indicatorType: DefenderIndicatorType;
  action: DefenderIndicatorAction;
  title: string;
  description: string;
  expirationTime: Date | null;
}

// What became of one indicator an import sent.
export interface DefenderIndicatorImportResult {
  indicatorValue: string;
  id: string | null;
  isFailed: boolean;
  failureReason: string | null;
}

// What the indicators OneUptime adds are filed under, which its list reads them back by.
export const DEFENDER_INDICATOR_APPLICATION: string = "OneUptime";

// The most active indicators a tenant holds, OneUptime's and its own together.
export const DEFENDER_MAX_ACTIVE_INDICATORS: number = 15000;

// The most indicators one import, or one batch delete, takes.
export const DEFENDER_INDICATOR_BATCH_SIZE: number = 500;

// The most indicators one page of the list holds ($top).
export const DEFENDER_INDICATOR_PAGE_SIZE: number = 10000;

// The application permission blocking takes.
export const DEFENDER_INDICATORS_PERMISSION: string = "Ti.ReadWrite.All";

export const DEFENDER_INDICATORS_PERMISSION_HINT: string =
  "The app registration needs the WindowsDefenderATP application permission Ti.ReadWrite.All, with admin consent.";

// The longest title and description OneUptime writes on an indicator.
const DEFENDER_INDICATOR_TITLE_MAX_LENGTH: number = 100;
const DEFENDER_INDICATOR_DESCRIPTION_MAX_LENGTH: number = 500;

function readTime(value: unknown): Date | null {
  if (typeof value !== "string" || !value) {
    return null;
  }

  const time: Date = new Date(value);

  return Number.isNaN(time.getTime()) ? null : time;
}

function readText(record: JSONObject, key: string): string {
  const value: unknown = record[key];

  return typeof value === "string"
    ? value
    : typeof value === "number"
      ? String(value)
      : "";
}

/*
 * How long Defender asked OneUptime to wait, from a throttled answer's
 * Retry-After (seconds), in words: "30 seconds". Null without one.
 */
export function readDefenderRetryAfter(
  headers: Record<string, string> | undefined,
): string | null {
  const seconds: number = Number((headers || {})["retry-after"]);

  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }

  return describeWait(seconds);
}

// A wait in seconds, in words: "1 second", "30 seconds", "5 minutes".
export function describeWait(seconds: number): string {
  if (seconds < 120) {
    const whole: number = Math.max(1, Math.ceil(seconds));

    return whole === 1 ? "1 second" : `${whole} seconds`;
  }

  return `${Math.ceil(seconds / 60)} minutes`;
}

/*
 * The application permissions an access token carries: its "roles" claim.
 * Read from the token itself - a JWT's middle part - without checking its
 * signature, which Defender does: the answer only says what OneUptime may
 * ask before it asks. Empty for a token that is not a JWT.
 */
export function readAccessTokenRoles(token: string): Array<string> {
  const payload: string | undefined = (token || "").split(".")[1];

  if (!payload) {
    return [];
  }

  try {
    const json: unknown = JSON.parse(
      Buffer.from(
        payload.replace(/-/g, "+").replace(/_/g, "/"),
        "base64",
      ).toString("utf8"),
    );
    const roles: unknown =
      json && typeof json === "object"
        ? (json as Record<string, unknown>)["roles"]
        : undefined;

    return Array.isArray(roles)
      ? roles.filter((role: unknown): role is string => {
          return typeof role === "string";
        })
      : [];
  } catch {
    return [];
  }
}

// OData string literal: a single quote doubled.
export function odataQuotedValue(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export default class MicrosoftDefenderEndpointClient {
  private endpoints: CloudEndpoints;
  private tenantId: string;
  private clientId: string;
  private clientSecret: string;
  private transport: ConnectorTransport;
  private accessToken: string | null = null;

  public constructor(options: {
    tenantId: string;
    clientId: string;
    clientSecret: string;
    cloud: string;
    transport: ConnectorTransport;
  }) {
    const endpoints: CloudEndpoints | undefined = CLOUDS.get(options.cloud);

    if (!endpoints) {
      throw new APIException(
        `The connection's Microsoft cloud "${options.cloud}" is not one OneUptime knows.`,
      );
    }

    this.endpoints = endpoints;
    this.tenantId = options.tenantId;
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

    const step: string = "Microsoft Defender token request";
    const result: ResponseHttpResult = await ResponseHttp.send({
      transport: this.transport,
      request: {
        method: "POST",
        url: `${this.endpoints.loginHost}/${encodeURIComponent(this.tenantId)}/oauth2/v2.0/token`,
        headers: { Accept: "application/json" },
        body: {
          grant_type: "client_credentials",
          client_id: this.clientId,
          client_secret: this.clientSecret,
          scope: `${this.endpoints.resource}/.default`,
        },
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
    method: "GET" | "POST" | "DELETE",
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

  /*
   * An indicator call that failed, in words that say what to do: throttled
   * (and for how long), missing its permission, or a feature Defender has
   * off.
   */
  private indicatorFailure(step: string, result: ResponseHttpResult): Error {
    if (result.statusCode === 429) {
      const wait: string | null = readDefenderRetryAfter(result.headers);

      return new APIException(
        `${step} was throttled: Microsoft Defender takes 100 calls a minute and 1,500 an hour${wait ? `, and asked OneUptime to wait ${wait}` : ""}. OneUptime tries again later.`,
      );
    }

    const code: unknown = (
      (result.bodyJson as JSONObject | undefined)?.["error"] as
        | JSONObject
        | undefined
    )?.["code"];

    return ResponseHttp.failure({
      step,
      result,
      secrets: this.secrets(),
      hint:
        code === "DisabledFeature"
          ? "Turn on Custom network indicators, and Allow or block file for files, in Microsoft Defender's Settings > Endpoints > Advanced features."
          : result.statusCode === 403 || result.statusCode === 401
            ? DEFENDER_INDICATORS_PERMISSION_HINT
            : undefined,
    });
  }

  /*
   * The indicators OneUptime added to the tenant - filed under
   * DEFENDER_INDICATOR_APPLICATION - every page of them. Only active ones:
   * Defender deletes an indicator past its expirationTime.
   */
  public async listIndicators(): Promise<Array<DefenderIndicator>> {
    const step: string = "Microsoft Defender indicator list";
    const indicators: Array<DefenderIndicator> = [];

    for (let skip: number = 0; ; skip += DEFENDER_INDICATOR_PAGE_SIZE) {
      const params: URLSearchParams = new URLSearchParams();
      params.set(
        "$filter",
        `application eq ${odataQuotedValue(DEFENDER_INDICATOR_APPLICATION)}`,
      );
      params.set("$top", String(DEFENDER_INDICATOR_PAGE_SIZE));
      params.set("$skip", String(skip));

      const result: ResponseHttpResult = await this.sendAuthenticated(
        step,
        "GET",
        `${this.endpoints.apiHost}/api/indicators?${params.toString()}`,
        undefined,
        { acceptAnyStatus: true },
      );

      if (!ResponseHttp.isSuccess(result)) {
        throw this.indicatorFailure(step, result);
      }

      const value: unknown = (result.bodyJson as JSONObject | undefined)?.[
        "value"
      ];
      const page: Array<unknown> = Array.isArray(value) ? value : [];

      for (const item of page) {
        if (!item || typeof item !== "object") {
          continue;
        }

        const record: JSONObject = item as JSONObject;
        const id: string = readText(record, "id");

        if (!id) {
          continue;
        }

        indicators.push({
          id,
          indicatorValue: readText(record, "indicatorValue"),
          indicatorType: readText(record, "indicatorType"),
          action: readText(record, "action"),
          application: readText(record, "application"),
          title: readText(record, "title"),
          description: readText(record, "description"),
          expirationTime: readTime(record["expirationTime"]),
        });
      }

      if (page.length < DEFENDER_INDICATOR_PAGE_SIZE) {
        return indicators;
      }
    }
  }

  /*
   * Adds indicators, DEFENDER_INDICATOR_BATCH_SIZE a call, filed under
   * DEFENDER_INDICATOR_APPLICATION, applying to every device (no device
   * group). Says per indicator whether Defender took it, and why not.
   */
  public async importIndicators(
    submissions: Array<DefenderIndicatorSubmission>,
  ): Promise<Array<DefenderIndicatorImportResult>> {
    const step: string = "Microsoft Defender indicator import";
    const results: Array<DefenderIndicatorImportResult> = [];

    for (
      let start: number = 0;
      start < submissions.length;
      start += DEFENDER_INDICATOR_BATCH_SIZE
    ) {
      const batch: Array<DefenderIndicatorSubmission> = submissions.slice(
        start,
        start + DEFENDER_INDICATOR_BATCH_SIZE,
      );

      const result: ResponseHttpResult = await this.sendAuthenticated(
        step,
        "POST",
        `${this.endpoints.apiHost}/api/indicators/import`,
        JSON.stringify({
          Indicators: batch.map(
            (submission: DefenderIndicatorSubmission): JSONObject => {
              return {
                indicatorValue: submission.indicatorValue,
                indicatorType: submission.indicatorType,
                action: submission.action,
                application: DEFENDER_INDICATOR_APPLICATION,
                title: submission.title.slice(
                  0,
                  DEFENDER_INDICATOR_TITLE_MAX_LENGTH,
                ),
                description: submission.description.slice(
                  0,
                  DEFENDER_INDICATOR_DESCRIPTION_MAX_LENGTH,
                ),
                severity: "High",
                generateAlert: false,
                ...(submission.expirationTime
                  ? {
                      expirationTime: submission.expirationTime.toISOString(),
                    }
                  : {}),
              };
            },
          ),
        }),
        { acceptAnyStatus: true },
      );

      if (!ResponseHttp.isSuccess(result)) {
        throw this.indicatorFailure(step, result);
      }

      const value: unknown = (result.bodyJson as JSONObject | undefined)?.[
        "value"
      ];
      const answered: Map<string, DefenderIndicatorImportResult> = new Map();

      for (const item of Array.isArray(value) ? value : []) {
        if (!item || typeof item !== "object") {
          continue;
        }

        const record: JSONObject = item as JSONObject;
        const indicator: string = readText(record, "indicator");
        const id: string = readText(record, "id");
        const failureReason: string = readText(record, "failureReason");

        answered.set(indicator.toLowerCase(), {
          indicatorValue: indicator,
          id: id || null,
          isFailed: record["isFailed"] === true,
          failureReason: failureReason || null,
        });
      }

      for (const submission of batch) {
        results.push(
          answered.get(submission.indicatorValue.toLowerCase()) || {
            indicatorValue: submission.indicatorValue,
            id: null,
            isFailed: true,
            failureReason: "Microsoft Defender said nothing about it",
          },
        );
      }
    }

    return results;
  }

  /*
   * Deletes indicators by their IDs, DEFENDER_INDICATOR_BATCH_SIZE a call.
   * A batch that meets one already gone (404) is deleted one by one, and
   * one gone is deleted: what is asked is that Defender no longer holds
   * it. Says which could not be deleted, and why.
   */
  public async deleteIndicators(
    ids: Array<string>,
  ): Promise<Array<{ id: string; error: string }>> {
    const step: string = "Microsoft Defender indicator delete";
    const failures: Array<{ id: string; error: string }> = [];

    for (
      let start: number = 0;
      start < ids.length;
      start += DEFENDER_INDICATOR_BATCH_SIZE
    ) {
      const batch: Array<string> = ids.slice(
        start,
        start + DEFENDER_INDICATOR_BATCH_SIZE,
      );

      const result: ResponseHttpResult = await this.sendAuthenticated(
        step,
        "POST",
        `${this.endpoints.apiHost}/api/indicators/BatchDelete`,
        JSON.stringify({ IndicatorIds: batch }),
        { acceptAnyStatus: true },
      );

      if (ResponseHttp.isSuccess(result)) {
        continue;
      }

      if (result.statusCode !== 404) {
        throw this.indicatorFailure(step, result);
      }

      for (const id of batch) {
        const one: ResponseHttpResult = await this.sendAuthenticated(
          step,
          "DELETE",
          `${this.endpoints.apiHost}/api/indicators/${encodeURIComponent(id)}`,
          undefined,
          { acceptAnyStatus: true },
        );

        if (ResponseHttp.isSuccess(one) || one.statusCode === 404) {
          continue;
        }

        if (one.statusCode === 429 || one.statusCode === 403) {
          throw this.indicatorFailure(step, one);
        }

        failures.push({
          id,
          error: this.indicatorFailure(step, one).message,
        });
      }
    }

    return failures;
  }

  /*
   * The application permissions the connection's app registration was
   * granted on Defender for Endpoint, from the token's roles: what Test
   * Connection checks Ti.ReadWrite.All against, without writing anything.
   */
  public async readApplicationPermissions(): Promise<Array<string>> {
    return readAccessTokenRoles(await this.getAccessToken());
  }

  /*
   * The devices whose DNS name is this host: the name itself, or the name
   * followed by a domain ("web-01" finds "web-01.contoso.com", never
   * "web-010.contoso.com").
   */
  public async findMachines(hostname: string): Promise<Array<DefenderMachine>> {
    const step: string = "Microsoft Defender device lookup";
    const host: string = hostname.trim().toLowerCase();
    const params: URLSearchParams = new URLSearchParams();
    params.set(
      "$filter",
      `startswith(computerDnsName,${odataQuotedValue(host)})`,
    );
    params.set("$top", "25");

    const result: ResponseHttpResult = await this.sendAuthenticated(
      step,
      "GET",
      `${this.endpoints.apiHost}/api/machines?${params.toString()}`,
    );

    // Defender answers 404 when it has no matching device.
    if (result.statusCode === 404) {
      return [];
    }

    if (!ResponseHttp.isSuccess(result)) {
      throw ResponseHttp.failure({
        step,
        result,
        secrets: this.secrets(),
        hint:
          result.statusCode === 403
            ? "The app registration needs the WindowsDefenderATP permission Machine.Read.All, with admin consent."
            : undefined,
      });
    }

    const value: unknown = (result.bodyJson as JSONObject | undefined)?.[
      "value"
    ];

    if (!Array.isArray(value)) {
      return [];
    }

    const machines: Array<DefenderMachine> = [];

    for (const item of value) {
      if (!item || typeof item !== "object") {
        continue;
      }

      const machine: JSONObject = item as JSONObject;
      const id: string = typeof machine["id"] === "string" ? machine["id"] : "";
      const name: string =
        typeof machine["computerDnsName"] === "string"
          ? machine["computerDnsName"]
          : "";
      const lowered: string = name.toLowerCase();

      if (id && (lowered === host || lowered.startsWith(`${host}.`))) {
        machines.push({ id, computerDnsName: name });
      }
    }

    return machines;
  }

  /*
   * Whether a device is isolated, from its isolation actions: the latest of
   * its Isolate and Unisolate actions that succeeded says, and when. What a
   * Response Plan step's check reads back (#10340); null when none of them
   * ever succeeded. Needs Machine.Read.All, as the lookup does.
   */
  public async getIsolation(
    machineId: string,
  ): Promise<{ isIsolated: boolean; since: Date | null } | null> {
    const step: string = "Microsoft Defender isolation lookup";
    const params: URLSearchParams = new URLSearchParams();
    params.set("$filter", `machineId eq ${odataQuotedValue(machineId)}`);
    params.set("$top", "50");

    const result: ResponseHttpResult = await this.sendAuthenticated(
      step,
      "GET",
      `${this.endpoints.apiHost}/api/machineactions?${params.toString()}`,
    );

    if (!ResponseHttp.isSuccess(result)) {
      throw ResponseHttp.failure({
        step,
        result,
        secrets: this.secrets(),
        hint:
          result.statusCode === 403
            ? "The app registration needs the WindowsDefenderATP permission Machine.Read.All, with admin consent."
            : undefined,
      });
    }

    const value: unknown = (result.bodyJson as JSONObject | undefined)?.[
      "value"
    ];
    let latest: { isIsolated: boolean; since: Date | null; at: number } | null =
      null;

    for (const item of Array.isArray(value) ? value : []) {
      if (!item || typeof item !== "object") {
        continue;
      }

      const action: JSONObject = item as JSONObject;
      const type: unknown = action["type"];
      const status: unknown = action["status"];

      if (
        (type !== "Isolate" && type !== "Unisolate") ||
        status !== "Succeeded"
      ) {
        continue;
      }

      const when: unknown =
        action["lastUpdateDateTimeUtc"] || action["creationDateTimeUtc"];
      const since: Date | null =
        typeof when === "string" && !Number.isNaN(new Date(when).getTime())
          ? new Date(when)
          : null;
      const at: number = since ? since.getTime() : 0;

      if (!latest || at > latest.at) {
        latest = { isIsolated: type === "Isolate", since, at };
      }
    }

    return latest
      ? { isIsolated: latest.isIsolated, since: latest.since }
      : null;
  }

  public async releaseMachine(data: {
    machineId: string;
    comment: string;
  }): Promise<void> {
    const step: string = "Microsoft Defender release from isolation";
    const result: ResponseHttpResult = await this.sendAuthenticated(
      step,
      "POST",
      `${this.endpoints.apiHost}/api/machines/${encodeURIComponent(data.machineId)}/unisolate`,
      JSON.stringify({ Comment: data.comment }),
    );

    if (!ResponseHttp.isSuccess(result)) {
      throw ResponseHttp.failure({
        step,
        result,
        secrets: this.secrets(),
        hint:
          result.statusCode === 403
            ? "The app registration needs the WindowsDefenderATP permission Machine.Isolate, with admin consent."
            : undefined,
      });
    }
  }

  public async isolateMachine(data: {
    machineId: string;
    isolationType: "Full" | "Selective";
    comment: string;
  }): Promise<void> {
    const step: string = "Microsoft Defender isolate";
    const result: ResponseHttpResult = await this.sendAuthenticated(
      step,
      "POST",
      `${this.endpoints.apiHost}/api/machines/${encodeURIComponent(data.machineId)}/isolate`,
      JSON.stringify({
        Comment: data.comment,
        IsolationType: data.isolationType,
      }),
    );

    if (!ResponseHttp.isSuccess(result)) {
      throw ResponseHttp.failure({
        step,
        result,
        secrets: this.secrets(),
        hint:
          result.statusCode === 403
            ? "The app registration needs the WindowsDefenderATP permission Machine.Isolate, with admin consent."
            : undefined,
      });
    }
  }
}
