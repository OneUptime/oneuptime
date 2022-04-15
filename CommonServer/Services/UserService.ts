import PositiveNumber from 'Common/Types/PositiveNumber';
import BadDataException from 'Common/Types/Exception/BadDataException';

import bcrypt from 'bcrypt';

import constants from '../config/constants.json';
import UserModel from '../Models/user';
import util from './utilService.js';
import randToken from 'rand-token';
import PaymentService from './PaymentService';
import crypto from 'crypto';
import ProjectService from './ProjectService';
import ErrorService from '../Utils/error';

import jwt from 'jsonwebtoken';

import geoip from 'geoip-lite';
const jwtSecretKey: $TSFixMe = process.env['JWT_SECRET'];

import { IS_SAAS_SERVICE, IS_TESTING } from '../config/server';
const { NODE_ENV }: $TSFixMe = process.env;
import VerificationTokenModel from '../Models/verificationToken';
import ObjectID from 'Common/Types/ObjectID';
import MailService from '../../MailService/Services/MailService';
import AirtableService from './AirtableService';

import speakeasy from 'speakeasy';
import { hotp } from 'otplib';
import LoginHistoryService from './LoginHistoryService';
import Query from '../Types/DB/Query';

import Model, {
    requiredFields,
    uniqueFields,
    slugifyField,
    encryptedFields,
} from '../Models/User';
import DatabaseService from './DatabaseService';
import CreateBy from '../Types/DB/CreateBy';

class Service extends DatabaseService<typeof Model> {
    public constructor() {
        super({
            model: Model,
            requiredFields: requiredFields,
            uniqueFields: uniqueFields,
            friendlyName: 'User',
            publicListProps: {
                populate: [],
                select: [],
            },
            adminListProps: {
                populate: [],
                select: [],
            },
            ownerListProps: {
                populate: [],
                select: [],
            },
            memberListProps: {
                populate: [],
                select: [],
            },
            viewerListProps: {
                populate: [],
                select: [],
            },
            publicItemProps: {
                populate: [],
                select: [],
            },
            adminItemProps: {
                populate: [],
                select: [],
            },
            memberItemProps: {
                populate: [],
                select: [],
            },
            viewerItemProps: {
                populate: [],
                select: [],
            },
            ownerItemProps: {
                populate: [],
                select: [],
            },
            isResourceByProject: false,
            slugifyField: slugifyField,
            encryptedFields: encryptedFields,
        });
    }

    // async addUserToDefaultProjects({ domain, userId }: $TSFixMe):void {

    //     const populateDefaultRoleSso: $TSFixMe = [
    //         { path: 'domain', select: '_id domain' },
    //         { path: 'project', select: '_id name' },
    //     ];

    //     const ssoDefaultRoles: $TSFixMe = await this.findBy({
    //         query: { domain },
    //         select: 'project role',
    //         populate: populateDefaultRoleSso,
    //     });

    //     if (!ssoDefaultRoles.length) return;

    //     for (const ssoDefaultRole of ssoDefaultRoles) {
    //         const { project, role }: $TSFixMe = ssoDefaultRole;
    //         const { _id: projectId } = project;

    //         const projectObj: $TSFixMe = await ProjectService.findOneBy({
    //             query: { _id: projectId },
    //             select: 'users',
    //         });
    //         if (!projectObj) continue;

    //         const { users }: $TSFixMe = projectObj;
    //         users.push({
    //             userId,
    //             role,
    //         });
    //         await ProjectService.updateOneBy({ _id: projectId }, { users });
    //     }
    // }

    protected override async onBeforeCreate({
        data,
    }: CreateBy): Promise<CreateBy> {
        if (data.get('password')) {
            const hash: $TSFixMe = await bcrypt.hash(
                data.get('password'),
                constants.saltRounds
            );
            data.set('password', hash);
        }

        data.set('jwtRefreshToken', randToken.uid(256));

        return Promise.resolve({ data } as CreateBy);
    }

    public async updatePush({ userId, data }: $TSFixMe): void {
        const user: $TSFixMe = await UserModel.findOne({ _id: userId });
        const checkExist: $TSFixMe = await user.identification.find(
            (user: $TSFixMe) => {
                return String(user.userAgent) === String(data.userAgent);
            }
        );
        if (!data.checked) {
            const findIndex: $TSFixMe = await user.identification.findIndex(
                (user: $TSFixMe) => {
                    return String(user.userAgent) === String(data.userAgent);
                }
            );
            await user.identification.splice(findIndex, 1);
        } else {
            if (!checkExist) {
                await user.identification.push(data);
            }
        }
        const userData: $TSFixMe = await this.updateOneBy(
            { _id: user._id },
            { identification: user.identification }
        );
        return userData;
    }

    public async closeTutorialBy(
        query: Query,
        type: $TSFixMe,
        data: $TSFixMe,
        projectId: ObjectID
    ): void {
        if (!query) {
            query = {};
        }
        if (!data) {
            data = {};
        }

        type = type.replace(/-([a-z])/g, (g: $TSFixMe): void => {
            return g[1].toUpperCase();
        });

        // if projectID is passed, get the current tutorial status
        const currentStatus: $TSFixMe = data[projectId] || {};
        currentStatus[type] = { show: false }; // overwrite that current type under that project
        data[projectId] = currentStatus; // update the data object then

        const tutorial: $TSFixMe = await UserModel.findOneAndUpdate(
            query,
            { $set: { tutorial: data } },
            { new: true }
        );
        return tutorial || null;
    }

    public async sendToken(user: $TSFixMe, email: $TSFixMe): void {
        const verificationTokenModel: $TSFixMe = new VerificationTokenModel({
            userId: user._id,
            token: crypto.randomBytes(16).toString('hex'),
        });
        const verificationToken: $TSFixMe = await verificationTokenModel.save();
        if (verificationToken) {
            const verificationTokenURL: string = `${global.apiHost}/user/confirmation/${verificationToken.token}`;
            // Checking for already verified user so that he/she will not recieve another email verification

            if (!user.isVerified) {
                MailService.sendVerifyEmail(
                    verificationTokenURL,
                    user.name,
                    email
                );
            }

            if (email !== user.email) {
                this.updateOneBy({ _id: user._id }, { tempEmail: email }).catch(
                    (error: Error) => {
                        ErrorService.log(
                            'UserService.sendToken > UserService.updateOneBy',
                            error
                        );
                    }
                );
            }
        }

        return verificationToken.token;
    }

    //Description: signup function for new user.
    //Params:
    //Param 1: data: User details.
    //Returns: promise.
    public async signup(data: $TSFixMe): void {
        const email: $TSFixMe = data.email;
        const stripePlanId: $TSFixMe = data.planId || null;
        const paymentIntent: $TSFixMe = data.paymentIntent || null;

        if (util.isEmailValid(email)) {
            let user: $TSFixMe = await this.findOneBy({
                query: { email: email },
                select: '_id',
            });

            if (user) {
                throw new BadDataException('User already exists.');
            } else {
                let customerId: $TSFixMe, subscription: $TSFixMe;
                if (IS_SAAS_SERVICE && paymentIntent !== null) {
                    // Check here is the payment intent is successfully paid. If yes then create the customer else not.
                    const processedPaymentIntent: $TSFixMe =
                        await PaymentService.checkPaymentIntent(paymentIntent);
                    if (processedPaymentIntent.status !== 'succeeded') {
                        const error: $TSFixMe = new Error(
                            'Unsuccessful attempt to charge card'
                        );

                        error.code = 400;
                        throw error;
                    }
                    customerId = processedPaymentIntent.customer;
                }
                // IS_SAAS_SERVICE: save a user only when payment method is charged and then next steps
                user = await this.create(data);

                if (IS_SAAS_SERVICE && paymentIntent !== null) {
                    //update customer Id
                    user = await this.updateOneBy(
                        { _id: user._id },
                        {
                            stripeCustomerId: customerId,
                            isVerified: customerId ? true : false,
                        }
                    );
                    subscription = await PaymentService.subscribePlan(
                        stripePlanId,
                        customerId,
                        data.coupon
                    );
                }
                let verificationToken: $TSFixMe;
                if (user.role !== 'master-admin' || !customerId) {
                    verificationToken = await this.sendToken(user, user.email);
                }

                const projectName: string = 'Unnamed Project';
                const projectData: $TSFixMe = {
                    name: projectName,
                    userId: user._id,
                    stripePlanId: stripePlanId,
                    stripeSubscriptionId: subscription
                        ? subscription.stripeSubscriptionId
                        : null,
                };
                await ProjectService.create(projectData);

                const createdAt: $TSFixMe = new Date(user.createdAt)
                    .toISOString()
                    .split('T', 1);

                AirtableService.logUser({
                    name: data.name,
                    email: data.email,
                    phone: data.companyPhoneNumber,
                    company: data.companyName,
                    jobRole: data.companyRole,
                    source: data.source,
                    createdAt,
                });

                if (IS_TESTING) {
                    user.verificationToken = verificationToken;
                }

                return user;
            }
        } else {
            throw new BadDataException('Email is not in valid format.');
        }
    }

    public async getUserIpLocation(clientIP: $TSFixMe): void {
        try {
            const geo: $TSFixMe = geoip.lookup(clientIP);
            if (geo) {
                geo.ip = clientIP;
                return geo;
            }
            return {};
        } catch (error) {
            return {};
        }
    }

    public async generateUserBackupCodes(
        secretKey: $TSFixMe,
        numberOfCodes: $TSFixMe,
        firstCounter = 0
    ): void {
        hotp.options = { digits: 8 };
        const backupCodes: $TSFixMe = [];

        for (let i: $TSFixMe = 0; i < numberOfCodes; i++) {
            const counter: $TSFixMe = firstCounter + i;
            const token: $TSFixMe = hotp.generate(secretKey, counter);
            backupCodes.push({ code: token, counter });
        }

        return backupCodes;
    }

    public async verifyUserBackupCode(
        code: $TSFixMe,
        secretKey: $TSFixMe,
        counter: $TSFixMe
    ): void {
        hotp.options = { digits: 8 };
        const isValid: $TSFixMe = hotp.check(code, secretKey, counter);
        if (isValid) {
            const select: $TSFixMe =
                'createdAt name email tempEmail isVerified sso jwtRefreshToken companyName companyRole companySize referral companyPhoneNumber onCallAlert profilePic twoFactorAuthEnabled stripeCustomerId timeZone lastActive disabled paymentFailedDate role isBlocked adminNotes deleted deletedById alertPhoneNumber tempAlertPhoneNumber tutorial identification source isAdminMode';
            const user: $TSFixMe = await this.findOneBy({
                query: { twoFactorSecretCode: secretKey },
                select,
            });
            const backupCodes: $TSFixMe = user.backupCodes.map(
                (backupCode: $TSFixMe) => {
                    if (backupCode.code === code) {
                        backupCode.used = true;
                    }
                    return backupCode;
                }
            );
            await this.updateOneBy(
                { twoFactorSecretCode: secretKey },
                { backupCodes }
            );
            return user;
        }
        return isValid;
    }

    public async generateTwoFactorSecret(userId: ObjectID): void {
        const user: $TSFixMe = await this.findOneBy({
            query: { _id: userId },
            select: 'email',
        });
        const secretCode: $TSFixMe = speakeasy.generateSecret({
            length: 20,
            name: `OneUptime (${user.email})`,
        });
        const backupCodes: $TSFixMe = await this.generateUserBackupCodes(
            secretCode.base32,
            8
        );
        const data: $TSFixMe = {
            twoFactorSecretCode: secretCode.base32,
            otpauth_url: secretCode.otpauth_url,
            backupCodes,
        };
        await this.updateOneBy({ _id: userId }, data);
        return { otpauth_url: secretCode.otpauth_url };
    }

    public async verifyAuthToken(token: $TSFixMe, userId: ObjectID): void {
        const user: $TSFixMe = await this.findOneBy({
            query: { _id: userId },
            select: '_id twoFactorSecretCode',
        });
        const isValidCode: $TSFixMe = speakeasy.totp.verify({
            secret: user.twoFactorSecretCode,
            encoding: 'base32',
            token: token,
        });
        if (isValidCode) {
            const updatedUser: $TSFixMe = await this.updateOneBy(
                { _id: user._id },
                { twoFactorAuthEnabled: true }
            );
            return updatedUser;
        }
        return isValidCode;
    }

    //Description: login function to authenticate user.
    //Params:
    //Param 1: email: User email.
    //Param 2: password: User password.
    //Returns: promise.
    public async login(
        email: $TSFixMe,
        password: $TSFixMe,
        clientIP: $TSFixMe,
        userAgent: $TSFixMe
    ): void {
        let user: $TSFixMe = null;
        if (util.isEmailValid(email)) {
            // find user if present in db.

            // If no users are in the DB, and is your have ADMIN_USERNAME and ADMIN_PASSWORD env var set,
            // then create an admin user and the log in.
            if (
                process.env.ADMIN_EMAIL &&
                process.env.ADMIN_PASSWORD &&
                email === process.env.ADMIN_EMAIL.toLowerCase() &&
                process.env.ADMIN_PASSWORD === password
            ) {
                const count: $TSFixMe = await this.countBy({});
                if (count === 0) {
                    //create a new admin user.
                    user = await this.create({
                        name: 'OneUptime Admin',
                        email: process.env.ADMIN_EMAIL,
                        password: process.env.ADMIN_PASSWORD,
                        role: 'master-admin',
                    });
                }
            }

            const select: $TSFixMe =
                'createdAt password cachedPassword name email tempEmail isVerified sso jwtRefreshToken companyName companyRole companySize referral companyPhoneNumber onCallAlert profilePic twoFactorAuthEnabled stripeCustomerId timeZone lastActive disabled paymentFailedDate role isBlocked adminNotes deleted deletedById alertPhoneNumber tempAlertPhoneNumber tutorial identification source isAdminMode';
            user = await this.findOneBy({
                query: { email: email },
                select,
            });

            if (!user) {
                throw new BadDataException('User does not exist.');
            } else if (user.sso) {
                const error: $TSFixMe = new Error(
                    'This domain is configured as SSO. Please use SSO to log in to your account'
                );

                error.code = 401;
                throw error;
            } else {
                if (user.paymentFailedDate && IS_SAAS_SERVICE) {
                    // calculate number of days the subscription renewal has failed.
                    const oneDayInMilliSeconds: $TSFixMe = 1000 * 60 * 60 * 24;
                    const daysAfterPaymentFailed: $TSFixMe = Math.round(
                        (new Date() - user.paymentFailedDate) /
                            oneDayInMilliSeconds
                    );

                    if (daysAfterPaymentFailed >= 15) {
                        user = await this.updateOneBy(
                            { _id: user._id },
                            { disabled: true }
                        );

                        const error: $TSFixMe = new Error(
                            'Your account has been disabled. Kindly contact support@oneuptime.com'
                        );

                        error.code = 400;
                        throw error;
                    }
                }
                const encryptedPassword: $TSFixMe = user.password;

                if (user.disabled) {
                    const error: $TSFixMe = new BadDataException(
                        'Your account has been disabled. Kindly contact support@oneuptime.com'
                    );
                    throw error;
                }
                if (
                    user.role !== 'master-admin' &&
                    !user.isVerified &&
                    NODE_ENV !== 'development'
                ) {
                    const error: $TSFixMe = new Error(
                        'Verify your email first.'
                    );

                    error.code = 401;
                    throw error;
                }
                if (!encryptedPassword) {
                    const error: $TSFixMe = new BadDataException(
                        'Your account does not exist. Please sign up.'
                    );
                    throw error;
                } else {
                    const res: $TSFixMe = await bcrypt.compare(
                        password,
                        encryptedPassword
                    );

                    if (
                        res &&
                        user.twoFactorAuthEnabled &&
                        !user.isAdminMode // ignore 2FA in admin mode
                    ) {
                        return { message: 'Login with 2FA token', email };
                    }

                    if (res) {
                        LoginHistoryService.create(
                            user,
                            clientIP,
                            userAgent,
                            'successful'
                        );
                        return user;
                    } else {
                        // show a different error message in admin mode as user most
                        // likely provided a wrong password
                        let error: $TSFixMe;
                        if (user.isAdminMode && user.cachedPassword) {
                            error = new Error(
                                'Your account is currently under maintenance. Please try again later'
                            );
                        } else {
                            error = new Error('Password is incorrect.');
                        }

                        LoginHistoryService.create(
                            user,
                            clientIP,
                            userAgent,
                            'incorrect password'
                        );

                        error.code = 400;
                        throw error;
                    }
                }
            }
        } else {
            throw new BadDataException('Email is not in valid format.');
        }
    }

    // Description: forgot password function
    //Params:
    //Param 1: email: User email.
    //Returns: promise.
    public async forgotPassword(email: $TSFixMe): void {
        if (util.isEmailValid(email)) {
            let user: $TSFixMe = await this.findOneBy({
                query: { email: email },
                select: 'isAdminMode cachedPassword _id',
            });

            if (!user) {
                throw new BadDataException('User does not exist.');
            } else {
                // ensure user is not in admin mode
                if (user.isAdminMode && user.cachedPassword) {
                    const error: $TSFixMe = new BadDataException(
                        'Your account is currently under maintenance. Please try again later'
                    );
                    throw error;
                }
                const buf: $TSFixMe = await crypto.randomBytes(20);
                const token: $TSFixMe = buf.toString('hex');

                //update a user.
                user = await this.updateOneBy(
                    {
                        _id: user._id,
                    },
                    {
                        resetPasswordToken: token,
                        resetPasswordExpires: Date.now() + 3600000, // 1 hour
                    }
                );

                return user;
            }
        } else {
            throw new BadDataException('Email is not in valid format.');
        }
    }

    // Description: forgot password function.
    //Params:
    //Param 1:  password: User password.
    //Param 2:  token: token generated in forgot password function.
    //Returns: promise.
    public async resetPassword(password: $TSFixMe, token: $TSFixMe): void {
        let user: $TSFixMe = await this.findOneBy({
            query: {
                resetPasswordToken: token,
                resetPasswordExpires: {
                    $gt: Date.now(),
                },
            },
            select: 'isAdminMode cachedPassword _id',
        });

        if (!user) {
            return null;
        } else {
            // ensure user is not in admin mode
            if (user.isAdminMode && user.cachedPassword) {
                const error: $TSFixMe = new Error(
                    'Your account is currently under maintenance. Please try again later'
                );

                error.code = 400;
                throw error;
            }

            const hash: $TSFixMe = await bcrypt.hash(
                password,
                constants.saltRounds
            );

            //update a user.
            user = await this.updateOneBy(
                {
                    _id: user._id,
                },
                {
                    password: hash,
                    resetPasswordToken: '',
                    resetPasswordExpires: '',
                }
            );

            return user;
        }
    }

    // Description: replace password temporarily in "admin mode"
    public async switchToAdminMode(
        userId: ObjectID,
        temporaryPassword: $TSFixMe
    ): void {
        if (!temporaryPassword) {
            const error: $TSFixMe = new Error(
                'A temporary password is required for admin mode'
            );

            error.code = 400;
            throw error;
        }

        const user: $TSFixMe = await this.findOneBy({
            query: { _id: userId },
            select: 'isAdminMode cachedPassword password',
        });

        if (!user) {
            throw new BadDataException('User not found');
        } else {
            const hash: $TSFixMe = await bcrypt.hash(
                temporaryPassword,
                constants.saltRounds
            );

            //update the user.
            // if already in admin mode we shouldn't
            // replace the cached/original password so we don't lose it
            const passwordToCache: $TSFixMe = user.isAdminMode
                ? user.cachedPassword
                : user.password;
            const updatedUser: $TSFixMe = await this.updateOneBy(
                {
                    _id: userId,
                },
                {
                    password: hash,
                    cachedPassword: passwordToCache,
                    isAdminMode: true,
                }
            );

            return updatedUser;
        }
    }

    // Descripiton: revert from admin mode and replce user password
    public async exitAdminMode(userId: ObjectID): void {
        const user: $TSFixMe = await this.findOneBy({
            query: { _id: userId },
            select: 'isAdminMode cachedPassword password',
        });

        if (!user) {
            throw new BadDataException('User not found');
        } else {
            // ensure user is in admin mode
            if (!user.isAdminMode) {
                throw new BadDataException(
                    'User is not currently in admin mode'
                );
            }

            //update the user.
            const passwordToRestore: $TSFixMe =
                user.cachedPassword ?? user.password; // unlikely but just in case cachedPassword is null
            const updatedUser: $TSFixMe = await this.updateOneBy(
                {
                    _id: userId,
                },
                {
                    password: passwordToRestore,
                    cachedPassword: null,
                    isAdminMode: false,
                }
            );

            return updatedUser;
        }
    }

    //Description: Get new access token.
    //Params:
    //Param 1:  refreshToken: Refresh token.
    //Returns: promise.
    public async getNewToken(refreshToken: $TSFixMe): void {
        let user: $TSFixMe = await this.findOneBy({
            query: { jwtRefreshToken: refreshToken },
            select: '_id',
        });

        if (!user) {
            throw new BadDataException('Invalid Refresh Token');
        } else {
            const userObj: $TSFixMe = { id: user._id };

            const accessToken: string = `${jwt.sign(userObj, jwtSecretKey, {
                expiresIn: 86400,
            })}`;
            const jwtRefreshToken: $TSFixMe = randToken.uid(256);

            user = await this.updateOneBy(
                { _id: user._id },
                { jwtRefreshToken: jwtRefreshToken }
            );

            const token: $TSFixMe = {
                accessToken: accessToken,
                refreshToken: refreshToken,
            };
            return token;
        }
    }

    public async changePassword(data: $TSFixMe): void {
        const currentPassword: $TSFixMe = data.currentPassword;
        let user: $TSFixMe = await this.findOneBy({
            query: { _id: data._id },
            select: 'isAdminMode cachedPassword password',
        });

        // ensure user is not in admin mode
        if (user.isAdminMode && user.cachedPassword) {
            const error: $TSFixMe = new Error(
                'Your account is currently under maintenance. Please try again later'
            );

            error.code = 400;
            throw error;
        }

        const encryptedPassword: $TSFixMe = user.password;

        const check: $TSFixMe = await bcrypt.compare(
            currentPassword,
            encryptedPassword
        );
        if (check) {
            const newPassword: $TSFixMe = data.newPassword;
            const hash: $TSFixMe = await bcrypt.hash(
                newPassword,
                constants.saltRounds
            );

            data.password = hash;
            user = await this.updateOneBy({ _id: data._id }, data);

            return user;
        } else {
            throw new BadDataException('Current Password is incorrect.');
        }
    }

    public async getAllUsers(
        skip: PositiveNumber,
        limit: PositiveNumber
    ): void {
        const select: $TSFixMe =
            'createdAt name email tempEmail isVerified sso jwtRefreshToken companyName companyRole companySize referral companyPhoneNumber onCallAlert profilePic twoFactorAuthEnabled stripeCustomerId timeZone lastActive disabled paymentFailedDate role isBlocked adminNotes deleted deletedById alertPhoneNumber tempAlertPhoneNumber tutorial identification source isAdminMode';
        let users: $TSFixMe = await this.findBy({
            query: { _id: { $ne: null }, deleted: { $ne: null } },
            skip,
            limit,
            select,
        });
        users = await Promise.all(
            users.map(async (user: $TSFixMe) => {
                // find user subprojects and parent projects

                let userProjects: $TSFixMe = await ProjectService.findBy({
                    query: { 'users.userId': user._id },
                    select: 'parentProjectId',
                });
                let parentProjectIds: $TSFixMe = [];
                let projectIds: $TSFixMe = [];
                if (userProjects.length > 0) {
                    const subProjects: $TSFixMe = userProjects
                        .map((project: $TSFixMe) => {
                            return project.parentProjectId ? project : null;
                        })
                        .filter((subProject: $TSFixMe) => {
                            return subProject !== null;
                        });
                    parentProjectIds = subProjects.map(
                        (subProject: $TSFixMe) => {
                            return (
                                subProject.parentProjectId._id ||
                                subProject.parentProjectId
                            );
                        }
                    );
                    const projects: $TSFixMe = userProjects
                        .map((project: $TSFixMe) => {
                            return project.parentProjectId ? null : project;
                        })
                        .filter((project: $TSFixMe) => {
                            return project !== null;
                        });
                    projectIds = projects.map((project: $TSFixMe) => {
                        return project._id;
                    });
                }
                const populate: $TSFixMe = [
                    { path: 'parentProjectId', select: 'name' },
                ];
                const select: $TSFixMe =
                    '_id slug name users stripePlanId stripeSubscriptionId parentProjectId seats deleted apiKey alertEnable alertLimit alertLimitReached balance alertOptions isBlocked adminNotes';

                userProjects = await ProjectService.findBy({
                    query: {
                        $or: [
                            { _id: { $in: parentProjectIds } },
                            { _id: { $in: projectIds } },
                        ],
                    },
                    select,
                    populate,
                });
                return await Object.assign({}, user._doc || user, {
                    projects: userProjects,
                });
            })
        );
        return users;
    }

    public async restoreBy(query: Query): void {
        query.deleted = true;

        const select: string = '_id';
        let user: $TSFixMe = await this.findBy({ query, select });
        if (user && user.length > 1) {
            const users: $TSFixMe = await Promise.all(
                user.map(async (user: $TSFixMe) => {
                    query._id = user._id;
                    user = await this.updateOneBy(query._id, {
                        deleted: false,
                        deletedBy: null,
                        deletedAt: null,
                    });
                    return user;
                })
            );
            return users;
        } else {
            user = user[0];
            if (user) {
                query._id = user._id;
                user = await this.updateOneBy(query, {
                    deleted: false,
                    deletedBy: null,
                    deletedAt: null,
                });
            }
            return user;
        }
    }

    public async addNotes(userId: ObjectID, notes: $TSFixMe): void {
        const user: $TSFixMe = await this.updateOneBy(
            {
                _id: userId,
            },
            {
                adminNotes: notes,
            }
        );
        return user;
    }

    public async searchUsers(
        query: Query,
        skip: PositiveNumber,
        limit: PositiveNumber
    ): void {
        const select: $TSFixMe =
            'createdAt name email tempEmail isVerified sso jwtRefreshToken companyName companyRole companySize referral companyPhoneNumber onCallAlert profilePic twoFactorAuthEnabled stripeCustomerId timeZone lastActive disabled paymentFailedDate role isBlocked adminNotes deleted deletedById alertPhoneNumber tempAlertPhoneNumber tutorial identification source isAdminMode';
        let users: $TSFixMe = await this.findBy({ query, skip, limit, select });
        users = await Promise.all(
            users.map(async (user: $TSFixMe) => {
                // find user subprojects and parent projects

                let userProjects: $TSFixMe = await ProjectService.findBy({
                    query: { 'users.userId': user._id },
                    select: 'parentProjectId',
                });
                let parentProjectIds: $TSFixMe = [];
                let projectIds: $TSFixMe = [];
                if (userProjects.length > 0) {
                    const subProjects: $TSFixMe = userProjects
                        .map((project: $TSFixMe) => {
                            return project.parentProjectId ? project : null;
                        })
                        .filter((subProject: $TSFixMe) => {
                            return subProject !== null;
                        });
                    parentProjectIds = subProjects.map(
                        (subProject: $TSFixMe) => {
                            return (
                                subProject.parentProjectId._id ||
                                subProject.parentProjectId
                            );
                        }
                    );
                    const projects: $TSFixMe = userProjects
                        .map((project: $TSFixMe) => {
                            return project.parentProjectId ? null : project;
                        })
                        .filter((project: $TSFixMe) => {
                            return project !== null;
                        });
                    projectIds = projects.map((project: $TSFixMe) => {
                        return project._id;
                    });
                }
                const populate: $TSFixMe = [
                    { path: 'parentProjectId', select: 'name' },
                ];
                const select: $TSFixMe =
                    '_id slug name users stripePlanId stripeSubscriptionId parentProjectId seats deleted apiKey alertEnable alertLimit alertLimitReached balance alertOptions isBlocked adminNotes';

                userProjects = await ProjectService.findBy({
                    query: {
                        $or: [
                            { _id: { $in: parentProjectIds } },
                            { _id: { $in: projectIds } },
                        ],
                    },
                    select,
                    populate,
                });
                return await Object.assign({}, user._doc || user, {
                    projects: userProjects,
                });
            })
        );
        return users;
    }

    public getAccessToken({ userId, expiresIn }: $TSFixMe): void {
        return jwt.sign(
            {
                id: userId,
            },
            jwtSecretKey,
            { expiresIn: expiresIn }
        );
    }
}
export default Service;
