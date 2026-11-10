import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A CUSTOM CHANNEL'S REQUESTS AS CORE COUNTS THEM (issue #6600).
 *
 * The Enterprise Edition's sender counts every request it handles
 * (CustomChannelSender). Core counts only what never reaches it: a request
 * refused because the feature is not active - not sent - and one whose
 * hand-over got no answer - a failure. A request the sender answered is
 * never counted here as well, and a test is not counted at all.
 */

interface RecordedCall {
  value: number;
  attributes: Record<string, string>;
}

const sendCounterCalls: Array<RecordedCall> = [];

jest.mock("../../../Server/Utils/Telemetry/AppMetrics", () => {
  return {
    __esModule: true,
    default: {
      getNotificationCounter: () => {
        return {
          add: (value: number, attributes: Record<string, string>): void => {
            sendCounterCalls.push({ value, attributes });
          },
        };
      },
      getNotificationDuration: () => {
        return { record: jest.fn() };
      },
    },
  };
});

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

import CustomNotificationChannelDeliveryService from "../../../Server/Services/CustomNotificationChannelDeliveryService";
import ProjectService from "../../../Server/Services/ProjectService";
import UserOnCallLogTimelineService from "../../../Server/Services/UserOnCallLogTimelineService";
import CustomChannelEdition from "../../../Server/Utils/Notification/CustomChannelEdition";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import API from "../../../Utils/API";

const CHANNEL_ID: ObjectID = new ObjectID(
  "66005555-0000-4000-8000-000000000001",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "66005555-0000-4000-8000-000000000002",
);
const TIMELINE_ID: ObjectID = new ObjectID(
  "66005555-0000-4000-8000-000000000003",
);

let isActive: jest.SpiedFunction<typeof CustomChannelEdition.isActive>;
let post: jest.SpiedFunction<typeof API.post>;

beforeEach(() => {
  sendCounterCalls.length = 0;

  isActive = jest.spyOn(CustomChannelEdition, "isActive").mockReturnValue(true);
  jest
    .spyOn(ProjectService, "isProjectBlocked")
    .mockResolvedValue(false as never);
  jest
    .spyOn(UserOnCallLogTimelineService, "markNotSent")
    .mockResolvedValue(undefined as never);
  post = jest
    .spyOn(API, "post")
    .mockResolvedValue(
      new HTTPResponse<JSONObject>(
        200,
        { ok: true, statusCode: 200, message: "Sent to CorpoApp (HTTP 200)." },
        {},
      ) as never,
    );
});

afterEach(() => {
  jest.restoreAllMocks();
});

function send(isTest: boolean = false): Promise<unknown> {
  return CustomNotificationChannelDeliveryService.send({
    customNotificationChannelId: CHANNEL_ID,
    eventType: "on-call.incident.created",
    payload: {},
    projectId: PROJECT_ID,
    userOnCallLogTimelineId: TIMELINE_ID,
    isTest: isTest,
  });
}

describe("core's count of a custom channel's requests", () => {
  test("the feature is not active: not sent, under the channel's id, and nothing is handed over", async () => {
    isActive.mockReturnValue(false);

    await send();

    expect(post).not.toHaveBeenCalled();
    expect(sendCounterCalls).toEqual([
      {
        value: 1,
        attributes: {
          "notification.channel": "custom_channel",
          "notification.provider": "none",
          "notification.provider.config": "global",
          "notification.on_call_page": "true",
          "notification.custom_channel.id": CHANNEL_ID.toString(),
          outcome: "not_sent",
        },
      },
    ]);
  });

  test("the hand-over got no answer: a failure under the channel's id", async () => {
    post.mockResolvedValue(
      new HTTPErrorResponse(502, { message: "Bad gateway" }, {}) as never,
    );

    await send();

    expect(sendCounterCalls).toHaveLength(1);
    expect(sendCounterCalls[0]!.attributes).toMatchObject({
      "notification.channel": "custom_channel",
      "notification.provider": "custom_channel",
      "notification.custom_channel.id": CHANNEL_ID.toString(),
      outcome: "failure",
    });
  });

  test("the sender answered: counted there, never here as well", async () => {
    await send();

    post.mockResolvedValue(
      new HTTPResponse<JSONObject>(
        200,
        { ok: false, statusCode: 500, message: "Not delivered." },
        {},
      ) as never,
    );

    await send();

    expect(post).toHaveBeenCalledTimes(2);
    expect(sendCounterCalls).toEqual([]);
  });

  test("a test is not counted, whatever happens to it", async () => {
    isActive.mockReturnValue(false);
    await send(true);

    isActive.mockReturnValue(true);
    post.mockResolvedValue(
      new HTTPErrorResponse(502, { message: "Bad gateway" }, {}) as never,
    );
    await send(true);

    expect(sendCounterCalls).toEqual([]);
  });
});
