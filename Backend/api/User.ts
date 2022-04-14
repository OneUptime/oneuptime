import express, {
    ExpressRequest,
    ExpressResponse,
} from 'CommonServer/Utils/Express';
import UserService from '../services/userService';
import ProjectService from '../services/projectService';
const jwtSecretKey: $TSFixMe = process.env['JWT_SECRET'];
import BadDataException from 'Common/Types/Exception/BadDataException';

import jwt from 'jsonwebtoken';

import bcrypt from 'bcrypt';

import saml2 from 'saml2-js';
import { decode } from 'js-base64';
import MailService from '../services/mailService';
import SsoService from '../services/ssoService';
const getUser: $TSFixMe = require('../middlewares/user').getUser;
import {
    sendErrorResponse,
    sendItemResponse,
} from 'CommonServer/Utils/response';
import Exception from 'Common/Types/Exception/Exception';

import { sendListResponse } from 'CommonServer/Utils/response';
const router: $TSFixMe = express.getRouter();
import multer from 'multer';
import storage from '../middlewares/upload';
import winston from 'winston';

import constants from '../config/constants.json';

import { emaildomains } from '../config/emaildomains';
import randToken from 'rand-token';
import VerificationTokenModel from 'CommonServer/models/verificationToken';

import { IS_SAAS_SERVICE } from '../config/server';
import UserModel from 'CommonServer/models/user';
import SsoDefaultRolesService from '../services/ssoDefaultRolesService';
const isUserMasterAdmin: $TSFixMe =
    require('../middlewares/user').isUserMasterAdmin;
import Ip from '../middlewares/ipHandler';

router.post('/signup', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
        if (
            typeof process.env['DISABLE_SIGNUP'] === 'string' &&
            process.env['DISABLE_SIGNUP'] === 'true'
        ) {
            // res,and next is skipped in isUserMasterAdmin because we don't want to reject the request.
            if (!(await isUserMasterAdmin(req))) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Sign up is disabled.',
                });
            }
        }

        const data: $TSFixMe = req.body;
        data.email = data.email.toLowerCase();
        if (IS_SAAS_SERVICE) {
            //ALERT: Delete data.role so user don't accidently sign up as master-admin from the API.
            delete data.role;
        } else {
            const users: $TSFixMe = await UserService.findBy({
                query: {},
                select: '_id',
            });

            if (!users || users.length === 0) {
                data.role = 'master-admin';
            } else {
                delete data.role;
            }
        }

        if (!data.email) {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Email must be present.')
            );
        }

        if (typeof data.email !== 'string') {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Email is not in string format.')
            );
        }

        if (!emaildomains.test(data.email)) {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Business email address is required.')
            );
        }

        if (!data.password) {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Password must be present.')
            );
        }

        if (typeof data.password !== 'string') {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Password is not in string format.')
            );
        }

        if (!data.confirmPassword) {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Confirm password must be present.')
            );
        }

        if (typeof data.confirmPassword !== 'string') {
            return sendErrorResponse(
                req,
                res,
                new BadDataException(
                    'Confirm password is not in string format.'
                )
            );
        }

        if (data.confirmPassword !== data.confirmPassword) {
            return sendErrorResponse(
                req,
                res,
                new BadDataException(
                    'Password and Confirm password are not same.'
                )
            );
        }

        if (!data.name) {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Name must be present.')
            );
        }

        if (typeof data.name !== 'string') {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Name is not in string format.')
            );
        }
        const [userData, token]: $TSFixMe = await Promise.all([
            UserService.findOneBy({
                query: { email: data.email },
                select: '_id password',
            }),
            VerificationTokenModel.findOne({
                token: req.query.token,
            }),
        ]);
        let user: $TSFixMe = userData;
        let verified: $TSFixMe = true;
        if (token) {
            user = await UserModel.findOne({
                _id: token.userId,
            });
            if (!user) {
                user = await UserService.findOneBy({
                    query: { email: data.email },
                    select: '_id password',
                });
                verified = false;
            }
        } else {
            verified = false;
        }
        //Checks if user is registered with only email
        if (user) {
            if (!user.password) {
                const hash: $TSFixMe = await bcrypt.hash(
                    data.password,
                    constants.saltRounds
                );
                // creating jwt refresh token
                const jwtRefreshToken: $TSFixMe = randToken.uid(256);
                user = await UserService.updateOneBy(
                    { _id: user._id },
                    {
                        name: data.name,
                        password: hash,
                        jwtRefreshToken: jwtRefreshToken,
                        isVerified: verified,
                    }
                );

                // Call the MailService.

                MailService.sendSignupMail(user.email, user.name);

                if (!verified) {
                    UserService.sendToken(user, user.email);
                }
                // create access token and refresh token.
                const authUserObj: $TSFixMe = {
                    id: user._id,
                    name: user.name,
                    email: user.email,
                    cardRegistered: user.stripeCustomerId ? true : false,
                    tokens: {
                        jwtAccessToken: `${jwt.sign(
                            {
                                id: user._id,
                            },
                            jwtSecretKey,
                            { expiresIn: 8640000 }
                        )}`,
                        jwtRefreshToken: user.jwtRefreshToken,
                    },
                    role: user.role || null,
                    verificationToken: user.verificationToken || null,
                };
                winston.info('User just signed up');
                return sendItemResponse(req, res, authUserObj);
            } else {
                return sendErrorResponse(req, res, {
                    message: 'Email Address is already taken.',
                    code: 400,
                });
            }
        } else {
            if (!data.companyName) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Company Name must be present.',
                });
            }

            if (typeof data.companyName !== 'string') {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Company Name is not in string format.',
                });
            }

            if (!data.companyPhoneNumber) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Company phone number must be present.',
                });
            }

            if (typeof data.companyPhoneNumber !== 'string') {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Company phone number  is not in string format.',
                });
            }
            // Call the UserService.
            user = await UserService.signup(data);

            // Call the MailService.
            MailService.sendSignupMail(user.email, user.name);

            // create access token and refresh token.
            const authUserObj: $TSFixMe = {
                id: user._id,
                name: user.name,
                email: user.email,
                airtableId: user.airtableId,
                cardRegistered: user.stripeCustomerId ? true : false,
                tokens: {
                    jwtAccessToken: `${jwt.sign(
                        {
                            id: user._id,
                        },
                        jwtSecretKey,
                        { expiresIn: 8640000 }
                    )}`,
                    jwtRefreshToken: user.jwtRefreshToken,
                },
                role: user.role || null,
                verificationToken: user.verificationToken || null,
            };
            winston.info('A User just signed up');
            const populate: $TSFixMe = [
                { path: 'parentProjectId', select: 'name' },
            ];
            const select: $TSFixMe =
                '_id slug name users stripePlanId stripeSubscriptionId parentProjectId seats deleted apiKey alertEnable alertLimit alertLimitReached balance alertOptions isBlocked adminNotes';
            const project: $TSFixMe = await ProjectService.findOneBy({
                query: { 'users.userId': user._id },
                select,
                populate,
            });

            return sendItemResponse(
                req,
                res,
                Object.assign(authUserObj, { project: project })
            );
        }
    } catch (error) {
        return sendErrorResponse(req, res, error as Exception);
    }
});

router.get(
    '/masterAdminExists',
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const masterAdmin: $TSFixMe = await UserService.findBy({
                query: { role: 'master-admin' },
                select: '_id',
            });

            if (masterAdmin && masterAdmin.length > 0) {
                return sendItemResponse(req, res, { result: true });
            } else {
                return sendItemResponse(req, res, { result: false });
            }
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// Route
// Description: SSO login function for  user
// Params:
// Param 1: req.query-> {email }
// Returns: 400: Error; 500: Server Error; 200: redirect to login page
router.get('/sso/login', async (req: ExpressRequest, res: ExpressResponse) => {
    const { email }: $TSFixMe = req.query;
    if (!email) {
        return sendErrorResponse(req, res, {
            code: 400,
            message: 'Email must be present.',
        });
    }

    const domainRegex: $TSFixMe = /^[a-z0-9._%+-]+@([a-z0-9.-]+\.[a-z]{2,})$/;

    const matchedTokens: $TSFixMe = email
        .toLocaleLowerCase()
        .match(domainRegex);

    if (!matchedTokens) {
        return sendErrorResponse(req, res, {
            code: 400,
            message: 'Invalid email.',
        });
    }

    const domain: $TSFixMe = matchedTokens[1];

    try {
        const selectSso: string = '_id saml-enabled remoteLoginUrl entityId';

        const sso: $TSFixMe = await SsoService.findOneBy({
            query: { domain },
            select: selectSso,
        });
        if (!sso) {
            return sendErrorResponse(req, res, {
                code: 404,
                message: 'Domain not found.',
            });
        }
        const { 'saml-enabled': samlEnabled, remoteLoginUrl } = sso;

        if (!samlEnabled) {
            return sendErrorResponse(req, res, {
                code: 401,
                message: 'SSO disabled for this domain.',
            });
        }

        const sp: $TSFixMe = new saml2.ServiceProvider({
            entity_id: sso.entityId,
        });
        const idp: $TSFixMe = new saml2.IdentityProvider({
            sso_login_url: remoteLoginUrl,
        });

        sp.create_login_request_url(
            idp,
            {},
            (error: $TSFixMe, login_url: URL): void => {
                if (error != null) {
                    return sendErrorResponse(req, res, error as Exception);
                }
                return sendItemResponse(req, res, { url: login_url });
            }
        );
    } catch (error) {
        return sendErrorResponse(req, res, error as Exception);
    }
});

// Route
// Description: Callback function after SSO authentication page
// param: query->{domain}
router.post(
    '/sso/callback',
    async (req: ExpressRequest, res: ExpressResponse) => {
        const options: $TSFixMe = {
            request_body: req.body,
            allow_unencrypted_assertion: true,
            ignore_signature: true,
        };

        // grab the email from the xml response
        const email: $TSFixMe = SsoService.getEmail(
            decode(req.body.SAMLResponse)
        );
        const domainRegex: $TSFixMe =
            /^[a-z0-9._%+-]+@([a-z0-9.-]+\.[a-z]{2,})$/;
        const matchedTokens: $TSFixMe = email
            .toLocaleLowerCase()
            .match(domainRegex);

        if (!matchedTokens) {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Invalid email.')
            );
        }

        const domain: $TSFixMe = matchedTokens[1];

        const sso: $TSFixMe = await SsoService.findOneBy({
            query: { domain },
            select: '_id samlSsoUrl entityId',
        });
        if (!sso) {
            return sendErrorResponse(req, res, {
                code: 404,
                message: 'Domain not found.',
            });
        }

        const sp: $TSFixMe = new saml2.ServiceProvider({
            entity_id: sso.entityId,
        });

        const idp: $TSFixMe = new saml2.IdentityProvider({
            sso_login_url: sso.samlSsoUrl,
        });

        sp.post_assert(
            idp,
            options,
            async (err: $TSFixMe, saml_response: $TSFixMe): void => {
                if (err != null) {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message: 'Invalid request',
                    });
                }

                // The structure of the saml_response is not the same from the different servers.
                const email: $TSFixMe =
                    saml_response.user.email ||
                    saml_response.user.attributes.email[0];

                const domainRegex: $TSFixMe =
                    /^[a-z0-9._%+-]+@([a-z0-9.-]+\.[a-z]{2,})$/;
                const matchedTokens: $TSFixMe = email
                    .toLocaleLowerCase()
                    .match(domainRegex);

                if (!matchedTokens) {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message: 'Invalid email.',
                    });
                }

                const domain: $TSFixMe = matchedTokens[1];

                const sso: $TSFixMe = await SsoService.findOneBy({
                    query: { domain },
                    select: '_id domain saml-enabled',
                });

                if (!sso) {
                    return sendErrorResponse(req, res, {
                        code: 400,
                        message: 'SSO not defined for the domain.',
                    });
                }

                if (!sso['saml-enabled']) {
                    return sendErrorResponse(req, res, {
                        code: 401,
                        message: 'SSO is disabled for the domain.',
                    });
                }

                let user: $TSFixMe = await UserService.findOneBy({
                    query: { email },
                    select: '_id name email stripeCustomerId jwtRefreshToken role',
                });

                if (!user) {
                    // User is not create yet
                    try {
                        user = await UserService.create({
                            email,
                            sso: sso._id,
                        });
                        if (!user) {
                            return sendErrorResponse(req, res, {
                                code: 401,
                                message: 'USER creation failed.',
                            });
                        }
                        const { _id: userId } = user;
                        const { _id: domain } = sso;
                        await SsoDefaultRolesService.addUserToDefaultProjects({
                            domain,
                            userId,
                        });
                    } catch (error) {
                        return sendErrorResponse(req, res, {
                            code: 400,
                            message: error,
                        });
                    }
                }

                const authUserObj: $TSFixMe = {
                    id: user._id,
                    name: user.name,
                    email: user.email,
                    redirect: null,
                    cardRegistered: user.stripeCustomerId ? true : false,
                    tokens: {
                        jwtAccessToken: `${jwt.sign(
                            {
                                id: user._id,
                            },
                            jwtSecretKey,
                            { expiresIn: 8640000 }
                        )}`,
                        jwtRefreshToken: user.jwtRefreshToken,
                    },
                    role: user.role || null,
                };

                return res.redirect(
                    `${global.accountsHost}` +
                        `/ssologin?id=${authUserObj.id}` +
                        `&name=${authUserObj.name}` +
                        `&email=${authUserObj.email}` +
                        `&jwtAccessToken=${authUserObj.tokens.jwtAccessToken}` +
                        `&jwtRefreshToken=${authUserObj.tokens.jwtRefreshToken}` +
                        `&role=${authUserObj.role}` +
                        `&redirect=${authUserObj.redirect}` +
                        `&cardRegistered=${authUserObj.cardRegistered}`
                );
            }
        );
    }
);

// Route
// Description: login function for  user
// Params:
// Param 1: req.body-> {email, password }
// Returns: 400: Error; 500: Server Error; 200: user
router.post('/login', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
        const data: $TSFixMe = req.body;
        const clientIP: $TSFixMe = Ip.getClientIp(req)[0];
        if (!data.email) {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Email must be present.')
            );
        }

        if (typeof data.email !== 'string') {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Email is not in string format.')
            );
        }

        if (!data.password) {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Password must be present.')
            );
        }

        if (typeof data.password !== 'string') {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Password is not in string format.')
            );
        }

        // Call the UserService
        const userAgent: $TSFixMe = req.get('user-agent');
        const user: $TSFixMe = await UserService.login(
            data.email.toLowerCase(),
            data.password,
            clientIP,
            userAgent
        );

        let authUserObj: $TSFixMe;

        if (!user._id) {
            authUserObj = { ...user };
        } else {
            // create access token and refresh token.
            authUserObj = {
                id: user._id,
                name: user.name,
                email: user.email,
                redirect: data.redirect || null,
                cardRegistered: user.stripeCustomerId ? true : false,
                tokens: {
                    jwtAccessToken: `${jwt.sign(
                        {
                            id: user._id,
                        },
                        jwtSecretKey,
                        { expiresIn: 8640000 }
                    )}`,
                    jwtRefreshToken: user.jwtRefreshToken,
                },
                role: user.role || null,
            };
        }
        return sendItemResponse(req, res, authUserObj);
    } catch (error) {
        return sendErrorResponse(req, res, error as Exception);
    }
});

// Route
// Description: verify function for  user
// Params:
// Param 1: req.body-> {token}
// Returns: 400: Error; 500: Server Error; 200: user
router.post(
    '/totp/verifyToken',
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const data: $TSFixMe = req.body;
            const token: $TSFixMe = data.token;
            let userId: $TSFixMe = data.userId;
            if (data.email && !data.userId) {
                const foundUser: $TSFixMe = await UserService.findOneBy({
                    query: { email: data.email },
                    select: '_id',
                });
                userId = foundUser._id;
            }
            const user: $TSFixMe = await UserService.verifyAuthToken(
                token,
                userId
            );
            if (!user || !user._id) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Invalid token.',
                });
            }

            // create access token and refresh token.
            const userObj: $TSFixMe = {
                id: user._id,
                name: user.name ? user.name : '',
                email: user.email ? user.email : '',
                password: user.password,
                companyName: user.companyName,
                companyRole: user.companyRole,
                companySize: user.companySize,
                referral: user.referral,
                isVerified: user.isVerified,
                twoFactorAuthEnabled: user.twoFactorAuthEnabled,
                companyPhoneNumber: user.companyPhoneNumber
                    ? user.companyPhoneNumber
                    : '',
                alertPhoneNumber: user.alertPhoneNumber
                    ? user.alertPhoneNumber
                    : '',
                profilePic: user.profilePic,
                backupCodes: user.backupCodes,
                timezone: user.timezone ? user.timezone : '',
                tokens: {
                    jwtAccessToken: `${jwt.sign(
                        {
                            id: user._id,
                        },
                        jwtSecretKey,
                        { expiresIn: 8640000 }
                    )}`,
                    jwtRefreshToken: user.jwtRefreshToken,
                },
                tempEmail: user.tempEmail || null,
                tempAlertPhoneNumber: user.tempAlertPhoneNumber || null,
                role: user.role || null,
            };
            return sendItemResponse(req, res, userObj);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// Route
// Description: verify function for user backup code.
// Params:
// Param 1: req.body-> {code}
// Returns: 400: Error; 500: Server Error; 200: user
router.post(
    '/verify/backupCode',
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const data: $TSFixMe = req.body;
            // Call the UserService
            let user: $TSFixMe;
            user = await UserService.findOneBy({
                query: { email: data.email },
                select: 'backupCodes',
            });
            if (!user) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'User not found',
                });
            }
            const backupCode: $TSFixMe = user.backupCodes.filter(
                (code: $TSFixMe) => code.code === data.code
            );
            if (backupCode.length > 0 && backupCode[0].used) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message:
                        'This backup code was used once, use another backup code.',
                });
            }
            if (backupCode.length > 0) {
                user = await UserService.verifyUserBackupCode(
                    data.code,
                    user.twoFactorSecretCode,
                    backupCode[0].counter
                );
            }
            if (backupCode.length === 0 || !user || !user._id) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Invalid backup code.',
                });
            }

            // create access token and refresh token.
            const userObj: $TSFixMe = {
                id: user._id,
                name: user.name ? user.name : '',
                email: user.email ? user.email : '',
                password: user.password,
                companyName: user.companyName,
                companyRole: user.companyRole,
                companySize: user.companySize,
                referral: user.referral,
                isVerified: user.isVerified,
                twoFactorAuthEnabled: user.twoFactorAuthEnabled,
                companyPhoneNumber: user.companyPhoneNumber
                    ? user.companyPhoneNumber
                    : '',
                alertPhoneNumber: user.alertPhoneNumber
                    ? user.alertPhoneNumber
                    : '',
                profilePic: user.profilePic,
                backupCodes: user.backupCodes,
                timezone: user.timezone ? user.timezone : '',
                tokens: {
                    jwtAccessToken: `${jwt.sign(
                        {
                            id: user._id,
                        },
                        jwtSecretKey,
                        { expiresIn: 8640000 }
                    )}`,
                    jwtRefreshToken: user.jwtRefreshToken,
                },
                tempEmail: user.tempEmail || null,
                tempAlertPhoneNumber: user.tempAlertPhoneNumber || null,
                role: user.role || null,
            };
            return sendItemResponse(req, res, userObj);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// Route
// Description: generate a new set of backup code.
// Params:
// None
// Return: return the new list of backup codes.
router.post(
    '/generate/backupCode',
    getUser,
    async (req: ExpressRequest, res: ExpressResponse) => {
        const userId: $TSFixMe = req.user.id || null;
        const user: $TSFixMe = await UserService.findOneBy({
            query: { _id: userId },
            select: 'twoFactorAuthEnabled twoFactorSecretCode backupCodes',
        });
        if (!user) {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Provide a valid user Id')
            );
        }
        const {
            twoFactorAuthEnabled,
            twoFactorSecretCode,
            backupCodes,
        }: $TSFixMe = user;
        if (!twoFactorAuthEnabled) {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('2FA is not enabled')
            );
        }
        if (!twoFactorSecretCode || !twoFactorSecretCode.trim()) {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('SecretCode is not defined')
            );
        }
        const numberOfCodes: $TSFixMe = 8;
        let firstCounter: $TSFixMe = 0;
        if (Array.isArray(backupCodes) && backupCodes.length) {
            firstCounter = backupCodes[backupCodes.length - 1].counter + 1;
        }
        const newBackupCodes: $TSFixMe =
            await UserService.generateUserBackupCodes(
                twoFactorSecretCode,
                numberOfCodes,
                firstCounter
            );
        try {
            await UserService.updateOneBy(
                { _id: userId },
                { backupCodes: newBackupCodes }
            );
            return sendItemResponse(req, res, newBackupCodes);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// Route
// Description: generate user secret token for creating QRcode
// Params:
// Param 1: req.params-> {userId}
// Returns: 400: Error; 500: Server Error; 200: user
router.post(
    '/totp/token/:userId',
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const userId: $TSFixMe = req.params.userId;
            const user: $TSFixMe = await UserService.findOneBy({
                query: { _id: userId },
                select: '_id otpauth_url',
            });
            if (!userId || !user._id) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Provide a valid user Id',
                });
            }

            if (user.otpauth_url) {
                const response: $TSFixMe = { otpauth_url: user.otpauth_url };
                return sendItemResponse(req, res, response);
            }

            const response: $TSFixMe =
                await UserService.generateTwoFactorSecret(userId);
            return sendItemResponse(req, res, response);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// Route
// Description: forgot password function for  user
// Params:
// Param 1: req.body-> {email}; req.headers-> {host}
// Returns: 400: Error; 500: Server Error: 200: User password has been reset successfully.

router.post(
    '/forgot-password',
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const data: $TSFixMe = req.body;

            if (!data.email) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Email must be present.',
                });
            }

            if (typeof data.email !== 'string') {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Email is not in string format.',
                });
            }
            // Call the UserService.
            const user: $TSFixMe = await UserService.forgotPassword(data.email);

            const tokenVerifyUrl: string = `${global.accountsHost}/change-password/${user.resetPasswordToken}`;

            // Call the MailService.
            MailService.sendForgotPasswordMail(tokenVerifyUrl, user.email);

            return sendItemResponse(req, res, {
                message: 'User received mail succcessfully.',
            });
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// Route
// Description: reset password function for user
// Params:
// Param 1: req.body-> {password}; req.params-> {token}
// Returns: 400: Error; 500: Server Error; 200: User password has been reset successfully.
router.post(
    '/reset-password',
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const data: $TSFixMe = req.body;

            if (!data.password) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Password must be present.',
                });
            }

            if (typeof data.password !== 'string') {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Password is not in string format.',
                });
            }

            if (!data.token) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Token must be present.',
                });
            }

            if (typeof data.token !== 'string') {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Token is not in string format.',
                });
            }
            // Call the UserService
            const user: $TSFixMe = await UserService.resetPassword(
                data.password,
                data.token
            );
            if (!user) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message:
                        'Reset password token has expired or token is invalid.',
                });
            }

            MailService.sendResetPasswordConfirmMail(user.email);

            return sendItemResponse(req, res, {
                message: 'User password has been reset successfully.',
            });
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// Route
// Description: login function for  user
// Params:
// Param 1: req.body-> {email, password }
// Returns: 400: Error; 500: Server Error; 200: user
router.post('/isInvited', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
        const data: $TSFixMe = req.body;

        if (!data.email) {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Email must be present.')
            );
        }
        // Call the UserService
        const user: $TSFixMe = await UserService.findOneBy({
            query: { email: data.email },
            select: '_id',
        });
        if (user) {
            return sendItemResponse(req, res, true);
        } else {
            return sendItemResponse(req, res, false);
        }
    } catch (error) {
        return sendErrorResponse(req, res, error as Exception);
    }
});

// I used to validate token given to redirected urls such as status page
router.post(
    '/isAuthenticated',
    getUser,
    async (req: ExpressRequest, res: ExpressResponse) => {
        // request will get here if user is authenticated.

        return sendItemResponse(req, res, {
            authenticated: true,
            user: req.user,
        });
    }
);

// Route
// Description: Updating profile setting.
// Params:
// Param 1: req.headers-> {authorization}; req.user-> {id}; req.files-> {profilePic};
// Returns: 200: Success, 400: Error; 500: Server Error.
router.put(
    '/profile',
    getUser,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const upload: $TSFixMe = multer({
                storage,
            }).fields([
                {
                    name: 'profilePic',
                    maxCount: 1,
                },
            ]);
            upload(req, res, async (error: $TSFixMe): void => {
                const userId: $TSFixMe = req.user ? req.user.id : null;
                const data: $TSFixMe = req.body;

                if (error) {
                    return sendErrorResponse(req, res, error as Exception);
                }
                if (
                    req.files &&
                    req.files.profilePic &&
                    req.files.profilePic[0].filename
                ) {
                    data.profilePic = req.files.profilePic[0].filename;
                }
                const userData: $TSFixMe = await UserService.findOneBy({
                    query: { _id: userId },
                    select: 'email tempEmail alertPhoneNumber isVerified name _id',
                });
                if (data.email !== userData.email) {
                    if (data.email === userData.tempEmail) {
                        delete data.email;
                    } else {
                        await UserService.sendToken(userData, data.email);
                        delete data.email;
                    }
                }
                if (data.alertPhoneNumber !== userData.alertPhoneNumber) {
                    delete data.alertPhoneNumber;
                }
                // Call the UserService
                const user: $TSFixMe = await UserService.updateOneBy(
                    { _id: userId },
                    data
                );
                return sendItemResponse(req, res, user);
            });
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// Route
// Description: Turns on or off Push Notification
// Params:
// Param 1: req.headers-> {authorization}; req.user-> {id};
// Returns: 200: Success, 400: Error; 500: Server Error.
router.put(
    '/push-notification',
    getUser,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const userId: $TSFixMe = req.user ? req.user.id : null;
            const data: $TSFixMe = req.body;
            const user: $TSFixMe = await UserService.updatePush({
                userId,
                data,
            });
            return sendItemResponse(req, res, user);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// Route
// Description: Turns on or off 2FA.
// Params:
// Param 1: req.headers-> {authorization}; req.user-> {id};
// Returns: 200: Success, 400: Error; 500: Server Error.
router.put(
    '/:userId/2fa',
    isUserMasterAdmin,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const { userId }: $TSFixMe = req.params;
            const data: $TSFixMe = req.body;
            const userData: $TSFixMe = await UserService.findOneBy({
                query: { _id: userId },
                select: 'email',
            });
            if (userData.email !== data.email) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Invalid user data.',
                });
            }
            // Call the UserService
            const user: $TSFixMe = await UserService.updateOneBy(
                { _id: userId },
                data
            );
            return sendItemResponse(req, res, user);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.put(
    '/profile/:userId',
    getUser,
    isUserMasterAdmin,
    async (req, res): void => {
        try {
            const upload: $TSFixMe = multer({
                storage,
            }).fields([
                {
                    name: 'profilePic',
                    maxCount: 1,
                },
            ]);

            upload(req, res, async (error: $TSFixMe): void => {
                const userId: $TSFixMe = req.params.userId;
                const data: $TSFixMe = req.body;

                if (error) {
                    return sendErrorResponse(req, res, error as Exception);
                }

                if (
                    req.files &&
                    req.files.profilePic &&
                    req.files.profilePic[0].filename
                ) {
                    data.profilePic = req.files.profilePic[0].filename;
                }

                // Call the UserService
                const user: $TSFixMe = await UserService.updateOneBy(
                    { _id: userId },
                    data
                );
                return sendItemResponse(req, res, user);
            });
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// Route
// Description: Updating change password setting.
// Params:
// Param 1: req.headers-> {authorization}; req.user-> {id}; req.files-> {profilePic}; req.data- {currentPassword, newPassword, confirmPassword}
// Returns: 200: Success, 400: Error; 500: Server Error.
router.put(
    '/changePassword',
    getUser,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const data: $TSFixMe = req.body;

            const userId: $TSFixMe = req.user ? req.user.id : null;
            data._id = userId;

            if (!data.currentPassword) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Current Password must be present.',
                });
            }

            if (typeof data.currentPassword !== 'string') {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Current Password  is not in string type.',
                });
            }

            if (!data.newPassword) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'New Password  must be present.',
                });
            }

            if (typeof data.newPassword !== 'string') {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'New Password is not in string type.',
                });
            }

            if (!data.confirmPassword) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Confirm Password must be present.',
                });
            }

            if (typeof data.confirmPassword !== 'string') {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Confirm Password  is not in string type.',
                });
            }

            if (data.confirmPassword !== data.newPassword) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'New Password does not match confirm password.',
                });
            }

            if (data.currentPassword === data.newPassword) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message:
                        'New password should not be the same as current password.',
                });
            }

            const user: $TSFixMe = await UserService.changePassword(data);
            const userObj: $TSFixMe = {
                id: user._id,
                name: user.name,
                email: user.email,
                redirect: data.redirect,
                tokens: {
                    jwtAccessToken: `${jwt.sign(
                        {
                            id: user._id,
                        },
                        jwtSecretKey,
                        { expiresIn: 8640000 }
                    )}`,
                    jwtRefreshToken: user.jwtRefreshToken,
                },
            };
            return sendItemResponse(req, res, userObj);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// Route
// Description: Get Previous User Settings.
// Params:
// Param 1: req.headers-> {authorization}; req.user-> {id};
// Returns: 200: Success, 400: Error; 500: Server Error.
router.get(
    '/profile',
    getUser,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const userId: $TSFixMe = req.user ? req.user.id : null;

            if (!userId) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'UserId must be present.',
                });
            }
            // Call the UserService
            const select: $TSFixMe =
                'name email isVerified jwtRefreshToken companyName companyRole companySize referral companyPhoneNumber profilePic twoFactorAuthEnabled timezone role alertPhoneNumber tempAlertPhoneNumber identification';
            const user: $TSFixMe = await UserService.findOneBy({
                query: { _id: userId },
                select,
            });
            const userObj: $TSFixMe = {
                id: user._id,
                name: user.name ? user.name : '',
                email: user.email ? user.email : '',
                companyName: user.companyName,
                companyRole: user.companyRole,
                companySize: user.companySize,
                referral: user.referral,
                isVerified: user.isVerified,
                twoFactorAuthEnabled: user.twoFactorAuthEnabled,
                backupCodes: user.backupCodes,
                companyPhoneNumber: user.companyPhoneNumber
                    ? user.companyPhoneNumber
                    : '',
                alertPhoneNumber: user.alertPhoneNumber
                    ? user.alertPhoneNumber
                    : '',
                profilePic: user.profilePic,
                timezone: user.timezone ? user.timezone : '',
                tokens: {
                    jwtAccessToken: `${jwt.sign(
                        {
                            id: user._id,
                        },
                        jwtSecretKey,
                        { expiresIn: 8640000 }
                    )}`,
                    jwtRefreshToken: user.jwtRefreshToken,
                },
                tempEmail: user.tempEmail || null,
                tempAlertPhoneNumber: user.tempAlertPhoneNumber || null,
                role: user.role || null,
                identification: user.identification,
            };
            return sendItemResponse(req, res, userObj);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/confirmation/:token',
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            if (req.params && req.params.token) {
                const token: $TSFixMe = await VerificationTokenModel.findOne({
                    token: req.params.token,
                });
                if (!token) {
                    return res.redirect(
                        global.accountsHost +
                            '/user-verify/resend?status=link-expired'
                    );
                }
                const user: $TSFixMe = await UserModel.findOne({
                    _id: token.userId,
                });
                if (!user) {
                    return res.redirect(
                        global.accountsHost + '/register?status=user-not-found'
                    );
                }
                if (
                    user.isVerified &&
                    (!user.tempEmail ||
                        (user.tempEmail && user.tempEmail === user.email))
                ) {
                    return res.redirect(
                        global.accountsHost + '/login?status=already-verified'
                    );
                }
                let dataUpdate: $TSFixMe = { isVerified: true };
                if (user.tempEmail && user.tempEmail !== user.email) {
                    dataUpdate = {
                        isVerified: true,

                        email: user.tempEmail,
                        tempEmail: null,
                    };
                }
                await UserModel.findByIdAndUpdate(user._id, {
                    $set: dataUpdate,
                });

                return res.redirect(
                    global.accountsHost + '/login?status=verified'
                );
            } else {
                return res.redirect(
                    global.accountsHost +
                        '/user-verify/resend?status=invalid-verification-link'
                );
            }
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.post('/resend', async (req: ExpressRequest, res: ExpressResponse) => {
    if (req.body && req.body.email) {
        const { email, userId }: $TSFixMe = req.body;
        let user: $TSFixMe;
        if (!userId) {
            user = await UserModel.findOne({ email });
            if (!user) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'No user associated with this account',
                });
            }
        } else {
            user = await UserModel.findOne({ _id: userId });
            if (!user) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'No user associated with this account',
                });
            }
            const checkUser: $TSFixMe = await UserModel.findOne({ email });
            if (checkUser && checkUser.id !== user.id) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'User already registered with this email',
                });
            }
        }
        if (user.isVerified && user.email === email) {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('User has already been verified.')
            );
        }
        const token: $TSFixMe = await UserService.sendToken(user, email);
        if (token) {
            res.status(200).send(
                `A verification email has been sent to ${user.email}`
            );
        }
    } else {
        return sendErrorResponse(req, res, {
            code: 400,
            message: 'Email should be present',
        });
    }
});

router.get(
    '/users',
    getUser,
    isUserMasterAdmin,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const skip: $TSFixMe = req.query['skip'] || 0;
            const limit: $TSFixMe = req.query['limit'] || 10;
            const [users, count]: $TSFixMe = await Promise.all([
                UserService.getAllUsers(skip, limit),
                UserService.countBy({
                    _id: { $ne: null },
                    deleted: { $ne: null },
                }),
            ]);
            return sendListResponse(req, res, users, count);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/users/:userId',
    getUser,
    isUserMasterAdmin,
    async (req, res): void => {
        try {
            const userId: $TSFixMe = req.params.userId;
            const select: $TSFixMe =
                'createdAt name email tempEmail isVerified sso jwtRefreshToken companyName companyRole companySize referral companyPhoneNumber onCallAlert profilePic twoFactorAuthEnabled stripeCustomerId timeZone lastActive disabled paymentFailedDate role isBlocked adminNotes deleted deletedById alertPhoneNumber tempAlertPhoneNumber tutorial identification source isAdminMode';
            const user: $TSFixMe = await UserService.findOneBy({
                query: { _id: userId, deleted: { $ne: null } },
                select,
            });

            return sendItemResponse(req, res, user);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.delete(
    '/:userId',
    getUser,
    isUserMasterAdmin,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const userId: $TSFixMe = req.params.userId;

            const authUserId: $TSFixMe = req.user.id;
            if (userId === authUserId) {
                const err: $TSFixMe = new Error(
                    "Invalid operation! You can't perform this operation on your own account"
                );

                err.code = 400;
                throw err;
            }

            const masterUserId: $TSFixMe = req.user.id || null;
            const user: $TSFixMe = await UserService.deleteBy(
                { _id: userId },
                masterUserId
            );
            return sendItemResponse(req, res, user);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.put(
    '/:userId/restoreUser',
    getUser,
    isUserMasterAdmin,
    async (req, res): void => {
        try {
            const userId: $TSFixMe = req.params.userId;

            const authUserId: $TSFixMe = req.user.id;
            if (userId === authUserId) {
                const err: $TSFixMe = new Error(
                    "Invalid operation! You can't perform this operation on your own account"
                );

                err.code = 400;
                throw err;
            }
            const user: $TSFixMe = await UserService.restoreBy({
                _id: userId,
                deleted: true,
            });
            return sendItemResponse(req, res, user);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.put(
    '/:userId/blockUser',
    getUser,
    isUserMasterAdmin,
    async (req, res): void => {
        try {
            const userId: $TSFixMe = req.params.userId;

            const authUserId: $TSFixMe = req.user.id;
            if (userId === authUserId) {
                const err: $TSFixMe = new Error(
                    "Invalid operation! You can't perform this operation on your own account"
                );

                err.code = 400;
                throw err;
            }
            const user: $TSFixMe = await UserService.updateOneBy(
                { _id: userId },
                { isBlocked: true }
            );
            return sendItemResponse(req, res, user);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.put(
    '/:userId/unblockUser',
    getUser,
    isUserMasterAdmin,
    async (req, res): void => {
        try {
            const userId: $TSFixMe = req.params.userId;

            const authUserId: $TSFixMe = req.user.id;
            if (userId === authUserId) {
                const err: $TSFixMe = new Error(
                    "Invalid operation! You can't perform this operation on your own account"
                );

                err.code = 400;
                throw err;
            }
            const user: $TSFixMe = await UserService.updateOneBy(
                { _id: userId },
                { isBlocked: false }
            );
            return sendItemResponse(req, res, user);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// Route
// Description: Switch user account to admin mode.
// Params:
// Param 1: req.body-> {temporaryPassword}; req.headers-> {authorization}; req.user-> {id};
// Returns: 200: Success, 400: Error; 401: Unauthorized; 500: Server Error.
router.post(
    '/:userId/switchToAdminMode',
    getUser,
    isUserMasterAdmin,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const userId: $TSFixMe = req.params.userId;

            const authUserId: $TSFixMe = req.user.id;
            if (userId === authUserId) {
                const err: $TSFixMe = new Error(
                    "Invalid operation! You can't perform this operation on your own account"
                );

                err.code = 400;
                throw err;
            }
            const { temporaryPassword }: $TSFixMe = req.body;
            const user: $TSFixMe = await UserService.switchToAdminMode(
                userId,
                temporaryPassword
            );
            return sendItemResponse(req, res, user);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// Route
// Description: Switch off admin mode for user account
// Params:
// Param 1: req.headers-> {authorization}; req.user-> {id};
// Returns: 200: Success, 400: Error; 401: Unauthorized; 500: Server Error.
router.post(
    '/:userId/exitAdminMode',
    getUser,
    isUserMasterAdmin,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const userId: $TSFixMe = req.params.userId;

            const authUserId: $TSFixMe = req.user.id;
            if (userId === authUserId) {
                const err: $TSFixMe = new Error(
                    "Invalid operation! You can't perform this operation on your own account"
                );

                err.code = 400;
                throw err;
            }
            const user: $TSFixMe = await UserService.exitAdminMode(userId);
            return sendItemResponse(req, res, user);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.post(
    '/:userId/addNote',
    getUser,
    isUserMasterAdmin,
    async (req, res): void => {
        try {
            const userId: $TSFixMe = req.params.userId;
            if (Array.isArray(req.body)) {
                const data: $TSFixMe = [];
                if (req.body.length > 0) {
                    for (const val of req.body) {
                        if (!val._id) {
                            // Sanitize
                            if (!val.note) {
                                return sendErrorResponse(req, res, {
                                    code: 400,
                                    message: 'User note must be present.',
                                });
                            }

                            if (typeof val.note !== 'string') {
                                return sendErrorResponse(req, res, {
                                    code: 400,
                                    message:
                                        'User note is not in string format.',
                                });
                            }
                        }
                        data.push(val);
                    }

                    const user: $TSFixMe = await UserService.addNotes(
                        userId,
                        data
                    );
                    return sendItemResponse(req, res, user);
                } else {
                    const user: $TSFixMe = await UserService.addNotes(
                        userId,
                        data
                    );
                    return sendItemResponse(req, res, user);
                }
            } else {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Admin notes are expected in array format.',
                });
            }
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.post(
    '/users/search',
    getUser,
    isUserMasterAdmin,
    async (req, res): void => {
        try {
            const filter: $TSFixMe = req.body.filter;
            const skip: $TSFixMe = req.query['skip'] || 0;
            const limit: $TSFixMe = req.query['limit'] || 10;
            const [users, count]: $TSFixMe = await Promise.all([
                UserService.searchUsers(
                    {
                        deleted: { $ne: null },
                        $or: [
                            {
                                name: {
                                    $regex: new RegExp(filter),
                                    $options: 'i',
                                },
                            },
                            {
                                email: {
                                    $regex: new RegExp(filter),
                                    $options: 'i',
                                },
                            },
                        ],
                    },
                    skip,
                    limit
                ),
                UserService.countBy({
                    deleted: { $ne: null },
                    $or: [
                        { name: { $regex: new RegExp(filter), $options: 'i' } },
                        {
                            email: {
                                $regex: new RegExp(filter),
                                $options: 'i',
                            },
                        },
                    ],
                }),
            ]);

            return sendListResponse(req, res, users, count);
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

// Route
// Description: Delete user account.
// Params:
// Param 1: req.headers-> {authorization}; req.user-> {id};
// Returns: 200: Success, 400: Error; 401: Unauthorized; 500: Server Error.
router.delete(
    '/:userId/delete',
    getUser,
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            if (req.params.userId !== req.user.id) {
                return sendErrorResponse(req, res, {
                    code: 401,
                    message: 'You are unauthorized to access the page',
                });
            }

            const userId: $TSFixMe = req.user.id;
            const user: $TSFixMe = await UserService.findOneBy({
                query: { _id: userId },
                select: 'projects',
            });
            if (!user) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'No user associated with this account',
                });
            }
            const { deleteMyAccount }: $TSFixMe = req.body;
            if (deleteMyAccount !== 'DELETE MY ACCOUNT') {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'No confirmation was provided by the user',
                });
            }

            const { projects }: $TSFixMe = user;
            projects
                .filter((project: $TSFixMe) => {
                    return project.users.find(
                        (user: $TSFixMe) =>
                            user.userId === userId &&
                            user.role === 'Owner' &&
                            project.users.length > 1
                    );
                })
                .forEach(async (project: $TSFixMe) => {
                    const { _id: projectId } = project;

                    await ProjectService.exitProject(projectId, userId);
                });

            projects
                .filter((project: $TSFixMe) => {
                    return project.users.find(
                        (user: $TSFixMe) =>
                            (user.userId === userId && user.role !== 'Owner') ||
                            (user.userId === userId &&
                                user.role === 'Owner' &&
                                project.users.length === 1)
                    );
                })
                .forEach(async (project: $TSFixMe) => {
                    const { _id: projectId, users } = project;
                    const user: $TSFixMe = users.find(
                        (user: $TSFixMe) => user.userId === userId
                    );
                    if (user) {
                        if (user.role === 'Owner') {
                            await ProjectService.deleteBy(
                                { _id: projectId },
                                userId
                            );
                        } else {
                            await ProjectService.exitProject(projectId, userId);
                        }
                    }
                });
            const deletedUser: $TSFixMe = await UserService.deleteBy(
                { _id: userId },
                userId
            );
            return sendItemResponse(req, res, { user: deletedUser });
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

router.get(
    '/:token/email',
    async (req: ExpressRequest, res: ExpressResponse) => {
        try {
            const token: $TSFixMe = await VerificationTokenModel.findOne({
                token: req.params.token,
            }).populate('userId', 'email');

            return sendItemResponse(req, res, { token });
        } catch (error) {
            return sendErrorResponse(req, res, error as Exception);
        }
    }
);

export default router;
