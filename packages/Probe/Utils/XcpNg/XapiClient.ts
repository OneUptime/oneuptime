import {
  XCP_NG_USER_AGENT,
  XcpNgHttpResponse,
  XcpNgTransport,
  readHeader,
  readJsonBody,
} from "./XcpNgHttp";

/*
 * A minimal client for XAPI, the API every XCP-ng host serves (#10999), with
 * just the calls the probe makes - the reads Xen Orchestra's own client
 * (xen-api, packages/xen-api in vatesfr/xen-orchestra) makes for its
 * OpenMetrics plugin:
 *
 *   POST /jsonrpc       JSON-RPC 2.0. A call that fails answers
 *                       {"error":{"message":"<CODE>","data":[<params>]}} -
 *                       HOST_IS_SLAVE ["<master address>"] from a pool
 *                       member, SESSION_AUTHENTICATION_FAILED for a wrong
 *                       login, RBAC_PERMISSION_DENIED for a read the account
 *                       may not make. A host too old for JSON-RPC answers
 *                       text/xml.
 *   GET /rrd_updates    each host's own metrics and its VMs', at 60-second
 *                       resolution, as JSON.
 *
 * The transport is handed in: XcpNgHttp sends over a verified TLS socket,
 * and the tests replay answers recorded from XAPI's documentation.
 */

// What XAPI answered a call with when the call failed.
export class XapiError extends Error {
  public readonly code: string;
  public readonly params: Array<string>;
  public readonly method: string;

  public constructor(data: {
    code: string;
    params: Array<string>;
    method: string;
  }) {
    super(`${data.code}(${data.params.join(", ")})`);
    this.name = "XapiError";
    this.code = data.code;
    this.params = data.params;
    this.method = data.method;
  }
}

// An answer that is not XAPI's: a web page, a proxy, an old host.
export class XapiNotXapiError extends Error {
  public readonly status: number;

  public constructor(message: string, status: number) {
    super(message);
    this.name = "XapiNotXapiError";
    this.status = status;
  }
}

export type XapiRecords<T> = Record<string, T>;

export const XAPI_NULL_REF: string = "OpaqueRef:NULL";

// The originator OneUptime's sessions name, as XAPI's audit log shows it.
export const XAPI_ORIGINATOR: string = "OneUptime";

export default class XapiClient {
  private readonly transport: XcpNgTransport;
  private nextId: number = 1;

  public constructor(transport: XcpNgTransport) {
    this.transport = transport;
  }

  public async call<T>(method: string, params: Array<unknown>): Promise<T> {
    const id: number = this.nextId++;
    const response: XcpNgHttpResponse = await this.transport({
      method: "POST",
      path: "/jsonrpc",
      headers: {
        "User-Agent": XCP_NG_USER_AGENT,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: method,
        params: params,
        id: id,
      }),
    });

    if (response.status < 200 || response.status >= 300) {
      throw new XapiNotXapiError(
        `answered HTTP ${response.status} at /jsonrpc`,
        response.status,
      );
    }

    if (!readHeader(response, "content-type").includes("application/json")) {
      throw new XapiNotXapiError(
        `answered ${
          readHeader(response, "content-type") || "something that is not JSON"
        } at /jsonrpc - XCP-ng 8.2 or later answers JSON-RPC`,
        response.status,
      );
    }

    const json: unknown = readJsonBody(response);

    if (!json || typeof json !== "object" || Array.isArray(json)) {
      throw new XapiNotXapiError(
        "answered /jsonrpc with something that is not JSON-RPC",
        response.status,
      );
    }

    const body: Record<string, unknown> = json as Record<string, unknown>;

    if (body["error"] !== undefined && body["error"] !== null) {
      throw XapiClient.toXapiError(body["error"], method);
    }

    if (!("result" in body)) {
      throw new XapiNotXapiError(
        "answered /jsonrpc with neither a result nor an error",
        response.status,
      );
    }

    return body["result"] as T;
  }

  private static toXapiError(error: unknown, method: string): XapiError {
    // Before XenServer 7.3 an error was the array [code, ...params].
    if (Array.isArray(error)) {
      const [code, ...params] = error as Array<unknown>;
      return new XapiError({
        code: String(code ?? "UNKNOWN"),
        params: params.map((param: unknown): string => {
          return String(param);
        }),
        method: method,
      });
    }

    const record: Record<string, unknown> =
      error && typeof error === "object"
        ? (error as Record<string, unknown>)
        : {};
    const data: unknown = record["data"];

    return new XapiError({
      code: String(record["message"] ?? record["code"] ?? "UNKNOWN"),
      params: Array.isArray(data)
        ? (data as Array<unknown>).map((param: unknown): string => {
            return String(param);
          })
        : [],
      method: method,
    });
  }

  // A session: throws HOST_IS_SLAVE on a pool member, with its master.
  public async login(username: string, password: string): Promise<string> {
    return await this.call<string>("session.login_with_password", [
      username,
      password,
      "1.0",
      XAPI_ORIGINATOR,
    ]);
  }

  public async logout(session: string): Promise<void> {
    await this.call<unknown>("session.logout", [session]);
  }

  public async getAllRecords<T>(
    session: string,
    xapiClass: string,
  ): Promise<XapiRecords<T>> {
    const records: unknown = await this.call<unknown>(
      `${xapiClass}.get_all_records`,
      [session],
    );

    return records && typeof records === "object" && !Array.isArray(records)
      ? (records as XapiRecords<T>)
      : {};
  }

  /*
   * One host's rrd_updates, as Xen Orchestra's plugin asks for it: every
   * series of the host and of the VMs it runs, averaged a minute at a time,
   * from `startSeconds`.
   */
  public async getRrdUpdates(data: {
    session: string;
    startSeconds: number;
  }): Promise<string> {
    const query: URLSearchParams = new URLSearchParams();
    query.set("session_id", data.session);
    query.set("cf", "AVERAGE");
    query.set("interval", "60");
    query.set("start", String(data.startSeconds));
    query.set("host", "true");
    query.set("json", "true");

    const response: XcpNgHttpResponse = await this.transport({
      method: "GET",
      path: `/rrd_updates?${query.toString()}`,
      headers: {
        "User-Agent": XCP_NG_USER_AGENT,
        Accept: "application/json",
      },
    });

    if (response.status !== 200) {
      throw new XapiNotXapiError(
        `answered HTTP ${response.status} at /rrd_updates`,
        response.status,
      );
    }

    return response.body;
  }
}

// XAPI's DateTime, as JSON-RPC carries it: "20261126T04:20:30Z".
export function formatXapiDateTime(date: Date): string {
  const pad: (value: number) => string = (value: number): string => {
    return String(value).padStart(2, "0");
  };

  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(
    date.getUTCDate(),
  )}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(
    date.getUTCSeconds(),
  )}Z`;
}

/*
 * A DateTime XAPI wrote - "20261126T04:20:30Z", the same with a numeric
 * zone, or the ISO form - as a Date, or null when it is none (XAPI writes
 * the epoch, 19700101T00:00:00Z, for a date never set).
 */
export function parseXapiDateTime(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const text: string = value.trim();
  const compact: RegExpMatchArray | null = text.match(
    /^(\d{4})(\d{2})(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/,
  );

  let date: Date;

  if (compact) {
    const zone: string = compact[7] || "Z";
    date = new Date(
      `${compact[1]}-${compact[2]}-${compact[3]}T${compact[4]}:${compact[5]}:${compact[6]}${
        zone === "Z" ? "Z" : zone.includes(":") ? zone : `${zone.slice(0, 3)}:${zone.slice(3)}`
      }`,
    );
  } else {
    date = new Date(text);
  }

  const time: number = date.getTime();

  if (Number.isNaN(time) || time <= 0) {
    return null;
  }

  return date;
}
