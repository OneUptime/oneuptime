import {
  OpenStackCollectionError,
  readErrorMessage,
} from "./OpenStackCollectionErrors";
import {
  OpenStackCatalogService,
  parseOpenStackCatalog,
} from "./OpenStackCatalog";
import { OpenStackHttpResponse, OpenStackTransport } from "./OpenStackHttp";
import { JSONObject } from "Common/Types/JSON";
import OpenStackCollectionErrorCode from "Common/Types/OpenStack/OpenStackCollectionError";
import { OpenStackCredential } from "Common/Types/OpenStack/OpenStackProbeCollection";

/*
 * Logging in to Keystone, which is the first thing any read needs and the one call
 * that carries the secret.
 *
 * An application credential is the better of the two kinds: it can be limited to
 * reading, can expire, and is scoped to its project when it is made, so nothing here
 * asks for a scope with one (Keystone refuses a scope beside an application
 * credential). A password names its project.
 *
 * A token's catalog says where every service answers, and it is good for an hour or
 * so. So a token is kept between collections, as the agent's exporter does not: a
 * login every two minutes per region per service is load on Keystone for nothing,
 * and a login is what a Keystone in trouble can least afford.
 */

export interface OpenStackToken {
  id: string;
  // Milliseconds, from the token's own expires_at, or null when it says none.
  expiresAt: number | null;
  catalog: Array<OpenStackCatalogService>;
  projectId: string | null;
  projectName: string | null;
  roleNames: Array<string>;
  hasAccessRules: boolean;
  isUnrestricted: boolean;
}

export function buildKeystoneAuthBody(
  credential: OpenStackCredential,
  options?: { isUnscoped?: boolean | undefined },
): JSONObject {
  if (credential.kind === "applicationCredential") {
    return {
      auth: {
        identity: {
          methods: ["application_credential"],
          application_credential: {
            id: credential.id,
            secret: credential.secret,
          },
        },
      },
    };
  }

  const identity: JSONObject = {
    methods: ["password"],
    password: {
      user: {
        name: credential.username,
        domain: { name: credential.userDomainName },
        password: credential.password,
      },
    },
  };

  if (options?.isUnscoped) {
    return { auth: { identity: identity, scope: "unscoped" } };
  }

  return {
    auth: {
      identity: identity,
      scope: {
        project: {
          name: credential.projectName,
          domain: { name: credential.projectDomainName },
        },
      },
    },
  };
}

// Who this credential is, for sentences: never the secret.
export function describeOpenStackCredential(
  credential: OpenStackCredential,
): string {
  if (credential.kind === "applicationCredential") {
    return `application credential ${credential.id}`;
  }

  return `user ${credential.username} in domain ${credential.userDomainName}, on project ${credential.projectName}`;
}

function headerOf(
  response: OpenStackHttpResponse,
  name: string,
): string | null {
  for (const key of Object.keys(response.headers)) {
    if (key.toLowerCase() === name) {
      const value: string | Array<string> | undefined = response.headers[key];
      const text: string | undefined = Array.isArray(value) ? value[0] : value;
      return text || null;
    }
  }

  return null;
}

function parseExpiresAt(value: unknown): number | null {
  if (typeof value !== "string") {
    return null;
  }

  const time: number = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

// A token's answer, read as what the probe needs of it. Exported for tests.
export function parseKeystoneToken(data: {
  tokenId: string;
  body: JSONObject;
}): OpenStackToken {
  const token: JSONObject = (data.body["token"] as JSONObject) || {};
  const project: JSONObject = (token["project"] as JSONObject) || {};
  const application: JSONObject =
    (token["application_credential"] as JSONObject) || {};

  const roles: Array<JSONObject> = Array.isArray(token["roles"])
    ? (token["roles"] as Array<JSONObject>)
    : [];

  const roleNames: Array<string> = [];

  for (const role of roles) {
    if (role && typeof role["name"] === "string") {
      roleNames.push(role["name"] as string);
    }
  }

  return {
    id: data.tokenId,
    expiresAt: parseExpiresAt(token["expires_at"]),
    catalog: parseOpenStackCatalog(token["catalog"]),
    projectId:
      typeof project["id"] === "string" ? (project["id"] as string) : null,
    projectName:
      typeof project["name"] === "string" ? (project["name"] as string) : null,
    roleNames: roleNames,
    hasAccessRules:
      Array.isArray(application["access_rules"]) &&
      (application["access_rules"] as Array<unknown>).length > 0,
    isUnrestricted: application["restricted"] === false,
  };
}

export const KEYSTONE_LOGIN_TIMEOUT_IN_MS: number = 30_000;

/*
 * One login. Throws what went wrong as OpenStackCollectionError, or the transport's
 * own error (DNS, TCP, TLS), for classifyOpenStackError to put in words.
 */
export async function keystoneLogin(data: {
  authUrl: string;
  credential: OpenStackCredential;
  transport: OpenStackTransport;
  userAgent: string;
  timeoutInMs?: number | undefined;
  isUnscoped?: boolean | undefined;
}): Promise<OpenStackToken> {
  const response: OpenStackHttpResponse = await data.transport({
    method: "POST",
    url: `${data.authUrl}/v3/auth/tokens`,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": data.userAgent,
    },
    body: JSON.stringify(
      buildKeystoneAuthBody(data.credential, {
        isUnscoped: data.isUnscoped,
      }),
    ),
    timeoutInMs: data.timeoutInMs ?? KEYSTONE_LOGIN_TIMEOUT_IN_MS,
  });

  const where: string = new globalThis.URL(data.authUrl).host;
  const who: string = describeOpenStackCredential(data.credential);

  if (response.status === 401) {
    throw new OpenStackCollectionError(
      OpenStackCollectionErrorCode.InvalidCredential,
      `Keystone at ${where} refused the ${who}: it is wrong, it has expired or been deleted, or its account lost its role on the project.`,
    );
  }

  if (response.status === 403) {
    throw new OpenStackCollectionError(
      data.credential.kind === "password"
        ? OpenStackCollectionErrorCode.WrongProjectScope
        : OpenStackCollectionErrorCode.InvalidCredential,
      `Keystone at ${where} would not give the ${who} a token: ${
        readErrorMessage(response.body) || "HTTP 403"
      }`,
    );
  }

  if (response.status === 429 || response.status >= 500) {
    throw new OpenStackCollectionError(
      OpenStackCollectionErrorCode.KeystoneFailing,
      `Keystone at ${where} answered the login with HTTP ${response.status}${
        readErrorMessage(response.body)
          ? `: ${readErrorMessage(response.body)}`
          : "."
      }`,
    );
  }

  if (response.status !== 200 && response.status !== 201) {
    throw new OpenStackCollectionError(
      OpenStackCollectionErrorCode.NotKeystone,
      `${data.authUrl} is not Keystone: it answered a login with HTTP ${response.status}. Enter the auth_url from your clouds.yaml or openrc file.`,
    );
  }

  const tokenId: string | null = headerOf(response, "x-subject-token");

  let body: JSONObject | null = null;

  try {
    const parsed: unknown = JSON.parse(response.body);

    if (parsed && typeof parsed === "object") {
      body = parsed as JSONObject;
    }
  } catch {
    body = null;
  }

  if (!tokenId || !body || !body["token"]) {
    throw new OpenStackCollectionError(
      OpenStackCollectionErrorCode.NotKeystone,
      `${data.authUrl} is not Keystone: it answered a login without a token. Enter the auth_url from your clouds.yaml or openrc file.`,
    );
  }

  return parseKeystoneToken({ tokenId: tokenId, body: body });
}

/*
 * Why a password login was refused, which Keystone's own 401 does not say. It is the
 * one thing a person cannot tell apart by looking: a wrong password, or a right one
 * on a project the account has no role on. An unscoped login tells them apart. Only
 * the connection test asks, with a person waiting, and never a collection, because
 * every wrong try counts towards an account lockout.
 */
export async function diagnosePasswordScope(data: {
  authUrl: string;
  credential: OpenStackCredential;
  transport: OpenStackTransport;
  userAgent: string;
}): Promise<OpenStackCollectionError | null> {
  if (data.credential.kind !== "password") {
    return null;
  }

  try {
    await keystoneLogin({ ...data, isUnscoped: true });
  } catch {
    return null;
  }

  return new OpenStackCollectionError(
    OpenStackCollectionErrorCode.WrongProjectScope,
    `Keystone accepted user ${data.credential.username}, but not on project ${data.credential.projectName} in domain ${data.credential.projectDomainName}: the project does not exist there, or the user has no role on it.`,
  );
}

/*
 * Ends a connection test's token. Best effort: a credential limited by access rules
 * may not be allowed to, and an unused token only waits to expire.
 */
export async function revokeKeystoneToken(data: {
  authUrl: string;
  tokenId: string;
  transport: OpenStackTransport;
  userAgent: string;
}): Promise<void> {
  try {
    await data.transport({
      method: "DELETE",
      url: `${data.authUrl}/v3/auth/tokens`,
      headers: {
        "X-Auth-Token": data.tokenId,
        "X-Subject-Token": data.tokenId,
        "User-Agent": data.userAgent,
      },
      timeoutInMs: 10_000,
    });
  } catch {
    // It expires on its own.
  }
}

/*
 * One collection's hold on a token.
 *
 * A 401 from a service means one of two things: the token is no longer good, or
 * access rules do not list this path, which reads exactly the same. So a kept token
 * that meets a 401 logs in again once, and asks again. If the new token gets a 401
 * too, it was the path, and the session remembers that, so the next collection does
 * not log in again just to be told the same. A new token is never renewed: that would
 * be a login per refused read.
 */
export class OpenStackKeystoneSession {
  private token: OpenStackToken;
  private isFresh: boolean;
  private readonly login: () => Promise<OpenStackToken>;
  private readonly refusedReads: Set<string>;
  private renewal: Promise<void> | null = null;
  private renewalFailure: unknown = null;

  public constructor(data: {
    token: OpenStackToken;
    isFresh: boolean;
    login: () => Promise<OpenStackToken>;
    refusedReads?: Set<string> | undefined;
  }) {
    this.token = data.token;
    this.isFresh = data.isFresh;
    this.login = data.login;
    this.refusedReads = data.refusedReads || new Set();
  }

  public getToken(): OpenStackToken {
    return this.token;
  }

  public getRefusedReads(): Set<string> {
    return this.refusedReads;
  }

  public isKnownRefused(read: string): boolean {
    return this.refusedReads.has(read);
  }

  public markRefused(read: string): void {
    this.refusedReads.add(read);
  }

  // What stopped this collection's one login again, if one did.
  public getRenewalFailure(): unknown {
    return this.renewalFailure;
  }

  /*
   * After a 401 on `usedTokenId`: whether a newer token is now in place to try with.
   * A login that fails throws, because then it is Keystone that is the problem. It
   * happens at most once a collection, however many services meet a 401 and whatever
   * it answers: the next one to ask is told the same.
   */
  public async renew(usedTokenId: string): Promise<boolean> {
    if (this.token.id !== usedTokenId) {
      return true;
    }

    if (this.isFresh) {
      return false;
    }

    if (!this.renewal) {
      this.renewal = this.login().then(
        (token: OpenStackToken): void => {
          this.token = token;
          this.isFresh = true;
        },
        (error: unknown): void => {
          this.renewalFailure = error;
          throw error;
        },
      );
    }

    await this.renewal;

    return true;
  }
}
