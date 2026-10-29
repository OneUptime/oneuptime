import SecurityWatchlist from "../../Models/DatabaseModels/SecurityWatchlist";
import SecurityWatchlistItem from "../../Models/DatabaseModels/SecurityWatchlistItem";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import {
  SecurityWatchlistImportMode,
  SecurityWatchlistImportProblem,
  isSecurityWatchlistImportMode,
} from "../../Types/SecurityEvent/SecurityWatchlist";
import UserMiddleware from "../Middleware/UserAuthorization";
import SecurityWatchlistItemService, {
  SecurityWatchlistImportSummary,
} from "../Services/SecurityWatchlistItemService";
import SecurityWatchlistService, {
  Service as SecurityWatchlistServiceType,
} from "../Services/SecurityWatchlistService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";

/*
 * Watchlists: their CRUD, and
 *
 *   POST /security-watchlist/import   values from a file or a paste, added
 *                                     to a list the team keeps or replacing
 *                                     what it holds
 *
 * An import adds values, so it takes the permission to add them - and, to
 * replace a list, to remove them; the list is read as the caller, so a list
 * they cannot read is not found. What it did comes back: how many values
 * were added, removed and already there, and the lines it left out.
 */
export default class SecurityWatchlistAPI extends BaseAPI<
  SecurityWatchlist,
  SecurityWatchlistServiceType
> {
  public constructor() {
    super(SecurityWatchlist, SecurityWatchlistService);

    const basePath: string =
      new this.entityType().getCrudApiPath()?.toString() || "";

    this.router.post(
      `${basePath}/import`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          CommonAPI.assertAuthenticatedProjectMember(props);

          CommonAPI.assertCanCreateTable({
            modelType: SecurityWatchlistItem,
            props,
            errorMessage:
              "Importing values takes a role that can add values to watchlists.",
          });

          const body: JSONObject =
            req.body && typeof req.body === "object" && !Array.isArray(req.body)
              ? (req.body as JSONObject)
              : {};

          const watchlistId: unknown = body["securityWatchlistId"];

          if (
            typeof watchlistId !== "string" ||
            !ObjectID.isValidUUID(watchlistId)
          ) {
            throw new BadDataException("Choose the watchlist to import into.");
          }

          const mode: SecurityWatchlistImportMode =
            isSecurityWatchlistImportMode(body["mode"])
              ? body["mode"]
              : SecurityWatchlistImportMode.Add;

          if (mode === SecurityWatchlistImportMode.Replace) {
            CommonAPI.assertPermittedInProject({
              databaseProps: props,
              allowedPermissions:
                new SecurityWatchlistItem().getDeletePermissions(),
              errorMessage:
                "Replacing a list takes a role that can remove values from watchlists.",
            });
          }

          const text: string =
            typeof body["text"] === "string" ? (body["text"] as string) : "";

          const summary: SecurityWatchlistImportSummary =
            await SecurityWatchlistItemService.importValues({
              watchlistId: new ObjectID(watchlistId),
              text,
              mode,
              props,
            });

          return Response.sendJsonObjectResponse(req, res, {
            added: summary.added,
            removed: summary.removed,
            unchanged: summary.unchanged,
            duplicates: summary.duplicates,
            problemCount: summary.problemCount,
            valueCount: summary.valueCount,
            problems: summary.problems.map(
              (problem: SecurityWatchlistImportProblem): JSONObject => {
                return {
                  line: problem.line,
                  value: problem.value,
                  message: problem.message,
                };
              },
            ),
          });
        } catch (error) {
          next(error);
        }
      },
    );
  }
}
