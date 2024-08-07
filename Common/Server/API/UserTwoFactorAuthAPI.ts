import ObjectID from "Common/Types/ObjectID";
import UserMiddleware from "../Middleware/UserAuthorization";
import UserTwoFactorAuthService, {
  Service as UserTwoFactorAuthServiceType,
} from "../Services/UserTwoFactorAuthService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../Utils/Express";
import BaseAPI from "./BaseAPI";
import UserTwoFactorAuth from "Common/Models/DatabaseModels/UserTwoFactorAuth";
import BadDataException from "Common/Types/Exception/BadDataException";
import TwoFactorAuth from "../Utils/TwoFactorAuth";
import Response from "../Utils/Response";
import User from "Common/Models/DatabaseModels/User";
import UserService from "../Services/UserService";

export default class UserTwoFactorAuthAPI extends BaseAPI<
  UserTwoFactorAuth,
  UserTwoFactorAuthServiceType
> {
  public constructor() {
    super(UserTwoFactorAuth, UserTwoFactorAuthService);

    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/validate`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const userTwoFactorAuth: UserTwoFactorAuth | null =
            await UserTwoFactorAuthService.findOneById({
              id: new ObjectID(req.body["id"]),
              select: {
                twoFactorSecret: true,
                userId: true,
              },
              props: {
                isRoot: true,
              },
            });

          if (!userTwoFactorAuth) {
            throw new BadDataException("Two factor auth not found");
          }

          if (
            userTwoFactorAuth.userId?.toString() !==
            (req as OneUptimeRequest).userAuthorization?.userId.toString()
          ) {
            throw new BadDataException("Two factor auth not found");
          }

          if (!userTwoFactorAuth.userId) {
            throw new BadDataException("User not found");
          }

          // get user email.
          const user: User | null = await UserService.findOneById({
            id: userTwoFactorAuth.userId!,
            select: {
              email: true,
            },
            props: {
              isRoot: true,
            },
          });

          if (!user) {
            throw new BadDataException("User not found");
          }

          if (!user.email) {
            throw new BadDataException("User email not found");
          }

          const isValid: boolean = TwoFactorAuth.verifyToken({
            secret: userTwoFactorAuth.twoFactorSecret || "",
            token: req.body["code"] || "",
            email: user.email!,
          });

          if (!isValid) {
            throw new BadDataException("Invalid code");
          }

          // update this 2fa code as verified

          await UserTwoFactorAuthService.updateOneById({
            id: userTwoFactorAuth.id!,
            data: {
              isVerified: true,
            },
            props: {
              isRoot: true,
            },
          });

          return Response.sendEmptySuccessResponse(req, res);
        } catch (err) {
          next(err);
        }
      },
    );
  }
}
