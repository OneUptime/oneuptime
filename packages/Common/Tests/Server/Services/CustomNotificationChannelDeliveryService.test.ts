import CustomNotificationChannelDeliveryService, {
  CUSTOM_CHANNEL_DELIVERY_LABEL,
  CustomChannelDeliveryResult,
} from "../../../Server/Services/CustomNotificationChannelDeliveryService";
import UserOnCallLogTimelineService from "../../../Server/Services/UserOnCallLogTimelineService";
import BlockedProjectNotifications from "../../../Server/Utils/Notification/BlockedProjectNotifications";
import { STUCK_NOTIFICATION_STATUS_MESSAGE } from "../../../Server/Utils/OnCall/OnCallNotificationStatus";
import { NotificationDeliveryChannel } from "../../../Server/Utils/Telemetry/NotificationDeliveryMetrics";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import UserNotificationStatus from "../../../Types/UserNotification/UserNotificationStatus";
import API from "../../../Utils/API";
import OnCallTimelineRows from "../TestingUtils/OnCallTimelineRows";
import {
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "../Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

jest.mock("../../../Server/Utils/Logger");

jest.mock("../../../Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("../Enterprise/TestBillingFlag") =
    jest.requireActual(
      "../Enterprise/TestBillingFlag",
    ) as typeof import("../Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

/*
 * The hand-off from a page to the Enterprise Edition's sender: it names the
 * channel and never its URL, honours a project a master admin blocked, and
 * answers how the send went in words its sender can show.
 *
 * Custom channels are an Enterprise feature, so these run with the
 * Enterprise Edition loaded and a license that includes them, billing pinned
 * off (CI's config.env sets BILLING_ENABLED=true). What happens while they
 * are not active is CustomChannelsWithoutLicense.test.ts.
 */

const CHANNEL_ID: ObjectID = ObjectID.generate();
const PROJECT_ID: ObjectID = ObjectID.generate();
const TIMELINE_ID: ObjectID = ObjectID.generate();

let post: jest.SpyInstance;
let refusal: jest.SpyInstance;

beforeEach(() => {
  setTestBillingEnabled(false);
  installFakeEnterpriseModule();

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
  uninstallEnterpriseModule();
  setTestBillingEnabled(false);
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

  test("a Notification service that answered with an error is not ok, in words that say so", async () => {
    post.mockResolvedValue(
      new HTTPErrorResponse(500, { message: "Internal error" }, {}),
    );

    const result: CustomChannelDeliveryResult =
      await CustomNotificationChannelDeliveryService.send({
        customNotificationChannelId: CHANNEL_ID,
        eventType: "test",
        payload: {},
      });

    expect(result).toEqual({
      ok: false,
      statusCode: 500,
      message:
        "The Notification service answered with an error (HTTP 500), so this may not have been sent: Internal error.",
    });
  });

  test("an error answer with no words still says what happened", async () => {
    post.mockResolvedValue(new HTTPErrorResponse(503, {}, {}));

    const result: CustomChannelDeliveryResult =
      await CustomNotificationChannelDeliveryService.send({
        customNotificationChannelId: CHANNEL_ID,
        eventType: "test",
        payload: {},
      });

    expect(result.message).toBe(
      "The Notification service answered with an error (HTTP 503), so this may not have been sent.",
    );
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
      // Counted as not sent, under its own channel (#6600).
      deliveryChannel: NotificationDeliveryChannel.CustomChannel,
      projectId: PROJECT_ID,
      userOnCallLogTimelineId: TIMELINE_ID,
    });
  });

  test("is refused by the block as a Custom Channel", () => {
    expect(CUSTOM_CHANNEL_DELIVERY_LABEL).toBe("Custom Channel");
  });
});

/*
 * Issue #7083: the Enterprise Edition's sender records how a request went -
 * but when the Notification service answered with an error, it never ran,
 * or failed on its way: the notification said Sending until the stuck
 * check. Now it says what the answer says, over Sending only, and the
 * answer carries the same words.
 */
describe("an error answer from the Notification service (issue #7083)", () => {
  let timeline: OnCallTimelineRows;

  beforeEach(() => {
    timeline = new OnCallTimelineRows();
    timeline.add(TIMELINE_ID, UserNotificationStatus.Sending);
    timeline.standIn(UserOnCallLogTimelineService);
  });

  async function page(
    options?: { isTest?: boolean | undefined } | undefined,
  ): Promise<CustomChannelDeliveryResult> {
    return await CustomNotificationChannelDeliveryService.send({
      customNotificationChannelId: CHANNEL_ID,
      eventType: "on-call.incident.created",
      payload: {},
      projectId: PROJECT_ID,
      userOnCallLogTimelineId: TIMELINE_ID,
      ...(options?.isTest !== undefined ? { isTest: options.isTest } : {}),
    });
  }

  test("a refusal: the notification says so in the answer's words, and so does the result, with the service's status", async () => {
    post.mockResolvedValue(
      new HTTPErrorResponse(
        404,
        { message: "This custom channel no longer exists." },
        {},
      ),
    );

    const said: string =
      "The Notification service refused to send this (HTTP 404): This custom channel no longer exists.";

    await expect(page()).resolves.toEqual({
      ok: false,
      statusCode: 404,
      message: said,
    });
    expect(timeline.get(TIMELINE_ID)).toMatchObject({
      status: UserNotificationStatus.Error,
      statusMessage: said,
    });
    expect(timeline.writes).toEqual([
      {
        id: TIMELINE_ID.toString(),
        data: { status: UserNotificationStatus.Error, statusMessage: said },
      },
    ]);
  });

  test("any other error answer: it may not have been sent", async () => {
    post.mockResolvedValue(
      new HTTPErrorResponse(500, { message: "Internal error" }, {}),
    );

    const said: string =
      "The Notification service answered with an error (HTTP 500), so this may not have been sent: Internal error.";

    await expect(page()).resolves.toEqual({
      ok: false,
      statusCode: 500,
      message: said,
    });
    expect(timeline.get(TIMELINE_ID)!.statusMessage).toBe(said);
  });

  test("a proxy's error page: no markup, in the result or on the notification", async () => {
    post.mockResolvedValue(
      new HTTPErrorResponse(
        502,
        "<html><body><h1>502 Bad Gateway</h1></body></html>" as unknown as JSONObject,
        {},
      ),
    );

    const said: string =
      "The Notification service answered with an error (HTTP 502), so this may not have been sent.";

    await expect(page()).resolves.toMatchObject({ message: said });
    expect(timeline.get(TIMELINE_ID)!.statusMessage).toBe(said);
  });

  test("the address of the service, in the answer's words, is never shown", async () => {
    post.mockResolvedValue(
      new HTTPErrorResponse(
        503,
        {
          message:
            "Upstream http://app:3002/api/notification/custom-channel/send is unavailable",
        },
        {},
      ),
    );

    const result: CustomChannelDeliveryResult = await page();

    expect(result.message).toBe(
      "The Notification service answered with an error (HTTP 503), so this may not have been sent: Upstream [address] is unavailable.",
    );
    expect(timeline.get(TIMELINE_ID)!.statusMessage).not.toContain("3002");
  });

  test("a test of the channel writes nothing: its admin reads the words in the answer", async () => {
    post.mockResolvedValue(
      new HTTPErrorResponse(400, { message: "Payload is not valid." }, {}),
    );

    await expect(page({ isTest: true })).resolves.toEqual({
      ok: false,
      statusCode: 400,
      message:
        "The Notification service refused to send this (HTTP 400): Payload is not valid.",
    });
    expect(timeline.get(TIMELINE_ID)).toMatchObject({
      status: UserNotificationStatus.Sending,
      version: 1,
    });
    expect(timeline.writes).toEqual([]);
  });

  test("a send with no notification - a person's own notification, not a page - writes nothing", async () => {
    post.mockResolvedValue(
      new HTTPErrorResponse(500, { message: "Internal error" }, {}),
    );

    const findOneById: jest.SpyInstance = jest.spyOn(
      UserOnCallLogTimelineService,
      "findOneById",
    );

    const result: CustomChannelDeliveryResult =
      await CustomNotificationChannelDeliveryService.send({
        customNotificationChannelId: CHANNEL_ID,
        eventType: "test",
        payload: {},
        projectId: PROJECT_ID,
      });

    expect(result.ok).toBe(false);
    expect(findOneById).not.toHaveBeenCalled();
    expect(timeline.writes).toEqual([]);
  });

  test.each([
    UserNotificationStatus.Sent,
    UserNotificationStatus.Acknowledged,
    UserNotificationStatus.PassedOn,
    UserNotificationStatus.Error,
  ])(
    "a notification already %s - the sender's own result, the person's answer - stays",
    async (status: UserNotificationStatus) => {
      timeline.get(TIMELINE_ID)!.status = status;
      timeline.get(TIMELINE_ID)!.statusMessage = "written first";

      post.mockResolvedValue(
        new HTTPErrorResponse(500, { message: "Internal error" }, {}),
      );

      const result: CustomChannelDeliveryResult = await page();

      expect(result.ok).toBe(false);
      expect(timeline.get(TIMELINE_ID)).toMatchObject({
        status: status,
        statusMessage: "written first",
      });
      expect(timeline.writes).toEqual([]);
    },
  );

  test("the stuck check's verdict is replaced: the request's own result, come late", async () => {
    timeline.get(TIMELINE_ID)!.status = UserNotificationStatus.Error;
    timeline.get(TIMELINE_ID)!.statusMessage =
      STUCK_NOTIFICATION_STATUS_MESSAGE;

    post.mockResolvedValue(
      new HTTPErrorResponse(400, { message: "Payload is not valid." }, {}),
    );

    await page();

    expect(timeline.get(TIMELINE_ID)!.statusMessage).toBe(
      "The Notification service refused to send this (HTTP 400): Payload is not valid.",
    );
  });

  test("a database that fails is logged, never thrown: the page's send has nobody to hand it to", async () => {
    jest
      .spyOn(UserOnCallLogTimelineService, "findOneById")
      .mockRejectedValue(new Error("connection terminated"));

    post.mockResolvedValue(
      new HTTPErrorResponse(500, { message: "Internal error" }, {}),
    );

    await expect(page()).resolves.toMatchObject({
      ok: false,
      statusCode: 500,
    });
  });

  test("an answer that is not an error writes nothing: the Enterprise Edition's sender recorded how it went", async () => {
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

    const findOneById: jest.SpyInstance = jest.spyOn(
      UserOnCallLogTimelineService,
      "findOneById",
    );

    await expect(page()).resolves.toEqual({
      ok: false,
      statusCode: 503,
      message: "Not delivered: CorpoApp answered HTTP 503 (tried 3 times).",
    });
    expect(findOneById).not.toHaveBeenCalled();
    expect(timeline.writes).toEqual([]);
  });

  test("a project a master admin blocked: its refusal is the answer - nothing more is written over what it wrote", async () => {
    refusal.mockResolvedValue(
      new HTTPErrorResponse(
        403,
        { message: "Custom Channel not sent: this project is blocked." },
        {},
      ),
    );

    await expect(page()).resolves.toEqual({
      ok: false,
      statusCode: 403,
      message: "Custom Channel not sent: this project is blocked.",
    });
    expect(post).not.toHaveBeenCalled();
    expect(timeline.writes).toEqual([]);
  });
});
