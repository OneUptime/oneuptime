import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import ProbeMonitorResponse from "../../../Types/Probe/ProbeMonitorResponse";
import ServerMonitorResponse from "../../../Types/Monitor/ServerMonitor/ServerMonitorResponse";
import IncomingMonitorRequest from "../../../Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import IncomingEmailMonitorRequest from "../../../Types/Monitor/IncomingEmailMonitor/IncomingEmailMonitorRequest";
import SummaryInfo from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/SummaryInfo";

/*
 * A monitor's summary folds its longer details under "Show More Details",
 * on the overview, in Test Monitor, on Monitoring Logs and on the incident
 * and alert pages. Show More Details and Hide Details used to be two
 * buttons, one drawn per state: a press unmounted the button it was made
 * on, so focus fell back to the page, and neither said whether the details
 * were open. It is one button now (issue #5364's sweep of show-mores),
 * whose words follow the state and which says it with aria-expanded - in
 * every summary view that has it.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const PROBE_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const MONITORED_AT: Date = new Date("2026-09-21T12:00:00.000Z");

function probeResponse(extra: Record<string, unknown>): ProbeMonitorResponse {
  return {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    probeId: PROBE_ID,
    isOnline: true,
    monitoredAt: MONITORED_AT,
    responseTimeInMs: 212,
    ...extra,
  } as unknown as ProbeMonitorResponse;
}

interface Scenario {
  name: string;
  // The summary, drawn the way the pages draw it.
  element: () => React.ReactElement;
  // Something only the opened details show.
  detail: string;
}

const SCENARIOS: Array<Scenario> = [
  {
    name: "Website",
    element: () => {
      return (
        <SummaryInfo
          monitorType={MonitorType.Website}
          probeName="Frankfurt"
          probeMonitorResponses={[
            probeResponse({
              monitorDestination: "https://shop.acme-commerce.example",
              responseCode: 200,
              responseHeaders: { "content-type": "text/html" },
            }),
          ]}
        />
      );
    },
    detail: "Response Headers",
  },
  {
    name: "Custom JavaScript Code",
    element: () => {
      return (
        <SummaryInfo
          monitorType={MonitorType.CustomJavaScriptCode}
          probeName="Frankfurt"
          probeMonitorResponses={[
            probeResponse({
              customCodeMonitorResponse: {
                executionTimeInMS: 812,
                scriptError: undefined,
                result: { orders: 12 },
                logMessages: ["fetched orders"],
              },
            }),
          ]}
        />
      );
    },
    detail: "Log Messages",
  },
  {
    name: "SSL Certificate",
    element: () => {
      return (
        <SummaryInfo
          monitorType={MonitorType.SSLCertificate}
          probeName="Frankfurt"
          probeMonitorResponses={[
            probeResponse({
              monitorDestination: "https://shop.acme-commerce.example",
              sslResponse: {
                isValidCertificate: true,
                isSelfSigned: false,
                createdAt: new Date("2026-01-01T00:00:00.000Z"),
                expiresAt: new Date("2026-12-01T00:00:00.000Z"),
                commonName: "shop.acme-commerce.example",
                issuer: "CN=R11, O=Let's Encrypt, C=US",
                serialNumber: "04A1B2C3D4E5F60718293A4B5C6D7E8F9A0B",
              },
            }),
          ]}
        />
      );
    },
    detail: "Serial Number",
  },
  {
    name: "Server",
    element: () => {
      return (
        <SummaryInfo
          monitorType={MonitorType.Server}
          serverMonitorResponse={
            {
              projectId: PROJECT_ID,
              monitorId: MONITOR_ID,
              hostname: "orders-db-primary",
              requestReceivedAt: MONITORED_AT,
              basicInfrastructureMetrics: {
                cpuMetrics: { percentUsed: 37, cores: 8 },
              },
            } as unknown as ServerMonitorResponse
          }
        />
      );
    },
    detail: "CPU Cores",
  },
  {
    name: "Incoming Request",
    element: () => {
      return (
        <SummaryInfo
          monitorType={MonitorType.IncomingRequest}
          incomingMonitorRequest={
            {
              projectId: PROJECT_ID,
              monitorId: MONITOR_ID,
              incomingRequestReceivedAt: MONITORED_AT,
              requestMethod: "POST",
              requestHeaders: { "content-type": "application/json" },
              checkedAt: MONITORED_AT,
            } as unknown as IncomingMonitorRequest
          }
          incomingRequestMonitorHeartbeatCheckedAt={MONITORED_AT}
        />
      );
    },
    detail: "Request Headers",
  },
  {
    name: "Incoming Email",
    element: () => {
      return (
        <SummaryInfo
          monitorType={MonitorType.IncomingEmail}
          incomingEmailMonitorRequest={
            {
              projectId: PROJECT_ID,
              monitorId: MONITOR_ID,
              emailFrom: "payroll@acme-commerce.example",
              emailSubject: "Payroll run completed",
              emailReceivedAt: MONITORED_AT,
              emailHeaders: { "message-id": "<run-42@acme-commerce.example>" },
              emailBody: "Payroll run 42 completed with 0 errors.",
              checkedAt: MONITORED_AT,
            } as unknown as IncomingEmailMonitorRequest
          }
          incomingEmailMonitorHeartbeatCheckedAt={MONITORED_AT}
        />
      );
    },
    detail: "Email Headers",
  },
];

afterEach(() => {
  cleanup();
});

describe("a monitor summary's Show More Details", () => {
  test.each(SCENARIOS)(
    "$name: one button, folded, that says so",
    (scenario: Scenario) => {
      render(scenario.element());

      const toggle: HTMLElement = screen.getByRole("button", {
        name: "Show More Details",
      });

      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(
        screen.queryByRole("button", { name: "Hide Details" }),
      ).not.toBeInTheDocument();
      expect(screen.queryByText(scenario.detail)).not.toBeInTheDocument();
    },
  );

  test.each(SCENARIOS)(
    "$name: opens the details, becomes Hide Details, and keeps focus",
    (scenario: Scenario) => {
      render(scenario.element());

      const toggle: HTMLElement = screen.getByRole("button", {
        name: "Show More Details",
      });

      toggle.focus();
      fireEvent.click(toggle);

      expect(screen.getByText(scenario.detail)).toBeInTheDocument();

      const hide: HTMLElement = screen.getByRole("button", {
        name: "Hide Details",
      });

      expect(hide).toBe(toggle);
      expect(hide).toHaveFocus();
      expect(hide).toHaveAttribute("aria-expanded", "true");
      expect(
        screen.queryByRole("button", { name: "Show More Details" }),
      ).not.toBeInTheDocument();
    },
  );

  test.each(SCENARIOS)(
    "$name: Hide Details folds them again, focus still on it",
    (scenario: Scenario) => {
      render(scenario.element());

      const toggle: HTMLElement = screen.getByRole("button", {
        name: "Show More Details",
      });

      toggle.focus();
      fireEvent.click(toggle);
      fireEvent.click(toggle);

      expect(screen.queryByText(scenario.detail)).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Show More Details" })).toBe(
        toggle,
      );
      expect(toggle).toHaveFocus();
      expect(toggle).toHaveAttribute("aria-expanded", "false");
    },
  );
});
