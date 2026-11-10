import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import IncomingMonitorRequest from "../../../Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import SummaryInfo from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/SummaryInfo";
import {
  INCOMING_REQUEST_CONTENT_NOT_SHOWN_TEST_ID,
  INCOMING_REQUEST_SECRETS_MASKED_TEST_ID,
  REQUEST_CONTENT_NOT_SHOWN,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/IncomingRequestMonitorSummaryView";
import { SECRETS_IN_REQUEST_ARE_MASKED } from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/EventEvaluationDetailsCopy";

/*
 * AN INCOMING REQUEST MONITOR'S OVERVIEW SHOWS THE LATEST REQUEST AS ITS
 * LOGS KEEP IT (#6402).
 *
 * The server hands the overview the copy people read: secrets and personal
 * data masked, and no headers or body at all - isResponseContentOmitted -
 * when the monitor keeps no request content. The overview says which: a
 * request whose content was left out has nothing to fold out and says why,
 * and the details it does fold out say that secrets in them are masked.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const RECEIVED_AT: Date = new Date("2026-11-09T08:00:00.000Z");

function overview(request: Partial<IncomingMonitorRequest>): void {
  render(
    <SummaryInfo
      monitorType={MonitorType.IncomingRequest}
      incomingMonitorRequest={
        {
          projectId: PROJECT_ID,
          monitorId: MONITOR_ID,
          incomingRequestReceivedAt: RECEIVED_AT,
          requestMethod: "POST",
          checkedAt: RECEIVED_AT,
          ...request,
        } as unknown as IncomingMonitorRequest
      }
      incomingRequestMonitorHeartbeatCheckedAt={RECEIVED_AT}
    />,
  );
}

function showMoreDetails(): void {
  fireEvent.click(screen.getByRole("button", { name: "Show More Details" }));
}

afterEach(() => {
  cleanup();
});

describe("the overview of a monitor that keeps no request content", () => {
  test("says the headers and body are not shown, and has nothing to fold out", () => {
    overview({ isResponseContentOmitted: true });

    expect(
      screen.getByTestId(INCOMING_REQUEST_CONTENT_NOT_SHOWN_TEST_ID),
    ).toHaveTextContent(REQUEST_CONTENT_NOT_SHOWN);
    expect(
      screen.queryByRole("button", { name: "Show More Details" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Request Headers")).not.toBeInTheDocument();
    expect(screen.queryByText("Request Body")).not.toBeInTheDocument();
  });

  test("still shows when the request came and its method", () => {
    overview({ isResponseContentOmitted: true });

    expect(screen.getByText("Last Request Received At")).toBeInTheDocument();
    expect(screen.getByText("POST")).toBeInTheDocument();
  });
});

describe("the overview of a monitor that keeps its request content", () => {
  const MASKED: Partial<IncomingMonitorRequest> = {
    requestHeaders: {
      "content-type": "application/json",
      authorization: "[REDACTED]",
    },
    requestBody: { status: "deployed", deployedBy: "[REDACTED]" },
  };

  test("does not say content was left out", () => {
    overview(MASKED);

    expect(
      screen.queryByTestId(INCOMING_REQUEST_CONTENT_NOT_SHOWN_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("folds out the headers and body as they were kept, and says secrets in them are masked", () => {
    overview(MASKED);

    expect(
      screen.queryByTestId(INCOMING_REQUEST_SECRETS_MASKED_TEST_ID),
    ).not.toBeInTheDocument();

    showMoreDetails();

    expect(screen.getByText("Request Headers")).toBeInTheDocument();
    expect(screen.getByText("Request Body")).toBeInTheDocument();
    expect(
      screen.getByTestId(INCOMING_REQUEST_SECRETS_MASKED_TEST_ID),
    ).toHaveTextContent(SECRETS_IN_REQUEST_ARE_MASKED);
    expect(document.body.textContent).toContain("[REDACTED]");
  });

  test("a request with a body and no headers folds out the body alone", () => {
    overview({ requestBody: { status: "deployed" } });

    showMoreDetails();

    expect(screen.getByText("Request Body")).toBeInTheDocument();
    expect(screen.queryByText("Request Headers")).not.toBeInTheDocument();
  });

  test("a request with headers and no body folds out the headers alone", () => {
    overview({ requestHeaders: { "content-type": "text/plain" } });

    showMoreDetails();

    expect(screen.getByText("Request Headers")).toBeInTheDocument();
    expect(screen.queryByText("Request Body")).not.toBeInTheDocument();
  });

  test("a request with neither has nothing to fold out, and says nothing was left out", () => {
    overview({});

    expect(
      screen.queryByRole("button", { name: "Show More Details" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(INCOMING_REQUEST_CONTENT_NOT_SHOWN_TEST_ID),
    ).not.toBeInTheDocument();
  });
});
