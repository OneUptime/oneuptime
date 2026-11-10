import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import { JSONObject } from "../../../Types/JSON";
import IncomingMonitorRequest from "../../../Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import MonitorLogSummaryUtil from "../../../Utils/Monitor/MonitorLogSummaryUtil";
import { MonitorSummaryInfoProps } from "../../../Utils/Monitor/MonitorSummarySnapshotUtil";

/*
 * AN INCOMING REQUEST MONITOR'S OVERVIEW SHOWS THE LATEST REQUEST AS ITS
 * LOGS KEEP IT (#6402).
 *
 * The server hands the overview the copy people read: secrets and personal
 * data masked, and no headers or body at all - isResponseContentOmitted -
 * when the monitor keeps no request content. The overview says which: a
 * request whose content was left out has nothing to fold out and says why,
 * and the details it does fold out say that secrets in them are masked.
 *
 * The same view draws a Monitoring Logs row's request and the summary an
 * incident or an alert keeps. Those may hold a request kept before copies
 * were cut, so they fold out what they hold without saying it is masked;
 * a row whose content was left out still says so.
 */

/*
 * The overview card (Summary) imports Test Monitor's form, which reads the
 * API, the member's permissions and the user: present, never called here.
 */
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      create: (): Promise<never> => {
        return Promise.reject(new Error("not used"));
      },
      getItem: (): Promise<null> => {
        return Promise.resolve(null);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return [];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

import Summary from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/Summary";
import SummaryInfo from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/SummaryInfo";
import {
  INCOMING_REQUEST_CONTENT_NOT_SHOWN_TEST_ID,
  INCOMING_REQUEST_SECRETS_MASKED_TEST_ID,
  REQUEST_CONTENT_NOT_SHOWN,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/SummaryView/IncomingRequestMonitorSummaryView";
import { SECRETS_IN_REQUEST_ARE_MASKED } from "../../../../App/FeatureSet/Dashboard/src/Components/EventView/EventEvaluationDetailsCopy";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const RECEIVED_AT: Date = new Date("2026-11-09T08:00:00.000Z");

function request(
  extra: Partial<IncomingMonitorRequest>,
): IncomingMonitorRequest {
  return {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    incomingRequestReceivedAt: RECEIVED_AT,
    requestMethod: "POST",
    checkedAt: RECEIVED_AT,
    ...extra,
  } as unknown as IncomingMonitorRequest;
}

// The monitor's overview: its Monitor Summary card, as the View page draws it.
function overview(extra: Partial<IncomingMonitorRequest>): void {
  render(
    <Summary
      monitorType={MonitorType.IncomingRequest}
      monitorId={MONITOR_ID}
      incomingMonitorRequest={request(extra)}
      incomingRequestMonitorHeartbeatCheckedAt={RECEIVED_AT}
    />,
  );
}

/*
 * The same request drawn where it may have been kept before copies were
 * cut: a Monitoring Logs row's summary, or the summary an incident or an
 * alert keeps (MonitorSummarySnapshotCard).
 */
function storedSummary(extra: Partial<IncomingMonitorRequest>): void {
  render(
    <SummaryInfo
      monitorType={MonitorType.IncomingRequest}
      incomingMonitorRequest={request(extra)}
      incomingRequestMonitorHeartbeatCheckedAt={RECEIVED_AT}
    />,
  );
}

function showMoreDetails(): void {
  fireEvent.click(screen.getByRole("button", { name: "Show More Details" }));
}

const MASKED: Partial<IncomingMonitorRequest> = {
  requestHeaders: {
    "content-type": "application/json",
    authorization: "[REDACTED]",
  },
  requestBody: { status: "deployed", deployedBy: "[REDACTED]" },
};

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
    expect(
      screen.queryByTestId(INCOMING_REQUEST_SECRETS_MASKED_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("still shows when the request came and its method", () => {
    overview({ isResponseContentOmitted: true });

    expect(screen.getByText("Last Request Received At")).toBeInTheDocument();
    expect(screen.getByText("POST")).toBeInTheDocument();
  });
});

describe("the overview of a monitor that keeps its request content", () => {
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

  test("Hide Details folds them away again, the line with them", () => {
    overview(MASKED);

    showMoreDetails();
    fireEvent.click(screen.getByRole("button", { name: "Hide Details" }));

    expect(screen.queryByText("Request Headers")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId(INCOMING_REQUEST_SECRETS_MASKED_TEST_ID),
    ).not.toBeInTheDocument();
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

describe("a request kept in a Monitoring Logs row, or in an incident's or an alert's summary", () => {
  test("folds out what it holds without saying it is masked: it may have been kept before copies were cut", () => {
    storedSummary({
      requestHeaders: { authorization: "Bearer kept-before-the-upgrade" },
      requestBody: { status: "deployed" },
    });

    showMoreDetails();

    expect(screen.getByText("Request Headers")).toBeInTheDocument();
    expect(screen.getByText("Request Body")).toBeInTheDocument();
    expect(
      screen.queryByTestId(INCOMING_REQUEST_SECRETS_MASKED_TEST_ID),
    ).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(
      SECRETS_IN_REQUEST_ARE_MASKED,
    );
  });

  test("a Monitoring Logs row of a monitor that keeps no request content says its headers and body are not shown", () => {
    // The row as the logs keep it (MonitorRecordEvidence.redactCheck), read back from JSON.
    const logBody: JSONObject = JSON.parse(
      JSON.stringify(request({ isResponseContentOmitted: true })),
    ) as JSONObject;

    const props: MonitorSummaryInfoProps =
      MonitorLogSummaryUtil.toSummaryInfoProps({
        monitorType: MonitorType.IncomingRequest,
        logBody: logBody,
        monitoredAt: RECEIVED_AT,
      });

    render(<SummaryInfo {...props} />);

    expect(
      screen.getByTestId(INCOMING_REQUEST_CONTENT_NOT_SHOWN_TEST_ID),
    ).toHaveTextContent(REQUEST_CONTENT_NOT_SHOWN);
    expect(
      screen.queryByRole("button", { name: "Show More Details" }),
    ).not.toBeInTheDocument();
  });

  /*
   * An incident's summary keeps the request with no headers or body and
   * says so once, on the snapshot (MonitorSummarySnapshot
   * .isResponseContentOmitted, MonitorSummarySnapshotCard): the request
   * inside carries no flag, so the view adds no second line.
   */
  test("an incident's summary of a request kept without content draws no line of its own and nothing to fold out", () => {
    storedSummary({});

    expect(
      screen.queryByTestId(INCOMING_REQUEST_CONTENT_NOT_SHOWN_TEST_ID),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Show More Details" }),
    ).not.toBeInTheDocument();
  });
});
