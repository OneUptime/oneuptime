import User from "../../Models/DatabaseModels/User";
import NotFoundException from "../../Types/Exception/NotFoundException";
import ObjectID from "../../Types/ObjectID";
import UserService, {
  Service as UserServiceType,
} from "../Services/UserService";
import {
  ExpressRequest,
  ExpressResponse,
} from "../Utils/Express";
import logger from "../Utils/Logger";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";

export default class UserAPI extends BaseAPI<User, UserServiceType> {
  public constructor() {
    super(User, UserService);

    this.router.get(
      `${new this.entityType().getCrudApiPath()?.toString()}/profile-picture/:userId`,
      async (req: ExpressRequest, res: ExpressResponse) => {
        const userIdParam: string | undefined = req.params["userId"];

        if (!userIdParam) {
          return Response.sendErrorResponse(
            req,
            res,
            new NotFoundException("User profile picture not found"),
          );
        }

        let userId: ObjectID;

        try {
          userId = new ObjectID(userIdParam);
        } catch (_error) {
          return Response.sendErrorResponse(
            req,
            res,
            new NotFoundException("User profile picture not found"),
          );
        }

        try {
          const profilePictureSelect = {
            profilePictureFile: {
              _id: true,
              file: true,
              fileType: true,
              name: true,
            },
          } as const;

          const userById: User | null = await UserService.findOneBy({
            query: {
              _id: userId,
            },
            select: profilePictureSelect,
            props: {
              isRoot: true,
            },
          });

          if (userById && userById.profilePictureFile) {
            return Response.sendFileResponse(
              req,
              res,
              userById.profilePictureFile,
            );
          }

          return Response.sendErrorResponse(
            req,
            res,
            new NotFoundException("User profile picture not found"),
          );
        } catch (error) {
          logger.error(error);
          return Response.sendErrorResponse(
            req,
            res,
            new NotFoundException("User profile picture not found"),
          );
        }
      },
    );
  }
}
