import CustomNotificationChannelDeliveryService, {
  CUSTOM_CHANNEL_DELIVERY_LABEL,
  CustomChannelDeliveryResult,
} from "../../../Server/Services/CustomNotificationChannelDeliveryService";
import BlockedProjectNotifications from "../../../Server/Utils/Notification/BlockedProjectNotifications";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import API from "../../../Utils/API";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

jest.mock("../../../Server/Utils/Logger");

/*
 * The hand-off from a page to the Notification service: it names the
 * channel and never its URL, honours a project a master admin blocked, and
 * answers how the send went in words its sender can show.
 */

const CHANNEL_ID: ObjectID = ObjectID.generate();
const PROJECT_ID: ObjectID = ObjectID.generate();
const TIMELINE_ID: ObjectID = ObjectID.generate();

let post: jest.SpyInstance;
let refusal: jest.SpyInstance;

beforeEach(() => {
  refusal = jest
    .spyOn(BlockedProjectNotifications, "getRefusal")
    .mockResolvedValue(null);
  post = jest
    .spyOn(API, "post")
    .mockResolvedValue(
      new HTTPResponse<JSONObject>(
        200,
        { ok: true, statusCode: 202, message: "Sent to CorpoApp (HTTP 202)." },
        {},
      ),
    );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("CustomNotificationChannelDeliveryService.send", () => {
  test("asks the Notification service by channel id, with the cluster key", async () => {
    await CustomNotificationChannelDeliveryService.send({
      customNotificationChannelId: CHANNEL_ID,
      eventType: "on-call.incident.created",
      payload: { version: 1 },
      projectId: PROJECT_ID,
      userOnCallLogTimelineId: TIMELINE_ID,
    });

    expect(post).toHaveBeenCalledTimes(1);
    const request: Record<string, unknown> = post.mock.calls[0]![0] as never;

    expect(request["url"]!.toString()).toContain(
      "/api/notification/custom-channel/send",
    );
    expect(request["data"]).toEqual({
      customNotificationChannelId: CHANNEL_ID.toString(),
      eventType: "on-call.incident.created",
      payload: { version: 1 },
      isTest: false,
      projectId: PROJECT_ID.toString(),
      userOnCallLogTimelineId: TIMELINE_ID.toString(),
    });
    expect(
      Object.keys(request["headers"] as Record<string, string>).map(
        (header: string): string => {
          return header.toLowerCase();
        },
      ),
    ).toContain("clusterkey");
  });

  test("never carries a URL or a secret", async () => {
    await CustomNotificationChannelDeliveryService.send({
      customNotificationChannelId: CHANNEL_ID,
      eventType: "test",
      payload: {},
      isTest: true,
    });

    const data: Record<string, unknown> = (
      post.mock.calls[0]![0] as unknown as Record<string, unknown>
    )["data"] as Record<string, unknown>;

    expect(Object.keys(data)).not.toContain("url");
    expect(Object.keys(data)).not.toContain("webhookUrl");
    expect(Object.keys(data)).not.toContain("secret");
    expect(data["isTest"]).toBe(true);
  });

  test("leaves out a project and a log row it was not given", async () => {
    await CustomNotificationChannelDeliveryService.send({
      customNotificationChannelId: CHANNEL_ID,
      eventType: "test",
      payload: {},
    });

    const data: Record<string, unknown> = (
      post.mock.calls[0]![0] as unknown as Record<string, unknown>
    )["data"] as Record<string, unknown>;

    expect(data["projectId"]).toBeUndefined();
    expect(data["userOnCallLogTimelineId"]).toBeUndefined();
  });

  test("answers what the Notification service answered", async () => {
    const result: CustomChannelDeliveryResult =
      await CustomNotificationChannelDeliveryService.send({
        customNotificationChannelId: CHANNEL_ID,
        eventType: "test",
        payload: {},
      });

    expect(result).toEqual({
      ok: true,
      statusCode: 202,
      message: "Sent to CorpoApp (HTTP 202).",
    });
  });

  test("an undelivered request is not ok, with the status the service answered", async () => {
    post.mockResolvedValue(
      new HTTPResponse<JSONObject>(
        200,
        {
          ok: false,
          statusCode: 503,
          message: "Not delivered: CorpoApp answered HTTP 503 (tried 3 times).",
        },
        {},
      ),
    );

    const result: CustomChannelDeliveryResult =
      await CustomNotificationChannelDeliveryService.send({
        customNotificationChannelId: CHANNEL_ID,
        eventType: "test",
        payload: {},
      });

    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe(503);
    expect(result.message).toContain("503");
  });

  test("a Notification service that cannot be reached is not ok", async () => {
    post.mockResolvedValue(
      new HTTPErrorResponse(500, { message: "Internal error" }, {}),
    );

    const result: CustomChannelDeliveryResult =
      await CustomNotificationChannelDeliveryService.send({
        customNotificationChannelId: CHANNEL_ID,
        eventType: "test",
        payload: {},
      });

    expect(result.ok).toBe(false);
    expect(result.message.length).toBeGreaterThan(0);
  });

  test("a project a master admin blocked sends nothing", async () => {
    refusal.mockResolvedValue(
      new HTTPErrorResponse(
        403,
        { message: "Not sent: this project is blocked." },
        {},
      ),
    );

    const result: CustomChannelDeliveryResult =
      await CustomNotificationChannelDeliveryService.send({
        customNotificationChannelId: CHANNEL_ID,
        eventType: "on-call.alert.created",
        payload: {},
        projectId: PROJECT_ID,
        userOnCallLogTimelineId: TIMELINE_ID,
      });

    expect(post).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe(403);

    expect(refusal).toHaveBeenCalledWith({
      channel: CUSTOM_CHANNEL_DELIVERY_LABEL,
      projectId: PROJECT_ID,
      userOnCallLogTimelineId: TIMELINE_ID,
    });
  });

  test("is refused by the block as a Custom Channel", () => {
    expect(CUSTOM_CHANNEL_DELIVERY_LABEL).toBe("Custom Channel");
  });
});
