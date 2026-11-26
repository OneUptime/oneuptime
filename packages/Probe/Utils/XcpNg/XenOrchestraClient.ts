import { XcpNgCollectionError } from "./XcpNgCollectionErrors";
import {
  XCP_NG_USER_AGENT,
  XcpNgEndpoint,
  XcpNgHttpResponse,
  XcpNgTransport,
  readHeader,
  readJsonBody,
} from "./XcpNgHttp";
import XcpNgCollectionErrorCode from "Common/Types/XcpNg/XcpNgCollectionError";
import { XcpNgApiTokenSummary } from "Common/Types/XcpNg/XcpNgProbeCollection";

/*
 * What a probe reads of a Xen Orchestra, and how it reads what Xen
 * Orchestra answers - from xo-server and its OpenMetrics plugin
 * (xo-server-openmetrics 1.9.4) and its REST API (@xen-orchestra/rest-api),
 * read in vatesfr/xen-orchestra on 26 November 2026:
 *
 *   GET /openmetrics/health    200 {"status":"ok"}, no secret: the plugin
 *                              answers. xo-server proxies /openmetrics/* to
 *                              the plugin's own server; with the plugin not
 *                              loaded the proxy fails every request with 500
 *                              text/plain "There was a problem proxying this
 *                              request."
 *   GET /openmetrics/metrics   with `Authorization: Bearer <secret>`: the
 *                              scrape. No secret is 401 {"error":"Query is
 *                              not authenticated"}, another one 401 {"error":
 *                              "Query authentication does not match server
 *                              setting"}. With no pool connected the body is
 *                              "# No connected hosts\n# EOF".
 *   /rest/v0/...               with the token as the `authenticationToken`
 *                              cookie (Xen Orchestra's REST API takes a token
 *                              no other way). /users/me is answered with a
 *                              307 to /users/<id>. A wrong token - or an
 *                              expired one, which Xen Orchestra forgets - is
 *                              401. A list a user's privileges do not cover
 *                              is answered empty, not refused.
 *
 * Nothing it reads is kept but what OneUptime shows: of the user's tokens,
 * only the expiry of the one in use - never another token.
 */

export const XO_PROXY_ERROR_TEXT: string =
  "There was a problem proxying this request.";
export const XO_NOT_AUTHENTICATED: string = "Query is not authenticated";
export const XO_WRONG_SECRET: string =
  "Query authentication does not match server setting";
export const XO_NO_CONNECTED_HOSTS: string = "# No connected hosts";

export const XO_OPENMETRICS_HEALTH_PATH: string = "/openmetrics/health";
export const XO_OPENMETRICS_METRICS_PATH: string = "/openmetrics/metrics";

// What the receiver of the XCP-ng Agent asks for, so the answer is the same.
const OPENMETRICS_ACCEPT: string =
  "application/openmetrics-text;version=1.0.0;q=0.75,text/plain;version=0.0.4;q=0.5,*/*;q=0.1";

// A privilege of Xen Orchestra's role-based access (ACL v2).
interface XoPrivilege {
  action?: unknown;
  resource?: unknown;
  effect?: unknown;
}

export type XenOrchestraPluginState = "loaded" | "not-loaded" | "missing";

function looksLikeHtml(body: string): boolean {
  const start: string = body.trimStart().substring(0, 64).toLowerCase();
  return start.startsWith("<!doctype") || start.startsWith("<html");
}

function readErrorText(response: XcpNgHttpResponse): string {
  const json: unknown = readJsonBody(response);

  if (json && typeof json === "object" && !Array.isArray(json)) {
    const error: unknown = (json as Record<string, unknown>)["error"];

    if (typeof error === "string") {
      return error;
    }
  }

  return response.body.trim().substring(0, 200);
}

export default class XenOrchestraClient {
  private readonly transport: XcpNgTransport;
  private readonly where: string;

  public constructor(transport: XcpNgTransport, endpoint: XcpNgEndpoint) {
    this.transport = transport;
    this.where = `${endpoint.host}:${endpoint.port}`;
  }

  private async get(
    path: string,
    headers: Record<string, string>,
  ): Promise<XcpNgHttpResponse> {
    return await this.transport({
      method: "GET",
      path: path,
      headers: {
        "User-Agent": XCP_NG_USER_AGENT,
        ...headers,
      },
    });
  }

  private pluginNotLoaded(): XcpNgCollectionError {
    return new XcpNgCollectionError(
      XcpNgCollectionErrorCode.PluginNotLoaded,
      `Xen Orchestra at ${this.where} answers, but its OpenMetrics plugin does not ("${XO_PROXY_ERROR_TEXT}"). Load openmetrics in Xen Orchestra, under Settings, then Plugins. On the Xen Orchestra Appliance it needs a Premium licence.`,
    );
  }

  private notXenOrchestra(status: number): XcpNgCollectionError {
    return new XcpNgCollectionError(
      XcpNgCollectionErrorCode.NotXenOrchestra,
      `${this.where} answered HTTP ${status} at ${XO_OPENMETRICS_METRICS_PATH}, not as Xen Orchestra does. Enter the address you open Xen Orchestra at - Xen Orchestra 6.9 or later.`,
    );
  }

  /*
   * Whether the plugin answers at all, before any secret is sent. Throws
   * PluginNotLoaded, or NotXenOrchestra for an address that is not Xen
   * Orchestra.
   */
  public async checkPluginAnswers(): Promise<void> {
    const response: XcpNgHttpResponse = await this.get(
      XO_OPENMETRICS_HEALTH_PATH,
      { Accept: "application/json" },
    );

    if (response.status === 200) {
      const json: unknown = readJsonBody(response);

      if (
        json &&
        typeof json === "object" &&
        (json as Record<string, unknown>)["status"] === "ok"
      ) {
        return;
      }

      throw this.notXenOrchestra(response.status);
    }

    if (
      response.status >= 500 &&
      response.body.includes(XO_PROXY_ERROR_TEXT)
    ) {
      throw this.pluginNotLoaded();
    }

    // An older plugin, or one behind its own check: the scrape says more.
    if (response.status === 401) {
      return;
    }

    throw this.notXenOrchestra(response.status);
  }

  /*
   * The scrape, as the XCP-ng Agent reads it: the OpenMetrics text. Throws
   * the code that says why there is none.
   */
  public async readMetrics(secret: string): Promise<string> {
    const response: XcpNgHttpResponse = await this.get(
      XO_OPENMETRICS_METRICS_PATH,
      {
        Accept: OPENMETRICS_ACCEPT,
        Authorization: `Bearer ${secret}`,
      },
    );

    if (response.status === 200) {
      if (looksLikeHtml(response.body)) {
        throw this.notXenOrchestra(response.status);
      }

      return response.body;
    }

    if (response.status === 401) {
      const error: string = readErrorText(response);

      throw new XcpNgCollectionError(
        XcpNgCollectionErrorCode.WrongSecret,
        error === XO_NOT_AUTHENTICATED
          ? `Xen Orchestra at ${this.where} received no OpenMetrics secret ("${XO_NOT_AUTHENTICATED}"): a proxy in front of it may drop the Authorization header.`
          : `Xen Orchestra at ${this.where} refused the OpenMetrics secret ("${error || "401"}"). Copy it again from Settings, then Plugins, then openmetrics.`,
      );
    }

    if (
      response.status >= 500 &&
      response.body.includes(XO_PROXY_ERROR_TEXT)
    ) {
      throw this.pluginNotLoaded();
    }

    if (response.status === 404 && !readJsonBody(response)) {
      throw this.notXenOrchestra(response.status);
    }

    throw new XcpNgCollectionError(
      XcpNgCollectionErrorCode.ApiError,
      `Xen Orchestra at ${this.where} answered HTTP ${response.status} for its metrics: ${
        readErrorText(response) || "no detail"
      }`,
    );
  }

  /*
   * The OpenMetrics plugin as the REST API lists it, read with the token -
   * which tells a plugin that is not loaded from one this Xen Orchestra
   * does not have. Null when the token may not read plugins.
   */
  public async readPluginState(
    token: string,
  ): Promise<XenOrchestraPluginState | null> {
    const response: XcpNgHttpResponse = await this.get(
      "/rest/v0/plugins/openmetrics",
      {
        Accept: "application/json",
        Cookie: `authenticationToken=${token}`,
      },
    );

    if (response.status === 404) {
      return "missing";
    }

    if (response.status !== 200) {
      return null;
    }

    const json: unknown = readJsonBody(response);

    if (!json || typeof json !== "object") {
      return null;
    }

    return (json as Record<string, unknown>)["loaded"] === true
      ? "loaded"
      : "not-loaded";
  }

  /*
   * What Xen Orchestra says of the API token, read with it: its user, when
   * it expires, and whether it reads - and only reads - what OneUptime
   * needs. A token problem is in errorCode; only a network failure throws.
   */
  public async readApiToken(token: string): Promise<XcpNgApiTokenSummary> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      Cookie: `authenticationToken=${token}`,
    };

    let response: XcpNgHttpResponse = await this.get(
      "/rest/v0/users/me",
      headers,
    );

    // /users/me answers with a 307 to the user's own address.
    if (response.status >= 300 && response.status < 400) {
      const location: string = readHeader(response, "location");

      if (!/^\/rest\/v0\/users\/[A-Za-z0-9-]+$/.test(location)) {
        return {
          errorCode: XcpNgCollectionErrorCode.ApiError,
          errorMessage: `Xen Orchestra at ${this.where} sent /rest/v0/users/me somewhere the probe does not follow.`,
        };
      }

      response = await this.get(location, headers);
    }

    if (response.status === 401 || response.status === 403) {
      return {
        errorCode: XcpNgCollectionErrorCode.TokenRejected,
        errorMessage: `Xen Orchestra at ${this.where} refused the API token: it is wrong, or it expired. Create a new one for the read-only user and save it here.`,
      };
    }

    if (response.status !== 200) {
      return {
        errorCode: XcpNgCollectionErrorCode.ApiError,
        errorMessage: `Xen Orchestra at ${this.where} answered HTTP ${response.status} for its REST API (/rest/v0). It needs Xen Orchestra 6.9 or later.`,
      };
    }

    const user: unknown = readJsonBody(response);

    if (!user || typeof user !== "object" || Array.isArray(user)) {
      return {
        errorCode: XcpNgCollectionErrorCode.ApiError,
        errorMessage: `Xen Orchestra at ${this.where} answered /rest/v0/users/me with something that is not a user.`,
      };
    }

    const userRecord: Record<string, unknown> = user as Record<string, unknown>;
    const userId: string =
      typeof userRecord["id"] === "string" ? (userRecord["id"] as string) : "";
    const summary: XcpNgApiTokenSummary = {};

    const userName: unknown =
      userRecord["name"] || userRecord["email"] || userRecord["username"];

    if (typeof userName === "string" && userName.trim()) {
      summary.userName = userName.trim().substring(0, 200);
    }

    if (!/^[A-Za-z0-9-]+$/.test(userId)) {
      return {
        ...summary,
        errorCode: XcpNgCollectionErrorCode.ApiError,
        errorMessage: `Xen Orchestra at ${this.where} named no user for the API token.`,
      };
    }

    // The token's expiry: of the user's tokens, only the one in use.
    const tokens: XcpNgHttpResponse = await this.get(
      `/rest/v0/users/${userId}/authentication_tokens`,
      headers,
    );

    if (tokens.status === 200) {
      const list: unknown = readJsonBody(tokens);

      if (Array.isArray(list)) {
        for (const entry of list) {
          if (
            entry &&
            typeof entry === "object" &&
            (entry as Record<string, unknown>)["id"] === token
          ) {
            const expiration: unknown = (entry as Record<string, unknown>)[
              "expiration"
            ];

            if (typeof expiration === "number" && Number.isFinite(expiration)) {
              summary.expiresAt = new Date(expiration).toISOString();
            }
          }
        }
      }
    }

    // An administrator is not held to roles: nothing it can do is refused.
    if (userRecord["permission"] === "admin") {
      summary.isReadOnly = false;
      summary.canReadAlarms = true;
      summary.canReadMessages = true;
      summary.canReadBackupLogs = true;
      summary.errorCode = XcpNgCollectionErrorCode.TokenNotReadOnly;
      summary.errorMessage = `The API token belongs to ${
        summary.userName || "a user"
      }, a Xen Orchestra administrator: it can change every pool. OneUptime holds only read-only tokens: create one for a user holding a copy of the built-in Read only role.`;
      return summary;
    }

    const privileges: XcpNgHttpResponse = await this.get(
      `/rest/v0/users/${userId}/acl-privileges?fields=action,resource,effect`,
      headers,
    );

    if (privileges.status !== 200) {
      summary.errorCode = XcpNgCollectionErrorCode.ApiError;
      summary.errorMessage = `Xen Orchestra at ${this.where} did not list the token's privileges (HTTP ${privileges.status}). Reading roles needs Xen Orchestra 6.9 or later.`;
      return summary;
    }

    const list: unknown = readJsonBody(privileges);
    const allowed: Array<{ action: string; resource: string }> = (
      Array.isArray(list) ? (list as Array<XoPrivilege>) : []
    )
      .filter((privilege: XoPrivilege): boolean => {
        return (
          Boolean(privilege) &&
          typeof privilege === "object" &&
          privilege.effect !== "deny"
        );
      })
      .map((privilege: XoPrivilege): { action: string; resource: string } => {
        return {
          action: String(privilege.action ?? ""),
          resource: String(privilege.resource ?? ""),
        };
      });

    const reads: (resource: string) => boolean = (resource: string): boolean => {
      return allowed.some(
        (privilege: { action: string; resource: string }): boolean => {
          return (
            privilege.action === "read" &&
            (privilege.resource === resource || privilege.resource === "*")
          );
        },
      );
    };

    summary.isReadOnly = allowed.every(
      (privilege: { action: string; resource: string }): boolean => {
        return privilege.action === "read";
      },
    );
    summary.canReadAlarms = reads("alarm");
    summary.canReadMessages = reads("message");
    summary.canReadBackupLogs = reads("backup-log");

    if (!summary.isReadOnly) {
      const writes: Array<string> = allowed
        .filter((privilege: { action: string; resource: string }): boolean => {
          return privilege.action !== "read";
        })
        .map((privilege: { action: string; resource: string }): string => {
          return `${privilege.resource}:${privilege.action}`;
        })
        .slice(0, 5);

      summary.errorCode = XcpNgCollectionErrorCode.TokenNotReadOnly;
      summary.errorMessage = `The API token of ${
        summary.userName || "its user"
      } may change Xen Orchestra (${writes.join(", ")}). OneUptime holds only read-only tokens: give the user a copy of the built-in Read only role and nothing else.`;
      return summary;
    }

    if (
      !summary.canReadAlarms ||
      !summary.canReadMessages ||
      !summary.canReadBackupLogs
    ) {
      const missing: Array<string> = [
        ...(summary.canReadAlarms ? [] : ["alarms"]),
        ...(summary.canReadMessages ? [] : ["messages"]),
        ...(summary.canReadBackupLogs ? [] : ["backup logs"]),
      ];

      summary.errorCode = XcpNgCollectionErrorCode.TokenCannotReadAlarms;
      summary.errorMessage = `The API token of ${
        summary.userName || "its user"
      } cannot read ${missing.join(" or ")}. Give the user a copy of Xen Orchestra's built-in Read only role.`;
    }

    return summary;
  }
}
