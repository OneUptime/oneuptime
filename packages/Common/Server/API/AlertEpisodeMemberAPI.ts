import AlertEpisodeMember from "../../Models/DatabaseModels/AlertEpisodeMember";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import EpisodeMembersAdd, {
  ALERT_EPISODE_ID_KEY,
  ALERT_EPISODE_MEMBERS_ADD_PATH,
  ALERT_IDS_KEY,
  EpisodeMembersAddResult,
} from "../../Types/Episode/EpisodeMembersAdd";
import { JSONObject } from "../../Types/JSON";
import AlertEpisodeMemberService, {
  Service as AlertEpisodeMemberServiceType,
} from "../Services/AlertEpisodeMemberService";
import UserMiddleware from "../Middleware/UserAuthorization";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";

/*
 * An alert episode's members: the CRUD routes every model has, and
 * POST /alert-episode-member/add-alerts, which adds several alerts to an
 * episode in one request (EpisodeMembersAdd) - the alerts lists' Add to
 * Existing Episode and the episode's own Add Alerts.
 *
 * Body: { "alertEpisodeId": "<id>", "alertIds": ["<id>", ...] }, at most
 * MAX_EPISODE_MEMBERS_PER_ADD ids. A person, an API key or an MCP client,
 * in the project the request's tenant header names. The answer says, for
 * every alert named, whether it was added, was in the episode already, or
 * was not added and why (EpisodeMembersAddResult).
 */
export default class AlertEpisodeMemberAPI extends BaseAPI<
  AlertEpisodeMember,
  AlertEpisodeMemberServiceType
> {
  public constructor() {
    super(AlertEpisodeMember, AlertEpisodeMemberService);

    this.router.post(
      ALERT_EPISODE_MEMBERS_ADD_PATH,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.addAlerts(req, res);
        } catch (err) {
          next(err);
        }
      },
    );
  }

  private async addAlerts(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    CommonAPI.assertTenantScoped(props);

    const body: JSONObject = (req.body || {}) as JSONObject;

    const result: EpisodeMembersAddResult =
      await AlertEpisodeMemberService.addAlertsToEpisode({
        alertEpisodeId: body[ALERT_EPISODE_ID_KEY],
        alertIds: body[ALERT_IDS_KEY],
        props: props,
      });

    return Response.sendJsonObjectResponse(
      req,
      res,
      EpisodeMembersAdd.toJSON(result),
    );
  }
}
