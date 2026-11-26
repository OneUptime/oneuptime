import APIException from "../../../../Types/Exception/ApiException";
import { JSONObject } from "../../../../Types/JSON";
import { ConnectorTransport } from "../Connectors/Types";
import OktaClient, { OktaLogEventsPage } from "../Connectors/Okta/OktaClient";
import ResponseHttp, {
  RESPONSE_ACTION_TIMEOUT_IN_MS,
  ResponseHttpResult,
} from "./ResponseHttp";

/*
 * The Okta calls a playbook makes to contain an account, and to let it back
 * in, from the Okta management API (https://developer.okta.com/docs/api/openapi/okta-management/management/tag/User/
 * and .../tag/UserLifecycle/, .../tag/UserSessions/):
 *
 *   GET    {orgUrl}/api/v1/users/{login or id}            find the user
 *   POST   {orgUrl}/api/v1/users/{id}/lifecycle/suspend   suspend an ACTIVE user
 *   POST   {orgUrl}/api/v1/users/{id}/lifecycle/unsuspend unsuspend a SUSPENDED user
 *   DELETE {orgUrl}/api/v1/users/{id}/sessions?oauthTokens=true
 *                                                          end every session and
 *                                                          revoke OAuth tokens
 *
 * And what a Fix step's check reads back without changing anything
 * (#10347): the user's passwordChanged (on the user above), its factors
 * (GET {orgUrl}/api/v1/users/{id}/factors, okta.users.read) and the System
 * Log's user.session.clear events for it (GET {orgUrl}/api/v1/logs with
 * filter=eventType eq "user.session.clear" and target.id eq "{id}"). The
 * account changes an attack made (#10603) are read back too: the user's
 * groups (GET .../users/{id}/groups), admin roles (GET .../users/{id}/roles)
 * and factors, whether an app is assigned to them (GET .../apps/{app}/
 * users/{id}) and whether an API token still works (GET .../api-tokens/{id}).
 *
 * The token is the connection's SSWS API token, which acts with its
 * creator's admin rights: suspending needs a Super, Org or Group admin who
 * manages the user. Okta answers a suspend of a user who is not ACTIVE, and
 * an unsuspend of one who is not SUSPENDED, with an error; a user already
 * in the state asked for is reported as such, not as a failure.
 */

export interface OktaUser {
  id: string;
  status: string;
  login: string;
}

// The System Log's event for every session of a user cleared (Okta's event types catalog).
export const OKTA_SESSIONS_CLEARED_EVENT: string = "user.session.clear";

// The most of those events read: the latest is the one that counts.
export const OKTA_SESSIONS_CLEARED_PAGE_SIZE: number = 100;

export enum OktaContainmentOutcome {
  Done = "Done",
  AlreadyDone = "AlreadyDone",
}

/*
 * An item of a list a user's record holds - a factor, a group, an admin
 * role - as the account-changes check reads it (#10603): its id, its
 * status (a factor's ACTIVE), its type (a role's SUPER_ADMIN, a factor's
 * token:software:totp) and the name a person knows it by.
 */
export interface OktaUserObject {
  id: string;
  status: string;
  type: string;
  name: string;
}

// The most groups one read lists: Okta's own page size for a user's groups.
export const OKTA_LIST_PAGE_SIZE: number = 200;

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function readOktaUserObject(value: unknown): OktaUserObject {
  const record: JSONObject =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as JSONObject)
      : {};
  const profile: JSONObject =
    record["profile"] && typeof record["profile"] === "object"
      ? (record["profile"] as JSONObject)
      : {};

  return {
    id: readText(record["id"]),
    status: readText(record["status"]),
    type: readText(record["type"]) || readText(record["factorType"]),
    // A role's label, a group's or a device's name, else the factor's maker.
    name:
      readText(record["label"]) ||
      readText(profile["name"]) ||
      readText(profile["deviceName"]) ||
      readText(record["provider"]),
  };
}

export default class OktaResponseClient {
  private baseUrl: string;
  private apiToken: string;
  private transport: ConnectorTransport;

  public constructor(options: {
    orgUrl: string;
    apiToken: string;
    transport: ConnectorTransport;
  }) {
    this.baseUrl = OktaClient.buildBaseUrl(options.orgUrl);
    this.apiToken = options.apiToken;
    this.transport = options.transport;
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `SSWS ${this.apiToken}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    };
  }

  private async send(
    step: string,
    method: "GET" | "POST" | "DELETE",
    path: string,
  ): Promise<ResponseHttpResult> {
    return await ResponseHttp.send({
      transport: this.transport,
      request: {
        method,
        url: `${this.baseUrl}${path}`,
        headers: this.headers(),
        body: method === "POST" ? "{}" : undefined,
      },
      step,
      secrets: [this.apiToken],
    });
  }

  // The user record Okta holds for this login (or id), or null when it has none.
  private async fetchUser(
    loginOrId: string,
  ): Promise<{ user: OktaUser; body: JSONObject } | null> {
    const step: string = "Okta user lookup";
    const result: ResponseHttpResult = await this.send(
      step,
      "GET",
      `/api/v1/users/${encodeURIComponent(loginOrId)}`,
    );

    if (result.statusCode === 404) {
      return null;
    }

    if (!ResponseHttp.isSuccess(result)) {
      throw ResponseHttp.failure({
        step,
        result,
        secrets: [this.apiToken],
        hint:
          result.statusCode === 401 || result.statusCode === 403
            ? "The connection's API token cannot read users: create it as an admin who manages them."
            : undefined,
      });
    }

    const body: JSONObject =
      result.bodyJson && typeof result.bodyJson === "object"
        ? (result.bodyJson as JSONObject)
        : {};
    const id: string = typeof body["id"] === "string" ? body["id"] : "";

    if (!id) {
      throw new APIException(`${step} returned a user without an id.`);
    }

    const profile: JSONObject =
      body["profile"] && typeof body["profile"] === "object"
        ? (body["profile"] as JSONObject)
        : {};

    return {
      user: {
        id,
        status: typeof body["status"] === "string" ? body["status"] : "",
        login:
          typeof profile["login"] === "string" ? profile["login"] : loginOrId,
      },
      body,
    };
  }

  // The user signing in as this login (or with this id), or null when Okta has none.
  public async findUser(loginOrId: string): Promise<OktaUser | null> {
    return (await this.fetchUser(loginOrId))?.user || null;
  }

  /*
   * The user, and when Okta last changed their status (statusChanged): what
   * a Response Plan step's check reads back to say since when an account is
   * suspended (#10340). Null when Okta has no such user.
   */
  public async readUserState(
    loginOrId: string,
  ): Promise<{ user: OktaUser; statusChangedAt: Date | null } | null> {
    const found: { user: OktaUser; body: JSONObject } | null =
      await this.fetchUser(loginOrId);

    if (!found) {
      return null;
    }

    const changed: Date | null =
      typeof found.body["statusChanged"] === "string"
        ? new Date(found.body["statusChanged"])
        : null;

    return {
      user: found.user,
      statusChangedAt:
        changed && !Number.isNaN(changed.getTime()) ? changed : null,
    };
  }

  /*
   * The user, and when their password last changed (passwordChanged):
   * what the Fix step "reset the password" reads back (#10347). Null when
   * Okta has no such user.
   */
  public async readPasswordChanged(
    loginOrId: string,
  ): Promise<{ user: OktaUser; passwordChangedAt: Date | null } | null> {
    const found: { user: OktaUser; body: JSONObject } | null =
      await this.fetchUser(loginOrId);

    if (!found) {
      return null;
    }

    const changed: Date | null =
      typeof found.body["passwordChanged"] === "string"
        ? new Date(found.body["passwordChanged"])
        : null;

    return {
      user: found.user,
      passwordChangedAt:
        changed && !Number.isNaN(changed.getTime()) ? changed : null,
    };
  }

  /*
   * The latest moment in [since, until] the System Log says every session
   * of the user was cleared (user.session.clear: an admin, a playbook's End
   * Sessions, or a password reset that ends them) - null when it says none
   * was. Read with the connection's own token, which reads the System Log.
   */
  public async readSessionsClearedAt(data: {
    user: OktaUser;
    since: Date;
    until: Date;
  }): Promise<Date | null> {
    const client: OktaClient = new OktaClient({
      orgUrl: this.baseUrl,
      apiToken: this.apiToken,
      transport: this.transport,
      requestTimeoutInMs: RESPONSE_ACTION_TIMEOUT_IN_MS,
    });
    const page: OktaLogEventsPage = await client.listLogEvents({
      startTime: data.since,
      endTime: data.until,
      limit: OKTA_SESSIONS_CLEARED_PAGE_SIZE,
      filter: `eventType eq "${OKTA_SESSIONS_CLEARED_EVENT}" and target.id eq "${data.user.id.replace(/"/g, "")}"`,
    });
    let latest: Date | null = null;

    for (const event of page.events) {
      const published: Date | null =
        typeof event["published"] === "string"
          ? new Date(event["published"])
          : null;

      if (
        published &&
        !Number.isNaN(published.getTime()) &&
        (!latest || published.getTime() > latest.getTime())
      ) {
        latest = published;
      }
    }

    return latest;
  }

  /*
   * Whether the user has a factor enrolled and active - an authenticator,
   * a security key, a phone (GET /api/v1/users/{id}/factors, status
   * ACTIVE): the Fix step "MFA on the accounts it went after" (#10347).
   */
  public async hasActiveFactor(user: OktaUser): Promise<boolean> {
    return (await this.listFactors(user)).some(
      (factor: OktaUserObject): boolean => {
        return factor.status.toUpperCase() === "ACTIVE";
      },
    );
  }

  /*
   * What the Fix step "Undo what changed on the account" reads back
   * (#10603), each a list the user's own record holds, read without
   * changing anything: its factors, its groups and its admin roles.
   */
  public async listFactors(user: OktaUser): Promise<Array<OktaUserObject>> {
    return await this.readList({
      step: "Okta factors lookup",
      path: `/api/v1/users/${encodeURIComponent(user.id)}/factors`,
      what: "this user's factors",
    });
  }

  public async listGroups(user: OktaUser): Promise<Array<OktaUserObject>> {
    return await this.readList({
      step: "Okta groups lookup",
      path: `/api/v1/users/${encodeURIComponent(user.id)}/groups?limit=${OKTA_LIST_PAGE_SIZE}`,
      what: "this user's groups",
    });
  }

  public async listRoles(user: OktaUser): Promise<Array<OktaUserObject>> {
    return await this.readList({
      step: "Okta admin roles lookup",
      path: `/api/v1/users/${encodeURIComponent(user.id)}/roles`,
      what: "this user's admin roles",
    });
  }

  /*
   * Whether an app is still assigned to the user (GET /api/v1/apps/{app}/
   * users/{user}): Okta answers 404 once the assignment is gone.
   */
  public async isAppAssigned(data: {
    appId: string;
    user: OktaUser;
  }): Promise<boolean> {
    return await this.exists({
      step: "Okta app assignment lookup",
      path: `/api/v1/apps/${encodeURIComponent(data.appId)}/users/${encodeURIComponent(data.user.id)}`,
      what: "this app's assignments",
    });
  }

  /*
   * Whether an API token still works (GET /api/v1/api-tokens/{id}): Okta
   * answers 404 once it is revoked.
   */
  public async hasApiToken(tokenId: string): Promise<boolean> {
    return await this.exists({
      step: "Okta API token lookup",
      path: `/api/v1/api-tokens/${encodeURIComponent(tokenId)}`,
      what: "the org's API tokens",
    });
  }

  // A list the user's record holds, each item's id, status, type and name.
  private async readList(data: {
    step: string;
    path: string;
    what: string;
  }): Promise<Array<OktaUserObject>> {
    const result: ResponseHttpResult = await this.send(
      data.step,
      "GET",
      data.path,
    );

    if (!ResponseHttp.isSuccess(result)) {
      throw this.readFailure(data.step, result, data.what);
    }

    const items: unknown = result.bodyJson;

    return Array.isArray(items) ? items.map(readOktaUserObject) : [];
  }

  // Whether something is there: 404 is no, an answer is yes, the rest a failure.
  private async exists(data: {
    step: string;
    path: string;
    what: string;
  }): Promise<boolean> {
    const result: ResponseHttpResult = await this.send(
      data.step,
      "GET",
      data.path,
    );

    if (result.statusCode === 404) {
      return false;
    }

    if (!ResponseHttp.isSuccess(result)) {
      throw this.readFailure(data.step, result, data.what);
    }

    return true;
  }

  private readFailure(
    step: string,
    result: ResponseHttpResult,
    what: string,
  ): APIException {
    return ResponseHttp.failure({
      step,
      result,
      secrets: [this.apiToken],
      hint:
        result.statusCode === 401 || result.statusCode === 403
          ? `The connection's API token cannot read ${what}: create it as an admin who manages them.`
          : undefined,
    });
  }

  public async suspendUser(user: OktaUser): Promise<OktaContainmentOutcome> {
    if (user.status.toUpperCase() === "SUSPENDED") {
      return OktaContainmentOutcome.AlreadyDone;
    }

    const step: string = "Okta suspend";
    const result: ResponseHttpResult = await this.send(
      step,
      "POST",
      `/api/v1/users/${encodeURIComponent(user.id)}/lifecycle/suspend`,
    );

    if (!ResponseHttp.isSuccess(result)) {
      throw ResponseHttp.failure({
        step,
        result,
        secrets: [this.apiToken],
        hint:
          result.statusCode === 403
            ? "The connection's API token was created by an admin who cannot suspend this user."
            : result.statusCode === 400
              ? `Okta suspends only ACTIVE users; this one is ${user.status || "in another state"}.`
              : undefined,
      });
    }

    return OktaContainmentOutcome.Done;
  }

  public async unsuspendUser(user: OktaUser): Promise<OktaContainmentOutcome> {
    if (user.status.toUpperCase() !== "SUSPENDED") {
      return OktaContainmentOutcome.AlreadyDone;
    }

    const step: string = "Okta unsuspend";
    const result: ResponseHttpResult = await this.send(
      step,
      "POST",
      `/api/v1/users/${encodeURIComponent(user.id)}/lifecycle/unsuspend`,
    );

    if (!ResponseHttp.isSuccess(result)) {
      throw ResponseHttp.failure({
        step,
        result,
        secrets: [this.apiToken],
        hint:
          result.statusCode === 403
            ? "The connection's API token was created by an admin who cannot unsuspend this user."
            : undefined,
      });
    }

    return OktaContainmentOutcome.Done;
  }

  public async endSessions(user: OktaUser): Promise<OktaContainmentOutcome> {
    const step: string = "Okta end sessions";
    const result: ResponseHttpResult = await this.send(
      step,
      "DELETE",
      `/api/v1/users/${encodeURIComponent(user.id)}/sessions?oauthTokens=true`,
    );

    if (!ResponseHttp.isSuccess(result)) {
      throw ResponseHttp.failure({
        step,
        result,
        secrets: [this.apiToken],
        hint:
          result.statusCode === 403
            ? "The connection's API token was created by an admin who cannot manage this user's sessions."
            : undefined,
      });
    }

    return OktaContainmentOutcome.Done;
  }
}
