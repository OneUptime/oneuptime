import "@testing-library/jest-dom";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "@jest/globals";
import * as React from "react";
import Hostname from "../../../Types/API/Hostname";
import IP from "../../../Types/IP/IP";
import MonitorType from "../../../Types/Monitor/MonitorType";
import NtpMonitorResponse from "../../../Types/Monitor/NtpMonitor/NtpMonitorResponse";
import ObjectID from "../../../Types/ObjectID";
import ProbeMonitorResponse from "../../../Types/Probe/ProbeMonitorResponse";
import SummaryInfo from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/SummaryInfo";

/*
 * The latest NTP check on the monitor's page: the server, whether it
 * answered and is synchronized, and - only for a server that answered - its
 * offset, stratum, reference and the rest of its reply.
 */

const MONITORED_AT: Date = new Date("2026-08-07T12:30:00.000Z");

function answered(
  overrides: Partial<NtpMonitorResponse> = {},
): NtpMonitorResponse {
  return {
    isOnline: true,
    isSynchronized: true,
    responseTimeInMs: 18.4,
    failureCause: "",
    serverAddress: "192.0.2.10",
    port: 123,
    version: 4,
    leapIndicator: 0,
    stratum: 2,
    referenceId: "192.0.2.1",
    rootDelayInMs: 12.5,
    rootDispersionInMs: 3.25,
    serverTime: "2026-08-07T12:30:00.004Z",
    clockOffsetInMs: 3.5,
    roundTripDelayInMs: 17.2,
    ...overrides,
  };
}

function buildResponse(
  ntpResponse: NtpMonitorResponse,
  overrides: Partial<ProbeMonitorResponse> = {},
): ProbeMonitorResponse {
  return {
    projectId: new ObjectID("11111111-1111-4111-8111-111111111111"),
    monitorId: new ObjectID("22222222-2222-4222-8222-222222222222"),
    monitorStepId: new ObjectID("33333333-3333-4333-8333-333333333333"),
    probeId: new ObjectID("44444444-4444-4444-8444-444444444444"),
    monitorDestination: new Hostname("time.example.com"),
    isOnline: ntpResponse.isOnline,
    responseTimeInMs: ntpResponse.isOnline
      ? ntpResponse.responseTimeInMs
      : undefined,
    failureCause: ntpResponse.failureCause,
    monitoredAt: MONITORED_AT,
    ntpResponse: ntpResponse,
    ...overrides,
  };
}

function renderSummary(response: ProbeMonitorResponse): HTMLElement {
  render(
    <SummaryInfo
      monitorType={MonitorType.NTP}
      probeMonitorResponses={[response]}
      probeName="London Probe"
    />,
  );

  return screen.getByTestId("ntp-monitor-summary");
}

// The whole text of the InfoCard whose title is `title`: title, then value.
function cardValue(summary: HTMLElement, title: string): string {
  const titleElement: HTMLElement = within(summary).getByText(title);
  const card: HTMLElement | null = titleElement.closest(".rounded-xl");

  return (card?.textContent || "").replace(title, "").trim();
}

describe("NTP monitor summary", () => {
  it("shows a healthy server's reply", () => {
    const summary: HTMLElement = renderSummary(buildResponse(answered()));

    expect(
      within(summary).getByText("time.example.com:123 (192.0.2.10)"),
    ).toBeInTheDocument();
    expect(within(summary).getByText("London Probe")).toBeInTheDocument();
    expect(within(summary).getByText("Online")).toBeInTheDocument();
    expect(cardValue(summary, "Synchronized")).toBe("Yes");
    expect(
      within(summary).getByText("3.5 ms ahead of the probe"),
    ).toBeInTheDocument();
    expect(
      within(summary).getByText("2 (secondary server)"),
    ).toBeInTheDocument();
    expect(within(summary).getByText("192.0.2.1")).toBeInTheDocument();
    expect(within(summary).getByText("18.4 ms")).toBeInTheDocument();
    expect(within(summary).getByText("No warning")).toBeInTheDocument();
    expect(within(summary).getByText("3.25 ms")).toBeInTheDocument();
    expect(within(summary).getByText("12.5 ms")).toBeInTheDocument();
    expect(within(summary).queryByText("Error")).not.toBeInTheDocument();
    expect(
      within(summary).queryByText("Not Synchronized"),
    ).not.toBeInTheDocument();
  });

  it("says behind, without a minus sign, for a server that lags", () => {
    const summary: HTMLElement = renderSummary(
      buildResponse(answered({ clockOffsetInMs: -1532.4 })),
    );

    expect(
      within(summary).getByText("1,532 ms behind the probe"),
    ).toBeInTheDocument();
  });

  it("names a primary server and its source", () => {
    const summary: HTMLElement = renderSummary(
      buildResponse(answered({ stratum: 1, referenceId: "GPS" })),
    );

    expect(within(summary).getByText("1 (primary server)")).toBeInTheDocument();
    expect(within(summary).getByText("GPS")).toBeInTheDocument();
  });

  it("leaves out the address when the server was typed as one", () => {
    const summary: HTMLElement = renderSummary(
      buildResponse(answered({ serverAddress: "192.0.2.10" }), {
        monitorDestination: new IP("192.0.2.10"),
      }),
    );

    expect(within(summary).getByText("192.0.2.10:123")).toBeInTheDocument();
  });

  it("shows a non-standard port and brackets an IPv6 server", () => {
    const summary: HTMLElement = renderSummary(
      buildResponse(answered({ port: 1123, serverAddress: "2001:db8::123" }), {
        monitorDestination: new IP("2001:db8::123"),
      }),
    );

    expect(
      within(summary).getByText("[2001:db8::123]:1123"),
    ).toBeInTheDocument();
  });

  it("a kiss-o'-death shows its code and why it is not synchronized", () => {
    const summary: HTMLElement = renderSummary(
      buildResponse(
        answered({
          isSynchronized: false,
          stratum: 0,
          kissCode: "RATE",
          referenceId: "RATE",
          leapIndicator: 3,
          clockOffsetInMs: undefined,
          serverTime: undefined,
          failureCause:
            "The server answered with a kiss-o'-death (RATE): the server is rate-limiting this probe and asks it to poll less often.",
        }),
      ),
    );

    expect(cardValue(summary, "Synchronized")).toBe("No");
    expect(
      within(summary).getByText("0 (kiss-o'-death RATE)"),
    ).toBeInTheDocument();
    expect(
      within(summary).getByText("Alarm: not synchronized"),
    ).toBeInTheDocument();
    expect(within(summary).getByText("Not Synchronized")).toBeInTheDocument();
    expect(
      within(summary).getByText(
        "The server answered with a kiss-o'-death (RATE): the server is rate-limiting this probe and asks it to poll less often.",
      ),
    ).toBeInTheDocument();
    expect(cardValue(summary, "Clock Offset")).toBe("-");
  });

  it("a stratum 16 server reads as not synchronized", () => {
    const summary: HTMLElement = renderSummary(
      buildResponse(answered({ isSynchronized: false, stratum: 16 })),
    );

    expect(
      within(summary).getByText("16 (not synchronized)"),
    ).toBeInTheDocument();
  });

  it("a silent server shows why, and none of the reply's fields", () => {
    const summary: HTMLElement = renderSummary(
      buildResponse({
        isOnline: false,
        isSynchronized: false,
        responseTimeInMs: 0,
        failureCause:
          "No NTP reply from 192.0.2.10:123 within 5 seconds. Tried 4 times.",
        isTimeout: true,
        serverAddress: "192.0.2.10",
        port: 123,
      }),
    );

    expect(within(summary).getByText("Offline")).toBeInTheDocument();
    expect(within(summary).getByText("Error")).toBeInTheDocument();
    expect(
      within(summary).getByText(
        "No NTP reply from 192.0.2.10:123 within 5 seconds. Tried 4 times.",
      ),
    ).toBeInTheDocument();
    expect(cardValue(summary, "Synchronized")).toBe("-");
    expect(within(summary).queryByText("Clock Offset")).not.toBeInTheDocument();
    expect(within(summary).queryByText("Stratum")).not.toBeInTheDocument();
    expect(
      within(summary).queryByText("Root Dispersion"),
    ).not.toBeInTheDocument();
  });

  it("wraps its cards two to a row on a phone and four on a wide screen", () => {
    const summary: HTMLElement = renderSummary(buildResponse(answered()));

    const grids: Array<Element> = Array.from(summary.querySelectorAll(".grid"));

    expect(grids.length).toBe(3);

    for (const grid of grids) {
      expect(grid.className).toContain("grid-cols-2");
      expect(grid.className).toContain("lg:grid-cols-4");
    }
  });
});
