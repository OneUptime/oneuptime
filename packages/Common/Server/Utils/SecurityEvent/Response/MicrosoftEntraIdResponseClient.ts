import APIException from "../../../../Types/Exception/ApiException";
import { JSONObject } from "../../../../Types/JSON";
import MicrosoftEntraIdClient, {
  MicrosoftEntraIdCloud,
} from "../Connectors/MicrosoftEntraId/MicrosoftEntraIdClient";
import { ConnectorTransport } from "../Connectors/Types";
import { odataQuotedValue } from "./MicrosoftDefenderEndpointClient";
import ResponseHttp, {
  RESPONSE_ACTION_TIMEOUT_IN_MS,
  ResponseHttpResult,
} from "./ResponseHttp";

/*
 * The Microsoft Graph calls a playbook makes to contain an account in
 * Microsoft Entra ID, and to let it back in (learn.microsoft.com/graph/api/
 * user-get, .../api/user-list, .../api/user-update and .../api/
 * user-revokesigninsessions):
 *
 *   POST  {login}/{tenant}/oauth2/v2.0/token        client credentials, {graph}/.default
 *   GET   {graph}/v1.0/users/{id or sign-in name}?$select=id,userPrincipalName,accountEnabled
 *   GET   {graph}/v1.0/users?$filter=mail eq '{value}'   for a value that is a mail address only
 *   PATCH {graph}/v1.0/users/{id}                    { "accountEnabled": false } or true
 *   POST  {graph}/v1.0/users/{id}/revokeSignInSessions
 *
 * The token is the one the Entra ID connection reads its logs with
 * (MicrosoftEntraIdClient.getAccessToken), for the same app registration:
 * finding a user needs User.Read.All (Directory.Read.All covers it),
 * disabling and enabling one User.EnableDisableAccount.All, and signing
 * one out User.RevokeSessions.All - application permissions, with admin
 * consent. Graph refuses to change an administrator's account unless the
 * app also holds the Privileged Authentication Administrator role, and the
 * error says so when Graph answers 403. A user already in the state asked
 * for is reported as such, not as a failure.
 */

export interface EntraIdUser {
  id: string;
  userPrincipalName: string;
  accountEnabled: boolean;
}

export enum EntraIdContainmentOutcome {
  Done = "Done",
  AlreadyDone = "AlreadyDone",
}

const USER_SELECT: string = "id,userPrincipalName,accountEnabled";

export const ENTRA_ID_PRIVILEGED_USER_HINT: string =
  "An administrator's account can be changed only by an app that also holds the Privileged Authentication Administrator role.";

export default class MicrosoftEntraIdResponseClient {
  private tokenClient: MicrosoftEntraIdClient;
  private graphHost: string;
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
    if (!MicrosoftEntraIdClient.isCloud(options.cloud)) {
      throw new APIException(
        `The connection's Microsoft cloud "${options.cloud}" is not one OneUptime knows.`,
      );
    }

    const cloud: MicrosoftEntraIdCloud = options.cloud;

    this.tokenClient = new MicrosoftEntraIdClient({
      tenantId: options.tenantId,
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      cloud,
      transport: options.transport,
      requestTimeoutInMs: RESPONSE_ACTION_TIMEOUT_IN_MS,
    });
    this.graphHost = MicrosoftEntraIdClient.hostsFor(cloud).graphHost;
    this.clientSecret = options.clientSecret;
    this.transport = options.transport;
  }

  private secrets(): Array<string> {
    return [this.clientSecret, this.accessToken || ""];
  }

  private async send(
    step: string,
    method: "GET" | "POST" | "PATCH",
    url: string,
    body?: string,
  ): Promise<ResponseHttpResult> {
    if (!this.accessToken) {
      this.accessToken = await this.tokenClient.getAccessToken("graph");
    }

    return await ResponseHttp.send({
      transport: this.transport,
      request: {
        method,
        url,
        headers: {
          Authorization: `Bearer ${this.accessToken}`,
          Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body,
      },
      step,
      secrets: this.secrets(),
    });
  }

  private static readUser(value: unknown): EntraIdUser | null {
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
      userPrincipalName:
        typeof record["userPrincipalName"] === "string"
          ? record["userPrincipalName"]
          : "",
      // Graph leaves it out only for an account it cannot read the state of: take it as enabled.
      accountEnabled: record["accountEnabled"] !== false,
    };
  }

  private failure(
    step: string,
    result: ResponseHttpResult,
    permission: string,
  ): APIException {
    return ResponseHttp.failure({
      step,
      result,
      secrets: this.secrets(),
      hint:
        result.statusCode === 401 || result.statusCode === 403
          ? `The connection's app registration needs the Microsoft Graph application permission ${permission}, with admin consent. ${ENTRA_ID_PRIVILEGED_USER_HINT}`
          : undefined,
    });
  }

  /*
   * The user signing in as this name (or with this object id), or else the
   * one whose mail address it is; null when Entra ID has neither.
   */
  public async findUser(value: string): Promise<EntraIdUser | null> {
    const step: string = "Microsoft Entra ID user lookup";
    const name: string = value.trim();

    if (!name) {
      return null;
    }

    const byName: ResponseHttpResult = await this.send(
      step,
      "GET",
      `${this.graphHost}/v1.0/users/${encodeURIComponent(name)}?$select=${USER_SELECT}`,
    );

    if (ResponseHttp.isSuccess(byName)) {
      const user: EntraIdUser | null = MicrosoftEntraIdResponseClient.readUser(
        byName.bodyJson,
      );

      if (!user) {
        throw new APIException(`${step} returned a user without an id.`);
      }

      return user;
    }

    // Graph answers 404 for a name it does not know, and 400 for one that is no sign-in name or id.
    if (byName.statusCode !== 404 && byName.statusCode !== 400) {
      throw this.failure(step, byName, "User.Read.All");
    }

    if (!name.includes("@")) {
      return null;
    }

    const params: URLSearchParams = new URLSearchParams();
    params.set("$filter", `mail eq ${odataQuotedValue(name)}`);
    params.set("$select", USER_SELECT);
    params.set("$top", "2");

    const byMail: ResponseHttpResult = await this.send(
      step,
      "GET",
      `${this.graphHost}/v1.0/users?${params.toString()}`,
    );

    if (!ResponseHttp.isSuccess(byMail)) {
      throw this.failure(step, byMail, "User.Read.All");
    }

    const found: unknown = (byMail.bodyJson as JSONObject | undefined)?.[
      "value"
    ];

    if (!Array.isArray(found) || found.length === 0) {
      return null;
    }

    // One mail address is one account; two would mean OneUptime cannot tell which.
    if (found.length > 1) {
      throw new APIException(
        `${step}: more than one account has the mail address ${name}, so none was changed.`,
      );
    }

    return MicrosoftEntraIdResponseClient.readUser(found[0]);
  }

  public async disableUser(
    user: EntraIdUser,
  ): Promise<EntraIdContainmentOutcome> {
    if (!user.accountEnabled) {
      return EntraIdContainmentOutcome.AlreadyDone;
    }

    await this.setAccountEnabled(user, false, "Microsoft Entra ID disable");

    return EntraIdContainmentOutcome.Done;
  }

  public async enableUser(
    user: EntraIdUser,
  ): Promise<EntraIdContainmentOutcome> {
    if (user.accountEnabled) {
      return EntraIdContainmentOutcome.AlreadyDone;
    }

    await this.setAccountEnabled(user, true, "Microsoft Entra ID enable");

    return EntraIdContainmentOutcome.Done;
  }

  private async setAccountEnabled(
    user: EntraIdUser,
    accountEnabled: boolean,
    step: string,
  ): Promise<void> {
    const result: ResponseHttpResult = await this.send(
      step,
      "PATCH",
      `${this.graphHost}/v1.0/users/${encodeURIComponent(user.id)}`,
      JSON.stringify({ accountEnabled }),
    );

    if (!ResponseHttp.isSuccess(result)) {
      throw this.failure(step, result, "User.EnableDisableAccount.All");
    }
  }

  // Revokes every refresh token and session cookie: signed out everywhere.
  public async signOut(user: EntraIdUser): Promise<EntraIdContainmentOutcome> {
    const step: string = "Microsoft Entra ID sign-out";
    const result: ResponseHttpResult = await this.send(
      step,
      "POST",
      `${this.graphHost}/v1.0/users/${encodeURIComponent(user.id)}/revokeSignInSessions`,
      "{}",
    );

    if (!ResponseHttp.isSuccess(result)) {
      throw this.failure(step, result, "User.RevokeSessions.All");
    }

    return EntraIdContainmentOutcome.Done;
  }
}
