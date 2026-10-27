import CustomNotificationChannelService from "../../../Server/Services/CustomNotificationChannelService";
import UserNotificationRuleAdminService, {
  NotificationMethodReference,
} from "../../../Server/Services/UserNotificationRuleAdminService";
import UserWebhookService from "../../../Server/Services/UserWebhookService";
import CustomNotificationChannel from "../../../Models/DatabaseModels/CustomNotificationChannel";
import UserWebhook from "../../../Models/DatabaseModels/UserWebhook";
import ObjectID from "../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../Server/Utils/Logger");

/*
 * A custom channel is the tenth way a rule can name where its pages go, and
 * the first that belongs to nobody. The guards that hold the other nine to
 * "the method is the rule owner's own" hold it to something else: it exists
 * and it is on. Every other guard - one method per column, the coherence
 * checks, repeats being push alone - treats it like any other method.
 */

const OWNER_ID: ObjectID = ObjectID.generate();
const CHANNEL_ID: ObjectID = ObjectID.generate();

function channel(isEnabled: boolean): CustomNotificationChannel {
  const row: CustomNotificationChannel = new CustomNotificationChannel();
  row._id = CHANNEL_ID.toString();
  row.name = "CorpoApp";
  row.isEnabled = isEnabled;
  return row;
}

let findChannel: jest.SpiedFunction<
  typeof CustomNotificationChannelService.findOneById
>;

beforeEach(() => {
  findChannel = jest
    .spyOn(CustomNotificationChannelService, "findOneById")
    .mockResolvedValue(channel(true));
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the method columns", () => {
  test("the custom channel is one of them", () => {
    expect(UserNotificationRuleAdminService.getNotificationMethodIdColumns()).toContain(
      "customNotificationChannelId",
    );
  });

  test("there are ten", () => {
    expect(
      UserNotificationRuleAdminService.getNotificationMethodIdColumns(),
    ).toHaveLength(10);
  });
});

describe("collectNotificationMethodReferences", () => {
  test("finds a channel by its id column", () => {
    const references: Array<NotificationMethodReference> =
      UserNotificationRuleAdminService.collectNotificationMethodReferences({
        customNotificationChannelId: CHANNEL_ID,
      });

    expect(references).toHaveLength(1);
    expect(references[0]!.idColumn).toBe("customNotificationChannelId");
    expect(references[0]!.label).toBe("Custom Channel");
    expect(references[0]!.methodId.toString()).toBe(CHANNEL_ID.toString());
  });

  test("finds a channel by its relation", () => {
    const references: Array<NotificationMethodReference> =
      UserNotificationRuleAdminService.collectNotificationMethodReferences({
        customNotificationChannel: { _id: CHANNEL_ID.toString() },
      });

    expect(references).toHaveLength(1);
    expect(references[0]!.suppliedColumn).toBe("customNotificationChannel");
  });

  test("the same channel in both spellings is one reference", () => {
    const references: Array<NotificationMethodReference> =
      UserNotificationRuleAdminService.collectNotificationMethodReferences({
        customNotificationChannelId: CHANNEL_ID,
        customNotificationChannel: {
          _id: CHANNEL_ID.toString().toUpperCase(),
        },
      });

    expect(references).toHaveLength(1);
  });
});

describe("assertNotificationMethodsBelongToUser", () => {
  function references(): Array<NotificationMethodReference> {
    return UserNotificationRuleAdminService.collectNotificationMethodReferences(
      {
        customNotificationChannelId: CHANNEL_ID,
      },
    );
  }

  test("a channel that is on may be named by anybody's rule: it is nobody's", async () => {
    for (const ownerUserId of [
      OWNER_ID,
      ObjectID.generate(),
      ObjectID.generate(),
    ]) {
      await expect(
        UserNotificationRuleAdminService.assertNotificationMethodsBelongToUser({
          ownerUserId: ownerUserId,
          references: references(),
        }),
      ).resolves.toBeUndefined();
    }
  });

  test("the channel is read as root, by its id", async () => {
    await UserNotificationRuleAdminService.assertNotificationMethodsBelongToUser(
      {
        ownerUserId: OWNER_ID,
        references: references(),
      },
    );

    const call: Record<string, unknown> = findChannel.mock.calls[0]![0] as never;
    expect((call["id"] as ObjectID).toString()).toBe(CHANNEL_ID.toString());
    expect(call["props"]).toEqual({ isRoot: true });
  });

  test("a channel that does not exist is refused", async () => {
    findChannel.mockResolvedValue(null);

    await expect(
      UserNotificationRuleAdminService.assertNotificationMethodsBelongToUser({
        ownerUserId: OWNER_ID,
        references: references(),
      }),
    ).rejects.toThrow(
      "The Custom Channel notification method referenced by this rule does not exist.",
    );
  });

  test("a channel that is turned off is refused, saying so", async () => {
    findChannel.mockResolvedValue(channel(false));

    await expect(
      UserNotificationRuleAdminService.assertNotificationMethodsBelongToUser({
        ownerUserId: OWNER_ID,
        references: references(),
      }),
    ).rejects.toThrow(
      "CorpoApp is turned off, so a notification rule cannot use it.",
    );
  });

  test("an unowned rule naming a channel is still refused", async () => {
    await expect(
      UserNotificationRuleAdminService.assertNotificationMethodsBelongToUser({
        ownerUserId: undefined,
        references: references(),
      }),
    ).rejects.toThrow(
      "A notification rule that names a notification method must have an owner.",
    );
  });

  test("a channel beside somebody else's webhook does not let the webhook through", async () => {
    const webhookId: ObjectID = ObjectID.generate();
    const webhook: UserWebhook = new UserWebhook();
    webhook._id = webhookId.toString();
    webhook.userId = ObjectID.generate();

    jest.spyOn(UserWebhookService, "findOneById").mockResolvedValue(webhook);

    await expect(
      UserNotificationRuleAdminService.assertNotificationMethodsBelongToUser({
        ownerUserId: OWNER_ID,
        references:
          UserNotificationRuleAdminService.collectNotificationMethodReferences({
            customNotificationChannelId: CHANNEL_ID,
            userWebhookId: webhookId,
          }),
      }),
    ).rejects.toThrow("belongs to a different user");
  });
});

describe("the other guards treat a channel like any method", () => {
  test("two different channels in the two spellings are refused", () => {
    expect(() => {
      UserNotificationRuleAdminService.assertOneMethodPerNotificationChannel({
        customNotificationChannelId: CHANNEL_ID,
        customNotificationChannel: { _id: ObjectID.generate().toString() },
      });
    }).toThrow("names two different Custom Channel notification methods");
  });

  test("a rule naming a channel names a method", () => {
    expect(
      UserNotificationRuleAdminService.carriesAnyNotificationMethod({
        customNotificationChannelId: CHANNEL_ID,
      }),
    ).toBe(true);
  });

  test("a patch clearing the channel mentions a method", () => {
    expect(
      UserNotificationRuleAdminService.mentionsAnyNotificationMethodColumn({
        customNotificationChannelId: null,
      }),
    ).toBe(true);
  });

  test("a rule whose only method is a channel keeps it after an unrelated patch", () => {
    const methodIds: Array<ObjectID> =
      UserNotificationRuleAdminService.getNotificationMethodIdsAfterPatch({
        patch: { isOptOut: false },
        currentRow: { customNotificationChannelId: CHANNEL_ID },
      });

    expect(
      methodIds.map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([CHANNEL_ID.toString()]);
  });

  test("a patch that clears the channel leaves the rule with no method", () => {
    expect(
      UserNotificationRuleAdminService.getNotificationMethodIdsAfterPatch({
        patch: { customNotificationChannelId: null },
        currentRow: { customNotificationChannelId: CHANNEL_ID },
      }),
    ).toEqual([]);
  });

  test("the relation spelling is folded into the id column on create", () => {
    const carrier: Record<string, unknown> = {
      customNotificationChannel: { _id: CHANNEL_ID.toString() },
    };

    UserNotificationRuleAdminService.collapseNotificationMethodRelationsOnCreate(
      carrier,
    );

    expect(carrier["customNotificationChannel"]).toBeUndefined();
    expect((carrier["customNotificationChannelId"] as ObjectID).toString()).toBe(
      CHANNEL_ID.toString(),
    );
  });
});
