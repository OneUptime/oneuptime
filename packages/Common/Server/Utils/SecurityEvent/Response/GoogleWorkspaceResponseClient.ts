import APIException from "../../../../Types/Exception/ApiException";
import { JSONObject } from "../../../../Types/JSON";
import GoogleWorkspaceClient, {
  GoogleWorkspaceHttpError,
} from "../Connectors/GoogleWorkspace/GoogleWorkspaceClient";
import { ConnectorTransport } from "../Connectors/Types";
import ResponseHttp, {
  RESPONSE_ACTION_TIMEOUT_IN_MS,
  ResponseHttpResult,
} from "./ResponseHttp";

/*
 * The Admin SDK Directory API calls a playbook makes to contain a Google
 * Workspace account, and to let it back in (developers.google.com/
 * admin-sdk/directory/reference/rest/v1/users/get, .../users/update and
 * .../users/signOut):
 *
 *   POST {token_uri}                                   a jwt-bearer assertion, as the administrator
 *   GET  {directory}/users/{primary email, alias or id}
 *   PUT  {directory}/users/{id}                         { "suspended": true } or false
 *   POST {directory}/users/{id}/signOut                 every browser and device session
 *
 * The service account and the administrator it acts as are the Google
 * Workspace connection's (GoogleWorkspaceClient mints the token). Finding,
 * suspending and unsuspending a user take the scope
 * https://www.googleapis.com/auth/admin.directory.user, signing one out
 * https://www.googleapis.com/auth/admin.directory.user.security: the
 * connection's domain-wide delegation lists them beside the audit scope it
 * reads with, and the administrator must be one who manages the user. A
 * token refused for a scope says which one is missing. A user already in
 * the state asked for is reported as such, not as a failure. The
 * account-changes check (#10603) reads, with the same scopes, whether a
 * user is still an admin and whether an app still has a token of theirs
 * (GET {directory}/users/{id}/tokens/{clientId}).
 *
 * Whether a user is still in a group an attack added them to (#10901) is a
 * group's membership, which the user scopes do not read: it takes one more
 * read-only scope, https://www.googleapis.com/auth/admin.directory.group.
 * member.readonly, and reads one membership, never a group's settings or
 * its other members:
 *
 *   GET  {directory}/groups/{group's address}/members/{user's id}
 *
 * A connection whose delegation was set up before it was asked for keeps
 * working: the token Google refuses for the scope, or a membership it
 * will not show the administrator, is access the connection was not
 * given (GoogleWorkspaceAccessNotGranted), and the change is a person's to
 * confirm.
 */

export const GOOGLE_WORKSPACE_DIRECTORY_USER_SCOPE: string =
  "https://www.googleapis.com/auth/admin.directory.user";

export const GOOGLE_WORKSPACE_DIRECTORY_SECURITY_SCOPE: string =
  "https://www.googleapis.com/auth/admin.directory.user.security";

// Reading one group's member, and nothing else of the group (#10901).
export const GOOGLE_WORKSPACE_DIRECTORY_GROUP_MEMBER_SCOPE: string =
  "https://www.googleapis.com/auth/admin.directory.group.member.readonly";

export const GOOGLE_WORKSPACE_DIRECTORY_USERS_URL: string =
  "https://admin.googleapis.com/admin/directory/v1/users";

export const GOOGLE_WORKSPACE_DIRECTORY_GROUPS_URL: string =
  "https://admin.googleapis.com/admin/directory/v1/groups";

// The token endpoint's word for a scope the client ID has no delegation for.
const SCOPE_REFUSALS: ReadonlyArray<string> = [
  "unauthorized_client",
  "access_denied",
];

/*
 * Google will not let the connection read something: its delegation lacks
 * the scope, or the administrator it acts as may not see it. Not a failure
 * of Google's: the connection was not given this access.
 */
export class GoogleWorkspaceAccessNotGranted extends APIException {
  public readonly scope: string;

  public constructor(data: { scope: string; message: string }) {
    super(data.message);
    this.scope = data.scope;
  }
}

export interface GoogleWorkspaceUser {
  id: string;
  primaryEmail: string;
  suspended: boolean;
  /*
   * Enrolled in 2-Step Verification (isEnrolledIn2Sv, read-only): the Fix
   * step "MFA on the accounts it went after" reads it back (#10347). The
   * Directory API says nothing of when a password last changed, so a Fix
   * step "reset the password" cannot be read back here.
   */
  isEnrolledIn2Sv: boolean;
  /*
   * A super admin (isAdmin), and one who holds any other admin role
   * (isDelegatedAdmin): the account-changes check reads them back for a
   * role an attack gave the account (#10603). The Directory API names no
   * role here, so a delegated admin's other roles cannot be told apart.
   */
  isAdmin: boolean;
  isDelegatedAdmin: boolean;
}

export enum GoogleWorkspaceContainmentOutcome {
  Done = "Done",
  AlreadyDone = "AlreadyDone",
}

export default class GoogleWorkspaceResponseClient {
  private serviceAccountJson: string;
  private adminEmail: string;
  private transport: ConnectorTransport;
  // One token client, and one token, per scope.
  private tokenClients: Map<string, GoogleWorkspaceClient> = new Map();
  private tokens: Array<string> = [];

  public constructor(options: {
    serviceAccountJson: string;
    adminEmail: string;
    transport: ConnectorTransport;
  }) {
    this.serviceAccountJson = options.serviceAccountJson;
    this.adminEmail = options.adminEmail;
    this.transport = options.transport;
  }

  private secrets(): Array<string> {
    return [...this.tokens];
  }

  private async getAccessToken(scope: string): Promise<string> {
    let client: GoogleWorkspaceClient | undefined =
      this.tokenClients.get(scope);

    if (!client) {
      // Reads and checks the key as the connection does; a bad key throws here.
      client = new GoogleWorkspaceClient({
        serviceAccountJson: this.serviceAccountJson,
        adminEmail: this.adminEmail,
        transport: this.transport,
        requestTimeoutInMs: RESPONSE_ACTION_TIMEOUT_IN_MS,
        scope,
      });
      this.tokenClients.set(scope, client);
    }

    const token: string = await client.getAccessToken();

    if (!this.tokens.includes(token)) {
      this.tokens.push(token);
    }

    return token;
  }

  private async send(data: {
    step: string;
    scope: string;
    method: "GET" | "POST" | "PUT";
    url: string;
    body?: string | undefined;
  }): Promise<ResponseHttpResult> {
    const token: string = await this.getAccessToken(data.scope);

    return await ResponseHttp.send({
      transport: this.transport,
      request: {
        method: data.method,
        url: data.url,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(data.body !== undefined
            ? { "Content-Type": "application/json" }
            : {}),
        },
        body: data.body,
      },
      step: data.step,
      secrets: this.secrets(),
    });
  }

  private failure(step: string, result: ResponseHttpResult): APIException {
    return ResponseHttp.failure({
      step,
      result,
      secrets: this.secrets(),
      hint:
        result.statusCode === 401 || result.statusCode === 403
          ? `The administrator ${this.adminEmail} the connection acts as must be one who manages this user.`
          : undefined,
    });
  }

  private static readUser(value: unknown): GoogleWorkspaceUser | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }

    const record: JSONObject = value as JSONObject;
    const id: string = typeof record["id"] === "string" ? record["id"] : "";

    if (!id) {
      return null;
    }

    return {
      id,
      primaryEmail:
        typeof record["primaryEmail"] === "string"
          ? record["primaryEmail"]
          : "",
      suspended: record["suspended"] === true,
      isEnrolledIn2Sv: record["isEnrolledIn2Sv"] === true,
      isAdmin: record["isAdmin"] === true,
      isDelegatedAdmin: record["isDelegatedAdmin"] === true,
    };
  }

  // The user with this primary email, alias or id; null when Workspace has none.
  public async findUser(value: string): Promise<GoogleWorkspaceUser | null> {
    const step: string = "Google Workspace user lookup";
    const userKey: string = value.trim();

    if (!userKey) {
      return null;
    }

    const result: ResponseHttpResult = await this.send({
      step,
      scope: GOOGLE_WORKSPACE_DIRECTORY_USER_SCOPE,
      method: "GET",
      url: `${GOOGLE_WORKSPACE_DIRECTORY_USERS_URL}/${encodeURIComponent(userKey)}?projection=basic`,
    });

    // Google answers 404 for a user it does not know, and 400 for a key that is none.
    if (result.statusCode === 404 || result.statusCode === 400) {
      return null;
    }

    if (!ResponseHttp.isSuccess(result)) {
      throw this.failure(step, result);
    }

    const user: GoogleWorkspaceUser | null =
      GoogleWorkspaceResponseClient.readUser(result.bodyJson);

    if (!user) {
      throw new APIException(`${step} returned a user without an id.`);
    }

    return user;
  }

  public async suspendUser(
    user: GoogleWorkspaceUser,
  ): Promise<GoogleWorkspaceContainmentOutcome> {
    if (user.suspended) {
      return GoogleWorkspaceContainmentOutcome.AlreadyDone;
    }

    await this.setSuspended(user, true, "Google Workspace suspend");

    return GoogleWorkspaceContainmentOutcome.Done;
  }

  public async unsuspendUser(
    user: GoogleWorkspaceUser,
  ): Promise<GoogleWorkspaceContainmentOutcome> {
    if (!user.suspended) {
      return GoogleWorkspaceContainmentOutcome.AlreadyDone;
    }

    await this.setSuspended(user, false, "Google Workspace unsuspend");

    return GoogleWorkspaceContainmentOutcome.Done;
  }

  // Users.update takes what it is sent and leaves the rest as it is.
  private async setSuspended(
    user: GoogleWorkspaceUser,
    suspended: boolean,
    step: string,
  ): Promise<void> {
    const result: ResponseHttpResult = await this.send({
      step,
      scope: GOOGLE_WORKSPACE_DIRECTORY_USER_SCOPE,
      method: "PUT",
      url: `${GOOGLE_WORKSPACE_DIRECTORY_USERS_URL}/${encodeURIComponent(user.id)}`,
      body: JSON.stringify({ suspended }),
    });

    if (!ResponseHttp.isSuccess(result)) {
      throw this.failure(step, result);
    }
  }

  /*
   * Whether an app still has access to the user's data: the OAuth token
   * the user gave it (GET {directory}/users/{id}/tokens/{clientId}, the
   * security scope sign-out takes). Google answers 404 once it is revoked
   * (#10603).
   */
  public async hasToken(data: {
    user: GoogleWorkspaceUser;
    clientId: string;
  }): Promise<boolean> {
    const step: string = "Google Workspace app access lookup";
    const result: ResponseHttpResult = await this.send({
      step,
      scope: GOOGLE_WORKSPACE_DIRECTORY_SECURITY_SCOPE,
      method: "GET",
      url: `${GOOGLE_WORKSPACE_DIRECTORY_USERS_URL}/${encodeURIComponent(data.user.id)}/tokens/${encodeURIComponent(data.clientId)}`,
    });

    if (result.statusCode === 404) {
      return false;
    }

    if (!ResponseHttp.isSuccess(result)) {
      throw this.failure(step, result);
    }

    return true;
  }

  /*
   * Whether the user is still a member of the group, by its address
   * (GET {directory}/groups/{groupKey}/members/{memberKey}): only a member
   * the group names itself, as an attack's ADD_GROUP_MEMBER made one -
   * never one through a group inside it. Google answers 404 once the
   * member is removed, or the group with it (#10901).
   *
   * Throws GoogleWorkspaceAccessNotGranted when the connection may not read
   * groups: its delegation lacks the scope, or the administrator it acts as
   * may not see the group.
   */
  public async isGroupMember(data: {
    groupKey: string;
    memberKey: string;
  }): Promise<boolean> {
    const step: string = "Google Workspace group membership lookup";
    const scope: string = GOOGLE_WORKSPACE_DIRECTORY_GROUP_MEMBER_SCOPE;
    let result: ResponseHttpResult;

    try {
      result = await this.send({
        step,
        scope,
        method: "GET",
        url: `${GOOGLE_WORKSPACE_DIRECTORY_GROUPS_URL}/${encodeURIComponent(data.groupKey.trim())}/members/${encodeURIComponent(data.memberKey.trim())}`,
      });
    } catch (error) {
      if (
        error instanceof GoogleWorkspaceHttpError &&
        SCOPE_REFUSALS.includes(error.reason)
      ) {
        throw new GoogleWorkspaceAccessNotGranted({
          scope,
          message: `Google refused to let the connection read groups: its domain-wide delegation does not have the ${scope} scope.`,
        });
      }

      throw error;
    }

    if (result.statusCode === 404) {
      return false;
    }

    if (result.statusCode === 403) {
      throw new GoogleWorkspaceAccessNotGranted({
        scope,
        message: `Google would not show the administrator ${this.adminEmail} the group's members: the administrator must be one who may read groups.`,
      });
    }

    if (!ResponseHttp.isSuccess(result)) {
      throw this.failure(step, result);
    }

    return true;
  }

  // Signs the user out of every browser and device session.
  public async signOut(
    user: GoogleWorkspaceUser,
  ): Promise<GoogleWorkspaceContainmentOutcome> {
    const step: string = "Google Workspace sign-out";
    const result: ResponseHttpResult = await this.send({
      step,
      scope: GOOGLE_WORKSPACE_DIRECTORY_SECURITY_SCOPE,
      method: "POST",
      url: `${GOOGLE_WORKSPACE_DIRECTORY_USERS_URL}/${encodeURIComponent(user.id)}/signOut`,
      body: "{}",
    });

    if (!ResponseHttp.isSuccess(result)) {
      throw this.failure(step, result);
    }

    return GoogleWorkspaceContainmentOutcome.Done;
  }
}
