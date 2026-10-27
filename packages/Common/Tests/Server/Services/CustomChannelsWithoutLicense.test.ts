import CustomNotificationChannelDeliveryService, {
  CustomChannelDeliveryResult,
} from "../../../Server/Services/CustomNotificationChannelDeliveryService";
import CustomNotificationChannelService from "../../../Server/Services/CustomNotificationChannelService";
import UserNotificationRuleService from "../../../Server/Services/UserNotificationRuleService";
import UserOnCallLogTimelineService from "../../../Server/Services/UserOnCallLogTimelineService";
import BlockedProjectNotifications from "../../../Server/Utils/Notification/BlockedProjectNotifications";
import { CUSTOM_CHANNEL_NOT_ACTIVE_MESSAGE } from "../../../Server/Utils/Notification/CustomChannelEdition";
import CustomNotificationChannel from "../../../Models/DatabaseModels/CustomNotificationChannel";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import UserNotificationStatus from "../../../Types/UserNotification/UserNotificationStatus";
import API from "../../../Utils/API";
import EnterpriseFeature, {
  ALL_ENTERPRISE_FEATURES,
} from "../../../Server/Enterprise/EnterpriseFeature";
import FakeEnterpriseModule, {
  createEditionStateCases,
  createLicenseSnapshot,
  createLicenseSnapshotWithStatus,
  EditionStateCase,
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "../Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * WITHOUT A LICENSE THAT INCLUDES THEM, CUSTOM CHANNELS STOP.
 *
 * Custom notification channels are an Enterprise feature
 * (EnterpriseFeature.CustomNotificationChannels). While they are not active
 * (CustomChannelEdition.isActive: always on the Community Edition; on a
 * self-hosted Enterprise Edition once the trial or grace period is over, or
 * with a license that leaves them out):
 *
 *   - no channel is offered or counted: the lists every screen, readiness,
 *     the fallback, new members and regular notifications read are empty,
 *     and nothing is read to make them;
 *   - nothing is sent: CustomNotificationChannelDeliveryService refuses
 *     before it asks anything else, records why on the on-call log row (not
 *     "Sending" for ever) and makes no request to the Enterprise Edition's
 *     sender;
 *   - nothing is deleted: the channels and the rules that use them are left
 *     as they are, and everything resumes, without a restart, once a license
 *     that includes them is active.
 *
 * Billing and the edition are pinned in every test (CI's config.env sets
 * BILLING_ENABLED=true).
 */

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

const CHANNEL_ID: ObjectID = new ObjectID(
  "c4a40000-0000-4000-8000-000000000001",
);
const TIMELINE_ID: ObjectID = new ObjectID(
  "c4a40000-0000-4000-8000-000000000002",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "c4a40000-0000-4000-8000-000000000003",
);
const USER_ID: ObjectID = new ObjectID("c4a40000-0000-4000-8000-000000000004");

// Each way custom channels are not active, and how to get there.
const NOT_ACTIVE: Array<[string, () => void]> = [
  [
    "the Community Edition",
    (): void => {
      uninstallEnterpriseModule();
    },
  ],
  [
    "the Community Edition, billing on",
    (): void => {
      setTestBillingEnabled(true);
      uninstallEnterpriseModule();
    },
  ],
  [
    "a license that expired more than 30 days ago",
    (): void => {
      installFakeEnterpriseModule({
        snapshot: createLicenseSnapshotWithStatus("expired"),
      });
    },
  ],
  [
    "no license, after the trial",
    (): void => {
      installFakeEnterpriseModule({
        snapshot: createLicenseSnapshotWithStatus("missing"),
      });
    },
  ],
  [
    "a license that leaves custom channels out",
    (): void => {
      installFakeEnterpriseModule({
        snapshot: createLicenseSnapshot({
          features: ALL_ENTERPRISE_FEATURES.filter(
            (feature: EnterpriseFeature): boolean => {
              return feature !== EnterpriseFeature.CustomNotificationChannels;
            },
          ),
        }),
      });
    },
  ],
];

function channel(name: string): CustomNotificationChannel {
  const row: CustomNotificationChannel = new CustomNotificationChannel();
  row._id = ObjectID.generate().toString();
  row.name = name;
  row.isEnabled = true;
  row.pageEveryoneByDefault = true;
  return row;
}

let findChannels: jest.SpyInstance;
let post: jest.SpyInstance;
let refusal: jest.SpyInstance;
let updateTimeline: jest.SpyInstance;

beforeEach(() => {
  setTestBillingEnabled(false);
  uninstallEnterpriseModule();

  findChannels = jest
    .spyOn(CustomNotificationChannelService, "findBy")
    .mockResolvedValue([channel("CorpoApp")]);
  post = jest
    .spyOn(API, "post")
    .mockResolvedValue(
      new HTTPResponse<JSONObject>(
        200,
        { ok: true, statusCode: 202, message: "Sent to CorpoApp (HTTP 202)." },
        {},
      ) as never,
    );
  refusal = jest
    .spyOn(BlockedProjectNotifications, "getRefusal")
    .mockResolvedValue(null);
  updateTimeline = jest
    .spyOn(UserOnCallLogTimelineService, "updateOneById")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  uninstallEnterpriseModule();
  setTestBillingEnabled(false);
  jest.restoreAllMocks();
});

async function sendPage(
  data: { withTimeline?: boolean; isTest?: boolean } = {},
): Promise<CustomChannelDeliveryResult> {
  return await CustomNotificationChannelDeliveryService.send({
    customNotificationChannelId: CHANNEL_ID,
    eventType: "on-call.incident.created",
    payload: { version: 1 },
    projectId: PROJECT_ID,
    userOnCallLogTimelineId:
      data.withTimeline === false ? undefined : TIMELINE_ID,
    isTest: data.isTest,
  });
}

describe("no channel is offered or counted", () => {
  test.each(NOT_ACTIVE)(
    "%s: the channels that are on are none, and nothing is read",
    async (_label: string, arrange: () => void) => {
      arrange();

      expect(
        await CustomNotificationChannelService.getChannelsThatAreOn(),
      ).toEqual([]);
      expect(findChannels).not.toHaveBeenCalled();
    },
  );

  test.each(NOT_ACTIVE)(
    "%s: the channels paging everyone are none, and nothing is read",
    async (_label: string, arrange: () => void) => {
      arrange();

      expect(
        await CustomNotificationChannelService.getChannelsPagingEveryone(),
      ).toEqual([]);
      expect(findChannels).not.toHaveBeenCalled();
    },
  );

  test.each(NOT_ACTIVE)(
    "%s: a person joining a project gets no channel in their rules",
    async (_label: string, arrange: () => void) => {
      const addDefaults: jest.SpyInstance = jest
        .spyOn(
          UserNotificationRuleService,
          "addDefaultNotificationRulesForVerifiedMethod",
        )
        .mockResolvedValue(undefined);

      arrange();

      await UserNotificationRuleService.addCustomChannelsPagingEveryoneForUser({
        projectId: PROJECT_ID,
        userId: USER_ID,
      });

      expect(addDefaults).not.toHaveBeenCalled();
      expect(findChannels).not.toHaveBeenCalled();
    },
  );

  test("with a license that includes them, the same lists are read, and a person joining gets the channel", async () => {
    installFakeEnterpriseModule();

    const addDefaults: jest.SpyInstance = jest
      .spyOn(
        UserNotificationRuleService,
        "addDefaultNotificationRulesForVerifiedMethod",
      )
      .mockResolvedValue(undefined);

    expect(
      (await CustomNotificationChannelService.getChannelsThatAreOn()).map(
        (row: CustomNotificationChannel): string | undefined => {
          return row.name;
        },
      ),
    ).toEqual(["CorpoApp"]);
    expect(
      await CustomNotificationChannelService.getChannelsPagingEveryone(),
    ).toHaveLength(1);

    await UserNotificationRuleService.addCustomChannelsPagingEveryoneForUser({
      projectId: PROJECT_ID,
      userId: USER_ID,
    });

    expect(addDefaults).toHaveBeenCalledTimes(1);
  });

  test.each(
    createEditionStateCases().map(
      (state: EditionStateCase): [string, EditionStateCase] => {
        return [state.label, state];
      },
    ),
  )("%s", async (_label: string, state: EditionStateCase) => {
    state.apply();

    const channels: Array<CustomNotificationChannel> =
      await CustomNotificationChannelService.getChannelsThatAreOn();

    expect({
      offered: channels.length,
      read: findChannels.mock.calls.length,
    }).toEqual({
      offered: state.isActive ? 1 : 0,
      read: state.isActive ? 1 : 0,
    });
  });
});

describe("nothing is sent", () => {
  test.each(NOT_ACTIVE)(
    "%s: refused before anything else is asked, with no request to the sender",
    async (_label: string, arrange: () => void) => {
      arrange();

      const result: CustomChannelDeliveryResult = await sendPage();

      expect(result).toEqual({
        ok: false,
        message: CUSTOM_CHANNEL_NOT_ACTIVE_MESSAGE,
      });
      expect(post).not.toHaveBeenCalled();
      expect(refusal).not.toHaveBeenCalled();
    },
  );

  test("the on-call log row says why, as an error, as root - never left at Sending", async () => {
    const markNotSent: jest.SpyInstance = jest.spyOn(
      UserOnCallLogTimelineService,
      "markNotSent",
    );

    await sendPage();

    expect(markNotSent).toHaveBeenCalledWith({
      userOnCallLogTimelineId: TIMELINE_ID,
      reason: CUSTOM_CHANNEL_NOT_ACTIVE_MESSAGE,
    });
    expect(updateTimeline).toHaveBeenCalledWith({
      id: TIMELINE_ID,
      data: {
        status: UserNotificationStatus.Error,
        statusMessage: CUSTOM_CHANNEL_NOT_ACTIVE_MESSAGE,
      },
      props: {
        isRoot: true,
      },
    });
  });

  test("a test has no log row: nothing is written, and the test is refused in the same words", async () => {
    const result: CustomChannelDeliveryResult = await sendPage({
      withTimeline: false,
      isTest: true,
    });

    expect(result.message).toBe(CUSTOM_CHANNEL_NOT_ACTIVE_MESSAGE);
    expect(updateTimeline).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  test("a log row that cannot be written does not turn the refusal into a failure", async () => {
    updateTimeline.mockRejectedValue(new Error("database down"));

    await expect(sendPage()).resolves.toEqual({
      ok: false,
      message: CUSTOM_CHANNEL_NOT_ACTIVE_MESSAGE,
    });
  });

  test("the edition is asked before a blocked project: the reason recorded is the license", async () => {
    refusal.mockResolvedValue(
      new HTTPErrorResponse(
        403,
        { message: "Not sent: this project is blocked." },
        {},
      ),
    );

    const result: CustomChannelDeliveryResult = await sendPage();

    expect(result.message).toBe(CUSTOM_CHANNEL_NOT_ACTIVE_MESSAGE);
    expect(refusal).not.toHaveBeenCalled();
  });

  test.each(
    createEditionStateCases().map(
      (state: EditionStateCase): [string, EditionStateCase] => {
        return [state.label, state];
      },
    ),
  )("%s", async (_label: string, state: EditionStateCase) => {
    state.apply();

    const result: CustomChannelDeliveryResult = await sendPage();

    expect({ asked: post.mock.calls.length, ok: result.ok }).toEqual({
      asked: state.isActive ? 1 : 0,
      ok: state.isActive,
    });
  });
});

describe("nothing is deleted, and everything resumes", () => {
  test("while stopped, no channel and no rule is written or deleted", async () => {
    const updateChannel: jest.SpyInstance = jest.spyOn(
      CustomNotificationChannelService,
      "updateOneById",
    );
    const deleteChannels: jest.SpyInstance = jest.spyOn(
      CustomNotificationChannelService,
      "deleteBy",
    );
    const deleteRules: jest.SpyInstance = jest.spyOn(
      UserNotificationRuleService,
      "deleteBy",
    );

    installFakeEnterpriseModule({
      snapshot: createLicenseSnapshotWithStatus("expired"),
    });

    await CustomNotificationChannelService.getChannelsThatAreOn();
    await CustomNotificationChannelService.getChannelsPagingEveryone();
    await sendPage();

    expect(updateChannel).not.toHaveBeenCalled();
    expect(deleteChannels).not.toHaveBeenCalled();
    expect(deleteRules).not.toHaveBeenCalled();
  });

  test("a license activated again: the channels are offered and pages are sent, with no restart", async () => {
    const fake: FakeEnterpriseModule = installFakeEnterpriseModule({
      snapshot: createLicenseSnapshotWithStatus("missing"),
    });

    expect(
      await CustomNotificationChannelService.getChannelsThatAreOn(),
    ).toEqual([]);
    expect((await sendPage()).ok).toBe(false);

    fake.setSnapshot(createLicenseSnapshotWithStatus("valid"));

    expect(
      await CustomNotificationChannelService.getChannelsThatAreOn(),
    ).toHaveLength(1);
    expect(await sendPage()).toEqual({
      ok: true,
      statusCode: 202,
      message: "Sent to CorpoApp (HTTP 202).",
    });
    expect(post).toHaveBeenCalledTimes(1);
  });
});
