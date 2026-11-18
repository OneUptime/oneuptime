import IncidentPostmortemActionItem from "../../Models/DatabaseModels/IncidentPostmortemActionItem";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import {
  ActionItemCodeTaskKind,
  parseActionItemCodeTaskKind,
} from "../../Utils/Incident/PostmortemActionItemCodeTask";
import UserMiddleware from "../Middleware/UserAuthorization";
import IncidentPostmortemActionItemService, {
  Service as IncidentPostmortemActionItemServiceType,
  TrackedFromNote,
} from "../Services/IncidentPostmortemActionItemService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import PostmortemActionItemCodeTasks, {
  ActionItemCodeTaskStarted,
} from "../Utils/Incident/PostmortemActionItemCodeTasks";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";
import ServerProductRoutes from "../Utils/ServerProducts/ServerProductRoutes";
import ProductKey from "../../Types/Product/ProductKey";

/*
 * A postmortem's action items (issue #6801): the generic routes every
 * model has, and two of their own.
 *
 *   - POST .../track-from-postmortem { incidentId, timezone? }: the action
 *     items the incident's postmortem note lists, and the incident does
 *     not track yet, become action items (IncidentPostmortemActionItem
 *     Service.trackFromPostmortemNote). The time zone places a due day the
 *     note gives, as the Due Date picker does.
 *   - POST .../start-code-task { actionItemId, kind, repositoryId,
 *     instructions? }: OneUptime AI writes the action item's pull request,
 *     or a test (PostmortemActionItemCodeTasks.start).
 *
 * Both as the person asking, signed in: what they may read and change is
 * what the answer covers.
 */
export default class IncidentPostmortemActionItemAPI extends BaseAPI<
  IncidentPostmortemActionItem,
  IncidentPostmortemActionItemServiceType
> {
  public constructor() {
    super(IncidentPostmortemActionItem, IncidentPostmortemActionItemService);

    const path: string =
      new this.entityType().getCrudApiPath()?.toString() || "";

    this.router.post(
      `${path}/track-from-postmortem`,
      UserMiddleware.getUserMiddleware,
      ServerProductRoutes.refuseWhileOff(ProductKey.Incidents),
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const props: DatabaseCommonInteractionProps =
            await IncidentPostmortemActionItemAPI.getSignedInProps(req);
          const body: JSONObject = (req.body as JSONObject) || {};

          const tracked: TrackedFromNote =
            await IncidentPostmortemActionItemService.trackFromPostmortemNote({
              incidentId: IncidentPostmortemActionItemAPI.readId(
                body["incidentId"],
                "incident",
              ),
              props,
              timezone:
                typeof body["timezone"] === "string"
                  ? (body["timezone"] as string)
                  : undefined,
            });

          Response.sendJsonObjectResponse(req, res, {
            trackedCount: tracked.trackedItems.length,
            listedCount: tracked.listedCount,
          });
        } catch (err) {
          next(err);
        }
      },
    );

    this.router.post(
      `${path}/start-code-task`,
      UserMiddleware.getUserMiddleware,
      ServerProductRoutes.refuseWhileOff(ProductKey.Incidents),
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const props: DatabaseCommonInteractionProps =
            await IncidentPostmortemActionItemAPI.getSignedInProps(req);
          const body: JSONObject = (req.body as JSONObject) || {};

          const kind: ActionItemCodeTaskKind | null =
            parseActionItemCodeTaskKind(body["kind"]);

          if (!kind) {
            throw new BadDataException(
              "Say what OneUptime AI should write for the action item: PullRequest or Test.",
            );
          }

          const started: ActionItemCodeTaskStarted =
            await PostmortemActionItemCodeTasks.start({
              props,
              actionItemId: IncidentPostmortemActionItemAPI.readId(
                body["actionItemId"],
                "action item",
              ),
              kind,
              repositoryId: IncidentPostmortemActionItemAPI.readId(
                body["repositoryId"],
                "repository",
              ),
              instructions:
                typeof body["instructions"] === "string"
                  ? (body["instructions"] as string)
                  : undefined,
            });

          Response.sendJsonObjectResponse(req, res, {
            taskId: started.taskId.toString(),
          });
        } catch (err) {
          next(err);
        }
      },
    );
  }

  private static async getSignedInProps(
    req: ExpressRequest,
  ): Promise<DatabaseCommonInteractionProps> {
    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    CommonAPI.assertAuthenticatedUser(props);

    return props;
  }

  // An id from the body, or a refusal that names what is missing.
  public static readId(value: unknown, what: string): ObjectID {
    if (typeof value !== "string" || !ObjectID.isValidUUID(value)) {
      throw new BadDataException(
        `Say which ${what} you mean: its id is missing or is not an id.`,
      );
    }

    return new ObjectID(value);
  }
}
