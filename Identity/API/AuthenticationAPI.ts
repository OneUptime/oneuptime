import {
    AccountsHostname,
    DashboardHostname,
    DisableSignup,
    HomeHostname,
    HttpProtocol,
    IsSaaSService,
    EncryptionSecret,
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
import EmailSubjects from 'Common/Types/Email/EmailSubjects';
import URL from 'Common/Types/API/URL';
import Response from 'CommonServer/Utils/Response';
import JSONWebToken from 'CommonServer/Utils/JsonWebToken';
import OneUptimeDate from 'Common/Types/Date';
import PositiveNumber from 'Common/Types/PositiveNumber';
import BaseModel from 'Common/Models/BaseModel';
import PartialEntity from 'Common/Types/Database/PartialEntity';

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

            let verificationToken: ObjectID | null = null;
            let emailVerificationToken: EmailVerificationToken | null = null;
            if (req.query['token']) {
                verificationToken = new ObjectID(req.query['token'] as string);
                emailVerificationToken =
                    await EmailVerificationTokenService.findOneBy({
                        query: {
                            token: verificationToken,
                        },
                        props: {
                            isRoot: true,
                        },
                    });
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

            if (
                emailVerificationToken &&
                user &&
                alreadySavedUser?.id?.toString() ===
                    emailVerificationToken?.userId?.toString()
            ) {
                user.isEmailVerified = true;
            }

            if (alreadySavedUser && alreadySavedUser.password) {
                throw new BadDataException(
                    `User with email ${user.email} already exists.`
                );
            }

            let savedUser: User | null = null;
            if (alreadySavedUser) {
                savedUser = await UserService.updateOneByIdAndFetch({
                    id: alreadySavedUser.id!,
                    data: BaseModel.toJSON(user, User) as PartialEntity<User>,
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

            if (alreadySavedUser) {
                // Send Welcome Mail
                await MailService.sendMail(
                    user.email!,
                    EmailSubjects.getSubjectByType(
                        EmailTemplateType.SIGNUP_WELCOME_EMAIL
                    ),
                    EmailTemplateType.SIGNUP_WELCOME_EMAIL,
                    {
                        name: user.name!.toString(),
                        dashboardUrl: new URL(
                            HttpProtocol,
                            DashboardHostname
                        ).toString(),
                        homeUrl: new URL(HttpProtocol, HomeHostname).toString(),
                    }
                );
            } else {
                // Send EmailVerification Link because this is a new user.
                await MailService.sendMail(
                    user.email!,
                    EmailSubjects.getSubjectByType(
                        EmailTemplateType.SIGNUP_WELCOME_EMAIL
                    ),
                    EmailTemplateType.SIGNUP_WELCOME_EMAIL,
                    {
                        name: user.name!.toString(),
                        emailVerificationUrl: new URL(
                            HttpProtocol,
                            AccountsHostname
                        ).toString(),
                        homeUrl: new URL(HttpProtocol, HomeHostname).toString(),
                    }
                );
            }

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
    '/request-reset-password',
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
                },
                props: {
                    isRoot: true,
                },
            });

            if (alreadySavedUser) {
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
                query: { email: user.email!, password: user.password! },
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
                },
                props: {
                    isRoot: true,
                },
            });

            if (alreadySavedUser) {
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
