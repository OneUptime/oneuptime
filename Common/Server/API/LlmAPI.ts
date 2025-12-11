import UserMiddleware from "../Middleware/UserAuthorization";
import LlmService, {
  Service as LlmServiceType,
} from "../Services/LlmService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import PositiveNumber from "../../Types/PositiveNumber";
import Llm from "../../Models/DatabaseModels/Llm";

export default class LlmAPI extends BaseAPI<Llm, LlmServiceType> {
  public constructor() {
    super(Llm, LlmService);

    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/global-llms`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const llms: Array<Llm> = await LlmService.findBy({
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
            llms,
            new PositiveNumber(llms.length),
            Llm,
          );
        } catch (err) {
          next(err);
        }
      },
    );
  }
}
