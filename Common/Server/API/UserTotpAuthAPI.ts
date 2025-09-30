import ObjectID from "../../Types/ObjectID";
import UserMiddleware from "../Middleware/UserAuthorization";
import UserTotpAuthService, {
  Service as UserTotpAuthServiceType,
} from "../Services/UserTotpAuthService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../Utils/Express";
import BaseAPI from "./BaseAPI";
import UserTotpAuth from "../../Models/DatabaseModels/UserTotpAuth";
import BadDataException from "../../Types/Exception/BadDataException";
import TwoFactorAuth from "../Utils/TwoFactorAuth";
import Response from "../Utils/Response";
import User from "../../Models/DatabaseModels/User";
import UserService from "../Services/UserService";

export default class UserTotpAuthAPI extends BaseAPI<
  UserTotpAuth,
  UserTotpAuthServiceType
> {
  public constructor() {
    super(UserTotpAuth, UserTotpAuthService);

    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/validate`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const userTotpAuth: UserTotpAuth | null =
            await UserTotpAuthService.findOneById({
              id: new ObjectID(req.body["id"]),
              select: {
                twoFactorSecret: true,
                userId: true,
              },
              props: {
                isRoot: true,
              },
            });

          if (!userTotpAuth) {
            throw new BadDataException("TOTP auth not found");
          }

          if (
            userTotpAuth.userId?.toString() !==
            (req as OneUptimeRequest).userAuthorization?.userId.toString()
          ) {
            throw new BadDataException("Two factor auth not found");
          }

          if (!userTotpAuth.userId) {
            throw new BadDataException("User not found");
          }

          // get user email.
          const user: User | null = await UserService.findOneById({
            id: userTotpAuth.userId!,
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
            secret: userTotpAuth.twoFactorSecret || "",
            token: req.body["code"] || "",
            email: user.email!,
          });

          if (!isValid) {
            throw new BadDataException("Invalid code");
          }

          // update this 2fa code as verified

          await UserTotpAuthService.updateOneById({
            id: userTotpAuth.id!,
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
