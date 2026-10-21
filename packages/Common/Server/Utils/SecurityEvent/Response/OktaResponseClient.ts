import APIException from "../../../../Types/Exception/ApiException";
import { JSONObject } from "../../../../Types/JSON";
import { ConnectorTransport } from "../Connectors/Types";
import OktaClient from "../Connectors/Okta/OktaClient";
import ResponseHttp, { ResponseHttpResult } from "./ResponseHttp";

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

export enum OktaContainmentOutcome {
  Done = "Done",
  AlreadyDone = "AlreadyDone",
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

  // The user signing in as this login (or with this id), or null when Okta has none.
  public async findUser(loginOrId: string): Promise<OktaUser | null> {
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
      id,
      status: typeof body["status"] === "string" ? body["status"] : "",
      login:
        typeof profile["login"] === "string" ? profile["login"] : loginOrId,
    };
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
