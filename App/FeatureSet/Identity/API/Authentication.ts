import AuthenticationEmail from "../Utils/AuthenticationEmail";
import BaseModel from "Common/Models/BaseModel";
import { AccountsRoute } from "Common/ServiceRoute";
import Hostname from "Common/Types/API/Hostname";
import Protocol from "Common/Types/API/Protocol";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import OneUptimeDate from "Common/Types/Date";
import Email from "Common/Types/Email";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import BadDataException from "Common/Types/Exception/BadDataException";
import BadRequestException from "Common/Types/Exception/BadRequestException";
import { JSONObject } from "Common/Types/JSON";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import DatabaseConfig from "CommonServer/DatabaseConfig";
import {
  EncryptionSecret,
  IsBillingEnabled,
} from "CommonServer/EnvironmentConfig";
import AccessTokenService from "CommonServer/Services/AccessTokenService";
import EmailVerificationTokenService from "CommonServer/Services/EmailVerificationTokenService";
import MailService from "CommonServer/Services/MailService";
import UserService from "CommonServer/Services/UserService";
import CookieUtil from "CommonServer/Utils/Cookie";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "CommonServer/Utils/Express";
import JSONWebToken from "CommonServer/Utils/JsonWebToken";
import logger from "CommonServer/Utils/Logger";
import Response from "CommonServer/Utils/Response";
import EmailVerificationToken from "Model/Models/EmailVerificationToken";
import User from "Model/Models/User";

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

        const token: string = JSONWebToken.signUserLoginToken({
          tokenData: {
            userId: savedUser.id!,
            email: savedUser.email!,
            name: savedUser.name!,
            isMasterAdmin: savedUser.isMasterAdmin!,
            isGlobalLogin: true, // This is a general login without SSO. So, we will set this to true. This will give access to all the projects that dont require SSO.
          },
          expiresInSeconds: OneUptimeDate.getSecondsInDays(
            new PositiveNumber(30),
          ),
        });

        // Set a cookie with token.
        CookieUtil.setCookie(res, CookieUtil.getUserTokenKey(), token, {
          maxAge: OneUptimeDate.getMillisecondsInDays(new PositiveNumber(30)),
          httpOnly: true,
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
  "/login",
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
        query: { email: user.email! },
        select: {
          _id: true,
          password: true,
          name: true,
          email: true,
          isMasterAdmin: true,
          isEmailVerified: true,
          profilePictureId: true,
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

        // Refresh Permissions for this user here.
        await AccessTokenService.refreshUserAllPermissions(
          alreadySavedUser.id!,
        );

        if (
          alreadySavedUser.password.toString() === user.password!.toString()
        ) {
          logger.info("User logged in: " + alreadySavedUser.email?.toString());

          const token: string = JSONWebToken.signUserLoginToken({
            tokenData: {
              userId: alreadySavedUser.id!,
              email: alreadySavedUser.email!,
              name: alreadySavedUser.name!,
              isMasterAdmin: alreadySavedUser.isMasterAdmin!,
              isGlobalLogin: true, // This is a general login without SSO. So, we will set this to true. This will give access to all the projects that dont require SSO.
            },
            expiresInSeconds: OneUptimeDate.getSecondsInDays(
              new PositiveNumber(30),
            ),
          });

          // Set a cookie with token.
          CookieUtil.setCookie(res, CookieUtil.getUserTokenKey(), token, {
            maxAge: OneUptimeDate.getMillisecondsInDays(new PositiveNumber(30)),
            httpOnly: true,
          });

          return Response.sendEntityResponse(req, res, alreadySavedUser, User);
        }
      }
      return Response.sendErrorResponse(
        req,
        res,
        new BadDataException(
          "Invalid login: Email or password does not match.",
        ),
      );
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
