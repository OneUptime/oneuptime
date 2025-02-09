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
  EncryptionSecret,
  IsBillingEnabled,
} from "Common/Server/EnvironmentConfig";
import AccessTokenService from "Common/Server/Services/AccessTokenService";
import EmailVerificationTokenService from "Common/Server/Services/EmailVerificationTokenService";
import MailService from "Common/Server/Services/MailService";
import UserService from "Common/Server/Services/UserService";
import UserTwoFactorAuthService from "Common/Server/Services/UserTwoFactorAuthService";
import CookieUtil from "Common/Server/Utils/Cookie";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import Response from "Common/Server/Utils/Response";
import TwoFactorAuth from "Common/Server/Utils/TwoFactorAuth";
import EmailVerificationToken from "Common/Models/DatabaseModels/EmailVerificationToken";
import User from "Common/Models/DatabaseModels/User";
import UserTwoFactorAuth from "Common/Models/DatabaseModels/UserTwoFactorAuth";

const router: ExpressRouter = Express.getRouter();

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

        CookieUtil.setUserCookie({
          expressResponse: res,
          user: savedUser,
          isGlobalLogin: true,
        });

        logger.info("User signed up: " + savedUser.email?.toString());

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
  "/logout",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      CookieUtil.removeAllCookies(req, res);

      return Response.sendEmptySuccessResponse(req, res);
    } catch (err) {
      return next(err);
    }
  },
);

router.post(
  "/verify-two-factor-auth",
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    return login({
      req: req,
      res: res,
      next: next,
      verifyTwoFactorAuth: true,
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
      verifyTwoFactorAuth: false,
    });
  },
);

type FetchTwoFactorAuthListFunction = (
  userId: ObjectID,
) => Promise<Array<UserTwoFactorAuth>>;

const fetchTwoFactorAuthList: FetchTwoFactorAuthListFunction = async (
  userId: ObjectID,
): Promise<Array<UserTwoFactorAuth>> => {
  const twoFactorAuthList: Array<UserTwoFactorAuth> =
    await UserTwoFactorAuthService.findBy({
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

  return twoFactorAuthList;
};

type LoginFunction = (options: {
  req: ExpressRequest;
  res: ExpressResponse;
  next: NextFunction;
  verifyTwoFactorAuth: boolean;
}) => Promise<void>;

const login: LoginFunction = async (options: {
  req: ExpressRequest;
  res: ExpressResponse;
  next: NextFunction;
  verifyTwoFactorAuth: boolean;
}): Promise<void> => {
  const req: ExpressRequest = options.req;
  const res: ExpressResponse = options.res;
  const next: NextFunction = options.next;
  const verifyTwoFactorAuth: boolean = options.verifyTwoFactorAuth;

  try {
    const data: JSONObject = req.body["data"];

    const user: User = BaseModel.fromJSON(data as JSONObject, User) as User;

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

      if (alreadySavedUser.enableTwoFactorAuth && !verifyTwoFactorAuth) {
        // If two factor auth is enabled then we will send the user to the two factor auth page.

        const twoFactorAuthList: Array<UserTwoFactorAuth> =
          await fetchTwoFactorAuthList(alreadySavedUser.id!);

        if (!twoFactorAuthList || twoFactorAuthList.length === 0) {
          const errorMessage: string = IsBillingEnabled
            ? "Two Factor Authentication is enabled but no two factor auth is setup. Please contact OneUptime support for help."
            : "Two Factor Authentication is enabled but no two factor auth is setup. Please contact your server admin to disable two factor auth for this account.";

          return Response.sendErrorResponse(
            req,
            res,
            new BadDataException(errorMessage),
          );
        }

        return Response.sendEntityResponse(req, res, user, User, {
          miscData: {
            twoFactorAuthList: UserTwoFactorAuth.toJSONArray(
              twoFactorAuthList,
              UserTwoFactorAuth,
            ),
            twoFactorAuth: true,
          },
        });
      }

      if (verifyTwoFactorAuth) {
        // code from req
        const code: string = data["code"] as string;
        const twoFactorAuthId: string = data["twoFactorAuthId"] as string;

        const twoFactorAuth: UserTwoFactorAuth | null =
          await UserTwoFactorAuthService.findOneBy({
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

        if (!twoFactorAuth) {
          return Response.sendErrorResponse(
            req,
            res,
            new BadDataException("Invalid two factor auth id."),
          );
        }

        const isVerified: boolean = TwoFactorAuth.verifyToken({
          token: code,
          secret: twoFactorAuth.twoFactorSecret!,
          email: alreadySavedUser.email!,
        });

        if (!isVerified) {
          return Response.sendErrorResponse(
            req,
            res,
            new BadDataException("Invalid code."),
          );
        }
      }

      // Refresh Permissions for this user here.
      await AccessTokenService.refreshUserAllPermissions(alreadySavedUser.id!);

      if (alreadySavedUser.password.toString() === user.password!.toString()) {
        logger.info("User logged in: " + alreadySavedUser.email?.toString());

        CookieUtil.setUserCookie({
          expressResponse: res,
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
