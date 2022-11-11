import {
    DisableSignup,
    HomeHostname,
    HttpProtocol,
    IsSaaSService,
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
import BaseModel from 'Common/Models/BaseModel';
import Route from 'Common/Types/API/Route';
import logger from 'CommonServer/Utils/Logger';

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
                throw new BadRequestException('Sign up is disabled.');
            }

            const data: JSONObject = req.body['data'];

            const user: User = User.fromJSON(data as JSONObject, User) as User;

            if (IsSaaSService) {
                //ALERT: Delete data.role so user don't accidently sign up as master-admin from the API.
                user.isMasterAdmin = false;
                user.isEmailVerified = false;
            }


            const alreadySavedUser: User | null = await UserService.findOneBy({
                query: { email: user.email! },
                select: {
                    _id: true,
                    password: true,
                },
                props: {
                    isRoot: true,
                },
            });

            if (alreadySavedUser && alreadySavedUser.password) {
                throw new BadDataException(
                    `User with email ${user.email} already exists.`
                );
            }

            let savedUser: User | null = null;

            if (alreadySavedUser) {
                savedUser = await UserService.updateOneByIdAndFetch({
                    id: alreadySavedUser.id!,
                    data: user,
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
                savedUser = await UserService.create({
                    data: user,
                    props: {
                        isRoot: true,
                    },
                });
            }

            console.log(savedUser);

            const generatedToken = ObjectID.generate();

            const emailVerificationToken = new EmailVerificationToken();
            emailVerificationToken.userId = savedUser?.id!;
            emailVerificationToken.email = savedUser?.email!;
            emailVerificationToken.token = generatedToken;
            emailVerificationToken.expires = OneUptimeDate.getOneDayAfter()

            await EmailVerificationTokenService.create({
                data: emailVerificationToken,
                props: {
                    isRoot: true
                },
            });

            MailService.sendMail({
                toEmail: user.email!,
                subject: 'Welcome to OneUptime. Please verify your email.',
                templateType: EmailTemplateType.SignupWelcomeEmail,
                vars: {
                    name: user.name!.toString(),
                    tokenVerifyUrl: new URL(
                        HttpProtocol,
                        Domain,
                        new Route(AccountsRoute.toString()).addRoute(
                            '/verify-email/' + generatedToken.toString()
                        )).toString(),
                    homeUrl: new URL(HttpProtocol, HomeHostname).toString(),
                },
            }).catch((err: Error) => {
                logger.error(err);
            });

            if (savedUser) {
                const token: string = JSONWebToken.sign(
                    savedUser,
                    OneUptimeDate.getSecondsInDays(new PositiveNumber(30))
                );

                return Response.sendJsonObjectResponse(req, res, {
                    token: token,
                    user: BaseModel.toJSON(savedUser, User),
                });
            }

            throw new BadRequestException('Failed to create a user');
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

            const user: User = User.fromJSON(data as JSONObject, User) as User;

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
                        _id: user._id!,
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

            throw new BadDataException(
                `No user is registered with ${user.email?.toString()}`
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

            const token: EmailVerificationToken = EmailVerificationToken.fromJSON(data as JSONObject, EmailVerificationToken) as EmailVerificationToken;

            const alreadySavedToken: EmailVerificationToken | null = await EmailVerificationTokenService.findOneBy({
                query: { token: token.token! },
                select: {
                    _id: true,
                    userId: true,
                    email: true,
                    expires: true
                },
                props: {
                    isRoot: true,
                },
            });

            if (!alreadySavedToken) {
                throw new BadDataException("Invalid link. Please try to log in and we will resend you another link which you should be able to verify email with.")
            }

            if (OneUptimeDate.hasExpired(alreadySavedToken.expires!)) {
                throw new BadDataException("Link expired. Please try to log in and we will resend you another link which you should be able to verify email with.")
            }

            let user = await UserService.findOneBy({
                query: {
                    email: token.email!,
                    _id: token._id!
                },
                props: {
                    isRoot: true
                },
                select: {
                    _id: true,
                    email: true
                }
            });

            if (!user) {
                throw new BadDataException("Invalid link. Please try to log in and we will resend you another link which you should be able to verify email with.")
            }

            await UserService.updateOneBy({
                query: {
                    _id: user._id!,
                },
                data: {
                    isEmailVerified: true
                },
                props: {
                    isRoot: true
                }
            });

            console.log(user.email);

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

            const user: User = User.fromJSON(data as JSONObject, User) as User;
            await user.password?.hashValue(EncryptionSecret);

            const alreadySavedUser: User | null = await UserService.findOneBy({
                query: { resetPasswordToken: user.resetPasswordToken as string || '' },
                select: {
                    _id: true,
                    password: true,
                    name: true,
                    email: true,
                    isMasterAdmin: true,
                    resetPasswordExpires: true
                },
                props: {
                    isRoot: true,
                },
            });

            if (!alreadySavedUser) {
                throw new BadDataException("Invalid link. Please go to forgot password page again and request a new link.")
            }

            if (alreadySavedUser && OneUptimeDate.hasExpired(alreadySavedUser.resetPasswordExpires!)) {
                throw new BadDataException("Expired link. Please go to forgot password page again and request a new link.")
            }


            await UserService.updateOneById({
                id: alreadySavedUser.id!,
                data: {
                    password: user.password!,
                    resetPasswordToken: null!,
                    resetPasswordExpires: null!
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

            const user: User = User.fromJSON(data as JSONObject, User) as User;

            await user.password?.hashValue(EncryptionSecret);

            const alreadySavedUser: User | null = await UserService.findOneBy({
                query: { email: user.email!, password: user.password! },
                select: {
                    _id: true,
                    password: true,
                    name: true,
                    email: true,
                    isMasterAdmin: true,
                    isEmailVerified: true,
                },
                props: {
                    isRoot: true,
                },
            });

            if (alreadySavedUser) {

                if (!alreadySavedUser.isEmailVerified) {
                    const generatedToken = ObjectID.generate();

                    const emailVerificationToken = new EmailVerificationToken();
                    emailVerificationToken.userId = alreadySavedUser?.id!;
                    emailVerificationToken.email = alreadySavedUser?.email!;
                    emailVerificationToken.token = generatedToken;
                    emailVerificationToken.expires = OneUptimeDate.getOneDayAfter()

                    await EmailVerificationTokenService.create({
                        data: emailVerificationToken,
                        props: {
                            isRoot: true
                        },
                    });


                    MailService.sendMail({
                        toEmail: alreadySavedUser.email!,
                        subject: 'Please verify email.',
                        templateType: EmailTemplateType.SignupWelcomeEmail,
                        vars: {
                            name: alreadySavedUser.name!.toString(),
                            tokenVerifyUrl: new URL(
                                HttpProtocol,
                                Domain,
                                new Route(AccountsRoute.toString()).addRoute(
                                    '/verify-email/' + generatedToken.toString()
                                )).toString(),
                            homeUrl: new URL(HttpProtocol, HomeHostname).toString(),
                        },
                    }).catch((err: Error) => {
                        logger.error(err);
                    });

                    throw new BadDataException("Email is not verified. We have sent you an email with the verification link. Please do not forget to check spam.")
                }

                const token: string = JSONWebToken.sign(
                    alreadySavedUser,
                    OneUptimeDate.getSecondsInDays(new PositiveNumber(30))
                );

                return Response.sendJsonObjectResponse(req, res, {
                    token: token,
                    user: BaseModel.toJSON(alreadySavedUser, User),
                });
            }
            throw new BadDataException(
                'Invalid login: Email or password does not match.'
            );
        } catch (err) {
            return next(err);
        }
    }
);

export default router;
