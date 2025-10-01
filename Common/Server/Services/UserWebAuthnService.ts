import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/UserWebAuthn";
import UserService from "./UserService";
import BadDataException from "../../Types/Exception/BadDataException";
import User from "../../Models/DatabaseModels/User";
import DeleteBy from "../Types/Database/DeleteBy";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import { Host, HttpProtocol } from "../EnvironmentConfig";
import ObjectID from "../../Types/ObjectID";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import UserTotpAuth from "../../Models/DatabaseModels/UserTotpAuth";
import UserTotpAuthService from "./UserTotpAuthService";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  public async generateRegistrationOptions(data: {
    userId: ObjectID;
  }): Promise<{ options: any; challenge: string }> {
    const user: User | null = await UserService.findOneById({
      id: data.userId,
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
    const existingCredentials: Array<Model> = await this.findBy({
      query: {
        userId: data.userId,
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
      userID: new Uint8Array(Buffer.from(data.userId.toString())),
      userName: user.email.toString(),
      userDisplayName: user.name ? user.name.toString() : user.email.toString(),
      attestationType: "none",
      excludeCredentials: existingCredentials
        .filter((cred: Model) => {
          return cred.credentialId;
        })
        .map((cred: Model) => {
          return {
            id: cred.credentialId!,
            type: "public-key",
          };
        }),
      authenticatorSelection: {
        residentKey: "discouraged",
        userVerification: "preferred",
      },
    });

    // Convert to JSON serializable format
    options.challenge = Buffer.from(options.challenge).toString("base64url");
    if (options.excludeCredentials) {
      options.excludeCredentials = options.excludeCredentials.map(
        (cred: any) => {
          return {
            ...cred,
            id:
              typeof cred.id === "string"
                ? cred.id
                : Buffer.from(cred.id).toString("base64url"),
          };
        },
      );
    }

    return {
      options: options as any,
      challenge: options.challenge,
    };
  }

  @CaptureSpan()
  public async verifyRegistration(data: {
    challenge: string;
    credential: any;
    name: string;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const expectedOrigin: string = `${HttpProtocol}${Host.toString()}`;

    const verification: any = await verifyRegistrationResponse({
      response: data.credential,
      expectedChallenge: data.challenge,
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

    if (!data.props.userId) {
      throw new BadDataException("User ID not found in request");
    }

    // Save the credential
    const userWebAuthn: Model = Model.fromJSON(
      {
        name: data.name,
        credentialId: registrationInfo.credential.id,
        publicKey: Buffer.from(registrationInfo.credential.publicKey).toString(
          "base64",
        ),
        counter: "0",
        transports: JSON.stringify([]),
        isVerified: true,
        userId: data.props.userId,
      },
      Model,
    ) as Model;

    await this.create({
      data: userWebAuthn,
      props: data.props,
    });
  }

  @CaptureSpan()
  public async generateAuthenticationOptions(data: {
    email: string;
  }): Promise<{ options: any; challenge: string; userId: string }> {
    const user: User | null = await UserService.findOneBy({
      query: { email: data.email },
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
    const credentials: Array<Model> = await this.findBy({
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
      throw new BadDataException("No WebAuthn credentials found for this user");
    }

    const options: any = await generateAuthenticationOptions({
      rpID: Host.toString(),
      allowCredentials: credentials.map((cred: Model) => {
        return {
          id: cred.credentialId!,
          type: "public-key",
        };
      }),
      userVerification: "preferred",
    });

    // Convert to JSON serializable format
    options.challenge = Buffer.from(options.challenge).toString("base64url");
    // allowCredentials id is already base64url string

    return {
      options: options as any,
      challenge: options.challenge,
      userId: user.id!.toString(),
    };
  }

  @CaptureSpan()
  public async verifyAuthentication(data: {
    userId: string;
    challenge: string;
    credential: any;
  }): Promise<User> {
    const user: User | null = await UserService.findOneById({
      id: new ObjectID(data.userId),
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
    const dbCredential: Model | null = await this.findOneBy({
      query: {
        credentialId: data.credential.id,
        userId: new ObjectID(data.userId),
        isVerified: true,
      },
      select: {
        credentialId: true,
        publicKey: true,
        counter: true,
        _id: true,
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
      response: data.credential,
      expectedChallenge: data.challenge,
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
    await this.updateOneById({
      id: dbCredential.id!,
      data: {
        counter: verification.authenticationInfo.newCounter.toString(),
      },
      props: {
        isRoot: true,
      },
    });

    return user;
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (!createBy.props.userId) {
      throw new BadDataException("User id is required");
    }

    createBy.data.userId = createBy.props.userId;

    const user: User | null = await UserService.findOneById({
      id: createBy.data.userId,
      props: {
        isRoot: true,
      },
      select: {
        email: true,
      },
    });

    if (!user) {
      throw new BadDataException("User not found");
    }

    if (!user.email) {
      throw new BadDataException("User email is required");
    }

    // by default secuirty keys are always verified. You can't add an unverified security key.

    createBy.data.isVerified = true;

    return {
      createBy: createBy,
      carryForward: {},
    };
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    const itemsToBeDeleted: Array<Model> = await this.findBy({
      query: deleteBy.query,
      select: {
        userId: true,
        _id: true,
        isVerified: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: deleteBy.props,
    });

    for (const item of itemsToBeDeleted) {
      if (item.isVerified) {
        // check if user two auth is enabled.

        const user: User | null = await UserService.findOneById({
          id: item.userId!,
          props: {
            isRoot: true,
          },
          select: {
            enableTwoFactorAuth: true,
          },
        });

        if (!user) {
          throw new BadDataException("User not found");
        }

        if (user.enableTwoFactorAuth) {
          // if enabled then check if this is the only verified 2FA method for this user.

          const verifiedWebAuthnItems: Array<Model> = await this.findBy({
            query: {
              userId: item.userId!,
              isVerified: true,
            },
            select: {
              _id: true,
            },
            limit: LIMIT_MAX,
            skip: 0,
            props: deleteBy.props,
          });

          const verifiedTotpItems: Array<UserTotpAuth> =
            await UserTotpAuthService.findBy({
              query: {
                userId: item.userId!,
                isVerified: true,
              },
              select: {
                _id: true,
              },
              limit: LIMIT_MAX,
              skip: 0,
              props: deleteBy.props,
            });

          const totalVerified2FA: number =
            verifiedWebAuthnItems.length + verifiedTotpItems.length;

          if (totalVerified2FA === 1) {
            throw new BadDataException(
              "You must have atleast one verified two factor auth. Please disable two factor auth before deleting this item.",
            );
          }
        }
      }
    }

    return {
      deleteBy: deleteBy,
      carryForward: {},
    };
  }
}

export default new Service();
