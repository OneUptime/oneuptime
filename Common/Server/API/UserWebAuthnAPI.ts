import ObjectID from "../../Types/ObjectID";
import UserMiddleware from "../Middleware/UserAuthorization";
import UserWebAuthnService, {
  Service as UserWebAuthnServiceType,
} from "../Services/UserWebAuthnService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../Utils/Express";
import BaseAPI from "./BaseAPI";
import UserWebAuthn from "../../Models/DatabaseModels/UserWebAuthn";
import BadDataException from "../../Types/Exception/BadDataException";
import Response from "../Utils/Response";
import { JSONObject } from "../../Types/JSON";
import CommonAPI from "./CommonAPI";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";

export default class UserWebAuthnAPI extends BaseAPI<
  UserWebAuthn,
  UserWebAuthnServiceType
> {
  public constructor() {
    super(UserWebAuthn, UserWebAuthnService);

    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/generate-registration-options`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const userId: ObjectID = (req as OneUptimeRequest).userAuthorization!
            .userId;

          const result: { options: any; challenge: string } =
            await UserWebAuthnService.generateRegistrationOptions({
              userId: userId,
            });

          return Response.sendJsonObjectResponse(req, res, result);
        } catch (err) {
          next(err);
        }
      },
    );

    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/verify-registration`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const data: JSONObject = req.body;

          const databaseProps: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          const expectedChallenge: string = data["challenge"] as string;
          const credential: any = data["credential"];
          const name: string = data["name"] as string;

          await UserWebAuthnService.verifyRegistration({
            challenge: expectedChallenge,
            credential: credential,
            name: name,
            props: databaseProps,
          });

          return Response.sendEmptySuccessResponse(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/generate-authentication-options`,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const email: string = req.body["email"] as string;

          if (!email) {
            throw new BadDataException("Email is required");
          }

          const result: { options: any; challenge: string; userId: string } =
            await UserWebAuthnService.generateAuthenticationOptions({
              email: email,
            });

          return Response.sendJsonObjectResponse(req, res, result);
        } catch (err) {
          next(err);
        }
      },
    );
  }
}
