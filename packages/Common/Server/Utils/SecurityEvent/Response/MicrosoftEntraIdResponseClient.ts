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
 * consent. A Fix step's check also reads an account's password change and
 * sessions ($select=lastPasswordChangeDateTime,
 * signInSessionsValidFromDateTime, User.Read.All) and its MFA methods (GET
 * {graph}/v1.0/users/{id}/authentication/methods,
 * UserAuthenticationMethod.Read.All). Graph refuses to change an administrator's account unless the
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

// What reading an account's authentication methods takes (#10347).
export const ENTRA_ID_AUTHENTICATION_METHODS_PERMISSION: string =
  "UserAuthenticationMethod.Read.All";

/*
 * The authentication methods Microsoft Graph lists that are a second
 * factor (learn.microsoft.com/graph/api/resources/authenticationmethods-
 * overview): an authenticator app, a security key, Windows Hello, a
 * software or hardware OATH token, a phone, a platform credential or a
 * certificate. Not a password, an email address kept for resetting one,
 * or a Temporary Access Pass.
 */
export const ENTRA_ID_MFA_METHOD_TYPES: ReadonlyArray<string> = [
  "#microsoft.graph.microsoftAuthenticatorAuthenticationMethod",
  "#microsoft.graph.fido2AuthenticationMethod",
  "#microsoft.graph.windowsHelloForBusinessAuthenticationMethod",
  "#microsoft.graph.softwareOathAuthenticationMethod",
  "#microsoft.graph.hardwareOathAuthenticationMethod",
  "#microsoft.graph.phoneAuthenticationMethod",
  "#microsoft.graph.platformCredentialAuthenticationMethod",
  "#microsoft.graph.x509CertificateAuthenticationMethod",
];

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

  /*
   * When the account's sessions were last ended: Graph's
   * signInSessionsValidFromDateTime, which revoking them moves to now. What
   * a Response Plan step's check reads back to say a compromised account's
   * sessions were ended after its case opened (#10340). Null when Graph
   * keeps none.
   */
  public async readSessionsValidFrom(user: EntraIdUser): Promise<Date | null> {
    const step: string = "Microsoft Entra ID sign-in sessions lookup";
    const result: ResponseHttpResult = await this.send(
      step,
      "GET",
      `${this.graphHost}/v1.0/users/${encodeURIComponent(user.id)}?$select=signInSessionsValidFromDateTime`,
    );

    if (!ResponseHttp.isSuccess(result)) {
      throw this.failure(step, result, "User.Read.All");
    }

    const value: unknown = (result.bodyJson as JSONObject | undefined)?.[
      "signInSessionsValidFromDateTime"
    ];
    const validFrom: Date | null =
      typeof value === "string" ? new Date(value) : null;

    return validFrom && !Number.isNaN(validFrom.getTime()) ? validFrom : null;
  }

  /*
   * When the account's password last changed (lastPasswordChangeDateTime)
   * and since when its refresh and session tokens are valid
   * (signInSessionsValidFromDateTime, which revoking them moves to now):
   * what the Fix step "reset the password" reads back (#10347). Both need
   * $select; User.Read.All reads them.
   */
  public async readCredentialState(user: EntraIdUser): Promise<{
    passwordChangedAt: Date | null;
    sessionsValidFrom: Date | null;
  }> {
    const step: string = "Microsoft Entra ID password lookup";
    const result: ResponseHttpResult = await this.send(
      step,
      "GET",
      `${this.graphHost}/v1.0/users/${encodeURIComponent(user.id)}?$select=lastPasswordChangeDateTime,signInSessionsValidFromDateTime`,
    );

    if (!ResponseHttp.isSuccess(result)) {
      throw this.failure(step, result, "User.Read.All");
    }

    const body: JSONObject = (result.bodyJson as JSONObject | undefined) || {};

    return {
      passwordChangedAt: MicrosoftEntraIdResponseClient.readTime(
        body["lastPasswordChangeDateTime"],
      ),
      sessionsValidFrom: MicrosoftEntraIdResponseClient.readTime(
        body["signInSessionsValidFromDateTime"],
      ),
    };
  }

  /*
   * The methods the account can do MFA with (GET /users/{id}/
   * authentication/methods, UserAuthenticationMethod.Read.All): the Fix
   * step "MFA on the accounts it went after" (#10347). A password, an email
   * kept for resetting it and a Temporary Access Pass are no second factor.
   */
  public async readMfaMethods(user: EntraIdUser): Promise<Array<string>> {
    const step: string = "Microsoft Entra ID authentication methods lookup";
    const result: ResponseHttpResult = await this.send(
      step,
      "GET",
      `${this.graphHost}/v1.0/users/${encodeURIComponent(user.id)}/authentication/methods`,
    );

    if (!ResponseHttp.isSuccess(result)) {
      throw this.failure(step, result, ENTRA_ID_AUTHENTICATION_METHODS_PERMISSION);
    }

    const methods: unknown = (result.bodyJson as JSONObject | undefined)?.[
      "value"
    ];

    if (!Array.isArray(methods)) {
      return [];
    }

    return methods
      .map((method: unknown): string => {
        return method && typeof method === "object"
          ? String((method as JSONObject)["@odata.type"] || "")
          : "";
      })
      .filter((type: string): boolean => {
        return ENTRA_ID_MFA_METHOD_TYPES.includes(type);
      });
  }

  private static readTime(value: unknown): Date | null {
    const time: Date | null =
      typeof value === "string" && value ? new Date(value) : null;

    return time && !Number.isNaN(time.getTime()) ? time : null;
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
