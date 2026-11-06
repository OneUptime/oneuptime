import {
  CloudHttpResponse,
  CloudSender,
  isPlainObject,
  parseJsonBody,
  readInteger,
  readString,
} from "./CloudHttp";

/*
 * The Google Cloud AI agent's identity, from the metadata server of where
 * it runs (Cloud Run, a Compute Engine VM, GKE with Workload Identity):
 *
 *   instance/service-accounts/default/token   an OAuth access token of its
 *                                             service account, reused until
 *                                             five minutes before it expires
 *   instance/service-accounts/default/email   that service account
 *   project/project-id, numeric-project-id    the project it runs in
 *   instance/region                           Cloud Run's region
 *
 * Every request carries "Metadata-Flavor: Google", and an answer is only
 * believed when it carries the same header back (what the real metadata
 * server does). Plain http to metadata.google.internal, never through a
 * proxy.
 */

export const GCP_METADATA_BASE_URL: string =
  "http://metadata.google.internal/computeMetadata/v1";

/*
 * Each change's token of the write service account: IAM Credentials'
 * generateAccessToken, asked for with the agent's own token, for the
 * shortest time a change needs - 15 minutes, as AWS's write role session
 * lasts - and for the cloud-platform scope the APIs of the changes take.
 * Never kept: the next change asks for its own.
 */
export const IAM_CREDENTIALS_API: string =
  "https://iamcredentials.googleapis.com/v1";
export const IAM_API: string = "https://iam.googleapis.com/v1";
export const GCP_WRITE_TOKEN_LIFETIME_SECONDS: number = 900;
export const GCP_CLOUD_PLATFORM_SCOPE: string =
  "https://www.googleapis.com/auth/cloud-platform";
// What lets the agent's own account ask for the write account's token.
export const GCP_GET_ACCESS_TOKEN_PERMISSION: string =
  "iam.serviceAccounts.getAccessToken";

export interface GcpWriteToken {
  token: string;
  // When it stops working (ms since the epoch), when Google said.
  expiresAtMs: number | null;
}

export const GCP_TOKEN_REFRESH_MARGIN_MS: number = 5 * 60 * 1000;

const PROJECT_ID_PATTERN: RegExp = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;
const PROJECT_NUMBER_PATTERN: RegExp = /^[0-9]{1,20}$/;
const REGION_PATTERN: RegExp = /^[a-z]+-[a-z]+[0-9]{1,2}$/;

function isHeaderSafe(value: string): boolean {
  for (let index: number = 0; index < value.length; index++) {
    const code: number = value.charCodeAt(index);

    if (code < 0x20 || code === 0x7f) {
      return false;
    }
  }

  return value.length > 0;
}

// The error text of a Google API's error answer, short.
function describeGoogleError(response: CloudHttpResponse): string {
  const json: unknown = parseJsonBody(response);
  const error: unknown = isPlainObject(json) ? json["error"] : null;
  const message: string | null = isPlainObject(error)
    ? readString(error, "message")
    : null;

  return message ? message.slice(0, 300) : `HTTP ${response.status}`;
}

/*
 * A token of the write service account for one change, asked for with the
 * agent's own token. Throws an Error that says what to fix when Google
 * refuses it: the agent's own account may not act as the write account (the
 * setup command grants it Service Account Token Creator on that account
 * alone), or the write account is gone.
 */
export async function generateGcpWriteToken(data: {
  send: CloudSender;
  ownToken: string;
  serviceAccount: string;
  userAgent: string;
}): Promise<GcpWriteToken> {
  let response: CloudHttpResponse;

  try {
    response = await data.send({
      method: "POST",
      url: `${IAM_CREDENTIALS_API}/projects/-/serviceAccounts/${data.serviceAccount}:generateAccessToken`,
      headers: {
        Authorization: `Bearer ${data.ownToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": data.userAgent,
      },
      body: JSON.stringify({
        scope: [GCP_CLOUD_PLATFORM_SCOPE],
        lifetime: `${GCP_WRITE_TOKEN_LIFETIME_SECONDS}s`,
      }),
    });
  } catch (err: unknown) {
    throw new Error(
      `IAM did not answer (${err instanceof Error ? err.message : String(err)})`,
    );
  }

  if (response.status === 403) {
    throw new Error(
      `Google Cloud refused to let the agent's own service account act as ${data.serviceAccount} (HTTP 403: ${describeGoogleError(
        response,
      )}): the setup command grants it Service Account Token Creator (roles/iam.serviceAccountTokenCreator) on that account alone. Run the setup command again.`,
    );
  }

  if (response.status === 404) {
    throw new Error(
      `the write service account ${data.serviceAccount} does not exist (HTTP 404). Run the setup command again, which makes it.`,
    );
  }

  if (response.status !== 200) {
    throw new Error(
      `IAM answered HTTP ${response.status}: ${describeGoogleError(response)}`,
    );
  }

  const json: unknown = parseJsonBody(response);
  const object: Record<string, unknown> | null = isPlainObject(json)
    ? json
    : null;
  const token: string | null = readString(object, "accessToken");

  if (!token || !isHeaderSafe(token)) {
    throw new Error(`IAM answered without a token of ${data.serviceAccount}`);
  }

  const expireTime: string | null = readString(object, "expireTime");
  const expiresAtMs: number = expireTime ? Date.parse(expireTime) : NaN;

  return {
    token,
    expiresAtMs: Number.isFinite(expiresAtMs) ? expiresAtMs : null,
  };
}

/*
 * Whether the agent's own account may ask for a token of the write account,
 * asked of IAM without asking for one (testIamPermissions, which needs no
 * permission of its own): what Test connection says. Never throws.
 */
export async function canActAsGcpServiceAccount(data: {
  send: CloudSender;
  ownToken: string;
  serviceAccount: string;
  userAgent: string;
}): Promise<{ may: boolean; detail: string }> {
  let response: CloudHttpResponse;

  try {
    response = await data.send({
      method: "POST",
      url: `${IAM_API}/projects/-/serviceAccounts/${data.serviceAccount}:testIamPermissions`,
      headers: {
        Authorization: `Bearer ${data.ownToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": data.userAgent,
      },
      body: JSON.stringify({
        permissions: [GCP_GET_ACCESS_TOKEN_PERMISSION],
      }),
    });
  } catch (err: unknown) {
    return {
      may: false,
      detail: `IAM did not answer (${err instanceof Error ? err.message : String(err)})`,
    };
  }

  if (response.status !== 200) {
    return {
      may: false,
      detail: `IAM answered HTTP ${response.status}: ${describeGoogleError(response)}`,
    };
  }

  const json: unknown = parseJsonBody(response);
  const permissions: unknown = isPlainObject(json)
    ? json["permissions"]
    : null;
  const may: boolean =
    Array.isArray(permissions) &&
    permissions.includes(GCP_GET_ACCESS_TOKEN_PERMISSION);

  return {
    may,
    detail: may
      ? `the agent's own account holds ${GCP_GET_ACCESS_TOKEN_PERMISSION} on it`
      : `the agent's own account lacks ${GCP_GET_ACCESS_TOKEN_PERMISSION} on it, which Service Account Token Creator grants`,
  };
}

export class GcpMetadata {
  private cachedToken: { token: string; expiresAtMs: number } | null = null;
  private projectId: string | null = null;
  private projectNumber: string | null = null;
  private email: string | null = null;
  private region: string | null | undefined = undefined;

  public constructor(private readonly nowMs: () => number) {}

  // What is already known, without asking (prepare() is synchronous).
  public getKnownProjectId(): string | null {
    return this.projectId;
  }

  public getKnownProjectNumber(): string | null {
    return this.projectNumber;
  }

  public getKnownEmail(): string | null {
    return this.email;
  }

  private async read(
    send: CloudSender,
    path: string,
  ): Promise<CloudHttpResponse> {
    let response: CloudHttpResponse;

    try {
      response = await send({
        method: "GET",
        url: `${GCP_METADATA_BASE_URL}/${path}`,
        headers: { "Metadata-Flavor": "Google" },
        body: null,
      });
    } catch (err: unknown) {
      throw new Error(
        `the metadata server did not answer ${path} (${
          err instanceof Error ? err.message : String(err)
        }): the agent must run in Google Cloud (Cloud Run, Compute Engine or GKE) with a service account`,
      );
    }

    if ((response.headers["metadata-flavor"] || "") !== "Google") {
      throw new Error(
        `what answered ${path} is not Google's metadata server (no Metadata-Flavor: Google), so the agent does not believe it`,
      );
    }

    if (response.status !== 200) {
      throw new Error(
        `the metadata server answered ${path} with HTTP ${response.status}${
          response.status === 404
            ? ": the agent has no service account attached"
            : ""
        }`,
      );
    }

    return response;
  }

  private async readText(send: CloudSender, path: string): Promise<string> {
    const response: CloudHttpResponse = await this.read(send, path);
    return response.truncated ? "" : response.body.trim();
  }

  public invalidateToken(): void {
    this.cachedToken = null;
  }

  public async token(send: CloudSender): Promise<string> {
    const now: number = this.nowMs();

    if (
      this.cachedToken &&
      this.cachedToken.expiresAtMs - GCP_TOKEN_REFRESH_MARGIN_MS > now
    ) {
      return this.cachedToken.token;
    }

    const response: CloudHttpResponse = await this.read(
      send,
      "instance/service-accounts/default/token",
    );
    const json: unknown = parseJsonBody(response);
    const object: Record<string, unknown> | null = isPlainObject(json)
      ? json
      : null;
    const token: string | null = readString(object, "access_token");

    if (!token || !isHeaderSafe(token)) {
      throw new Error("the metadata server answered without an access token");
    }

    const expiresIn: number | null = readInteger(object, "expires_in");

    this.cachedToken = {
      token,
      expiresAtMs:
        now + (expiresIn !== null && expiresIn > 0 ? expiresIn : 600) * 1000,
    };

    return token;
  }

  public async getProjectId(send: CloudSender): Promise<string> {
    if (this.projectId) {
      return this.projectId;
    }

    const id: string = await this.readText(send, "project/project-id");

    if (!PROJECT_ID_PATTERN.test(id)) {
      throw new Error(
        "the metadata server answered project-id with no project id",
      );
    }

    this.projectId = id;
    return id;
  }

  public async getProjectNumber(send: CloudSender): Promise<string> {
    if (this.projectNumber) {
      return this.projectNumber;
    }

    const number: string = await this.readText(
      send,
      "project/numeric-project-id",
    );

    if (!PROJECT_NUMBER_PATTERN.test(number)) {
      throw new Error(
        "the metadata server answered numeric-project-id with no project number",
      );
    }

    this.projectNumber = number;
    return number;
  }

  public async getServiceAccountEmail(send: CloudSender): Promise<string> {
    if (this.email) {
      return this.email;
    }

    const email: string = await this.readText(
      send,
      "instance/service-accounts/default/email",
    );

    if (!email.includes("@") || email.length > 256) {
      throw new Error("the metadata server answered with no service account");
    }

    this.email = email;
    return email;
  }

  // Cloud Run's region ("projects/123/regions/us-central1" -> "us-central1"), or null.
  public async getRegion(send: CloudSender): Promise<string | null> {
    if (this.region !== undefined) {
      return this.region;
    }

    try {
      const value: string = await this.readText(send, "instance/region");
      const region: string = value.slice(value.lastIndexOf("/") + 1);

      this.region = REGION_PATTERN.test(region) ? region : null;
    } catch {
      // Not Cloud Run (a VM has a zone instead): no region to name.
      this.region = null;
    }

    return this.region;
  }
}
