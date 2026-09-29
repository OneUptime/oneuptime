// Set required env vars before importing anything that pulls Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";
delete process.env["PROBE_ALLOW_PRIVATE_NETWORK_MONITORS"];

import { afterEach, describe, expect, it } from "@jest/globals";
import WebsiteMonitor, {
  ProbeWebsiteResponse,
} from "../../../../Utils/Monitors/MonitorTypes/WebsiteMonitor";
import OnlineCheck from "../../../../Utils/OnlineCheck";
import URL from "Common/Types/API/URL";
import HTML from "Common/Types/Html";
import RequestFailedDetails, {
  RequestFailedPhase,
} from "Common/Types/Probe/RequestFailedDetails";
import WebsiteRequest, { WebsiteResponse } from "Common/Types/WebsiteRequest";
import dns from "dns";

/*
 * The exact sentence the egress guard produces for a monitor target it cannot
 * turn into a dialable address. It is deliberately identical for "DNS failed"
 * and "resolved to an address policy forbids" — a tenant on a shared probe who
 * could tell those apart could enumerate internal DNS names. Pinned here as a
 * literal so a change to the wording has to be a conscious one.
 */
function unreachableMessage(host: string): string {
  return `Monitor target host ${host} could not be reached.`;
}

const PUBLIC_ADDRESS: string = "93.184.216.34";

function websiteResponse(data: {
  url: string;
  statusCode: number;
  body: string;
}): WebsiteResponse {
  return {
    url: URL.fromString(data.url),
    requestHeaders: {},
    responseHeaders: {},
    responseStatusCode: data.statusCode,
    responseBody: new HTML(data.body),
    isOnline: true,
  };
}

describe("WebsiteMonitor target resolution failures", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * The customer regression. A resolver hiccup on one hostname produced an
   * incident whose entire root cause was "Failed Phase: Unknown / Request
   * failed: <the sanitized sentence>", because getRequestFailedDetails had
   * only that string to pattern-match and matched nothing.
   */
  it("classifies a resolver failure as Target Resolution instead of Unknown", async () => {
    const host: string = "order.abbeysbakehouse.test";
    const lookupSpy: jest.SpyInstance = jest
      .spyOn(dns.promises, "lookup")
      .mockRejectedValue(new Error(`getaddrinfo EAI_AGAIN ${host}`) as never);
    const fetchSpy: jest.SpyInstance = jest.spyOn(WebsiteRequest, "fetch");

    const response: ProbeWebsiteResponse | null = await WebsiteMonitor.ping(
      URL.fromString(`https://${host}/`),
      { retry: 0, isOnlineCheckRequest: true },
    );

    expect(response).not.toBeNull();
    expect(response!.isOnline).toBe(false);

    const details: RequestFailedDetails = response!.requestFailedDetails!;
    expect(details.failedPhase).toBe(RequestFailedPhase.TargetResolution);
    expect(details.failedPhase).not.toBe(RequestFailedPhase.Unknown);
    expect(details.errorCode).toBe("TARGET_UNREACHABLE");
    expect(details.errorDescription).toContain(
      "could not obtain a usable network address",
    );
    /*
     * The old behaviour echoed the sanitized sentence back as its own
     * explanation. Anything that still does that is not an explanation.
     */
    expect(details.errorDescription).not.toBe(
      `Request failed: ${unreachableMessage(host)}`,
    );
    expect(details.rawErrorMessage).toBe(unreachableMessage(host));

    // The tenant-facing sentence itself must be byte-for-byte unchanged.
    expect(response!.failureCause).toBe(unreachableMessage(host));

    // No socket was ever opened: the guard refused before the request.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(lookupSpy).toHaveBeenCalled();
  });

  /*
   * The oracle invariant at the monitor layer. Whatever the guard learned, the
   * serialized monitor response for a DNS failure and for a blocked private
   * address must be indistinguishable - including the attempt count, which is
   * why the monitor-level retry decision was deliberately left alone.
   */
  it("makes a DNS failure and a blocked private address indistinguishable", async () => {
    const host: string = "shared-oracle-host.example.test";
    const privateAddress: string = "10.23.45.67";

    jest
      .spyOn(dns.promises, "lookup")
      .mockRejectedValue(new Error(`getaddrinfo EAI_AGAIN ${host}`) as never);
    const dnsFailureResponse: ProbeWebsiteResponse | null =
      await WebsiteMonitor.ping(URL.fromString(`https://${host}/status`), {
        retry: 0,
        isOnlineCheckRequest: true,
      });
    jest.restoreAllMocks();

    jest
      .spyOn(dns.promises, "lookup")
      .mockResolvedValue([{ address: privateAddress, family: 4 }] as never);
    const blockedAddressResponse: ProbeWebsiteResponse | null =
      await WebsiteMonitor.ping(URL.fromString(`https://${host}/status`), {
        retry: 0,
        isOnlineCheckRequest: true,
      });

    expect(dnsFailureResponse).not.toBeNull();
    expect(blockedAddressResponse).not.toBeNull();

    expect(dnsFailureResponse!.failureCause).toBe(unreachableMessage(host));
    expect(blockedAddressResponse!.failureCause).toBe(
      dnsFailureResponse!.failureCause,
    );
    expect(blockedAddressResponse!.requestFailedDetails).toEqual(
      dnsFailureResponse!.requestFailedDetails,
    );

    // A guard refusal is never retried, whichever branch produced it.
    expect(dnsFailureResponse!.totalAttempts).toBe(1);
    expect(blockedAddressResponse!.totalAttempts).toBe(1);

    const serializedDnsFailure: string = JSON.stringify(dnsFailureResponse);
    const serializedBlockedAddress: string = JSON.stringify(
      blockedAddressResponse,
    );
    expect(serializedDnsFailure).not.toContain(privateAddress);
    expect(serializedBlockedAddress).not.toContain(privateAddress);
    expect(serializedDnsFailure).not.toContain("private network");
    expect(serializedBlockedAddress).not.toContain("private network");
  });

  /*
   * The behaviour change. A guard refusal is a BadDataException, and the
   * probe-self-health branch used to exclude BadDataException outright - so a
   * probe whose own resolver had died reported every monitor as down without
   * ever checking whether it could reach the internet itself.
   */
  it("suppresses an unreachable-target failure when the probe itself is offline", async () => {
    const host: string = "probe-resolver-died.example.test";
    jest
      .spyOn(dns.promises, "lookup")
      .mockRejectedValue(new Error(`getaddrinfo EAI_AGAIN ${host}`) as never);
    const onlineCheckSpy: jest.SpyInstance = jest
      .spyOn(OnlineCheck, "canProbeMonitorWebsiteMonitors")
      .mockResolvedValue(false);

    const response: ProbeWebsiteResponse | null = await WebsiteMonitor.ping(
      URL.fromString(`https://${host}/`),
      { retry: 0 },
    );

    expect(onlineCheckSpy).toHaveBeenCalledTimes(1);
    expect(response).toBeNull();
  });

  it("reports an unreachable-target failure when the probe itself is online", async () => {
    const host: string = "target-really-gone.example.test";
    jest
      .spyOn(dns.promises, "lookup")
      .mockRejectedValue(new Error(`getaddrinfo EAI_AGAIN ${host}`) as never);
    const onlineCheckSpy: jest.SpyInstance = jest
      .spyOn(OnlineCheck, "canProbeMonitorWebsiteMonitors")
      .mockResolvedValue(true);

    const response: ProbeWebsiteResponse | null = await WebsiteMonitor.ping(
      URL.fromString(`https://${host}/`),
      { retry: 0 },
    );

    expect(onlineCheckSpy).toHaveBeenCalledTimes(1);
    expect(response).not.toBeNull();
    expect(response!.isOnline).toBe(false);
    expect(response!.failureCause).toBe(unreachableMessage(host));
    expect(response!.requestFailedDetails?.failedPhase).toBe(
      RequestFailedPhase.TargetResolution,
    );
    expect(response!.requestFailedDetails?.errorCode).toBe(
      "TARGET_UNREACHABLE",
    );
  });

  /*
   * A structurally invalid target is the tenant's own configuration echoed
   * back. It reveals nothing about the probe's network and cannot be fixed by
   * waiting, so it must surface immediately rather than being swallowed by a
   * probe-health check that would report it as "probe offline".
   */
  it("surfaces an invalid target without consulting the probe health check", async () => {
    const lookupSpy: jest.SpyInstance = jest.spyOn(dns.promises, "lookup");
    const onlineCheckSpy: jest.SpyInstance = jest
      .spyOn(OnlineCheck, "canProbeMonitorWebsiteMonitors")
      .mockResolvedValue(false);

    const response: ProbeWebsiteResponse | null = await WebsiteMonitor.ping(
      URL.fromString("ws://not-an-http-target.example.test/socket"),
      { retry: 0 },
    );

    expect(onlineCheckSpy).not.toHaveBeenCalled();
    expect(response).not.toBeNull();
    expect(response!.isOnline).toBe(false);
    expect(response!.requestFailedDetails?.failedPhase).toBe(
      RequestFailedPhase.TargetResolution,
    );
    expect(response!.requestFailedDetails?.errorCode).toBe("INVALID_TARGET");
    expect(response!.failureCause).toBe(
      "Monitor target URL must use http or https (got ws).",
    );
    // The scheme is rejected before any name resolution is attempted.
    expect(lookupSpy).not.toHaveBeenCalled();
  });

  /*
   * End-to-end proof that the in-guard retry is what stops the customer's
   * false incident: the very first getaddrinfo fails the way a loaded resolver
   * fails, the second succeeds, and the monitor is simply online. Before the
   * retry existed this single blip was a hard monitor-down.
   */
  it("stays online when the first resolver attempt fails and the retry succeeds", async () => {
    const host: string = "transient-resolver.example.test";
    const lookupSpy: jest.SpyInstance = jest
      .spyOn(dns.promises, "lookup")
      .mockRejectedValueOnce(
        new Error(`getaddrinfo EAI_AGAIN ${host}`) as never,
      )
      .mockResolvedValue([{ address: PUBLIC_ADDRESS, family: 4 }] as never);
    const fetchSpy: jest.SpyInstance = jest
      .spyOn(WebsiteRequest, "fetch")
      .mockResolvedValue(
        websiteResponse({
          url: `https://${host}/`,
          statusCode: 200,
          body: "recovered",
        }) as never,
      );

    const response: ProbeWebsiteResponse | null = await WebsiteMonitor.ping(
      URL.fromString(`https://${host}/`),
      { retry: 0, isOnlineCheckRequest: true },
    );

    expect(response).not.toBeNull();
    expect(response!.isOnline).toBe(true);
    expect(response!.statusCode).toBe(200);
    expect(response!.requestFailedDetails).toBeUndefined();
    expect(lookupSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
