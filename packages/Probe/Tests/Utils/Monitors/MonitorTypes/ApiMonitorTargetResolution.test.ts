// Set required env vars before importing anything that pulls Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";
delete process.env["PROBE_ALLOW_PRIVATE_NETWORK_MONITORS"];

import { afterEach, describe, expect, it } from "@jest/globals";
import ApiMonitor, {
  APIResponse,
} from "../../../../Utils/Monitors/MonitorTypes/ApiMonitor";
import HttpMonitorRequest from "../../../../Utils/Monitors/HttpMonitorRequest";
import OnlineCheck from "../../../../Utils/OnlineCheck";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import RequestFailedDetails, {
  RequestFailedPhase,
} from "Common/Types/Probe/RequestFailedDetails";
import API from "Common/Utils/API";
import dns from "dns";

/*
 * The host from the customer incident this suite exists for: a single monitor
 * out of ~75 on the same probe reported "could not be reached." with phase
 * "Unknown", because the egress guard's deliberately sanitized sentence
 * matched none of API.getRequestFailedDetails' string patterns.
 */
const TARGET_HOST: string = "order.abbeysbakehouse.test";
const TARGET_URL: string = `https://${TARGET_HOST}/checkout`;

/*
 * The sanitized sentence is a SECURITY property: a DNS failure and an
 * address-policy rejection must produce this exact same text so a tenant on a
 * shared probe cannot use the difference to enumerate internal DNS names.
 * Asserting on the literal keeps a future "more helpful message" from
 * quietly reopening that oracle.
 */
const SANITIZED_FAILURE_CAUSE: string = `Monitor target host ${TARGET_HOST} could not be reached.`;

// An address the probe is not allowed to dial (private ranges are blocked here).
const BLOCKED_PRIVATE_ADDRESS: string = "10.23.45.67";

// A public address that passes the guard, so the check proceeds to the request.
const PUBLIC_ADDRESS: string = "93.184.216.34";

/*
 * EAI_AGAIN is the classic transient resolver answer: it fails in
 * milliseconds and usually succeeds on the very next try, which is exactly
 * the blip that used to become a hard monitor-down incident.
 */
function transientResolverError(): Error {
  const error: NodeJS.ErrnoException = new Error(
    `getaddrinfo EAI_AGAIN ${TARGET_HOST}`,
  );
  error.code = "EAI_AGAIN";
  return error;
}

describe("ApiMonitor target resolution failures", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("reports a guard DNS failure as Target Resolution without opening a socket", async () => {
    const lookupSpy: jest.SpyInstance = jest
      .spyOn(dns.promises, "lookup")
      .mockRejectedValue(transientResolverError() as never);
    const prepareSpy: jest.SpyInstance = jest.spyOn(
      HttpMonitorRequest,
      "prepare",
    );
    const fetchSpy: jest.SpyInstance = jest.spyOn(API, "fetch");

    const response: APIResponse | null = await ApiMonitor.ping(
      URL.fromString(TARGET_URL),
      { retry: 9, isOnlineCheckRequest: true },
    );

    expect(response).not.toBeNull();
    expect(response!.isOnline).toBe(false);
    expect(response!.statusCode).toBeUndefined();
    expect(response!.responseBody).toBe("");
    // The tenant-facing sentence itself is unchanged by the fix.
    expect(response!.failureCause).toBe(SANITIZED_FAILURE_CAUSE);

    const details: RequestFailedDetails = response!.requestFailedDetails!;
    expect(details.failedPhase).toBe(RequestFailedPhase.TargetResolution);
    expect(details.errorCode).toBe("TARGET_UNREACHABLE");
    expect(details.rawErrorMessage).toBe(SANITIZED_FAILURE_CAUSE);

    /*
     * The old behaviour: no pattern matched, so the phase was Unknown and the
     * "explanation" was the unhelpful sentence echoed back with a prefix.
     */
    expect(details.failedPhase).not.toBe(RequestFailedPhase.Unknown);
    expect(details.errorDescription).not.toBe(
      `Request failed: ${SANITIZED_FAILURE_CAUSE}`,
    );
    expect(details.errorDescription).toContain("no connection was attempted");

    // Refused before any HTTP request was built or dispatched.
    expect(lookupSpy).toHaveBeenCalled();
    expect(prepareSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("keeps one attempt and keeps a DNS failure indistinguishable from a blocked address", async () => {
    const lookupSpy: jest.SpyInstance = jest
      .spyOn(dns.promises, "lookup")
      .mockRejectedValue(transientResolverError() as never);
    const fetchSpy: jest.SpyInstance = jest.spyOn(API, "fetch");

    const dnsFailureResponse: APIResponse | null = await ApiMonitor.ping(
      URL.fromString(TARGET_URL),
      { retry: 9, isOnlineCheckRequest: true },
    );

    // Same host, same options - only the resolver's answer differs.
    lookupSpy.mockResolvedValue([
      { address: BLOCKED_PRIVATE_ADDRESS, family: 4 },
    ] as never);

    const blockedAddressResponse: APIResponse | null = await ApiMonitor.ping(
      URL.fromString(TARGET_URL),
      { retry: 9, isOnlineCheckRequest: true },
    );

    expect(dnsFailureResponse).not.toBeNull();
    expect(blockedAddressResponse).not.toBeNull();

    /*
     * A guard refusal is never retried by the monitor: retrying only some of
     * them would make totalAttempts differ between "DNS failed" and "policy
     * blocked", which is the very distinction the sanitized message hides.
     * Transient retries happen inside the guard instead.
     */
    expect(dnsFailureResponse!.totalAttempts).toBe(1);
    expect(blockedAddressResponse!.totalAttempts).toBe(1);
    expect(dnsFailureResponse!.probeAttempts).toHaveLength(1);
    expect(blockedAddressResponse!.probeAttempts).toHaveLength(1);

    // Byte-identical, including the newly added structured details.
    expect(dnsFailureResponse!.failureCause).toBe(SANITIZED_FAILURE_CAUSE);
    expect(blockedAddressResponse!.failureCause).toBe(SANITIZED_FAILURE_CAUSE);
    expect(JSON.stringify(blockedAddressResponse!.requestFailedDetails)).toBe(
      JSON.stringify(dnsFailureResponse!.requestFailedDetails),
    );

    const blockedJson: string = JSON.stringify(blockedAddressResponse);
    expect(blockedJson).not.toContain(BLOCKED_PRIVATE_ADDRESS);
    expect(blockedJson).not.toContain("private network");
    expect(blockedJson).not.toContain("AddressBlocked");
    expect(blockedJson).not.toContain("ResolutionFailed");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("checks the probe's own connectivity before believing an unreachable target", async () => {
    jest
      .spyOn(dns.promises, "lookup")
      .mockRejectedValue(transientResolverError() as never);
    /*
     * ApiMonitor asks the website reference check, because that is the
     * protocol it speaks.
     */
    const onlineCheckSpy: jest.SpyInstance = jest
      .spyOn(OnlineCheck, "canProbeMonitorWebsiteMonitors")
      .mockResolvedValue(false as never);

    /*
     * A probe whose own resolver has died must not be believed when it says a
     * monitor is down: null means "no verdict", so no incident is opened.
     */
    const noVerdictResponse: APIResponse | null = await ApiMonitor.ping(
      URL.fromString(TARGET_URL),
      { retry: 0 },
    );

    expect(noVerdictResponse).toBeNull();
    expect(onlineCheckSpy).toHaveBeenCalledTimes(1);

    onlineCheckSpy.mockResolvedValue(true as never);

    const offlineResponse: APIResponse | null = await ApiMonitor.ping(
      URL.fromString(TARGET_URL),
      { retry: 0 },
    );

    expect(offlineResponse).not.toBeNull();
    expect(offlineResponse!.isOnline).toBe(false);
    expect(offlineResponse!.failureCause).toBe(SANITIZED_FAILURE_CAUSE);
    expect(offlineResponse!.requestFailedDetails!.failedPhase).toBe(
      RequestFailedPhase.TargetResolution,
    );
    expect(offlineResponse!.requestFailedDetails!.errorCode).toBe(
      "TARGET_UNREACHABLE",
    );
    expect(onlineCheckSpy).toHaveBeenCalledTimes(2);
  });

  it("skips the connectivity check for a structurally invalid target", async () => {
    const onlineCheckSpy: jest.SpyInstance = jest
      .spyOn(OnlineCheck, "canProbeMonitorWebsiteMonitors")
      .mockResolvedValue(false as never);
    const lookupSpy: jest.SpyInstance = jest.spyOn(dns.promises, "lookup");

    /*
     * A non-http(s) scheme is the tenant's own configuration, not a network
     * failure, so it has to surface immediately even on a probe that cannot
     * reach the internet - otherwise a misconfigured monitor stays silent.
     */
    const response: APIResponse | null = await ApiMonitor.ping(
      URL.fromString("ws://1.1.1.1/socket"),
      { retry: 0 },
    );

    expect(response).not.toBeNull();
    expect(response!.isOnline).toBe(false);
    expect(response!.requestFailedDetails!.failedPhase).toBe(
      RequestFailedPhase.TargetResolution,
    );
    expect(response!.requestFailedDetails!.errorCode).toBe("INVALID_TARGET");
    expect(onlineCheckSpy).not.toHaveBeenCalled();
    expect(lookupSpy).not.toHaveBeenCalled();
  });

  it("reports the monitor online when a transient resolver failure recovers on retry", async () => {
    const lookupSpy: jest.SpyInstance = jest
      .spyOn(dns.promises, "lookup")
      .mockRejectedValueOnce(transientResolverError() as never)
      .mockResolvedValue([{ address: PUBLIC_ADDRESS, family: 4 }] as never);
    const fetchSpy: jest.SpyInstance = jest
      .spyOn(API, "fetch")
      .mockResolvedValue(
        new HTTPResponse<JSONObject>(200, { ok: true }, {}) as never,
      );
    const onlineCheckSpy: jest.SpyInstance = jest
      .spyOn(OnlineCheck, "canProbeMonitorWebsiteMonitors")
      .mockResolvedValue(false as never);

    const response: APIResponse | null = await ApiMonitor.ping(
      URL.fromString(TARGET_URL),
      { retry: 0 },
    );

    /*
     * The single un-retried lookup this replaced turned this exact blip into a
     * monitor-down incident, so this assertion fails against the old guard.
     */
    expect(response).not.toBeNull();
    expect(response!.isOnline).toBe(true);
    expect(response!.statusCode).toBe(200);
    expect(response!.failureCause).toBe("");
    expect(response!.totalAttempts).toBe(1);
    expect(lookupSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(onlineCheckSpy).not.toHaveBeenCalled();
  });
});
