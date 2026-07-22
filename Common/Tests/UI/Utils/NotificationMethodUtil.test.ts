import { describe, expect, test } from "@jest/globals";
import NotificationMethodUtil, {
  ColumnValueReader,
  NotificationMethodDisplayItem,
  NotificationMethodModels,
} from "../../../UI/Utils/NotificationMethodUtil";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import UserCall from "../../../Models/DatabaseModels/UserCall";
import UserEmail from "../../../Models/DatabaseModels/UserEmail";
import UserNotificationRule from "../../../Models/DatabaseModels/UserNotificationRule";
import UserPush from "../../../Models/DatabaseModels/UserPush";
import UserSMS from "../../../Models/DatabaseModels/UserSMS";
import UserTelegram from "../../../Models/DatabaseModels/UserTelegram";
import UserWebhook from "../../../Models/DatabaseModels/UserWebhook";
import UserWhatsApp from "../../../Models/DatabaseModels/UserWhatsApp";
import Email from "../../../Types/Email";
import ObjectID from "../../../Types/ObjectID";
import Phone from "../../../Types/Phone";

/*
 * These tests pin down the notification-method logic that used to live,
 * copy-pasted, inside four on-call rule page components. The value of pulling it
 * into Common/UI/Utils is that the behavior below is now asserted once instead
 * of being invisible inside React closures.
 */

// -------------------------------------------------------------- model factories

function webhook(id: string, name?: string, url?: string): UserWebhook {
  const model: UserWebhook = new UserWebhook();
  model.id = new ObjectID(id);
  if (name !== undefined) {
    model.name = name;
  }
  if (url !== undefined) {
    model.webhookUrl = url;
  }
  return model;
}

function email(id: string, address?: string): UserEmail {
  const model: UserEmail = new UserEmail();
  model.id = new ObjectID(id);
  if (address !== undefined) {
    model.email = new Email(address);
  }
  return model;
}

function sms(id: string, phone?: string): UserSMS {
  const model: UserSMS = new UserSMS();
  model.id = new ObjectID(id);
  if (phone !== undefined) {
    model.phone = new Phone(phone);
  }
  return model;
}

function call(id: string, phone?: string): UserCall {
  const model: UserCall = new UserCall();
  model.id = new ObjectID(id);
  if (phone !== undefined) {
    model.phone = new Phone(phone);
  }
  return model;
}

function whatsApp(id: string, phone?: string): UserWhatsApp {
  const model: UserWhatsApp = new UserWhatsApp();
  model.id = new ObjectID(id);
  if (phone !== undefined) {
    model.phone = new Phone(phone);
  }
  return model;
}

function telegram(id: string, handle?: string, chatId?: string): UserTelegram {
  const model: UserTelegram = new UserTelegram();
  model.id = new ObjectID(id);
  if (handle !== undefined) {
    model.telegramUserHandle = handle;
  }
  if (chatId !== undefined) {
    model.telegramChatId = chatId;
  }
  return model;
}

function push(id: string, deviceName?: string): UserPush {
  const model: UserPush = new UserPush();
  model.id = new ObjectID(id);
  if (deviceName !== undefined) {
    model.deviceName = deviceName;
  }
  return model;
}

function emptyModels(): NotificationMethodModels {
  return {
    userCalls: [],
    userEmails: [],
    userSMSs: [],
    userPush: [],
    userWhatsApps: [],
    userTelegrams: [],
    userWebhooks: [],
  };
}

// A 24-hex-char string is a valid ObjectID.
const ID: Record<"a" | "b" | "c" | "d" | "e" | "f" | "g", string> = {
  a: "aaaaaaaaaaaaaaaaaaaaaaaa",
  b: "bbbbbbbbbbbbbbbbbbbbbbbb",
  c: "cccccccccccccccccccccccc",
  d: "dddddddddddddddddddddddd",
  e: "eeeeeeeeeeeeeeeeeeeeeeee",
  f: "ffffffffffffffffffffffff",
  g: "abcabcabcabcabcabcabcabc",
};

/*
 * A minimal stand-in for a model row: getDisplayItems only needs getColumnValue,
 * so a plain map exercises the same code path a real model would.
 */
function reader(columns: Record<string, unknown>): ColumnValueReader {
  return {
    getColumnValue: (columnName: string): unknown => {
      return columnName in columns ? columns[columnName] : null;
    },
  };
}

// ================================================ getSelectForNotificationMethods

describe("NotificationMethodUtil.getSelectForNotificationMethods", () => {
  test("selects every notification-method relation", () => {
    const select: Record<string, unknown> =
      NotificationMethodUtil.getSelectForNotificationMethods<UserNotificationRule>() as Record<
        string,
        unknown
      >;

    expect(Object.keys(select).sort()).toEqual(
      [
        "userCall",
        "userEmail",
        "userPush",
        "userSms",
        "userTelegram",
        "userWebhook",
        "userWhatsApp",
      ].sort(),
    );
  });

  test("selects the identifier column for each simple method", () => {
    const select: Record<
      string,
      Record<string, boolean>
    > = NotificationMethodUtil.getSelectForNotificationMethods<UserNotificationRule>() as Record<
      string,
      Record<string, boolean>
    >;

    expect(select["userEmail"]).toEqual({ email: true });
    expect(select["userCall"]).toEqual({ phone: true });
    expect(select["userSms"]).toEqual({ phone: true });
    expect(select["userWhatsApp"]).toEqual({ phone: true });
    expect(select["userPush"]).toEqual({ deviceName: true });
    expect(select["userTelegram"]).toEqual({
      telegramUserHandle: true,
      telegramChatId: true,
    });
  });

  test("selects ONLY name for a webhook — never the credential-bearing URL or secret", () => {
    const select: Record<
      string,
      Record<string, boolean>
    > = NotificationMethodUtil.getSelectForNotificationMethods<UserNotificationRule>() as Record<
      string,
      Record<string, boolean>
    >;

    expect(select["userWebhook"]).toEqual({ name: true });
    expect(select["userWebhook"]).not.toHaveProperty("webhookUrl");
    expect(select["userWebhook"]).not.toHaveProperty("secret");
  });

  test("returns a fresh object each call so callers cannot mutate shared state", () => {
    const first: Record<
      string,
      Record<string, boolean>
    > = NotificationMethodUtil.getSelectForNotificationMethods<UserNotificationRule>() as Record<
      string,
      Record<string, boolean>
    >;

    first["userWebhook"]!["webhookUrl"] = true;

    const second: Record<
      string,
      Record<string, boolean>
    > = NotificationMethodUtil.getSelectForNotificationMethods<UserNotificationRule>() as Record<
      string,
      Record<string, boolean>
    >;

    expect(second["userWebhook"]).toEqual({ name: true });
  });
});

// ============================================================== getDisplayItems

describe("NotificationMethodUtil.getDisplayItems", () => {
  test("returns an empty array when no relation is populated", () => {
    expect(NotificationMethodUtil.getDisplayItems(reader({}))).toEqual([]);
  });

  test("renders an email line", () => {
    const items: Array<NotificationMethodDisplayItem> =
      NotificationMethodUtil.getDisplayItems(
        reader({ userEmail: { email: "jane@example.com" } }),
      );

    expect(items).toEqual([{ title: "Email", value: "jane@example.com" }]);
  });

  test("renders a webhook line using its name", () => {
    const items: Array<NotificationMethodDisplayItem> =
      NotificationMethodUtil.getDisplayItems(
        reader({ userWebhook: { name: "Deploy Hook" } }),
      );

    expect(items).toEqual([{ title: "Webhook", value: "Deploy Hook" }]);
  });

  test("never renders the webhook URL, even when the relation object carries it", () => {
    const items: Array<NotificationMethodDisplayItem> =
      NotificationMethodUtil.getDisplayItems(
        reader({
          userWebhook: {
            name: "Deploy Hook",
            webhookUrl: "https://hooks.slack.com/services/T/B/SECRETTOKEN",
          },
        }),
      );

    expect(items).toEqual([{ title: "Webhook", value: "Deploy Hook" }]);
    expect(JSON.stringify(items)).not.toContain("SECRETTOKEN");
  });

  test("renders no line for a webhook that has only a URL and no name", () => {
    const items: Array<NotificationMethodDisplayItem> =
      NotificationMethodUtil.getDisplayItems(
        reader({
          userWebhook: {
            webhookUrl: "https://hooks.slack.com/services/T/B/SECRETTOKEN",
          },
        }),
      );

    expect(items).toEqual([]);
    expect(JSON.stringify(items)).not.toContain("SECRETTOKEN");
  });

  test("prefers the Telegram handle over the chat id", () => {
    const items: Array<NotificationMethodDisplayItem> =
      NotificationMethodUtil.getDisplayItems(
        reader({
          userTelegram: { telegramUserHandle: "@jane", telegramChatId: "999" },
        }),
      );

    expect(items).toEqual([{ title: "Telegram", value: "@jane" }]);
  });

  test("falls back to the Telegram chat id when the handle is absent", () => {
    const items: Array<NotificationMethodDisplayItem> =
      NotificationMethodUtil.getDisplayItems(
        reader({ userTelegram: { telegramChatId: "999" } }),
      );

    expect(items).toEqual([{ title: "Telegram", value: "999" }]);
  });

  test("ignores a relation whose value is not an object", () => {
    expect(
      NotificationMethodUtil.getDisplayItems(
        reader({ userEmail: "not-an-object" }),
      ),
    ).toEqual([]);
  });

  test("ignores an empty-string identifier", () => {
    expect(
      NotificationMethodUtil.getDisplayItems(
        reader({ userEmail: { email: "" } }),
      ),
    ).toEqual([]);
  });

  test("renders lines in a stable method order", () => {
    const items: Array<NotificationMethodDisplayItem> =
      NotificationMethodUtil.getDisplayItems(
        reader({
          userPush: { deviceName: "Pixel" },
          userEmail: { email: "jane@example.com" },
          userWebhook: { name: "Hook" },
        }),
      );

    expect(items).toEqual([
      { title: "Email", value: "jane@example.com" },
      { title: "Webhook", value: "Hook" },
      { title: "Push", value: "Pixel" },
    ]);
  });

  test("works with a real UserNotificationRule instance", () => {
    const rule: UserNotificationRule = new UserNotificationRule();
    rule.setColumnValue("userWebhook", { name: "Deploy Hook" });

    expect(NotificationMethodUtil.getDisplayItems(rule)).toEqual([
      { title: "Webhook", value: "Deploy Hook" },
    ]);
  });
});

// ==================================================================== getLabel

describe("NotificationMethodUtil.getLabel", () => {
  test("labels a webhook with its name", () => {
    expect(NotificationMethodUtil.getLabel(webhook(ID.a, "Deploy Hook"))).toBe(
      "Webhook: Deploy Hook",
    );
  });

  test("labels a nameless webhook as Unknown Webhook — never its URL", () => {
    const model: UserWebhook = webhook(
      ID.a,
      "",
      "https://hooks.slack.com/services/T/B/SECRETTOKEN",
    );

    const label: string = NotificationMethodUtil.getLabel(model);

    expect(label).toBe("Webhook: Unknown Webhook");
    expect(label).not.toContain("SECRETTOKEN");
  });

  test("labels a push device, falling back to Unknown Device", () => {
    expect(NotificationMethodUtil.getLabel(push(ID.a, "Pixel 8"))).toBe(
      "Push: Pixel 8",
    );
    expect(NotificationMethodUtil.getLabel(push(ID.b))).toBe(
      "Push: Unknown Device",
    );
  });

  test("labels a Telegram method by handle, then chat id, then Unknown Chat", () => {
    expect(NotificationMethodUtil.getLabel(telegram(ID.a, "@jane"))).toBe(
      "Telegram: @jane",
    );
    expect(
      NotificationMethodUtil.getLabel(telegram(ID.b, undefined, "999")),
    ).toBe("Telegram: 999");
    expect(NotificationMethodUtil.getLabel(telegram(ID.c))).toBe(
      "Telegram: Unknown Chat",
    );
  });

  test("labels call, sms, whatsapp with the phone number and their prefix", () => {
    expect(NotificationMethodUtil.getLabel(call(ID.a, "+15555550100"))).toBe(
      "Call: +15555550100",
    );
    expect(NotificationMethodUtil.getLabel(sms(ID.b, "+15555550101"))).toBe(
      "SMS: +15555550101",
    );
    expect(
      NotificationMethodUtil.getLabel(whatsApp(ID.c, "+15555550102")),
    ).toBe("WhatsApp: +15555550102");
  });

  test("labels an email method with the address", () => {
    expect(
      NotificationMethodUtil.getLabel(email(ID.a, "jane@example.com")),
    ).toBe("Email: jane@example.com");
  });
});

// ========================================================== getDropdownOptions

describe("NotificationMethodUtil.getDropdownOptions", () => {
  test("returns no options when the user has configured no methods", () => {
    expect(NotificationMethodUtil.getDropdownOptions(emptyModels())).toEqual(
      [],
    );
  });

  test("creates one option per configured method, value = model id", () => {
    const models: NotificationMethodModels = {
      ...emptyModels(),
      userWebhooks: [webhook(ID.a, "Deploy Hook")],
    };

    const options: Array<DropdownOption> =
      NotificationMethodUtil.getDropdownOptions(models);

    expect(options).toEqual([{ label: "Webhook: Deploy Hook", value: ID.a }]);
  });

  test("emits options grouped by type in a stable order", () => {
    const models: NotificationMethodModels = {
      userCalls: [call(ID.a, "+15555550100")],
      userEmails: [email(ID.b, "jane@example.com")],
      userSMSs: [sms(ID.c, "+15555550101")],
      userPush: [push(ID.d, "Pixel")],
      userWhatsApps: [whatsApp(ID.e, "+15555550102")],
      userTelegrams: [telegram(ID.f, "@jane")],
      userWebhooks: [webhook(ID.g, "Hook")],
    };

    const labels: Array<string> = NotificationMethodUtil.getDropdownOptions(
      models,
    ).map((option: DropdownOption) => {
      return option.label;
    });

    expect(labels).toEqual([
      "Call: +15555550100",
      "Email: jane@example.com",
      "SMS: +15555550101",
      "Push: Pixel",
      "WhatsApp: +15555550102",
      "Telegram: @jane",
      "Webhook: Hook",
    ]);
  });

  test("keeps multiple methods of the same type", () => {
    const models: NotificationMethodModels = {
      ...emptyModels(),
      userWebhooks: [webhook(ID.a, "Hook A"), webhook(ID.b, "Hook B")],
    };

    const options: Array<DropdownOption> =
      NotificationMethodUtil.getDropdownOptions(models);

    expect(options).toEqual([
      { label: "Webhook: Hook A", value: ID.a },
      { label: "Webhook: Hook B", value: ID.b },
    ]);
  });
});

// ====================================================== setSelectedMethodOnRule

describe("NotificationMethodUtil.setSelectedMethodOnRule", () => {
  function models(): NotificationMethodModels {
    return {
      userCalls: [call(ID.a, "+15555550100")],
      userEmails: [email(ID.b, "jane@example.com")],
      userSMSs: [sms(ID.c, "+15555550101")],
      userPush: [push(ID.d, "Pixel")],
      userWhatsApps: [whatsApp(ID.e, "+15555550102")],
      userTelegrams: [telegram(ID.f, "@jane")],
      userWebhooks: [webhook(ID.g, "Hook")],
    };
  }

  test("sets userWebhookId when a webhook is selected", () => {
    const rule: UserNotificationRule = new UserNotificationRule();

    NotificationMethodUtil.setSelectedMethodOnRule(rule, ID.g, models());

    expect(rule.userWebhookId?.toString()).toBe(ID.g);
  });

  test("sets only the one foreign key that matches the selection", () => {
    const rule: UserNotificationRule = new UserNotificationRule();

    NotificationMethodUtil.setSelectedMethodOnRule(rule, ID.g, models());

    expect(rule.userWebhookId?.toString()).toBe(ID.g);
    expect(rule.userEmailId).toBeUndefined();
    expect(rule.userSmsId).toBeUndefined();
    expect(rule.userCallId).toBeUndefined();
    expect(rule.userPushId).toBeUndefined();
    expect(rule.userWhatsAppId).toBeUndefined();
    expect(rule.userTelegramId).toBeUndefined();
  });

  test("maps each method type to its own foreign key", () => {
    const cases: Array<{ id: string; key: keyof UserNotificationRule }> = [
      { id: ID.a, key: "userCallId" },
      { id: ID.b, key: "userEmailId" },
      { id: ID.c, key: "userSmsId" },
      { id: ID.d, key: "userPushId" },
      { id: ID.e, key: "userWhatsAppId" },
      { id: ID.f, key: "userTelegramId" },
      { id: ID.g, key: "userWebhookId" },
    ];

    for (const testCase of cases) {
      const rule: UserNotificationRule = new UserNotificationRule();

      NotificationMethodUtil.setSelectedMethodOnRule(
        rule,
        testCase.id,
        models(),
      );

      expect((rule[testCase.key] as ObjectID | undefined)?.toString()).toBe(
        testCase.id,
      );
    }
  });

  test("leaves the rule untouched when the selection matches nothing", () => {
    const rule: UserNotificationRule = new UserNotificationRule();

    NotificationMethodUtil.setSelectedMethodOnRule(
      rule,
      "999999999999999999999999",
      models(),
    );

    expect(rule.userWebhookId).toBeUndefined();
    expect(rule.userEmailId).toBeUndefined();
  });

  test("does nothing when no method is selected", () => {
    const rule: UserNotificationRule = new UserNotificationRule();

    NotificationMethodUtil.setSelectedMethodOnRule(rule, undefined, models());
    NotificationMethodUtil.setSelectedMethodOnRule(rule, null, models());
    NotificationMethodUtil.setSelectedMethodOnRule(rule, "", models());

    expect(rule.userWebhookId).toBeUndefined();
    expect(rule.userEmailId).toBeUndefined();
  });

  test("accepts an ObjectID selection value, not just a string", () => {
    const rule: UserNotificationRule = new UserNotificationRule();

    NotificationMethodUtil.setSelectedMethodOnRule(
      rule,
      new ObjectID(ID.g),
      models(),
    );

    expect(rule.userWebhookId?.toString()).toBe(ID.g);
  });

  test("returns the same rule instance it was given", () => {
    const rule: UserNotificationRule = new UserNotificationRule();

    const returned: UserNotificationRule =
      NotificationMethodUtil.setSelectedMethodOnRule(rule, ID.b, models());

    expect(returned).toBe(rule);
  });
});
