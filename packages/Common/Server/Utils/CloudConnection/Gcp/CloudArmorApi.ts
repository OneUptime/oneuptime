import { CloudArmorPolicyRef } from "../../../../Types/CloudConnection/CloudArmorBlocklist";
import { JSONObject, JSONValue } from "../../../../Types/JSON";
import GoogleServiceAccountToken from "../../LlmObservability/Connectors/GoogleVertexAI/GoogleServiceAccountToken";
import LlmProviderError from "../../LlmObservability/LlmProviderError";
import LlmProviderHttp, {
  buildQueryString,
  readObject,
  readText,
} from "../../LlmObservability/LlmProviderHttp";
import {
  CLOUD_DEFAULT_SLEEP,
  CloudConnectorTransport,
} from "../CloudConnectorTypes";
import { withCloudRetries } from "../CloudRetry";
import GcpInventoryClient from "./GcpInventory";

/*
 * GOOGLE CLOUD ARMOR, AS THE BLOCKLIST WRITES IT (#10349), signed in as
 * the connection's service account with a token of the cloud-platform
 * scope (its IAM role decides what it may do: the custom role
 * oneuptimeCloudArmorBlocklist).
 *
 *   GET  compute/v1/projects/{p}/global/securityPolicies/{n}   the policy
 *        (.../regions/{r}/securityPolicies/{n} for a regional one)
 *   POST .../securityPolicies/{n}/addRule                       one rule added
 *   POST .../securityPolicies/{n}/patchRule?priority=N          one rule rewritten
 *   POST .../securityPolicies/{n}/removeRule?priority=N         one rule taken out
 *   GET  .../securityPolicies/{n}/getRule?priority=N            one rule, read
 *   POST .../global/operations/{op}/wait                        until a write is done
 *   GET  compute/v1/projects/{p}                                the Cloud Armor tier
 *   GET/POST networksecurity/v1/projects/{p}/locations/{l}/addressGroups[/{g}[:addItems|:removeItems]]
 *   POST cloudresourcemanager/v1/projects/{p}:testIamPermissions
 *
 * The policy itself is never patched: a rule of the customer's is never
 * written. A write is waited for until Google says it is done, so the next
 * write of the same policy never runs into it, and a write Google turned
 * down after it started says why.
 */

const PROVIDER_TITLE: string = "Google Cloud Armor";
export const GCP_CLOUD_PLATFORM_SCOPE: string =
  "https://www.googleapis.com/auth/cloud-platform";
const COMPUTE_BASE_URL: string = "https://compute.googleapis.com/compute/v1";
const NETWORK_SECURITY_BASE_URL: string =
  "https://networksecurity.googleapis.com/v1";
const RESOURCE_MANAGER_BASE_URL: string =
  "https://cloudresourcemanager.googleapis.com/v1";
const COMPUTE_API: string = "compute.googleapis.com";
const NETWORK_SECURITY_API: string = "networksecurity.googleapis.com";
const RESOURCE_MANAGER_API: string = "cloudresourcemanager.googleapis.com";

// How long a write is waited for, and how often a Network Security operation is asked about.
export const CLOUD_ARMOR_OPERATION_WAIT_MS: number = 90 * 1000;
export const CLOUD_ARMOR_OPERATION_POLL_MS: number = 2000;

export interface CloudArmorApiOptions {
  serviceAccountJson: string;
  transport: CloudConnectorTransport;
  requestTimeoutInMs?: number | undefined;
  sleep?: ((milliseconds: number) => Promise<void>) | undefined;
  now?: (() => Date) | undefined;
}

// A write Google accepted, then turned down: its own words.
export class CloudArmorOperationError extends Error {
  public readonly code: string;

  public constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

function statusOf(error: unknown): number | undefined {
  return error instanceof LlmProviderError ? error.statusCode : undefined;
}

// Google's own words for a refusal, out of its error body when there is one.
export function readGoogleError(error: unknown): string {
  if (error instanceof LlmProviderError) {
    try {
      const body: JSONObject = JSON.parse(error.responseBody || "{}");
      const message: JSONValue | undefined = (body["error"] as JSONObject)?.[
        "message"
      ];

      if (typeof message === "string" && message.trim()) {
        return message.trim();
      }
    } catch {
      // Not JSON: the error's own message says it.
    }
  }

  return error instanceof Error && error.message
    ? error.message
    : String(error || "unknown error");
}

export default class CloudArmorApi {
  private readonly options: CloudArmorApiOptions;
  private readonly token: GoogleServiceAccountToken;

  public constructor(options: CloudArmorApiOptions) {
    this.options = options;
    this.token = new GoogleServiceAccountToken({
      serviceAccountJson: options.serviceAccountJson,
      scope: GCP_CLOUD_PLATFORM_SCOPE,
      transport: options.transport,
      providerTitle: PROVIDER_TITLE,
      requestTimeoutInMs: options.requestTimeoutInMs,
    });
  }

  private sleep(milliseconds: number): Promise<void> {
    return (this.options.sleep || CLOUD_DEFAULT_SLEEP)(milliseconds);
  }

  private now(): number {
    return (this.options.now ? this.options.now() : new Date()).getTime();
  }

  // One request, asked again while Google says not now, its failure classified.
  private async request(data: {
    method: "GET" | "POST" | "DELETE";
    url: string;
    body?: JSONObject | undefined;
    step: string;
    api: string;
  }): Promise<JSONObject> {
    return await withCloudRetries({
      sleep: this.options.sleep,
      call: async (): Promise<JSONObject> => {
        const accessToken: string = await this.token.getAccessToken();

        try {
          return await LlmProviderHttp.requestJson({
            transport: this.options.transport,
            method: data.method,
            url: data.url,
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Accept: "application/json",
              ...(data.body ? { "Content-Type": "application/json" } : {}),
            },
            ...(data.body ? { body: JSON.stringify(data.body) } : {}),
            timeoutInMs: this.options.requestTimeoutInMs,
            step: data.step,
            providerTitle: PROVIDER_TITLE,
            secretValues: [accessToken],
          });
        } catch (error) {
          throw GcpInventoryClient.classify(error, data.api);
        }
      },
    });
  }

  private policyUrl(policy: CloudArmorPolicyRef): string {
    return `${COMPUTE_BASE_URL}/${policy.id
      .split("/")
      .map((segment: string): string => {
        return encodeURIComponent(segment);
      })
      .join("/")}`;
  }

  public async getPolicy(policy: CloudArmorPolicyRef): Promise<JSONObject> {
    return await this.request({
      method: "GET",
      url: this.policyUrl(policy),
      step: "security policy request",
      api: COMPUTE_API,
    });
  }

  // One rule, read by its priority; null when no rule has it.
  public async getRule(
    policy: CloudArmorPolicyRef,
    priority: number,
  ): Promise<JSONObject | null> {
    try {
      return await this.request({
        method: "GET",
        url: `${this.policyUrl(policy)}/getRule?${buildQueryString([
          ["priority", String(priority)],
        ])}`,
        step: "security policy rule request",
        api: COMPUTE_API,
      });
    } catch (error) {
      if (statusOf(error) === 404 || statusOf(error) === 400) {
        return null;
      }

      throw error;
    }
  }

  public async addRule(
    policy: CloudArmorPolicyRef,
    rule: JSONObject,
  ): Promise<void> {
    const operation: JSONObject = await this.request({
      method: "POST",
      url: `${this.policyUrl(policy)}/addRule`,
      body: rule,
      step: "security policy rule add",
      api: COMPUTE_API,
    });

    await this.waitForComputeOperation(policy, operation);
  }

  public async patchRule(
    policy: CloudArmorPolicyRef,
    priority: number,
    rule: JSONObject,
  ): Promise<void> {
    const operation: JSONObject = await this.request({
      method: "POST",
      url: `${this.policyUrl(policy)}/patchRule?${buildQueryString([
        ["priority", String(priority)],
      ])}`,
      body: rule,
      step: "security policy rule update",
      api: COMPUTE_API,
    });

    await this.waitForComputeOperation(policy, operation);
  }

  public async removeRule(
    policy: CloudArmorPolicyRef,
    priority: number,
  ): Promise<void> {
    const operation: JSONObject = await this.request({
      method: "POST",
      url: `${this.policyUrl(policy)}/removeRule?${buildQueryString([
        ["priority", String(priority)],
      ])}`,
      step: "security policy rule removal",
      api: COMPUTE_API,
    });

    await this.waitForComputeOperation(policy, operation);
  }

  /*
   * A Compute write, waited for until Google says it is DONE (the wait
   * method answers then, or after two minutes, and is asked again until
   * CLOUD_ARMOR_OPERATION_WAIT_MS). A write done with an error throws it.
   */
  private async waitForComputeOperation(
    policy: CloudArmorPolicyRef,
    operation: JSONObject,
  ): Promise<void> {
    const deadline: number = this.now() + CLOUD_ARMOR_OPERATION_WAIT_MS;
    let current: JSONObject = operation;

    for (;;) {
      this.throwIfFailed(current);

      if (readText(current["status"]) === "DONE" || !readText(current["name"])) {
        return;
      }

      if (this.now() >= deadline) {
        throw new CloudArmorOperationError(
          `Google Cloud has not finished OneUptime's change to ${policy.name} yet. OneUptime reads the policy again on its next check.`,
          "TIMEOUT",
        );
      }

      const place: string = policy.region
        ? `regions/${encodeURIComponent(policy.region)}`
        : "global";

      current = await this.request({
        method: "POST",
        url: `${COMPUTE_BASE_URL}/projects/${encodeURIComponent(policy.project)}/${place}/operations/${encodeURIComponent(readText(current["name"]))}/wait`,
        step: "operation wait",
        api: COMPUTE_API,
      });
    }
  }

  private throwIfFailed(operation: JSONObject): void {
    const errors: Array<JSONValue> = Array.isArray(
      readObject(operation["error"])["errors"],
    )
      ? (readObject(operation["error"])["errors"] as Array<JSONValue>)
      : [];

    if (errors.length > 0) {
      const first: JSONObject = readObject(errors[0]);

      throw new CloudArmorOperationError(
        readText(first["message"]) || readText(first["code"]) || "unknown error",
        readText(first["code"]),
      );
    }
  }

  // The project's Cloud Armor tier: CA_STANDARD when Google names none.
  public async getProjectTier(project: string): Promise<string> {
    const answer: JSONObject = await this.request({
      method: "GET",
      url: `${COMPUTE_BASE_URL}/projects/${encodeURIComponent(project)}?${buildQueryString(
        [["fields", "name,cloudArmorTier"]],
      )}`,
      step: "project request",
      api: COMPUTE_API,
    });

    return readText(answer["cloudArmorTier"]) || "CA_STANDARD";
  }

  private groupUrl(project: string, location: string, name?: string): string {
    return `${NETWORK_SECURITY_BASE_URL}/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(location)}/addressGroups${name ? `/${encodeURIComponent(name)}` : ""}`;
  }

  // An address group, read; null when there is none of that name.
  public async getAddressGroup(data: {
    project: string;
    location: string;
    name: string;
  }): Promise<JSONObject | null> {
    try {
      return await this.request({
        method: "GET",
        url: this.groupUrl(data.project, data.location, data.name),
        step: "address group request",
        api: NETWORK_SECURITY_API,
      });
    } catch (error) {
      if (statusOf(error) === 404) {
        return null;
      }

      throw error;
    }
  }

  public async createAddressGroup(data: {
    project: string;
    location: string;
    name: string;
    type: "IPV4" | "IPV6";
    capacity: number;
    description: string;
  }): Promise<void> {
    const operation: JSONObject = await this.request({
      method: "POST",
      url: `${this.groupUrl(data.project, data.location)}?${buildQueryString([
        ["addressGroupId", data.name],
      ])}`,
      body: {
        type: data.type,
        capacity: data.capacity,
        description: data.description,
        purpose: ["CLOUD_ARMOR"],
        items: [],
      },
      step: "address group creation",
      api: NETWORK_SECURITY_API,
    });

    await this.waitForNetworkSecurityOperation(operation);
  }

  public async changeAddressGroupItems(data: {
    project: string;
    location: string;
    name: string;
    items: Array<string>;
    isAdding: boolean;
  }): Promise<void> {
    if (data.items.length === 0) {
      return;
    }

    const operation: JSONObject = await this.request({
      method: "POST",
      url: `${this.groupUrl(data.project, data.location, data.name)}:${data.isAdding ? "addItems" : "removeItems"}`,
      body: { items: data.items },
      step: data.isAdding ? "address group items add" : "address group items removal",
      api: NETWORK_SECURITY_API,
    });

    await this.waitForNetworkSecurityOperation(operation);
  }

  public async deleteAddressGroup(data: {
    project: string;
    location: string;
    name: string;
  }): Promise<void> {
    try {
      const operation: JSONObject = await this.request({
        method: "DELETE",
        url: this.groupUrl(data.project, data.location, data.name),
        step: "address group deletion",
        api: NETWORK_SECURITY_API,
      });

      await this.waitForNetworkSecurityOperation(operation);
    } catch (error) {
      if (statusOf(error) === 404) {
        return;
      }

      throw error;
    }
  }

  /*
   * A Network Security operation, asked about until it is done or
   * CLOUD_ARMOR_OPERATION_WAIT_MS passed. Done with an error, it throws it.
   */
  private async waitForNetworkSecurityOperation(
    operation: JSONObject,
  ): Promise<void> {
    const deadline: number = this.now() + CLOUD_ARMOR_OPERATION_WAIT_MS;
    let current: JSONObject = operation;

    for (;;) {
      const error: JSONObject = readObject(current["error"]);

      if (Object.keys(error).length > 0) {
        throw new CloudArmorOperationError(
          readText(error["message"]) || "unknown error",
          String(error["code"] ?? ""),
        );
      }

      if (current["done"] === true || !readText(current["name"])) {
        return;
      }

      if (this.now() >= deadline) {
        throw new CloudArmorOperationError(
          "Google Cloud has not finished OneUptime's change to its address group yet. OneUptime reads it again on its next check.",
          "TIMEOUT",
        );
      }

      await this.sleep(CLOUD_ARMOR_OPERATION_POLL_MS);

      current = await this.request({
        method: "GET",
        url: `${NETWORK_SECURITY_BASE_URL}/${readText(current["name"])
          .split("/")
          .map((segment: string): string => {
            return encodeURIComponent(segment);
          })
          .join("/")}`,
        step: "operation request",
        api: NETWORK_SECURITY_API,
      });
    }
  }

  /*
   * Which of the permissions the service account holds on a project, asked
   * without writing anything (testIamPermissions answers the subset held).
   */
  public async testPermissions(data: {
    project: string;
    permissions: Array<string>;
  }): Promise<Set<string>> {
    const answer: JSONObject = await this.request({
      method: "POST",
      url: `${RESOURCE_MANAGER_BASE_URL}/projects/${encodeURIComponent(data.project)}:testIamPermissions`,
      body: { permissions: data.permissions },
      step: "permissions test",
      api: RESOURCE_MANAGER_API,
    });

    return new Set(
      (Array.isArray(answer["permissions"])
        ? (answer["permissions"] as Array<JSONValue>)
        : []
      ).filter((permission: JSONValue): permission is string => {
        return typeof permission === "string";
      }),
    );
  }
}
