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
import { DashboardRoute } from "../../ServiceRoute";
import Hostname from "../../Types/API/Hostname";
import Protocol from "../../Types/API/Protocol";
import URL from "../../Types/API/URL";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
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
import OnCallAcknowledgePageAnswerReader from "../Utils/OnCall/OnCallAcknowledgePageAnswer";
import {
  ON_CALL_CALL_NOT_ACKNOWLEDGED_SAY_MESSAGE,
  ON_CALL_NOTIFICATION_ACKNOWLEDGED_MESSAGE,
  ON_CALL_NOTIFICATION_NOT_ACKNOWLEDGED_MESSAGE,
  ON_CALL_OBSERVER_NOTIFICATION_SEEN_MESSAGE,
  isNotificationAcknowledged,
  recordAcknowledgement,
} from "../Utils/OnCall/OnCallNotificationStatus";
import OnCallDutyPolicyExecutionLog from "../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import {
  OnCallAcknowledgePageAnswer,
  getOnCallAcknowledgePageAnsweredHeading,
  getOnCallAcknowledgePageAnsweredSentence,
  isOnCallAcknowledgePageOpen,
} from "../../Types/OnCallDutyPolicy/OnCallAcknowledgePage";
import {
  ON_CALL_OBSERVER_PAGE_ACKNOWLEDGE_LABEL,
  isOnCallObserverPage,
} from "../../Types/OnCallDutyPolicy/OnCallObserverPage";
import OnCallPageLinks from "../Utils/OnCall/OnCallPageLinks";
import UserOnCallLogService from "../Services/UserOnCallLogService";
import UserOnCallLog from "../../Models/DatabaseModels/UserOnCallLog";
import {
  ON_CALL_TEST_PAGE_ACKNOWLEDGE_MESSAGE,
  ON_CALL_TEST_PAGE_ACKNOWLEDGE_TITLE,
  ON_CALL_TEST_PAGE_ANSWERED_MESSAGE,
  ON_CALL_TEST_PAGE_ANSWERED_TITLE,
  ON_CALL_TEST_PAGE_NOTIFICATION_ACKNOWLEDGED_MESSAGE,
  isOnCallTestPage,
} from "../../Types/OnCallDutyPolicy/OnCallTestPage";
import OnCallPageLinkToken, {
  ON_CALL_PAGE_LINK_TOKEN_PARAM,
} from "../Utils/OnCall/OnCallPageLinkToken";
import {
  CANT_TAKE_IT,
  ESCALATE,
  ON_CALL_PAGE_ALREADY_ACKNOWLEDGED_TITLE,
  ON_CALL_PAGE_ALREADY_ESCALATED_TITLE,
  ON_CALL_PAGE_CALL_PASS_ON_DIGIT,
  ON_CALL_PAGE_ESCALATE_TO_LABEL,
  ON_CALL_PAGE_LEVELS_CHANGED_NOTICE,
  ON_CALL_PAGE_LEVELS_CHANGED_PICK_AGAIN_NOTICE,
  ON_CALL_PAGE_NOTHING_TO_ESCALATE_TITLE,
  ON_CALL_PAGE_NOT_ESCALATED_TITLE,
  ON_CALL_PAGE_PASS_ON_LEVEL_PARAM,
  ON_CALL_PAGE_PICK_LEVEL_SENTENCE,
  OnCallPassOnAnswer,
  OnCallPassOnLevelChoice,
  OnCallPassOnRefusal,
  OnCallPassOnResult,
  getOnCallPageEscalatedTitle,
  getOnCallPageNotPagedAgainSentence,
  getOnCallPassOnLevelChoices,
  getOnCallPassOnLevelLabel,
  getOnCallPassOnRefusalSentence,
  getOnCallPassOnSentence,
  hasOnCallPassOnLevelChoice,
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
  // A test page (OnCallTestPage) opens a page of its own, about no record.
  userNotificationEventType: true,
  userNotificationLogId: true,
  isAcknowledged: true,
  // When it was answered from its own link: "You already acknowledged ... at 5:28 AM UTC."
  acknowledgedAt: true,
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
 * escalating leaves nobody being paged - the warning it draws apart. Where
 * the person can pick the level (two or more levels after theirs), the
 * levels, for the form's "Escalate to" (OnCallPassOnForm.ejs).
 */
interface PassOnWording {
  explanation: string;
  warning?: string | undefined;
  levelChoices?: PassOnFormLevels | undefined;
}

/*
 * The levels the Escalate form offers, as the form draws them: a radio for
 * each, the next level picked. The next level's value is empty - "the next
 * level", as a form without levels sends - so leaving it picked escalates
 * exactly as before, whatever the levels have become since the page was
 * drawn; a later level's is its escalation rule's id.
 */
export interface PassOnFormLevels {
  // The radio group's label: "Escalate to".
  label: string;
  // The field the form sends the level picked in.
  param: string;
  options: Array<{ value: string; label: string; isPicked: boolean }>;
}

// The levels a preview offers, for the Escalate form; none without a choice.
export function getPassOnFormLevels(
  result: OnCallPassOnResult,
): PassOnFormLevels | undefined {
  if (!hasOnCallPassOnLevelChoice(result)) {
    return undefined;
  }

  return {
    label: ON_CALL_PAGE_ESCALATE_TO_LABEL,
    param: ON_CALL_PAGE_PASS_ON_LEVEL_PARAM,
    options: getOnCallPassOnLevelChoices(result).map(
      (choice: OnCallPassOnLevelChoice, index: number) => {
        return {
          value: index === 0 ? "" : choice.escalationRuleId,
          // A page, often a phone's: "Level 2 of 3" stays on one line.
          label: getOnCallPassOnLevelLabel(choice, result.ruleCount, true),
          isPicked: index === 0,
        };
      },
    ),
  };
}

/*
 * The level the Escalate form picked: none for the next level (an empty
 * value, or a form without levels), an id for a later one. A value that is
 * not an id cannot be a level of the policy: `isUnknown`, and nothing is
 * escalated.
 */
export function readPassOnFormLevel(body: unknown): {
  escalationRuleId?: ObjectID | undefined;
  isUnknown: boolean;
} {
  const value: unknown =
    body && typeof body === "object"
      ? (body as JSONObject)[ON_CALL_PAGE_PASS_ON_LEVEL_PARAM]
      : undefined;

  if (value === undefined || value === null || value === "") {
    return { isUnknown: false };
  }

  if (typeof value !== "string" || !ObjectID.isValidUUID(value.trim())) {
    return { isUnknown: true };
  }

  return { escalationRuleId: new ObjectID(value.trim()), isUnknown: false };
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

          /*
           * The first key acknowledges the page: written once, over what
           * the call's send or its provider wrote
           * (OnCallNotificationStatus.recordAcknowledgement), and the
           * notification's update hook acknowledges the page and its record.
           */
          if (req.body["Digits"] === "1") {
            const isAcknowledged: boolean = await recordAcknowledgement({
              userOnCallLogTimelineId: itemId,
              statusMessage: ON_CALL_NOTIFICATION_ACKNOWLEDGED_MESSAGE,
            });

            /*
             * Not written, and not acknowledged meanwhile either - from
             * another of the page's messages: the notification kept changing
             * under every try. The call never says a page is acknowledged
             * that goes on paging the person.
             */
            if (
              !isAcknowledged &&
              !(await isNotificationAcknowledged(itemId))
            ) {
              return NotificationMiddleware.sendResponse(
                req,
                res,
                token as any,
                ON_CALL_CALL_NOT_ACKNOWLEDGED_SAY_MESSAGE,
              );
            }
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
     *
     * It offers Acknowledge only while the person's page still waits for an
     * answer (OnCallAcknowledgePage): once they answered it some other way,
     * somebody else took the record, or it is resolved, it says so instead
     * (https://github.com/OneUptime/oneuptime/issues/6706). Either way it
     * links the record in the Dashboard.
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
            await this.readNotification(itemId);

          if (!timelineItem) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Invalid item Id"),
            );
          }

          // A test page (OnCallTestPage) is about no record: a page of its own.
          if (isOnCallTestPage(timelineItem)) {
            return await this.renderTestPageAcknowledgePage({
              req: req,
              res: res,
              itemId: itemId,
              timelineItem: timelineItem,
            });
          }

          /*
           * The context read is what puts severity, state, project, monitors
           * and the time it was raised on the page. It is best effort on
           * purpose: a deleted resource, or a resource this notification no
           * longer points at, must still leave a page the engineer can
           * acknowledge from.
           */
          const record: NotificationRecord =
            await this.readNotificationRecord(timelineItem);

          /*
           * The run says what kind of page this is - an observer's page
           * (OnCallObserverPage) is answered by saying they have seen it:
           * the record is not acknowledged, and there is nothing to
           * escalate - and whether, and by whom, it was answered.
           */
          const run: OnCallDutyPolicyExecutionLog | null =
            await OnCallAcknowledgePageAnswerReader.readRun(
              timelineItem.onCallDutyPolicyExecutionLogId,
            );

          const isObserverPage: boolean = isOnCallObserverPage(run);

          const answer: OnCallAcknowledgePageAnswer =
            await OnCallAcknowledgePageAnswerReader.read({
              timelineItem: timelineItem,
              reference: record.reference,
              run: run,
            });

          if (!isOnCallAcknowledgePageOpen(answer)) {
            return this.renderAcknowledgePageAnswered({
              req: req,
              res: res,
              record: record,
              answer: answer,
              isObserverPage: isObserverPage,
            });
          }

          const notificationType: string = record.notificationType;

          /*
           * "Can't take it? Escalate" beside Acknowledge - for a link that
           * carries the page's own token (OnCallPageLinkToken), while the
           * page is still the person's to escalate. The texts, the WhatsApp
           * messages and the chat messages all lead here.
           */
          const passOn: JSONObject | null = isObserverPage
            ? null
            : await this.getPassOnBlock({
                token: req.query?.[ON_CALL_PAGE_LINK_TOKEN_PARAM],
                itemId: itemId,
                timelineItem: timelineItem,
                timezone: record.timezone,
                recordNoun: notificationType,
              });

          const recordNoun: string = notificationType.toLowerCase();

          return Response.render(
            req,
            res,
            "/usr/src/Common/Server/Views/AcknowledgeUserOnCallNotification.ejs",
            {
              title: isObserverPage
                ? `${ON_CALL_OBSERVER_PAGE_ACKNOWLEDGE_LABEL} - ${record.title}`
                : `Acknowledge ${notificationType} - ${record.title}`,
              message: isObserverPage
                ? `You're paged as an observer: the people responding stay on this ${recordNoun}. Saying you've seen it does not acknowledge the ${recordNoun}.`
                : `Do you want to acknowledge this ${notificationType}?`,
              acknowledgeText: isObserverPage
                ? ON_CALL_OBSERVER_PAGE_ACKNOWLEDGE_LABEL
                : `Acknowledge ${notificationType}`,
              acknowledgeUrl: (
                await OnCallPageLinks.getAcknowledgeUrl(itemId)
              ).toString(),
              // "View Incident": the record in the Dashboard, under Acknowledge.
              viewDetailsText: record.viewDetailsText,
              viewDetailsUrl: record.viewDetailsUrl,
              resourceNumber: record.context?.resourceNumber || "",
              resourceTitle: record.title,
              resourceDescription: record.context?.resourceDescription || "",
              details: detailsToJSON(record.context?.details || []),
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
            await this.readNotification(itemId);

          if (!timelineItem) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Invalid item Id"),
            );
          }

          /*
           * A test page (OnCallTestPage): acknowledged here, and the page says
           * it works - there is no record to send the person to.
           */
          if (isOnCallTestPage(timelineItem)) {
            return await this.acknowledgeTestPage({
              req: req,
              res: res,
              itemId: itemId,
              timelineItem: timelineItem,
            });
          }

          const host: Hostname = await DatabaseConfig.getHost();
          const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

          // Determine the resource type and ID for routing.
          const reference: OnCallNotificationResourceReference | null =
            getResourceReference(timelineItem);

          // An observer's page is answered as seen (OnCallObserverPage).
          const run: OnCallDutyPolicyExecutionLog | null =
            await OnCallAcknowledgePageAnswerReader.readRun(
              timelineItem.onCallDutyPolicyExecutionLogId,
            );

          const isObserverPage: boolean = isOnCallObserverPage(run);

          /*
           * Asked again as the button is pressed, not only as the page was
           * drawn: a page left open while a colleague acknowledged the
           * incident - or after the person answered another of their
           * messages - says so, and acknowledges nothing a second time.
           */
          const answer: OnCallAcknowledgePageAnswer =
            await OnCallAcknowledgePageAnswerReader.read({
              timelineItem: timelineItem,
              reference: reference,
              run: run,
            });

          if (!isOnCallAcknowledgePageOpen(answer)) {
            /*
             * Same context the acknowledge page shows. Someone who follows the
             * link twice - or whose colleague got there first - still needs to
             * know what the page they are looking at is about.
             */
            return this.renderAcknowledgePageAnswered({
              req: req,
              res: res,
              record: await this.readNotificationRecord(timelineItem),
              answer: answer,
              isObserverPage: isObserverPage,
            });
          }

          /*
           * Written once (OnCallNotificationStatus.recordAcknowledgement): a
           * second press landing meanwhile - the button pressed twice, the
           * link opened on two devices - acknowledges nothing again, and is
           * told what the page says now.
           */
          const isAcknowledged: boolean = await recordAcknowledgement({
            userOnCallLogTimelineId: itemId,
            statusMessage: isObserverPage
              ? ON_CALL_OBSERVER_NOTIFICATION_SEEN_MESSAGE
              : ON_CALL_NOTIFICATION_ACKNOWLEDGED_MESSAGE,
          });

          if (!isAcknowledged) {
            // Read again, as they are now: whose answer it was, and when.
            const answeredItem: UserOnCallLogTimeline =
              (await this.readNotification(itemId)) || timelineItem;

            const runNow: OnCallDutyPolicyExecutionLog | null =
              (await OnCallAcknowledgePageAnswerReader.readRun(
                answeredItem.onCallDutyPolicyExecutionLogId,
              )) || run;

            const answerNow: OnCallAcknowledgePageAnswer =
              await OnCallAcknowledgePageAnswerReader.read({
                timelineItem: answeredItem,
                reference: reference,
                run: runNow,
              });

            // Not acknowledged, and not answered either: nothing to claim.
            if (isOnCallAcknowledgePageOpen(answerNow)) {
              return Response.sendErrorResponse(
                req,
                res,
                new BadDataException(
                  ON_CALL_NOTIFICATION_NOT_ACKNOWLEDGED_MESSAGE,
                ),
              );
            }

            return this.renderAcknowledgePageAnswered({
              req: req,
              res: res,
              record: await this.readNotificationRecord(answeredItem),
              answer: answerNow,
              isObserverPage: isObserverPage,
            });
          }

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

          return await this.renderPassOnQuestion({
            req: req,
            res: res,
            itemId: itemId,
            timelineItem: timelineItem,
            record: record,
            pageToken: String(pageToken),
          });
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

          // The level picked on the form, if a later one than the next.
          const level: {
            escalationRuleId?: ObjectID | undefined;
            isUnknown: boolean;
          } = readPassOnFormLevel(req.body);

          const answer: OnCallPassOnAnswer = level.isUnknown
            ? {
                passedOn: false,
                refusal: OnCallPassOnRefusal.LevelNotAvailable,
              }
            : await OnCallPagePassOn.passOn({
                userId: timelineItem.userId!,
                executionLogId: timelineItem.onCallDutyPolicyExecutionLogId!,
                viaUserOnCallLogTimelineId: itemId,
                toEscalationRuleId: level.escalationRuleId,
              });

          /*
           * The level picked was not there to page: the page asks again,
           * with the levels as they are now, saying why - the person is
           * still being paged, and one more press escalates.
           */
          if (answer.refusal === OnCallPassOnRefusal.LevelNotAvailable) {
            return await this.renderPassOnQuestion({
              req: req,
              res: res,
              itemId: itemId,
              timelineItem: timelineItem,
              record: record,
              pageToken: String(
                (req.body as JSONObject)[ON_CALL_PAGE_LINK_TOKEN_PARAM],
              ),
              isAskingAgain: true,
            });
          }

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

  /*
   * Whether the person already acknowledged a test page (OnCallTestPage):
   * from this message, or from another of theirs - a test is theirs to
   * acknowledge once, whoever else it reached.
   */
  private async isTestPageAnswered(
    timelineItem: UserOnCallLogTimeline,
  ): Promise<boolean> {
    if (timelineItem.isAcknowledged) {
      return true;
    }

    if (!timelineItem.userNotificationLogId) {
      return false;
    }

    const log: UserOnCallLog | null = await UserOnCallLogService.findOneById({
      id: timelineItem.userNotificationLogId,
      select: {
        _id: true,
        acknowledgedAt: true,
      },
      props: {
        isRoot: true,
      },
    });

    return Boolean(log?.acknowledgedAt);
  }

  // A test page's link: Acknowledge, or that it works once it is acknowledged.
  private async renderTestPageAcknowledgePage(data: {
    req: ExpressRequest;
    res: ExpressResponse;
    itemId: ObjectID;
    timelineItem: UserOnCallLogTimeline;
  }): Promise<void> {
    if (await this.isTestPageAnswered(data.timelineItem)) {
      return this.renderTestPageAnswered(data.req, data.res);
    }

    return Response.render(
      data.req,
      data.res,
      "/usr/src/Common/Server/Views/AcknowledgeUserOnCallNotification.ejs",
      {
        title: ON_CALL_TEST_PAGE_ACKNOWLEDGE_TITLE,
        message: ON_CALL_TEST_PAGE_ACKNOWLEDGE_MESSAGE,
        acknowledgeText: ON_CALL_TEST_PAGE_ACKNOWLEDGE_TITLE,
        acknowledgeUrl: (
          await OnCallPageLinks.getAcknowledgeUrl(data.itemId)
        ).toString(),
      },
    );
  }

  // The test page's Acknowledge: the message is acknowledged, and it works.
  private async acknowledgeTestPage(data: {
    req: ExpressRequest;
    res: ExpressResponse;
    itemId: ObjectID;
    timelineItem: UserOnCallLogTimeline;
  }): Promise<void> {
    // Written once, as any acknowledgement is (recordAcknowledgement).
    if (!(await this.isTestPageAnswered(data.timelineItem))) {
      await recordAcknowledgement({
        userOnCallLogTimelineId: data.itemId,
        statusMessage: ON_CALL_TEST_PAGE_NOTIFICATION_ACKNOWLEDGED_MESSAGE,
      });
    }

    return this.renderTestPageAnswered(data.req, data.res);
  }

  private renderTestPageAnswered(
    req: ExpressRequest,
    res: ExpressResponse,
  ): void {
    return Response.render(
      req,
      res,
      "/usr/src/Common/Server/Views/ViewMessage.ejs",
      {
        title: ON_CALL_TEST_PAGE_ANSWERED_TITLE,
        message: ON_CALL_TEST_PAGE_ANSWERED_MESSAGE,
        statusIcon: "check",
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
      // None for a notification that points at nothing: no button to a page that is not there.
      viewDetailsUrl: reference
        ? new URL(
            httpProtocol,
            host,
            new Route(DashboardRoute.toString()).addRoute(
              `/${timelineItem.projectId?.toString()}/${reference.dashboardPath}/${reference.resourceId.toString()}`,
            ),
          ).toString()
        : "",
      viewDetailsText: `View ${notificationType}`,
      timezone: timezone,
    };
  }

  /*
   * The acknowledge page once it no longer offers Acknowledge
   * (OnCallAcknowledgePage): why - "Incident INC-42 was already acknowledged
   * by Ana Lopez at 5:28 AM UTC." - under a check, with what it is about and
   * the button that opens it in the Dashboard. The time is on the person's
   * own clock. The address its button opens says the same when it is
   * pressed too late.
   */
  private renderAcknowledgePageAnswered(data: {
    req: ExpressRequest;
    res: ExpressResponse;
    record: NotificationRecord;
    answer: OnCallAcknowledgePageAnswer;
    isObserverPage: boolean;
  }): void {
    const record: NotificationRecord = data.record;

    const heading: string = getOnCallAcknowledgePageAnsweredHeading({
      state: data.answer.state,
      isObserverPage: data.isObserverPage,
    });

    return Response.render(
      data.req,
      data.res,
      "/usr/src/Common/Server/Views/ViewMessage.ejs",
      {
        title: record.title ? `${heading} - ${record.title}` : heading,
        message: getOnCallAcknowledgePageAnsweredSentence({
          answer: data.answer,
          isObserverPage: data.isObserverPage,
          recordLabel: record.label,
          recordLabelInSentence: record.labelInSentence,
          timezone: record.timezone,
        }),
        // Nothing is asked of the person: the heading wears a check.
        statusIcon: "check",
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
      // Two or more levels after theirs: the form asks which.
      ...(wording.levelChoices
        ? { levelChoices: wording.levelChoices as unknown as JSONObject }
        : {}),
      buttonText: ESCALATE,
      formUrl: (await OnCallPageLinks.getPassOnUrl(data.itemId)).toString(),
      tokenParam: ON_CALL_PAGE_LINK_TOKEN_PARAM,
      token: String(data.token),
    };
  }

  /*
   * The page a message's Escalate link opens: what escalating would do, and
   * the form that does it - with the levels to pick from, when there are
   * two or more after the person's. `isAskingAgain`: the level picked was
   * not there to page, and the page says so above the levels as they are
   * now - to pick one again where it offers levels (pressing Escalate as
   * it stands would page the next level), or only what happened where it
   * has one level left to page.
   */
  private async renderPassOnQuestion(data: {
    req: ExpressRequest;
    res: ExpressResponse;
    itemId: ObjectID;
    timelineItem: UserOnCallLogTimeline;
    record: NotificationRecord;
    pageToken: string;
    isAskingAgain?: boolean | undefined;
  }): Promise<void> {
    const record: NotificationRecord = data.record;

    const preview: OnCallPassOnAnswer = await OnCallPagePassOn.getPreview({
      userId: data.timelineItem.userId!,
      executionLogId: data.timelineItem.onCallDutyPolicyExecutionLogId!,
    });

    if (!preview.result) {
      return this.renderPassOnAnswer({
        req: data.req,
        res: data.res,
        record: record,
        answer: preview,
      });
    }

    /*
     * The heading asks - "Escalate Incident INC-42?" - and under it, what
     * escalating does, then that they are not paged again. The person
     * followed "Can't take it? Escalate" to get here, so the page does not
     * ask that again.
     */
    const wording: PassOnWording = this.getPassOnWording({
      result: preview.result,
      timezone: record.timezone,
      recordNoun: record.notificationType,
    });

    const notice: string | undefined = data.isAskingAgain
      ? wording.levelChoices
        ? ON_CALL_PAGE_LEVELS_CHANGED_PICK_AGAIN_NOTICE
        : ON_CALL_PAGE_LEVELS_CHANGED_NOTICE
      : undefined;

    return Response.render(
      data.req,
      data.res,
      "/usr/src/Common/Server/Views/PassOnUserOnCallNotification.ejs",
      {
        title: `${ESCALATE} ${record.labelInSentence}?`,
        message: wording.explanation,
        ...(wording.warning ? { warning: wording.warning } : {}),
        ...(notice ? { notice: notice } : {}),
        ...(wording.levelChoices
          ? { levelChoices: wording.levelChoices as unknown as JSONObject }
          : {}),
        passOnText: ESCALATE,
        passOnFormUrl: (
          await OnCallPageLinks.getPassOnUrl(data.itemId)
        ).toString(),
        pageTokenParam: ON_CALL_PAGE_LINK_TOKEN_PARAM,
        pageToken: data.pageToken,
        acknowledgeText: `Acknowledge ${record.notificationType} instead`,
        acknowledgeUrl: (
          await OnCallPageLinks.getAcknowledgeUrl(data.itemId)
        ).toString(),
        resourceNumber: record.context?.resourceNumber || "",
        resourceTitle: record.title,
        resourceDescription: record.context?.resourceDescription || "",
        details: detailsToJSON(record.context?.details || []),
      },
    );
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
      case OnCallPassOnRefusal.LevelNotAvailable:
        return ON_CALL_PAGE_NOT_ESCALATED_TITLE;
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

    /*
     * Two or more levels after theirs: the form asks which, and until they
     * pick, the page can only say that it pages the one they pick.
     */
    const levelChoices: PassOnFormLevels | undefined = getPassOnFormLevels(
      data.result,
    );

    if (levelChoices) {
      return {
        explanation: `${ON_CALL_PAGE_PICK_LEVEL_SENTENCE} ${notPagedAgain}`,
        levelChoices: levelChoices,
      };
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
