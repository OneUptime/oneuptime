import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "@jest/globals";
import * as React from "react";
import Hostname from "../../../Types/API/Hostname";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import Port from "../../../Types/Port";
import ProbeMonitorResponse from "../../../Types/Probe/ProbeMonitorResponse";
import { RequestFailedPhase } from "../../../Types/Probe/RequestFailedDetails";
import SummaryInfo from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/SummaryInfo";

const MONITORED_AT: Date = new Date("2026-08-07T12:30:00.000Z");

function buildResponse(
  overrides: Partial<ProbeMonitorResponse> = {},
): ProbeMonitorResponse {
  return {
    projectId: new ObjectID("11111111-1111-4111-8111-111111111111"),
    monitorId: new ObjectID("22222222-2222-4222-8222-222222222222"),
    monitorStepId: new ObjectID("33333333-3333-4333-8333-333333333333"),
    probeId: new ObjectID("44444444-4444-4444-8444-444444444444"),
    monitorDestination: new Hostname("db.example.com"),
    monitorDestinationPort: new Port(5432),
    isOnline: true,
    responseTimeInMs: 31.27,
    failureCause: "",
    monitoredAt: MONITORED_AT,
    ...overrides,
  };
}

function renderSummary(
  monitorType: MonitorType,
  response: ProbeMonitorResponse,
): void {
  render(
    <SummaryInfo
      monitorType={monitorType}
      probeMonitorResponses={[response]}
      probeName="London Probe"
    />,
  );
}

describe("Port monitor summary", () => {
  it("labels the existing response time as the DNS plus TCP total", () => {
    renderSummary(
      MonitorType.Port,
      buildResponse({
        portTimings: {
          dnsLookupInMs: 8.12,
          tcpConnectInMs: 23.15,
          totalConnectionInMs: 31.27,
        },
      }),
    );

    expect(screen.getByText("db.example.com:5432")).toBeInTheDocument();
    expect(
      screen.getByText("Total Connection Time (DNS + TCP)"),
    ).toBeInTheDocument();
    expect(screen.getByText("31.27 ms")).toBeInTheDocument();
    expect(screen.queryByText("Response Time (in ms)")).not.toBeInTheDocument();
  });

  it("shows the measured DNS and TCP phases", () => {
    renderSummary(
      MonitorType.Port,
      buildResponse({
        portTimings: {
          dnsLookupInMs: 8.123,
          tcpConnectInMs: 23.147,
          totalConnectionInMs: 31.27,
        },
      }),
    );

    expect(screen.getByText("Connection Phase Breakdown")).toBeInTheDocument();
    expect(screen.getByText("DNS Lookup")).toBeInTheDocument();
    expect(screen.getByText("8.12 ms")).toBeInTheDocument();
    expect(screen.getByText("TCP Connect")).toBeInTheDocument();
    expect(screen.getByText("23.15 ms")).toBeInTheDocument();
  });

  it("omits DNS for an IP target while retaining the TCP phase", () => {
    renderSummary(
      MonitorType.Port,
      buildResponse({
        monitorDestination: new Hostname("192.0.2.10"),
        responseTimeInMs: 4.25,
        portTimings: {
          tcpConnectInMs: 4.25,
          totalConnectionInMs: 4.25,
        },
      }),
    );

    expect(screen.getByText("192.0.2.10:5432")).toBeInTheDocument();
    expect(screen.queryByText("DNS Lookup")).not.toBeInTheDocument();
    expect(screen.getByText("TCP Connect")).toBeInTheDocument();
  });

  it("renders valid zero-duration measurements instead of missing data", () => {
    renderSummary(
      MonitorType.Port,
      buildResponse({
        responseTimeInMs: 0,
        portTimings: {
          dnsLookupInMs: 0,
          tcpConnectInMs: 0,
          totalConnectionInMs: 0,
        },
      }),
    );

    expect(screen.getAllByText("0 ms")).toHaveLength(3);
  });

  it("does not invent a missing TCP duration after a DNS-only failure", () => {
    renderSummary(
      MonitorType.Port,
      buildResponse({
        isOnline: false,
        responseTimeInMs: 19,
        failureCause: "DNS lookup failed",
        portTimings: {
          dnsLookupInMs: 19,
          totalConnectionInMs: 19,
        },
      }),
    );

    expect(screen.getByText("DNS Lookup")).toBeInTheDocument();
    expect(screen.queryByText("TCP Connect")).not.toBeInTheDocument();
  });

  it("keeps older results useful when no phase timings were recorded", () => {
    renderSummary(MonitorType.Port, buildResponse());

    expect(
      screen.getByText("Total Connection Time (DNS + TCP)"),
    ).toBeInTheDocument();
    expect(screen.getByText("31.27 ms")).toBeInTheDocument();
    expect(
      screen.queryByText("Connection Phase Breakdown"),
    ).not.toBeInTheDocument();
  });

  it("uses the compatibility response time for the displayed total", () => {
    renderSummary(
      MonitorType.Port,
      buildResponse({
        responseTimeInMs: 25,
        portTimings: {
          dnsLookupInMs: 5,
          tcpConnectInMs: 20,
          totalConnectionInMs: 999,
        },
      }),
    );

    expect(screen.getByText("25 ms")).toBeInTheDocument();
    expect(screen.queryByText("999 ms")).not.toBeInTheDocument();
  });

  it("retains failure details and retry evidence in the dedicated view", () => {
    renderSummary(
      MonitorType.Port,
      buildResponse({
        isOnline: false,
        failureCause: "Connection refused",
        requestFailedDetails: {
          failedPhase: RequestFailedPhase.TCPConnection,
          errorCode: "ECONNREFUSED",
          errorDescription: "The target rejected the TCP connection.",
        },
        probeAttempts: [
          {
            attemptNumber: 1,
            attemptedAt: MONITORED_AT,
            responseReceivedAt: MONITORED_AT,
            responseTimeInMs: 11,
            isOnline: false,
            failureCause: "Connection refused",
          },
          {
            attemptNumber: 2,
            attemptedAt: MONITORED_AT,
            responseReceivedAt: MONITORED_AT,
            responseTimeInMs: 12,
            isOnline: false,
            failureCause: "Connection refused",
          },
        ],
        totalAttempts: 2,
      }),
    );

    expect(screen.getByText("Offline")).toBeInTheDocument();
    expect(screen.getAllByText("Connection refused").length).toBeGreaterThan(0);
    expect(screen.getByText("TCP Connection")).toBeInTheDocument();
    expect(screen.getByText("ECONNREFUSED")).toBeInTheDocument();
    expect(
      screen.getByText("The target rejected the TCP connection."),
    ).toBeInTheDocument();
    expect(screen.getByText("Retry Attempts")).toBeInTheDocument();
    expect(screen.getByText("Attempt 1/2")).toBeInTheDocument();
    expect(screen.getByText("Attempt 2/2")).toBeInTheDocument();
  });
});

describe("Ping and IP summaries", () => {
  it.each([MonitorType.Ping, MonitorType.IP])(
    "keeps %s on the existing Ping view",
    (monitorType: MonitorType) => {
      renderSummary(
        monitorType,
        buildResponse({
          portTimings: {
            dnsLookupInMs: 8,
            tcpConnectInMs: 23,
            totalConnectionInMs: 31,
          },
        }),
      );

      expect(screen.getByText("Response Time (in ms)")).toBeInTheDocument();
      expect(
        screen.queryByText("Total Connection Time (DNS + TCP)"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText("Connection Phase Breakdown"),
      ).not.toBeInTheDocument();
    },
  );
});
