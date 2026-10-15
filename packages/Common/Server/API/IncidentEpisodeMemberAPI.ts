import IncidentEpisodeMember from "../../Models/DatabaseModels/IncidentEpisodeMember";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import EpisodeMembersAdd, {
  EpisodeMembersAddResult,
  INCIDENT_EPISODE_ID_KEY,
  INCIDENT_EPISODE_MEMBERS_ADD_PATH,
  INCIDENT_IDS_KEY,
} from "../../Types/Episode/EpisodeMembersAdd";
import { JSONObject } from "../../Types/JSON";
import IncidentEpisodeMemberService, {
  Service as IncidentEpisodeMemberServiceType,
} from "../Services/IncidentEpisodeMemberService";
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
 * An incident episode's members: the CRUD routes every model has, and
 * POST /incident-episode-member/add-incidents, which adds several incidents
 * to an episode in one request (EpisodeMembersAdd) - the incidents lists'
 * Add to Existing Episode and the episode's own Add Incidents.
 *
 * Body: { "incidentEpisodeId": "<id>", "incidentIds": ["<id>", ...] }, at
 * most MAX_EPISODE_MEMBERS_PER_ADD ids. A person, an API key or an MCP
 * client, in the project the request's tenant header names. The answer
 * says, for every incident named, whether it was added, was in the episode
 * already, or was not added and why (EpisodeMembersAddResult).
 */
export default class IncidentEpisodeMemberAPI extends BaseAPI<
  IncidentEpisodeMember,
  IncidentEpisodeMemberServiceType
> {
  public constructor() {
    super(IncidentEpisodeMember, IncidentEpisodeMemberService);

    this.router.post(
      INCIDENT_EPISODE_MEMBERS_ADD_PATH,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.addIncidents(req, res);
        } catch (err) {
          next(err);
        }
      },
    );
  }

  private async addIncidents(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    CommonAPI.assertTenantScoped(props);

    const body: JSONObject = (req.body || {}) as JSONObject;

    const result: EpisodeMembersAddResult =
      await IncidentEpisodeMemberService.addIncidentsToEpisode({
        incidentEpisodeId: body[INCIDENT_EPISODE_ID_KEY],
        incidentIds: body[INCIDENT_IDS_KEY],
        props: props,
      });

    return Response.sendJsonObjectResponse(
      req,
      res,
      EpisodeMembersAdd.toJSON(result),
    );
  }
}
