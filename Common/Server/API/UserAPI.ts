import path from "path";
import User from "../../Models/DatabaseModels/User";
import NotFoundException from "../../Types/Exception/NotFoundException";
import ObjectID from "../../Types/ObjectID";
import UserService, {
  Service as UserServiceType,
} from "../Services/UserService";
import { ExpressRequest, ExpressResponse } from "../Utils/Express";
import logger from "../Utils/Logger";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";

const BLANK_PROFILE_PICTURE_PATH: string = path.resolve(
  process.cwd(),
  "..",
  "Common",
  "UI",
  "Images",
  "users",
  "blank-profile.svg",
);

export default class UserAPI extends BaseAPI<User, UserServiceType> {
  public constructor() {
    super(User, UserService);

    this.router.get(
      `${new this.entityType().getCrudApiPath()?.toString()}/profile-picture/:userId`,
      async (req: ExpressRequest, res: ExpressResponse) => {
        const userIdParam: string | undefined = req.params["userId"];

        if (!userIdParam) {
          return this.sendBlankProfile(req, res);
        }

        let userId: ObjectID;

        try {
          userId = new ObjectID(userIdParam);
        } catch {
          return this.sendBlankProfile(req, res);
        }

        try {
          const profilePictureSelect: {
            profilePictureFile: {
              _id: boolean;
              file: boolean;
              fileType: boolean;
              name: boolean;
            };
          } = {
            profilePictureFile: {
              _id: true,
              file: true,
              fileType: true,
              name: true,
            },
          };

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
            this.setNoCacheHeaders(res);
            return Response.sendFileResponse(
              req,
              res,
              userById.profilePictureFile,
            );
          }

          return this.sendBlankProfile(req, res);
        } catch (error) {
          logger.error(error);
          return this.sendBlankProfile(req, res);
        }
      },
    );
  }

  private setNoCacheHeaders(res: ExpressResponse): void {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }

  private sendBlankProfile(req: ExpressRequest, res: ExpressResponse): void {
    this.setNoCacheHeaders(res);

    try {
      Response.sendFileByPath(req, res, BLANK_PROFILE_PICTURE_PATH);
    } catch (error) {
      logger.error(error);
      Response.sendErrorResponse(
        req,
        res,
        new NotFoundException("User profile picture not found"),
      );
    }
  }
}
