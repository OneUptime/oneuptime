import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "@jest/globals";
import * as React from "react";
import IP from "../../../Types/IP/IP";
import MonitorType from "../../../Types/Monitor/MonitorType";
import NetworkPathTrace, {
  TraceRoute,
  TraceRouteHop,
} from "../../../Types/Monitor/NetworkMonitor/NetworkPathTrace";
import ObjectID from "../../../Types/ObjectID";
import ProbeAttempt from "../../../Types/Probe/ProbeAttempt";
import ProbeMonitorResponse from "../../../Types/Probe/ProbeMonitorResponse";
import ProbeNetworkFailureUtil, {
  ProbeNetworkOperation,
} from "../../../Utils/ProbeNetworkFailureUtil";
import NetworkPathView from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/NetworkPathView";
import SummaryInfo from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/SummaryInfo";

/*
 * "Network Path at Time of Failure" under a failed Ping or Port check.
 *
 * The customer's IPv6 Ping monitor ran on a probe with no usable IPv6, so
 * traceroute -6 failed "connect: Cannot assign requested address" before
 * one packet left the probe. The card still said "Route did not reach the
 * destination." in front of that, which reads as the customer's host being
 * off the network. A trace with no hops walked no path, so the card must
 * claim nothing about the route and let the trace's own message say why.
 */

const MONITORED_AT: Date = new Date("2026-09-20T09:15:00.000Z");
const CUSTOMER_ADDRESS: string = "2001:518:2800:9::2";
const MONITOR_ID: string = "22222222-2222-4222-8222-222222222222";

// What NetworkPathMonitor records for the customer's traceroute -6.
const TRACEROUTE_COULD_NOT_RUN: string =
  "Traceroute could not run: this probe cannot send IPv6 traffic (connect: Cannot assign requested address).";

const HOPS: Array<TraceRouteHop> = [
  {
    hopNumber: 1,
    address: "192.168.1.1",
    hostName: "gw.example.com",
    roundTripTimeInMS: 1,
    isTimeout: false,
  },
  {
    hopNumber: 2,
    address: undefined,
    hostName: undefined,
    roundTripTimeInMS: undefined,
    isTimeout: true,
  },
  {
    hopNumber: 3,
    address: "198.51.100.7",
    hostName: undefined,
    roundTripTimeInMS: 14,
    isTimeout: false,
  },
];

function buildTraceRoute(overrides: Partial<TraceRoute> = {}): TraceRoute {
  return {
    hops: [],
    destinationAddress: CUSTOMER_ADDRESS,
    destinationHostName: undefined,
    isComplete: false,
    totalHops: 0,
    failedHop: undefined,
    failureMessage: undefined,
    ...overrides,
  };
}

function renderPath(traceRoute: TraceRoute | undefined): HTMLElement {
  const trace: NetworkPathTrace = {
    timestamp: MONITORED_AT,
    traceRoute,
  };

  return render(<NetworkPathView networkPathTrace={trace} />).container;
}

describe("Network path card when traceroute recorded no hops", () => {
  it("shows the customer's IPv6 check without a route verdict on top of the probe's reason", () => {
    // The cause PingMonitor now gives for the customer's ping6 output.
    const probeCause: string | null = ProbeNetworkFailureUtil.describeOutput({
      host: CUSTOMER_ADDRESS,
      output: "ping6: connect: Cannot assign requested address\n",
      operation: ProbeNetworkOperation.PingOrTraceroute,
    });

    expect(probeCause).not.toBeNull();

    const failureCause: string = `Error: ${probeCause} Monitor ID: ${MONITOR_ID}`;

    const response: ProbeMonitorResponse = {
      projectId: new ObjectID("11111111-1111-4111-8111-111111111111"),
      monitorId: new ObjectID(MONITOR_ID),
      monitorStepId: new ObjectID("33333333-3333-4333-8333-333333333333"),
      probeId: new ObjectID("44444444-4444-4444-8444-444444444444"),
      monitorDestination: new IP(CUSTOMER_ADDRESS),
      isOnline: false,
      failureCause,
      monitoredAt: MONITORED_AT,
      networkPathTrace: {
        timestamp: MONITORED_AT,
        traceRoute: buildTraceRoute({
          failureMessage: TRACEROUTE_COULD_NOT_RUN,
        }),
      },
      probeAttempts: [1, 2, 3, 4].map((attemptNumber: number): ProbeAttempt => {
        return {
          attemptNumber,
          attemptedAt: MONITORED_AT,
          responseReceivedAt: MONITORED_AT,
          responseTimeInMs: 13,
          isOnline: false,
          failureCause,
        };
      }),
      totalAttempts: 4,
    };

    render(
      <SummaryInfo
        monitorType={MonitorType.Ping}
        probeMonitorResponses={[response]}
        probeName="Global Probe"
      />,
    );

    expect(
      screen.getByText("Network Path at Time of Failure"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(`No path was recorded. ${TRACEROUTE_COULD_NOT_RUN}`),
    ).toBeInTheDocument();

    /*
     * The check is still Offline (the probe could not verify the host), but
     * every card shows the probe's own cause verbatim: none of them adds a
     * verdict about the host or its route on top of it.
     */
    expect(screen.getByText("Offline")).toBeInTheDocument();
    expect(screen.getAllByText(failureCause)).toHaveLength(5);

    const pageText: string = document.body.textContent || "";

    expect(pageText).not.toMatch(/did not reach the destination/i);
    expect(pageText).not.toMatch(/Route broke/);
    expect(pageText).not.toContain("Unable to reach host");
    expect(pageText).not.toContain("No ICMP echo reply");
  });

  it("puts the neutral lead-in before an older probe's raw execFile message", () => {
    const container: HTMLElement = renderPath(
      buildTraceRoute({
        failureMessage: `Command failed: traceroute -6 -m 20 -w 3 ${CUSTOMER_ADDRESS}\n\nconnect: Cannot assign requested address\n`,
      }),
    );

    expect(screen.getByText(/^No path was recorded\./)).toHaveTextContent(
      `No path was recorded. Command failed: traceroute -6 -m 20 -w 3 ${CUSTOMER_ADDRESS} connect: Cannot assign requested address`,
    );
    expect(container.textContent).not.toMatch(/did not reach/i);
  });

  it("says no path was recorded when traceroute hit its deadline before any hop", () => {
    renderPath(buildTraceRoute({ failureMessage: "Traceroute timed out" }));

    expect(
      screen.getByText("No path was recorded. Traceroute timed out"),
    ).toBeInTheDocument();
  });

  it("shows the lead-in alone, and no hop table, when there is no message either", () => {
    renderPath(buildTraceRoute());

    expect(screen.getByText("No path was recorded.")).toBeInTheDocument();
    expect(screen.queryByText("Hop")).not.toBeInTheDocument();
  });

  it("claims nothing about the route even if a hop-less payload says it completed", () => {
    const container: HTMLElement = renderPath(
      buildTraceRoute({ isComplete: true }),
    );

    expect(screen.getByText("No path was recorded.")).toBeInTheDocument();
    expect(container.textContent).not.toContain("Route reached");
  });

  it("renders a stored trace with no hops array instead of throwing", () => {
    renderPath(
      buildTraceRoute({
        hops: undefined as unknown as Array<TraceRouteHop>,
        failureMessage: "Traceroute timed out",
      }),
    );

    expect(
      screen.getByText("No path was recorded. Traceroute timed out"),
    ).toBeInTheDocument();
  });
});

describe("Network path card when traceroute recorded hops", () => {
  it("says the route reached the destination, under the hop table", () => {
    renderPath(
      buildTraceRoute({
        hops: [HOPS[0]!, HOPS[2]!],
        destinationAddress: "198.51.100.7",
        isComplete: true,
        totalHops: 2,
      }),
    );

    expect(screen.getByText("Hop")).toBeInTheDocument();
    expect(
      screen.getByText("gw.example.com (192.168.1.1)"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Route reached the destination."),
    ).toBeInTheDocument();
  });

  it("names the hop the route broke at, with the trace's own message", () => {
    renderPath(
      buildTraceRoute({
        hops: HOPS,
        destinationAddress: "203.0.113.9",
        totalHops: 3,
        failedHop: 2,
        failureMessage: "Hop 2 timed out",
      }),
    );

    expect(screen.getByText("* * *")).toBeInTheDocument();
    expect(
      screen.getByText("Route broke at hop 2. Hop 2 timed out"),
    ).toBeInTheDocument();
  });

  it("keeps 'did not reach' for a walked route that fell short with no failed hop", () => {
    renderPath(
      buildTraceRoute({
        hops: [HOPS[0]!, HOPS[2]!],
        destinationAddress: "203.0.113.9",
        totalHops: 2,
      }),
    );

    expect(
      screen.getByText("Route did not reach the destination."),
    ).toBeInTheDocument();
  });
});

describe("Network path card without a traceroute", () => {
  it("shows the DNS lookup and no route line at all", () => {
    const container: HTMLElement = render(
      <NetworkPathView
        networkPathTrace={{
          timestamp: MONITORED_AT,
          dnsLookup: {
            hostName: "api.example.com",
            resolvedAddresses: [],
            resolvedInMS: 4,
            isSuccess: false,
            errorMessage: "ENOTFOUND",
          },
        }}
      />,
    ).container;

    expect(
      screen.getByText("Lookup for api.example.com failed — ENOTFOUND"),
    ).toBeInTheDocument();
    expect(container.textContent).not.toContain("No path was recorded");
    expect(container.textContent).not.toMatch(/Route (reached|broke|did not)/);
  });

  it("renders nothing when the probe captured neither", () => {
    const container: HTMLElement = renderPath(undefined);

    expect(container).toBeEmptyDOMElement();
  });
});
