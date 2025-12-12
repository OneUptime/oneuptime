import UserMiddleware from "../Middleware/UserAuthorization";
import LlmProviderService, {
  Service as LlmProviderServiceType,
} from "../Services/LlmProviderService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import PositiveNumber from "../../Types/PositiveNumber";
import LlmProvider from "../../Models/DatabaseModels/LlmProvider";

export default class LlmProviderAPI extends BaseAPI<
  LlmProvider,
  LlmProviderServiceType
> {
  public constructor() {
    super(LlmProvider, LlmProviderService);

    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/global-llms`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const llmProviders: Array<LlmProvider> =
            await LlmProviderService.findBy({
              query: {
                isGlobalLlm: true,
                isEnabled: true,
              },
              select: {
                name: true,
                description: true,
                llmType: true,
                modelName: true,
                baseUrl: true,
                isEnabled: true,
              },
              props: {
                isRoot: true,
              },
              skip: 0,
              limit: LIMIT_MAX,
            });

          return Response.sendEntityArrayResponse(
            req,
            res,
            llmProviders,
            new PositiveNumber(llmProviders.length),
            LlmProvider,
          );
        } catch (err) {
          next(err);
        }
      },
    );
  }
}
