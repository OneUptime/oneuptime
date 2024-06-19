import BadDataException from "Common/Types/Exception/BadDataException";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import CodeRepository from "Model/Models/CodeRepository";
import CodeRepositoryService from "../Services/CodeRepositoryService";
import ObjectID from "Common/Types/ObjectID";

export default class CodeRepositoryAuthorization {
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

      const codeRepository: CodeRepository | null =
        await CodeRepositoryService.findOneBy({
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

      if (!codeRepository) {
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
