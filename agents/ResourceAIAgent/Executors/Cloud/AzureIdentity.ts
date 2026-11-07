import {
  CloudHttpResponse,
  CloudSender,
  isPlainObject,
  isPlatformHost,
  parseJsonBody,
  readString,
  shortenCloudText,
} from "./CloudHttp";
import { AzureWriteIdentity } from "./CloudSettings";

/*
 * The Azure Cloud AI agent's tokens for Azure Resource Manager, from the
 * managed identities of where it runs:
 *
 *   - Container Apps (and App Service): IDENTITY_ENDPOINT with the secret
 *     IDENTITY_HEADER (sent as X-IDENTITY-HEADER), api-version 2019-08-01;
 *   - anywhere else in Azure (a VM, a scale set): the Instance Metadata
 *     Service, http://169.254.169.254/metadata/identity/oauth2/token,
 *     api-version 2018-02-01, with "Metadata: true".
 *
 * The agent's own identity - what it reads with: AZURE_CLIENT_ID picks a
 * user-assigned one (client_id=); without it the system-assigned identity
 * answers. Its token is reused until five minutes before it expires.
 *
 * The write identity - what a change runs as, when the agent has one
 * (ONEUPTIME_AI_AZURE_WRITE_IDENTITY): a user-assigned identity attached
 * to the same place, asked for by its resource ID (mi_res_id= on the
 * identity endpoint, msi_res_id= on IMDS), once for each change and never
 * kept. Azure hands a managed identity's token only to code running where
 * the identity is attached, and never one narrower or shorter-lived than
 * its roles, so where the write identity is attached is the boundary.
 *
 * Every token is for https://management.azure.com/. Neither endpoint is
 * ever reached through a proxy (they are plain http, on loopback or
 * link-local addresses).
 */

export const IDENTITY_ENDPOINT_ENV: string = "IDENTITY_ENDPOINT";
export const IDENTITY_HEADER_ENV: string = "IDENTITY_HEADER";
export const AZURE_CLIENT_ID_ENV: string = "AZURE_CLIENT_ID";

export const AZURE_IDENTITY_API_VERSION: string = "2019-08-01";
export const AZURE_IMDS_API_VERSION: string = "2018-02-01";
export const AZURE_IMDS_TOKEN_URL: string =
  "http://169.254.169.254/metadata/identity/oauth2/token";
export const ARM_TOKEN_RESOURCE: string = "https://management.azure.com/";

/*
 * How each endpoint is told which user-assigned identity, by its resource
 * ID: the Container Apps (and App Service) identity endpoint reads
 * mi_res_id, the Instance Metadata Service msi_res_id.
 */
export const IDENTITY_ENDPOINT_RESOURCE_ID_PARAMETER: string = "mi_res_id";
export const IMDS_RESOURCE_ID_PARAMETER: string = "msi_res_id";

export const AZURE_TOKEN_REFRESH_MARGIN_MS: number = 5 * 60 * 1000;

const CLIENT_ID_PATTERN: RegExp =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// expires_on (seconds since the epoch) and expires_in (seconds), as the endpoints write them.
const EPOCH_SECONDS_PATTERN: RegExp = /^[0-9]{9,12}$/;
const SECONDS_PATTERN: RegExp = /^[0-9]{1,7}$/;

function readTrimmed(env: NodeJS.ProcessEnv, name: string): string {
  const value: unknown = env[name];
  return typeof value === "string" ? value.trim() : "";
}

function isHeaderSafe(value: string): boolean {
  for (let index: number = 0; index < value.length; index++) {
    const code: number = value.charCodeAt(index);

    if (code < 0x20 || code === 0x7f) {
      return false;
    }
  }

  return value.length > 0;
}

/*
 * The object id a token names - its oid claim - lowercased: what the
 * Activity Log names as the caller of every change made with it. Read from
 * the token and never verified: nothing trusts it beyond naming the
 * agent's own changes. Null when its payload holds no object id.
 */
export function readAzureTokenObjectId(
  token: string | undefined,
): string | null {
  const payload: string | undefined = token ? token.split(".")[1] : "";

  if (!payload) {
    return null;
  }

  try {
    const claims: unknown = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );
    const oid: unknown = isPlainObject(claims) ? claims["oid"] : undefined;

    return typeof oid === "string" && CLIENT_ID_PATTERN.test(oid)
      ? oid.toLowerCase()
      : null;
  } catch {
    return null;
  }
}

// Which managed identity a token is asked for.
type AzureIdentityChoice =
  | { kind: "own"; clientId: string }
  | { kind: "write"; identity: AzureWriteIdentity };

// A managed identity's token, as an endpoint handed it out.
export interface AzureManagedIdentityToken {
  token: string;
  expiresAtMs: number;
  // The identity's object id (its oid claim), or null when it names none.
  principalId: string | null;
}

/*
 * One token of one managed identity, from the identity endpoint of where
 * the agent runs (or IMDS). Throws an Error that says what to check.
 */
async function requestManagedIdentityToken(data: {
  send: CloudSender;
  env: NodeJS.ProcessEnv;
  now: number;
  choice: AzureIdentityChoice;
}): Promise<AzureManagedIdentityToken> {
  const choice: AzureIdentityChoice = data.choice;
  const clientId: string = choice.kind === "own" ? choice.clientId : "";

  if (clientId && !CLIENT_ID_PATTERN.test(clientId)) {
    throw new Error(
      `${AZURE_CLIENT_ID_ENV}="${clientId.slice(0, 64)}" is not a client id (a GUID).`,
    );
  }

  const endpoint: string = readTrimmed(data.env, IDENTITY_ENDPOINT_ENV);
  let response: CloudHttpResponse;
  let source: string;

  if (endpoint) {
    const header: string = readTrimmed(data.env, IDENTITY_HEADER_ENV);
    let url: URL;

    try {
      url = new URL(endpoint);
    } catch {
      throw new Error(`${IDENTITY_ENDPOINT_ENV} is not a URL.`);
    }

    if (
      url.username ||
      url.password ||
      !(
        url.protocol === "https:" ||
        (url.protocol === "http:" && isPlatformHost(url.hostname))
      )
    ) {
      throw new Error(
        `${IDENTITY_ENDPOINT_ENV} must be the platform's identity endpoint (http:// on a loopback address, or https://).`,
      );
    }

    if (!header || !isHeaderSafe(header)) {
      throw new Error(
        `${IDENTITY_ENDPOINT_ENV} is set but ${IDENTITY_HEADER_ENV} is not: the managed identity endpoint needs both (the platform sets them).`,
      );
    }

    url.searchParams.set("api-version", AZURE_IDENTITY_API_VERSION);
    url.searchParams.set("resource", ARM_TOKEN_RESOURCE);

    if (clientId) {
      url.searchParams.set("client_id", clientId);
    }

    if (choice.kind === "write") {
      url.searchParams.set(
        IDENTITY_ENDPOINT_RESOURCE_ID_PARAMETER,
        choice.identity.resourceId,
      );
    }

    source = "the managed identity endpoint";

    try {
      response = await data.send({
        method: "GET",
        url: url.toString(),
        headers: { "X-IDENTITY-HEADER": header, Accept: "application/json" },
        body: null,
      });
    } catch (err: unknown) {
      throw new Error(
        `${source} did not answer: ${err instanceof Error ? err.message : String(err)}.`,
      );
    }
  } else {
    const url: URL = new URL(AZURE_IMDS_TOKEN_URL);

    url.searchParams.set("api-version", AZURE_IMDS_API_VERSION);
    url.searchParams.set("resource", ARM_TOKEN_RESOURCE);

    if (clientId) {
      url.searchParams.set("client_id", clientId);
    }

    if (choice.kind === "write") {
      url.searchParams.set(
        IMDS_RESOURCE_ID_PARAMETER,
        choice.identity.resourceId,
      );
    }

    source = "the Azure Instance Metadata Service";

    try {
      response = await data.send({
        method: "GET",
        url: url.toString(),
        headers: { Metadata: "true", Accept: "application/json" },
        body: null,
      });
    } catch (err: unknown) {
      throw new Error(
        `${source} did not answer (${err instanceof Error ? err.message : String(err)}): the agent must run in Azure with a managed identity (a Container App sets ${IDENTITY_ENDPOINT_ENV} and ${IDENTITY_HEADER_ENV}).`,
      );
    }
  }

  const json: unknown = parseJsonBody(response);
  const object: Record<string, unknown> | null = isPlainObject(json)
    ? json
    : null;
  const token: string | null = readString(object, "access_token");

  if (response.status !== 200 || !token || !isHeaderSafe(token)) {
    const reason: string =
      readString(object, "error_description") ||
      readString(object, "message") ||
      readString(object, "error") ||
      "";
    const said: string = reason ? ` (${shortenCloudText(reason)})` : "";

    if (choice.kind === "write") {
      throw new Error(
        `${source} answered HTTP ${response.status} and no token of the write identity ${choice.identity.name}${said}. Attach that identity where the agent runs - the setup command attaches it to the agent's Container App - or run the setup command again, which makes it.`,
      );
    }

    throw new Error(
      `${source} answered HTTP ${response.status} and no token${said}. Check that the agent has a managed identity${
        clientId ? ` and that ${AZURE_CLIENT_ID_ENV} is its client id` : ""
      }.`,
    );
  }

  const expiresOn: unknown = object ? object["expires_on"] : undefined;
  const expiresIn: unknown = object ? object["expires_in"] : undefined;
  let expiresAtMs: number = data.now + 10 * 60 * 1000;

  if (
    (typeof expiresOn === "string" && EPOCH_SECONDS_PATTERN.test(expiresOn)) ||
    typeof expiresOn === "number"
  ) {
    expiresAtMs = Number(expiresOn) * 1000;
  } else if (
    (typeof expiresIn === "string" && SECONDS_PATTERN.test(expiresIn)) ||
    typeof expiresIn === "number"
  ) {
    expiresAtMs = data.now + Number(expiresIn) * 1000;
  }

  return { token, expiresAtMs, principalId: readAzureTokenObjectId(token) };
}

/*
 * A token of the write identity for one change, asked for by the
 * identity's resource ID and never kept: the next change asks again. Azure
 * may hand back the same token (its managed identity service keeps one
 * for about a day), which the agent still holds only for the change.
 */
export function requestAzureWriteToken(data: {
  send: CloudSender;
  env: NodeJS.ProcessEnv;
  now: number;
  identity: AzureWriteIdentity;
}): Promise<AzureManagedIdentityToken> {
  return requestManagedIdentityToken({
    send: data.send,
    env: data.env,
    now: data.now,
    choice: { kind: "write", identity: data.identity },
  });
}

// The agent's own identity's token, kept until five minutes before it expires.
export class AzureTokenProvider {
  private cached: { token: string; expiresAtMs: number } | null = null;

  public constructor(
    private readonly env: NodeJS.ProcessEnv,
    private readonly nowMs: () => number,
  ) {}

  // The identity the agent signs in as, in words.
  public describeIdentity(): string {
    const clientId: string = readTrimmed(this.env, AZURE_CLIENT_ID_ENV);

    return clientId
      ? `${this.describePlace()}, user-assigned (client id ${clientId}, ${AZURE_CLIENT_ID_ENV})`
      : `${this.describePlace()}, system-assigned`;
  }

  // Where the agent's managed identities come from, in words.
  public describePlace(): string {
    return readTrimmed(this.env, IDENTITY_ENDPOINT_ENV)
      ? "the Container App's managed identity"
      : "the managed identity of the machine it runs on (IMDS)";
  }

  public invalidate(): void {
    this.cached = null;
  }

  /*
   * The object id of the identity the agent signs in as - its token's oid
   * claim - lowercased: what the Activity Log names as the caller of every
   * change the agent's own identity makes, so OneUptime marks those changes
   * as OneUptime AI's (the posture reports it). Null before a token was
   * read, or when its payload holds no object id.
   */
  public principalId(): string | null {
    return readAzureTokenObjectId(this.cached?.token);
  }

  public async get(send: CloudSender): Promise<string> {
    const now: number = this.nowMs();

    if (
      this.cached &&
      this.cached.expiresAtMs - AZURE_TOKEN_REFRESH_MARGIN_MS > now
    ) {
      return this.cached.token;
    }

    const answer: AzureManagedIdentityToken = await requestManagedIdentityToken(
      {
        send,
        env: this.env,
        now,
        choice: {
          kind: "own",
          clientId: readTrimmed(this.env, AZURE_CLIENT_ID_ENV),
        },
      },
    );

    this.cached = { token: answer.token, expiresAtMs: answer.expiresAtMs };
    return answer.token;
  }
}
