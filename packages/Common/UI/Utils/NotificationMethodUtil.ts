import { DropdownOption } from "../Components/Dropdown/Dropdown";
import Select from "../../Types/BaseDatabase/Select";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import CustomNotificationChannel from "../../Models/DatabaseModels/CustomNotificationChannel";
import UserCall from "../../Models/DatabaseModels/UserCall";
import UserEmail from "../../Models/DatabaseModels/UserEmail";
import UserNotificationRule from "../../Models/DatabaseModels/UserNotificationRule";
import UserPush from "../../Models/DatabaseModels/UserPush";
import UserSMS from "../../Models/DatabaseModels/UserSMS";
import UserTelegram from "../../Models/DatabaseModels/UserTelegram";
import UserSlack from "../../Models/DatabaseModels/UserSlack";
import UserMicrosoftTeams from "../../Models/DatabaseModels/UserMicrosoftTeams";
import UserMattermost from "../../Models/DatabaseModels/UserMattermost";
import UserWebhook from "../../Models/DatabaseModels/UserWebhook";
import UserWhatsApp from "../../Models/DatabaseModels/UserWhatsApp";
import ObjectID from "../../Types/ObjectID";
import { OnCallPageChannel } from "../../Types/OnCallDutyPolicy/OnCallPageChannel";
import {
  ComposedValue,
  composedValue,
  TemplateValue,
  translatableTerm,
  translationKey,
  Translator,
} from "./TranslateTemplate";

/*
 * The four on-call rule pages (alert, incident, alert episode, incident
 * episode) each let a user pick one of their notification methods from a single
 * dropdown. Every method lives in its own model, so building the dropdown and
 * mapping the chosen option back onto the rule used to be ~140 lines duplicated
 * verbatim across all four pages. Adding a method meant four identical edits,
 * and missing one silently dropped that method from a rule type.
 */

/*
 * Anything that exposes column values by name. DatabaseBaseModel satisfies
 * this; keeping the surface this small is what makes the display helpers
 * testable without constructing decorated model instances.
 */
export interface ColumnValueReader {
  getColumnValue: (columnName: string) => unknown;
}

/* The per-user notification methods a rule can point at. */
export interface NotificationMethodModels {
  userCalls: Array<UserCall>;
  userEmails: Array<UserEmail>;
  userSMSs: Array<UserSMS>;
  userPush: Array<UserPush>;
  userWhatsApps: Array<UserWhatsApp>;
  userTelegrams: Array<UserTelegram>;
  userSlacks: Array<UserSlack>;
  userMicrosoftTeamsAccounts: Array<UserMicrosoftTeams>;
  userMattermostAccounts: Array<UserMattermost>;
  userWebhooks: Array<UserWebhook>;
  /*
   * The custom channels that are on (CustomNotificationChannel): everybody's,
   * read from CustomNotificationChannelAPI's list rather than owned. Absent
   * where a surface does not offer them.
   */
  customNotificationChannels?: Array<CustomNotificationChannel> | undefined;
}

/* One rendered "Notification Method" line, e.g. `Email: jane@example.com`. */
export interface NotificationMethodDisplayItem {
  /*
   * Which kind of method it is: what its line is drawn by, whatever the
   * reader's language calls it (NOTIFICATION_METHOD_NAMES).
   */
  method: OnCallPageChannel;
  /* The method's name in English, e.g. "Email": the readiness payload's method type too. */
  title: string;
  /* The identifier of the method itself, e.g. the address or device name. */
  value: string;
}

/*
 * What each kind of method is called in a line of the Dashboard, in the
 * reader's language (#7178): "SMS", "Phone call", "Push notification". A
 * phrase of its own, not the shared word - "Call" is a function call in
 * Chinese and "Push" a payment in Arabic. The test page's result names its
 * messages' channels by the same words (OnCallTestPageWords).
 */
export const NOTIFICATION_METHOD_NAMES: Readonly<
  Record<OnCallPageChannel, string>
> = {
  [OnCallPageChannel.Call]: translationKey("Phone call"),
  [OnCallPageChannel.SMS]: translationKey("SMS"),
  [OnCallPageChannel.WhatsApp]: translationKey("WhatsApp"),
  [OnCallPageChannel.Telegram]: translationKey("Telegram"),
  [OnCallPageChannel.Push]: translationKey("Push notification"),
  [OnCallPageChannel.Email]: translationKey("Email"),
  [OnCallPageChannel.Slack]: translationKey("Slack"),
  [OnCallPageChannel.MicrosoftTeams]: translationKey("Microsoft Teams"),
  [OnCallPageChannel.Mattermost]: translationKey("Mattermost"),
  [OnCallPageChannel.Webhook]: translationKey("Webhook"),
  [OnCallPageChannel.CustomChannel]: translationKey("Custom channel"),
};

/*
 * A method's line, "SMS: +447700900123", as one sentence of the reader's
 * language: French spaces its colon ("SMS : ..."), Chinese writes a
 * full-width one.
 */
export const NOTIFICATION_METHOD_LINE: string = translationKey(
  "{{label}}: {{identifier}}",
);

/*
 * A push device registered without a name: the server stores it under
 * this placeholder (UserPushAPI), and a line words it in the reader's
 * language (getIdentifierText).
 */
const UNNAMED_DEVICE: string = translationKey("Unknown Device");

// The kinds of method reached at a phone number.
const PHONE_NUMBER_METHODS: ReadonlyArray<OnCallPageChannel> = [
  OnCallPageChannel.Call,
  OnCallPageChannel.SMS,
  OnCallPageChannel.WhatsApp,
];

/*
 * A relation on UserNotificationRule / UserOnCallLogTimeline, and how to turn
 * it into a display line. `columns` is tried in order so a method can fall back
 * to a secondary identifier (a Telegram chat id when the handle is unknown).
 */
interface NotificationMethodRelation {
  relationName: string;
  method: OnCallPageChannel;
  title: string;
  columns: Array<string>;
}

/*
 * Display order for the "Notification Method" table cell. A rule only ever has
 * one method set, so this order is cosmetic, but it is kept stable so the cell
 * reads identically wherever it is rendered.
 */
const NOTIFICATION_METHOD_RELATIONS: Array<NotificationMethodRelation> = [
  {
    relationName: "userEmail",
    method: OnCallPageChannel.Email,
    title: "Email",
    columns: ["email"],
  },
  {
    relationName: "userCall",
    method: OnCallPageChannel.Call,
    title: "Call",
    columns: ["phone"],
  },
  {
    relationName: "userSms",
    method: OnCallPageChannel.SMS,
    title: "SMS",
    columns: ["phone"],
  },
  {
    relationName: "userWhatsApp",
    method: OnCallPageChannel.WhatsApp,
    title: "WhatsApp",
    columns: ["phone"],
  },
  {
    relationName: "userTelegram",
    method: OnCallPageChannel.Telegram,
    title: "Telegram",
    columns: ["telegramUserHandle", "telegramChatId"],
  },
  {
    relationName: "userSlack",
    method: OnCallPageChannel.Slack,
    title: "Slack",
    columns: ["slackUserName", "slackUserId"],
  },
  {
    relationName: "userMicrosoftTeams",
    method: OnCallPageChannel.MicrosoftTeams,
    title: "Microsoft Teams",
    columns: ["microsoftTeamsUserName", "microsoftTeamsUserId"],
  },
  {
    relationName: "userMattermost",
    method: OnCallPageChannel.Mattermost,
    title: "Mattermost",
    columns: ["mattermostUserName", "mattermostUserId"],
  },
  /*
   * Only `name` is read here. A webhook URL is a bearer credential for
   * Slack/Discord/Teams style hooks, so it is deliberately never selected into
   * the browser or rendered. `name` is NOT NULL on UserWebhook.
   */
  {
    relationName: "userWebhook",
    method: OnCallPageChannel.Webhook,
    title: "Webhook",
    columns: ["name"],
  },
  /*
   * A custom channel's name: the one column of a channel a relation may
   * read. Its URL and secret never reach the browser.
   */
  {
    relationName: "customNotificationChannel",
    method: OnCallPageChannel.CustomChannel,
    title: "Custom Channel",
    columns: ["name"],
  },
  {
    relationName: "userPush",
    method: OnCallPageChannel.Push,
    title: "Push",
    columns: ["deviceName"],
  },
];

export default class NotificationMethodUtil {
  /*
   * The relation -> column selection the on-call rule tables need in order to
   * render the "Notification Method" cell. Shared so every table that renders
   * NotificationMethodView selects the same fields; a table that under-selects
   * silently renders a blank cell.
   */
  public static getSelectForNotificationMethods<
    TBaseModel extends BaseModel,
  >(): Select<TBaseModel> {
    const select: Record<string, Record<string, boolean>> = {};

    for (const relation of NOTIFICATION_METHOD_RELATIONS) {
      const columns: Record<string, boolean> = {};

      for (const column of relation.columns) {
        columns[column] = true;
      }

      select[relation.relationName] = columns;
    }

    return select as Select<TBaseModel>;
  }

  /*
   * Whether a method of this name ("SMS", "Call", "WhatsApp") is reached at
   * a phone number: its identifier then reads +447700900123 in every
   * language (PhoneNumberText), where printed as it is a Persian or Arabic
   * page put its "+" after its digits. The names are the display lines'
   * titles, which the readiness payload's method types share.
   */
  public static isPhoneNumberMethod(methodName: string): boolean {
    return NOTIFICATION_METHOD_RELATIONS.some(
      (relation: NotificationMethodRelation): boolean => {
        return (
          relation.title === methodName && relation.columns.includes("phone")
        );
      },
    );
  }

  // Whether a kind of method is reached at a phone number.
  public static isPhoneNumberChannel(method: OnCallPageChannel): boolean {
    return PHONE_NUMBER_METHODS.includes(method);
  }

  /*
   * The kind of method an English method type names ("SMS", "Call",
   * "Custom Channel" - a display line's title, the readiness payload's
   * method type), or null for one this build does not know.
   */
  public static getMethodOfType(
    methodType: string | null | undefined,
  ): OnCallPageChannel | null {
    return (
      Object.values(OnCallPageChannel).find(
        (method: OnCallPageChannel): boolean => {
          return method === methodType;
        },
      ) || null
    );
  }

  /*
   * What a method type is called in the reader's language: "Phone call" for
   * "Call". A type this build does not know is named as it came.
   */
  public static getMethodName(
    translator: Translator,
    methodType: OnCallPageChannel | string,
  ): string {
    const method: OnCallPageChannel | null =
      NotificationMethodUtil.getMethodOfType(methodType);

    if (!method) {
      return methodType;
    }

    return (
      translator.translateText(NOTIFICATION_METHOD_NAMES[method]) ||
      NOTIFICATION_METHOD_NAMES[method]
    );
  }

  /*
   * A method's name as a value of a sentence (the Remove dialog's title,
   * "Remove this phone call method?"): in the sentence's own language - the
   * reader's where the sentence is translated, English where it is not
   * yet - and cased as the middle of a sentence is: "phone call", "SMS",
   * "WhatsApp". Named in the reader's language before the sentence was
   * looked up, a German page read "Remove this Telefonanruf method?". A
   * type this build does not know is named as it came.
   */
  public static getMethodNameInSentence(
    methodType: OnCallPageChannel | string,
  ): TemplateValue {
    const method: OnCallPageChannel | null =
      NotificationMethodUtil.getMethodOfType(methodType);

    if (!method) {
      return methodType;
    }

    return translatableTerm(NOTIFICATION_METHOD_NAMES[method], {
      inSentence: true,
    });
  }

  /*
   * A method's line as a value of a sentence ("Deleting {{methodLabel}}
   * removes 2 notification rules."): getMethodLabel's line in the
   * sentence's own language, as getMethodNameInSentence's name is.
   */
  public static getMethodLabelInSentence(
    methodType: OnCallPageChannel | string,
    identifier: string | null | undefined,
  ): ComposedValue {
    return composedValue((translator: Translator): string => {
      return NotificationMethodUtil.getMethodLabel(
        translator,
        methodType,
        identifier,
      );
    });
  }

  /*
   * A method's line as text, "SMS: +447700900123", in the reader's
   * language: for a dropdown's option, which draws text only. The
   * identifier is set apart from the words, so a number keeps its "+" in
   * front on a page read from the right. Just the name with no identifier.
   */
  public static getMethodLabel(
    translator: Translator,
    methodType: OnCallPageChannel | string,
    identifier: string | null | undefined,
  ): string {
    const name: string = NotificationMethodUtil.getMethodName(
      translator,
      methodType,
    );

    if (!identifier) {
      return name;
    }

    return translator.translateTemplate(
      NOTIFICATION_METHOD_LINE,
      {
        label: name,
        identifier: NotificationMethodUtil.getIdentifierText(
          translator,
          methodType,
          identifier,
        ),
      },
      { setsValuesApart: true },
    );
  }

  /*
   * A method's identifier as a line shows it: as stored - a number, an
   * address, a name someone gave it - except a push device registered
   * without a name, which the server stores as "Unknown Device"
   * (UserPushAPI): that is the product's word, in the reader's language
   * like the rest of the line, never "اعلان پوش: Unknown Device".
   */
  public static getIdentifierText(
    translator: Translator,
    methodType: OnCallPageChannel | string,
    identifier: string | null | undefined,
  ): string {
    if (
      NotificationMethodUtil.getMethodOfType(methodType) ===
        OnCallPageChannel.Push &&
      (!identifier || identifier === UNNAMED_DEVICE)
    ) {
      return translator.translateText(UNNAMED_DEVICE) || UNNAMED_DEVICE;
    }

    return identifier || "";
  }

  /*
   * Turns a rule (or an on-call log timeline entry) into the lines to render in
   * the "Notification Method" column. Returns an empty array when no method
   * relation was loaded or populated.
   */
  public static getDisplayItems(
    item: ColumnValueReader,
  ): Array<NotificationMethodDisplayItem> {
    const displayItems: Array<NotificationMethodDisplayItem> = [];

    for (const relation of NOTIFICATION_METHOD_RELATIONS) {
      const relationValue: unknown = item.getColumnValue(relation.relationName);

      if (!relationValue || typeof relationValue !== "object") {
        continue;
      }

      const value: string | undefined = NotificationMethodUtil.firstNonEmpty(
        relationValue as Record<string, unknown>,
        relation.columns,
      );

      if (value) {
        displayItems.push({
          method: relation.method,
          title: relation.title,
          value: value,
        });
      }
    }

    return displayItems;
  }

  /*
   * The dropdown shown on the on-call rule create form. Every method the user
   * has configured becomes one option, prefixed with the method name so a phone
   * number used for both SMS and WhatsApp stays distinguishable.
   */
  public static getDropdownOptions(
    models: NotificationMethodModels,
    // Words the labels in the reader's language; English without one.
    translator?: Translator | undefined,
  ): Array<DropdownOption> {
    return NotificationMethodUtil.toOrderedList(models).map(
      (model: BaseModel): DropdownOption => {
        if (!translator) {
          return {
            label: NotificationMethodUtil.getLabel(model),
            value: model.id!.toString(),
          };
        }

        return {
          label: NotificationMethodUtil.getTranslatedLabel(translator, model),
          value: model.id!.toString(),
          ...NotificationMethodUtil.TRANSLATED_LABEL_OPTION,
        };
      },
    );
  }

  /*
   * How a dropdown draws a method's translated label: as it is, never
   * looked up again, and the page's way, as the "Notification Method"
   * column draws the same line. Left to the label's letters, a Persian menu
   * read "پیامک: ..." from the right and "WhatsApp: ..." under it from the
   * left (Dropdown's isInPageDirection).
   */
  public static readonly TRANSLATED_LABEL_OPTION: {
    isUserContent: true;
    isInPageDirection: true;
  } = {
    isUserContent: true,
    isInPageDirection: true,
  };

  /*
   * getLabel's line in the reader's language: the method's name is theirs,
   * its identifier as stored (NOTIFICATION_METHOD_LINE) - a device with no
   * name an unknown device in their words (getIdentifierText).
   */
  public static getTranslatedLabel(
    translator: Translator,
    model: BaseModel,
  ): string {
    const parts: { method: OnCallPageChannel; identifier: string } =
      NotificationMethodUtil.getLabelParts(model);

    return NotificationMethodUtil.getMethodLabel(
      translator,
      parts.method,
      parts.identifier,
    );
  }

  /*
   * The label for a single method, e.g. `SMS: +15550100`. Exported separately so
   * the dropdown and any future surface stay in agreement. The method's
   * English name is its kind's own (OnCallPageChannel): "Call", "Custom
   * Channel".
   */
  public static getLabel(model: BaseModel): string {
    const parts: { method: OnCallPageChannel; identifier: string } =
      NotificationMethodUtil.getLabelParts(model);

    return `${parts.method}: ${parts.identifier}`;
  }

  // Which kind of method a row is, and what identifies it.
  private static getLabelParts(model: BaseModel): {
    method: OnCallPageChannel;
    identifier: string;
  } {
    if (model instanceof CustomNotificationChannel) {
      return {
        method: OnCallPageChannel.CustomChannel,
        identifier:
          NotificationMethodUtil.readColumn(model, "name") || "Unknown Channel",
      };
    }

    if (model instanceof UserWebhook) {
      return {
        method: OnCallPageChannel.Webhook,
        identifier:
          NotificationMethodUtil.readColumn(model, "name") || "Unknown Webhook",
      };
    }

    if (model instanceof UserPush) {
      return {
        method: OnCallPageChannel.Push,
        identifier:
          NotificationMethodUtil.readColumn(model, "deviceName") ||
          UNNAMED_DEVICE,
      };
    }

    if (model instanceof UserTelegram) {
      return {
        method: OnCallPageChannel.Telegram,
        identifier:
          NotificationMethodUtil.readColumn(model, "telegramUserHandle") ||
          NotificationMethodUtil.readColumn(model, "telegramChatId") ||
          "Unknown Chat",
      };
    }

    if (model instanceof UserSlack) {
      return {
        method: OnCallPageChannel.Slack,
        identifier:
          NotificationMethodUtil.readColumn(model, "slackUserName") ||
          NotificationMethodUtil.readColumn(model, "slackUserId") ||
          "Unknown Account",
      };
    }

    if (model instanceof UserMicrosoftTeams) {
      return {
        method: OnCallPageChannel.MicrosoftTeams,
        identifier:
          NotificationMethodUtil.readColumn(model, "microsoftTeamsUserName") ||
          NotificationMethodUtil.readColumn(model, "microsoftTeamsUserId") ||
          "Unknown Account",
      };
    }

    if (model instanceof UserMattermost) {
      return {
        method: OnCallPageChannel.Mattermost,
        identifier:
          NotificationMethodUtil.readColumn(model, "mattermostUserName") ||
          NotificationMethodUtil.readColumn(model, "mattermostUserId") ||
          "Unknown Account",
      };
    }

    const identifier: string =
      NotificationMethodUtil.readColumn(model, "phone") ||
      NotificationMethodUtil.readColumn(model, "email") ||
      "";

    if (model instanceof UserCall) {
      return { method: OnCallPageChannel.Call, identifier: identifier };
    }

    if (model instanceof UserSMS) {
      return { method: OnCallPageChannel.SMS, identifier: identifier };
    }

    if (model instanceof UserWhatsApp) {
      return { method: OnCallPageChannel.WhatsApp, identifier: identifier };
    }

    return { method: OnCallPageChannel.Email, identifier: identifier };
  }

  /*
   * Maps the id chosen in the dropdown back onto the rule being created. The
   * dropdown is single-select, so at most one of the eleven foreign keys is set.
   * An id that matches nothing leaves the rule untouched, and the server then
   * rejects the create as having no notification method.
   */
  public static setSelectedMethodOnRule(
    rule: UserNotificationRule,
    selectedValue: unknown,
    models: NotificationMethodModels,
  ): UserNotificationRule {
    if (!selectedValue) {
      return rule;
    }

    const selectedId: string = selectedValue.toString();

    const assignById: (
      candidates: Array<BaseModel>,
      assign: (id: ObjectID) => void,
    ) => void = (
      candidates: Array<BaseModel>,
      assign: (id: ObjectID) => void,
    ): void => {
      const match: BaseModel | undefined = candidates.find(
        (candidate: BaseModel) => {
          return candidate.id?.toString() === selectedId;
        },
      );

      if (match) {
        assign(match.id!);
      }
    };

    assignById(models.userEmails, (id: ObjectID) => {
      rule.userEmailId = id;
    });
    assignById(models.userSMSs, (id: ObjectID) => {
      rule.userSmsId = id;
    });
    assignById(models.userCalls, (id: ObjectID) => {
      rule.userCallId = id;
    });
    assignById(models.userPush, (id: ObjectID) => {
      rule.userPushId = id;
    });
    assignById(models.userWhatsApps, (id: ObjectID) => {
      rule.userWhatsAppId = id;
    });
    assignById(models.userTelegrams, (id: ObjectID) => {
      rule.userTelegramId = id;
    });
    assignById(models.userSlacks, (id: ObjectID) => {
      rule.userSlackId = id;
    });
    assignById(models.userMicrosoftTeamsAccounts, (id: ObjectID) => {
      rule.userMicrosoftTeamsId = id;
    });
    assignById(models.userMattermostAccounts, (id: ObjectID) => {
      rule.userMattermostId = id;
    });
    assignById(models.userWebhooks, (id: ObjectID) => {
      rule.userWebhookId = id;
    });
    assignById(models.customNotificationChannels || [], (id: ObjectID) => {
      rule.customNotificationChannelId = id;
    });

    return rule;
  }

  /*
   * Dropdown ordering: methods are grouped by type in a fixed order so the list
   * does not reshuffle between page loads.
   */
  private static toOrderedList(
    models: NotificationMethodModels,
  ): Array<BaseModel> {
    return [
      ...(models.customNotificationChannels || []),
      ...models.userCalls,
      ...models.userEmails,
      ...models.userSMSs,
      ...models.userPush,
      ...models.userWhatsApps,
      ...models.userTelegrams,
      ...models.userSlacks,
      ...models.userMicrosoftTeamsAccounts,
      ...models.userMattermostAccounts,
      ...models.userWebhooks,
    ];
  }

  private static readColumn(model: BaseModel, columnName: string): string {
    const value: unknown = model.getColumnValue(columnName);

    if (value === undefined || value === null || value === "") {
      return "";
    }

    return value.toString();
  }

  private static firstNonEmpty(
    source: Record<string, unknown>,
    columns: Array<string>,
  ): string | undefined {
    for (const column of columns) {
      const value: unknown = source[column];

      if (value !== undefined && value !== null && value !== "") {
        return value.toString();
      }
    }

    return undefined;
  }
}
