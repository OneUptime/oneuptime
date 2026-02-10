import AuthenticationEmail from "../Utils/AuthenticationEmail";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { AccountsRoute } from "Common/ServiceRoute";
import Hostname from "Common/Types/API/Hostname";
import Protocol from "Common/Types/API/Protocol";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import Email from "Common/Types/Email";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import BadDataException from "Common/Types/Exception/BadDataException";
import BadRequestException from "Common/Types/Exception/BadRequestException";
import { JSONObject } from "Common/Types/JSON";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import {
  AppVersion,
  EncryptionSecret,
  IsBillingEnabled,
} from "Common/Server/EnvironmentConfig";
import API from "Common/Utils/API";
import AccessTokenService from "Common/Server/Services/AccessTokenService";
import EmailVerificationTokenService from "Common/Server/Services/EmailVerificationTokenService";
import MailService from "Common/Server/Services/MailService";
import UserService from "Common/Server/Services/UserService";
import UserTotpAuthService from "Common/Server/Services/UserTotpAuthService";
import UserSessionService, {
  SessionMetadata,
} from "Common/Server/Services/UserSessionService";
import CookieUtil from "Common/Server/Utils/Cookie";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
  extractDeviceInfo,
  getClientIp,
  headerValueToString,
} from "Common/Server/Utils/Express";
import CaptchaUtil from "Common/Server/Utils/Captcha";
import logger from "Common/Server/Utils/Logger";
import Response from "Common/Server/Utils/Response";
import TotpAuth from "Common/Server/Utils/TotpAuth";
import EmailVerificationToken from "Common/Models/DatabaseModels/EmailVerificationToken";
import User from "Common/Models/DatabaseModels/User";
import UserSession from "Common/Models/DatabaseModels/UserSession";
import UserTotpAuth from "Common/Models/DatabaseModels/UserTotpAuth";
import UserWebAuthn from "Common/Models/DatabaseModels/UserWebAuthn";
import UserWebAuthnService from "Common/Server/Services/UserWebAuthnService";
import NotAuthenticatedException from "Common/Types/Exception/NotAuthenticatedException";

const router: ExpressRouter = Express.getRouter();

const ACCESS_TOKEN_EXPIRY_SECONDS: number = 15 * 60;

type FinalizeUserLoginInput = {
  req: ExpressRequest;
  res: ExpressResponse;
  user: User;
  isGlobalLogin: boolean;
};

const finalizeUserLogin: (
  data: FinalizeUserLoginInput,
) => Promise<SessionMetadata> = async (
  data: FinalizeUserLoginInput,
): Promise<SessionMetadata> => {
  const { req, res, user, isGlobalLogin } = data;

  const sessionMetadata: SessionMetadata =
    await UserSessionService.createSession({
      userId: user.id!,
      isGlobalLogin,
      ipAddress: getClientIp(req),
      userAgent: headerValueToString(req.headers["user-agent"]),
      ...extractDeviceInfo(req),
    });

  CookieUtil.setUserCookie({
    expressResponse: res,
    user,
    isGlobalLogin,
    sessionId: sessionMetadata.session.id!,
    refreshToken: sessionMetadata.refreshToken,
    refreshTokenExpiresAt: sessionMetadata.refreshTokenExpiresAt,
    accessTokenExpiresInSeconds: ACCESS_TOKEN_EXPIRY_SECONDS,
  });

  return sessionMetadata;
};

router.post(
  "/signup",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (await DatabaseConfig.shouldDisableSignup()) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadRequestException(
            "Sign up is disabled on this OneUptime Server. Please contact your server admin to enable it.",
          ),
        );
      }

      const miscDataProps: JSONObject =
        (req.body["miscDataProps"] as JSONObject) || {};

      await CaptchaUtil.verifyCaptcha({
        token:
          (miscDataProps["captchaToken"] as string | undefined) ||
          (req.body["captchaToken"] as string | undefined),
        remoteIp: getClientIp(req) || null,
      });

      const data: JSONObject = req.body["data"];

      /* Creating a type that is a partial of the TBaseModel type. */
      const partialUser: User = BaseModel.fromJSON(
        data as JSONObject,
        User,
      ) as User;

      if (IsBillingEnabled) {
        //ALERT: Delete data.role so user don't accidently sign up as master-admin from the API.
        partialUser.isMasterAdmin = false;
        partialUser.isEmailVerified = false;
      } else {
        // IF its not a saas service then we will make the email verified.

        // check if there are more than one user and if there is then we will not make the user master admin.

        const userCount: PositiveNumber = await UserService.countBy({
          props: {
            isRoot: true,
          },
          query: {},
        });

        partialUser.isMasterAdmin = userCount.isZero(); // if the user count is 0 then make the first user master admin.
        partialUser.isEmailVerified = true;
      }

      const alreadySavedUser: User | null = await UserService.findOneBy({
        query: { email: partialUser.email as Email },
        select: {
          _id: true,
          password: true,
          timezone: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (alreadySavedUser && alreadySavedUser.password) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException(
            `User with email ${partialUser.email} already exists.`,
          ),
        );
      }

      let savedUser: User | null = null;

      if (alreadySavedUser) {
        savedUser = await UserService.updateOneByIdAndFetch({
          id: alreadySavedUser.id!,
          data: {
            password: partialUser.password!,
            name: partialUser.name!,
            companyPhoneNumber: partialUser.companyPhoneNumber!,
            companyName: partialUser.companyName!,
          },
          select: {
            email: true,
            _id: true,
            name: true,
            isMasterAdmin: true,
            timezone: true,
          },
          props: {
            isRoot: true,
          },
        });
      } else {
        const user: User = partialUser;

        savedUser = await UserService.create({
          data: user,
          props: {
            isRoot: true,
          },
        });
      }

      const generatedToken: ObjectID = ObjectID.generate();

      const emailVerificationToken: EmailVerificationToken =
        new EmailVerificationToken();
      emailVerificationToken.userId = savedUser?.id as ObjectID;
      emailVerificationToken.email = savedUser?.email as Email;
      emailVerificationToken.token = generatedToken;
      emailVerificationToken.expires = OneUptimeDate.getOneDayAfter();

      await EmailVerificationTokenService.create({
        data: emailVerificationToken,
        props: {
          isRoot: true,
        },
      });

      const host: Hostname = await DatabaseConfig.getHost();
      const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

      MailService.sendMail({
        toEmail: partialUser.email as Email,
        subject: "Welcome to OneUptime. Please verify your email.",
        templateType: EmailTemplateType.SignupWelcomeEmail,
        vars: {
          name: (partialUser.name! as Name).toString(),
          tokenVerifyUrl: new URL(
            httpProtocol,
            host,
            new Route(AccountsRoute.toString()).addRoute(
              "/verify-email/" + generatedToken.toString(),
            ),
          ).toString(),
          homeUrl: new URL(httpProtocol, host).toString(),
        },
      }).catch((err: Error) => {
        logger.error(err);
      });

      if (savedUser) {
        // Refresh Permissions for this user here.
        await AccessTokenService.refreshUserAllPermissions(savedUser.id!);
        await finalizeUserLogin({
          req,
          res,
          user: savedUser,
          isGlobalLogin: true,
        });

        logger.info("User signed up: " + savedUser.email?.toString());

        if (!IsBillingEnabled && miscDataProps["notifySelfHosted"] === true) {
          const instanceUrl: string = new URL(
            httpProtocol,
            host,
          ).toString();

          API.post({
            url: URL.fromString(
              "https://oneuptime.com/api/open-source-deployment/register",
            ),
            data: {
              email: savedUser.email?.toString() || "",
              name: savedUser.name?.toString() || "",
              companyName:
                (miscDataProps["selfHostedCompanyName"] as string) ||
                undefined,
              companyPhoneNumber:
                (miscDataProps["selfHostedPhoneNumber"] as string) ||
                undefined,
              version: AppVersion,
              instanceUrl: instanceUrl,
            },
          }).catch((err: Error) => {
            logger.error(err);
          });
        }

        return Response.sendEntityResponse(req, res, savedUser, User);
      }

      return Response.sendErrorResponse(
        req,
        res,
        new BadRequestException("Failed to create a user"),
      );
    } catch (err) {
      return next(err);
    }
  },
);

router.post(
  "/forgot-password",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const data: JSONObject = req.body["data"];

      const user: User = BaseModel.fromJSON(data as JSONObject, User) as User;

      const alreadySavedUser: User | null = await UserService.findOneBy({
        query: { email: user.email! },
        select: {
          _id: true,
          password: true,
          name: true,
          email: true,
          isMasterAdmin: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (alreadySavedUser && alreadySavedUser.password) {
        const token: string = ObjectID.generate().toString();
        await UserService.updateOneBy({
          query: {
            _id: alreadySavedUser._id!,
          },
          data: {
            resetPasswordToken: token,
            resetPasswordExpires: OneUptimeDate.getOneDayAfter(),
          },
          props: {
            isRoot: true,
          },
        });

        const host: Hostname = await DatabaseConfig.getHost();
        const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

        const tokenVerifyUrl: string = new URL(
          httpProtocol,
          host,
          new Route(AccountsRoute.toString()).addRoute(
            "/reset-password/" + token,
          ),
        ).toString();

        logger.info("User forgot password: " + user.email?.toString());
        logger.info("Reset Password URL: " + tokenVerifyUrl);

        MailService.sendMail({
          toEmail: user.email!,
          subject: "Password Reset Request for OneUptime",
          templateType: EmailTemplateType.ForgotPassword,
          vars: {
            homeURL: new URL(httpProtocol, host).toString(),
            tokenVerifyUrl: tokenVerifyUrl,
          },
        }).catch((err: Error) => {
          logger.error(err);
        });

        return Response.sendEmptySuccessResponse(req, res);
      }

      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException(
          `No user is registered with ${user.email?.toString()}. Please sign up for a new account.`,
        ),
      );
    } catch (err) {
      return next(err);
    }
  },
);

router.post(
  "/verify-email",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const data: JSONObject = req.body["data"];

      const token: EmailVerificationToken = BaseModel.fromJSON(
        data as JSONObject,
        EmailVerificationToken,
      ) as EmailVerificationToken;

      const alreadySavedToken: EmailVerificationToken | null =
        await EmailVerificationTokenService.findOneBy({
          query: { token: token.token! },
          select: {
            _id: true,
            userId: true,
            email: true,
            expires: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (!alreadySavedToken) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException(
            "Invalid link. Please try to log in and we will resend you another link which you should be able to verify email with.",
          ),
        );
      }

      if (OneUptimeDate.hasExpired(alreadySavedToken.expires!)) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException(
            "Link expired. Please try to log in and we will resend you another link which you should be able to verify email with.",
          ),
        );
      }

      const user: User | null = await UserService.findOneBy({
        query: {
          email: alreadySavedToken.email!,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          email: true,
        },
      });

      if (!user) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException(
            "Invalid link. Please try to log in and we will resend you another link which you should be able to verify email with.",
          ),
        );
      }

      await UserService.updateOneBy({
        query: {
          _id: user._id!,
        },
        data: {
          isEmailVerified: true,
        },
        props: {
          isRoot: true,
        },
      });

      const host: Hostname = await DatabaseConfig.getHost();
      const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

      MailService.sendMail({
        toEmail: user.email!,
        subject: "Email Verified.",
        templateType: EmailTemplateType.EmailVerified,
        vars: {
          homeURL: new URL(httpProtocol, host).toString(),
        },
      }).catch((err: Error) => {
        logger.error(err);
      });

      logger.info("User email verified: " + user.email?.toString());

      return Response.sendEmptySuccessResponse(req, res);
    } catch (err) {
      return next(err);
    }
  },
);

router.post(
  "/reset-password",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const data: JSONObject = req.body["data"];

      const user: User = BaseModel.fromJSON(data as JSONObject, User) as User;

      await user.password?.hashValue(EncryptionSecret);

      const alreadySavedUser: User | null = await UserService.findOneBy({
        query: {
          resetPasswordToken: (user.resetPasswordToken as string) || "",
        },
        select: {
          _id: true,
          password: true,
          name: true,
          email: true,
          isMasterAdmin: true,
          resetPasswordExpires: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (!alreadySavedUser) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException(
            "Invalid link. Please go to forgot password page again and request a new link.",
          ),
        );
      }

      if (
        alreadySavedUser &&
        OneUptimeDate.hasExpired(alreadySavedUser.resetPasswordExpires!)
      ) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException(
            "Expired link. Please go to forgot password page again and request a new link.",
          ),
        );
      }

      await UserService.updateOneById({
        id: alreadySavedUser.id!,
        data: {
          password: user.password!,
          resetPasswordToken: null!,
          resetPasswordExpires: null!,
        },
        props: {
          isRoot: true,
        },
      });

      const host: Hostname = await DatabaseConfig.getHost();
      const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

      MailService.sendMail({
        toEmail: alreadySavedUser.email!,
        subject: "Password Changed.",
        templateType: EmailTemplateType.PasswordChanged,
        vars: {
          homeURL: new URL(httpProtocol, host).toString(),
        },
      }).catch((err: Error) => {
        logger.error(err);
      });

      logger.info("User password reset: " + alreadySavedUser.email?.toString());

      return Response.sendEmptySuccessResponse(req, res);
    } catch (err) {
      return next(err);
    }
  },
);

router.post(
  "/refresh-token",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const refreshToken: string | undefined =
        CookieUtil.getRefreshTokenFromExpressRequest(req);

      if (!refreshToken) {
        CookieUtil.removeAllCookies(req, res);
        return Response.sendErrorResponse(
          req,
          res,
          new NotAuthenticatedException(
            "Refresh token missing. Please login again.",
          ),
        );
      }

      const session: UserSession | null =
        await UserSessionService.findActiveSessionByRefreshToken(refreshToken);

      if (!session || !session.id) {
        CookieUtil.removeAllCookies(req, res);
        return Response.sendErrorResponse(
          req,
          res,
          new NotAuthenticatedException("Session expired. Please login again."),
        );
      }

      if (
        session.refreshTokenExpiresAt &&
        OneUptimeDate.hasExpired(session.refreshTokenExpiresAt)
      ) {
        await UserSessionService.revokeSessionById(session.id, {
          reason: "Refresh token expired",
        });
        CookieUtil.removeAllCookies(req, res);
        return Response.sendErrorResponse(
          req,
          res,
          new NotAuthenticatedException("Session expired. Please login again."),
        );
      }

      if (!session.userId) {
        await UserSessionService.revokeSessionById(session.id, {
          reason: "Session missing user",
        });
        CookieUtil.removeAllCookies(req, res);
        return Response.sendErrorResponse(
          req,
          res,
          new NotAuthenticatedException("Session expired. Please login again."),
        );
      }

      const user: User | null = await UserService.findOneById({
        id: session.userId,
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          email: true,
          name: true,
          isMasterAdmin: true,
          profilePictureId: true,
          timezone: true,
          enableTwoFactorAuth: true,
        },
      });

      if (!user) {
        await UserSessionService.revokeSessionById(session.id, {
          reason: "User not found",
        });
        CookieUtil.removeAllCookies(req, res);
        return Response.sendErrorResponse(
          req,
          res,
          new NotAuthenticatedException("Account no longer exists."),
        );
      }

      const additionalInfo: JSONObject = (session.additionalInfo ||
        {}) as JSONObject;
      const isGlobalLogin: boolean =
        typeof additionalInfo["isGlobalLogin"] === "boolean"
          ? (additionalInfo["isGlobalLogin"] as boolean)
          : true;

      const renewedSession: SessionMetadata =
        await UserSessionService.renewSessionWithNewRefreshToken({
          session,
          ipAddress: getClientIp(req),
          userAgent: headerValueToString(req.headers["user-agent"]),
          ...extractDeviceInfo(req),
        });

      CookieUtil.setUserCookie({
        expressResponse: res,
        user,
        isGlobalLogin,
        sessionId: renewedSession.session.id!,
        refreshToken: renewedSession.refreshToken,
        refreshTokenExpiresAt: renewedSession.refreshTokenExpiresAt,
        accessTokenExpiresInSeconds: ACCESS_TOKEN_EXPIRY_SECONDS,
      });

      return Response.sendEmptySuccessResponse(req, res);
    } catch (err) {
      return next(err);
    }
  },
);

router.post(
  "/logout",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const refreshToken: string | undefined =
        CookieUtil.getRefreshTokenFromExpressRequest(req);

      if (refreshToken) {
        await UserSessionService.revokeSessionByRefreshToken(refreshToken, {
          reason: "User logout",
        });
      }

      CookieUtil.removeAllCookies(req, res);

      return Response.sendEmptySuccessResponse(req, res);
    } catch (err) {
      return next(err);
    }
  },
);

router.post(
  "/verify-totp-auth",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    return login({
      req: req,
      res: res,
      next: next,
      verifyTotpAuth: true,
      verifyWebAuthn: false,
    });
  },
);

router.post(
  "/verify-webauthn-auth",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    return login({
      req: req,
      res: res,
      next: next,
      verifyTotpAuth: false,
      verifyWebAuthn: true,
    });
  },
);

router.post(
  "/login",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    return login({
      req: req,
      res: res,
      next: next,
      verifyTotpAuth: false,
      verifyWebAuthn: false,
    });
  },
);

type FetchTotpAuthListFunction = (userId: ObjectID) => Promise<{
  totpAuthList: Array<UserTotpAuth>;
  webAuthnList: Array<UserWebAuthn>;
}>;

const fetchTotpAuthList: FetchTotpAuthListFunction = async (
  userId: ObjectID,
): Promise<{
  totpAuthList: Array<UserTotpAuth>;
  webAuthnList: Array<UserWebAuthn>;
}> => {
  const totpAuthList: Array<UserTotpAuth> = await UserTotpAuthService.findBy({
    query: {
      userId: userId,
      isVerified: true,
    },
    select: {
      _id: true,
      userId: true,
      name: true,
    },
    limit: LIMIT_PER_PROJECT,
    skip: 0,
    props: {
      isRoot: true,
    },
  });

  const webAuthnList: Array<UserWebAuthn> = await UserWebAuthnService.findBy({
    query: {
      userId: userId,
      isVerified: true,
    },
    select: {
      _id: true,
      userId: true,
      name: true,
    },
    limit: LIMIT_PER_PROJECT,
    skip: 0,
    props: {
      isRoot: true,
    },
  });

  return {
    totpAuthList: totpAuthList || [],
    webAuthnList: webAuthnList || [],
  };
};

type LoginFunction = (options: {
  req: ExpressRequest;
  res: ExpressResponse;
  next: NextFunction;
  verifyTotpAuth: boolean;
  verifyWebAuthn: boolean;
}) => Promise<void>;

const login: LoginFunction = async (options: {
  req: ExpressRequest;
  res: ExpressResponse;
  next: NextFunction;
  verifyTotpAuth: boolean;
  verifyWebAuthn: boolean;
}): Promise<void> => {
  const req: ExpressRequest = options.req;
  const res: ExpressResponse = options.res;
  const next: NextFunction = options.next;
  const verifyTotpAuth: boolean = options.verifyTotpAuth;
  const verifyWebAuthn: boolean = options.verifyWebAuthn;

  try {
    const miscDataProps: JSONObject =
      (req.body["miscDataProps"] as JSONObject) || {};

    if (!verifyTotpAuth && !verifyWebAuthn) {
      await CaptchaUtil.verifyCaptcha({
        token:
          (miscDataProps["captchaToken"] as string | undefined) ||
          (req.body["captchaToken"] as string | undefined),
        remoteIp: getClientIp(req) || null,
      });
    }

    const data: JSONObject = req.body["data"];

    logger.debug("Login request data: " + JSON.stringify(req.body, null, 2));

    const user: User = BaseModel.fromJSON(data as JSONObject, User) as User;

    if (!user.email || !user.password) {
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException("Email and password are required."),
      );
    }

    await user.password?.hashValue(EncryptionSecret);

    const alreadySavedUser: User | null = await UserService.findOneBy({
      query: { email: user.email! },
      select: {
        _id: true,
        password: true,
        name: true,
        email: true,
        isMasterAdmin: true,
        isEmailVerified: true,
        profilePictureId: true,
        timezone: true,
        enableTwoFactorAuth: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (alreadySavedUser) {
      if (!alreadySavedUser.password) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException(
            "You have not signed up so far. Please go to the registration page to sign up.",
          ),
        );
      }

      if (!alreadySavedUser.isEmailVerified) {
        await AuthenticationEmail.sendVerificationEmail(alreadySavedUser);

        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException(
            "Email is not verified. We have sent you an email with the verification link. Please do not forget to check spam.",
          ),
        );
      }

      if (alreadySavedUser.password.toString() !== user.password!.toString()) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException(
            "Invalid login: Email or password does not match.",
          ),
        );
      }

      if (
        alreadySavedUser.enableTwoFactorAuth &&
        !verifyTotpAuth &&
        !verifyWebAuthn
      ) {
        // If two factor auth is enabled then we will send the user to the two factor auth page.

        const { totpAuthList, webAuthnList } = await fetchTotpAuthList(
          alreadySavedUser.id!,
        );

        if (
          (!totpAuthList || totpAuthList.length === 0) &&
          (!webAuthnList || webAuthnList.length === 0)
        ) {
          const errorMessage: string = IsBillingEnabled
            ? "Two Factor Authentication is enabled but no two factor auth is setup. Please contact OneUptime support for help."
            : "Two Factor Authentication is enabled but no two factor auth is setup. Please contact your server admin to disable two factor auth for this account.";

          return Response.sendErrorResponse(
            req,
            res,
            new BadDataException(errorMessage),
          );
        }

        return Response.sendEntityResponse(req, res, alreadySavedUser, User, {
          miscData: {
            totpAuthList: UserTotpAuth.toJSONArray(totpAuthList, UserTotpAuth),
            webAuthnList: UserWebAuthn.toJSONArray(webAuthnList, UserWebAuthn),
          },
        });
      }

      if (verifyTotpAuth || verifyWebAuthn) {
        if (verifyTotpAuth) {
          // code from req
          const code: string = data["code"] as string;
          const twoFactorAuthId: string = data["twoFactorAuthId"] as string;

          const totpAuth: UserTotpAuth | null =
            await UserTotpAuthService.findOneBy({
              query: {
                _id: twoFactorAuthId,
                userId: alreadySavedUser.id!,
                isVerified: true,
              },
              select: {
                _id: true,
                twoFactorSecret: true,
              },
              props: {
                isRoot: true,
              },
            });

          if (!totpAuth) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Invalid two factor auth id."),
            );
          }

          const isVerified: boolean = TotpAuth.verifyToken({
            token: code,
            secret: totpAuth.twoFactorSecret!,
            email: alreadySavedUser.email!,
          });

          if (!isVerified) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Invalid code."),
            );
          }
        } else if (verifyWebAuthn) {
          const expectedChallenge: string = data["challenge"] as string;
          const credential: any = data["credential"];

          await UserWebAuthnService.verifyAuthentication({
            userId: alreadySavedUser.id!.toString(),
            challenge: expectedChallenge,
            credential: credential,
          });
        }
      } // Refresh Permissions for this user here.
      await AccessTokenService.refreshUserAllPermissions(alreadySavedUser.id!);

      if (alreadySavedUser.password.toString() === user.password!.toString()) {
        logger.info("User logged in: " + alreadySavedUser.email?.toString());

        await finalizeUserLogin({
          req,
          res,
          user: alreadySavedUser,
          isGlobalLogin: true,
        });

        return Response.sendEntityResponse(req, res, alreadySavedUser, User);
      }
    }
    return Response.sendErrorResponse(
      req,
      res,
      new BadDataException("Invalid login: Email or password does not match."),
    );
  } catch (err) {
    return next(err);
  }
};

export default router;
