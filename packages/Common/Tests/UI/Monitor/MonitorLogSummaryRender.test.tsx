/** @timezone UTC */

/*
 * The package entry, not the `/extend-expect` subpath the older tests use:
 * the matchers are already registered by Tests/jest.setup.ts, and only this
 * specifier resolves to the type augmentation that makes them visible to
 * TypeScript.
 */
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it } from "@jest/globals";
import OneUptimeDate from "../../../Types/Date";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import { JSONObject } from "../../../Types/JSON";
import MonitorEvaluationSummary from "../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorSummarySnapshot from "../../../Types/Monitor/MonitorSummarySnapshot";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import { redactForPersistence } from "../../../Server/Utils/Monitor/MonitorPayloadRedaction";
import MonitorLogSummaryUtil from "../../../Utils/Monitor/MonitorLogSummaryUtil";
import MonitorSummarySnapshotUtil, {
  MonitorSummaryDataToProcess,
} from "../../../Utils/Monitor/MonitorSummarySnapshotUtil";
/*
 * The Dashboard resolves its own copy of react, which would give the
 * component a different hook dispatcher than the one react-dom renders
 * with. Pinned in Common's jest moduleNameMapper - see
 * Tests/UI/Rum/ReplayStage.test.tsx for why the path-based version broke CI.
 */
import SummaryInfo from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/SummaryInfo";

/*
 * What the "View Summary" modal on Monitoring Logs actually draws for a
 * row, through the same props MonitorLogSummaryUtil builds for the page.
 * The mapping itself is pinned in Tests/Utils/Monitor/MonitorLogSummaryUtil;
 * this checks the reader can see what they came for. On an Incoming Email
 * monitor that is usually one email - a sender's verification email, say -
 * and the modal used to say no email had been received at all.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const MONITOR_STEP_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const PROBE_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");

const RECEIVED_AT: Date = OneUptimeDate.fromString("2026-09-30T09:12:00.000Z");
const CHECKED_AT: Date = OneUptimeDate.fromString("2026-09-30T09:42:30.000Z");
const MONITOR_CREATED_AT: Date = OneUptimeDate.fromString(
  "2026-09-01T08:00:00.000Z",
);

const PASSCODE: string = "482913";
const VERIFY_LINK_HTML: string =
  "https://userlinks.azns.microsofticm.com/verify?code=482913&amp;tenant=contoso";

const NO_EMAIL_MESSAGE: string =
  "No summary available. Looks like no email has been received yet.";

const EVALUATION_SUMMARY: MonitorEvaluationSummary = {
  evaluatedAt: CHECKED_AT,
  criteriaResults: [
    {
      criteriaId: "criteria-offline",
      criteriaName: "No Email In An Hour",
      filterCondition: FilterCondition.Any,
      met: true,
      message: "No email was received in the last 60 minutes.",
      filters: [],
    },
  ],
  events: [],
};

afterEach(() => {
  cleanup();
});

// The body exactly as MonitorLogUtil.saveMonitorLog stores it.
function storeAsMonitorLog(dataToProcess: unknown): JSONObject {
  return redactForPersistence(
    JSON.parse(JSON.stringify(dataToProcess)),
  ) as JSONObject;
}

function verificationEmail(): JSONObject {
  return {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    emailFrom: "azure-noreply@microsoft.com",
    emailTo: "[REDACTED]@inbound.oneuptime.com",
    emailSubject: "Verify your email address for Azure Monitor",
    emailBody: `Use this one-time passcode to verify your email address: ${PASSCODE}`,
    emailBodyHtml: `<p>Your passcode is <b>${PASSCODE}</b>.</p><a href="${VERIFY_LINK_HTML}">Verify</a>`,
    emailHeaders: {
      From: "Microsoft Azure <azure-noreply@microsoft.com>",
      "Content-Type": "multipart/alternative",
    },
    emailReceivedAt: RECEIVED_AT,
    checkedAt: RECEIVED_AT,
    onlyCheckForIncomingEmailReceivedAt: false,
  } as unknown as JSONObject;
}

// The worker's scheduled check, after an email has arrived.
function scheduledCheckAfterEmail(): JSONObject {
  return {
    ...verificationEmail(),
    checkedAt: CHECKED_AT,
    onlyCheckForIncomingEmailReceivedAt: true,
    evaluationSummary: EVALUATION_SUMMARY,
  } as unknown as JSONObject;
}

/*
 * The worker's scheduled check on a monitor that never received an email
 * (Workers/Jobs/IncomingEmailMonitor/CheckOnlineStatus): empty fields, and
 * the monitor's creation time in place of a receive time.
 */
function scheduledCheckWithoutEmail(): JSONObject {
  return {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    emailReceivedAt: MONITOR_CREATED_AT,
    onlyCheckForIncomingEmailReceivedAt: true,
    checkedAt: CHECKED_AT,
    emailFrom: "",
    emailTo: "",
    emailSubject: "",
    emailBody: "",
    evaluationSummary: EVALUATION_SUMMARY,
  } as unknown as JSONObject;
}

function renderLogRow(data: {
  monitorType: MonitorType;
  body: unknown;
  probeName?: string | undefined;
}): void {
  render(
    <SummaryInfo
      {...MonitorLogSummaryUtil.toSummaryInfoProps({
        monitorType: data.monitorType,
        logBody: storeAsMonitorLog(data.body),
        monitoredAt: CHECKED_AT,
        probeName: data.probeName,
      })}
    />,
  );
}

// The value an InfoCard shows under `title`.
function infoCardValue(title: string): string {
  // Every InfoCard's outer element is rounded-xl.
  const card: HTMLElement | null = screen
    .getByText(title)
    .closest(".rounded-xl");

  expect(card).not.toBeNull();

  return (card!.textContent || "").replace(title, "").trim();
}

function formatted(date: Date): string {
  return OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(date);
}

describe("Monitoring Logs > View Summary on an Incoming Email monitor", () => {
  it("shows the email the row recorded instead of saying none arrived", () => {
    renderLogRow({
      monitorType: MonitorType.IncomingEmail,
      body: verificationEmail(),
    });

    expect(screen.queryByText(NO_EMAIL_MESSAGE)).not.toBeInTheDocument();
    expect(infoCardValue("From")).toBe("azure-noreply@microsoft.com");
    expect(infoCardValue("Subject")).toBe(
      "Verify your email address for Azure Monitor",
    );
    expect(infoCardValue("Last Email Received At")).toBe(
      formatted(RECEIVED_AT),
    );
  });

  it("opens the email's body, where a verification code or link is", () => {
    renderLogRow({
      monitorType: MonitorType.IncomingEmail,
      body: verificationEmail(),
    });

    fireEvent.click(screen.getByText("Show More Details"));

    expect(screen.getByText("Email Body (Text)")).toBeInTheDocument();
    expect(
      screen.getByText(
        `Use this one-time passcode to verify your email address: ${PASSCODE}`,
      ),
    ).toBeInTheDocument();

    expect(screen.getByText("Email Body (HTML)")).toBeInTheDocument();

    /*
     * CodeBlock draws each JSON / HTML field as <pre><code>, highlighted by
     * hljs; the text of the block is still the source.
     */
    const sources: Array<string> = Array.from(
      document.querySelectorAll("pre code"),
    ).map((block: Element): string => {
      return block.textContent || "";
    });

    /*
     * The HTML body is shown as source, so a link in it still reads &amp;
     * - which is why the docs say to change it back to & before opening it.
     */
    expect(
      sources.some((source: string): boolean => {
        return source.includes(VERIFY_LINK_HTML);
      }),
    ).toBe(true);
    expect(
      sources.some((source: string): boolean => {
        return source.includes("multipart/alternative");
      }),
    ).toBe(true);
  });

  it("shows a scheduled check with the email it measured and when it ran", () => {
    renderLogRow({
      monitorType: MonitorType.IncomingEmail,
      body: scheduledCheckAfterEmail(),
    });

    expect(infoCardValue("Subject")).toBe(
      "Verify your email address for Azure Monitor",
    );
    expect(infoCardValue("Last Email Received At")).toBe(
      formatted(RECEIVED_AT),
    );
    expect(infoCardValue("Monitor Status Check At")).toBe(
      formatted(CHECKED_AT),
    );
    expect(screen.getByText("No Email In An Hour")).toBeInTheDocument();
  });

  it("says no email had arrived for a check on a monitor that never received one", () => {
    renderLogRow({
      monitorType: MonitorType.IncomingEmail,
      body: scheduledCheckWithoutEmail(),
    });

    /*
     * Not the monitor's creation time, which the check stands in for the
     * receive time so a "not received in N minutes" criteria can count.
     */
    expect(infoCardValue("Last Email Received At")).toBe("No email yet");
    expect(
      screen.queryByText(formatted(MONITOR_CREATED_AT)),
    ).not.toBeInTheDocument();
    expect(infoCardValue("From")).toBe("-");
    expect(infoCardValue("Subject")).toBe("-");
    expect(screen.queryByText("Show More Details")).not.toBeInTheDocument();

    // And the evaluation that explains the verdict is still there.
    expect(screen.getByText("No Email In An Hour")).toBeInTheDocument();
  });
});

describe("An incident opened by a scheduled check on a monitor that never received mail", () => {
  it("says no email had arrived rather than dating one to the monitor's creation", () => {
    const snapshot: MonitorSummarySnapshot | null =
      MonitorSummarySnapshotUtil.buildSnapshot({
        monitorType: MonitorType.IncomingEmail,
        dataToProcess:
          scheduledCheckWithoutEmail() as unknown as MonitorSummaryDataToProcess,
        evaluationSummary: EVALUATION_SUMMARY,
        capturedAt: CHECKED_AT,
      });

    const stored: MonitorSummarySnapshot =
      MonitorSummarySnapshotUtil.deserialize(
        JSON.parse(
          JSON.stringify(MonitorSummarySnapshotUtil.serialize(snapshot)),
        ) as JSONObject,
      )!;

    render(
      <SummaryInfo
        {...MonitorSummarySnapshotUtil.toSummaryInfoProps(stored)}
      />,
    );

    expect(infoCardValue("Last Email Received At")).toBe("No email yet");
    expect(
      screen.queryByText(formatted(MONITOR_CREATED_AT)),
    ).not.toBeInTheDocument();
  });
});

describe("Monitoring Logs > View Summary for the other families, through the new routing", () => {
  it("shows a website check and the probe that ran it", () => {
    renderLogRow({
      monitorType: MonitorType.Website,
      probeName: "Frankfurt",
      body: {
        projectId: PROJECT_ID,
        monitorId: MONITOR_ID,
        monitorStepId: MONITOR_STEP_ID,
        probeId: PROBE_ID,
        isOnline: false,
        responseCode: 503,
        responseTimeInMs: 812,
        failureCause: "Service Unavailable",
        monitoredAt: CHECKED_AT,
        evaluationSummary: EVALUATION_SUMMARY,
      },
    });

    expect(infoCardValue("Probe")).toBe("Frankfurt");
    expect(infoCardValue("Response Status Code")).toBe("503");
    expect(screen.getByText("No Email In An Hour")).toBeInTheDocument();
  });

  it("shows an incoming request", () => {
    renderLogRow({
      monitorType: MonitorType.IncomingRequest,
      body: {
        projectId: PROJECT_ID,
        monitorId: MONITOR_ID,
        incomingRequestReceivedAt: RECEIVED_AT,
        checkedAt: CHECKED_AT,
        requestMethod: "POST",
        requestHeaders: { "content-type": "application/json" },
      },
    });

    expect(infoCardValue("Request Method")).toBe("POST");
    expect(infoCardValue("Last Request Received At")).toBe(
      formatted(RECEIVED_AT),
    );
  });

  it("shows a server report", () => {
    renderLogRow({
      monitorType: MonitorType.Server,
      body: {
        projectId: PROJECT_ID,
        monitorId: MONITOR_ID,
        hostname: "orders-db-01",
        requestReceivedAt: RECEIVED_AT,
        onlyCheckRequestReceivedAt: false,
      },
    });

    expect(infoCardValue("Hostname")).toBe("orders-db-01");
  });

  it("dates a telemetry evaluation to its row", () => {
    renderLogRow({
      monitorType: MonitorType.Logs,
      body: {
        projectId: PROJECT_ID,
        monitorId: MONITOR_ID,
        logCount: 12,
        evaluationSummary: EVALUATION_SUMMARY,
      },
    });

    expect(infoCardValue("Monitored At")).toBe(formatted(CHECKED_AT));
  });
});
