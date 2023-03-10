import {
    DisableSignup,
    HttpProtocol,
    IsBillingEnabled,
    EncryptionSecret,
    Domain,
    AccountsRoute,
} from 'CommonServer/Config';
import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
    NextFunction,
} from 'CommonServer/Utils/Express';
import BadRequestException from 'Common/Types/Exception/BadRequestException';
import { JSONObject } from 'Common/Types/JSON';
import User from 'Model/Models/User';
import EmailVerificationTokenService from 'CommonServer/Services/EmailVerificationTokenService';
import UserService from 'CommonServer/Services/UserService';
import ObjectID from 'Common/Types/ObjectID';
import EmailVerificationToken from 'Model/Models/EmailVerificationToken';
import BadDataException from 'Common/Types/Exception/BadDataException';
import MailService from 'CommonServer/Services/MailService';
import EmailTemplateType from 'Common/Types/Email/EmailTemplateType';
import URL from 'Common/Types/API/URL';
import Response from 'CommonServer/Utils/Response';
import JSONWebToken from 'CommonServer/Utils/JsonWebToken';
import OneUptimeDate from 'Common/Types/Date';
import PositiveNumber from 'Common/Types/PositiveNumber';
import Route from 'Common/Types/API/Route';
import logger from 'CommonServer/Utils/Logger';
import JSONFunctions from 'Common/Types/JSONFunctions';
import PartialEntity from 'Common/Types/Database/PartialEntity';
import Email from 'Common/Types/Email';
import Name from 'Common/Types/Name';
import AuthenticationEmail from '../Utils/AuthenticationEmail';
import AccessTokenService from 'CommonServer/Services/AccessTokenService';

const router: ExpressRouter = Express.getRouter();

router.post(
    '/signup',
    async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ): Promise<void> => {
        try {
            if (DisableSignup) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadRequestException('Sign up is disabled.')
                );
            }

            const data: JSONObject = req.body['data'];

            /* Creating a type that is a partial of the TBaseModel type. */
            const partialUser: PartialEntity<User> = data;

            if (IsBillingEnabled) {
                //ALERT: Delete data.role so user don't accidently sign up as master-admin from the API.
                partialUser.isMasterAdmin = false;
                partialUser.isEmailVerified = false;
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
                        `User with email ${partialUser.email} already exists.`
                    )
                );
            }

            let savedUser: User | null = null;

            if (alreadySavedUser) {
                //@ts-ignore
                savedUser = await UserService.updateOneByIdAndFetch({
                    id: alreadySavedUser.id!,
                    data: partialUser,
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
                const user: User = JSONFunctions.fromJSON(
                    partialUser as JSONObject,
                    User
                ) as User;

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
            emailVerificationToken.userId = savedUser?.id!;
            emailVerificationToken.email = savedUser?.email!;
            emailVerificationToken.token = generatedToken;
            emailVerificationToken.expires = OneUptimeDate.getOneDayAfter();

            await EmailVerificationTokenService.create({
                data: emailVerificationToken,
                props: {
                    isRoot: true,
                },
            });

            MailService.sendMail({
                toEmail: partialUser.email as Email,
                subject: 'Welcome to OneUptime. Please verify your email.',
                templateType: EmailTemplateType.SignupWelcomeEmail,
                vars: {
                    name: (partialUser.name! as Name).toString(),
                    tokenVerifyUrl: new URL(
                        HttpProtocol,
                        Domain,
                        new Route(AccountsRoute.toString()).addRoute(
                            '/verify-email/' + generatedToken.toString()
                        )
                    ).toString(),
                    homeUrl: new URL(HttpProtocol, Domain).toString(),
                },
            }).catch((err: Error) => {
                logger.error(err);
            });

            if (savedUser) {
                // Refresh Permissions for this user here.
                await AccessTokenService.refreshUserAllPermissions(
                    savedUser.id!
                );

                const token: string = JSONWebToken.sign(
                    savedUser,
                    OneUptimeDate.getSecondsInDays(new PositiveNumber(30))
                );

                return Response.sendJsonObjectResponse(req, res, {
                    token: token,
                    user: JSONFunctions.toJSON(savedUser, User),
                });
            }

            return Response.sendErrorResponse(
                req,
                res,
                new BadRequestException('Failed to create a user')
            );
        } catch (err) {
            return next(err);
        }
    }
);

router.post(
    '/forgot-password',
    async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ): Promise<void> => {
        try {
            const data: JSONObject = req.body['data'];

            const user: User = JSONFunctions.fromJSON(
                data as JSONObject,
                User
            ) as User;

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

            if (alreadySavedUser) {
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

                MailService.sendMail({
                    toEmail: user.email!,
                    subject: 'Password Reset Request for OneUptime',
                    templateType: EmailTemplateType.ForgotPassword,
                    vars: {
                        homeURL: new URL(HttpProtocol, Domain).toString(),
                        tokenVerifyUrl: new URL(
                            HttpProtocol,
                            Domain,
                            new Route(AccountsRoute.toString()).addRoute(
                                '/reset-password/' + token
                            )
                        ).toString(),
                    },
                }).catch((err: Error) => {
                    logger.error(err);
                });

                return Response.sendEmptyResponse(req, res);
            }

            return Response.sendErrorResponse(
                req,
                res,
                new BadDataException(
                    `No user is registered with ${user.email?.toString()}`
                )
            );
        } catch (err) {
            return next(err);
        }
    }
);

router.post(
    '/verify-email',
    async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ): Promise<void> => {
        try {
            const data: JSONObject = req.body['data'];

            const token: EmailVerificationToken = JSONFunctions.fromJSON(
                data as JSONObject,
                EmailVerificationToken
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
                        'Invalid link. Please try to log in and we will resend you another link which you should be able to verify email with.'
                    )
                );
            }

            if (OneUptimeDate.hasExpired(alreadySavedToken.expires!)) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadDataException(
                        'Link expired. Please try to log in and we will resend you another link which you should be able to verify email with.'
                    )
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
                        'Invalid link. Please try to log in and we will resend you another link which you should be able to verify email with.'
                    )
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

            MailService.sendMail({
                toEmail: user.email!,
                subject: 'Email Verified.',
                templateType: EmailTemplateType.EmailVerified,
                vars: {
                    homeURL: new URL(HttpProtocol, Domain).toString(),
                },
            }).catch((err: Error) => {
                logger.error(err);
            });

            return Response.sendEmptyResponse(req, res);
        } catch (err) {
            return next(err);
        }
    }
);

router.post(
    '/reset-password',
    async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ): Promise<void> => {
        try {
            const data: JSONObject = req.body['data'];

            const user: User = JSONFunctions.fromJSON(
                data as JSONObject,
                User
            ) as User;

            await user.password?.hashValue(EncryptionSecret);

            const alreadySavedUser: User | null = await UserService.findOneBy({
                query: {
                    resetPasswordToken:
                        (user.resetPasswordToken as string) || '',
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
                        'Invalid link. Please go to forgot password page again and request a new link.'
                    )
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
                        'Expired link. Please go to forgot password page again and request a new link.'
                    )
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

            MailService.sendMail({
                toEmail: alreadySavedUser.email!,
                subject: 'Password Changed.',
                templateType: EmailTemplateType.PasswordChanged,
                vars: {
                    homeURL: new URL(HttpProtocol, Domain).toString(),
                },
            }).catch((err: Error) => {
                logger.error(err);
            });

            return Response.sendEmptyResponse(req, res);
        } catch (err) {
            return next(err);
        }
    }
);

router.post(
    '/login',
    async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ): Promise<void> => {
        try {
            const data: JSONObject = req.body['data'];

            const user: User = JSONFunctions.fromJSON(
                data as JSONObject,
                User
            ) as User;

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
                            'You have not signed up so far. Please go to the registration page to sign up.'
                        )
                    );
                }

                if (!alreadySavedUser.isEmailVerified) {
                    await AuthenticationEmail.sendVerificationEmail(
                        alreadySavedUser
                    );

                    return Response.sendErrorResponse(
                        req,
                        res,
                        new BadDataException(
                            'Email is not verified. We have sent you an email with the verification link. Please do not forget to check spam.'
                        )
                    );
                }

                // Refresh Permissions for this user here.
                await AccessTokenService.refreshUserAllPermissions(
                    alreadySavedUser.id!
                );

                if (
                    alreadySavedUser.password.toString() ===
                    user.password!.toString()
                ) {
                    const token: string = JSONWebToken.sign(
                        alreadySavedUser,
                        OneUptimeDate.getSecondsInDays(new PositiveNumber(30))
                    );

                    return Response.sendJsonObjectResponse(req, res, {
                        token: token,
                        user: JSONFunctions.toJSON(alreadySavedUser, User),
                    });
                }
            }
            return Response.sendErrorResponse(
                req,
                res,
                new BadDataException(
                    'Invalid login: Email or password does not match.'
                )
            );
        } catch (err) {
            return next(err);
        }
    }
);

export default router;
