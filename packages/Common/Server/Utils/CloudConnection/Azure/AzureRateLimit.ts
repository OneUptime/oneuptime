import Dictionary from "../../../../Types/Dictionary";
import RetryAfter from "../../../../Utils/RetryAfter";

/*
 * WHAT AN AZURE ANSWER SAYS OF ITS RATE LIMITS, READ FROM ITS HEADERS.
 *
 * Azure says how long to wait in more than one header, each service in its
 * own, and a throttled answer may carry several:
 *
 *   Retry-After      seconds, or an HTTP date (RFC 9110): Resource
 *                    Manager's throttling, a 503 that will pass
 *   x-ms-ratelimit-microsoft.consumption-retry-after
 *                    what Cost Management's Query API reference says to wait
 *                    out after its 429 TooManyRequests
 *   x-ms-ratelimit-microsoft.costmanagement-qpu-retry-after
 *                    its query processing units, a tenant's ("Manage Azure
 *                    costs with automation": 12 a 10 seconds, 60 a minute,
 *                    600 an hour)
 *   x-ms-ratelimit-microsoft.costmanagement-entity-retry-after
 *   x-ms-ratelimit-microsoft.costmanagement-tenant-retry-after
 *   x-ms-ratelimit-microsoft.costmanagement-client-retry-after
 *   x-ms-ratelimit-microsoft.costmanagement-clienttype-retry-after
 *                    its limits on requests: of one scope (entity), of the
 *                    tenant, and of the client type every caller that names
 *                    none shares
 *
 * Each is a limit of its own, and a request is refused until every one has
 * room: the wait is the longest of them. A wait that is a scope's alone
 * (entity) holds that scope, not the tenant's other ones.
 *
 * And what a quota has left, on any answer:
 *
 *   x-ms-ratelimit-microsoft.costmanagement-qpu-consumed    what the query cost
 *   x-ms-ratelimit-microsoft.costmanagement-qpu-remaining   what each QPU quota has left
 *   x-ms-ratelimit-remaining-microsoft.costmanagement-entity-requests
 *   x-ms-ratelimit-remaining-microsoft.costmanagement-tenant-requests
 *   x-ms-ratelimit-remaining-microsoft.costmanagement-clienttype-requests
 *                    requests left, as "DefaultQuota:15"
 *
 * The values come from the network: anything that is not a number reads as
 * nothing said, and nothing here throws.
 */

// A header named for a wait: x-ms-ratelimit-<anything>-retry-after.
const RATE_LIMIT_RETRY_AFTER_HEADER: RegExp = /^x-ms-ratelimit-.+retry-after$/;
// The wait of one scope alone: Cost Management's entity (a subscription, a billing account).
const SCOPE_RETRY_AFTER_HEADER: RegExp = /-entity-retry-after$/;
// A count a quota header gives: digits, maybe with a fraction.
const QUOTA_NUMBER: RegExp = /^\d+(\.\d+)?$/;
// A wait of nothing: "0".
const NO_WAIT: RegExp = /^0+$/;

export const AZURE_COST_QPU_CONSUMED_HEADER: string =
  "x-ms-ratelimit-microsoft.costmanagement-qpu-consumed";
export const AZURE_COST_QPU_REMAINING_HEADER: string =
  "x-ms-ratelimit-microsoft.costmanagement-qpu-remaining";
export const AZURE_COST_ENTITY_REQUESTS_HEADER: string =
  "x-ms-ratelimit-remaining-microsoft.costmanagement-entity-requests";
export const AZURE_COST_TENANT_REQUESTS_HEADER: string =
  "x-ms-ratelimit-remaining-microsoft.costmanagement-tenant-requests";
export const AZURE_COST_CLIENT_TYPE_REQUESTS_HEADER: string =
  "x-ms-ratelimit-remaining-microsoft.costmanagement-clienttype-requests";

// The most a wait an answer asks for is held to: longer is the caller's to put off.
export const AZURE_RATE_LIMIT_MAX_WAIT_MS: number = 60 * 60 * 1000;

export interface AzureRateLimit {
  /*
   * The longest wait any of the answer's headers asked for, in
   * milliseconds: undefined when none asked.
   */
  retryAfterMs?: number | undefined;
  // That wait was asked by the scope's own limit alone (entity), not the tenant's.
  isScopeOnly?: boolean | undefined;
  // The query processing units the query cost, as Cost Management says.
  qpuConsumed?: number | undefined;
  // The least any of the tenant's QPU quotas has left, as it lists them.
  qpuRemaining?: number | undefined;
  // Requests left: of the scope, of the tenant, of the client type.
  entityRequestsRemaining?: number | undefined;
  tenantRequestsRemaining?: number | undefined;
  clientTypeRequestsRemaining?: number | undefined;
}

/*
 * The least number a quota header lists: "DefaultQuota:15" is 15,
 * "QueryQuota10s:10,QueryQuota1hr:598" is 10, "3" is 3. Undefined for a
 * value with no number in it.
 */
export function readAzureQuotaNumber(value: unknown): number | undefined {
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }

  const numbers: Array<number> = [];

  for (const part of String(value).split(/[,;]/)) {
    const text: string = part.includes(":")
      ? part.slice(part.lastIndexOf(":") + 1)
      : part.includes("=")
        ? part.slice(part.lastIndexOf("=") + 1)
        : part;
    const trimmed: string = text.trim();

    if (QUOTA_NUMBER.test(trimmed)) {
      numbers.push(Number(trimmed));
    }
  }

  return numbers.length > 0 ? Math.min(...numbers) : undefined;
}

// A header's value, whatever the case its name came in.
function readHeader(
  headers: Dictionary<string> | undefined,
  name: string,
): string | undefined {
  if (!headers) {
    return undefined;
  }

  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === name) {
      return headers[key];
    }
  }

  return undefined;
}

/*
 * The wait one header asks for, in milliseconds: Retry-After as RFC 9110
 * writes it, an x-ms-ratelimit one in seconds. "0" asks for none; "none",
 * or anything else that is not a number, is nothing said.
 */
function readWaitMs(
  name: string,
  value: string,
  nowMs: number,
): number | undefined {
  const text: string = value.trim();

  if (NO_WAIT.test(text)) {
    return 0;
  }

  return RetryAfter.parseMs(text, {
    nowMs,
    maxMs: AZURE_RATE_LIMIT_MAX_WAIT_MS,
    // Only Retry-After may be a date; the others are counts of seconds.
    acceptHttpDate: name === "retry-after",
  });
}

export function readAzureRateLimit(
  headers: Dictionary<string> | undefined,
  nowMs: number = Date.now(),
): AzureRateLimit {
  const rateLimit: AzureRateLimit = {};
  let tenantWaitMs: number | undefined = undefined;
  let scopeWaitMs: number | undefined = undefined;

  for (const key of Object.keys(headers || {})) {
    const name: string = key.toLowerCase();

    if (name !== "retry-after" && !RATE_LIMIT_RETRY_AFTER_HEADER.test(name)) {
      continue;
    }

    const waitMs: number | undefined = readWaitMs(
      name,
      String(headers![key] ?? ""),
      nowMs,
    );

    if (waitMs === undefined) {
      continue;
    }

    if (SCOPE_RETRY_AFTER_HEADER.test(name)) {
      scopeWaitMs = Math.max(scopeWaitMs ?? 0, waitMs);
    } else {
      tenantWaitMs = Math.max(tenantWaitMs ?? 0, waitMs);
    }
  }

  const longestMs: number = Math.max(tenantWaitMs ?? 0, scopeWaitMs ?? 0);

  if (longestMs > 0) {
    rateLimit.retryAfterMs = longestMs;

    if (!tenantWaitMs) {
      rateLimit.isScopeOnly = true;
    }
  }

  const consumed: number | undefined = readAzureQuotaNumber(
    readHeader(headers, AZURE_COST_QPU_CONSUMED_HEADER),
  );
  const qpuRemaining: number | undefined = readAzureQuotaNumber(
    readHeader(headers, AZURE_COST_QPU_REMAINING_HEADER),
  );
  const entity: number | undefined = readAzureQuotaNumber(
    readHeader(headers, AZURE_COST_ENTITY_REQUESTS_HEADER),
  );
  const tenant: number | undefined = readAzureQuotaNumber(
    readHeader(headers, AZURE_COST_TENANT_REQUESTS_HEADER),
  );
  const clientType: number | undefined = readAzureQuotaNumber(
    readHeader(headers, AZURE_COST_CLIENT_TYPE_REQUESTS_HEADER),
  );

  if (consumed !== undefined) {
    rateLimit.qpuConsumed = consumed;
  }

  if (qpuRemaining !== undefined) {
    rateLimit.qpuRemaining = qpuRemaining;
  }

  if (entity !== undefined) {
    rateLimit.entityRequestsRemaining = entity;
  }

  if (tenant !== undefined) {
    rateLimit.tenantRequestsRemaining = tenant;
  }

  if (clientType !== undefined) {
    rateLimit.clientTypeRequestsRemaining = clientType;
  }

  return rateLimit;
}
