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
import User from "../../Models/DatabaseModels/User";
import UserService from "../Services/UserService";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import { JSONObject } from "../../Types/JSON";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import { Host, HttpProtocol } from "../EnvironmentConfig";

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

          const user: User | null = await UserService.findOneById({
            id: userId,
            select: {
              email: true,
              name: true,
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

          // Get existing credentials for this user
          const existingCredentials: Array<UserWebAuthn> =
            await UserWebAuthnService.findBy({
              query: {
                userId: userId,
              },
              select: {
                credentialId: true,
              },
              limit: LIMIT_PER_PROJECT,
              skip: 0,
              props: {
                isRoot: true,
              },
            });

          const options: any = await generateRegistrationOptions({
            rpName: "OneUptime",
            rpID: Host.toString(),
            userID: new Uint8Array(Buffer.from(userId.toString())),
            userName: user.email.toString(),
            userDisplayName: user.name
              ? user.name.toString()
              : user.email.toString(),
            attestationType: "none",
            excludeCredentials: existingCredentials.map(
              (cred: UserWebAuthn) => {
                return {
                  id: cred.credentialId!,
                  type: "public-key",
                };
              },
            ),
            authenticatorSelection: {
              residentKey: "discouraged",
              userVerification: "preferred",
            },
          });

          return Response.sendJsonObjectResponse(req, res, {
            options: options as any,
            challenge: options.challenge,
          });
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

          const expectedChallenge: string = data["challenge"] as string;
          const credential: any = data["credential"];
          const name: string = data["name"] as string;

          const expectedOrigin: string = `${HttpProtocol}${Host.toString()}`;

          const verification: any = await verifyRegistrationResponse({
            response: credential,
            expectedChallenge: expectedChallenge,
            expectedOrigin: expectedOrigin,
            expectedRPID: Host.toString(),
          });

          if (!verification.verified) {
            throw new BadDataException("Registration verification failed");
          }

          const { registrationInfo } = verification;

          if (!registrationInfo) {
            throw new BadDataException("Registration info not found");
          }

          // Save the credential
          await UserWebAuthnService.create({
            data: {
              name: name,
              credentialId: registrationInfo.credential.id,
              publicKey: Buffer.from(
                registrationInfo.credential.publicKey,
              ).toString("base64"),
              counter: "0",
              transports: JSON.stringify([]),
              isVerified: true,
            } as any,
            props: {
              isRoot: false,
            },
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

          const user: User | null = await UserService.findOneBy({
            query: { email: email },
            select: {
              _id: true,
            },
            props: {
              isRoot: true,
            },
          });

          if (!user) {
            throw new BadDataException("User not found");
          }

          // Get user's WebAuthn credentials
          const credentials: Array<UserWebAuthn> =
            await UserWebAuthnService.findBy({
              query: {
                userId: user.id!,
                isVerified: true,
              },
              select: {
                credentialId: true,
              },
              limit: LIMIT_PER_PROJECT,
              skip: 0,
              props: {
                isRoot: true,
              },
            });

          if (credentials.length === 0) {
            throw new BadDataException(
              "No WebAuthn credentials found for this user",
            );
          }

          const options: any = await generateAuthenticationOptions({
            rpID: Host.toString(),
            allowCredentials: credentials.map((cred: UserWebAuthn) => {
              return {
                id: cred.credentialId!,
                type: "public-key",
              };
            }),
            userVerification: "preferred",
          });

          return Response.sendJsonObjectResponse(req, res, {
            options: options as any,
            challenge: options.challenge,
            userId: user.id!.toString(),
          });
        } catch (err) {
          next(err);
        }
      },
    );

    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/verify-authentication`,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const data: JSONObject = req.body;
          const userId: string = data["userId"] as string;
          const expectedChallenge: string = data["challenge"] as string;
          const credential: any = data["credential"];

          const user: User | null = await UserService.findOneById({
            id: new ObjectID(userId),
            select: {
              _id: true,
              email: true,
            },
            props: {
              isRoot: true,
            },
          });

          if (!user) {
            throw new BadDataException("User not found");
          }

          // Get the credential from database
          const dbCredential: UserWebAuthn | null =
            await UserWebAuthnService.findOneBy({
              query: {
                credentialId: credential.id,
                userId: new ObjectID(userId),
                isVerified: true,
              },
              select: {
                credentialId: true,
                publicKey: true,
                counter: true,
              },
              props: {
                isRoot: true,
              },
            });

          if (!dbCredential) {
            throw new BadDataException("Credential not found");
          }

          const expectedOrigin: string = `${HttpProtocol}${Host.toString()}`;

          const verification: any = await verifyAuthenticationResponse({
            response: credential,
            expectedChallenge: expectedChallenge,
            expectedOrigin: expectedOrigin,
            expectedRPID: Host.toString(),
            credential: {
              id: dbCredential.credentialId!,
              publicKey: Buffer.from(dbCredential.publicKey!, "base64"),
              counter: parseInt(dbCredential.counter!),
            } as any,
          });

          if (!verification.verified) {
            throw new BadDataException("Authentication verification failed");
          }

          // Update counter
          await UserWebAuthnService.updateOneById({
            id: dbCredential.id!,
            data: {
              counter: verification.authenticationInfo.newCounter.toString(),
            },
            props: {
              isRoot: true,
            },
          });

          return Response.sendJsonObjectResponse(req, res, {
            user: user,
          });
        } catch (err) {
          next(err);
        }
      },
    );
  }
}
