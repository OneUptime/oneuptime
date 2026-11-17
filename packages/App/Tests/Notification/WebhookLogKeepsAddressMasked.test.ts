import WebhookService from "../../FeatureSet/Notification/Services/WebhookService";
import UserOnCallLogTimelineService from "Common/Server/Services/UserOnCallLogTimelineService";
import WebhookLogService from "Common/Server/Services/WebhookLogService";
import SSRFProtection from "Common/Server/Utils/SSRFProtection";
import WebhookLog from "Common/Models/DatabaseModels/WebhookLog";
import { approveEveryWebhookAddress } from "Common/Tests/Server/TestingUtils/WebhookAddressCheck";
import OnCallTimelineRows from "Common/Tests/Server/TestingUtils/OnCallTimelineRows";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import UserNotificationStatus from "Common/Types/UserNotification/UserNotificationStatus";
import WebhookStatus from "Common/Types/WebhookStatus";
import WebhookAddressMask from "Common/Utils/WebhookAddressMask";
import API from "Common/Utils/API";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    EXTERNAL_FAULT: {},
    default: {
      debug: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
    },
  };
});

/*
 * A WEBHOOK'S LOG KEEPS ITS ADDRESS MASKED (#9013).
 *
 * A webhook's address is its credential - a Slack, Teams or Discord
 * webhook's secret is in its path - kept encrypted at rest and read back by
 * its owner alone. The log of what was sent to it is read by everyone who
 * reads the project's notification logs, so it keeps the address's scheme
 * and host alone (WebhookAddressMask), and so does every message it keeps:
 * an error that quotes the address, and the page's on-call log entry.
 * The webhook itself is posted to at its whole address.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "90130000-0000-4000-8000-000000000501",
);
const TIMELINE_ID: ObjectID = new ObjectID(
  "90130000-0000-4000-8000-000000000502",
);
const SECRET_PATH: string = "services/T00000000/B00000000/XXXXXXXXXXXXXXXX";
const ADDRESS: string = `https://hooks.slack.com/${SECRET_PATH}`;
const MASKED: string = `https://hooks.slack.com/${WebhookAddressMask.MASK}`;

let post: SpyInstance<typeof API.post>;
let logs: Array<WebhookLog>;
let timeline: OnCallTimelineRows;

function send(): Promise<void> {
  return WebhookService.sendWebhook(
    {
      url: ADDRESS,
      eventType: "on-call.incident.created",
      payload: { incident: "Checkout API is down" },
    },
    { projectId: PROJECT_ID, userOnCallLogTimelineId: TIMELINE_ID },
  );
}

function onlyLog(): WebhookLog {
  expect(logs).toHaveLength(1);
  return logs[0]!;
}

beforeEach(() => {
  approveEveryWebhookAddress();
  post = jest
    .spyOn(API, "post")
    .mockResolvedValue(
      new HTTPResponse<JSONObject>(200, { ok: true }, {}) as never,
    ) as unknown as SpyInstance<typeof API.post>;

  logs = [];
  jest.spyOn(WebhookLogService, "create").mockImplementation((async (input: {
    data: WebhookLog;
  }) => {
    logs.push(input.data);
    return input.data;
  }) as never);

  timeline = new OnCallTimelineRows();
  timeline.add(TIMELINE_ID, UserNotificationStatus.Sending);
  timeline.standIn(UserOnCallLogTimelineService);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a webhook's log", () => {
  test("keeps the address it was posted to by its scheme and host alone", async () => {
    await send();

    // Posted to at its whole address.
    expect(String(post.mock.calls[0]![0].url)).toContain(SECRET_PATH);

    expect(onlyLog().status).toBe(WebhookStatus.Success);
    expect(onlyLog().webhookUrl).toBe(MASKED);
    expect(JSON.stringify(onlyLog())).not.toContain(SECRET_PATH);
  });

  test("an error that quotes the address is kept with it masked, on the log and the page's on-call entry", async () => {
    post.mockRejectedValue(
      new Error(`connect ECONNREFUSED while posting to ${ADDRESS}`) as never,
    );

    await expect(send()).rejects.toThrow("ECONNREFUSED");

    expect(onlyLog().status).toBe(WebhookStatus.Error);
    expect(onlyLog().statusMessage).toBe(
      `connect ECONNREFUSED while posting to ${MASKED}`,
    );
    expect(JSON.stringify(onlyLog())).not.toContain(SECRET_PATH);

    expect(timeline.get(TIMELINE_ID)!.status).toBe(
      UserNotificationStatus.Error,
    );
    expect(timeline.get(TIMELINE_ID)!.statusMessage).toBe(
      `connect ECONNREFUSED while posting to ${MASKED}`,
    );
  });

  test("an address refused before it is posted to is kept masked too", async () => {
    (
      SSRFProtection.validateAndResolveWebhookTarget as unknown as jest.Mock
    ).mockRejectedValue(
      new Error(`${ADDRESS} resolves to a private network address`) as never,
    );

    await expect(send()).rejects.toThrow("private network");

    expect(post).not.toHaveBeenCalled();
    expect(onlyLog().webhookUrl).toBe(MASKED);
    expect(onlyLog().statusMessage).toBe(
      `${MASKED} resolves to a private network address`,
    );
  });
});
