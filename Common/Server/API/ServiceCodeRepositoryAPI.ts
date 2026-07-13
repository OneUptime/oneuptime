import ServiceCodeRepository from "../../Models/DatabaseModels/ServiceCodeRepository";
import ServiceCodeRepositoryService, {
  Service as ServiceCodeRepositoryServiceType,
} from "../Services/ServiceCodeRepositoryService";
import { ServiceRepoLinkSuggestion } from "../Utils/CodeRepository/ServiceRepoLinkSuggester";
import UserMiddleware from "../Middleware/UserAuthorization";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONArray } from "../../Types/JSON";

export default class ServiceCodeRepositoryAPI extends BaseAPI<
  ServiceCodeRepository,
  ServiceCodeRepositoryServiceType
> {
  public constructor() {
    super(ServiceCodeRepository, ServiceCodeRepositoryService);

    /*
     * Deterministic service ↔ repository link suggestions (name matching).
     * Optional query params `serviceId` / `codeRepositoryId` filter the
     * result to one side, for embedding on the service or repository page.
     */
    this.router.get(
      `${new this.entityType().getCrudApiPath()?.toString()}/suggest-links`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.getSuggestedLinks(req, res);
        } catch (err) {
          next(err);
        }
      },
    );
  }

  private async getSuggestedLinks(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    let suggestions: Array<ServiceRepoLinkSuggestion> =
      await this.service.getSuggestedLinks(props);

    const serviceIdFilter: string | undefined = req.query["serviceId"] as
      | string
      | undefined;
    const codeRepositoryIdFilter: string | undefined = req.query[
      "codeRepositoryId"
    ] as string | undefined;

    if (serviceIdFilter) {
      suggestions = suggestions.filter(
        (suggestion: ServiceRepoLinkSuggestion) => {
          return suggestion.serviceId === serviceIdFilter;
        },
      );
    }

    if (codeRepositoryIdFilter) {
      suggestions = suggestions.filter(
        (suggestion: ServiceRepoLinkSuggestion) => {
          return suggestion.codeRepositoryId === codeRepositoryIdFilter;
        },
      );
    }

    return Response.sendJsonObjectResponse(req, res, {
      suggestions: suggestions as unknown as JSONArray,
    });
  }
}
