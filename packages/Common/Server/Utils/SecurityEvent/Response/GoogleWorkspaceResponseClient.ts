import APIException from "../../../../Types/Exception/ApiException";
import { JSONObject } from "../../../../Types/JSON";
import GoogleWorkspaceClient from "../Connectors/GoogleWorkspace/GoogleWorkspaceClient";
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
 * the state asked for is reported as such, not as a failure.
 */

export const GOOGLE_WORKSPACE_DIRECTORY_USER_SCOPE: string =
  "https://www.googleapis.com/auth/admin.directory.user";

export const GOOGLE_WORKSPACE_DIRECTORY_SECURITY_SCOPE: string =
  "https://www.googleapis.com/auth/admin.directory.user.security";

export const GOOGLE_WORKSPACE_DIRECTORY_USERS_URL: string =
  "https://admin.googleapis.com/admin/directory/v1/users";

export interface GoogleWorkspaceUser {
  id: string;
  primaryEmail: string;
  suspended: boolean;
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
