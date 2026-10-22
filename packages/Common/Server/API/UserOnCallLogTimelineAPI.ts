import DatabaseConfig from "../DatabaseConfig";
import NotificationMiddleware from "../Middleware/NotificationMiddleware";
import UserOnCallLogTimelineService, {
  Service as UserNotificationLogTimelineServiceType,
} from "../Services/UserOnCallLogTimelineService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../Utils/Express";
import Response from "../Utils/Response";
import Select from "../Types/Database/Select";
import BaseAPI from "./BaseAPI";
import { AppApiRoute, DashboardRoute } from "../../ServiceRoute";
import Hostname from "../../Types/API/Hostname";
import Protocol from "../../Types/API/Protocol";
import URL from "../../Types/API/URL";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import UserNotificationStatus from "../../Types/UserNotification/UserNotificationStatus";
import UserOnCallLogTimeline from "../../Models/DatabaseModels/UserOnCallLogTimeline";
import Route from "../../Types/API/Route";
import {
  OnCallNotificationContext,
  OnCallNotificationResourceReference,
  detailsToJSON,
  getOnCallNotificationContext,
  getResourceReference,
} from "../Utils/OnCallNotificationContext";
import OnCallPagePassOn from "../Utils/OnCall/OnCallPagePassOn";
import OnCallPageLinks from "../Utils/OnCall/OnCallPageLinks";
import OnCallPageLinkToken, {
  ON_CALL_PAGE_LINK_TOKEN_PARAM,
} from "../Utils/OnCall/OnCallPageLinkToken";
import {
  CANT_TAKE_IT,
  ESCALATE,
  ON_CALL_PAGE_ALREADY_ACKNOWLEDGED_TITLE,
  ON_CALL_PAGE_ALREADY_ESCALATED_TITLE,
  ON_CALL_PAGE_CALL_PASS_ON_DIGIT,
  ON_CALL_PAGE_NOTHING_TO_ESCALATE_TITLE,
  OnCallPassOnAnswer,
  OnCallPassOnRefusal,
  OnCallPassOnResult,
  getOnCallPageEscalatedTitle,
  getOnCallPageNotPagedAgainSentence,
  getOnCallPassOnRefusalSentence,
  getOnCallPassOnSentence,
  isOnCallPassOnPagingStopped,
} from "../../Types/OnCallDutyPolicy/OnCallPagePassOn";

/*
 * What the public pages about a notification read of it: the person, their
 * page, and the record it is about (with its title, for the page's heading).
 */
const NOTIFICATION_PAGE_SELECT: Select<UserOnCallLogTimeline> = {
  _id: true,
  projectId: true,
  userId: true,
  onCallDutyPolicyExecutionLogId: true,
  isAcknowledged: true,
  triggeredByIncidentId: true,
  triggeredByIncident: {
    title: true,
  },
  triggeredByAlertId: true,
  triggeredByAlert: {
    title: true,
  },
  triggeredByAlertEpisodeId: true,
  triggeredByAlertEpisode: {
    title: true,
  },
  triggeredByIncidentEpisodeId: true,
  triggeredByIncidentEpisode: {
    title: true,
  },
  /*
   * The times on these pages are the recipient's own: a time in the
   * container's zone would tell an on-call engineer nothing.
   */
  user: {
    timezone: true,
  },
};

// What a page about a notification knows of the record it is about.
interface NotificationRecord {
  reference: OnCallNotificationResourceReference | null;
  context: OnCallNotificationContext | null;
  // "Incident", "Alert Episode", ...
  notificationType: string;
  title: string;
  // "Incident INC-42", or "This incident" when it has no number.
  label: string;
  // The same inside a sentence: "Incident INC-42", or "this incident".
  labelInSentence: string;
  // The record in the Dashboard.
  viewDetailsUrl: string;
  viewDetailsText: string;
  timezone: string | undefined;
}

/*
 * What a page that offers escalating says under its heading, and - when
 * escalating leaves nobody being paged - the warning it draws apart.
 */
interface PassOnWording {
  explanation: string;
  warning?: string | undefined;
}

export default class UserNotificationLogTimelineAPI extends BaseAPI<
  UserOnCallLogTimeline,
  UserNotificationLogTimelineServiceType
> {
  public constructor() {
    super(UserOnCallLogTimeline, UserOnCallLogTimelineService);

    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/call/gather-input/:itemId`,
      NotificationMiddleware.isValidCallNotificationRequest,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          req = req as OneUptimeRequest;

          if (!req.params["itemId"]) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Invalid item ID"),
            );
          }

          const token: JSONObject = (req as any).callTokenData;

          const itemId: ObjectID = new ObjectID(req.params["itemId"]);

          const timelineItem: UserOnCallLogTimeline | null =
            await this.service.findOneById({
              id: itemId,
              select: {
                _id: true,
                projectId: true,
                userId: true,
                onCallDutyPolicyExecutionLogId: true,
                triggeredByIncidentId: true,
                triggeredByAlertId: true,
                triggeredByAlertEpisodeId: true,
                triggeredByIncidentEpisodeId: true,
                // A time the second key's answer reads out is the person's own.
                user: {
                  timezone: true,
                },
              },
              props: {
                isRoot: true,
              },
            });

          if (!timelineItem) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Invalid item Id"),
            );
          }

          /*
           * The second key escalates the page - only for a call that offered
           * it: its address carries the page's own token
           * (OnCallPageLinks.getCallResponseUrl). A call placed before, with
           * no "press 2" in it, answers as it always did.
           */
          if (
            req.body["Digits"] === ON_CALL_PAGE_CALL_PASS_ON_DIGIT &&
            OnCallPageLinkToken.isValid({
              token: req.query?.[ON_CALL_PAGE_LINK_TOKEN_PARAM],
              userOnCallLogTimelineId: itemId,
            })
          ) {
            return NotificationMiddleware.sendResponse(
              req,
              res,
              token as any,
              await this.passOnFromCall({
                itemId: itemId,
                timelineItem: timelineItem,
              }),
            );
          }

          // check digits.

          if (req.body["Digits"] === "1") {
            // then ack incident
            await this.service.updateOneById({
              id: itemId,
              data: {
                acknowledgedAt: OneUptimeDate.getCurrentDate(),
                isAcknowledged: true,
                status: UserNotificationStatus.Acknowledged,
                statusMessage: "Notification Acknowledged",
              },
              props: {
                isRoot: true,
              },
            });
          }

          return NotificationMiddleware.sendResponse(req, res, token as any);
        } catch (error) {
          return next(error);
        }
      },
    );

    /*
     * We have this ack page to show the user a confirmation page before acknowledging the notification.
     * this is because email clients automatically make a get request to the url in the email and ack the notification automatically which is not what we want.
     * so we need to create this page for the user to confirm that they want to acknowledge the notification.
     */
    this.router.get(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/acknowledge-page/:itemId`,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          req = req as OneUptimeRequest;

          if (!req.params["itemId"]) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Item ID is required"),
            );
          }

          const itemId: ObjectID = new ObjectID(req.params["itemId"]);

          const timelineItem: UserOnCallLogTimeline | null =
            await this.service.findOneById({
              id: itemId,
              select: {
                _id: true,
                projectId: true,
                // Whose page it is, for "Can't take it? Escalate" below.
                userId: true,
                onCallDutyPolicyExecutionLogId: true,
                triggeredByIncidentId: true,
                triggeredByIncident: {
                  title: true,
                },
                triggeredByAlertId: true,
                triggeredByAlert: {
                  title: true,
                },
                triggeredByAlertEpisodeId: true,
                triggeredByAlertEpisode: {
                  title: true,
                },
                triggeredByIncidentEpisodeId: true,
                triggeredByIncidentEpisode: {
                  title: true,
                },
                /*
                 * The timestamps below are rendered in the recipient's own
                 * timezone. Formatting them in the container's zone would tell
                 * an on-call engineer nothing.
                 */
                user: {
                  timezone: true,
                },
              },
              props: {
                isRoot: true,
              },
            });

          if (!timelineItem) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Invalid item Id"),
            );
          }

          const reference: OnCallNotificationResourceReference | null =
            getResourceReference(timelineItem);

          const notificationType: string = reference
            ? reference.resourceType.toString()
            : "Alert";

          /*
           * The context read is what puts severity, state, project, monitors
           * and the time it was raised on the page. It is best effort on
           * purpose: a deleted resource, or a resource this notification no
           * longer points at, must still leave a page the engineer can
           * acknowledge from.
           */
          const context: OnCallNotificationContext | null =
            await getOnCallNotificationContext({
              timelineItem: timelineItem,
              timezone: timelineItem.user?.timezone?.toString(),
            });

          const notificationTitle: string =
            context?.resourceTitle ||
            timelineItem.triggeredByIncident?.title ||
            timelineItem.triggeredByIncidentEpisode?.title ||
            timelineItem.triggeredByAlertEpisode?.title ||
            timelineItem.triggeredByAlert?.title ||
            "";

          const host: Hostname = await DatabaseConfig.getHost();
          const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

          /*
           * "Can't take it? Escalate" beside Acknowledge - for a link that
           * carries the page's own token (OnCallPageLinkToken), while the
           * page is still the person's to escalate. The texts, the WhatsApp
           * messages and the chat messages all lead here.
           */
          const passOn: JSONObject | null = await this.getPassOnBlock({
            token: req.query?.[ON_CALL_PAGE_LINK_TOKEN_PARAM],
            itemId: itemId,
            timelineItem: timelineItem,
            timezone: timelineItem.user?.timezone?.toString(),
            recordNoun: notificationType,
          });

          return Response.render(
            req,
            res,
            "/usr/src/Common/Server/Views/AcknowledgeUserOnCallNotification.ejs",
            {
              title: `Acknowledge ${notificationType} - ${notificationTitle}`,
              message: `Do you want to acknowledge this ${notificationType}?`,
              acknowledgeText: `Acknowledge ${notificationType}`,
              acknowledgeUrl: new URL(
                httpProtocol,
                host,
                new Route(AppApiRoute.toString())
                  .addRoute(new UserOnCallLogTimeline().crudApiPath!)
                  .addRoute("/acknowledge/" + itemId.toString()),
              ).toString(),
              resourceNumber: context?.resourceNumber || "",
              resourceTitle: notificationTitle,
              resourceDescription: context?.resourceDescription || "",
              details: detailsToJSON(context?.details || []),
              ...(passOn ? { passOn: passOn } : {}),
            },
          );
        } catch (error) {
          return next(error);
        }
      },
    );

    // This is the link that actually acknowledges the notification.
    this.router.get(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/acknowledge/:itemId`,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          req = req as OneUptimeRequest;

          if (!req.params["itemId"]) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Item ID is required"),
            );
          }

          const itemId: ObjectID = new ObjectID(req.params["itemId"]);

          const timelineItem: UserOnCallLogTimeline | null =
            await this.service.findOneById({
              id: itemId,
              select: {
                _id: true,
                projectId: true,
                triggeredByIncidentId: true,
                triggeredByAlertId: true,
                triggeredByAlertEpisodeId: true,
                triggeredByIncidentEpisodeId: true,
                triggeredByAlert: {
                  title: true,
                },
                triggeredByIncident: {
                  title: true,
                },
                triggeredByAlertEpisode: {
                  title: true,
                },
                triggeredByIncidentEpisode: {
                  title: true,
                },
                acknowledgedAt: true,
                isAcknowledged: true,
                user: {
                  timezone: true,
                },
              },
              props: {
                isRoot: true,
              },
            });

          if (!timelineItem) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Invalid item Id"),
            );
          }

          const host: Hostname = await DatabaseConfig.getHost();
          const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

          // Determine the resource type and ID for routing.
          const reference: OnCallNotificationResourceReference | null =
            getResourceReference(timelineItem);

          const fallbackTitle: string =
            timelineItem.triggeredByIncident?.title ||
            timelineItem.triggeredByIncidentEpisode?.title ||
            timelineItem.triggeredByAlertEpisode?.title ||
            timelineItem.triggeredByAlert?.title ||
            "";

          if (timelineItem.isAcknowledged) {
            // already acknowledged. Then show already acknowledged page with view details button.

            /*
             * Same context the acknowledge page shows. Someone who follows the
             * link twice - or whose colleague got there first - still needs to
             * know what the page they are looking at is about.
             */
            const context: OnCallNotificationContext | null =
              await getOnCallNotificationContext({
                timelineItem: timelineItem,
                timezone: timelineItem.user?.timezone?.toString(),
              });

            const acknowledgedTitle: string =
              context?.resourceTitle || fallbackTitle;

            const viewDetailsRoute: Route = new Route(
              DashboardRoute.toString(),
            ).addRoute(
              `/${timelineItem.projectId?.toString()}/${reference?.dashboardPath || ""}/${reference?.resourceId.toString() || ""}`,
            );

            const viewDetailsUrl: URL = new URL(
              httpProtocol,
              host,
              viewDetailsRoute,
            );

            return Response.render(
              req,
              res,
              "/usr/src/Common/Server/Views/ViewMessage.ejs",
              {
                title: `Notification Already Acknowledged - ${acknowledgedTitle}`,
                message: `This notification has already been acknowledged.`,
                viewDetailsText: `View ${reference?.resourceType.toString() || ""}`,
                viewDetailsUrl: viewDetailsUrl.toString(),
                resourceNumber: context?.resourceNumber || "",
                resourceTitle: acknowledgedTitle,
                resourceDescription: context?.resourceDescription || "",
                details: detailsToJSON(context?.details || []),
              },
            );
          }

          await this.service.updateOneById({
            id: itemId,
            data: {
              acknowledgedAt: OneUptimeDate.getCurrentDate(),
              isAcknowledged: true,
              status: UserNotificationStatus.Acknowledged,
              statusMessage: "Notification Acknowledged",
            },
            props: {
              isRoot: true,
            },
          });

          // redirect to dashboard to the resource page.
          if (reference) {
            const resourceRoute: Route = new Route(
              DashboardRoute.toString(),
            ).addRoute(
              `/${timelineItem.projectId?.toString()}/${reference.dashboardPath}/${reference.resourceId.toString()}`,
            );

            return Response.redirect(
              req,
              res,
              new URL(httpProtocol, host, resourceRoute),
            );
          }

          return Response.sendErrorResponse(
            req,
            res,
            new BadDataException("Invalid item Id"),
          );
        } catch (error) {
          return next(error);
        }
      },
    );

    /*
     * "Can't take it? Escalate" - the page a message's Escalate link opens:
     * what escalating would do, and the button that does it. Like the
     * acknowledge page, it asks first: mail scanners open every link in an
     * email, and the button is a form, which they do not send. Its address
     * keeps the action's first name, pass-on, so links already sent work.
     */
    this.router.get(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/pass-on-page/:itemId`,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          req = req as OneUptimeRequest;

          const itemId: ObjectID | null = this.readItemId(req);

          if (!itemId) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Item ID is required"),
            );
          }

          const timelineItem: UserOnCallLogTimeline | null =
            await this.readNotification(itemId);

          if (!timelineItem) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Invalid item Id"),
            );
          }

          const record: NotificationRecord =
            await this.readNotificationRecord(timelineItem);

          const pageToken: unknown = req.query?.[ON_CALL_PAGE_LINK_TOKEN_PARAM];

          if (
            !OnCallPageLinkToken.isValid({
              token: pageToken,
              userOnCallLogTimelineId: itemId,
            })
          ) {
            return this.renderPassOnAnswer({
              req: req,
              res: res,
              record: record,
              answer: {
                passedOn: false,
                refusal: OnCallPassOnRefusal.InvalidLink,
              },
            });
          }

          const preview: OnCallPassOnAnswer = await OnCallPagePassOn.getPreview(
            {
              userId: timelineItem.userId!,
              executionLogId: timelineItem.onCallDutyPolicyExecutionLogId!,
            },
          );

          if (!preview.result) {
            return this.renderPassOnAnswer({
              req: req,
              res: res,
              record: record,
              answer: preview,
            });
          }

          /*
           * The heading asks - "Escalate Incident INC-42?" - and under it,
           * what escalating does, then that they are not paged again. The
           * person followed "Can't take it? Escalate" to get here, so the
           * page does not ask that again.
           */
          const wording: PassOnWording = this.getPassOnWording({
            result: preview.result,
            timezone: record.timezone,
            recordNoun: record.notificationType,
          });

          return Response.render(
            req,
            res,
            "/usr/src/Common/Server/Views/PassOnUserOnCallNotification.ejs",
            {
              title: `${ESCALATE} ${record.labelInSentence}?`,
              message: wording.explanation,
              ...(wording.warning ? { warning: wording.warning } : {}),
              passOnText: ESCALATE,
              passOnFormUrl: (
                await OnCallPageLinks.getPassOnUrl(itemId)
              ).toString(),
              pageTokenParam: ON_CALL_PAGE_LINK_TOKEN_PARAM,
              pageToken: String(pageToken),
              acknowledgeText: `Acknowledge ${record.notificationType} instead`,
              acknowledgeUrl: (
                await OnCallPageLinks.getAcknowledgeUrl(itemId)
              ).toString(),
              resourceNumber: record.context?.resourceNumber || "",
              resourceTitle: record.title,
              resourceDescription: record.context?.resourceDescription || "",
              details: detailsToJSON(record.context?.details || []),
            },
          );
        } catch (error) {
          return next(error);
        }
      },
    );

    // The Escalate button: escalates the page, and says what came of it.
    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/pass-on/:itemId`,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          req = req as OneUptimeRequest;

          const itemId: ObjectID | null = this.readItemId(req);

          if (!itemId) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Item ID is required"),
            );
          }

          const timelineItem: UserOnCallLogTimeline | null =
            await this.readNotification(itemId);

          if (!timelineItem) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Invalid item Id"),
            );
          }

          const record: NotificationRecord =
            await this.readNotificationRecord(timelineItem);

          if (
            !OnCallPageLinkToken.isValid({
              token: (req.body as JSONObject | undefined)?.[
                ON_CALL_PAGE_LINK_TOKEN_PARAM
              ],
              userOnCallLogTimelineId: itemId,
            })
          ) {
            return this.renderPassOnAnswer({
              req: req,
              res: res,
              record: record,
              answer: {
                passedOn: false,
                refusal: OnCallPassOnRefusal.InvalidLink,
              },
            });
          }

          const answer: OnCallPassOnAnswer = await OnCallPagePassOn.passOn({
            userId: timelineItem.userId!,
            executionLogId: timelineItem.onCallDutyPolicyExecutionLogId!,
            viaUserOnCallLogTimelineId: itemId,
          });

          return this.renderPassOnAnswer({
            req: req,
            res: res,
            record: record,
            answer: answer,
          });
        } catch (error) {
          return next(error);
        }
      },
    );
  }

  private readItemId(req: ExpressRequest): ObjectID | null {
    const itemId: string = String(req.params["itemId"] || "");

    if (!itemId || !ObjectID.isValidUUID(itemId)) {
      return null;
    }

    return new ObjectID(itemId);
  }

  private async readNotification(
    itemId: ObjectID,
  ): Promise<UserOnCallLogTimeline | null> {
    return await this.service.findOneById({
      id: itemId,
      select: NOTIFICATION_PAGE_SELECT,
      props: {
        isRoot: true,
      },
    });
  }

  // The record a notification is about, as its pages name and link it.
  private async readNotificationRecord(
    timelineItem: UserOnCallLogTimeline,
  ): Promise<NotificationRecord> {
    const reference: OnCallNotificationResourceReference | null =
      getResourceReference(timelineItem);

    const timezone: string | undefined =
      timelineItem.user?.timezone?.toString() || undefined;

    const context: OnCallNotificationContext | null =
      await getOnCallNotificationContext({
        timelineItem: timelineItem,
        timezone: timezone,
      });

    const notificationType: string = reference
      ? reference.resourceType.toString()
      : "Alert";

    const title: string =
      context?.resourceTitle ||
      timelineItem.triggeredByIncident?.title ||
      timelineItem.triggeredByIncidentEpisode?.title ||
      timelineItem.triggeredByAlertEpisode?.title ||
      timelineItem.triggeredByAlert?.title ||
      "";

    const resourceNumber: string = (context?.resourceNumber || "").trim();

    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    return {
      reference: reference,
      context: context,
      notificationType: notificationType,
      title: title,
      label: resourceNumber
        ? `${notificationType} ${resourceNumber}`
        : `This ${notificationType.toLowerCase()}`,
      labelInSentence: resourceNumber
        ? `${notificationType} ${resourceNumber}`
        : `this ${notificationType.toLowerCase()}`,
      viewDetailsUrl: new URL(
        httpProtocol,
        host,
        new Route(DashboardRoute.toString()).addRoute(
          `/${timelineItem.projectId?.toString()}/${reference?.dashboardPath || ""}/${reference?.resourceId.toString() || ""}`,
        ),
      ).toString(),
      viewDetailsText: `View ${notificationType}`,
      timezone: timezone,
    };
  }

  /*
   * The acknowledge page's "Can't take it? Escalate", or null: for a link
   * with the page's own token, while the page is the person's to escalate.
   */
  private async getPassOnBlock(data: {
    token: unknown;
    itemId: ObjectID;
    timelineItem: UserOnCallLogTimeline;
    timezone: string | undefined;
    // "Incident", "Alert Episode": for "not paged again for this incident".
    recordNoun: string;
  }): Promise<JSONObject | null> {
    if (
      !data.timelineItem.userId ||
      !data.timelineItem.onCallDutyPolicyExecutionLogId ||
      !OnCallPageLinkToken.isValid({
        token: data.token,
        userOnCallLogTimelineId: data.itemId,
      })
    ) {
      return null;
    }

    const preview: OnCallPassOnAnswer = await OnCallPagePassOn.getPreview({
      userId: data.timelineItem.userId,
      executionLogId: data.timelineItem.onCallDutyPolicyExecutionLogId,
    });

    if (!preview.result) {
      return null;
    }

    const wording: PassOnWording = this.getPassOnWording({
      result: preview.result,
      timezone: data.timezone,
      recordNoun: data.recordNoun,
    });

    return {
      lead: CANT_TAKE_IT,
      explanation: wording.explanation,
      ...(wording.warning ? { warning: wording.warning } : {}),
      buttonText: ESCALATE,
      formUrl: (await OnCallPageLinks.getPassOnUrl(data.itemId)).toString(),
      tokenParam: ON_CALL_PAGE_LINK_TOKEN_PARAM,
      token: String(data.token),
    };
  }

  // What escalating came to, or why it could not - on a page of its own.
  private renderPassOnAnswer(data: {
    req: ExpressRequest;
    res: ExpressResponse;
    record: NotificationRecord;
    answer: OnCallPassOnAnswer;
  }): void {
    const record: NotificationRecord = data.record;
    const answer: OnCallPassOnAnswer = data.answer;

    const heading: string =
      answer.passedOn && answer.result
        ? getOnCallPageEscalatedTitle(record.notificationType)
        : this.getRefusalHeading(answer.refusal);

    let message: string = getOnCallPassOnRefusalSentence(answer, {
      recordLabel: record.label,
    });
    let warning: string | undefined = undefined;

    if (answer.passedOn && answer.result) {
      // A page, often a phone's: "Level 2 of 3" and a time stay on one line.
      const sentence: string = getOnCallPassOnSentence(answer.result, {
        timezone: record.timezone,
        keepTogether: true,
      });
      const notPagedAgain: string = getOnCallPageNotPagedAgainSentence(
        record.notificationType,
      );

      // Nobody is left to page: said as a warning (OnCallPassOnWarning).
      if (isOnCallPassOnPagingStopped(answer.result)) {
        message = notPagedAgain;
        warning = sentence;
      } else {
        message = `${sentence} ${notPagedAgain}`;
      }
    }

    return Response.render(
      data.req,
      data.res,
      "/usr/src/Common/Server/Views/ViewMessage.ejs",
      {
        title: record.title ? `${heading} - ${record.title}` : heading,
        message: message,
        ...(warning ? { warning: warning } : {}),
        viewDetailsText: record.viewDetailsText,
        viewDetailsUrl: record.viewDetailsUrl,
        resourceNumber: record.context?.resourceNumber || "",
        resourceTitle: record.title,
        resourceDescription: record.context?.resourceDescription || "",
        details: detailsToJSON(record.context?.details || []),
      },
    );
  }

  /*
   * The heading over a refusal. It names what happened in a few words, and
   * leaves the why to the sentence under it - which would otherwise open by
   * saying the heading again ("This page is over" over "This page is over:
   * the on-call policy has stopped paging.").
   */
  private getRefusalHeading(refusal: OnCallPassOnRefusal | undefined): string {
    switch (refusal) {
      case OnCallPassOnRefusal.RecordAcknowledged:
        return ON_CALL_PAGE_ALREADY_ACKNOWLEDGED_TITLE;
      case OnCallPassOnRefusal.AlreadyPassedOn:
        return ON_CALL_PAGE_ALREADY_ESCALATED_TITLE;
      // A link outlives its page by days at most: one past its week is why.
      case OnCallPassOnRefusal.InvalidLink:
        return "This link has expired";
      case OnCallPassOnRefusal.PageOver:
      case OnCallPassOnRefusal.NotPaged:
      default:
        return ON_CALL_PAGE_NOTHING_TO_ESCALATE_TITLE;
    }
  }

  /*
   * What the pages that offer escalating say under their heading, in the
   * order of the Dashboard's dialog: what escalating does - "This will
   * immediately page Platform leads (Level 2 of 3), without waiting." - then
   * that the person is not paged again for it. When it leaves nobody being
   * paged (isOnCallPassOnPagingStopped), that sentence is a warning of its
   * own, drawn apart (OnCallPassOnWarning.ejs).
   */
  private getPassOnWording(data: {
    result: OnCallPassOnResult;
    timezone: string | undefined;
    // "Incident", "Alert Episode".
    recordNoun: string;
  }): PassOnWording {
    // A page, often a phone's: "Level 2 of 3" and a time stay on one line.
    const sentence: string = getOnCallPassOnSentence(data.result, {
      timezone: data.timezone,
      keepTogether: true,
    });
    const notPagedAgain: string = getOnCallPageNotPagedAgainSentence(
      data.recordNoun,
    );

    if (isOnCallPassOnPagingStopped(data.result)) {
      return { explanation: notPagedAgain, warning: sentence };
    }

    return { explanation: `${sentence} ${notPagedAgain}` };
  }

  /*
   * The second key of a call: escalates the person's page and says what came
   * of it, in a sentence or two the call reads out.
   */
  private async passOnFromCall(data: {
    itemId: ObjectID;
    timelineItem: UserOnCallLogTimeline;
  }): Promise<string> {
    const timelineItem: UserOnCallLogTimeline = data.timelineItem;

    const noun: string = (
      getResourceReference(timelineItem)?.resourceType.toString() || "page"
    ).toLowerCase();

    if (!timelineItem.userId || !timelineItem.onCallDutyPolicyExecutionLogId) {
      return `${getOnCallPassOnRefusalSentence({
        passedOn: false,
        refusal: OnCallPassOnRefusal.NotPaged,
      })} Good bye.`;
    }

    const answer: OnCallPassOnAnswer = await OnCallPagePassOn.passOn({
      userId: timelineItem.userId,
      executionLogId: timelineItem.onCallDutyPolicyExecutionLogId,
      viaUserOnCallLogTimelineId: data.itemId,
    });

    if (answer.passedOn && answer.result) {
      /*
       * "by 3:34 AM CEST": a time read out is the person's own. Read out, a
       * sentence keeps plain spaces (no keepTogether).
       */
      return `You escalated this ${noun}. ${getOnCallPassOnSentence(
        answer.result,
        { timezone: timelineItem.user?.timezone?.toString() || undefined },
      )} Good bye.`;
    }

    return `${getOnCallPassOnRefusalSentence(answer, {
      recordLabel: `This ${noun}`,
    })} Good bye.`;
  }
}
