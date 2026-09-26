import StatusPageSubscriberService, {
  Service as StatusPageSubscriberServiceType,
} from "../Services/StatusPageSubscriberService";
import StatusPageService from "../Services/StatusPageService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import StatusPageSubscriber from "../../Models/DatabaseModels/StatusPageSubscriber";
import ObjectID from "../../Types/ObjectID";
import StatusPageSubscriberUnsubscribe from "../../Types/StatusPage/StatusPageSubscriberUnsubscribe";

/*
 * What the old unsubscribe route answers for an id that is not a
 * subscriber's. Static, so nothing from the request is ever echoed into it.
 */
export const OUT_OF_DATE_UNSUBSCRIBE_LINK_HTML: string =
  '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8" /><meta name="robots" content="noindex" /><meta name="referrer" content="no-referrer" /><title>Unsubscribe link out of date</title></head><body><p>This unsubscribe link is out of date. To unsubscribe, use the unsubscribe link at the bottom of a recent message from the status page.</p></body></html>';

export default class StatusPageSubscriberAPI extends BaseAPI<
  StatusPageSubscriber,
  StatusPageSubscriberServiceType
> {
  public constructor() {
    super(StatusPageSubscriber, StatusPageSubscriberService);

    /*
     * The unsubscribe link notifications carried until the end of 2023:
     * /api/status-page-subscriber/unsubscribe/{subscriberId}. It used to
     * unsubscribe on the GET itself, knowing only the id - so a mail scanner
     * fetching the link, or an <img> pointed at it from anywhere, cancelled
     * the subscription.
     *
     * It no longer changes anything. An old link still leads somewhere
     * useful: the status page's unsubscribe page, told only the id, which
     * says the link is out of date and to use the one in a recent message
     * (and, on a public page, offers the subscriber's manage page). It never
     * hands out the subscriber's unsubscribe token - that would make the id
     * alone enough to unsubscribe again. Notifications now carry
     * {statusPageUrl}/unsubscribe/{id}-{token}, which asks before it acts.
     */
    this.router.get(
      `${new this.entityType().getCrudApiPath()?.toString()}/unsubscribe/:id`,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const subscriberId: string = (req.params["id"] as string) || "";

          const subscriber: StatusPageSubscriber | null = ObjectID.isValidUUID(
            subscriberId,
          )
            ? await this.service.findOneBy({
                query: {
                  _id: subscriberId,
                },
                select: {
                  _id: true,
                  statusPageId: true,
                },
                props: {
                  isRoot: true,
                  ignoreHooks: true,
                },
              })
            : null;

          Response.setNoCacheHeaders(res);

          if (!subscriber || !subscriber.id || !subscriber.statusPageId) {
            res.status(404);
            res.setHeader("Content-Type", "text/html; charset=utf-8");
            res.send(OUT_OF_DATE_UNSUBSCRIBE_LINK_HTML);
            return;
          }

          const statusPageUrl: string =
            await StatusPageService.getStatusPageURL(subscriber.statusPageId);

          return Response.redirect(
            req,
            res,
            StatusPageSubscriberUnsubscribe.buildLink({
              statusPageUrl: statusPageUrl,
              subscriberId: subscriber.id,
              unsubscribeToken: null,
            }),
          );
        } catch (err) {
          next(err);
        }
      },
    );
  }
}
