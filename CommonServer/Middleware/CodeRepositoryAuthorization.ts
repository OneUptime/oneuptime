import BadDataException from "Common/Types/Exception/BadDataException";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import CopilotCodeRepository from "Common/Models/DatabaseModels/CopilotCodeRepository";
import CopilotCodeRepositoryService from "../Services/CopilotCodeRepositoryService";
import ObjectID from "Common/Types/ObjectID";

export default class CopilotCodeRepositoryAuthorization {
  public static async isAuthorizedRepository(
    req: ExpressRequest,
    _res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> {
    try {
      const secretkey: string = req.params["secretkey"]!;

      if (!secretkey) {
        throw new BadDataException("Secret key is required");
      }

      const CopilotCodeRepository: CopilotCodeRepository | null =
        await CopilotCodeRepositoryService.findOneBy({
          query: {
            secretToken: new ObjectID(secretkey),
          },
          select: {
            _id: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (!CopilotCodeRepository) {
        throw new BadDataException(
          "Code repository not found. Secret key is invalid.",
        );
      }

      next();
    } catch (err) {
      next(err);
    }
  }
}
