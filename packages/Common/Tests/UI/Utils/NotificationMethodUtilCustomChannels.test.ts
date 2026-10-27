import { describe, expect, test } from "@jest/globals";
import NotificationMethodUtil, {
  ColumnValueReader,
  NotificationMethodDisplayItem,
  NotificationMethodModels,
} from "../../../UI/Utils/NotificationMethodUtil";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import CustomNotificationChannel from "../../../Models/DatabaseModels/CustomNotificationChannel";
import UserEmail from "../../../Models/DatabaseModels/UserEmail";
import UserNotificationRule from "../../../Models/DatabaseModels/UserNotificationRule";
import UserPush from "../../../Models/DatabaseModels/UserPush";
import Email from "../../../Types/Email";
import ObjectID from "../../../Types/ObjectID";

/*
 * A custom channel in the on-call rule form and the rule tables: offered by
 * name, first, as everybody's; chosen into its own column; shown by name in
 * a rule's method cell; and never by anything else of the channel - its URL
 * and secret do not reach the browser.
 */

function channel(name?: string): CustomNotificationChannel {
  const model: CustomNotificationChannel = new CustomNotificationChannel();
  model.id = ObjectID.generate();
  if (name !== undefined) {
    model.name = name;
  }
  return model;
}

function email(address: string): UserEmail {
  const model: UserEmail = new UserEmail();
  model.id = ObjectID.generate();
  model.email = new Email(address);
  return model;
}

function push(deviceName: string): UserPush {
  const model: UserPush = new UserPush();
  model.id = ObjectID.generate();
  model.deviceName = deviceName;
  return model;
}

function models(
  overrides: Partial<NotificationMethodModels> = {},
): NotificationMethodModels {
  return {
    userCalls: [],
    userEmails: [],
    userSMSs: [],
    userPush: [],
    userWhatsApps: [],
    userTelegrams: [],
    userSlacks: [],
    userMicrosoftTeamsAccounts: [],
    userWebhooks: [],
    ...overrides,
  };
}

function reader(values: Record<string, unknown>): ColumnValueReader {
  return {
    getColumnValue: (columnName: string): unknown => {
      return values[columnName];
    },
  };
}

describe("a custom channel's label", () => {
  test("is the channel's name", () => {
    expect(NotificationMethodUtil.getLabel(channel("CorpoApp"))).toBe(
      "Custom Channel: CorpoApp",
    );
  });

  test("a channel with no name is an unknown channel", () => {
    expect(NotificationMethodUtil.getLabel(channel())).toBe(
      "Custom Channel: Unknown Channel",
    );
  });

  test("never shows the URL or the secret, even on a model that carries them", () => {
    const model: CustomNotificationChannel = channel("CorpoApp");
    model.webhookUrl = "https://push.internal.example.com/hook";
    model.secret = "s3cr3t";

    const label: string = NotificationMethodUtil.getLabel(model);

    expect(label).not.toContain("push.internal.example.com");
    expect(label).not.toContain("s3cr3t");
  });
});

describe("the rule form's method list", () => {
  test("offers each channel by name, valued by its id", () => {
    const corpoApp: CustomNotificationChannel = channel("CorpoApp");

    const options: Array<DropdownOption> =
      NotificationMethodUtil.getDropdownOptions(
        models({ customNotificationChannels: [corpoApp] }),
      );

    expect(options).toEqual([
      { label: "Custom Channel: CorpoApp", value: corpoApp.id!.toString() },
    ]);
  });

  test("offers the channels first, before the person's own methods", () => {
    const options: Array<DropdownOption> =
      NotificationMethodUtil.getDropdownOptions(
        models({
          userEmails: [email("jane@example.com")],
          userPush: [push("Pixel")],
          customNotificationChannels: [channel("CorpoApp"), channel("Pager")],
        }),
      );

    expect(
      options.map((option: DropdownOption): string => {
        return option.label;
      }),
    ).toEqual([
      "Custom Channel: CorpoApp",
      "Custom Channel: Pager",
      "Email: jane@example.com",
      "Push: Pixel",
    ]);
  });

  test("a surface that offers no channels lists exactly what it did before", () => {
    const options: Array<DropdownOption> =
      NotificationMethodUtil.getDropdownOptions(
        models({ userEmails: [email("jane@example.com")] }),
      );

    expect(options).toHaveLength(1);
    expect(options[0]!.label).toBe("Email: jane@example.com");
  });
});

describe("choosing a channel in the rule form", () => {
  test("sets the rule's channel column, and only it", () => {
    const corpoApp: CustomNotificationChannel = channel("CorpoApp");
    const rule: UserNotificationRule = new UserNotificationRule();

    NotificationMethodUtil.setSelectedMethodOnRule(
      rule,
      corpoApp.id!.toString(),
      models({
        userEmails: [email("jane@example.com")],
        customNotificationChannels: [corpoApp],
      }),
    );

    expect(rule.customNotificationChannelId?.toString()).toBe(
      corpoApp.id!.toString(),
    );
    expect(rule.userEmailId).toBeUndefined();
    expect(rule.userPushId).toBeUndefined();
    expect(rule.userWebhookId).toBeUndefined();
  });

  test("choosing an email does not set the channel column", () => {
    const address: UserEmail = email("jane@example.com");
    const rule: UserNotificationRule = new UserNotificationRule();

    NotificationMethodUtil.setSelectedMethodOnRule(
      rule,
      address.id!.toString(),
      models({
        userEmails: [address],
        customNotificationChannels: [channel("CorpoApp")],
      }),
    );

    expect(rule.userEmailId?.toString()).toBe(address.id!.toString());
    expect(rule.customNotificationChannelId).toBeUndefined();
  });

  test("an id no channel has leaves the rule untouched", () => {
    const rule: UserNotificationRule = new UserNotificationRule();

    NotificationMethodUtil.setSelectedMethodOnRule(
      rule,
      ObjectID.generate().toString(),
      models({ customNotificationChannels: [channel("CorpoApp")] }),
    );

    expect(rule.customNotificationChannelId).toBeUndefined();
  });

  test("a surface with no channels never sets the channel column", () => {
    const rule: UserNotificationRule = new UserNotificationRule();

    NotificationMethodUtil.setSelectedMethodOnRule(
      rule,
      ObjectID.generate().toString(),
      models(),
    );

    expect(rule.customNotificationChannelId).toBeUndefined();
  });
});

describe("a rule's method cell", () => {
  test("selects the channel's name, and nothing else of it", () => {
    const select: Record<string, Record<string, boolean>> =
      NotificationMethodUtil.getSelectForNotificationMethods<UserNotificationRule>() as Record<
        string,
        Record<string, boolean>
      >;

    expect(select["customNotificationChannel"]).toEqual({ name: true });
  });

  test("shows the channel by name", () => {
    const items: Array<NotificationMethodDisplayItem> =
      NotificationMethodUtil.getDisplayItems(
        reader({ customNotificationChannel: { name: "CorpoApp" } }),
      );

    expect(items).toEqual([{ title: "Custom Channel", value: "CorpoApp" }]);
  });

  test("never shows the URL, even when the relation carries it", () => {
    const items: Array<NotificationMethodDisplayItem> =
      NotificationMethodUtil.getDisplayItems(
        reader({
          customNotificationChannel: {
            webhookUrl: "https://push.internal.example.com/hook",
          },
        }),
      );

    expect(items).toEqual([]);
  });

  test("shows the channel after a webhook and before push, in the stable order", () => {
    const items: Array<NotificationMethodDisplayItem> =
      NotificationMethodUtil.getDisplayItems(
        reader({
          userPush: { deviceName: "Pixel" },
          customNotificationChannel: { name: "CorpoApp" },
          userWebhook: { name: "Hook" },
        }),
      );

    expect(
      items.map((item: NotificationMethodDisplayItem): string => {
        return item.title;
      }),
    ).toEqual(["Webhook", "Custom Channel", "Push"]);
  });

  test("works on a real rule", () => {
    const rule: UserNotificationRule = new UserNotificationRule();
    rule.customNotificationChannel = channel("CorpoApp");

    expect(NotificationMethodUtil.getDisplayItems(rule)).toEqual([
      { title: "Custom Channel", value: "CorpoApp" },
    ]);
  });
});
