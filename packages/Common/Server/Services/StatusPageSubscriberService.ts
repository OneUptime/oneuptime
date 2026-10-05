import { PlanType } from "../../Types/Billing/SubscriptionPlan";
import DatabaseConfig from "../DatabaseConfig";
import {
  AllowedSubscribersCountInFreePlan,
  IsBillingEnabled,
} from "../EnvironmentConfig";
import ProjectSMTPConfigService from "../Services/ProjectSmtpConfigService";
import CreateBy from "../Types/Database/CreateBy";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import UpdateBy from "../Types/Database/UpdateBy";
import logger, { LogAttributes } from "../Utils/Logger";
import ProjectReferencesService from "./ProjectReferencesService";
import GlobalCache from "../Infrastructure/GlobalCache";
import MailService from "./MailService";
import ProjectCallSMSConfigService from "./ProjectCallSMSConfigService";
import ProjectService, { CurrentPlan } from "./ProjectService";
import SmsService from "./SmsService";
import StatusPageService from "./StatusPageService";
import { STATUS_PAGE_ARCHIVED_NO_NEW_SUBSCRIBERS_MESSAGE } from "../../Types/StatusPage/StatusPageArchive";
import { StatusPageApiRoute } from "../../ServiceRoute";
import Hostname from "../../Types/API/Hostname";
import Protocol from "../../Types/API/Protocol";
import URL from "../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import EmailTemplateType from "../../Types/Email/EmailTemplateType";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
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
import NumberUtil from "../../Utils/Number";
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
import StatusPageSubscriberUnsubscribeToken from "../Utils/StatusPage/StatusPageSubscriberUnsubscribeToken";
import StatusPageSubscriberUnsubscribeNotice, {
  StatusPageSubscriberUnsubscribeNoticeEmail,
  StatusPageSubscriberUnsubscribeSource,
} from "../Utils/StatusPage/StatusPageSubscriberUnsubscribeNotice";

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
 * What onBeforeCreate hands onCreateSuccess: the status page the subscriber
 * is for, and the cancelled subscriptions of the same contact on that page
 * that the new one replaces (none, as a rule, or one).
 */
interface SubscriberCreateCarryForward {
  statusPage: StatusPage;
  replacedSubscriberIds: Array<ObjectID>;
}

// How many subscribers the backfill and the token top-up handle per statement.
const UNSUBSCRIBE_COLUMNS_BATCH_SIZE: number = 1000;

export interface StatusPageSubscriberUnsubscribeBackfillResult {
  // Subscribers given an unsubscribe token.
  tokensGiven: number;
  // Subscribers marked Is Added By Team because they have a creator.
  markedAddedByTeam: number;
}

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
   * and the six-digit confirmation code. Nobody can read either column
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
   * Create the subscriber a visitor signed up for on the status page itself
   * (StatusPageAPI's subscribe endpoint). The one create that is not the team
   * adding a subscriber: it is created as root, like the rest of that
   * endpoint, and Is Added By Team is left off.
   */
  @CaptureSpan()
  public async createFromStatusPageSignUp(data: Model): Promise<Model> {
    statusPageSignUps.add(data);

    try {
      return await this.create({
        data: data,
        props: {
          isRoot: true,
        },
      });
    } finally {
      statusPageSignUps.delete(data);
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
          throw new BadDataException(
            `You have reached the maximum allowed subscriber limit for the free plan. Please upgrade your plan to add more subscribers.`,
          );
        }
      }
    }

    /*
     * Every subscription this contact already has on the page - all of them,
     * not one: while a cancelled one is being replaced (see onCreateSuccess)
     * the contact has both it and the new one, and the new one must count.
     */
    let contactSubscriptions: Array<Model> = [];

    if (data.data.subscriberEmail) {
      logger.debug(`Subscriber Email: ${data.data.subscriberEmail}`, {
        projectId: data.data.projectId?.toString(),
        statusPageId: data.data.statusPageId?.toString(),
      } as LogAttributes);
      contactSubscriptions = await this.findBy({
        query: {
          statusPageId: data.data.statusPageId,
          projectId: projectId,
          subscriberEmail: data.data.subscriberEmail,
        },
        select: {
          _id: true,
          isUnsubscribed: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });
      logger.debug(
        `Found Subscribers by Email: ${JSON.stringify(contactSubscriptions)}`,
        {
          projectId: data.data.projectId?.toString(),
          statusPageId: data.data.statusPageId?.toString(),
        } as LogAttributes,
      );
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
        throw new BadDataException(
          "SMS notifications are not enabled for this project. Please enable SMS notifications in the Project Settings > Notifications Settings.",
        );
      }

      contactSubscriptions = await this.findBy({
        query: {
          statusPageId: data.data.statusPageId,
          projectId: projectId,
          subscriberPhone: data.data.subscriberPhone,
        },
        select: {
          _id: true,
          isUnsubscribed: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });

      logger.debug(
        `Found Subscribers by Phone: ${JSON.stringify(contactSubscriptions)}`,
        {
          projectId: data.data.projectId?.toString(),
          statusPageId: data.data.statusPageId?.toString(),
        } as LogAttributes,
      );
    }

    if (
      contactSubscriptions.some((subscription: Model): boolean => {
        return !subscription.isUnsubscribed;
      })
    ) {
      logger.debug("Subscriber is already subscribed and not unsubscribed.", {
        projectId: data.data.projectId?.toString(),
        statusPageId: data.data.statusPageId?.toString(),
      } as LogAttributes);
      throw new BadDataException(
        "You are already subscribed to this status page.",
      );
    }

    /*
     * A contact who cancelled and subscribes again gets a new subscription,
     * and the cancelled one is removed once the new one exists
     * (onCreateSuccess) - so a create that is refused or fails leaves it.
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
       * An archived page is left out above. Someone adding a subscriber to
       * it from the dashboard should hear why, not "not found".
       */
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

    if (isEmailSubscriber && !isSubscriptionConfirmed) {
      data.data.isSubscriptionConfirmed = false;
    } else {
      data.data.isSubscriptionConfirmed = true; // if the subscriber is not email, then set it to true for SMS subscribers / slack subscribers.
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

    data.data.subscriptionConfirmationToken = NumberUtil.getRandomNumber(
      100000,
      999999,
    ).toString();

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
    logger.debug(
      `Subscription Confirmation Token: ${data.data.subscriptionConfirmationToken}`,
      {
        projectId: data.data.projectId?.toString(),
        statusPageId: data.data.statusPageId?.toString(),
      } as LogAttributes,
    );

    // Not the data itself: it now carries the unsubscribe token.
    logger.debug("onBeforeCreate processed data.", {
      projectId: data.data.projectId?.toString(),
      statusPageId: data.data.statusPageId?.toString(),
    } as LogAttributes);

    const carryForward: SubscriberCreateCarryForward = {
      statusPage: statuspage,
      replacedSubscriberIds: replacedSubscriberIds,
    };

    return { createBy: data, carryForward: carryForward };
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

    const isUnsubscribed: unknown = (
      updateBy.data as unknown as JSONObject | undefined
    )?.["isUnsubscribed"];

    const carryForward: UnsubscribedAtCarryForward = {
      isUnsubscribed:
        typeof isUnsubscribed === "boolean" ? isUnsubscribed : null,
      subscriberIdsBeingUnsubscribed: [],
    };

    if (carryForward.isUnsubscribed === true) {
      const matched: Array<Model> = await this.findBy({
        query: updateBy.query,
        select: {
          _id: true,
          isUnsubscribed: true,
        },
        skip: 0,
        limit: LIMIT_MAX,
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      });

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
   * The subscriber a link belongs to, or null when the link is not good. The
   * subscriber is found by its primary key, never by the token, and the token
   * is then compared in constant time - a query on the token would let the
   * database's own comparison time a guess. The comparison runs even when
   * there is no subscriber to compare with.
   */
  private async findSubscriberByUnsubscribeLink(data: {
    statusPageId: string;
    subscriberId: string;
    token: string;
  }): Promise<Model | null> {
    const isWellFormed: boolean =
      ObjectID.isValidUUID(data.statusPageId) &&
      ObjectID.isValidUUID(data.subscriberId);

    const subscriber: Model | null = isWellFormed
      ? await this.findOneBy({
          query: {
            _id: data.subscriberId,
            statusPageId: new ObjectID(data.statusPageId),
          },
          select: {
            _id: true,
            statusPageId: true,
            unsubscribeToken: true,
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
          props: {
            isRoot: true,
            ignoreHooks: true,
          },
        })
      : null;

    const tokenMatches: boolean = StatusPageSubscriberUnsubscribeToken.matches({
      stored: subscriber?.unsubscribeToken,
      presented: data.token,
    });

    if (!subscriber || !tokenMatches) {
      return null;
    }

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

  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
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
     * The contact's cancelled subscriptions on this page go now that the new
     * one exists: links to them stop working. Only cancelled ones, of the
     * same status page and project as the new subscriber.
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

    // createdItem carries the unsubscribe token onBeforeCreate minted.
    const unsubscribeLink: string = this.getUnsubscribeLink(
      URL.fromString(statusPageURL),
      createdItem,
    ).toString();

    if (
      createdItem.statusPageId &&
      createdItem.subscriberPhone &&
      createdItem._id &&
      createdItem.sendYouHaveSubscribedMessage
    ) {
      logger.debug(
        "Subscriber has a phone number and sendYouHaveSubscribedMessage is true.",
        { projectId: createdItem.projectId?.toString() } as LogAttributes,
      );
      const statusPage: StatusPage | null = await StatusPageService.findOneBy({
        query: {
          _id: createdItem.statusPageId.toString(),
        },
        select: {
          callSmsConfig: {
            _id: true,
            twilioAccountSID: true,
            twilioAuthToken: true,
            twilioPrimaryPhoneNumber: true,
            twilioSecondaryPhoneNumbers: true,
          },
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

      logger.debug(
        `Status Page Call SMS Config: ${JSON.stringify(statusPage.callSmsConfig)}`,
        { projectId: createdItem.projectId?.toString() } as LogAttributes,
      );

      /*
       * On a public status page the SMS keeps the shorter manage link, which
       * works there without signing in: an SMS is billed by the segment (see
       * StatusPageSubscriberUnsubscribe.buildSmsLink).
       */
      const smsUnsubscribeLink: string =
        StatusPageSubscriberUnsubscribe.buildSmsLink({
          isPublicStatusPage: statusPageOfSubscriber?.isPublicStatusPage,
          statusPageUrl: statusPageURL,
          subscriberId: createdItem.id!,
          unsubscribeUrl: unsubscribeLink,
        });

      SmsService.sendSms(
        {
          to: createdItem.subscriberPhone,
          message: `You have been subscribed to ${statusPageName}. To unsubscribe, click on the link: ${smsUnsubscribeLink}`,
        },
        {
          projectId: createdItem.projectId,
          isSensitive: false,
          customTwilioConfig: ProjectCallSMSConfigService.toTwilioConfig(
            statusPage.callSmsConfig,
          ),
          statusPageId: createdItem.statusPageId!,
        },
      ).catch((err: Error) => {
        logger.error(err, {
          projectId: createdItem.projectId?.toString(),
        } as LogAttributes);
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

    // if slack incoming webhook is provided, then send a message to the slack channel.
    if (createdItem.slackIncomingWebhookUrl) {
      logger.debug("Sending Slack notification for new subscriber.", {
        projectId: createdItem.projectId?.toString(),
      } as LogAttributes);
      const slackMessage: string = `## 📢 New Subscription to ${statusPageName}

**You have successfully subscribed to receive status updates!**

🔗 **Status Page:** [${statusPageName}](${statusPageURL})
🔕 **Unsubscribe:** [Stop these notifications](${unsubscribeLink})

You will receive real-time notifications for:
• Incidents and outages 
• Scheduled maintenance events  
• Service announcements
• Status updates

Stay informed about service availability! 🚀`;

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
      const teamsMessage: string = `## 📢 New Subscription to ${statusPageName}

**You have successfully subscribed to receive status updates!**

🔗 **Status Page:** [${statusPageName}](${statusPageURL})
🔕 **Unsubscribe:** [Stop these notifications](${unsubscribeLink})

You will receive real-time notifications for:
• Incidents and outages 
• Scheduled maintenance events  
• Service announcements
• Status updates

Stay informed about service availability! 🚀`;

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

    const statusPage: StatusPage | null = await StatusPageService.findOneBy({
      query: {
        _id: subscriber.statusPageId.toString(),
      },
      select: {
        logoFileId: true,
        isPublicStatusPage: true,
        pageTitle: true,
        name: true,
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
      },
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });
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
    const statusPageIdString: string | null =
      statusPage.id?.toString() || statusPage._id?.toString() || null;

    const confirmSubscriptionLink: string = this.getConfirmSubscriptionLink({
      statusPageUrl: statusPageURL,
      confirmationToken: subscriber.subscriptionConfirmationToken || "",
      statusPageSubscriberId: subscriber.id!,
    }).toString();
    logger.debug(`Confirm Subscription Link: ${confirmSubscriptionLink}`, {
      statusPageSubscriberId: data.subscriberId?.toString(),
    } as LogAttributes);

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
              logoUrl:
                statusPage.logoFileId && statusPageIdString
                  ? new URL(httpProtocol, host)
                      .addRoute(StatusPageApiRoute)
                      .addRoute(`/logo/${statusPageIdString}`)
                      .toString()
                  : "",
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

    const statusPage: StatusPage | null = await StatusPageService.findOneBy({
      query: {
        _id: subscriber.statusPageId.toString(),
      },
      select: {
        logoFileId: true,
        isPublicStatusPage: true,
        pageTitle: true,
        name: true,
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
      },
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });
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
    const statusPageIdString: string | null =
      statusPage.id?.toString() || statusPage._id?.toString() || null;

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
              logoUrl:
                statusPage.logoFileId && statusPageIdString
                  ? new URL(httpProtocol, host)
                      .addRoute(StatusPageApiRoute)
                      .addRoute(`/logo/${statusPageIdString}`)
                      .toString()
                  : "",
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
    logger.debug("getConfirmSubscriptionLink called with data:", {
      statusPageSubscriberId: data.statusPageSubscriberId?.toString(),
    } as LogAttributes);
    logger.debug(data, {
      statusPageSubscriberId: data.statusPageSubscriberId?.toString(),
    } as LogAttributes);

    const confirmSubscriptionLink: URL = URL.fromString(
      data.statusPageUrl,
    ).addRoute(
      `/confirm-subscription/${data.statusPageSubscriberId.toString()}?verification-token=${data.confirmationToken}`,
    );

    logger.debug(
      `Generated Confirm Subscription Link: ${confirmSubscriptionLink.toString()}`,
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
      },
      select: {
        _id: true,
        subscriberEmail: true,
        subscriberPhone: true,
        subscriberWebhook: true,
        slackIncomingWebhookUrl: true,
        microsoftTeamsIncomingWebhookUrl: true,
        isSubscribedToAllResources: true,
        statusPageResources: true,
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
   * a phone counts once on each. Rows are pinned to the project, whatever ids
   * the caller passes.
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
         "statusPageId"::text AS "statusPageId",
         COUNT(*) FILTER (WHERE NULLIF(TRIM("subscriberEmail"), '') IS NOT NULL)::text AS "email",
         COUNT(*) FILTER (WHERE NULLIF(TRIM("subscriberPhone"), '') IS NOT NULL)::text AS "sms",
         COUNT(*) FILTER (WHERE NULLIF(TRIM("slackIncomingWebhookUrl"), '') IS NOT NULL)::text AS "slack",
         COUNT(*) FILTER (WHERE NULLIF(TRIM("microsoftTeamsIncomingWebhookUrl"), '') IS NOT NULL)::text AS "microsoftTeams",
         COUNT(*) FILTER (WHERE NULLIF(TRIM("subscriberWebhook"), '') IS NOT NULL)::text AS "webhook"
       FROM "StatusPageSubscriber"
       WHERE "projectId" = $1
         AND "statusPageId" = ANY($2::uuid[])
         AND "isUnsubscribed" = false
         AND "isSubscriptionConfirmed" = true
         AND "deletedAt" IS NULL
       GROUP BY "statusPageId"`,
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
   * The subscriber's Update Subscription page, where it can choose resources
   * and event types (and unsubscribe). The "manage your subscription" email a
   * visitor asks for from the Subscribe page links here. On a private status
   * page it needs a signed-in visitor, like the rest of the page.
   */
  public getManageSubscriptionLink(
    statusPageUrl: URL,
    statusPageSubscriberId: ObjectID,
  ): URL {
    return StatusPageSubscriberUnsubscribe.buildManageSubscriptionLink({
      statusPageUrl: statusPageUrl,
      subscriberId: statusPageSubscriberId,
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
      const subscriberResourceIds: Array<string> =
        data.subscriber.statusPageResources?.map(
          (resource: StatusPageResource) => {
            return resource.id?.toString() as string;
          },
        ) || [];

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
         * confirmation a new subscription sends - finds its status pages
         * here, so leaving archived pages out is what makes an archived page
         * send nothing at all.
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
        logoFileId: true,
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
        callSmsConfig: {
          _id: true,
          twilioAccountSID: true,
          twilioAuthToken: true,
          twilioPrimaryPhoneNumber: true,
          twilioSecondaryPhoneNumbers: true,
        },
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
      },
    });

    logger.debug("Found status pages:", {} as LogAttributes);
    logger.debug(statusPages, {} as LogAttributes);

    return statusPages;
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
            message:
              "This is a test notification from OneUptime. Your webhook is configured correctly.",
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

    // Create markdown message for Slack
    const markdownMessage: string = `## Test Notification - ${statusPageName}

**This is a test notification from OneUptime.**

You have successfully configured Slack notifications for this status page.

You will receive real-time notifications for:
- Incidents
- Scheduled Maintenance Events
- Status Updates
- Announcements

[View Status Page](${statusPageURL})`;

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
