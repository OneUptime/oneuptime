import MailService from "../../Services/MailService";
import UserNotificationEmailRollupItemService from "../../Services/UserNotificationEmailRollupItemService";
import UserNotificationEmailRollupSettingService from "../../Services/UserNotificationEmailRollupSettingService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import {
  BURST_THRESHOLD,
  BURST_WINDOW_MINUTES,
  ROLLUP_SUBJECT_MAX_LENGTH,
} from "./EmailRollupConstants";
import UserNotificationEmailRollupItem from "../../../Models/DatabaseModels/UserNotificationEmailRollupItem";
import OneUptimeDate from "../../../Types/Date";
import Dictionary from "../../../Types/Dictionary";
import Email from "../../../Types/Email";
import { EmailEnvelope } from "../../../Types/Email/EmailMessage";
import { JSONObject } from "../../../Types/JSON";
import RollupCategory, {
  getRollupCategory,
} from "../../../Types/NotificationSetting/NotificationEmailRollupCategory";
import { isRollupEligible } from "../../../Types/NotificationSetting/NotificationEmailRollupPolicy";
import NotificationSettingEventType from "../../../Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import Text from "../../../Types/Text";

/*
 * Why this file exists: it is the ONE place an owner notification email can be
 * held back, and it sits between UserNotificationSettingService and
 * MailService rather than inside either of them.
 *
 * It is a Util and not a method on UserNotificationSettingService because it
 * orchestrates two other services (the rollup item ledger and MailService) and
 * has its own failure policy. That is the same reason OnCallShiftReminderRunner
 * lives under Utils rather than on UserOnCallShiftReminderService, and keeping
 * the shape consistent means a reader who has seen one recognises the other.
 *
 * THE SINGLE MOST IMPORTANT PROPERTY OF THIS FILE: it can only ever fail INTO
 * today's behaviour. Every line that touches the database is inside one
 * try/catch whose catch sets `deferred = false`, so a missing table, a
 * statement timeout, a degraded Postgres, a category the code has never heard
 * of, or a bug introduced here next year all end at the same place - the
 * MailService.sendMail call that shipped before this feature existed. There is
 * no failure mode in which a notification is silently dropped, and that is the
 * entire reason this is safe to default ON for every existing project with no
 * migration and no preference.
 *
 * The second property worth stating up front: below the burst threshold this
 * is a no-op on the observable behaviour. The same envelope and the same
 * correlation-id options reach MailService.sendMail, fire-and-forget, exactly
 * as before. A project that produces three owner emails a day never notices
 * the feature exists. Only an address that is already being flooded sees a
 * change, and even then nothing is suppressed - the 5th through Nth
 * notifications arrive together in one rollup email a few minutes later.
 */

/*
 * The correlation-id bag that UserNotificationSettingService already builds
 * for MailService. Derived from sendMail's own signature rather than
 * re-declared, because the whole point is that it is passed through VERBATIM:
 * if somebody adds a new id to sendMail's options, this type follows and the
 * seam keeps compiling instead of quietly dropping the new field.
 */
export type RollupMailOptions = Parameters<typeof MailService.sendMail>[1];

export interface SendOrRollupData {
  projectId: ObjectID;
  userId: ObjectID;
  toEmail: Email;
  eventType: NotificationSettingEventType;
  emailEnvelope: EmailEnvelope;
  mailOptions: RollupMailOptions;
  /*
   * Set by a producer that reuses another family's event type for something
   * urgent, so the event type alone cannot express the urgency. The SLA-breach
   * job is the case that exists today: it sends under
   * EmailTemplateType.IncidentOwnerResourceCreated and reuses
   * SEND_INCIDENT_CREATED_OWNER_NOTIFICATION, so nothing about its event type
   * distinguishes "your SLA just breached" from an ordinary incident-created
   * notice.
   */
  forceImmediate?: boolean | undefined;
}

/*
 * The deep-link variable names every owner-notification producer in the repo
 * actually uses, harvested by grep over App/FeatureSet/Workers/Jobs and
 * Common/Server/Services. Order is preference order: when an envelope carries
 * more than one, the first entry here wins, so the resource the notification is
 * ABOUT beats whatever context happens to ride along with it.
 *
 * Both the singular and the plural forms of the probe and AI-agent links are
 * listed on purpose. viewProbesLink (plural) is the variable used by the
 * default-seeded, cooldown-free probe connection-flip notification, which is
 * the single event most likely to dominate a real rollup - getting that one
 * name wrong would leave the most common rollup line un-clickable.
 */
const KNOWN_LINK_VARS: ReadonlyArray<string> = [
  "incidentViewLink",
  "alertViewLink",
  "episodeViewLink",
  "incidentEpisodeViewLink",
  "alertEpisodeViewLink",
  "monitorViewLink",
  "scheduledMaintenanceViewLink",
  "statusPageViewLink",
  "sloViewLink",
  "viewProbesLink",
  "viewProbeLink",
  "viewAIAgentsLink",
  "viewAIAgentLink",
  "deviceViewLink",
  "onCallPolicyViewLink",
];

type IsAbsoluteLinkFunction = (
  value: string | JSONObject | undefined,
) => value is string;

/*
 * A link is usable in an email only if it is an absolute http(s) URL. Envelope
 * vars are typed `string | JSONObject`, and in practice also carry numbers and
 * relative paths cast in from producers, so this is a value check and not just
 * a type check.
 */
const isAbsoluteLink: IsAbsoluteLinkFunction = (
  value: string | JSONObject | undefined,
): value is string => {
  return typeof value === "string" && value.startsWith("http");
};

type StripHandlebarsBracesFunction = (value: string) => string;

/*
 * The stored subject is replayed into the rollup email, and MailService
 * Handlebars-compiles subject lines. An incident whose title contains `{{`
 * would therefore be interpreted as a template expression at render time -
 * best case it renders empty, worst case it reaches for a variable that is not
 * there and throws inside the mailer. Strip the braces at the boundary, once,
 * rather than trusting every future renderer to escape them.
 */
const stripHandlebarsBraces: StripHandlebarsBracesFunction = (
  value: string,
): string => {
  return value.split("{{").join("").split("}}").join("");
};

export default class EmailRollupWriter {
  /*
   * Pure and exported so it can be tested with no mocks at all. Returns the
   * first known link var whose value is an absolute URL; failing that, the
   * first key ending in "Link" whose value is an absolute URL.
   *
   * The generic fallback is the point of the design: a producer that adds a
   * new `somethingViewLink` var next year gets a clickable rollup line with no
   * code change here and no list to keep in sync. KNOWN_LINK_VARS exists only
   * to make the CHOICE deterministic when an envelope carries several links -
   * Object.keys order is insertion order, which is a producer's business, not
   * a contract this file should depend on.
   */
  public static extractViewLink(
    vars: Dictionary<string | JSONObject> | undefined,
  ): string | undefined {
    if (!vars) {
      return undefined;
    }

    for (const name of KNOWN_LINK_VARS) {
      const value: string | JSONObject | undefined = vars[name];

      if (isAbsoluteLink(value)) {
        return value;
      }
    }

    for (const key of Object.keys(vars)) {
      if (!key.endsWith("Link")) {
        continue;
      }

      const value: string | JSONObject | undefined = vars[key];

      if (isAbsoluteLink(value)) {
        return value;
      }
    }

    return undefined;
  }

  /*
   * The seam. Either sends the email exactly as the product always has, or
   * records it as pending for the flush sweep to collapse into one rollup.
   *
   * Awaited by the caller, unlike the fire-and-forget send it replaces, because
   * the enqueue has to have happened before sendUserNotification returns -
   * otherwise a caller that shuts the process down after its last notification
   * would lose the row, and the burst counter would under-count under load.
   * The SEND itself is still fire-and-forget inside sendNow, so the awaited
   * part is only the two indexed queries.
   */
  @CaptureSpan()
  public static async sendOrRollup(data: SendOrRollupData): Promise<void> {
    const sendNow: () => void = (): void => {
      MailService.sendMail(
        {
          ...data.emailEnvelope,
          toEmail: data.toEmail,
        },
        data.mailOptions,
      ).catch((err: Error) => {
        logger.error(err);
      });
    };

    /*
     * STRUCTURAL BYPASSES, BEFORE ANY DATABASE WORK. Both of these must stay
     * above the try block: paging-adjacent mail has to cost zero extra queries
     * on the hot path, and "the rollup code cannot reach it" has to be
     * provable by reading six lines rather than by auditing the fail-open
     * catch below.
     */
    if (data.forceImmediate === true) {
      sendNow();
      return;
    }

    /*
     * isRollupEligible is the whole on-call guard. It is a positive allow-list,
     * and NEVER_ROLLED_UP_EVENT_TYPES is its complement by construction, so
     * testing the never-list here as well would add a second place for the
     * policy to drift with no extra safety.
     */
    if (!isRollupEligible(data.eventType)) {
      sendNow();
      return;
    }

    let deferred: boolean = false;

    try {
      const category: RollupCategory = getRollupCategory(data.eventType);

      const windowStart: Date = OneUptimeDate.addRemoveMinutes(
        OneUptimeDate.getCurrentDate(),
        BURST_WINDOW_MINUTES * -1,
      );

      /*
       * SCOPED PER CATEGORY, and that scoping is the feature's main regression
       * guard. A monitor that flaps every thirty seconds must not be able to
       * consume the free immediate sends that the first "production is down"
       * incident email needs. The query's columns are the leading four of the
       * item table's composite index plus createdAt, so this is one index
       * range scan on a path that already awaits a dozen other queries.
       */
      const recentCount: PositiveNumber =
        await UserNotificationEmailRollupItemService.countBy({
          query: {
            projectId: data.projectId,
            userId: data.userId,
            toEmail: data.toEmail,
            rollupCategory: category,
            createdAt: QueryHelper.greaterThan(windowStart),
          },
          props: {
            isRoot: true,
          },
        });

      deferred = recentCount.toNumber() >= BURST_THRESHOLD;

      /*
       * THE PERSONAL ESCAPE HATCH, READ ONLY WHEN IT COULD CHANGE THE ANSWER.
       *
       * A user can turn burst rollup off for themselves in one project, and
       * then every owner notification is emailed individually and immediately,
       * exactly as the product behaved before rollup existed.
       *
       * The read is deliberately inside this `if`. Below the threshold the
       * outcome is an immediate send whatever the preference says, so asking
       * would be a query per notification per address that could never change
       * anything - the feature's no-op-below-the-threshold property has to
       * stay a no-op in queries too, not just in emails. Above it, one indexed
       * single-row read per deferred email is the honest cost of letting
       * somebody opt out, and it is not cached, because a person who has just
       * asked for immediate email should not keep receiving batches for the
       * length of a TTL.
       *
       * A throw here lands in the fail-open catch below, which sends
       * immediately - the same direction opting out means, so the failure mode
       * of the escape hatch is the escape hatch.
       */
      if (deferred) {
        const mayRollUp: boolean =
          await UserNotificationEmailRollupSettingService.isRollupEnabledForUser(
            {
              userId: data.userId,
              projectId: data.projectId,
            },
          );

        deferred = mayRollUp;
      }

      /*
       * A ROW IS WRITTEN FOR EVERY ROLLUP-ELIGIBLE EMAIL, sent or deferred.
       * That is what makes the counter above countable at all, and it is also
       * what makes this table the first per-event-type, per-recipient email
       * volume record the product has ever had.
       */
      const item: UserNotificationEmailRollupItem =
        new UserNotificationEmailRollupItem();
      item.projectId = data.projectId;
      item.userId = data.userId;
      item.toEmail = data.toEmail;
      item.eventType = data.eventType;
      item.rollupCategory = category;
      item.subject =
        Text.truncate(
          stripHandlebarsBraces(data.emailEnvelope.subject ?? ""),
          ROLLUP_SUBJECT_MAX_LENGTH,
        ) ?? "";

      const link: string | undefined = EmailRollupWriter.extractViewLink(
        data.emailEnvelope.vars,
      );

      /*
       * Guarded rather than `item.viewLink = link ?? undefined`, because
       * exactOptionalPropertyTypes is on and an optional property will not
       * accept an explicit undefined.
       */
      if (link !== undefined) {
        item.viewLink = link;
      }

      /*
       * sentAt at insert time for an immediate send; left NULL for a deferred
       * one, which is precisely what "pending" means to the flush sweep.
       */
      if (!deferred) {
        item.sentAt = OneUptimeDate.getCurrentDate();
      }

      await UserNotificationEmailRollupItemService.create({
        data: item,
        props: {
          isRoot: true,
        },
      });
    } catch (err) {
      /*
       * FAIL OPEN. Read the file header before changing anything here: the
       * only correct answer to "the rollup bookkeeping did not work" is to
       * behave exactly as the product did before the feature existed. Resetting
       * deferred is not defensive tidying - it is the line that guarantees a
       * broken rollup can never turn into a missed notification.
       */
      logger.error(err);
      deferred = false;
    }

    if (!deferred) {
      sendNow();
    }
  }
}
