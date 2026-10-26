import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import DatabaseConfig from "../DatabaseConfig";
import {
  AllowedSubscribersCountInFreePlan,
  IsBillingEnabled,
} from "../EnvironmentConfig";
import ProjectSMTPConfigService from "../Services/ProjectSmtpConfigService";
import CreateBy from "../Types/Database/CreateBy";
import CreateLimit from "../Types/Database/CreateLimit";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import Select from "../Types/Database/Select";
import Query from "../Types/Database/Query";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import UpdateBy from "../Types/Database/UpdateBy";
import logger, { LogAttributes } from "../Utils/Logger";
import ProjectReferencesService from "./ProjectReferencesService";
import GlobalCache from "../Infrastructure/GlobalCache";
import MailService from "./MailService";
import ProductBrandingText from "../Utils/ProductBrandingText";
import ProjectCallSMSConfigService from "./ProjectCallSMSConfigService";
import { PROJECT_TWILIO_CONFIG_SELECT } from "../Utils/TwilioConfigSelect";
import ProjectService, { CurrentPlan } from "./ProjectService";
import SmsService from "./SmsService";
import StatusPageService from "./StatusPageService";
import { STATUS_PAGE_ARCHIVED_NO_NEW_SUBSCRIBERS_MESSAGE } from "../../Types/StatusPage/StatusPageArchive";
import { STATUS_PAGE_OF_BLOCKED_PROJECT_NO_NEW_SUBSCRIBERS_MESSAGE } from "../../Types/StatusPage/StatusPageProjectBlock";
import BlockedProjectStatusPages from "../Utils/StatusPage/BlockedProjectStatusPages";
import Hostname from "../../Types/API/Hostname";
import Protocol from "../../Types/API/Protocol";
import URL from "../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import EmailTemplateType from "../../Types/Email/EmailTemplateType";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import ProjectCountLimit from "../Utils/Database/ProjectCountLimit";
import StatusPage from "../../Models/DatabaseModels/StatusPage";
import StatusPageResource from "../../Models/DatabaseModels/StatusPageResource";
import Model from "../../Models/DatabaseModels/StatusPageSubscriber";
import StatusPageSubscriberNotificationTemplate from "../../Models/DatabaseModels/StatusPageSubscriberNotificationTemplate";
import PositiveNumber from "../../Types/PositiveNumber";
import StatusPageEventType from "../../Types/StatusPage/StatusPageEventType";
import StatusPageSubscriberNotificationEventType from "../../Types/StatusPage/StatusPageSubscriberNotificationEventType";
import StatusPageSubscriberNotificationMethod from "../../Types/StatusPage/StatusPageSubscriberNotificationMethod";
import { IncidentSubscriberAudienceCounts } from "../../Types/StatusPage/IncidentSubscriberAudience";
import Dictionary from "../../Types/Dictionary";
import { JSONObject } from "../../Types/JSON";
import SlackUtil from "../Utils/Workspace/Slack/Slack";

import MicrosoftTeamsUtil from "../Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import StatusPageSubscriberWebhookUtil from "../Utils/StatusPageSubscriberWebhook";
import SSRFProtection from "../Utils/SSRFProtection";
import StatusPageSubscriberNotificationTemplateService, {
  Service as StatusPageSubscriberNotificationTemplateServiceClass,
} from "./StatusPageSubscriberNotificationTemplateService";
import TeamMemberService from "./TeamMemberService";
import UserService from "./UserService";
import User from "../../Models/DatabaseModels/User";
import OneUptimeDate from "../../Types/Date";
import ModelEventType from "../../Types/Realtime/ModelEventType";
import StatusPageSubscriberUnsubscribe, {
  StatusPageSubscriberContact,
  StatusPageSubscriberUnsubscribeDetails,
  StatusPageSubscriberUnsubscribeState,
} from "../../Types/StatusPage/StatusPageSubscriberUnsubscribe";
import StatusPageSubscriberConfirmationCode from "../Utils/StatusPage/StatusPageSubscriberConfirmationCode";
import StatusPageSubscriberUnsubscribeToken from "../Utils/StatusPage/StatusPageSubscriberUnsubscribeToken";
import StatusPageSubscriberUnsubscribeNotice, {
  StatusPageSubscriberUnsubscribeNoticeEmail,
  StatusPageSubscriberUnsubscribeSource,
} from "../Utils/StatusPage/StatusPageSubscriberUnsubscribeNotice";
import {
  getProjectNotificationChannelOffMessage,
  ProjectNotificationChannel,
} from "../../Utils/Project/NotificationChannels";
import StatusPageEmailLogo, {
  STATUS_PAGE_EMAIL_LOGO_SELECT,
} from "../Utils/StatusPage/StatusPageEmailLogo";
import { mdText } from "../../Utils/Markdown/FeedMarkdown";
import StatusPageSubscriberResources from "../Utils/StatusPage/StatusPageSubscriberResources";
import StatusPagePrivateUserService from "./StatusPagePrivateUserService";
import {
  fillSubscriberRestrictionMessage,
  getAllowedEmailDomains,
  getDomainNotAllowedMessage,
  isEmailAtAllowedDomain,
  SubscriberRestrictionMessages,
} from "../../Types/StatusPage/SubscriberRestrictions";
import {
  getEmailConditionSql,
  getIsTakenByItsStatusPageSql,
  getOtherContactConditionSql,
  SubscriberRestrictionSettingsSql,
} from "../Utils/StatusPage/SubscriberRestrictionSql";
import { FindWhereProperty } from "../../Types/BaseDatabase/Query";
import PublicMessageRateLimit, {
  PublicMessageChannel,
  PublicMessageContact,
  PublicMessageRateLimitException,
  PublicMessageSendPermit,
  TeamMessageKind,
} from "../Utils/RateLimit/PublicMessageRateLimit";
import SubscriberContactKey from "../../Types/StatusPage/SubscriberContactKey";
import SubscriberContactSql from "../Utils/StatusPage/SubscriberContactSql";
import Exception from "../../Types/Exception/Exception";
import { StatementContext } from "../Utils/Database/StatementOutcome";
import { EntityManager, FindOptionsWhere, MoreThan, Raw } from "typeorm";
import { writeDefaultSubscriberSms } from "../../Utils/Sms/SubscriberSms";

/*
 * For an UPDATE ... RETURNING, the postgres driver hands TypeORM's
 * manager.query back `[rows, rowCount]` rather than the bare row array (see
 * UserTwoFactorBackupCodeService.consumeCode). Read defensively: anything
 * unrecognisable is "no row changed", never a silent success.
 */
type ReturnedRowsFunction = (result: unknown) => Array<JSONObject>;

const returnedRows: ReturnedRowsFunction = (
  result: unknown,
): Array<JSONObject> => {
  if (!Array.isArray(result)) {
    return [];
  }

  if (
    result.length === 2 &&
    Array.isArray(result[0]) &&
    typeof result[1] === "number"
  ) {
    return result[0] as Array<JSONObject>;
  }

  return result.filter((row: unknown): boolean => {
    return Boolean(row) && typeof row === "object" && !Array.isArray(row);
  }) as Array<JSONObject>;
};

/*
 * How many rows an UPDATE without RETURNING changed: the postgres driver
 * answers it with `[rows, rowCount]`. Anything else reads as none.
 */
type AffectedRowCountFunction = (result: unknown) => number;

const affectedRowCount: AffectedRowCountFunction = (
  result: unknown,
): number => {
  if (
    Array.isArray(result) &&
    result.length === 2 &&
    typeof result[1] === "number"
  ) {
    return result[1];
  }

  return 0;
};

interface UnsubscribedAtCarryForward {
  // The value this update writes to isUnsubscribed, when it writes one.
  isUnsubscribed: boolean | null;
  // The matched subscribers that are subscribed now, which this update cancels.
  subscriberIdsBeingUnsubscribed: Array<string>;
}

/*
 * The subscriber rows being created for a visitor who signed up on the status
 * page itself (see createFromStatusPageSignUp). Every other create - a
 * teammate on the dashboard, an API key, a workflow - is the team adding a
 * subscriber, and onBeforeCreate marks it so (Is Added By Team).
 *
 * The very model instances, held only for the length of the create: nothing
 * a request body carries can put a row in here, so no client can pass its
 * subscriber off as a sign-up and keep the page's owners from hearing when
 * it unsubscribes.
 */
const statusPageSignUps: WeakSet<Model> = new WeakSet<Model>();

/*
 * The sign-ups among those whose create has reached onCreateSuccess: the
 * subscriber is written, and its messages - the one place a sign-up sends
 * anything - may have gone out. Held the same way, for the length of the
 * create; a sign-up not in here when its create fails sent nothing.
 */
const statusPageSignUpsSending: WeakSet<Model> = new WeakSet<Model>();

/*
 * The updates a visitor makes from the status page's manage subscription
 * page (see updateFromManageSubscriptionPage), held the same way: the very
 * update objects, only for the length of the update. A visitor picks from
 * what the page shows them, so the resources such an update adds are held to
 * those (StatusPageSubscriberResources).
 */
const manageSubscriptionPageUpdates: WeakSet<UpdateBy<Model>> = new WeakSet<
  UpdateBy<Model>
>();

/*
 * What a visitor signing up by SMS hears when SMS sign-ups are not open:
 * the page's own SMS switch is off (StatusPageAPI's subscribe endpoints), or
 * the project has SMS off (onBeforeCreate below). One sentence whichever
 * check refuses. A visitor has no project settings, so nothing about who
 * can turn it on.
 */
export const SMS_SIGN_UP_UNAVAILABLE_MESSAGE: string =
  "SMS subscribers not enabled for this status page.";

/*
 * The text a visitor who signed up by text message is sent: the link that
 * confirms the subscription, last, so a phone shows it whole, how long it
 * works (StatusPageSubscriberConfirmationCode.VALID_FOR_HOURS), and what to
 * do when it was not them. No notification is sent to the number until the
 * link is opened.
 */
export const getConfirmSubscriptionTextMessage: (data: {
  statusPageName: string;
  confirmationUrl: string;
}) => string = (data: {
  statusPageName: string;
  confirmationUrl: string;
}): string => {
  return `Confirm your subscription to ${data.statusPageName} by text message within ${StatusPageSubscriberConfirmationCode.VALID_FOR_HOURS} hours. Not you? Ignore this and you will not be subscribed. ${data.confirmationUrl}`;
};

// The text that tells a phone subscriber it is subscribed, with its unsubscribe link.
export const getYouHaveSubscribedTextMessage: (data: {
  statusPageName: string;
  unsubscribeUrl: string;
}) => string = (data: {
  statusPageName: string;
  unsubscribeUrl: string;
}): string => {
  return `You have been subscribed to ${data.statusPageName}. To unsubscribe, click on the link: ${data.unsubscribeUrl}`;
};

/*
 * Which subscribers a page takes (Utils/StatusPage/SubscriberRestrictionSql),
 * for countActiveSubscribersByChannel: its rows are "subscriber", each joined
 * to its page as "statusPage", and $2 holds the pages counted.
 */
const SUBSCRIBER_RESTRICTION_COUNT_SQL: string = getIsTakenByItsStatusPageSql({
  subscriber: {
    email: `"subscriber"."subscriberEmail"`,
    phone: `"subscriber"."subscriberPhone"`,
    slack: `"subscriber"."slackIncomingWebhookUrl"`,
    microsoftTeams: `"subscriber"."microsoftTeamsIncomingWebhookUrl"`,
    webhook: `"subscriber"."subscriberWebhook"`,
  },
  statusPageId: `"subscriber"."statusPageId"`,
  privateUsersOf: `"privateUser"."statusPageId" = ANY($2::uuid[])`,
  settings: {
    limitSubscribersToPrivateUsers: `"statusPage"."limitSubscribersToPrivateUsers"`,
    allowedSubscriberEmailDomains: `"statusPage"."allowedSubscriberEmailDomains"`,
  },
});

// The contact columns of a subscriber: the ones a send goes out on.
const SUBSCRIBER_CONTACT_COLUMNS: Array<
  | "subscriberEmail"
  | "subscriberPhone"
  | "slackIncomingWebhookUrl"
  | "microsoftTeamsIncomingWebhookUrl"
  | "subscriberWebhook"
> = [
  "subscriberEmail",
  "subscriberPhone",
  "slackIncomingWebhookUrl",
  "microsoftTeamsIncomingWebhookUrl",
  "subscriberWebhook",
];

/*
 * What onBeforeCreate hands onCreateSuccess: the status page the subscriber
 * is for, and the cancelled subscriptions of the same contact on that page
 * that the new one replaces (none, as a rule, or one).
 */
interface SubscriberCreateCarryForward {
  statusPage: StatusPage;
  replacedSubscriberIds: Array<ObjectID>;

  // The sign-up being created, when the create is one (createFromStatusPageSignUp).
  signUp: Model | null;

  /*
   * A subscriber the team adds: the count of the messages its create sends
   * its contacts (onCreatePermitted), given back when the create ends
   * before anything is sent (onCreateError).
   */
  teamSendPermit?: PublicMessageSendPermit | null | undefined;

  // Set as onCreateSuccess starts: from then on a message may have gone out.
  isSending?: boolean | undefined;
}

/*
 * The columns that name a subscriber's webhook - its own, or a Slack or
 * Microsoft Teams channel's - each a contact of its own, taken once per page
 * by the address it is sent to (SubscriberContactKey.forUrl).
 */
const SUBSCRIBER_WEBHOOK_COLUMNS: Array<
  | "subscriberWebhook"
  | "slackIncomingWebhookUrl"
  | "microsoftTeamsIncomingWebhookUrl"
> = [
  "subscriberWebhook",
  "slackIncomingWebhookUrl",
  "microsoftTeamsIncomingWebhookUrl",
];

/*
 * Reads subscriber rows: those matching `where`, `select`ed, in _id order
 * after `afterId`, at most `limit`. Through the service, or through the
 * transaction a create's INSERT is decided in (getCreateLimit), so both
 * look a contact up alike (findSubscriptionsOfContacts).
 */
type SubscriberRowFinder = (data: {
  where: Record<string, unknown>;
  select: Record<string, boolean>;
  afterId: string | undefined;
  limit: number;
}) => Promise<Array<Model>>;

// How many rows a lookup of a contact on a page reads at a time.
const CONTACT_LOOKUP_BATCH_SIZE: number = 1000;

/*
 * What a lookup of a contact on a page reads of each subscription it finds:
 * whether it still holds the contact (Service.holdsItsContact) - cancelled
 * or not, confirmed or not, and when its link to confirm was sent.
 */
const SUBSCRIPTION_HOLD_COLUMNS: Record<string, boolean> = {
  _id: true,
  isUnsubscribed: true,
  isSubscriptionConfirmed: true,
  createdAt: true,
};

/*
 * The lock every create that names a contact takes on its page, so two
 * creates of one contact on one page are decided one after the other
 * (getCreateLimit): with the page's id after it.
 */
export const SUBSCRIBER_CONTACT_LIMIT_NAME: string =
  "status-page-subscriber-contacts";

/*
 * What a create, or a change, of a subscriber is told when its page already
 * has a subscription of the same contact, however it is written.
 */
export const ALREADY_SUBSCRIBED_MESSAGE: string =
  "You are already subscribed to this status page.";

export const CONTACT_ALREADY_SUBSCRIBED_MESSAGE: string =
  "This status page already has a subscriber with this contact. A phone number, email address or webhook can be subscribed to a status page once, however it is written.";

/*
 * What a visitor signing a contact up is told while the link to confirm an
 * earlier subscription of it, on the same page, still works (a day:
 * StatusPageSubscriberConfirmationCode). The link went to the contact
 * itself, so its owner has it; nothing new is sent to the contact until it
 * runs out, and then a sign-up replaces the waiting subscription and sends
 * a new link. Said by the contact the sign-up names.
 */
export const CONFIRMATION_LINK_SENT_TO_EMAIL_MESSAGE: string =
  "We already sent a link to confirm this subscription to this email address. Open it to subscribe, and check your spam folder if you cannot find it. The link works for 24 hours; after that, you can sign up again for a new one.";

export const CONFIRMATION_LINK_SENT_TO_PHONE_MESSAGE: string =
  "We already sent a link to confirm this subscription to this phone number. Open it to subscribe. The link works for 24 hours; after that, you can sign up again for a new one.";

export const CONFIRMATION_LINK_SENT_MESSAGE: string =
  "We already sent a link to confirm this subscription. Open it to subscribe. The link works for 24 hours; after that, you can sign up again for a new one.";

/*
 * What opening a link to confirm a subscription is told once the link has
 * run out (SubscriptionConfirmationOutcome.Expired).
 */
export const CONFIRMATION_LINK_EXPIRED_MESSAGE: string =
  "This link to confirm your subscription has expired: links work for 24 hours. To get a new one, subscribe again.";

/*
 * What a visitor's sign-up that names more than one contact is told. A
 * subscription has one confirmation code, and is confirmed, and welcomed,
 * by the one contact that signed up.
 */
export const ONE_CONTACT_PER_SIGN_UP_MESSAGE: string =
  "Please sign up one email address, phone number, Slack channel, Microsoft Teams channel or webhook at a time.";

// What opening a subscription's confirmation link did (confirmSubscription).
export enum SubscriptionConfirmationOutcome {
  // The link names no subscription: no such subscriber, or not its code.
  NotFound = "not-found",
  /*
   * The link is the subscription's own, but it ran out a day after it was
   * sent (StatusPageSubscriberConfirmationCode): nothing is confirmed.
   */
  Expired = "expired",
  // The subscription was confirmed already: nothing is sent again.
  AlreadyConfirmed = "already-confirmed",
  // This request confirmed it, and sent its welcome.
  Confirmed = "confirmed",
}

// How many subscribers the backfill and the token top-up handle per statement.
const UNSUBSCRIBE_COLUMNS_BATCH_SIZE: number = 1000;

export interface StatusPageSubscriberUnsubscribeBackfillResult {
  // Subscribers given an unsubscribe token.
  tokensGiven: number;
  // Subscribers marked Is Added By Team because they have a creator.
  markedAddedByTeam: number;
}

/*
 * THE FREE PLAN'S LIMIT ON SUBSCRIBERS (AllowedSubscribersCountInFreePlan),
 * over every status page of the project.
 *
 * Asked twice: early, in onBeforeCreate, and again with the INSERT, in its
 * own transaction under the limit's lock in the project (getCreateLimit,
 * ProjectCountLimit), so sign-ups and subscribers added at the same moment
 * cannot all pass. The lock's name, what it counts - every subscriber of the
 * project, as the early check counts them - and the refusal both checks
 * give.
 */
export const FREE_PLAN_SUBSCRIBER_LIMIT_NAME: string =
  "free-plan-status-page-subscribers";

export const SUBSCRIBER_COUNT_STATEMENT: string =
  'SELECT COUNT(*)::int AS "count" FROM "StatusPageSubscriber" WHERE "projectId" = $1 AND "deletedAt" IS NULL';

export const FREE_PLAN_SUBSCRIBER_LIMIT_MESSAGE: string =
  "You have reached the maximum allowed subscriber limit for the free plan. Please upgrade your plan to add more subscribers.";

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * A create hands its caller the row it saved, and every caller passes it
   * on whole: BaseAPI serializes it into the response of POST
   * /status-page-subscriber without a column read check (a teammate's Add
   * Subscriber and Add in Bulk, any API key), and a workflow's Create Status
   * Page Subscriber step returns it, to be kept in the workflow's logs.
   *
   * So the two secrets onBeforeCreate minted are taken off it first: the
   * unsubscribe token, which lets whoever holds it cancel the subscription
   * without signing in - and makes the team's notice say the subscriber did -
   * and the confirmation code. Nobody can read either column
   * (read: []). They leave the server only inside the messages to the
   * subscription's own contact, which onCreateSuccess has sent by now; the
   * confirmation email reads its code back from the database.
   */
  @CaptureSpan()
  public override async create(createBy: CreateBy<Model>): Promise<Model> {
    const created: Model = await super.create(createBy);

    /*
     * Cleared rather than deleted, as BaseAPI.createItem clears a model's
     * `_id`: an unset column holds undefined, which serializes as nothing.
     */
    const row: Record<string, unknown> = created as unknown as Record<
      string,
      unknown
    >;
    row["unsubscribeToken"] = undefined;
    row["subscriptionConfirmationToken"] = undefined;

    return created;
  }

  /*
   * What a subscriber's create is decided by together with its INSERT, in
   * the INSERT's own transaction under a lock, so creates made at the same
   * moment - visitors signing up on a public status page as much as the
   * team - cannot all pass the checks onBeforeCreate made before any of
   * them was written:
   *
   *  - that its page has no subscription of the same contact yet, however
   *    either is written (findSubscriptionsOfContacts) - none that holds it
   *    (holdsItsContact) - under the page's lock: two sign-ups of one
   *    number typed two ways, sent together, leave one subscriber;
   *  - the Free plan's limit on subscribers (getFreePlanCreateLimit), under
   *    the project's lock, which then holds the contact's check too.
   *
   * Every create is asked, one that skips its hooks too. Null for a create
   * that names no contact, on a plan with no limit.
   */
  protected override async getCreateLimit(
    createBy: CreateBy<Model>,
  ): Promise<CreateLimit | null> {
    const freePlanLimit: CreateLimit | null =
      await this.getFreePlanCreateLimit(createBy);

    // The page under either of its names (onBeforeCreate wrote the ID column).
    const statusPageId: ObjectID | null = RelationIdUtil.readConsistent(
      createBy.data as unknown as Record<string, unknown>,
      ["statusPageId", "statusPage"],
      "Status Page",
    );
    const projectId: ObjectID | undefined = createBy.data.projectId;

    if (
      !statusPageId ||
      !projectId ||
      !SUBSCRIBER_CONTACT_COLUMNS.some(
        (column: (typeof SUBSCRIBER_CONTACT_COLUMNS)[number]): boolean => {
          return Boolean(createBy.data[column]?.toString().trim());
        },
      )
    ) {
      return freePlanLimit;
    }

    const subscriber: Model = createBy.data;

    const checkContact: (manager: EntityManager) => Promise<void> = async (
      manager: EntityManager,
    ): Promise<void> => {
      const subscriptions: Array<Model> =
        await this.findSubscriptionsOfContacts({
          statusPageId: statusPageId,
          projectId: projectId,
          subscriber: subscriber,
          find: this.getTransactionRowFinder(manager),
        });

      this.assertContactNotHeld({
        subscriptions: subscriptions,
        subscriber: subscriber,
        isSignUp: statusPageSignUps.has(subscriber),
        now: Date.now(),
      });
    };

    if (freePlanLimit) {
      return {
        limitName: freePlanLimit.limitName,
        projectId: freePlanLimit.projectId,
        check: async (manager: EntityManager): Promise<void> => {
          await checkContact(manager);
          await freePlanLimit.check(manager);
        },
      };
    }

    return {
      limitName: `${SUBSCRIBER_CONTACT_LIMIT_NAME}:${statusPageId
        .toString()
        .toLowerCase()}`,
      projectId: projectId,
      check: checkContact,
    };
  }

  /*
   * The Free plan's limit on subscribers, decided again with the INSERT:
   * counted in the INSERT's own transaction, under the limit's lock in the
   * project, so subscribers added at the same moment - visitors signing up
   * on a public status page as much as the team - cannot all be added, each
   * having passed the early count in onBeforeCreate. Null on a plan with no
   * such limit, and without billing.
   */
  private async getFreePlanCreateLimit(
    createBy: CreateBy<Model>,
  ): Promise<CreateLimit | null> {
    const projectId: ObjectID | undefined = createBy.data.projectId;

    if (!IsBillingEnabled || !projectId) {
      return null;
    }

    const currentPlan: CurrentPlan =
      await ProjectService.getCurrentPlan(projectId);

    if (currentPlan.plan !== PlanType.Free) {
      return null;
    }

    return ProjectCountLimit.getCreateLimit({
      limitName: FREE_PLAN_SUBSCRIBER_LIMIT_NAME,
      projectId: projectId,
      allowed: AllowedSubscribersCountInFreePlan,
      statement: SUBSCRIBER_COUNT_STATEMENT,
      parameters: [projectId.toString()],
      refusal: FREE_PLAN_SUBSCRIBER_LIMIT_MESSAGE,
    });
  }

  /*
   * Create the subscriber a visitor signed up for on the status page itself
   * (StatusPageAPI's subscribe endpoint). The one create that is not the team
   * adding a subscriber: it is created as root, like the rest of that
   * endpoint, and Is Added By Team is left off.
   *
   * `onNothingSent` is called when the create is refused or fails before
   * anything has been sent to the subscriber's contacts - already
   * subscribed, a check of the page or of a webhook, a value too long, a
   * failed write - and only then, before the error is thrown on. The
   * subscribe endpoint gives its contacts their message count back there
   * (PublicMessageRateLimit).
   */
  @CaptureSpan()
  public async createFromStatusPageSignUp(
    data: Model,
    options?:
      | {
          onNothingSent?: (() => Promise<void>) | undefined;
        }
      | undefined,
  ): Promise<Model> {
    statusPageSignUps.add(data);

    try {
      return await this.create({
        data: data,
        props: {
          isRoot: true,
        },
      });
    } catch (err) {
      if (!statusPageSignUpsSending.has(data) && options?.onNothingSent) {
        try {
          await options.onNothingSent();
        } catch (onNothingSentError) {
          // Never in place of the error the sign-up ended with.
          logger.error(onNothingSentError);
        }
      }

      throw err;
    } finally {
      statusPageSignUps.delete(data);
      statusPageSignUpsSending.delete(data);
    }
  }

  /*
   * Change the subscription a visitor manages on the status page itself
   * (StatusPageAPI's update-subscription endpoint), as root like the rest of
   * that endpoint. The one update that is a visitor's: the resources it adds
   * must be ones the page shows (see checkResourcesOnPages).
   */
  @CaptureSpan()
  public async updateFromManageSubscriptionPage(data: {
    subscriberId: ObjectID;
    data: UpdateBy<Model>["data"];
  }): Promise<number> {
    const updateBy: UpdateBy<Model> = {
      query: {
        _id: data.subscriberId.toString(),
      },
      data: data.data,
      limit: 1,
      skip: 0,
      props: {
        isRoot: true,
      },
    };

    manageSubscriptionPageUpdates.add(updateBy);

    try {
      return await this.updateBy(updateBy);
    } finally {
      manageSubscriptionPageUpdates.delete(updateBy);
    }
  }

  /*
   * Whether the team added this subscriber, rather than it signing up on the
   * status page. Is Added By Team says so for every subscriber created since
   * it existed; Created By is read as well for the ones created before, until
   * the backfill has marked them (every create with a creator is the team's).
   */
  public isAddedByTeam(
    subscriber: Pick<Model, "isAddedByTeam" | "createdByUserId">,
  ): boolean {
    return (
      subscriber.isAddedByTeam === true || Boolean(subscriber.createdByUserId)
    );
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    data: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(data);

    /*
     * The status page under either of its names (the two must agree), kept
     * in the ID column for everything below and for the saved row.
     */
    RelationIdUtil.readIntoIdColumn(
      data.data as unknown as Record<string, unknown>,
      ["statusPageId", "statusPage"],
      "Status Page",
    );

    logger.debug("onBeforeCreate called with data:", {
      projectId: data.data.projectId?.toString(),
      statusPageId: data.data.statusPageId?.toString(),
    } as LogAttributes);
    logger.debug(data, {
      projectId: data.data.projectId?.toString(),
      statusPageId: data.data.statusPageId?.toString(),
    } as LogAttributes);

    if (!data.data.statusPageId) {
      logger.debug("Status Page ID is missing.", {
        projectId: data.data.projectId?.toString(),
      } as LogAttributes);
      throw new BadDataException("Status Page ID is required.");
    }

    if (!data.data.projectId) {
      logger.debug("Project ID is missing.", {
        statusPageId: data.data.statusPageId?.toString(),
      } as LogAttributes);
      throw new BadDataException("Project ID is required.");
    }

    /*
     * A visitor signs up one contact at a time: a subscription is confirmed
     * on the contact that signed up (ONE_CONTACT_PER_SIGN_UP_MESSAGE).
     */
    if (
      statusPageSignUps.has(data.data) &&
      this.getContactColumnsNamed(data.data).length > 1
    ) {
      throw new BadDataException(ONE_CONTACT_PER_SIGN_UP_MESSAGE);
    }

    /*
     * The resources it names are resources of its own status page - for a
     * sign-up on the page, ones the page shows - answered like an id that
     * matches nothing (StatusPageSubscriberResources): after the project
     * check above (super.onBeforeCreate), which answers the same, and before
     * anything else here reads a record.
     */
    await StatusPageSubscriberResources.assertOnPage({
      statusPageId: data.data.statusPageId,
      ids: StatusPageSubscriberResources.getNamedIds(
        data.data.statusPageResources,
      ),
      shownToVisitorsOnly: statusPageSignUps.has(data.data),
    });

    const projectId: ObjectID = data.data.projectId;
    logger.debug(`Project ID: ${projectId}`, {
      projectId: data.data.projectId?.toString(),
      statusPageId: data.data.statusPageId?.toString(),
    } as LogAttributes);

    // if the project is on the free plan, then only allow 1 status page.
    if (IsBillingEnabled) {
      logger.debug("Billing is enabled.", {
        projectId: data.data.projectId?.toString(),
        statusPageId: data.data.statusPageId?.toString(),
      } as LogAttributes);
      const currentPlan: CurrentPlan =
        await ProjectService.getCurrentPlan(projectId);
      logger.debug(`Current Plan: ${JSON.stringify(currentPlan)}`, {
        projectId: data.data.projectId?.toString(),
        statusPageId: data.data.statusPageId?.toString(),
      } as LogAttributes);

      if (currentPlan.isSubscriptionUnpaid) {
        logger.debug("Subscription is unpaid.", {
          projectId: data.data.projectId?.toString(),
          statusPageId: data.data.statusPageId?.toString(),
        } as LogAttributes);
        throw new BadDataException(
          "Your subscription is unpaid. Please update your payment method and to add subscribers.",
        );
      }

      if (currentPlan.plan === PlanType.Free) {
        logger.debug("Current plan is Free.", {
          projectId: data.data.projectId?.toString(),
          statusPageId: data.data.statusPageId?.toString(),
        } as LogAttributes);
        const subscribersCount: PositiveNumber = await this.countBy({
          query: {
            projectId: projectId,
          },
          props: {
            isRoot: true,
          },
        });
        logger.debug(`Subscribers Count: ${subscribersCount.toNumber()}`, {
          projectId: data.data.projectId?.toString(),
          statusPageId: data.data.statusPageId?.toString(),
        } as LogAttributes);

        if (subscribersCount.toNumber() >= AllowedSubscribersCountInFreePlan) {
          logger.debug(
            "Reached maximum allowed subscriber limit for the free plan.",
            {
              projectId: data.data.projectId?.toString(),
              statusPageId: data.data.statusPageId?.toString(),
            } as LogAttributes,
          );
          throw new BadDataException(FREE_PLAN_SUBSCRIBER_LIMIT_MESSAGE);
        }
      }
    }

    if (data.data.subscriberPhone) {
      logger.debug(`Subscriber Phone: ${data.data.subscriberPhone}`, {
        projectId: data.data.projectId?.toString(),
        statusPageId: data.data.statusPageId?.toString(),
      } as LogAttributes);
      // check if this project has SMS enabled.
      const isSMSEnabled: boolean =
        await ProjectService.isSMSNotificationsEnabled(projectId);
      logger.debug(`Is SMS Enabled: ${isSMSEnabled}`, {
        projectId: data.data.projectId?.toString(),
        statusPageId: data.data.statusPageId?.toString(),
      } as LogAttributes);

      if (!isSMSEnabled) {
        logger.debug("SMS notifications are not enabled for this project.", {
          projectId: data.data.projectId?.toString(),
          statusPageId: data.data.statusPageId?.toString(),
        } as LogAttributes);
        /*
         * The team (the dashboard, an API key, a workflow) is told who can
         * turn SMS on; a visitor on the status page is not.
         */
        throw new BadDataException(
          statusPageSignUps.has(data.data)
            ? SMS_SIGN_UP_UNAVAILABLE_MESSAGE
            : getProjectNotificationChannelOffMessage(
                ProjectNotificationChannel.SMS,
              ),
        );
      }
    }

    /*
     * Every subscription this contact already has on the page - all of them,
     * not one: while a cancelled one is being replaced (see onCreateSuccess)
     * the contact has both it and the new one, and the new one must count.
     * A contact is one however it is written (SubscriberContactKey): a phone
     * number by its line, a webhook by the address it is sent to, an email
     * address in lower case. So a page takes each contact once, and is
     * never made to send one person, or one endpoint, every notification
     * once for each way of writing it. The same is asked again with the
     * INSERT, under the page's lock (getCreateLimit).
     */
    const contactSubscriptions: Array<Model> =
      await this.findSubscriptionsOfContacts({
        statusPageId: data.data.statusPageId,
        projectId: projectId,
        subscriber: data.data,
        find: this.getServiceRowFinder(),
      });

    logger.debug(
      `Found ${contactSubscriptions.length} subscription(s) of the contact on the page.`,
      {
        projectId: data.data.projectId?.toString(),
        statusPageId: data.data.statusPageId?.toString(),
      } as LogAttributes,
    );

    /*
     * Refused while one of them holds the contact: it is subscribed, or
     * waiting for its confirmation while the link to it still works
     * (holdsItsContact).
     */
    this.assertContactNotHeld({
      subscriptions: contactSubscriptions,
      subscriber: data.data,
      isSignUp: statusPageSignUps.has(data.data),
      now: Date.now(),
    });

    /*
     * A contact who cancelled and subscribes again gets a new subscription,
     * and the cancelled one is removed once the new one exists
     * (onCreateSuccess) - so a create that is refused or fails leaves it.
     * So is a subscription that waited for its confirmation until its link
     * ran out: the new one, with a new link, takes its place.
     */
    const replacedSubscriberIds: Array<ObjectID> = contactSubscriptions
      .map((subscription: Model): ObjectID | null => {
        return subscription.id;
      })
      .filter((id: ObjectID | null): id is ObjectID => {
        return Boolean(id);
      });

    const statuspages: Array<StatusPage> =
      await this.getStatusPagesToSendNotification([data.data.statusPageId]);
    logger.debug(`Status Pages: ${JSON.stringify(statuspages)}`, {
      projectId: data.data.projectId?.toString(),
      statusPageId: data.data.statusPageId?.toString(),
    } as LogAttributes);

    const statuspage: StatusPage | undefined = statuspages.find(
      (statuspage: StatusPage) => {
        return (
          statuspage._id?.toString() === data.data.statusPageId?.toString()
        );
      },
    );

    if (!statuspage || !statuspage.projectId) {
      logger.debug("Status Page not found or Project ID is missing.", {
        projectId: data.data.projectId?.toString(),
        statusPageId: data.data.statusPageId?.toString(),
      } as LogAttributes);

      /*
       * An archived page, and a page of a blocked project, is left out above.
       * Someone adding a subscriber to one from the dashboard should hear
       * why, not "not found" - the block first, which unarchiving would not
       * lift. A visitor never gets this far: the public routes answer both
       * as missing pages.
       */
      if (
        data.data.statusPageId &&
        (await BlockedProjectStatusPages.isStatusPageOfBlockedProject(
          data.data.statusPageId,
        ))
      ) {
        throw new BadDataException(
          STATUS_PAGE_OF_BLOCKED_PROJECT_NO_NEW_SUBSCRIBERS_MESSAGE,
        );
      }

      if (
        data.data.statusPageId &&
        (await StatusPageService.isStatusPageArchived(data.data.statusPageId))
      ) {
        throw new BadDataException(
          STATUS_PAGE_ARCHIVED_NO_NEW_SUBSCRIBERS_MESSAGE,
        );
      }

      throw new BadDataException("Status Page not found");
    }

    data.data.projectId = statuspage.projectId;
    logger.debug(`Updated Project ID: ${data.data.projectId}`, {
      projectId: data.data.projectId?.toString(),
      statusPageId: data.data.statusPageId?.toString(),
    } as LogAttributes);

    // Who may be this page's subscriber: its private users, its domains.
    await this.assertSubscriberAllowedOnPage({
      statusPage: statuspage,
      subscriber: data.data,
      isSignUp: statusPageSignUps.has(data.data),
    });

    const isEmailSubscriber: boolean = Boolean(data.data.subscriberEmail);
    const isSubscriptionConfirmed: boolean = Boolean(
      data.data.isSubscriptionConfirmed,
    );
    logger.debug(`Is Email Subscriber: ${isEmailSubscriber}`, {
      projectId: data.data.projectId?.toString(),
      statusPageId: data.data.statusPageId?.toString(),
    } as LogAttributes);
    logger.debug(`Is Subscription Confirmed: ${isSubscriptionConfirmed}`, {
      projectId: data.data.projectId?.toString(),
      statusPageId: data.data.statusPageId?.toString(),
    } as LogAttributes);

    /*
     * Who confirms first: an email subscriber, unless it was created
     * confirmed already (by the team), and a visitor who signs up by text
     * message: the number's owner opens the link texted to it before it is
     * sent anything else, as an email address's owner does. The team vouches for the
     * numbers it adds; a Slack, Microsoft Teams or webhook subscriber has
     * nobody to ask.
     */
    const isSignUpByTextMessage: boolean =
      statusPageSignUps.has(data.data) && Boolean(data.data.subscriberPhone);

    if (
      (isEmailSubscriber && !isSubscriptionConfirmed) ||
      isSignUpByTextMessage
    ) {
      data.data.isSubscriptionConfirmed = false;
    } else {
      data.data.isSubscriptionConfirmed = true;
    }

    /*
     * Whether the new subscriber is told it is subscribed: the column's
     * default, on, unless whoever created it said otherwise - written as
     * such, so what onCreatePermitted counts and what onCreateSuccess sends
     * read one value.
     */
    if (
      data.data.sendYouHaveSubscribedMessage === undefined ||
      data.data.sendYouHaveSubscribedMessage === null
    ) {
      data.data.sendYouHaveSubscribedMessage = true;
    }
    logger.debug(
      `Final Subscription Confirmed: ${data.data.isSubscriptionConfirmed}`,
      {
        projectId: data.data.projectId?.toString(),
        statusPageId: data.data.statusPageId?.toString(),
      } as LogAttributes,
    );

    // if slack incoming webhook is provided, then see if it starts with https://hooks.slack.com/services/

    if (data.data.slackIncomingWebhookUrl) {
      logger.debug(
        `Slack Incoming Webhook URL: ${data.data.slackIncomingWebhookUrl}`,
        {
          projectId: data.data.projectId?.toString(),
          statusPageId: data.data.statusPageId?.toString(),
        } as LogAttributes,
      );
      if (
        !SlackUtil.isValidSlackIncomingWebhookUrl(
          data.data.slackIncomingWebhookUrl,
        )
      ) {
        logger.debug("Invalid Slack Incoming Webhook URL.", {
          projectId: data.data.projectId?.toString(),
          statusPageId: data.data.statusPageId?.toString(),
        } as LogAttributes);
        throw new BadDataException("Invalid Slack Incoming Webhook URL.");
      }
    }

    // Validate Microsoft Teams webhook URL if provided
    if (data.data.microsoftTeamsIncomingWebhookUrl) {
      logger.debug(
        `Microsoft Teams Incoming Webhook URL: ${data.data.microsoftTeamsIncomingWebhookUrl}`,
        {
          projectId: data.data.projectId?.toString(),
          statusPageId: data.data.statusPageId?.toString(),
        } as LogAttributes,
      );
      if (
        !MicrosoftTeamsUtil.isValidMicrosoftTeamsIncomingWebhookUrl(
          data.data.microsoftTeamsIncomingWebhookUrl,
        )
      ) {
        logger.debug("Invalid Microsoft Teams Incoming Webhook URL.", {
          projectId: data.data.projectId?.toString(),
          statusPageId: data.data.statusPageId?.toString(),
        } as LogAttributes);
        throw new BadDataException(
          "Invalid Microsoft Teams Incoming Webhook URL.",
        );
      }
    }

    /*
     * Validate the generic subscriber webhook URL if provided. Subscriber
     * creation is publicly accessible (Permission.Public), so an unauthenticated
     * user can supply this URL. Reject targets that point at private, loopback,
     * link-local, or cloud metadata addresses to prevent SSRF.
     *
     * No `allowPrivateNetworkTargets` here, deliberately, and none in
     * StatusPageSubscriberWebhookUtil either. The private-network exception
     * (issue #3424) exists for URLs an authenticated project member authored;
     * this one is chosen by whoever is looking at a public status page, and
     * granting it the exception would hand any visitor on the internet a POST
     * into the operator's internal network.
     */
    if (data.data.subscriberWebhook) {
      await SSRFProtection.validateWebhookTargetIsSafe(
        data.data.subscriberWebhook,
      );
    }

    /*
     * The code in the link that confirms the subscription: one nobody can
     * guess, minted here whatever the request carried
     * (StatusPageSubscriberConfirmationCode).
     */
    data.data.subscriptionConfirmationToken =
      StatusPageSubscriberConfirmationCode.generate();

    /*
     * The secret in this subscriber's unsubscribe link. Always minted here,
     * whatever the request carried: the column is computed, so the create
     * column check lets a client send one, and a token the client chose would
     * be one somebody else could know. A re-subscribe deletes the old row
     * above and gets a new token, so links to the old subscription stop
     * working.
     */
    data.data.unsubscribeToken =
      StatusPageSubscriberUnsubscribeToken.generate();

    /*
     * Never taken from a client either: whether the team added this
     * subscriber. Only a sign-up on the status page is not the team's, and
     * only createFromStatusPageSignUp creates one. A teammate's create carries
     * a creator (Created By) but an API key's or a workflow's does not, so
     * this is the column that says it for all of them.
     */
    data.data.isAddedByTeam = !statusPageSignUps.has(data.data);

    /*
     * Likewise never taken from a client. A subscriber is only ever created
     * unsubscribed through the API, and then it was cancelled now.
     */
    if (data.data.isUnsubscribed) {
      data.data.unsubscribedAt = OneUptimeDate.getCurrentDate();
    } else {
      delete data.data.unsubscribedAt;
    }
    // Never the code itself: the link it is in is the whole of the confirmation.
    logger.debug("Subscription confirmation code minted.", {
      projectId: data.data.projectId?.toString(),
      statusPageId: data.data.statusPageId?.toString(),
    } as LogAttributes);

    // Not the data itself: it now carries the unsubscribe token.
    logger.debug("onBeforeCreate processed data.", {
      projectId: data.data.projectId?.toString(),
      statusPageId: data.data.statusPageId?.toString(),
    } as LogAttributes);

    const carryForward: SubscriberCreateCarryForward = {
      statusPage: statuspage,
      replacedSubscriberIds: replacedSubscriberIds,
      signUp: statusPageSignUps.has(data.data) ? data.data : null,
      teamSendPermit: null,
      isSending: false,
    };

    return { createBy: data, carryForward: carryForward };
  }

  /*
   * What a create is told when its page already has a subscription of the
   * same contact: a visitor that they are subscribed, the team which rule
   * the contact runs into.
   */
  private getAlreadySubscribedMessage(isSignUp: boolean): string {
    return isSignUp
      ? ALREADY_SUBSCRIBED_MESSAGE
      : CONTACT_ALREADY_SUBSCRIBED_MESSAGE;
  }

  /*
   * Whether a subscription holds its contact on its page against a new
   * subscription of the contact there, at `now` (the app's clock): one that
   * is on and confirmed, or on and waiting for its confirmation while the
   * link to it still works - a day after it was sent, when the subscription
   * was created (StatusPageSubscriberConfirmationCode). A cancelled one
   * holds nothing, and neither does one whose link has run out: nobody can
   * confirm it any more, and the contact's next subscription replaces it
   * (onCreateSuccess). So whoever signs a contact up first cannot keep its
   * owner from subscribing for longer than that day - and the link went to
   * the contact itself.
   */
  public holdsItsContact(
    subscription: Pick<
      Model,
      "isUnsubscribed" | "isSubscriptionConfirmed" | "createdAt"
    >,
    now: number,
  ): boolean {
    if (subscription.isUnsubscribed) {
      return false;
    }

    if (subscription.isSubscriptionConfirmed) {
      return true;
    }

    return !StatusPageSubscriberConfirmationCode.hasExpired(
      subscription.createdAt,
      now,
    );
  }

  /*
   * Refuses a create whose contact one of `subscriptions` - every
   * subscription of the contact on its page - holds (holdsItsContact).
   *
   * The team is told the rule its contact runs into. A visitor is told they
   * are subscribed, or - when every subscription that holds the contact is
   * waiting for its confirmation - that a link to confirm it was sent
   * already, and when to come back for a new one: the contact gets one such
   * link from a page a day, however often it is signed up. Refused for a
   * while (429, with Retry-After), and nothing is sent, so the sign-up gives
   * its contact its count back (createFromStatusPageSignUp).
   */
  private assertContactNotHeld(data: {
    subscriptions: Array<Model>;
    subscriber: Model;
    isSignUp: boolean;
    now: number;
  }): void {
    const holders: Array<Model> = data.subscriptions.filter(
      (subscription: Model): boolean => {
        return this.holdsItsContact(subscription, data.now);
      },
    );

    if (holders.length === 0) {
      return;
    }

    logger.debug("The contact is held by a subscription of the page.", {
      projectId: data.subscriber.projectId?.toString(),
      statusPageId: data.subscriber.statusPageId?.toString(),
    } as LogAttributes);

    const waiting: Array<Model> = holders.filter((holder: Model): boolean => {
      return !holder.isSubscriptionConfirmed;
    });

    if (!data.isSignUp || waiting.length < holders.length) {
      throw new BadDataException(
        this.getAlreadySubscribedMessage(data.isSignUp),
      );
    }

    // Until the last of their links runs out.
    const secondsLeft: number = Math.max(
      ...waiting.map((holder: Model): number => {
        return StatusPageSubscriberConfirmationCode.getSecondsLeft(
          holder.createdAt,
          data.now,
        );
      }),
    );

    throw new PublicMessageRateLimitException(
      data.subscriber.subscriberEmail
        ? CONFIRMATION_LINK_SENT_TO_EMAIL_MESSAGE
        : data.subscriber.subscriberPhone
          ? CONFIRMATION_LINK_SENT_TO_PHONE_MESSAGE
          : CONFIRMATION_LINK_SENT_MESSAGE,
      secondsLeft,
    );
  }

  /*
   * The contacts `subscriber` names: each of its email address, phone
   * number, Slack and Microsoft Teams channels and webhook that holds
   * something. A workspace name alone is no contact.
   */
  public getContactColumnsNamed(
    subscriber: Partial<
      Pick<Model, (typeof SUBSCRIBER_CONTACT_COLUMNS)[number]>
    >,
  ): Array<(typeof SUBSCRIBER_CONTACT_COLUMNS)[number]> {
    return SUBSCRIBER_CONTACT_COLUMNS.filter(
      (column: (typeof SUBSCRIBER_CONTACT_COLUMNS)[number]): boolean => {
        return Boolean(subscriber[column]?.toString().trim());
      },
    );
  }

  /*
   * Every subscription of the page under one of the contacts `subscriber`
   * names - its email address, its phone's line, each of its webhooks'
   * addresses (SubscriberContactKey) - active or cancelled, each once, with
   * what holdsItsContact reads (SUBSCRIPTION_HOLD_COLUMNS).
   * `exceptIds` leaves subscriptions out (one being changed). Read in
   * batches, every one of them: a webhook's address is compared here, not
   * in the database, so a page's subscribers of that channel are all read.
   */
  private async findSubscriptionsOfContacts(data: {
    statusPageId: ObjectID;
    projectId: ObjectID;
    subscriber: Partial<
      Pick<Model, (typeof SUBSCRIBER_CONTACT_COLUMNS)[number]>
    >;
    find: SubscriberRowFinder;
    exceptIds?: Array<string> | undefined;
  }): Promise<Array<Model>> {
    const found: Map<string, Model> = new Map<string, Model>();
    const exceptIds: Array<string> = (data.exceptIds || []).map(
      (id: string): string => {
        return id.toLowerCase();
      },
    );

    const page: Record<string, unknown> = {
      statusPageId: data.statusPageId.toString(),
      projectId: data.projectId.toString(),
    };

    const keep: (rows: Array<Model>) => void = (rows: Array<Model>): void => {
      for (const row of rows) {
        const id: string | undefined = row._id?.toString().toLowerCase();

        if (id && !exceptIds.includes(id)) {
          found.set(id, row);
        }
      }
    };

    const email: string = data.subscriber.subscriberEmail
      ? SubscriberContactKey.forEmail(data.subscriber.subscriberEmail)
      : "";

    if (email) {
      keep(
        await this.readEveryRow({
          find: data.find,
          where: {
            ...page,
            subscriberEmail: QueryHelper.findWithSameText(email),
          },
          select: SUBSCRIPTION_HOLD_COLUMNS,
        }),
      );
    }

    if (
      data.subscriber.subscriberPhone &&
      SubscriberContactKey.forPhone(data.subscriber.subscriberPhone)
    ) {
      keep(
        await this.readEveryRow({
          find: data.find,
          where: {
            ...page,
            subscriberPhone: SubscriberContactSql.onPhoneLine(
              data.subscriber.subscriberPhone,
            ),
          },
          select: SUBSCRIPTION_HOLD_COLUMNS,
        }),
      );
    }

    for (const column of SUBSCRIBER_WEBHOOK_COLUMNS) {
      const value: URL | undefined = data.subscriber[column];

      if (!value || !value.toString().trim()) {
        continue;
      }

      const rows: Array<Model> = await this.readEveryRow({
        find: data.find,
        where: {
          ...page,
          [column]: QueryHelper.notNull(),
        },
        select: { ...SUBSCRIPTION_HOLD_COLUMNS, [column]: true },
      });

      keep(
        rows.filter((row: Model): boolean => {
          return SubscriberContactKey.isSameUrl(row[column], value);
        }),
      );
    }

    return Array.from(found.values());
  }

  // Every row `find` reads for `where`, batch after batch, in _id order.
  private async readEveryRow(data: {
    find: SubscriberRowFinder;
    where: Record<string, unknown>;
    select: Record<string, boolean>;
  }): Promise<Array<Model>> {
    const rows: Array<Model> = [];
    let afterId: string | undefined = undefined;

    for (;;) {
      const batch: Array<Model> = await data.find({
        where: data.where,
        select: data.select,
        afterId: afterId,
        limit: CONTACT_LOOKUP_BATCH_SIZE,
      });

      rows.push(...batch);

      const lastId: string | undefined =
        batch[batch.length - 1]?._id?.toString();

      if (batch.length < CONTACT_LOOKUP_BATCH_SIZE || !lastId) {
        return rows;
      }

      afterId = lastId;
    }
  }

  // Reads subscriber rows through this service, as OneUptime.
  private getServiceRowFinder(): SubscriberRowFinder {
    return async (query: {
      where: Record<string, unknown>;
      select: Record<string, boolean>;
      afterId: string | undefined;
      limit: number;
    }): Promise<Array<Model>> => {
      return await this.findBy({
        query: {
          ...query.where,
          ...(query.afterId
            ? { _id: QueryHelper.greaterThan(new ObjectID(query.afterId)) }
            : {}),
        } as Query<Model>,
        select: query.select as Select<Model>,
        sort: {
          _id: SortOrder.Ascending,
        },
        limit: query.limit,
        skip: 0,
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });
    };
  }

  /*
   * Reads subscriber rows with the transaction a create's INSERT is decided
   * in (getCreateLimit), which holds the page's lock: a read through the
   * service would run outside it, on another of the pool's connections.
   */
  private getTransactionRowFinder(manager: EntityManager): SubscriberRowFinder {
    return async (query: {
      where: Record<string, unknown>;
      select: Record<string, boolean>;
      afterId: string | undefined;
      limit: number;
    }): Promise<Array<Model>> => {
      return await manager.getRepository<Model>(this.modelType.name).find({
        where: {
          ...query.where,
          ...(query.afterId ? { _id: MoreThan(query.afterId) } : {}),
        } as FindOptionsWhere<Model>,
        select: query.select,
        order: {
          _id: "ASC",
        },
        take: query.limit,
      });
    };
  }

  /*
   * Unsubscribed At follows Is Unsubscribed on every write that sets it - a
   * teammate's toggle on the dashboard, the API, a workflow - not only on the
   * unsubscribe link, which sets both itself (see unsubscribe()).
   *
   * Which rows an update cancels has to be known before it runs: afterwards
   * every matched row reads unsubscribed, and a row that already was would
   * get today's date for a cancellation that happened long ago (or before the
   * column existed). The stamp itself is written after the update, as root,
   * by a plain UPDATE: through updateBy it would be a second update of the
   * row and fire the "on update" workflow trigger a second time.
   */
  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    // The resources it adds are its page's. See checkResourcesOnPages.
    await this.checkResourcesOnPages(updateBy);

    // A contact changed to one its page does not take is refused.
    await this.checkContactsAllowedOnPages(updateBy);

    // So is a contact changed to one another subscription of its page has.
    await this.checkContactsNotTakenOnPages(updateBy);

    // And a cancelled subscription turned back on, where its contact is taken.
    await this.checkContactsNotTakenWhenSubscribedAgain(updateBy);

    const isUnsubscribed: unknown = (
      updateBy.data as unknown as JSONObject | undefined
    )?.["isUnsubscribed"];

    const carryForward: UnsubscribedAtCarryForward = {
      isUnsubscribed:
        typeof isUnsubscribed === "boolean" ? isUnsubscribed : null,
      subscriberIdsBeingUnsubscribed: [],
    };

    if (carryForward.isUnsubscribed === true) {
      const matched: Array<Model> = await this.findRowsAndHoldUpdateToThem(
        updateBy,
        {
          _id: true,
          isUnsubscribed: true,
        },
      );

      carryForward.subscriberIdsBeingUnsubscribed = matched
        .filter((subscriber: Model): boolean => {
          return Boolean(subscriber._id) && subscriber.isUnsubscribed !== true;
        })
        .map((subscriber: Model): string => {
          return subscriber._id!.toString();
        });
    }

    return { updateBy, carryForward };
  }

  /*
   * An update that names resources may add only resources of each changed
   * subscriber's own status page - for a visitor's change on the manage
   * subscription page, ones the page shows (StatusPageSubscriberResources).
   * What a subscriber names already is left alone, so the dashboard and the
   * manage subscription page, which send the whole list back on every save,
   * never lock a subscription against editing. The subscribers are the rows
   * the update writes - the ones its caller may write - and the update is
   * held to them (findRowsAndHoldUpdateToThem): a subscriber the caller
   * cannot reach says nothing, and one the check did not read is not
   * written.
   */
  private async checkResourcesOnPages(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    const named: Array<string> = StatusPageSubscriberResources.getNamedIds(
      (updateBy.data as unknown as JSONObject | undefined)?.[
        StatusPageSubscriberResources.RESOURCES_COLUMN
      ],
    );

    if (named.length === 0) {
      return;
    }

    const subscribers: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      {
        _id: true,
        statusPageId: true,
        statusPageResources: {
          _id: true,
        },
      },
    );

    await StatusPageSubscriberResources.assertUpdateOnPages({
      subscribers: subscribers,
      named: named,
      shownToVisitorsOnly: manageSubscriptionPageUpdates.has(updateBy),
    });
  }

  /*
   * Whether a status page takes this subscriber: Only Private Users Can
   * Subscribe and Allowed Email Domains (Types/StatusPage/
   * SubscriberRestrictions). Refused with what a visitor signing up on the
   * page can act on, or with what the team can - the setting to change.
   */
  public async assertSubscriberAllowedOnPage(data: {
    statusPage: Pick<
      StatusPage,
      "_id" | "limitSubscribersToPrivateUsers" | "allowedSubscriberEmailDomains"
    >;
    subscriber: Partial<
      Pick<Model, (typeof SUBSCRIBER_CONTACT_COLUMNS)[number]>
    >;
    isSignUp: boolean;
  }): Promise<void> {
    const email: string = (
      data.subscriber.subscriberEmail?.toString() || ""
    ).trim();

    if (data.statusPage.limitSubscribersToPrivateUsers) {
      const hasOtherContact: boolean = SUBSCRIBER_CONTACT_COLUMNS.some(
        (column: (typeof SUBSCRIBER_CONTACT_COLUMNS)[number]): boolean => {
          return (
            column !== "subscriberEmail" &&
            Boolean(data.subscriber[column]?.toString().trim())
          );
        },
      );

      if (hasOtherContact || !email) {
        throw new BadDataException(SubscriberRestrictionMessages.emailOnly);
      }

      const statusPageId: string | undefined = data.statusPage._id?.toString();

      if (
        !statusPageId ||
        !(await StatusPagePrivateUserService.isPrivateUserEmail({
          statusPageId: new ObjectID(statusPageId),
          email: email,
        }))
      ) {
        throw new BadDataException(
          data.isSignUp
            ? SubscriberRestrictionMessages.notPrivateUser
            : fillSubscriberRestrictionMessage(
                SubscriberRestrictionMessages.teamAddedNotPrivateUser,
                { email: email },
              ),
        );
      }
    }

    const domains: Array<string> = getAllowedEmailDomains(
      data.statusPage.allowedSubscriberEmailDomains,
    );

    if (
      email &&
      domains.length > 0 &&
      !isEmailAtAllowedDomain({ email: email, domains: domains })
    ) {
      throw new BadDataException(getDomainNotAllowedMessage(domains));
    }
  }

  /*
   * An update that changes a subscriber's contact - its email, phone, Slack,
   * Microsoft Teams or webhook - is held to what its page takes, as a new
   * subscriber is (assertSubscriberAllowedOnPage): the contact as the update
   * leaves it. An update that changes no contact - a resource, a switch - is
   * left alone, so a subscriber added before a setting can still be edited
   * or unsubscribed. The subscribers are the rows the update writes, and the
   * update is held to them (findRowsAndHoldUpdateToThem).
   */
  private async checkContactsAllowedOnPages(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    const data: JSONObject | undefined = updateBy.data as unknown as
      | JSONObject
      | undefined;

    const changedColumns: Array<(typeof SUBSCRIBER_CONTACT_COLUMNS)[number]> =
      SUBSCRIBER_CONTACT_COLUMNS.filter(
        (column: (typeof SUBSCRIBER_CONTACT_COLUMNS)[number]): boolean => {
          return Boolean(data) && data![column] !== undefined;
        },
      );

    if (changedColumns.length === 0) {
      return;
    }

    const subscribers: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      {
        _id: true,
        statusPageId: true,
        subscriberEmail: true,
        subscriberPhone: true,
        slackIncomingWebhookUrl: true,
        microsoftTeamsIncomingWebhookUrl: true,
        subscriberWebhook: true,
      },
    );

    const statusPageIds: Array<string> = [];

    for (const subscriber of subscribers) {
      const statusPageId: string | undefined =
        subscriber.statusPageId?.toString();

      if (statusPageId && !statusPageIds.includes(statusPageId)) {
        statusPageIds.push(statusPageId);
      }
    }

    if (statusPageIds.length === 0) {
      return;
    }

    const statusPages: Array<StatusPage> = await StatusPageService.findBy({
      query: {
        _id: QueryHelper.any(statusPageIds),
      },
      select: {
        _id: true,
        limitSubscribersToPrivateUsers: true,
        allowedSubscriberEmailDomains: true,
      },
      limit: statusPageIds.length,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    for (const subscriber of subscribers) {
      const statusPage: StatusPage | undefined = statusPages.find(
        (page: StatusPage): boolean => {
          return page._id?.toString() === subscriber.statusPageId?.toString();
        },
      );

      if (
        !statusPage ||
        (!statusPage.limitSubscribersToPrivateUsers &&
          getAllowedEmailDomains(statusPage.allowedSubscriberEmailDomains)
            .length === 0)
      ) {
        continue;
      }

      const contact: Partial<
        Pick<Model, (typeof SUBSCRIBER_CONTACT_COLUMNS)[number]>
      > = {};

      for (const column of SUBSCRIBER_CONTACT_COLUMNS) {
        const value: unknown = changedColumns.includes(column)
          ? data![column]
          : subscriber[column];

        (contact as Record<string, unknown>)[column] = value ?? undefined;
      }

      await this.assertSubscriberAllowedOnPage({
        statusPage: statusPage,
        subscriber: contact,
        isSignUp: manageSubscriptionPageUpdates.has(updateBy),
      });
    }
  }

  /*
   * An update that changes a subscriber's contact - its email, phone, Slack,
   * Microsoft Teams or webhook - may not give it one that another
   * subscription of its page has, however either is written
   * (findSubscriptionsOfContacts): a page takes each contact once, as a new
   * subscriber is held to (onBeforeCreate). Nor may one update give one
   * contact to two subscriptions of a page. A cancelled subscription of the
   * contact does not count, and an update that changes no contact is left
   * alone. The subscribers are the rows the update writes, and the update is
   * held to them (findRowsAndHoldUpdateToThem).
   */
  private async checkContactsNotTakenOnPages(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    const data: JSONObject | undefined = updateBy.data as unknown as
      | JSONObject
      | undefined;

    const contact: Partial<
      Pick<Model, (typeof SUBSCRIBER_CONTACT_COLUMNS)[number]>
    > = {};

    for (const column of SUBSCRIBER_CONTACT_COLUMNS) {
      const value: unknown = data?.[column];

      if (value !== undefined && value !== null && String(value).trim()) {
        (contact as Record<string, unknown>)[column] = value;
      }
    }

    if (Object.keys(contact).length === 0) {
      return;
    }

    const subscribers: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      {
        _id: true,
        statusPageId: true,
        projectId: true,
      },
    );

    const pagesChanged: Set<string> = new Set<string>();

    for (const subscriber of subscribers) {
      const statusPageId: string | undefined = subscriber.statusPageId
        ?.toString()
        .toLowerCase();

      if (!statusPageId || !subscriber.projectId || !subscriber._id) {
        continue;
      }

      if (pagesChanged.has(statusPageId)) {
        throw new BadDataException(CONTACT_ALREADY_SUBSCRIBED_MESSAGE);
      }

      pagesChanged.add(statusPageId);

      const taken: Array<Model> = await this.findSubscriptionsOfContacts({
        statusPageId: new ObjectID(statusPageId),
        projectId: subscriber.projectId,
        subscriber: contact,
        find: this.getServiceRowFinder(),
        exceptIds: [subscriber._id.toString()],
      });

      if (
        taken.some((other: Model): boolean => {
          return !other.isUnsubscribed;
        })
      ) {
        throw new BadDataException(CONTACT_ALREADY_SUBSCRIBED_MESSAGE);
      }
    }
  }

  /*
   * An update that turns cancelled subscriptions back on - the team's
   * Status of Subscribed, the API, a workflow, or the visitor's own manage
   * page - may not leave their page with two active subscriptions of one
   * contact, however either is written (findSubscriptionsOfContacts): a
   * cancelled subscription whose contact another subscription of its page
   * has taken since, or is turned on by the same update, stays cancelled,
   * and the update is refused. A subscription that is on already is left
   * alone, so the manage page, which sends Unsubscribed off with every
   * change, never locks a subscriber saved before a page took each contact
   * once. The subscribers are the rows the update writes, and the update is
   * held to them (findRowsAndHoldUpdateToThem).
   */
  private async checkContactsNotTakenWhenSubscribedAgain(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    const data: JSONObject | undefined = updateBy.data as unknown as
      | JSONObject
      | undefined;

    if (data?.["isUnsubscribed"] !== false) {
      return;
    }

    const subscribers: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      {
        _id: true,
        statusPageId: true,
        projectId: true,
        isUnsubscribed: true,
        subscriberEmail: true,
        subscriberPhone: true,
        slackIncomingWebhookUrl: true,
        microsoftTeamsIncomingWebhookUrl: true,
        subscriberWebhook: true,
      },
    );

    // Every one the update writes is on once it is written.
    const turnedOnIds: Set<string> = new Set<string>(
      subscribers
        .map((subscriber: Model): string => {
          return subscriber._id?.toString().toLowerCase() || "";
        })
        .filter((id: string): boolean => {
          return Boolean(id);
        }),
    );

    for (const subscriber of subscribers) {
      if (
        subscriber.isUnsubscribed !== true ||
        !subscriber.statusPageId ||
        !subscriber.projectId ||
        !subscriber._id
      ) {
        continue;
      }

      // Its contacts as the update leaves them.
      const contact: Partial<
        Pick<Model, (typeof SUBSCRIBER_CONTACT_COLUMNS)[number]>
      > = {};

      for (const column of SUBSCRIBER_CONTACT_COLUMNS) {
        const written: unknown = data[column];
        const value: unknown =
          written !== undefined && written !== null && String(written).trim()
            ? written
            : subscriber[column];

        if (value) {
          (contact as Record<string, unknown>)[column] = value;
        }
      }

      const taken: Array<Model> = await this.findSubscriptionsOfContacts({
        statusPageId: subscriber.statusPageId,
        projectId: subscriber.projectId,
        subscriber: contact,
        find: this.getServiceRowFinder(),
        exceptIds: [subscriber._id.toString()],
      });

      if (
        taken.some((other: Model): boolean => {
          return (
            !other.isUnsubscribed ||
            turnedOnIds.has(other._id?.toString().toLowerCase() || "")
          );
        })
      ) {
        throw new BadDataException(
          this.getAlreadySubscribedMessage(
            manageSubscriptionPageUpdates.has(updateBy),
          ),
        );
      }
    }
  }

  /*
   * The conditions getSubscribersByStatusPage reads a page's subscribers
   * with, so a send reaches only those the page takes now
   * (Utils/StatusPage/SubscriberRestrictionSql): one on each contact column,
   * the page's settings read in the same statement.
   */
  public getSubscriberRestrictionQuery(
    statusPageId: ObjectID,
  ): Record<
    (typeof SUBSCRIBER_CONTACT_COLUMNS)[number],
    FindWhereProperty<any>
  > {
    const parameter: string = "subscriberRestrictionStatusPageId";
    const parameters: Record<string, string> = {
      [parameter]: statusPageId.toString(),
    };
    const pageId: string = `CAST(:${parameter} AS uuid)`;

    const settings: SubscriberRestrictionSettingsSql = {
      limitSubscribersToPrivateUsers: `(SELECT "restrictingPage"."limitSubscribersToPrivateUsers" FROM "StatusPage" "restrictingPage" WHERE "restrictingPage"."_id" = ${pageId})`,
      allowedSubscriberEmailDomains: `(SELECT "restrictingPage"."allowedSubscriberEmailDomains" FROM "StatusPage" "restrictingPage" WHERE "restrictingPage"."_id" = ${pageId})`,
    };

    const otherContact: () => FindWhereProperty<any> =
      (): FindWhereProperty<any> => {
        return Raw((alias: string): string => {
          return getOtherContactConditionSql({
            column: alias,
            settings: settings,
          });
        }, parameters);
      };

    return {
      subscriberEmail: Raw((alias: string): string => {
        return getEmailConditionSql({
          email: alias,
          statusPageId: pageId,
          privateUsersOf: `"privateUser"."statusPageId" = ${pageId}`,
          settings: settings,
        });
      }, parameters),
      subscriberPhone: otherContact(),
      slackIncomingWebhookUrl: otherContact(),
      microsoftTeamsIncomingWebhookUrl: otherContact(),
      subscriberWebhook: otherContact(),
    };
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    const carryForward: UnsubscribedAtCarryForward | undefined =
      onUpdate.carryForward as UnsubscribedAtCarryForward | undefined;

    if (!carryForward || carryForward.isUnsubscribed === null) {
      return onUpdate;
    }

    const updatedIds: Array<string> = updatedItemIds.map(
      (id: ObjectID): string => {
        return id.toString();
      },
    );

    if (carryForward.isUnsubscribed === true) {
      const cancelledIds: Array<string> =
        carryForward.subscriberIdsBeingUnsubscribed.filter(
          (id: string): boolean => {
            return updatedIds.includes(id);
          },
        );

      if (cancelledIds.length > 0) {
        await this.getRepository().manager.query(
          `UPDATE "StatusPageSubscriber" SET "unsubscribedAt" = $1 WHERE "_id" = ANY($2::uuid[]) AND "isUnsubscribed" = true AND "unsubscribedAt" IS NULL`,
          [OneUptimeDate.getCurrentDate(), cancelledIds],
        );
      }

      return onUpdate;
    }

    // Subscribed again: the old date no longer describes this subscription.
    if (updatedIds.length > 0) {
      await this.getRepository().manager.query(
        `UPDATE "StatusPageSubscriber" SET "unsubscribedAt" = NULL WHERE "_id" = ANY($1::uuid[]) AND "isUnsubscribed" = false AND "unsubscribedAt" IS NOT NULL`,
        [updatedIds],
      );
    }

    return onUpdate;
  }

  /*
   * Cancel a subscription, once. Returns whether this call cancelled it:
   * false when it was already cancelled (or does not exist), which makes the
   * unsubscribe link idempotent.
   *
   * ONE STATEMENT, ON PURPOSE: the WHERE clause's `"isUnsubscribed" = false`
   * lets Postgres decide which of two simultaneous requests - a double click,
   * a mail client that follows the confirmation twice - cancels the
   * subscription, so its Unsubscribed At is written once and the team is told
   * once. `RETURNING` is what tells this call whether it was the one.
   *
   * Written as raw SQL because no DatabaseService write both takes that
   * predicate and reports what it matched. That skips the update hooks, so
   * the "on update" workflow trigger and the realtime event a DatabaseService
   * update fires are fired here, by hand, with the two columns this wrote.
   */
  @CaptureSpan()
  public async unsubscribe(data: {
    subscriberId: ObjectID;
    source: StatusPageSubscriberUnsubscribeSource;
  }): Promise<boolean> {
    const unsubscribedAt: Date = OneUptimeDate.getCurrentDate();

    const rows: Array<JSONObject> = returnedRows(
      await this.getRepository().manager.query(
        `UPDATE "StatusPageSubscriber"
            SET "isUnsubscribed" = true,
                "unsubscribedAt" = $1,
                "updatedAt" = CURRENT_TIMESTAMP
          WHERE "_id" = $2
            AND "isUnsubscribed" = false
            AND "deletedAt" IS NULL
      RETURNING "_id", "projectId"`,
        [unsubscribedAt, data.subscriberId.toString()],
      ),
    );

    const row: JSONObject | undefined = rows[0];

    if (!row || !row["_id"]) {
      return false;
    }

    const projectId: ObjectID | null = row["projectId"]
      ? new ObjectID(row["projectId"].toString())
      : null;

    if (projectId) {
      if (this.getModel().enableWorkflowOn?.update) {
        await this.onTriggerWorkflow(
          data.subscriberId,
          projectId,
          "on-update",
          {
            updatedFields: {
              isUnsubscribed: true,
              unsubscribedAt: unsubscribedAt.toISOString(),
            },
          },
        );
      }

      await this.onTriggerRealtime(
        data.subscriberId,
        projectId,
        ModelEventType.Update,
      );
    }

    /*
     * The subscription is cancelled either way; a failure to tell the team
     * must not turn that into an error for the person who asked.
     */
    try {
      await this.notifyTeamOfUnsubscribe({
        subscriberId: data.subscriberId,
        source: data.source,
        unsubscribedAt: unsubscribedAt,
      });
    } catch (err) {
      logger.error(err, {
        statusPageSubscriberId: data.subscriberId.toString(),
      } as LogAttributes);
    }

    return true;
  }

  /*
   * What the status page's unsubscribe page shows for a link, before anything
   * is changed. Opening the page calls this; only a POST unsubscribes.
   *
   * Every way a link can be wrong - a malformed id or token, no such
   * subscriber, a deleted one, one on another status page, a token that does
   * not match - reads the same, Invalid, after the same constant-time token
   * comparison, so the answer cannot be used to tell them apart.
   */
  @CaptureSpan()
  public async getUnsubscribeLinkDetails(data: {
    statusPageId: string;
    subscriberId: string;
    token: string;
  }): Promise<StatusPageSubscriberUnsubscribeDetails> {
    const subscriber: Model | null =
      await this.findSubscriberByUnsubscribeLink(data);

    if (!subscriber) {
      return { state: StatusPageSubscriberUnsubscribeState.Invalid };
    }

    const contact: StatusPageSubscriberContact | null =
      StatusPageSubscriberUnsubscribe.describeContact(subscriber);

    return {
      state: subscriber.isUnsubscribed
        ? StatusPageSubscriberUnsubscribeState.Unsubscribed
        : StatusPageSubscriberUnsubscribeState.Subscribed,
      channel: contact?.channel,
      contact: contact?.contact,
      wasAddedByTeam: this.isAddedByTeam(subscriber),
    };
  }

  /*
   * The unsubscribe page's POST: cancel the subscription the link belongs to.
   * Idempotent - a second confirmation, or one for a subscription already
   * cancelled some other way, answers Unsubscribed again and changes nothing.
   * A bad link answers Invalid, exactly as getUnsubscribeLinkDetails does.
   */
  @CaptureSpan()
  public async unsubscribeWithLink(data: {
    statusPageId: string;
    subscriberId: string;
    token: string;
  }): Promise<StatusPageSubscriberUnsubscribeState> {
    const subscriber: Model | null =
      await this.findSubscriberByUnsubscribeLink(data);

    if (!subscriber || !subscriber.id) {
      return StatusPageSubscriberUnsubscribeState.Invalid;
    }

    if (!subscriber.isUnsubscribed) {
      await this.unsubscribe({
        subscriberId: subscriber.id,
        source: StatusPageSubscriberUnsubscribeSource.UnsubscribeLink,
      });
    }

    return StatusPageSubscriberUnsubscribeState.Unsubscribed;
  }

  /*
   * The subscriber an unsubscribe link belongs to, read with what the
   * unsubscribe page and the team's notice need, or null when the link is not
   * good (see findSubscriberByLink).
   */
  private async findSubscriberByUnsubscribeLink(data: {
    statusPageId: string;
    subscriberId: string;
    token: string;
  }): Promise<Model | null> {
    return await this.findSubscriberByLink({
      ...data,
      select: {
        isUnsubscribed: true,
        isAddedByTeam: true,
        createdByUserId: true,
        subscriberEmail: true,
        subscriberPhone: true,
        slackIncomingWebhookUrl: true,
        slackWorkspaceName: true,
        microsoftTeamsIncomingWebhookUrl: true,
        microsoftTeamsWorkspaceName: true,
        subscriberWebhook: true,
      },
    });
  }

  /*
   * The subscription a manage link ({statusPageUrl}/update-subscription/
   * {id}-{token}) belongs to, as the status page's Update Subscription page
   * shows it - its contact and its choices - or null when the link is not
   * good. The manage page's two routes (get-subscription and
   * update-subscription) read the subscriber only through here, so the
   * subscriber id alone, which every project member who may read
   * subscribers sees, never opens it: the token is the subscription's own,
   * sent only to its contact.
   */
  @CaptureSpan()
  public async findSubscriberForManagePage(data: {
    statusPageId: string;
    subscriberId: string;
    token: string;
  }): Promise<Model | null> {
    return await this.findSubscriberByLink({
      ...data,
      select: {
        isUnsubscribed: true,
        subscriberEmail: true,
        subscriberPhone: true,
        slackWorkspaceName: true,
        statusPageResources: true,
        isSubscribedToAllResources: true,
        statusPageEventTypes: true,
        isSubscribedToAllEventTypes: true,
      },
    });
  }

  /*
   * The subscriber a link belongs to, or null when the link is not good. The
   * subscriber is found by its primary key and its status page, never by the
   * token, and the token is then compared in constant time - a query on the
   * token would let the database's own comparison time a guess. The
   * comparison runs even when there is no subscriber to compare with, so a
   * malformed id, no such subscriber, a deleted one, one on another status
   * page and a wrong token all take the same path and give the same null.
   *
   * The token is read only to be compared: the subscriber handed back never
   * carries it, so no answer built from it can.
   */
  private async findSubscriberByLink(data: {
    statusPageId: string;
    subscriberId: string;
    token: string;
    select: Select<Model>;
  }): Promise<Model | null> {
    const isWellFormed: boolean =
      typeof data.statusPageId === "string" &&
      typeof data.subscriberId === "string" &&
      ObjectID.isValidUUID(data.statusPageId) &&
      ObjectID.isValidUUID(data.subscriberId);

    const subscriber: Model | null = isWellFormed
      ? await this.findOneBy({
          query: {
            _id: data.subscriberId,
            statusPageId: new ObjectID(data.statusPageId),
          },
          select: {
            ...data.select,
            _id: true,
            statusPageId: true,
            unsubscribeToken: true,
          },
          props: {
            isRoot: true,
            ignoreHooks: true,
          },
        })
      : null;

    const tokenMatches: boolean = StatusPageSubscriberUnsubscribeToken.matches({
      stored: subscriber?.unsubscribeToken,
      presented: typeof data.token === "string" ? data.token : null,
    });

    if (!subscriber || !tokenMatches) {
      return null;
    }

    delete subscriber.unsubscribeToken;

    return subscriber;
  }

  /*
   * Tell the team that a subscriber it added has unsubscribed itself (see
   * StatusPageSubscriberUnsubscribeNotice for why). Subscribers people signed
   * up for themselves on the status page tell nobody.
   *
   * A subscriber the team added is one with Is Added By Team - from the
   * dashboard, with an API key or by a workflow - or, created before that
   * column, with a creator (see isAddedByTeam).
   *
   * It goes to the status page's owners - its owner users and the members of
   * its owner teams - and to the teammate who added the subscriber, when a
   * teammate did, each once and only while they are still members of the
   * project, as one plain email through MailService rather than a
   * notification rule: it is about a subscriber list, not an event anyone is
   * on call for. A page with no owners tells only the teammate who added the
   * subscriber; one an API key or a workflow added, on a page with no owners,
   * tells nobody.
   */
  @CaptureSpan()
  public async notifyTeamOfUnsubscribe(data: {
    subscriberId: ObjectID;
    source: StatusPageSubscriberUnsubscribeSource;
    unsubscribedAt: Date;
  }): Promise<void> {
    const subscriber: Model | null = await this.findOneById({
      id: data.subscriberId,
      select: {
        _id: true,
        projectId: true,
        statusPageId: true,
        isAddedByTeam: true,
        createdByUserId: true,
        createdAt: true,
        subscriberEmail: true,
        subscriberPhone: true,
        slackIncomingWebhookUrl: true,
        slackWorkspaceName: true,
        microsoftTeamsIncomingWebhookUrl: true,
        microsoftTeamsWorkspaceName: true,
        subscriberWebhook: true,
      },
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });

    if (
      !subscriber ||
      !this.isAddedByTeam(subscriber) ||
      !subscriber.projectId ||
      !subscriber.statusPageId
    ) {
      return;
    }

    const contact: StatusPageSubscriberContact | null =
      StatusPageSubscriberUnsubscribe.describeContact(subscriber, {
        maskPhone: false,
      });

    if (!contact) {
      return;
    }

    const statusPage: StatusPage | null = await StatusPageService.findOneById({
      id: subscriber.statusPageId,
      select: {
        _id: true,
        name: true,
        pageTitle: true,
      },
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });

    if (!statusPage) {
      return;
    }

    // Only a teammate's create has a creator; an API key's or a workflow's does not.
    const creator: User | null = subscriber.createdByUserId
      ? await UserService.findOneById({
          id: subscriber.createdByUserId,
          select: {
            _id: true,
            name: true,
            email: true,
          },
          props: {
            isRoot: true,
          },
        })
      : null;

    const candidates: Array<User> = [
      ...(await StatusPageService.findOwners(subscriber.statusPageId)),
      ...(creator ? [creator] : []),
    ];

    const recipients: Array<User> = [];
    const seenUserIds: Set<string> = new Set<string>();

    for (const user of await TeamMemberService.filterUsersToProjectMembers({
      projectId: subscriber.projectId,
      users: candidates,
    })) {
      const userId: string = user.id?.toString().toLowerCase() || "";

      if (!userId || !user.email || seenUserIds.has(userId)) {
        continue;
      }

      seenUserIds.add(userId);
      recipients.push(user);
    }

    if (recipients.length === 0) {
      return;
    }

    if (!(await this.isFirstUnsubscribeNoticeInWindow(subscriber.id!))) {
      logger.debug(
        `The team was told about subscriber ${subscriber.id!.toString()} unsubscribing within the last ${StatusPageSubscriberUnsubscribeNotice.noticeWindowInHours} hours; not telling it again.`,
        {
          projectId: subscriber.projectId.toString(),
          statusPageId: subscriber.statusPageId.toString(),
        } as LogAttributes,
      );
      return;
    }

    const subscriberListUrl: string = (
      await StatusPageService.getStatusPageLinkInDashboard(
        subscriber.projectId,
        subscriber.statusPageId,
      )
    )
      .addRoute(
        `/${StatusPageSubscriberUnsubscribeNotice.getSubscriberListRoute(
          contact.channel,
        )}`,
      )
      .toString();

    const email: StatusPageSubscriberUnsubscribeNoticeEmail =
      StatusPageSubscriberUnsubscribeNotice.build({
        statusPageName:
          statusPage.name || statusPage.pageTitle || "Status Page",
        contact: contact,
        source: data.source,
        unsubscribedAt: data.unsubscribedAt,
        addedByName: creator?.name?.toString() || creator?.email?.toString(),
        addedAt: subscriber.createdAt,
        subscriberListUrl: subscriberListUrl,
      });

    for (const recipient of recipients) {
      MailService.sendMail(
        {
          toEmail: recipient.email!,
          templateType: EmailTemplateType.SimpleMessage,
          vars: {
            subject: email.subject,
            message: email.message,
          },
          subject: email.subject,
          isSubjectLiteral: true,
        },
        {
          projectId: subscriber.projectId,
          userId: recipient.id!,
        },
      ).catch((err: Error) => {
        logger.error(err, {
          projectId: subscriber.projectId?.toString(),
          statusPageId: subscriber.statusPageId?.toString(),
        } as LogAttributes);
      });
    }
  }

  /*
   * The team is told about a subscriber unsubscribing at most once per
   * window. The public manage page both re-subscribes a subscriber and
   * cancels it again, and it is open to anyone who can see the status page
   * and knows the subscriber's id (it is in the manage link), so without this
   * a loop of the two would email every owner of the page on every turn.
   *
   * One atomic SET NX per subscriber: exactly one notice wins the window
   * however many cancellations arrive together. If the cache cannot be
   * reached the notice goes out: telling the team twice is better than not
   * at all.
   */
  private async isFirstUnsubscribeNoticeInWindow(
    subscriberId: ObjectID,
  ): Promise<boolean> {
    try {
      return await GlobalCache.setStringIfNotExists(
        StatusPageSubscriberUnsubscribeNotice.noticeCacheNamespace,
        subscriberId.toString().toLowerCase(),
        OneUptimeDate.getCurrentDate().toISOString(),
        {
          expiresInSeconds:
            StatusPageSubscriberUnsubscribeNotice.noticeWindowInHours * 60 * 60,
        },
      );
    } catch (err) {
      logger.warn(
        `Could not check when the team was last told about subscriber ${subscriberId.toString()} unsubscribing; telling it: ${err instanceof Error ? err.message : String(err)}`,
      );
      return true;
    }
  }

  /*
   * A subscriber the team adds - from the dashboard, in bulk, with an API
   * key or by a workflow - is sent a message as it is created on each
   * contact getContactsMessagedOnCreate names. Each such contact is
   * counted (PublicMessageRateLimit.assertTeamMaySend, with the sign-ups of
   * the same contact), so one contact is sent a bounded number of
   * subscription messages an hour, whoever adds it: past its limit the
   * create is refused with 429, before anything is written. The team itself is never counted,
   * so adding many subscribers at once goes on. Here, after every check of
   * the create, so a refused one never counts. A sign-up was counted by its
   * route, against its visitor too.
   */
  @CaptureSpan()
  protected override async onCreatePermitted(
    onCreate: OnCreate<Model>,
  ): Promise<void> {
    await super.onCreatePermitted(onCreate);

    const carryForward: SubscriberCreateCarryForward | undefined =
      onCreate.carryForward as SubscriberCreateCarryForward | undefined;

    if (!carryForward || carryForward.signUp) {
      return;
    }

    const contacts: Array<PublicMessageContact> =
      this.getContactsMessagedOnCreate(onCreate.createBy.data);

    if (contacts.length === 0) {
      return;
    }

    carryForward.teamSendPermit =
      await PublicMessageRateLimit.assertTeamMaySend({
        kind: TeamMessageKind.SubscriberAdded,
        contacts: contacts,
      });
  }

  /*
   * A create that failed before onCreateSuccess began sent nothing: the
   * contacts the team's create was counted for get their count back.
   */
  @CaptureSpan()
  protected override async onCreateError(
    error: Exception,
    onCreate?: OnCreate<Model> | undefined,
    failedStatement?: StatementContext | undefined,
  ): Promise<Exception> {
    const carryForward: SubscriberCreateCarryForward | undefined =
      onCreate?.carryForward as SubscriberCreateCarryForward | undefined;

    if (carryForward?.teamSendPermit && !carryForward.isSending) {
      await carryForward.teamSendPermit.giveBack();
    }

    return await super.onCreateError(error, onCreate, failedStatement);
  }

  /*
   * The contacts a new subscriber is sent a message on as it is created
   * (onCreateSuccess), as PublicMessageRateLimit counts them: an email
   * address asked to confirm, or told it is subscribed; a phone number
   * texted the link that confirms it, or that it is subscribed; a Slack or
   * Microsoft Teams channel, or a webhook, told it is subscribed. Only what
   * is sent: a subscriber created confirmed and not to be told is sent
   * nothing, and counts for nothing.
   */
  public getContactsMessagedOnCreate(
    subscriber: Partial<
      Pick<
        Model,
        | (typeof SUBSCRIBER_CONTACT_COLUMNS)[number]
        | "isSubscriptionConfirmed"
        | "sendYouHaveSubscribedMessage"
      >
    >,
  ): Array<PublicMessageContact> {
    const isConfirmed: boolean = Boolean(subscriber.isSubscriptionConfirmed);
    const isTold: boolean = subscriber.sendYouHaveSubscribedMessage !== false;

    const contacts: Array<PublicMessageContact> = [];

    if (subscriber.subscriberEmail && (!isConfirmed || isTold)) {
      contacts.push(
        PublicMessageRateLimit.forEmail(subscriber.subscriberEmail),
      );
    }

    if (subscriber.subscriberPhone && (!isConfirmed || isTold)) {
      contacts.push(
        PublicMessageRateLimit.forPhone(subscriber.subscriberPhone),
      );
    }

    if (isTold && subscriber.slackIncomingWebhookUrl) {
      contacts.push(
        PublicMessageRateLimit.forWebhook(
          PublicMessageChannel.Slack,
          subscriber.slackIncomingWebhookUrl,
        ),
      );
    }

    if (isTold && subscriber.microsoftTeamsIncomingWebhookUrl) {
      contacts.push(
        PublicMessageRateLimit.forWebhook(
          PublicMessageChannel.MicrosoftTeams,
          subscriber.microsoftTeamsIncomingWebhookUrl,
        ),
      );
    }

    if (isTold && subscriber.subscriberWebhook) {
      contacts.push(
        PublicMessageRateLimit.forWebhook(
          PublicMessageChannel.Webhook,
          subscriber.subscriberWebhook,
        ),
      );
    }

    return contacts;
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    /*
     * From here on a sign-up's contacts may be sent its messages: if its
     * create fails after this, it is not one that sent nothing
     * (createFromStatusPageSignUp) - and neither is a subscriber the team
     * adds (onCreateError).
     */
    const signUp: Model | null | undefined = (
      onCreate.carryForward as SubscriberCreateCarryForward | undefined
    )?.signUp;

    if (signUp) {
      statusPageSignUpsSending.add(signUp);
    }

    if (onCreate.carryForward) {
      (onCreate.carryForward as SubscriberCreateCarryForward).isSending = true;
    }

    // Not the item itself: it carries the unsubscribe token.
    logger.debug(
      `onCreateSuccess called with createdItem ${createdItem.id?.toString()}.`,
      {
        projectId: createdItem.projectId?.toString(),
      } as LogAttributes,
    );

    if (!createdItem.statusPageId) {
      logger.debug("Status Page ID is missing in createdItem.", {
        projectId: createdItem.projectId?.toString(),
      } as LogAttributes);
      return createdItem;
    }

    const carryForward: SubscriberCreateCarryForward | undefined =
      onCreate.carryForward as SubscriberCreateCarryForward | undefined;
    const statusPageOfSubscriber: StatusPage | undefined =
      carryForward?.statusPage;

    /*
     * The contact's subscriptions on this page that the new one replaces go
     * now that it exists: links to them stop working. Only those that hold
     * the contact no more (holdsItsContact), of the same status page and
     * project as the new subscriber - cancelled ones, and ones still waiting
     * for a confirmation whose link has run out - each asked again as it is
     * deleted, so one confirmed or turned back on since is kept.
     */
    const replacedSubscriberIds: Array<ObjectID> =
      carryForward?.replacedSubscriberIds || [];

    if (replacedSubscriberIds.length > 0 && createdItem.projectId) {
      logger.debug("Subscriber is unsubscribed. Deleting old record.", {
        projectId: createdItem.projectId?.toString(),
        statusPageId: createdItem.statusPageId?.toString(),
      } as LogAttributes);

      await this.deleteBy({
        query: {
          _id: QueryHelper.any(replacedSubscriberIds),
          projectId: createdItem.projectId,
          statusPageId: createdItem.statusPageId,
          isUnsubscribed: true,
        },
        limit: replacedSubscriberIds.length,
        skip: 0,
        props: {
          ignoreHooks: true,
          isRoot: true,
        },
      });

      await this.deleteBy({
        query: {
          _id: QueryHelper.any(replacedSubscriberIds),
          projectId: createdItem.projectId,
          statusPageId: createdItem.statusPageId,
          isSubscriptionConfirmed: false,
          createdAt: QueryHelper.lessThanEqualTo(
            new Date(
              Date.now() - StatusPageSubscriberConfirmationCode.VALID_FOR_MS,
            ),
          ),
        },
        limit: replacedSubscriberIds.length,
        skip: 0,
        props: {
          ignoreHooks: true,
          isRoot: true,
        },
      });
    }

    const statusPageURL: string = await StatusPageService.getStatusPageURL(
      createdItem.statusPageId,
    );
    logger.debug(`Status Page URL: ${statusPageURL}`, {
      projectId: createdItem.projectId?.toString(),
    } as LogAttributes);

    const statusPageName: string =
      statusPageOfSubscriber?.pageTitle ||
      statusPageOfSubscriber?.name ||
      "Status Page";
    logger.debug(`Status Page Name: ${statusPageName}`, {
      projectId: createdItem.projectId?.toString(),
    } as LogAttributes);

    /*
     * The Slack and Teams welcome messages below are Markdown, and the status
     * page's name is plain text that its admins typed: mdText escapes it in
     * the heading and inside the link's own text, so it reads as typed and
     * cannot become a link, an image, raw HTML or a chat mention.
     *
     * createdItem carries the unsubscribe token onBeforeCreate minted.
     */
    const unsubscribeLink: string = this.getUnsubscribeLink(
      URL.fromString(statusPageURL),
      createdItem,
    ).toString();

    /*
     * A phone subscriber created unconfirmed - a visitor who signed up by
     * text message (onBeforeCreate writes the column every time) - is
     * texted the link that confirms it, and nothing else until it is
     * opened. A confirmed one is told it is subscribed, when it was created
     * to be.
     */
    const isPhoneToConfirm: boolean =
      createdItem.isSubscriptionConfirmed === false;

    /*
     * The code the link carries, as onBeforeCreate minted it - read back if
     * the saved row came without it. A link without its code confirms
     * nothing, so none is sent.
     */
    const confirmationCode: string = isPhoneToConfirm
      ? createdItem.subscriptionConfirmationToken ||
        (createdItem.id
          ? (
              await this.findOneById({
                id: createdItem.id,
                select: { subscriptionConfirmationToken: true },
                props: { isRoot: true, ignoreHooks: true },
              })
            )?.subscriptionConfirmationToken || ""
          : "")
      : "";

    if (
      createdItem.statusPageId &&
      createdItem.subscriberPhone &&
      createdItem._id &&
      (isPhoneToConfirm
        ? Boolean(confirmationCode)
        : createdItem.sendYouHaveSubscribedMessage)
    ) {
      logger.debug(
        isPhoneToConfirm
          ? "Subscriber has a phone number to confirm."
          : "Subscriber has a phone number and sendYouHaveSubscribedMessage is true.",
        { projectId: createdItem.projectId?.toString() } as LogAttributes,
      );
      const statusPage: StatusPage | null = await StatusPageService.findOneBy({
        query: {
          _id: createdItem.statusPageId.toString(),
        },
        select: {
          // Every number it sends from, its SMS numbers included.
          callSmsConfig: PROJECT_TWILIO_CONFIG_SELECT,
        },
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });

      if (!statusPage) {
        logger.debug("Status Page not found.", {
          projectId: createdItem.projectId?.toString(),
        } as LogAttributes);
        return createdItem;
      }

      // Whether the page texts through its own account - never its settings, which hold its credentials.
      logger.debug(
        `Status page sends with its own SMS account: ${Boolean(statusPage.callSmsConfig)}`,
        { projectId: createdItem.projectId?.toString() } as LogAttributes,
      );

      this.sendText({
        subscriber: createdItem,
        statusPage: {
          id: createdItem.statusPageId,
          callSmsConfig: statusPage.callSmsConfig,
        } as Pick<StatusPage, "id" | "callSmsConfig">,
        message: isPhoneToConfirm
          ? getConfirmSubscriptionTextMessage({
              statusPageName: statusPageName,
              confirmationUrl: this.getConfirmSubscriptionLink({
                statusPageUrl: statusPageURL,
                confirmationToken: confirmationCode,
                statusPageSubscriberId: createdItem.id!,
              }).toString(),
            })
          : getYouHaveSubscribedTextMessage({
              statusPageName: statusPageName,
              unsubscribeUrl: unsubscribeLink,
            }),
      });
    }

    if (
      createdItem.statusPageId &&
      createdItem.subscriberEmail &&
      createdItem._id
    ) {
      logger.debug("Subscriber has an email.", {
        projectId: createdItem.projectId?.toString(),
      } as LogAttributes);
      const isSubscriptionConfirmed: boolean = Boolean(
        createdItem.isSubscriptionConfirmed,
      );
      logger.debug(`Is Subscription Confirmed: ${isSubscriptionConfirmed}`, {
        projectId: createdItem.projectId?.toString(),
      } as LogAttributes);

      if (!isSubscriptionConfirmed) {
        logger.debug(
          "Subscription is not confirmed. Sending confirmation email.",
          { projectId: createdItem.projectId?.toString() } as LogAttributes,
        );
        await this.sendConfirmSubscriptionEmail({
          subscriberId: createdItem.id!,
        });
      }

      if (isSubscriptionConfirmed && createdItem.sendYouHaveSubscribedMessage) {
        logger.debug(
          "Subscription is confirmed and sendYouHaveSubscribedMessage is true. Sending 'You have subscribed' email.",
          { projectId: createdItem.projectId?.toString() } as LogAttributes,
        );
        await this.sendYouHaveSubscribedEmail({
          subscriberId: createdItem.id!,
        });
      }
    }

    // if slack incoming webhook is provided and sendYouHaveSubscribedMessage is true, then send a message to the slack channel.
    if (
      createdItem.slackIncomingWebhookUrl &&
      createdItem.sendYouHaveSubscribedMessage
    ) {
      logger.debug("Sending Slack notification for new subscriber.", {
        projectId: createdItem.projectId?.toString(),
      } as LogAttributes);
      const slackMessage: string =
        mdText`## 📢 New Subscription to ${statusPageName}

**You have successfully subscribed to receive status updates!**

🔗 **Status Page:** [${statusPageName}](${statusPageURL})
🔕 **Unsubscribe:** [Stop these notifications](${unsubscribeLink})

You will receive real-time notifications for:
• Incidents and outages 
• Scheduled maintenance events  
• Service announcements
• Status updates

Stay informed about service availability! 🚀`.toString();

      logger.debug(`Slack Message: ${slackMessage}`, {
        projectId: createdItem.projectId?.toString(),
      } as LogAttributes);

      SlackUtil.sendMessageToChannelViaIncomingWebhook({
        url: URL.fromString(createdItem.slackIncomingWebhookUrl.toString()),
        text: SlackUtil.convertMarkdownToSlackRichText(slackMessage),
      })
        .then(() => {
          logger.debug("Slack notification sent successfully.", {
            projectId: createdItem.projectId?.toString(),
          } as LogAttributes);
        })
        .catch((err: Error) => {
          logger.error("Error sending Slack notification:", {
            projectId: createdItem.projectId?.toString(),
          } as LogAttributes);
          logger.error(err, {
            projectId: createdItem.projectId?.toString(),
          } as LogAttributes);
        });
    }

    // if generic webhook URL is provided and sendYouHaveSubscribedMessage is true, then ping the webhook with the subscription event.
    if (
      createdItem.subscriberWebhook &&
      createdItem.sendYouHaveSubscribedMessage
    ) {
      logger.debug("Sending webhook notification for new subscriber.", {
        projectId: createdItem.projectId?.toString(),
      } as LogAttributes);

      StatusPageSubscriberWebhookUtil.sendWebhookNotification({
        webhookUrl: URL.fromString(createdItem.subscriberWebhook.toString()),
        payload: {
          eventType: "SubscriberSubscribed",
          statusPageId: createdItem.statusPageId.toString(),
          statusPageName: statusPageName,
          statusPageUrl: statusPageURL,
          unsubscribeUrl: unsubscribeLink,
          data: {
            message: `You have been subscribed to ${statusPageName}.`,
          },
        },
      })
        .then(() => {
          logger.debug("Webhook notification sent successfully.", {
            projectId: createdItem.projectId?.toString(),
          } as LogAttributes);
        })
        .catch((err: Error) => {
          logger.error("Error sending webhook notification:", {
            projectId: createdItem.projectId?.toString(),
          } as LogAttributes);
          logger.error(err, {
            projectId: createdItem.projectId?.toString(),
          } as LogAttributes);
        });
    }

    // if Microsoft Teams incoming webhook is provided and sendYouHaveSubscribedMessage is true, then send a message to the Teams channel.
    if (
      createdItem.microsoftTeamsIncomingWebhookUrl &&
      createdItem.sendYouHaveSubscribedMessage
    ) {
      logger.debug("Sending Microsoft Teams notification for new subscriber.", {
        projectId: createdItem.projectId?.toString(),
      } as LogAttributes);
      const teamsMessage: string =
        mdText`## 📢 New Subscription to ${statusPageName}

**You have successfully subscribed to receive status updates!**

🔗 **Status Page:** [${statusPageName}](${statusPageURL})
🔕 **Unsubscribe:** [Stop these notifications](${unsubscribeLink})

You will receive real-time notifications for:
• Incidents and outages 
• Scheduled maintenance events  
• Service announcements
• Status updates

Stay informed about service availability! 🚀`.toString();

      logger.debug(`Teams Message: ${teamsMessage}`, {
        projectId: createdItem.projectId?.toString(),
      } as LogAttributes);

      MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook({
        url: URL.fromString(
          createdItem.microsoftTeamsIncomingWebhookUrl.toString(),
        ),
        text: teamsMessage,
      })
        .then(() => {
          logger.debug("Microsoft Teams notification sent successfully.", {
            projectId: createdItem.projectId?.toString(),
          } as LogAttributes);
        })
        .catch((err: Error) => {
          logger.error("Error sending Microsoft Teams notification:", {
            projectId: createdItem.projectId?.toString(),
          } as LogAttributes);
          logger.error(err, {
            projectId: createdItem.projectId?.toString(),
          } as LogAttributes);
        });
    }

    logger.debug("onCreateSuccess completed.", {
      projectId: createdItem.projectId?.toString(),
    } as LogAttributes);
    return createdItem;
  }

  /*
   * One text to a phone subscriber about its own subscription, through the
   * page's own Twilio when it has one and paid from the project's balance
   * otherwise, like every text a status page sends. Not awaited: a text
   * that cannot be sent is logged (the SMS log says why), and never fails
   * the subscription.
   */
  private sendText(data: {
    subscriber: Pick<Model, "subscriberPhone" | "projectId">;
    statusPage: Pick<StatusPage, "id" | "callSmsConfig">;
    message: string;
  }): void {
    const statusPage: Pick<StatusPage, "id" | "callSmsConfig"> =
      data.statusPage;

    if (!data.subscriber.subscriberPhone || !statusPage.id) {
      return;
    }

    SmsService.sendSms(
      {
        to: data.subscriber.subscriberPhone,
        // OneUptime's own words, in GSM-7's characters (SubscriberSms).
        message: writeDefaultSubscriberSms(data.message),
      },
      {
        projectId: data.subscriber.projectId,
        isSensitive: false,
        customTwilioConfig: ProjectCallSMSConfigService.toTwilioConfig(
          statusPage.callSmsConfig,
        ),
        statusPageId: statusPage.id,
      },
    ).catch((err: Error) => {
      logger.error(err, {
        projectId: data.subscriber.projectId?.toString(),
      } as LogAttributes);
    });
  }

  /*
   * A subscription's confirmation link opened (StatusPageAPI's
   * confirm-subscription route): the subscriber it names and the code it
   * carries - text only, compared with the subscription's own code exactly
   * and in constant time (StatusPageSubscriberConfirmationCode.matches). A
   * subscription not yet confirmed is confirmed, and told it is subscribed,
   * on its email or by text - while its link works: a day after it was
   * sent, when the subscription was created. Opened later it is Expired,
   * and confirms nothing.
   *
   * Once, however many requests open the link at the same moment - a double
   * tap, a page loaded twice. The update names the subscription as it was
   * read - not confirmed, at the version read - so the first request to
   * write it confirms it and the others match no row (DatabaseService's
   * compare-and-set on the version): only that one sends the welcome.
   *
   * A code minted before codes were 32 characters is six digits. A wrong
   * code for a subscription waiting with one gives that code up
   * (retireShortConfirmationCode): a short code confirms through its own
   * link and nothing else. Its subscription can still be confirmed by the
   * team, and its contact signed up again once its day is over.
   */
  @CaptureSpan()
  public async confirmSubscription(data: {
    subscriberId: unknown;
    code: unknown;
  }): Promise<SubscriptionConfirmationOutcome> {
    const subscriber: Model | null =
      typeof data.code === "string" &&
      data.code.length > 0 &&
      typeof data.subscriberId === "string" &&
      ObjectID.isValidUUID(data.subscriberId)
        ? await this.findOneBy({
            query: {
              _id: data.subscriberId,
            },
            select: {
              _id: true,
              isSubscriptionConfirmed: true,
              subscriptionConfirmationToken: true,
              createdAt: true,
              version: true,
            },
            props: {
              isRoot: true,
            },
          })
        : null;

    if (!subscriber || !subscriber.id) {
      return SubscriptionConfirmationOutcome.NotFound;
    }

    if (
      !StatusPageSubscriberConfirmationCode.matches({
        stored: subscriber.subscriptionConfirmationToken,
        presented: data.code,
      })
    ) {
      if (
        !subscriber.isSubscriptionConfirmed &&
        subscriber.subscriptionConfirmationToken &&
        !StatusPageSubscriberConfirmationCode.isCurrent(
          subscriber.subscriptionConfirmationToken,
        )
      ) {
        await this.retireShortConfirmationCode(subscriber);
      }

      return SubscriptionConfirmationOutcome.NotFound;
    }

    if (subscriber.isSubscriptionConfirmed) {
      return SubscriptionConfirmationOutcome.AlreadyConfirmed;
    }

    if (StatusPageSubscriberConfirmationCode.hasExpired(subscriber.createdAt)) {
      return SubscriptionConfirmationOutcome.Expired;
    }

    const confirmed: number = await this.updateOneBy({
      query: {
        _id: subscriber.id.toString(),
        isSubscriptionConfirmed: false,
        ...(typeof subscriber.version === "number"
          ? { version: subscriber.version }
          : {}),
      },
      data: {
        isSubscriptionConfirmed: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (confirmed === 0) {
      /*
       * Another request wrote the subscription first: another opening of
       * this link confirmed it - or a wrong code gave up its short code,
       * and then this link confirms nothing.
       */
      const now: Model | null = await this.findOneBy({
        query: {
          _id: subscriber.id.toString(),
        },
        select: {
          _id: true,
          isSubscriptionConfirmed: true,
        },
        props: {
          isRoot: true,
        },
      });

      return now?.isSubscriptionConfirmed
        ? SubscriptionConfirmationOutcome.AlreadyConfirmed
        : SubscriptionConfirmationOutcome.NotFound;
    }

    await this.sendYouHaveSubscribedEmail({
      subscriberId: subscriber.id,
    });

    await this.sendYouHaveSubscribedText({
      subscriberId: subscriber.id,
    });

    return SubscriptionConfirmationOutcome.Confirmed;
  }

  /*
   * Gives up the short code of a subscription that waits for its
   * confirmation (confirmSubscription): a wrong code was tried for it, and
   * nobody who holds the link sends a wrong one - the link carries the code
   * whole. Its code is cleared, and no request confirms a subscription
   * without one.
   *
   * Written only to the subscription as it was read - not confirmed, with
   * that code, at the version read - and moving its version on, as every
   * write does: requests that read it together race on one version, as
   * openings of a link do, so of a right code and wrong ones tried at the
   * same moment, at most one is answered and the others match no row. One
   * statement, without hooks: nothing about the subscription a teammate or a
   * workflow would hear of has changed.
   */
  private async retireShortConfirmationCode(
    subscriber: Pick<
      Model,
      "_id" | "subscriptionConfirmationToken" | "version"
    >,
  ): Promise<void> {
    await this.getRepository().update(
      {
        _id: subscriber._id!.toString(),
        isSubscriptionConfirmed: false,
        subscriptionConfirmationToken:
          subscriber.subscriptionConfirmationToken!,
        ...(typeof subscriber.version === "number"
          ? { version: subscriber.version }
          : {}),
      } as FindOptionsWhere<Model>,
      {
        subscriptionConfirmationToken: null,
        version: () => {
          return '"version" + 1';
        },
      } as any,
    );
  }

  /*
   * The text that tells a phone subscriber who signed up on the status page
   * that it is subscribed, once it has opened the link that confirms it
   * (StatusPageAPI's confirm-subscription route) - as an email subscriber is
   * emailed then - when it was created to be told (Send You Have Subscribed
   * Message). Read as every subscriber message reads its page: an archived
   * page, or a page of a blocked project, sends nothing.
   */
  @CaptureSpan()
  public async sendYouHaveSubscribedText(data: {
    subscriberId: ObjectID;
  }): Promise<void> {
    const subscriber: Model | null = await this.findOneBy({
      query: {
        _id: data.subscriberId,
      },
      select: {
        _id: true,
        statusPageId: true,
        subscriberPhone: true,
        projectId: true,
        sendYouHaveSubscribedMessage: true,
        unsubscribeToken: true,
      },
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });

    if (
      !subscriber ||
      !subscriber.statusPageId ||
      !subscriber.subscriberPhone ||
      !subscriber.sendYouHaveSubscribedMessage
    ) {
      return;
    }

    // Its unsubscribe link needs its token (see ensureUnsubscribeTokens).
    await this.ensureUnsubscribeTokens([subscriber]);

    const statusPage: StatusPage | undefined = (
      await this.getStatusPagesToSendNotification([subscriber.statusPageId])
    )[0];

    if (!statusPage || !statusPage.id) {
      return;
    }

    const statusPageURL: string = await StatusPageService.getStatusPageURL(
      statusPage.id,
    );

    this.sendText({
      subscriber: subscriber,
      statusPage: statusPage,
      message: getYouHaveSubscribedTextMessage({
        statusPageName:
          statusPage.pageTitle || statusPage.name || "Status Page",
        unsubscribeUrl: this.getUnsubscribeLink(
          URL.fromString(statusPageURL),
          subscriber,
        ).toString(),
      }),
    });
  }

  @CaptureSpan()
  public async sendConfirmSubscriptionEmail(data: {
    subscriberId: ObjectID;
  }): Promise<void> {
    logger.debug("sendConfirmSubscriptionEmail called with data:", {
      statusPageSubscriberId: data.subscriberId?.toString(),
    } as LogAttributes);
    logger.debug(data, {
      statusPageSubscriberId: data.subscriberId?.toString(),
    } as LogAttributes);

    // get subscriber
    const subscriber: Model | null = await this.findOneBy({
      query: {
        _id: data.subscriberId,
      },
      select: {
        statusPageId: true,
        subscriberEmail: true,
        subscriberPhone: true,
        projectId: true,
        subscriptionConfirmationToken: true,
        sendYouHaveSubscribedMessage: true,
        unsubscribeToken: true,
      },
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });
    logger.debug(`Found Subscriber: ${subscriber?.id?.toString()}`, {
      statusPageSubscriberId: data.subscriberId?.toString(),
    } as LogAttributes);

    // get status page
    if (!subscriber || !subscriber.statusPageId) {
      logger.debug("Subscriber or Status Page ID is missing.", {
        statusPageSubscriberId: data.subscriberId?.toString(),
      } as LogAttributes);
      return;
    }

    // Its unsubscribe link needs its token (see ensureUnsubscribeTokens).
    await this.ensureUnsubscribeTokens([subscriber]);

    /*
     * Read as every subscriber message reads its page: an archived page, or
     * a page of a blocked project, asks nobody to confirm.
     */
    const statusPage: StatusPage | undefined = (
      await this.getStatusPagesToSendNotification([subscriber.statusPageId])
    )[0];
    logger.debug(`Found Status Page: ${JSON.stringify(statusPage)}`, {
      statusPageSubscriberId: data.subscriberId?.toString(),
    } as LogAttributes);

    if (!statusPage || !statusPage.id) {
      logger.debug("Status Page not found or ID is missing.", {
        statusPageSubscriberId: data.subscriberId?.toString(),
      } as LogAttributes);
      return;
    }

    const statusPageURL: string = await StatusPageService.getStatusPageURL(
      statusPage.id,
    );
    logger.debug(`Status Page URL: ${statusPageURL}`, {
      statusPageSubscriberId: data.subscriberId?.toString(),
    } as LogAttributes);

    const statusPageName: string =
      statusPage.pageTitle || statusPage.name || "Status Page";
    logger.debug(`Status Page Name: ${statusPageName}`, {
      statusPageSubscriberId: data.subscriberId?.toString(),
    } as LogAttributes);

    const host: Hostname = await DatabaseConfig.getHost();
    logger.debug(`Host: ${host}`, {
      statusPageSubscriberId: data.subscriberId?.toString(),
    } as LogAttributes);

    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();
    logger.debug(`HTTP Protocol: ${httpProtocol}`, {
      statusPageSubscriberId: data.subscriberId?.toString(),
    } as LogAttributes);

    const confirmSubscriptionLink: string = this.getConfirmSubscriptionLink({
      statusPageUrl: statusPageURL,
      confirmationToken: subscriber.subscriptionConfirmationToken || "",
      statusPageSubscriberId: subscriber.id!,
    }).toString();

    if (
      subscriber.statusPageId &&
      subscriber.subscriberEmail &&
      subscriber._id
    ) {
      const unsubscribeUrl: string = this.getUnsubscribeLink(
        URL.fromString(statusPageURL),
        subscriber,
      ).toString();

      const customTemplate: StatusPageSubscriberNotificationTemplate | null =
        await StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage(
          {
            statusPageId: statusPage.id!,
            eventType:
              StatusPageSubscriberNotificationEventType.SubscriberSubscriptionConfirmation,
            notificationMethod: StatusPageSubscriberNotificationMethod.Email,
          },
        );

      const templateVariables: Record<string, string> = {
        statusPageName: statusPageName,
        statusPageUrl: statusPageURL,
        confirmationUrl: confirmSubscriptionLink,
        unsubscribeUrl: unsubscribeUrl,
      };

      if (customTemplate?.templateBody && statusPage.smtpConfig) {
        /*
         * Use custom template only when custom SMTP is configured (matches the
         * pattern used elsewhere — without custom SMTP we keep the styled
         * OneUptime default so emails still look right out-of-the-box).
         */
        // The body is HTML, so the (plain-text) values are escaped into it.
        const compiledBody: string =
          StatusPageSubscriberNotificationTemplateServiceClass.compileEmailBodyTemplate(
            customTemplate.templateBody,
            templateVariables,
          );
        const compiledSubject: string = customTemplate.emailSubject
          ? StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate(
              customTemplate.emailSubject,
              templateVariables,
            )
          : "Confirm your subscription to " + statusPageName;

        MailService.sendMail(
          {
            toEmail: subscriber.subscriberEmail,
            templateType: EmailTemplateType.BlankTemplate,
            vars: {
              body: compiledBody,
            },
            subject: compiledSubject,
            isSubjectLiteral: true,
          },
          {
            projectId: subscriber.projectId,
            mailServer: ProjectSMTPConfigService.toEmailServer(
              statusPage.smtpConfig,
            ),
            statusPageId: statusPage.id!,
          },
        ).catch((err: Error) => {
          logger.error(err, {
            projectId: subscriber.projectId?.toString(),
          } as LogAttributes);
        });
      } else {
        MailService.sendMail(
          {
            toEmail: subscriber.subscriberEmail,
            templateType: EmailTemplateType.ConfirmStatusPageSubscription,
            vars: {
              statusPageName: statusPageName,
              logoUrl: StatusPageEmailLogo.getLogoUrl({
                statusPage: statusPage,
                host: host,
                httpProtocol: httpProtocol,
              }),
              statusPageUrl: statusPageURL,
              isPublicStatusPage: statusPage.isPublicStatusPage
                ? "true"
                : "false",
              confirmationUrl: confirmSubscriptionLink,
              unsubscribeUrl: unsubscribeUrl,
            },
            subject: "Confirm your subscription to " + statusPageName,
            isSubjectLiteral: true,
          },
          {
            projectId: subscriber.projectId,
            mailServer: ProjectSMTPConfigService.toEmailServer(
              statusPage.smtpConfig,
            ),
            statusPageId: statusPage.id!,
          },
        ).catch((err: Error) => {
          logger.error(err, {
            projectId: subscriber.projectId?.toString(),
          } as LogAttributes);
        });
      }
      logger.debug("Confirmation email sent.", {
        statusPageSubscriberId: data.subscriberId?.toString(),
      } as LogAttributes);
    } else {
      logger.debug("Subscriber email or ID is missing.", {
        statusPageSubscriberId: data.subscriberId?.toString(),
      } as LogAttributes);
    }
  }

  @CaptureSpan()
  public async sendYouHaveSubscribedEmail(data: {
    subscriberId: ObjectID;
  }): Promise<void> {
    logger.debug("sendYouHaveSubscribedEmail called with data:", {
      statusPageSubscriberId: data.subscriberId?.toString(),
    } as LogAttributes);
    logger.debug(data, {
      statusPageSubscriberId: data.subscriberId?.toString(),
    } as LogAttributes);

    // get subscriber
    const subscriber: Model | null = await this.findOneBy({
      query: {
        _id: data.subscriberId,
      },
      select: {
        statusPageId: true,
        subscriberEmail: true,
        subscriberPhone: true,
        projectId: true,
        sendYouHaveSubscribedMessage: true,
        unsubscribeToken: true,
      },
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });
    logger.debug(`Found Subscriber: ${subscriber?.id?.toString()}`, {
      statusPageSubscriberId: data.subscriberId?.toString(),
    } as LogAttributes);

    // get status page
    if (!subscriber || !subscriber.statusPageId) {
      logger.debug("Subscriber or Status Page ID is missing.", {
        statusPageSubscriberId: data.subscriberId?.toString(),
      } as LogAttributes);
      return;
    }

    // Its unsubscribe link needs its token (see ensureUnsubscribeTokens).
    await this.ensureUnsubscribeTokens([subscriber]);

    /*
     * Read as every subscriber message reads its page: an archived page, or
     * a page of a blocked project, sends nothing - not even to someone who
     * confirms through a link it sent before.
     */
    const statusPage: StatusPage | undefined = (
      await this.getStatusPagesToSendNotification([subscriber.statusPageId])
    )[0];
    logger.debug(`Found Status Page: ${JSON.stringify(statusPage)}`, {
      statusPageSubscriberId: data.subscriberId?.toString(),
    } as LogAttributes);

    if (!statusPage || !statusPage.id) {
      logger.debug("Status Page not found or ID is missing.", {
        statusPageSubscriberId: data.subscriberId?.toString(),
      } as LogAttributes);
      return;
    }

    const statusPageURL: string = await StatusPageService.getStatusPageURL(
      statusPage.id,
    );
    logger.debug(`Status Page URL: ${statusPageURL}`, {
      statusPageSubscriberId: data.subscriberId?.toString(),
    } as LogAttributes);

    const statusPageName: string =
      statusPage.pageTitle || statusPage.name || "Status Page";
    logger.debug(`Status Page Name: ${statusPageName}`, {
      statusPageSubscriberId: data.subscriberId?.toString(),
    } as LogAttributes);

    const host: Hostname = await DatabaseConfig.getHost();
    logger.debug(`Host: ${host}`, {
      statusPageSubscriberId: data.subscriberId?.toString(),
    } as LogAttributes);

    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();
    logger.debug(`HTTP Protocol: ${httpProtocol}`, {
      statusPageSubscriberId: data.subscriberId?.toString(),
    } as LogAttributes);

    const unsubscribeLink: string = this.getUnsubscribeLink(
      URL.fromString(statusPageURL),
      subscriber,
    ).toString();

    if (
      subscriber.statusPageId &&
      subscriber.subscriberEmail &&
      subscriber._id
    ) {
      logger.debug("Subscriber has an email and ID.", {
        statusPageSubscriberId: data.subscriberId?.toString(),
      } as LogAttributes);

      const customTemplate: StatusPageSubscriberNotificationTemplate | null =
        await StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage(
          {
            statusPageId: statusPage.id!,
            eventType:
              StatusPageSubscriberNotificationEventType.SubscriberSubscribed,
            notificationMethod: StatusPageSubscriberNotificationMethod.Email,
          },
        );

      const templateVariables: Record<string, string> = {
        statusPageName: statusPageName,
        statusPageUrl: statusPageURL,
        unsubscribeUrl: unsubscribeLink,
      };

      if (customTemplate?.templateBody && statusPage.smtpConfig) {
        // The body is HTML, so the (plain-text) values are escaped into it.
        const compiledBody: string =
          StatusPageSubscriberNotificationTemplateServiceClass.compileEmailBodyTemplate(
            customTemplate.templateBody,
            templateVariables,
          );
        const compiledSubject: string = customTemplate.emailSubject
          ? StatusPageSubscriberNotificationTemplateServiceClass.compileTemplate(
              customTemplate.emailSubject,
              templateVariables,
            )
          : "You have been subscribed to " + statusPageName;

        MailService.sendMail(
          {
            toEmail: subscriber.subscriberEmail,
            templateType: EmailTemplateType.BlankTemplate,
            vars: {
              body: compiledBody,
            },
            subject: compiledSubject,
            isSubjectLiteral: true,
          },
          {
            projectId: subscriber.projectId,
            mailServer: ProjectSMTPConfigService.toEmailServer(
              statusPage.smtpConfig,
            ),
            statusPageId: statusPage.id!,
          },
        ).catch((err: Error) => {
          logger.error(err, {
            projectId: subscriber.projectId?.toString(),
          } as LogAttributes);
        });
      } else {
        MailService.sendMail(
          {
            toEmail: subscriber.subscriberEmail,
            templateType: EmailTemplateType.SubscribedToStatusPage,
            vars: {
              statusPageName: statusPageName,
              logoUrl: StatusPageEmailLogo.getLogoUrl({
                statusPage: statusPage,
                host: host,
                httpProtocol: httpProtocol,
              }),
              statusPageUrl: statusPageURL,
              isPublicStatusPage: statusPage.isPublicStatusPage
                ? "true"
                : "false",
              unsubscribeUrl: unsubscribeLink,
            },
            subject: "You have been subscribed to " + statusPageName,
            isSubjectLiteral: true,
          },
          {
            projectId: subscriber.projectId,
            mailServer: ProjectSMTPConfigService.toEmailServer(
              statusPage.smtpConfig,
            ),
            statusPageId: statusPage.id!,
          },
        ).catch((err: Error) => {
          logger.error("Error sending subscription email:", {
            projectId: subscriber.projectId?.toString(),
          } as LogAttributes);
          logger.error(err, {
            projectId: subscriber.projectId?.toString(),
          } as LogAttributes);
        });
      }
      logger.debug("Subscription email sent successfully.", {
        statusPageSubscriberId: data.subscriberId?.toString(),
      } as LogAttributes);
    } else {
      logger.debug("Subscriber email or ID is missing.", {
        statusPageSubscriberId: data.subscriberId?.toString(),
      } as LogAttributes);
    }
  }

  public getConfirmSubscriptionLink(data: {
    statusPageUrl: string;
    confirmationToken: string;
    statusPageSubscriberId: ObjectID;
  }): URL {
    const confirmSubscriptionLink: URL = URL.fromString(
      data.statusPageUrl,
    ).addRoute(
      `/confirm-subscription/${data.statusPageSubscriberId.toString()}?verification-token=${data.confirmationToken}`,
    );

    // The link with its code redacted: the code is the whole of the confirmation.
    logger.debug(
      `Generated Confirm Subscription Link: ${StatusPageSubscriberUnsubscribe.redactCredentials(
        confirmSubscriptionLink.toString(),
      )}`,
      {
        statusPageSubscriberId: data.statusPageSubscriberId?.toString(),
      } as LogAttributes,
    );
    return confirmSubscriptionLink;
  }

  /*
   * The confirmed, still-subscribed subscribers of a status page, in _id
   * order, at most `limit` (LIMIT_MAX by default) of them.
   *
   * One read stops at the limit, so a page with more subscribers than that
   * is read in batches: pass the _id of the last subscriber of one batch as
   * `afterId` to read the next, until a batch comes back smaller than the
   * limit (SubscriberNotificationFanOut does this for the subscriber jobs).
   * The cursor is an _id rather than an offset, so a subscriber who
   * unsubscribes while a send is part-way through cannot shift the rows
   * after it into a batch already read, and nobody is skipped.
   */
  @CaptureSpan()
  public async getSubscribersByStatusPage(
    statusPageId: ObjectID,
    props: DatabaseCommonInteractionProps,
    options?: {
      afterId?: ObjectID | undefined;
      limit?: number | undefined;
    },
  ): Promise<Array<Model>> {
    logger.debug("getSubscribersByStatusPage called with statusPageId:", {
      statusPageId: statusPageId?.toString(),
    } as LogAttributes);
    logger.debug(statusPageId, {
      statusPageId: statusPageId?.toString(),
    } as LogAttributes);
    logger.debug("DatabaseCommonInteractionProps:", {
      statusPageId: statusPageId?.toString(),
    } as LogAttributes);
    logger.debug(props, {
      statusPageId: statusPageId?.toString(),
    } as LogAttributes);

    const subscribers: Array<Model> = await this.findBy({
      query: {
        statusPageId: statusPageId,
        isUnsubscribed: false,
        isSubscriptionConfirmed: true,
        ...(options?.afterId
          ? { _id: QueryHelper.greaterThan(options.afterId) }
          : {}),
        /*
         * Only the subscribers the page takes now (Types/StatusPage/
         * SubscriberRestrictions), asked in this same read, so the _id
         * cursor and "a batch smaller than the limit is the last" still
         * hold.
         */
        ...this.getSubscriberRestrictionQuery(statusPageId),
      },
      select: {
        _id: true,
        subscriberEmail: true,
        subscriberPhone: true,
        subscriberWebhook: true,
        slackIncomingWebhookUrl: true,
        microsoftTeamsIncomingWebhookUrl: true,
        isSubscribedToAllResources: true,
        /*
         * With each resource's page: a subscriber is told about an event
         * only through resources of its own page (shouldSendNotification).
         */
        statusPageResources: {
          _id: true,
          statusPageId: true,
        },
        isSubscribedToAllEventTypes: true,
        statusPageEventTypes: true,
        // Every sender puts this subscriber's unsubscribe link in its message.
        unsubscribeToken: true,
        /*
         * Whether the team added this subscriber rather than it signing up
         * on the status page (see isAddedByTeam).
         */
        isAddedByTeam: true,
        createdByUserId: true,
      },
      // A stable order, which the afterId cursor reads on from.
      sort: {
        _id: SortOrder.Ascending,
      },
      skip: 0,
      limit: options?.limit || LIMIT_MAX,
      props: props,
    });

    await this.ensureUnsubscribeTokens(subscribers);

    /*
     * The count, not the rows: each row now carries its unsubscribe token,
     * which is a credential and has no place in a log line.
     */
    logger.debug(`Found ${subscribers.length} subscribers.`, {
      statusPageId: statusPageId?.toString(),
    } as LogAttributes);

    return subscribers;
  }

  /*
   * How many subscribers of each status page each channel reaches, for the
   * audience summary shown before an incident or a public note is sent
   * (IncidentSubscriberAudience). The same subscribers getSubscribersByStatusPage
   * sends to - confirmed, not unsubscribed - counted per channel in one
   * aggregate query rather than read out: it never loads an address.
   *
   * A channel counts a subscriber whenever the job would send on it, which is
   * whenever that column holds a value; a subscription with both an email and
   * a phone counts once on each. A subscriber its page no longer takes - not
   * a private user, not at an allowed domain - is sent nothing, and is not
   * counted (SUBSCRIBER_RESTRICTION_COUNT_SQL). Rows are pinned to the
   * project, whatever ids the caller passes.
   *
   * Keyed by the lower-cased status page id. A page with no active subscriber
   * has no entry.
   */
  @CaptureSpan()
  public async countActiveSubscribersByChannel(data: {
    projectId: ObjectID;
    statusPageIds: Array<ObjectID>;
  }): Promise<Dictionary<IncidentSubscriberAudienceCounts>> {
    const counts: Dictionary<IncidentSubscriberAudienceCounts> = {};

    const statusPageIds: Array<string> = [];

    for (const statusPageId of data.statusPageIds) {
      const id: string = statusPageId.toString().trim().toLowerCase();

      if (id && !statusPageIds.includes(id)) {
        statusPageIds.push(id);
      }
    }

    if (statusPageIds.length === 0) {
      return counts;
    }

    const rows: Array<{
      statusPageId: string;
      email: string;
      sms: string;
      slack: string;
      microsoftTeams: string;
      webhook: string;
    }> = await this.getRepository().manager.query(
      `SELECT
         "subscriber"."statusPageId"::text AS "statusPageId",
         COUNT(*) FILTER (WHERE NULLIF(TRIM("subscriber"."subscriberEmail"), '') IS NOT NULL)::text AS "email",
         COUNT(*) FILTER (WHERE NULLIF(TRIM("subscriber"."subscriberPhone"), '') IS NOT NULL)::text AS "sms",
         COUNT(*) FILTER (WHERE NULLIF(TRIM("subscriber"."slackIncomingWebhookUrl"), '') IS NOT NULL)::text AS "slack",
         COUNT(*) FILTER (WHERE NULLIF(TRIM("subscriber"."microsoftTeamsIncomingWebhookUrl"), '') IS NOT NULL)::text AS "microsoftTeams",
         COUNT(*) FILTER (WHERE NULLIF(TRIM("subscriber"."subscriberWebhook"), '') IS NOT NULL)::text AS "webhook"
       FROM "StatusPageSubscriber" "subscriber"
       LEFT JOIN "StatusPage" "statusPage"
         ON "statusPage"."_id" = "subscriber"."statusPageId"
       WHERE "subscriber"."projectId" = $1
         AND "subscriber"."statusPageId" = ANY($2::uuid[])
         AND "subscriber"."isUnsubscribed" = false
         AND "subscriber"."isSubscriptionConfirmed" = true
         AND "subscriber"."deletedAt" IS NULL
         AND ${SUBSCRIBER_RESTRICTION_COUNT_SQL}
       GROUP BY "subscriber"."statusPageId"`,
      [data.projectId.toString(), statusPageIds],
    );

    const toCount: (value: string | undefined) => number = (
      value: string | undefined,
    ): number => {
      const count: number = parseInt(value || "0", 10);
      return Number.isFinite(count) && count > 0 ? count : 0;
    };

    for (const row of rows) {
      counts[row.statusPageId.toLowerCase()] = {
        email: toCount(row.email),
        sms: toCount(row.sms),
        slack: toCount(row.slack),
        microsoftTeams: toCount(row.microsoftTeams),
        webhook: toCount(row.webhook),
      };
    }

    return counts;
  }

  /*
   * The link to a subscriber's unsubscribe page, which every notification to
   * it carries: {statusPageUrl}/unsubscribe/{id}-{token}. It works on public
   * and private status pages alike and without signing in, and it only ever
   * asks - the page unsubscribes when its reader confirms (see
   * Common/Types/StatusPage/StatusPageSubscriberUnsubscribe).
   *
   * Pass the subscriber read with its unsubscribeToken: every loader that
   * feeds a sender selects it (getSubscribersByStatusPage and the subscribe
   * and manage emails). A subscriber without one still gets a link, to the
   * page that says the link is out of date, rather than none; that is logged,
   * because only a subscriber created around the migration that added the
   * token, or one written with hooks skipped, can lack it.
   */
  public getUnsubscribeLink(
    statusPageUrl: URL,
    subscriber: Pick<Model, "_id" | "id" | "unsubscribeToken">,
  ): URL {
    const subscriberId: ObjectID | null = subscriber.id;

    if (!subscriberId) {
      throw new BadDataException(
        "A subscriber id is required to build an unsubscribe link.",
      );
    }

    if (
      !StatusPageSubscriberUnsubscribe.isWellFormedToken(
        subscriber.unsubscribeToken,
      )
    ) {
      logger.error(
        `Status page subscriber ${subscriberId.toString()} has no unsubscribe token; its unsubscribe link leads to the out-of-date link page.`,
        {
          statusPageSubscriberId: subscriberId.toString(),
        } as LogAttributes,
      );
    }

    return StatusPageSubscriberUnsubscribe.buildLink({
      statusPageUrl: statusPageUrl,
      subscriberId: subscriberId,
      unsubscribeToken: subscriber.unsubscribeToken,
    });
  }

  /*
   * The link to a subscriber's Update Subscription page, where it can choose
   * resources and event types (and unsubscribe):
   * {statusPageUrl}/update-subscription/{id}-{token}. The "manage your
   * subscription" message a visitor asks for from the Subscribe page carries
   * it. Like the unsubscribe link it holds the subscription's token, which
   * the page asks for: the id alone opens nothing. On a private status page
   * the page also needs a signed-in visitor, like the rest of the page.
   *
   * Pass the subscriber read with its unsubscribeToken, as for
   * getUnsubscribeLink; one without a token gets a link to the page's "this
   * link has expired" state rather than none, and that is logged.
   */
  public getManageSubscriptionLink(
    statusPageUrl: URL,
    subscriber: Pick<Model, "_id" | "id" | "unsubscribeToken">,
  ): URL {
    const subscriberId: ObjectID | null = subscriber.id;

    if (!subscriberId) {
      throw new BadDataException(
        "A subscriber id is required to build a manage subscription link.",
      );
    }

    if (
      !StatusPageSubscriberUnsubscribe.isWellFormedToken(
        subscriber.unsubscribeToken,
      )
    ) {
      logger.error(
        `Status page subscriber ${subscriberId.toString()} has no unsubscribe token; its manage subscription link leads to the expired link page.`,
        {
          statusPageSubscriberId: subscriberId.toString(),
        } as LogAttributes,
      );
    }

    return StatusPageSubscriberUnsubscribe.buildManageSubscriptionLink({
      statusPageUrl: statusPageUrl,
      subscriberId: subscriberId,
      unsubscribeToken: subscriber.unsubscribeToken,
    });
  }

  /*
   * Give every subscriber in the list an unsubscribe token it lacks, in place,
   * so the links built from them work. Every create mints one, and the
   * BackfillStatusPageSubscriberUnsubscribeColumns data migration gives one
   * to every subscriber that existed before; this covers the ones that
   * migration has not reached yet (it runs after the upgrade, in batches), a
   * subscriber created in between, and one written with hooks skipped.
   *
   * One statement per batch of subscribers, not per subscriber: until the
   * backfill has run, a whole page's list can be missing its tokens.
   *
   * The write only fills an empty column, so two senders racing on the same
   * subscriber - or a sender and the backfill - cannot hand out two different
   * tokens: the loser reads back the winner's.
   */
  @CaptureSpan()
  public async ensureUnsubscribeTokens(
    subscribers: Array<Model>,
  ): Promise<void> {
    // The rows that lack one, by id: a list can hold the same subscriber twice.
    const missing: Map<string, Array<Model>> = new Map<string, Array<Model>>();

    for (const subscriber of subscribers) {
      if (
        !subscriber._id ||
        StatusPageSubscriberUnsubscribe.isWellFormedToken(
          subscriber.unsubscribeToken,
        )
      ) {
        continue;
      }

      const id: string = subscriber._id.toString().toLowerCase();
      missing.set(id, [...(missing.get(id) || []), subscriber]);
    }

    const ids: Array<string> = Array.from(missing.keys());

    for (
      let start: number = 0;
      start < ids.length;
      start += UNSUBSCRIBE_COLUMNS_BATCH_SIZE
    ) {
      const batch: Array<string> = ids.slice(
        start,
        start + UNSUBSCRIBE_COLUMNS_BATCH_SIZE,
      );

      await this.fillMissingUnsubscribeTokens(batch);

      const stored: Array<Model> = await this.findBy({
        query: {
          _id: QueryHelper.any(batch),
        },
        select: {
          _id: true,
          unsubscribeToken: true,
        },
        skip: 0,
        limit: batch.length,
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });

      for (const row of stored) {
        if (
          !row._id ||
          !StatusPageSubscriberUnsubscribe.isWellFormedToken(
            row.unsubscribeToken,
          )
        ) {
          continue;
        }

        for (const subscriber of missing.get(
          row._id.toString().toLowerCase(),
        ) || []) {
          subscriber.unsubscribeToken = row.unsubscribeToken;
        }
      }
    }
  }

  /*
   * The BackfillStatusPageSubscriberUnsubscribeColumns data migration: give
   * every subscriber that existed before the upgrade its unsubscribe token,
   * and mark the ones with a creator as added by the team (Is Added By
   * Team). Soft-deleted subscribers are included: one that is restored must
   * not come back without a token.
   *
   * The table is walked in primary key order, a batch of ids at a time, and
   * each batch is written by primary key in short statements of their own.
   * So however large the table, no statement holds its rows for long or runs
   * into the connection's statement timeout, and notifications, sign-ups and
   * the subscriber lists carry on while it runs - which one UPDATE of every
   * row, in the migration that added the columns, would have stopped.
   *
   * Idempotent, and safe to run twice at once (the data migration runner is
   * not serialized): every write only fills what is still empty, and
   * re-checks that under the row lock, so a token a sender has already put
   * in a message is never replaced.
   */
  @CaptureSpan()
  public async backfillUnsubscribeColumns(options?: {
    batchSize?: number | undefined;
  }): Promise<StatusPageSubscriberUnsubscribeBackfillResult> {
    const batchSize: number = Math.max(
      1,
      Math.floor(options?.batchSize || UNSUBSCRIBE_COLUMNS_BATCH_SIZE),
    );

    const result: StatusPageSubscriberUnsubscribeBackfillResult = {
      tokensGiven: 0,
      markedAddedByTeam: 0,
    };

    let lastId: string | null = null;

    for (;;) {
      const rows: Array<{
        _id: string;
        needsToken: boolean;
        needsAddedByTeam: boolean;
      }> = await this.getRepository().manager.query(
        `SELECT "_id"::text AS "_id",
                ("unsubscribeToken" IS NULL) AS "needsToken",
                ("isAddedByTeam" = false AND "createdByUserId" IS NOT NULL) AS "needsAddedByTeam"
           FROM "StatusPageSubscriber"
          WHERE ($2::uuid IS NULL OR "_id" > $2::uuid)
          ORDER BY "_id" ASC
          LIMIT $1`,
        [batchSize, lastId],
      );

      if (rows.length === 0) {
        break;
      }

      const needToken: Array<string> = rows
        .filter((row: { needsToken: boolean }): boolean => {
          return row.needsToken === true;
        })
        .map((row: { _id: string }): string => {
          return row._id;
        });

      const needAddedByTeam: Array<string> = rows
        .filter((row: { needsAddedByTeam: boolean }): boolean => {
          return row.needsAddedByTeam === true;
        })
        .map((row: { _id: string }): string => {
          return row._id;
        });

      result.tokensGiven += await this.fillMissingUnsubscribeTokens(needToken);

      if (needAddedByTeam.length > 0) {
        result.markedAddedByTeam += affectedRowCount(
          await this.getRepository().manager.query(
            `UPDATE "StatusPageSubscriber" SET "isAddedByTeam" = true WHERE "_id" = ANY($1::uuid[]) AND "createdByUserId" IS NOT NULL AND "isAddedByTeam" = false`,
            [needAddedByTeam],
          ),
        );
      }

      lastId = rows[rows.length - 1]!._id;

      if (rows.length < batchSize) {
        break;
      }
    }

    return result;
  }

  /*
   * Mint a token, from Node's CSPRNG like every other, for each of these
   * subscribers that has none, in one statement. Returns how many were given
   * one. `"unsubscribeToken" IS NULL` is checked again under each row's lock,
   * so a token another writer stored first is kept.
   */
  private async fillMissingUnsubscribeTokens(
    subscriberIds: Array<string>,
  ): Promise<number> {
    if (subscriberIds.length === 0) {
      return 0;
    }

    const tokens: Array<string> = subscriberIds.map((): string => {
      return StatusPageSubscriberUnsubscribeToken.generate();
    });

    return affectedRowCount(
      await this.getRepository().manager.query(
        `UPDATE "StatusPageSubscriber" AS "subscriber" SET "unsubscribeToken" = "minted"."token" FROM unnest($1::uuid[], $2::text[]) AS "minted"("id", "token") WHERE "subscriber"."_id" = "minted"."id" AND "subscriber"."unsubscribeToken" IS NULL`,
        [subscriberIds, tokens],
      ),
    );
  }

  public shouldSendNotification(data: {
    subscriber: Model;
    statusPageResources: Array<StatusPageResource>;
    statusPage: StatusPage;
    eventType: StatusPageEventType;
  }): boolean {
    /*
     * Ids only: the subscriber carries its unsubscribe token, which is a
     * credential (it cancels the subscription, private pages included), and
     * every subscriber job calls this for every subscriber.
     */
    logger.debug(
      `shouldSendNotification called for subscriber ${data.subscriber?._id?.toString() || ""} (${data.eventType}, ${data.statusPageResources?.length || 0} resource(s)).`,
      {
        statusPageId: data.statusPage?.id?.toString(),
      } as LogAttributes,
    );

    let shouldSendNotification: boolean = true; // default to true.

    if (data.subscriber.isUnsubscribed) {
      logger.debug("Subscriber is unsubscribed.", {
        statusPageId: data.statusPage?.id?.toString(),
      } as LogAttributes);
      shouldSendNotification = false;
      return shouldSendNotification;
    }

    if (
      data.statusPage.allowSubscribersToChooseResources &&
      !data.subscriber.isSubscribedToAllResources &&
      !(
        data.eventType === StatusPageEventType.Announcement &&
        data.statusPageResources.length === 0
      ) // announcements with no monitors don't use resource filtering
    ) {
      logger.debug(
        "Subscriber can choose resources and is not subscribed to all resources.",
        { statusPageId: data.statusPage?.id?.toString() } as LogAttributes,
      );
      /*
       * Only the subscriber's resources of this status page count: a
       * subscription names its own page's resources (StatusPageSubscriber
       * Resources refuses any other on every write), and one saved before
       * that was checked is told nothing through a resource of another page.
       * The subscriber jobs read each resource with its page
       * (getSubscribersByStatusPage); one read without it counts as another
       * page's. The event's resources are this page's already: the senders
       * hand over the event's resources on each page.
       */
      const statusPageId: ObjectID | string | undefined =
        data.statusPage.id || data.statusPage._id;

      const subscriberResourceIds: Array<string> =
        data.subscriber.statusPageResources
          ?.filter((resource: StatusPageResource): boolean => {
            return StatusPageSubscriberResources.isOnPage(
              resource,
              statusPageId,
            );
          })
          .map((resource: StatusPageResource) => {
            return resource.id?.toString() as string;
          }) || [];

      logger.debug(`Subscriber Resource IDs: ${subscriberResourceIds}`, {
        statusPageId: data.statusPage?.id?.toString(),
      } as LogAttributes);

      let shouldSendNotificationForResource: boolean = false;

      if (subscriberResourceIds.length === 0) {
        logger.debug("Subscriber has no resource IDs.", {
          statusPageId: data.statusPage?.id?.toString(),
        } as LogAttributes);
        shouldSendNotificationForResource = false;
      } else {
        for (const resource of data.statusPageResources) {
          logger.debug(`Checking resource: ${resource.id}`, {
            statusPageId: data.statusPage?.id?.toString(),
          } as LogAttributes);
          if (
            subscriberResourceIds.includes(resource.id?.toString() as string)
          ) {
            logger.debug("Resource ID matches subscriber's resource ID.", {
              statusPageId: data.statusPage?.id?.toString(),
            } as LogAttributes);
            shouldSendNotificationForResource = true;
          }
        }
      }

      if (!shouldSendNotificationForResource) {
        logger.debug("Should not send notification for resource.", {
          statusPageId: data.statusPage?.id?.toString(),
        } as LogAttributes);
        shouldSendNotification = false;
      }
    }

    // now do for event types

    if (
      data.statusPage.allowSubscribersToChooseEventTypes &&
      !data.subscriber.isSubscribedToAllEventTypes
    ) {
      logger.debug(
        "Subscriber can choose event types and is not subscribed to all event types.",
        { statusPageId: data.statusPage?.id?.toString() } as LogAttributes,
      );
      const subscriberEventTypes: Array<StatusPageEventType> =
        data.subscriber.statusPageEventTypes || [];

      logger.debug(`Subscriber Event Types: ${subscriberEventTypes}`, {
        statusPageId: data.statusPage?.id?.toString(),
      } as LogAttributes);

      let shouldSendNotificationForEventType: boolean = false;

      if (subscriberEventTypes.includes(data.eventType)) {
        logger.debug("Event type matches subscriber's event type.", {
          statusPageId: data.statusPage?.id?.toString(),
        } as LogAttributes);
        shouldSendNotificationForEventType = true;
      }

      if (!shouldSendNotificationForEventType) {
        logger.debug(
          "Should not send notification for event type.",
          {} as LogAttributes,
        );
        shouldSendNotification = false;
      }
    }

    logger.debug(
      `Final decision on shouldSendNotification: ${shouldSendNotification}`,
      {} as LogAttributes,
    );
    return shouldSendNotification;
  }

  @CaptureSpan()
  public async getStatusPagesToSendNotification(
    statusPageIds: Array<ObjectID>,
  ): Promise<Array<StatusPage>> {
    logger.debug(
      "getStatusPagesToSendNotification called with statusPageIds:",
      {} as LogAttributes,
    );
    logger.debug(statusPageIds, {} as LogAttributes);

    const statusPages: Array<StatusPage> = await StatusPageService.findBy({
      query: {
        _id: QueryHelper.any(statusPageIds),
        /*
         * Every subscriber notification - incidents, episodes, notes,
         * postmortems, scheduled maintenance, announcements, reports, and the
         * confirmations a subscription sends - finds its status pages here,
         * so leaving archived pages out is what makes an archived page send
         * nothing at all. The pages of a blocked project are left out below.
         */
        isArchived: false,
      },
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      select: {
        _id: true,
        name: true,
        pageTitle: true,
        projectId: true,
        isPublicStatusPage: true,
        ...STATUS_PAGE_EMAIL_LOGO_SELECT,
        allowSubscribersToChooseResources: true,
        subscriberEmailNotificationFooterText: true,
        enableCustomSubscriberEmailNotificationFooterText: true,
        allowSubscribersToChooseEventTypes: true,
        smtpConfig: {
          _id: true,
          transportType: true,
          hostname: true,
          port: true,
          username: true,
          password: true,
          fromEmail: true,
          fromName: true,
          secure: true,
          authType: true,
          clientId: true,
          clientSecret: true,
          tokenUrl: true,
          scope: true,
          oauthProviderType: true,
        },
        /*
         * The page's Twilio config, with every number it sends from - its SMS
         * numbers included, which subscriber SMS go out from when it has them.
         */
        callSmsConfig: PROJECT_TWILIO_CONFIG_SELECT,
        subscriberTimezones: true,
        reportDataInDays: true,
        reportPeriodType: true,
        reportRecurringInterval: true,
        reportTimezone: true,
        isReportEnabled: true,
        showAnnouncementsOnStatusPage: true,
        showIncidentsOnStatusPage: true,
        showScheduledMaintenanceEventsOnStatusPage: true,
        /*
         * The episode workers skip every page where this is off, and a column
         * that is not selected reads as undefined - so leaving it out stopped
         * every episode notification from being sent.
         */
        showEpisodesOnStatusPage: true,
        /*
         * IncidentStatusPageScope decides from this which incidents reach a
         * page, and treats a page without it as showing only incidents
         * limited to it - so leaving it out would silence every unscoped
         * incident's notifications.
         */
        onlyShowScopedIncidents: true,
        /*
         * Send Notifications to Subscribers: every sender passes over a page
         * that has it off (Types/StatusPage/SubscriberNotificationsSwitch).
         * A page read without it keeps notifying, so leaving it out would
         * quietly ignore the switch rather than silence anyone.
         */
        sendSubscriberNotifications: true,
        // Who may be a subscriber (Types/StatusPage/SubscriberRestrictions).
        limitSubscribersToPrivateUsers: true,
        allowedSubscriberEmailDomains: true,
      },
    });

    /*
     * Nor do the pages of a project a master admin blocked send anything:
     * they answer as if they did not exist, the unsubscribe page every
     * message links to included (BlockedProjectStatusPages). Asked once per
     * project, of the per-process answer (ProjectService.isProjectBlocked),
     * so a notification adds no query; a page whose project cannot be told
     * sends as usual.
     */
    const statusPagesToNotify: Array<StatusPage> =
      await BlockedProjectStatusPages.leaveOutStatusPagesOfBlockedProjects(
        statusPages,
      );

    logger.debug("Found status pages:", {} as LogAttributes);
    logger.debug(statusPagesToNotify, {} as LogAttributes);

    return statusPagesToNotify;
  }

  @CaptureSpan()
  public async testSubscriberWebhook(data: {
    webhookUrl: string;
    statusPageId: ObjectID;
  }): Promise<void> {
    // basic validation - must be a valid URL
    let parsedUrl: URL;
    try {
      parsedUrl = URL.fromString(data.webhookUrl);
    } catch {
      throw new BadDataException("Invalid Webhook URL");
    }

    // get the status page info
    const statusPage: StatusPage | null = await StatusPageService.findOneById({
      id: data.statusPageId,
      props: {
        isRoot: true,
      },
      select: {
        name: true,
        pageTitle: true,
        projectId: true,
        _id: true,
      },
    });

    if (!statusPage) {
      throw new BadDataException("Status page not found");
    }

    const statusPageName: string =
      statusPage.pageTitle || statusPage.name || "Status Page";
    const statusPageURL: string = await StatusPageService.getStatusPageURL(
      statusPage.id!,
    );

    try {
      await StatusPageSubscriberWebhookUtil.sendWebhookNotification({
        webhookUrl: parsedUrl,
        payload: {
          eventType: "TestNotification",
          statusPageId: statusPage.id!.toString(),
          statusPageName: statusPageName,
          statusPageUrl: statusPageURL,
          unsubscribeUrl: "",
          data: {
            message: `This is a test notification from ${ProductBrandingText.getProductName()}. Your webhook is configured correctly.`,
          },
        },
      });
    } catch (error) {
      logger.error("Error sending test webhook notification:", {
        projectId: statusPage?.projectId?.toString(),
      } as LogAttributes);
      logger.error(error, {
        projectId: statusPage?.projectId?.toString(),
      } as LogAttributes);
      throw error;
    }
  }

  @CaptureSpan()
  public async testSlackWebhook(data: {
    webhookUrl: string;
    statusPageId: ObjectID;
  }): Promise<void> {
    // Validate the webhook URL
    if (!data.webhookUrl.startsWith("https://hooks.slack.com/services/")) {
      throw new BadDataException("Invalid Slack webhook URL");
    }

    // Get status page info
    const statusPage: StatusPage | null = await StatusPageService.findOneById({
      id: data.statusPageId,
      props: {
        isRoot: true,
      },
      select: {
        name: true,
        pageTitle: true,
        projectId: true,
        _id: true,
      },
    });

    if (!statusPage) {
      throw new BadDataException("Status page not found");
    }

    // Create test notification message
    const statusPageName: string =
      statusPage.pageTitle || statusPage.name || "Status Page";
    const statusPageURL: string = await StatusPageService.getStatusPageURL(
      statusPage.id!,
    );

    // Create markdown message for Slack: the page's name as text.
    const markdownMessage: string =
      mdText`## Test Notification - ${statusPageName}

**This is a test notification from OneUptime.**

You have successfully configured Slack notifications for this status page.

You will receive real-time notifications for:
- Incidents
- Scheduled Maintenance Events
- Status Updates
- Announcements

[View Status Page](${statusPageURL})`.toString();

    // Send the test notification
    try {
      await SlackUtil.sendMessageToChannelViaIncomingWebhook({
        url: URL.fromString(data.webhookUrl),
        text: SlackUtil.convertMarkdownToSlackRichText(markdownMessage),
      });
    } catch (error) {
      logger.error("Error sending test Slack notification:", {
        projectId: statusPage?.projectId?.toString(),
      } as LogAttributes);
      logger.error(error, {
        projectId: statusPage?.projectId?.toString(),
      } as LogAttributes);
      throw error;
    }
  }
}

export default new Service();
