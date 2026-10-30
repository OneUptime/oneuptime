import {
  CloudHttpResponse,
  CloudSender,
  isPlainObject,
  isPlatformHost,
  parseJsonBody,
  readString,
  shortenCloudText,
} from "./CloudHttp";

/*
 * The Azure Cloud AI agent's token for Azure Resource Manager, from the
 * managed identity of where it runs:
 *
 *   - Container Apps (and App Service): IDENTITY_ENDPOINT with the secret
 *     IDENTITY_HEADER (sent as X-IDENTITY-HEADER), api-version 2019-08-01;
 *   - anywhere else in Azure (a VM, a scale set): the Instance Metadata
 *     Service, http://169.254.169.254/metadata/identity/oauth2/token,
 *     api-version 2018-02-01, with "Metadata: true".
 *
 * AZURE_CLIENT_ID picks a user-assigned identity (client_id=); without it
 * the system-assigned identity answers. The token is for
 * https://management.azure.com/ and is reused until five minutes before
 * it expires. Neither endpoint is ever reached through a proxy (they are
 * plain http, on loopback or link-local addresses).
 */

export const IDENTITY_ENDPOINT_ENV: string = "IDENTITY_ENDPOINT";
export const IDENTITY_HEADER_ENV: string = "IDENTITY_HEADER";
export const AZURE_CLIENT_ID_ENV: string = "AZURE_CLIENT_ID";

export const AZURE_IDENTITY_API_VERSION: string = "2019-08-01";
export const AZURE_IMDS_API_VERSION: string = "2018-02-01";
export const AZURE_IMDS_TOKEN_URL: string =
  "http://169.254.169.254/metadata/identity/oauth2/token";
export const ARM_TOKEN_RESOURCE: string = "https://management.azure.com/";

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

export class AzureTokenProvider {
  private cached: { token: string; expiresAtMs: number } | null = null;

  public constructor(
    private readonly env: NodeJS.ProcessEnv,
    private readonly nowMs: () => number,
  ) {}

  // The identity the agent signs in as, in words.
  public describeIdentity(): string {
    const clientId: string = readTrimmed(this.env, AZURE_CLIENT_ID_ENV);
    const where: string = readTrimmed(this.env, IDENTITY_ENDPOINT_ENV)
      ? "the Container App's managed identity"
      : "the managed identity of the machine it runs on (IMDS)";

    return clientId
      ? `${where}, user-assigned (client id ${clientId}, ${AZURE_CLIENT_ID_ENV})`
      : `${where}, system-assigned`;
  }

  public invalidate(): void {
    this.cached = null;
  }

  public async get(send: CloudSender): Promise<string> {
    const now: number = this.nowMs();

    if (
      this.cached &&
      this.cached.expiresAtMs - AZURE_TOKEN_REFRESH_MARGIN_MS > now
    ) {
      return this.cached.token;
    }

    const clientId: string = readTrimmed(this.env, AZURE_CLIENT_ID_ENV);

    if (clientId && !CLIENT_ID_PATTERN.test(clientId)) {
      throw new Error(
        `${AZURE_CLIENT_ID_ENV}="${clientId.slice(0, 64)}" is not a client id (a GUID).`,
      );
    }

    const endpoint: string = readTrimmed(this.env, IDENTITY_ENDPOINT_ENV);
    let response: CloudHttpResponse;
    let source: string;

    if (endpoint) {
      const header: string = readTrimmed(this.env, IDENTITY_HEADER_ENV);
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

      source = "the managed identity endpoint";

      try {
        response = await send({
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

      source = "the Azure Instance Metadata Service";

      try {
        response = await send({
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

      throw new Error(
        `${source} answered HTTP ${response.status} and no token${
          reason ? ` (${shortenCloudText(reason)})` : ""
        }. Check that the agent has a managed identity${
          readTrimmed(this.env, AZURE_CLIENT_ID_ENV)
            ? ` and that ${AZURE_CLIENT_ID_ENV} is its client id`
            : ""
        }.`,
      );
    }

    const expiresOn: unknown = object ? object["expires_on"] : undefined;
    const expiresIn: unknown = object ? object["expires_in"] : undefined;
    let expiresAtMs: number = now + 10 * 60 * 1000;

    if (
      (typeof expiresOn === "string" &&
        EPOCH_SECONDS_PATTERN.test(expiresOn)) ||
      typeof expiresOn === "number"
    ) {
      expiresAtMs = Number(expiresOn) * 1000;
    } else if (
      (typeof expiresIn === "string" && SECONDS_PATTERN.test(expiresIn)) ||
      typeof expiresIn === "number"
    ) {
      expiresAtMs = now + Number(expiresIn) * 1000;
    }

    this.cached = { token, expiresAtMs };
    return token;
  }
}
