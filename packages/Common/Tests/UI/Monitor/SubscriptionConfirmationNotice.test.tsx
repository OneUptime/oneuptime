import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import MonitorRecordEvidence from "../../../Server/Utils/Monitor/MonitorRecordEvidence";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import IncomingMonitorRequest from "../../../Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import {
  MASKED_VALUE,
  SubscriptionConfirmationAction,
} from "../../../Utils/Monitor/IncomingRequestSubscriptionConfirmation";
import {
  EVENT_GRID_TOPIC,
  EVENT_GRID_VALIDATION_URL,
  SNS_CONFIRMATION_HEADERS,
  SNS_SUBSCRIBE_URL,
  SNS_TOKEN,
  SNS_TOPIC_ARN,
  eventGridValidation,
  snsNotification,
  snsSubscriptionConfirmation,
  snsUnsubscribeConfirmation,
} from "../../Utils/Monitor/SubscriptionConfirmationFixtures";

/*
 * THE MONITOR'S SUMMARY OFFERS THE LINK THAT CONFIRMS A SUBSCRIPTION.
 *
 * https://github.com/OneUptime/oneuptime/issues/7723
 *
 * A customer pointed an Amazon SNS topic at an Incoming Request monitor and
 * could not confirm the subscription: the SubscribeURL the monitor showed
 * ended in &Token=[REDACTED]. The copies people read keep that link now,
 * and the request's summary leads with it: what the service is waiting
 * for, the topic, and one button that opens the link - on the overview's
 * Monitor Summary card and wherever else the request is shown (a
 * Monitoring Logs row, an incident's summary). A link that can no longer
 * be opened is never offered: the notice says how to get a new one.
 */

// The overview card imports Test Monitor's form: present, never called here.
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
import SubscriptionConfirmationNotice, {
  SUBSCRIPTION_CONFIRMATION_COPY,
  SUBSCRIPTION_CONFIRMATION_LINK_GONE_TEST_ID,
  SUBSCRIPTION_CONFIRMATION_LINK_TEST_ID,
  SUBSCRIPTION_CONFIRMATION_NOTICE_TEST_ID,
  SUBSCRIPTION_NOTICE_STAYS,
  SUBSCRIPTION_TOPIC_LABEL,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/IncomingRequestMonitor/SubscriptionConfirmationNotice";

const PROJECT_ID: ObjectID = new ObjectID(
  "7723bbbb-0000-4000-8000-000000000001",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "7723bbbb-0000-4000-8000-000000000002",
);

const MINUTE: number = 60 * 1000;
const DAY: number = 24 * 60 * MINUTE;

// A time this long ago, as the services write it.
function ago(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

// A confirmation SNS sent a minute ago: its link still works.
function freshConfirmation(overrides: JSONObject = {}): JSONObject {
  return snsSubscriptionConfirmation({ Timestamp: ago(MINUTE), ...overrides });
}

function request(
  requestBody: JSONObject | JSONArray | undefined,
  extra: Partial<IncomingMonitorRequest> = {},
): IncomingMonitorRequest {
  return {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    requestMethod: "POST",
    requestHeaders: { ...SNS_CONFIRMATION_HEADERS },
    requestBody: requestBody as JSONObject,
    incomingRequestReceivedAt: new Date(),
    checkedAt: new Date(),
    ...extra,
  } as unknown as IncomingMonitorRequest;
}

// The monitor's overview: its Monitor Summary card, as the View page draws it.
function overview(incomingMonitorRequest: IncomingMonitorRequest): void {
  render(
    <Summary
      monitorType={MonitorType.IncomingRequest}
      monitorId={MONITOR_ID}
      incomingMonitorRequest={incomingMonitorRequest}
      incomingRequestMonitorHeartbeatCheckedAt={new Date()}
    />,
  );
}

function notice(): HTMLElement | null {
  return screen.queryByTestId(SUBSCRIPTION_CONFIRMATION_NOTICE_TEST_ID);
}

function link(): HTMLAnchorElement | null {
  return screen.queryByTestId(
    SUBSCRIPTION_CONFIRMATION_LINK_TEST_ID,
  ) as HTMLAnchorElement | null;
}

const CONFIRM: (typeof SUBSCRIPTION_CONFIRMATION_COPY)[SubscriptionConfirmationAction] =
  SUBSCRIPTION_CONFIRMATION_COPY[
    SubscriptionConfirmationAction.ConfirmSubscription
  ];
const RESTORE: (typeof SUBSCRIPTION_CONFIRMATION_COPY)[SubscriptionConfirmationAction] =
  SUBSCRIPTION_CONFIRMATION_COPY[
    SubscriptionConfirmationAction.RestoreSubscription
  ];
const VALIDATE: (typeof SUBSCRIPTION_CONFIRMATION_COPY)[SubscriptionConfirmationAction] =
  SUBSCRIPTION_CONFIRMATION_COPY[
    SubscriptionConfirmationAction.ValidateSubscription
  ];

afterEach(() => {
  cleanup();
});

describe("the overview of a monitor whose latest request is an SNS subscription confirmation", () => {
  test("says what SNS is waiting for, and for which topic", () => {
    overview(request(freshConfirmation()));

    expect(notice()).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: CONFIRM.title }),
    ).toBeInTheDocument();
    expect(screen.getByText(CONFIRM.description)).toBeInTheDocument();
    expect(screen.getByText(SUBSCRIPTION_TOPIC_LABEL)).toBeInTheDocument();
    expect(screen.getByText(SNS_TOPIC_ARN)).toBeInTheDocument();
  });

  test("offers one button that opens the confirmation link in a new tab, sending no referrer", () => {
    overview(request(freshConfirmation()));

    const button: HTMLAnchorElement = link()!;

    expect(button).toHaveTextContent(CONFIRM.button);
    expect(button.getAttribute("href")).toBe(SNS_SUBSCRIBE_URL);
    expect(button.getAttribute("target")).toBe("_blank");
    expect(button.getAttribute("rel")).toContain("noopener");
    expect(button.getAttribute("rel")).toContain("noreferrer");
    expect(
      screen.getAllByRole("link", { name: new RegExp(CONFIRM.button) }),
    ).toHaveLength(1);
  });

  test("says until when the link works, and that the note stays until the next request", () => {
    overview(request(freshConfirmation()));

    expect(screen.getByText(/^The link works until /)).toBeInTheDocument();
    expect(screen.getByText(SUBSCRIPTION_NOTICE_STAYS)).toBeInTheDocument();
  });

  test("leads the summary, above the request's facts", () => {
    overview(request(freshConfirmation()));

    const summary: HTMLElement = screen.getByTestId(
      "incoming-request-monitor-summary",
    );
    const facts: HTMLElement = screen.getByText("Last Request Received At");

    expect(summary.firstElementChild).toBe(notice());
    expect(
      notice()!.compareDocumentPosition(facts) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("still folds out the request, its link unmasked", () => {
    overview(request(freshConfirmation()));

    fireEvent.click(screen.getByRole("button", { name: "Show More Details" }));

    expect(document.body.textContent).toContain(SNS_TOKEN);
  });
});

describe("the request as the server keeps it for its readers", () => {
  /*
   * End to end: the request cut as everyone who can read the monitor reads
   * it (Monitor.incomingMonitorRequest) and read back from JSON, as the
   * API hands it to the overview.
   */
  test("offers the link, and still keeps the signature masked", () => {
    const readersCopy: IncomingMonitorRequest = JSON.parse(
      JSON.stringify(
        MonitorRecordEvidence.toStoredLatestRequest({
          request: request(freshConfirmation()),
          keepResponseContent: true,
        }),
      ),
    );

    overview(readersCopy);

    expect(link()!.getAttribute("href")).toBe(SNS_SUBSCRIBE_URL);

    fireEvent.click(screen.getByRole("button", { name: "Show More Details" }));

    expect(document.body.textContent).toContain('"Signature": "[REDACTED]"');
  });

  test("of a monitor that keeps no request content offers nothing", () => {
    overview(
      MonitorRecordEvidence.toStoredLatestRequest({
        request: request(freshConfirmation()),
        keepResponseContent: false,
      }),
    );

    expect(notice()).not.toBeInTheDocument();
  });
});

describe("an SNS UnsubscribeConfirmation", () => {
  test("says the subscription was deleted, and offers to restore it", () => {
    overview(request(snsUnsubscribeConfirmation({ Timestamp: ago(MINUTE) })));

    expect(
      screen.getByRole("heading", { name: RESTORE.title }),
    ).toBeInTheDocument();
    expect(screen.getByText(RESTORE.description)).toBeInTheDocument();
    expect(link()).toHaveTextContent(RESTORE.button);
    expect(link()!.getAttribute("href")).toBe(SNS_SUBSCRIBE_URL);
  });
});

describe("an Azure Event Grid validation", () => {
  test("asks to validate the event subscription, for its topic, with its link", () => {
    overview(
      request(
        eventGridValidation().map((event: unknown): JSONObject => {
          return { ...(event as JSONObject), eventTime: ago(MINUTE) };
        }),
        { requestHeaders: { "aeg-event-type": "SubscriptionValidation" } },
      ),
    );

    expect(
      screen.getByRole("heading", { name: VALIDATE.title }),
    ).toBeInTheDocument();
    expect(screen.getByText(VALIDATE.description)).toBeInTheDocument();
    expect(screen.getByText(EVENT_GRID_TOPIC)).toBeInTheDocument();
    expect(link()).toHaveTextContent(VALIDATE.button);
    expect(link()!.getAttribute("href")).toBe(EVENT_GRID_VALIDATION_URL);
  });

  test("past its 10 minutes says how to get a new link instead", () => {
    overview(
      request(
        eventGridValidation().map((event: unknown): JSONObject => {
          return { ...(event as JSONObject), eventTime: ago(11 * MINUTE) };
        }),
      ),
    );

    expect(link()).not.toBeInTheDocument();
    expect(
      screen.getByTestId(SUBSCRIPTION_CONFIRMATION_LINK_GONE_TEST_ID),
    ).toHaveTextContent(VALIDATE.linkGone);
  });
});

describe("a link that can no longer be opened is never offered", () => {
  test("an SNS confirmation older than two days says to request a new one", () => {
    overview(request(snsSubscriptionConfirmation({ Timestamp: ago(3 * DAY) })));

    expect(notice()).toBeInTheDocument();
    expect(link()).not.toBeInTheDocument();
    expect(
      screen.getByTestId(SUBSCRIPTION_CONFIRMATION_LINK_GONE_TEST_ID),
    ).toHaveTextContent(CONFIRM.linkGone);
    expect(screen.queryByText(SUBSCRIPTION_NOTICE_STAYS)).toBeNull();
  });

  test("a copy kept before the link was says to request a new one", () => {
    overview(
      request(
        freshConfirmation({
          Token: MASKED_VALUE,
          SubscribeURL: SNS_SUBSCRIBE_URL.replace(
            `Token=${SNS_TOKEN}`,
            `Token=${MASKED_VALUE}`,
          ),
        }),
      ),
    );

    expect(link()).not.toBeInTheDocument();
    expect(
      screen.getByTestId(SUBSCRIPTION_CONFIRMATION_LINK_GONE_TEST_ID),
    ).toHaveTextContent(CONFIRM.linkGone);
  });

  test("a deleted subscription past its window says to create it again", () => {
    overview(request(snsUnsubscribeConfirmation({ Timestamp: ago(3 * DAY) })));

    expect(
      screen.getByTestId(SUBSCRIPTION_CONFIRMATION_LINK_GONE_TEST_ID),
    ).toHaveTextContent(RESTORE.linkGone);
  });
});

describe("a request that is not a subscription confirmation", () => {
  test.each([
    ["a heartbeat", { status: "up" } as JSONObject],
    ["an SNS notification", snsNotification()],
    [
      "a confirmation whose link is off SNS's own hosts",
      freshConfirmation({
        SubscribeURL: SNS_SUBSCRIBE_URL.replace(
          "sns.eu-west-1.amazonaws.com",
          "evil.example",
        ),
      }),
    ],
  ])("%s shows no notice", (_label: string, body: JSONObject) => {
    overview(request(body));

    expect(notice()).not.toBeInTheDocument();
    expect(screen.getByText("Last Request Received At")).toBeInTheDocument();
  });
});

describe("a Monitoring Logs row or an incident's summary of a confirmation", () => {
  test("offers the link too", () => {
    render(
      <SummaryInfo
        monitorType={MonitorType.IncomingRequest}
        incomingMonitorRequest={request(freshConfirmation())}
      />,
    );

    expect(link()!.getAttribute("href")).toBe(SNS_SUBSCRIBE_URL);
  });
});

describe("the notice on its own", () => {
  test("judges the link's window at the moment it is given", () => {
    const body: JSONObject = snsSubscriptionConfirmation();
    const sentAt: number = new Date(body["Timestamp"] as string).getTime();

    render(
      <SubscriptionConfirmationNotice
        requestBody={body}
        now={new Date(sentAt + 2 * DAY - 1)}
      />,
    );

    expect(link()).toBeInTheDocument();

    cleanup();

    render(
      <SubscriptionConfirmationNotice
        requestBody={body}
        now={new Date(sentAt + 2 * DAY)}
      />,
    );

    expect(link()).not.toBeInTheDocument();
  });

  test("with no time the service sent it offers the link, and no end to its window", () => {
    render(
      <SubscriptionConfirmationNotice
        requestBody={snsSubscriptionConfirmation({ Timestamp: "unknown" })}
      />,
    );

    expect(link()).toBeInTheDocument();
    expect(screen.queryByText(/^The link works until /)).toBeNull();
    expect(screen.getByText(SUBSCRIPTION_NOTICE_STAYS)).toBeInTheDocument();
  });

  test("draws nothing for no body", () => {
    const { container } = render(
      <SubscriptionConfirmationNotice requestBody={undefined} />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
