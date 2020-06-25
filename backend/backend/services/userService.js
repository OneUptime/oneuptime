module.exports = {
    findBy: async function(query, skip, limit) {
        try {
            if (!skip) skip = 0;

            if (!limit) limit = 0;

            if (typeof skip === 'string') skip = parseInt(skip);

            if (typeof limit === 'string') limit = parseInt(limit);

            if (!query) query = {};

            if (!query.deleted) query.deleted = false;
            const users = await UserModel.find(query)
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip);
            return users;
        } catch (error) {
            ErrorService.log('userService.findBy', error);
            throw error;
        }
    },

    create: async function(data) {
        try {
            const userModel = new UserModel();
            userModel.name = data.name || null;
            userModel.email = data.email || null;
            userModel.role = data.role || 'user';
            userModel.companyName = data.companyName || null;
            userModel.companyRole = data.companyRole || null;
            userModel.companySize = data.companySize || null;
            userModel.referral = data.referral || null;
            userModel.companyPhoneNumber = data.companyPhoneNumber || null;
            userModel.onCallAlert = data.onCallAlert || null;
            userModel.profilePic = data.profilePic || null;
            userModel.stripeCustomerId = data.stripeCustomerId || null;
            userModel.resetPasswordToken = data.resetPasswordToken || null;
            userModel.resetPasswordExpires = data.resetPasswordExpires || null;
            userModel.createdAt = data.createdAt || Date.now();
            userModel.timezone = data.timezone || null;
            userModel.lastActive = data.lastActive || Date.now();
            userModel.coupon = data.coupon || null;
            userModel.adminNotes = data.adminNotes || null;
            userModel.tempEmail = data.tempEmail || null;
            userModel.twoFactorAuthEnabled = data.twoFactorAuthEnabled || false;
            userModel.twoFactorSecretCode = data.twoFactorSecretCode || null;
            userModel.otpauth_url = data.otpauth_url || null;
            if (data.password) {
                const hash = await bcrypt.hash(
                    data.password,
                    constants.saltRounds
                );
                userModel.password = hash;
            }
            // setting isVerified true for master admin
            if (data.role == 'master-admin') userModel.isVerified = true;
            userModel.jwtRefreshToken = randToken.uid(256);

            if (data.sso) userModel.sso = data.sso;

            const user = await userModel.save();
            return user;
        } catch (error) {
            ErrorService.log('userService.create', error);
            throw error;
        }
    },

    countBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            const count = await UserModel.countDocuments(query);
            return count;
        } catch (error) {
            ErrorService.log('userService.countBy', error);
            throw error;
        }
    },

    deleteBy: async function(query, userId) {
        try {
            if (!query) {
                query = {};
            }

            query.deleted = false;
            const user = await UserModel.findOneAndUpdate(
                query,
                {
                    $set: {
                        deleted: true,
                        deletedById: userId,
                        deletedAt: Date.now(),
                    },
                },
                {
                    new: true,
                }
            );
            return user;
        } catch (error) {
            ErrorService.log('userService.deleteBy', error);
            throw error;
        }
    },

    findOneBy: async function(query) {
        try {
            if (!query) {
                query = {};
            }
            if (!query.deleted) query.deleted = false;
            const user = await UserModel.findOne(query).sort([
                ['createdAt', -1],
            ]);
            if ((user && !IS_SAAS_SERVICE) || user) {
                // find user subprojects and parent projects
                let userProjects = await ProjectService.findBy({
                    'users.userId': user._id,
                });
                let parentProjectIds = [];
                let projectIds = [];
                if (userProjects.length > 0) {
                    const subProjects = userProjects
                        .map(project =>
                            project.parentProjectId ? project : null
                        )
                        .filter(subProject => subProject !== null);
                    parentProjectIds = subProjects.map(
                        subProject => subProject.parentProjectId._id
                    );
                    const projects = userProjects
                        .map(project =>
                            project.parentProjectId ? null : project
                        )
                        .filter(project => project !== null);
                    projectIds = projects.map(project => project._id);
                }
                userProjects = await ProjectService.findBy({
                    $or: [
                        { _id: { $in: parentProjectIds } },
                        { _id: { $in: projectIds } },
                    ],
                });
                return await Object.assign({}, user._doc, {
                    projects: userProjects,
                });
            }
            return user;
        } catch (error) {
            ErrorService.log('userService.findOneBy', error);
            throw error;
        }
    },

    updateOneBy: async function(query, data) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;

        if (data.role) delete data.role;
        if (data.airtableId) delete data.airtableId;
        if (data.tutorial) delete data.tutorial;
        if (data.paymentFailedDate) delete data.paymentFailedDate;
        if (data.alertPhoneNumber) delete data.alertPhoneNumber;
        if (typeof data.isBlocked !== 'boolean') {
            delete data.isBlocked;
        }

        try {
            const updatedUser = await UserModel.findOneAndUpdate(
                query,
                {
                    $set: data,
                },
                {
                    new: true,
                }
            );
            return updatedUser;
        } catch (error) {
            ErrorService.log('userService.updateOneBy', error);
            throw error;
        }
    },

    updateBy: async function(query, data) {
        try {
            if (!query) {
                query = {};
            }

            if (!query.deleted) query.deleted = false;
            let updatedData = await UserModel.updateMany(query, {
                $set: data,
            });
            updatedData = await this.findBy(query);
            return updatedData;
        } catch (error) {
            ErrorService.log('userService.updateMany', error);
            throw error;
        }
    },

    closeTutorialBy: async function(query, type, data) {
        try {
            if (!query) query = {};
            if (!data) data = {};

            type = type.replace(/-([a-z])/g, function(g) {
                return g[1].toUpperCase();
            });
            data[type] = { show: false };

            const tutorial = await UserModel.findOneAndUpdate(
                query,
                { $set: { tutorial: data } },
                { new: true }
            );
            return tutorial || null;
        } catch (error) {
            ErrorService.log('userService.closeTutorialBy', error);
            throw error;
        }
    },

    sendToken: async function(user, email) {
        try {
            const _this = this;
            const verificationTokenModel = new VerificationTokenModel({
                userId: user._id,
                token: crypto.randomBytes(16).toString('hex'),
            });
            const verificationToken = await verificationTokenModel.save();
            if (verificationToken) {
                const verificationTokenURL = `${global.apiHost}/user/confirmation/${verificationToken.token}`;
                MailService.sendVerifyEmail(
                    verificationTokenURL,
                    user.name,
                    email
                );
                if (email !== user.email) {
                    _this.updateOneBy({ _id: user._id }, { tempEmail: email });
                }
            }
            return verificationToken.token;
        } catch (error) {
            ErrorService.log('userService.sendToken', error);
            throw error;
        }
    },
    //Description: signup function for new user.
    //Params:
    //Param 1: data: User details.
    //Returns: promise.
    signup: async function(data) {
        try {
            const _this = this;
            const email = data.email;
            const stripePlanId = data.planId || null;
            const paymentIntent = data.paymentIntent || null;

            if (util.isEmailValid(email)) {
                let user = await _this.findOneBy({ email: email });

                if (user) {
                    const error = new Error('User already exists.');
                    error.code = 400;
                    ErrorService.log('userService.signup', error);
                    throw error;
                } else {
                    let customerId, subscription;

                    if (IS_SAAS_SERVICE) {
                        // Check here is the payment intent is successfully paid. If yes then create the customer else not.
                        const processedPaymentIntent = await PaymentService.checkPaymentIntent(
                            paymentIntent
                        );
                        if (processedPaymentIntent.status !== 'succeeded') {
                            const error = new Error(
                                'Unsuccessful attempt to charge card'
                            );
                            error.code = 400;
                            ErrorService.log(
                                'PaymentService.checkPaymentIntent',
                                error
                            );
                            throw error;
                        }
                        customerId = processedPaymentIntent.customer;
                    }
                    // IS_SAAS_SERVICE: save a user only when payment method is charged and then next steps
                    user = await _this.create(data);

                    const createdAt = new Date(user.createdAt)
                        .toISOString()
                        .split('T', 1);
                    const record = await AirtableService.logUser({
                        name: data.name,
                        email: data.email,
                        phone: data.companyPhoneNumber,
                        company: data.companyName,
                        jobRole: data.companyRole,
                        createdAt,
                    });

                    let verificationToken;
                    if (user.role !== 'master-admin') {
                        verificationToken = await _this.sendToken(
                            user,
                            user.email
                        );
                    }

                    if (IS_SAAS_SERVICE) {
                        //update customer Id
                        user = await _this.updateOneBy(
                            { _id: user._id },
                            { stripeCustomerId: customerId }
                        );
                        subscription = await PaymentService.subscribePlan(
                            stripePlanId,
                            customerId,
                            data.coupon
                        );
                    }

                    const projectName = 'Unnamed Project';
                    const projectData = {
                        name: projectName,
                        userId: user._id,
                        stripePlanId: stripePlanId,
                        stripeSubscriptionId: subscription
                            ? subscription.stripeSubscriptionId
                            : null,
                    };
                    await ProjectService.create(projectData);

                    if (record && record.id) {
                        user.airtableId = record.id;
                    } else {
                        user.airtableId = null;
                    }

                    if (IS_TESTING === 'true') {
                        user.verificationToken = verificationToken;
                    }

                    return user;
                }
            } else {
                const error = new Error('Email is not in valid format.');
                error.code = 400;
                ErrorService.log('userService.signup', error);
                throw error;
            }
        } catch (error) {
            ErrorService.log('userService.signup', error);
            throw error;
        }
    },
    getUserIpLocation: async function(clientIP) {
        try {
            const ipLocation = await iplocation(clientIP);
            return ipLocation;
        } catch (error) {
            return {};
        }
    },

    generateUserBackupCodes: async function(secretKey, numberOfCodes) {
        hotp.options = { digits: 8 };
        const backupCodes = [];

        for (let i = 0; i < numberOfCodes; i++) {
            const token = hotp.generate(secretKey, i);
            backupCodes.push({ code: token, counter: i });
        }
        return backupCodes;
    },

    verifyUserBackupCode: async function(code, secretKey, counter) {
        try {
            const _this = this;
            hotp.options = { digits: 8 };
            const isValid = hotp.check(code, secretKey, counter);
            if (isValid) {
                const user = await _this.findOneBy({
                    twoFactorSecretCode: secretKey,
                });
                return user;
            }
            return isValid;
        } catch (error) {
            ErrorService.log('userService.verifyUserBackupCode', error);
            throw error;
        }
    },

    generateTwoFactorSecret: async function(userId) {
        try {
            const _this = this;
            const user = await _this.findOneBy({ _id: userId });
            const secretCode = speakeasy.generateSecret({
                length: 20,
                name: `Fyipe (${user.email})`,
            });
            const backupCodes = await _this.generateUserBackupCodes(
                secretCode.base32,
                8
            );
            const data = {
                twoFactorSecretCode: secretCode.base32,
                otpauth_url: secretCode.otpauth_url,
                backupCodes,
            };
            await _this.updateOneBy({ _id: userId }, data);
            return { otpauth_url: secretCode.otpauth_url };
        } catch (error) {
            ErrorService.log('userService.generateTwoFactorSecret', error);
            throw error;
        }
    },

    verifyAuthToken: async function(token, userId) {
        try {
            const _this = this;
            const user = await _this.findOneBy({ _id: userId });
            const isValidCode = speakeasy.totp.verify({
                secret: user.twoFactorSecretCode,
                encoding: 'base32',
                token: token,
            });
            if (isValidCode) {
                const updatedUser = await _this.updateOneBy(
                    { _id: user._id },
                    { twoFactorAuthEnabled: true }
                );
                return updatedUser;
            }
            return isValidCode;
        } catch (error) {
            ErrorService.log('userService.verifyAuthToken', error);
            throw error;
        }
    },

    //Description: login function to authenticate user.
    //Params:
    //Param 1: email: User email.
    //Param 2: password: User password.
    //Returns: promise.
    login: async function(email, password, clientIP) {
        try {
            const _this = this;
            let user = null;
            if (util.isEmailValid(email)) {
                // find user if present in db.

                // If no users are in the DB, and is your have ADMIN_USERNAME and ADMIN_PASSWORD env var set,
                // then create an admin user and the log in.
                if (
                    process.env.ADMIN_EMAIL &&
                    process.env.ADMIN_PASSWORD &&
                    email === process.env.ADMIN_EMAIL &&
                    process.env.ADMIN_PASSWORD === password
                ) {
                    const count = await _this.countBy({});
                    if (count === 0) {
                        //create a new admin user.
                        user = await _this.create({
                            name: 'Fyipe Admin',
                            email: process.env.ADMIN_EMAIL,
                            password: process.env.ADMIN_PASSWORD,
                            role: 'master-admin',
                        });
                    }
                }

                user = await _this.findOneBy({ email: email });

                if (!user) {
                    const error = new Error('User does not exist.');
                    error.code = 400;
                    ErrorService.log('userService.login', error);
                    throw error;
                } else if (user.sso) {
                    const error = new Error(
                        'This domain is configured as SSO. Please use SSO to log in to your account'
                    );
                    error.code = 401;
                    ErrorService.log('userService.login', error);
                    throw error;
                } else {
                    const ipLocation = await _this.getUserIpLocation(clientIP);
                    await LoginIPLog.create({ userId: user._id, ipLocation });

                    if (user.paymentFailedDate && IS_SAAS_SERVICE) {
                        // calculate number of days the subscription renewal has failed.
                        const oneDayInMilliSeconds = 1000 * 60 * 60 * 24;
                        const daysAfterPaymentFailed = Math.round(
                            (new Date() - user.paymentFailedDate) /
                                oneDayInMilliSeconds
                        );

                        if (daysAfterPaymentFailed >= 15) {
                            user = await _this.updateOneBy(
                                { _id: user._id },
                                { disabled: true }
                            );

                            const error = new Error(
                                'Your account has been disabled. Kindly contact support@fyipe.com'
                            );
                            error.code = 400;
                            ErrorService.log('userService.login', error);
                            throw error;
                        }
                    }
                    const encryptedPassword = user.password;

                    if (user.disabled) {
                        const error = new Error(
                            'Your account has been disabled. Kindly contact support@fyipe.com'
                        );
                        error.code = 400;
                        ErrorService.log('userService.login', error);
                        throw error;
                    }
                    if (
                        user.role !== 'master-admin' &&
                        !user.isVerified &&
                        NODE_ENV !== 'development'
                    ) {
                        const error = new Error('Verify your email first.');
                        error.code = 401;
                        ErrorService.log('userService.login', error);
                        throw error;
                    }
                    if (!encryptedPassword) {
                        const error = new Error(
                            'Your account does not exist. Please sign up.'
                        );
                        error.code = 400;
                        ErrorService.log('userService.login', error);
                        throw error;
                    } else {
                        const res = await bcrypt.compare(
                            password,
                            encryptedPassword
                        );
                        if (user.twoFactorAuthEnabled) {
                            return { message: 'Login with 2FA token', email };
                        }

                        if (res) {
                            return user;
                        } else {
                            const error = new Error('Password is incorrect.');
                            error.code = 400;
                            ErrorService.log('userService.login', error);
                            throw error;
                        }
                    }
                }
            } else {
                const error = new Error('Email is not in valid format.');
                error.code = 400;
                ErrorService.log('userService.login', error);
                throw error;
            }
        } catch (error) {
            ErrorService.log('userService.login', error);
            throw error;
        }
    },

    // Description: forgot password function
    //Params:
    //Param 1: email: User email.
    //Returns: promise.
    forgotPassword: async function(email) {
        try {
            const _this = this;
            if (util.isEmailValid(email)) {
                let user = await this.findOneBy({ email: email });

                if (!user) {
                    const error = new Error('User does not exist.');
                    error.code = 400;
                    ErrorService.log('userService.forgotPassword', error);
                    throw error;
                } else {
                    const buf = await crypto.randomBytes(20);
                    const token = buf.toString('hex');

                    //update a user.
                    user = await _this.updateOneBy(
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
                const error = new Error('Email is not in valid format.');
                error.code = 400;
                ErrorService.log('userService.forgotPassword', error);
                throw error;
            }
        } catch (error) {
            ErrorService.log('userService.forgotPassword', error);
            throw error;
        }
    },

    // Description: forgot password function.
    //Params:
    //Param 1:  password: User password.
    //Param 2:  token: token generated in forgot password function.
    //Returns: promise.
    resetPassword: async function(password, token) {
        try {
            const _this = this;
            let user = await _this.findOneBy({
                resetPasswordToken: token,
                resetPasswordExpires: {
                    $gt: Date.now(),
                },
            });

            if (!user) {
                return null;
            } else {
                const hash = await bcrypt.hash(password, constants.saltRounds);

                //update a user.
                user = await _this.updateOneBy(
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
        } catch (error) {
            ErrorService.log('userService.resetPassword', error);
            throw error;
        }
    },

    //Description: Get new access token.
    //Params:
    //Param 1:  refreshToken: Refresh token.
    //Returns: promise.
    getNewToken: async function(refreshToken) {
        try {
            const _this = this;
            let user = await _this.findOneBy({ jwtRefreshToken: refreshToken });

            if (!user) {
                const error = new Error('Invalid Refresh Token');
                error.code = 400;
                ErrorService.log('userService.getNewToken', error);
                throw error;
            } else {
                const userObj = { id: user._id };

                const accessToken = `${jwt.sign(userObj, jwtSecretKey, {
                    expiresIn: 86400,
                })}`;
                const jwtRefreshToken = randToken.uid(256);

                user = await _this.updateOneBy(
                    { _id: user._id },
                    { jwtRefreshToken: jwtRefreshToken }
                );

                const token = {
                    accessToken: accessToken,
                    refreshToken: refreshToken,
                };
                return token;
            }
        } catch (error) {
            ErrorService.log('userService.getNewToken', error);
            throw error;
        }
    },

    changePassword: async function(data) {
        try {
            const _this = this;
            const currentPassword = data.currentPassword;
            let user = await _this.findOneBy({ _id: data._id });
            const encryptedPassword = user.password;

            const check = await bcrypt.compare(
                currentPassword,
                encryptedPassword
            );
            if (check) {
                const newPassword = data.newPassword;
                const hash = await bcrypt.hash(
                    newPassword,
                    constants.saltRounds
                );

                data.password = hash;
                user = await _this.updateOneBy({ _id: data._id }, data);

                return user;
            } else {
                const error = new Error('Current Password is incorrect.');
                error.code = 400;
                ErrorService.log('userService.changePassword', error);
                throw error;
            }
        } catch (error) {
            ErrorService.log('userService.changePassword', error);
            throw error;
        }
    },

    getAllUsers: async function(skip, limit) {
        const _this = this;
        let users = await _this.findBy(
            { _id: { $ne: null }, deleted: { $ne: null } },
            skip,
            limit
        );
        users = await Promise.all(
            users.map(async user => {
                // find user subprojects and parent projects
                let userProjects = await ProjectService.findBy({
                    'users.userId': user._id,
                });
                let parentProjectIds = [];
                let projectIds = [];
                if (userProjects.length > 0) {
                    const subProjects = userProjects
                        .map(project =>
                            project.parentProjectId ? project : null
                        )
                        .filter(subProject => subProject !== null);
                    parentProjectIds = subProjects.map(
                        subProject => subProject.parentProjectId._id
                    );
                    const projects = userProjects
                        .map(project =>
                            project.parentProjectId ? null : project
                        )
                        .filter(project => project !== null);
                    projectIds = projects.map(project => project._id);
                }
                userProjects = await ProjectService.findBy({
                    $or: [
                        { _id: { $in: parentProjectIds } },
                        { _id: { $in: projectIds } },
                    ],
                });
                return await Object.assign({}, user._doc, {
                    projects: userProjects,
                });
            })
        );
        return users;
    },

    restoreBy: async function(query) {
        const _this = this;
        query.deleted = true;

        let user = await _this.findBy(query);
        if (user && user.length > 1) {
            const users = await Promise.all(
                user.map(async user => {
                    const userId = user._id;
                    user = await _this.updateOneBy(
                        {
                            _id: userId,
                        },
                        {
                            deleted: false,
                            deletedBy: null,
                            deletedAt: null,
                        }
                    );
                    return user;
                })
            );
            return users;
        } else {
            user = user[0];
            if (user) {
                const userId = user._id;
                user = await _this.updateOneBy(
                    {
                        _id: userId,
                    },
                    {
                        deleted: false,
                        deletedBy: null,
                        deletedAt: null,
                    }
                );
            }
            return user;
        }
    },

    addNotes: async function(userId, notes) {
        const _this = this;
        const adminNotes = (
            await _this.updateOneBy(
                {
                    _id: userId,
                },
                {
                    adminNotes: notes,
                }
            )
        ).adminNotes;
        return adminNotes;
    },

    searchUsers: async function(query, skip, limit) {
        const _this = this;
        let users = await _this.findBy(query, skip, limit);
        users = await Promise.all(
            users.map(async user => {
                // find user subprojects and parent projects
                let userProjects = await ProjectService.findBy({
                    'users.userId': user._id,
                });
                let parentProjectIds = [];
                let projectIds = [];
                if (userProjects.length > 0) {
                    const subProjects = userProjects
                        .map(project =>
                            project.parentProjectId ? project : null
                        )
                        .filter(subProject => subProject !== null);
                    parentProjectIds = subProjects.map(
                        subProject => subProject.parentProjectId._id
                    );
                    const projects = userProjects
                        .map(project =>
                            project.parentProjectId ? null : project
                        )
                        .filter(project => project !== null);
                    projectIds = projects.map(project => project._id);
                }
                userProjects = await ProjectService.findBy({
                    $or: [
                        { _id: { $in: parentProjectIds } },
                        { _id: { $in: projectIds } },
                    ],
                });
                return await Object.assign({}, user._doc, {
                    projects: userProjects,
                });
            })
        );
        return users;
    },

    hardDeleteBy: async function(query) {
        try {
            await UserModel.deleteMany(query);
            return 'User(s) Removed Successfully!';
        } catch (error) {
            ErrorService.log('userService.hardDeleteBy', error);
            throw error;
        }
    },

    getAccessToken: function({ userId, expiresIn }) {
        return jwt.sign(
            {
                id: userId,
            },
            jwtSecretKey,
            { expiresIn: expiresIn }
        );
    },
};

const bcrypt = require('bcrypt');
const constants = require('../config/constants.json');
const UserModel = require('../models/user');
const LoginIPLog = require('../models/loginIPLog');
const util = require('./utilService.js');
const randToken = require('rand-token');
const PaymentService = require('./paymentService');
const crypto = require('crypto');
const ProjectService = require('./projectService');
const ErrorService = require('./errorService');
const jwt = require('jsonwebtoken');
const iplocation = require('iplocation').default;
const jwtSecretKey = process.env['JWT_SECRET'];
const { IS_SAAS_SERVICE } = require('../config/server');
const { NODE_ENV, IS_TESTING } = process.env;
const VerificationTokenModel = require('../models/verificationToken');
const MailService = require('../services/mailService');
const AirtableService = require('./airtableService');
const speakeasy = require('speakeasy');
const { hotp } = require('otplib');
