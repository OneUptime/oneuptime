import { DropdownOption } from "../Components/Dropdown/Dropdown";
import Select from "../../Types/BaseDatabase/Select";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import UserCall from "../../Models/DatabaseModels/UserCall";
import UserEmail from "../../Models/DatabaseModels/UserEmail";
import UserNotificationRule from "../../Models/DatabaseModels/UserNotificationRule";
import UserPush from "../../Models/DatabaseModels/UserPush";
import UserSMS from "../../Models/DatabaseModels/UserSMS";
import UserTelegram from "../../Models/DatabaseModels/UserTelegram";
import UserWebhook from "../../Models/DatabaseModels/UserWebhook";
import UserWhatsApp from "../../Models/DatabaseModels/UserWhatsApp";
import ObjectID from "../../Types/ObjectID";

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
  userWebhooks: Array<UserWebhook>;
}

/* One rendered "Notification Method" line, e.g. `Email: jane@example.com`. */
export interface NotificationMethodDisplayItem {
  /* The method name shown before the colon, e.g. "Email". */
  title: string;
  /* The identifier of the method itself, e.g. the address or device name. */
  value: string;
}

/*
 * A relation on UserNotificationRule / UserOnCallLogTimeline, and how to turn
 * it into a display line. `columns` is tried in order so a method can fall back
 * to a secondary identifier (a Telegram chat id when the handle is unknown).
 */
interface NotificationMethodRelation {
  relationName: string;
  title: string;
  columns: Array<string>;
}

/*
 * Display order for the "Notification Method" table cell. A rule only ever has
 * one method set, so this order is cosmetic, but it is kept stable so the cell
 * reads identically wherever it is rendered.
 */
const NOTIFICATION_METHOD_RELATIONS: Array<NotificationMethodRelation> = [
  { relationName: "userEmail", title: "Email", columns: ["email"] },
  { relationName: "userCall", title: "Call", columns: ["phone"] },
  { relationName: "userSms", title: "SMS", columns: ["phone"] },
  { relationName: "userWhatsApp", title: "WhatsApp", columns: ["phone"] },
  {
    relationName: "userTelegram",
    title: "Telegram",
    columns: ["telegramUserHandle", "telegramChatId"],
  },
  /*
   * Only `name` is read here. A webhook URL is a bearer credential for
   * Slack/Discord/Teams style hooks, so it is deliberately never selected into
   * the browser or rendered. `name` is NOT NULL on UserWebhook.
   */
  { relationName: "userWebhook", title: "Webhook", columns: ["name"] },
  { relationName: "userPush", title: "Push", columns: ["deviceName"] },
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
        displayItems.push({ title: relation.title, value: value });
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
  ): Array<DropdownOption> {
    return NotificationMethodUtil.toOrderedList(models).map(
      (model: BaseModel) => {
        return {
          label: NotificationMethodUtil.getLabel(model),
          value: model.id!.toString(),
        };
      },
    );
  }

  /*
   * The label for a single method, e.g. `SMS: +15550100`. Exported separately so
   * the dropdown and any future surface stay in agreement.
   */
  public static getLabel(model: BaseModel): string {
    if (model instanceof UserWebhook) {
      return (
        "Webhook: " +
        (NotificationMethodUtil.readColumn(model, "name") || "Unknown Webhook")
      );
    }

    if (model instanceof UserPush) {
      return (
        "Push: " +
        (NotificationMethodUtil.readColumn(model, "deviceName") ||
          "Unknown Device")
      );
    }

    if (model instanceof UserTelegram) {
      return (
        "Telegram: " +
        (NotificationMethodUtil.readColumn(model, "telegramUserHandle") ||
          NotificationMethodUtil.readColumn(model, "telegramChatId") ||
          "Unknown Chat")
      );
    }

    const identifier: string =
      NotificationMethodUtil.readColumn(model, "phone") ||
      NotificationMethodUtil.readColumn(model, "email") ||
      "";

    if (model instanceof UserCall) {
      return "Call: " + identifier;
    }

    if (model instanceof UserSMS) {
      return "SMS: " + identifier;
    }

    if (model instanceof UserWhatsApp) {
      return "WhatsApp: " + identifier;
    }

    return "Email: " + identifier;
  }

  /*
   * Maps the id chosen in the dropdown back onto the rule being created. The
   * dropdown is single-select, so at most one of the seven foreign keys is set.
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
    assignById(models.userWebhooks, (id: ObjectID) => {
      rule.userWebhookId = id;
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
      ...models.userCalls,
      ...models.userEmails,
      ...models.userSMSs,
      ...models.userPush,
      ...models.userWhatsApps,
      ...models.userTelegrams,
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
