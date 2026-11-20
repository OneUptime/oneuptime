import {
  AZURE_RATE_LIMIT_MAX_WAIT_MS,
  AzureRateLimit,
  readAzureQuotaNumber,
  readAzureRateLimit,
} from "../../../../Server/Utils/CloudConnection/Azure/AzureRateLimit";
import Dictionary from "../../../../Types/Dictionary";
import { describe, expect, test } from "@jest/globals";

/*
 * What an Azure answer says of its rate limits, read from its headers, as
 * Azure sends them: Cost Management's 429s with each of its retry-after
 * headers (QPU, entity, tenant, client, client type, and the consumption
 * one its Query API reference names), Resource Manager's Retry-After in
 * seconds or as a date, and the quotas left on an answer.
 */

const NOW_MS: number = Date.parse("2026-11-20T12:00:00.000Z");

// A Cost Management 429 past the QPU quota, as Azure answers it.
const QPU_THROTTLE: Dictionary<string> = {
  "x-ms-ratelimit-microsoft.costmanagement-qpu-retry-after": "10",
  "x-ms-ratelimit-microsoft.costmanagement-qpu-consumed": "0",
  "x-ms-ratelimit-microsoft.costmanagement-qpu-remaining":
    "QueryQuota10s:0,QueryQuota1min:48,QueryQuota1hour:588",
  "x-ms-request-id": "4b8f6c1e-1f2d-4a3b-9c8d-7e6f5a4b3c2d",
};

/*
 * A scope's own request limit spent, the headers exactly as a 429 carried
 * them (ZBX-24271): only the scope waits; the tenant and the client type
 * ask for nothing.
 */
const ENTITY_THROTTLE: Dictionary<string> = {
  "x-ms-ratelimit-microsoft.costmanagement-entity-retry-after": "37",
  "x-ms-ratelimit-remaining-microsoft.costmanagement-entity-requests":
    "DefaultQuota:0",
  "x-ms-ratelimit-remaining-microsoft.costmanagement-tenant-requests":
    "DefaultQuota:15",
  "x-ms-ratelimit-microsoft.costmanagement-clienttype-retry-after": "0",
  "x-ms-ratelimit-remaining-microsoft.costmanagement-clienttype-requests":
    "DefaultQuota:0",
};

describe("how long a throttled answer asks to wait", () => {
  test("Cost Management's QPU quota: its own retry-after, the tenant's", () => {
    const rateLimit: AzureRateLimit = readAzureRateLimit(QPU_THROTTLE, NOW_MS);

    expect(rateLimit.retryAfterMs).toBe(10_000);
    expect(rateLimit.isScopeOnly).toBeUndefined();
    expect(rateLimit.qpuConsumed).toBe(0);
    // The least any of the listed quotas has left.
    expect(rateLimit.qpuRemaining).toBe(0);
  });

  test("a scope's own limit: 37 seconds, for that scope alone", () => {
    const rateLimit: AzureRateLimit = readAzureRateLimit(
      ENTITY_THROTTLE,
      NOW_MS,
    );

    expect(rateLimit.retryAfterMs).toBe(37_000);
    expect(rateLimit.isScopeOnly).toBe(true);
    expect(rateLimit.entityRequestsRemaining).toBe(0);
    expect(rateLimit.tenantRequestsRemaining).toBe(15);
    expect(rateLimit.clientTypeRequestsRemaining).toBe(0);
  });

  test.each([
    ["x-ms-ratelimit-microsoft.costmanagement-tenant-retry-after", "25", 25_000],
    ["x-ms-ratelimit-microsoft.costmanagement-client-retry-after", "12", 12_000],
    [
      "x-ms-ratelimit-microsoft.costmanagement-clienttype-retry-after",
      "40",
      40_000,
    ],
    ["x-ms-ratelimit-microsoft.consumption-retry-after", "30", 30_000],
    ["retry-after", "60", 60_000],
  ])("%s: %s seconds, held by the tenant", (name, value, waitMs) => {
    const rateLimit: AzureRateLimit = readAzureRateLimit(
      { [name]: value },
      NOW_MS,
    );

    expect(rateLimit.retryAfterMs).toBe(waitMs);
    expect(rateLimit.isScopeOnly).toBeUndefined();
  });

  test("the longest of several: every limit must have room", () => {
    const rateLimit: AzureRateLimit = readAzureRateLimit(
      {
        "retry-after": "5",
        "x-ms-ratelimit-microsoft.costmanagement-qpu-retry-after": "10",
        "x-ms-ratelimit-microsoft.costmanagement-entity-retry-after": "48",
        "x-ms-ratelimit-microsoft.costmanagement-tenant-retry-after": "20",
      },
      NOW_MS,
    );

    // The scope's 48 is the longest; the tenant waits too, so it is not the scope's alone.
    expect(rateLimit.retryAfterMs).toBe(48_000);
    expect(rateLimit.isScopeOnly).toBeUndefined();
  });

  test("Retry-After as an HTTP date: until then", () => {
    expect(
      readAzureRateLimit(
        { "Retry-After": "Fri, 20 Nov 2026 12:01:30 GMT" },
        NOW_MS,
      ).retryAfterMs,
    ).toBe(90_000);
  });

  test("an x-ms-ratelimit header is a count of seconds, never a date", () => {
    expect(
      readAzureRateLimit(
        {
          "x-ms-ratelimit-microsoft.costmanagement-qpu-retry-after":
            "Fri, 20 Nov 2026 12:01:30 GMT",
        },
        NOW_MS,
      ).retryAfterMs,
    ).toBeUndefined();
  });

  test("names in any case are read", () => {
    expect(
      readAzureRateLimit(
        {
          "X-Ms-RateLimit-Microsoft.CostManagement-QPU-Retry-After": "9",
        },
        NOW_MS,
      ).retryAfterMs,
    ).toBe(9_000);
  });

  test.each([
    ["none"],
    ["soon"],
    ["-5"],
    ["1.5"],
    [""],
  ])("%p is nothing said", (value: string) => {
    expect(
      readAzureRateLimit(
        {
          "x-ms-ratelimit-microsoft.costmanagement-entity-retry-after": value,
        },
        NOW_MS,
      ).retryAfterMs,
    ).toBeUndefined();
  });

  test("0 asks for no wait, and alone asks for none at all", () => {
    expect(
      readAzureRateLimit(
        { "x-ms-ratelimit-microsoft.costmanagement-clienttype-retry-after": "0" },
        NOW_MS,
      ).retryAfterMs,
    ).toBeUndefined();
  });

  test("a wait past an hour is held to an hour", () => {
    expect(
      readAzureRateLimit(
        {
          "x-ms-ratelimit-microsoft.costmanagement-qpu-retry-after": "999999",
        },
        NOW_MS,
      ).retryAfterMs,
    ).toBe(AZURE_RATE_LIMIT_MAX_WAIT_MS);
  });

  test("no headers, or none of these, say nothing", () => {
    expect(readAzureRateLimit(undefined, NOW_MS)).toEqual({});
    expect(
      readAzureRateLimit(
        { "content-type": "application/json", "x-ms-request-id": "1" },
        NOW_MS,
      ),
    ).toEqual({});
  });
});

describe("what a quota has left, on any answer", () => {
  test("a query's cost and what is left, as an answer carries them", () => {
    expect(
      readAzureRateLimit(
        {
          "x-ms-ratelimit-microsoft.costmanagement-qpu-consumed": "3",
          "x-ms-ratelimit-microsoft.costmanagement-qpu-remaining":
            "QueryQuota10s:9,QueryQuota1min:57,QueryQuota1hour:597",
          "x-ms-ratelimit-remaining-microsoft.costmanagement-tenant-requests":
            "DefaultQuota:19",
        },
        NOW_MS,
      ),
    ).toEqual({
      qpuConsumed: 3,
      qpuRemaining: 9,
      tenantRequestsRemaining: 19,
    });
  });

  test.each([
    ["DefaultQuota:15", 15],
    ["QueryQuota10s:10,QueryQuota1hr:598", 10],
    ["a=4; b=2", 2],
    ["3", 3],
    [" 7 ", 7],
    ["DefaultQuota:none", undefined],
    ["", undefined],
  ])("%p reads as %p", (value: string, expected: number | undefined) => {
    expect(readAzureQuotaNumber(value)).toBe(expected);
  });

  test("anything but text or a number is no quota", () => {
    expect(readAzureQuotaNumber(undefined)).toBeUndefined();
    expect(readAzureQuotaNumber({ quota: 1 })).toBeUndefined();
    expect(readAzureQuotaNumber(5)).toBe(5);
  });
});
