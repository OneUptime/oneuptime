import PositiveNumber from 'common/types/positive-number';
export default {
    findBy: async function ({
        query,
        skip,
        limit,
        select,
        populate,
    }: $TSFixMe) {
        if (!skip) skip = 0;

        if (!limit) limit = 0;

        if (typeof skip === 'string') skip = parseInt(skip);

        if (typeof limit === 'string') limit = parseInt(limit);

        if (!query) query = {};

        if (!query.deleted) query.deleted = false;
        let userQuery = UserModel.find(query)
            .lean()
            .limit(limit)
            .skip(skip)
            .sort([['lastActive', -1]]);

        userQuery = handleSelect(select, userQuery);
        userQuery = handlePopulate(populate, userQuery);

        const users = await userQuery;
        return users;
    },

    create: async function (data: $TSFixMe) {
        if (!data.email) {
            const error = new Error('Email address can not be empty');

            error.code = 400;
            throw error;
        }
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

        userModel.source = data.source || null;
        if (data.password) {
            const hash = await bcrypt.hash(data.password, constants.saltRounds);

            userModel.password = hash;
        }
        // setting isVerified true for master admin

        if (data.role == 'master-admin') userModel.isVerified = true;

        userModel.jwtRefreshToken = randToken.uid(256);

        if (data.sso) userModel.sso = data.sso;

        const user = await userModel.save();
        return user;
    },

    countBy: async function (query: $TSFixMe) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
        const count = await UserModel.countDocuments(query);
        return count;
    },

    deleteBy: async function (query: $TSFixMe, userId: $TSFixMe) {
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
    },

    findOneBy: async function ({ query, select, populate }: $TSFixMe) {
        if (!query) {
            query = {};
        }
        if (!query.deleted) query.deleted = false;
        let userQuery = UserModel.findOne(query)
            .lean()
            .sort([['createdAt', -1]]);

        userQuery = handleSelect(select, userQuery);
        userQuery = handlePopulate(populate, userQuery);

        const user = await userQuery;

        if ((user && !IS_SAAS_SERVICE) || user) {
            // find user subprojects and parent projects

            let userProjects = await ProjectService.findBy({
                query: { 'users.userId': user._id },
                select: 'parentProjectId',
            });
            let parentProjectIds = [];
            let projectIds = [];
            if (userProjects.length > 0) {
                const subProjects = userProjects
                    .map((project: $TSFixMe) =>
                        project.parentProjectId ? project : null
                    )
                    .filter((subProject: $TSFixMe) => subProject !== null);
                parentProjectIds = subProjects.map(
                    (subProject: $TSFixMe) =>
                        subProject.parentProjectId._id ||
                        subProject.parentProjectId
                );
                const projects = userProjects
                    .map((project: $TSFixMe) =>
                        project.parentProjectId ? null : project
                    )
                    .filter((project: $TSFixMe) => project !== null);
                projectIds = projects.map((project: $TSFixMe) => project._id);
            }
            const populateProject = [
                { path: 'parentProjectId', select: 'name' },
            ];
            const selectProject =
                '_id slug name users stripePlanId stripeSubscriptionId parentProjectId seats deleted apiKey alertEnable alertLimit alertLimitReached balance alertOptions isBlocked adminNotes';

            userProjects = await ProjectService.findBy({
                query: {
                    $or: [
                        { _id: { $in: parentProjectIds } },
                        { _id: { $in: projectIds } },
                    ],
                },
                select: selectProject,
                populate: populateProject,
            });
            return await Object.assign({}, user, {
                projects: userProjects,
            });
        }
        return user;
    },

    updateOneBy: async function (query: $TSFixMe, data: $TSFixMe) {
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

        const updatedUser = await UserModel.findOneAndUpdate(
            query,
            {
                $set: data,
            },
            {
                new: true,
            }
        ).select('-password');
        return updatedUser;
    },

    updateBy: async function (query: $TSFixMe, data: $TSFixMe) {
        if (!query) {
            query = {};
        }

        if (!query.deleted) query.deleted = false;
        let updatedData = await UserModel.updateMany(query, {
            $set: data,
        });
        const select =
            'createdAt name email tempEmail isVerified sso jwtRefreshToken companyName companyRole companySize referral companyPhoneNumber onCallAlert profilePic twoFactorAuthEnabled stripeCustomerId timeZone lastActive disabled paymentFailedDate role isBlocked adminNotes deleted deletedById alertPhoneNumber tempAlertPhoneNumber tutorial identification source isAdminMode';
        updatedData = await this.findBy({ query, select });
        return updatedData;
    },

    updatePush: async function ({ userId, data }: $TSFixMe) {
        const user = await UserModel.findOne({ _id: userId });
        const checkExist = await user.identification.find(
            (user: $TSFixMe) =>
                String(user.userAgent) === String(data.userAgent)
        );
        if (!data.checked) {
            const findIndex = await user.identification.findIndex(
                (user: $TSFixMe) =>
                    String(user.userAgent) === String(data.userAgent)
            );
            await user.identification.splice(findIndex, 1);
        } else {
            if (!checkExist) {
                await user.identification.push(data);
            }
        }
        const userData = await this.updateOneBy(
            { _id: user._id },
            { identification: user.identification }
        );
        return userData;
    },

    closeTutorialBy: async function (
        query: $TSFixMe,
        type: $TSFixMe,
        data: $TSFixMe,
        projectId: $TSFixMe
    ) {
        if (!query) query = {};
        if (!data) data = {};

        type = type.replace(/-([a-z])/g, function (g: $TSFixMe) {
            return g[1].toUpperCase();
        });

        // if projectID is passed, get the current tutorial status
        const currentStatus = data[projectId] || {};
        currentStatus[type] = { show: false }; // overwrite that current type under that project
        data[projectId] = currentStatus; // update the data object then

        const tutorial = await UserModel.findOneAndUpdate(
            query,
            { $set: { tutorial: data } },
            { new: true }
        );
        return tutorial || null;
    },

    sendToken: async function (user: $TSFixMe, email: $TSFixMe) {
        const _this = this;
        const verificationTokenModel = new VerificationTokenModel({
            userId: user._id,
            token: crypto.randomBytes(16).toString('hex'),
        });
        const verificationToken = await verificationTokenModel.save();
        if (verificationToken) {
            const verificationTokenURL = `${global.apiHost}/user/confirmation/${verificationToken.token}`;
            // Checking for already verified user so that he/she will not recieve another email verification

            if (!user.isVerified) {
                MailService.sendVerifyEmail(
                    verificationTokenURL,
                    user.name,
                    email
                );
            }

            if (email !== user.email) {
                _this
                    .updateOneBy({ _id: user._id }, { tempEmail: email })
                    .catch(error => {
                        ErrorService.log(
                            'UserService.sendToken > UserService.updateOneBy',
                            error
                        );
                    });
            }
        }

        return verificationToken.token;
    },
    //Description: signup function for new user.
    //Params:
    //Param 1: data: User details.
    //Returns: promise.
    signup: async function (data: $TSFixMe) {
        const _this = this;
        const email = data.email;
        const stripePlanId = data.planId || null;
        const paymentIntent = data.paymentIntent || null;

        if (util.isEmailValid(email)) {
            let user = await _this.findOneBy({
                query: { email: email },
                select: '_id',
            });

            if (user) {
                const error = new Error('User already exists.');

                error.code = 400;
                throw error;
            } else {
                let customerId, subscription;
                if (IS_SAAS_SERVICE && paymentIntent !== null) {
                    // Check here is the payment intent is successfully paid. If yes then create the customer else not.
                    const processedPaymentIntent =
                        await PaymentService.checkPaymentIntent(paymentIntent);
                    if (processedPaymentIntent.status !== 'succeeded') {
                        const error = new Error(
                            'Unsuccessful attempt to charge card'
                        );

                        error.code = 400;
                        throw error;
                    }
                    customerId = processedPaymentIntent.customer;
                }
                // IS_SAAS_SERVICE: save a user only when payment method is charged and then next steps
                user = await _this.create(data);

                if (IS_SAAS_SERVICE && paymentIntent !== null) {
                    //update customer Id
                    user = await _this.updateOneBy(
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
                let verificationToken;
                if (user.role !== 'master-admin' || !customerId) {
                    verificationToken = await _this.sendToken(user, user.email);
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

                const createdAt = new Date(user.createdAt)
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
            const error = new Error('Email is not in valid format.');

            error.code = 400;
            throw error;
        }
    },
    getUserIpLocation: async function (clientIP: $TSFixMe) {
        try {
            const geo = geoip.lookup(clientIP);
            if (geo) {
                geo.ip = clientIP;
                return geo;
            }
            return {};
        } catch (error) {
            return {};
        }
    },

    generateUserBackupCodes: async function (
        secretKey: $TSFixMe,
        numberOfCodes: $TSFixMe,
        firstCounter = 0
    ) {
        hotp.options = { digits: 8 };
        const backupCodes = [];

        for (let i = 0; i < numberOfCodes; i++) {
            const counter = firstCounter + i;
            const token = hotp.generate(secretKey, counter);
            backupCodes.push({ code: token, counter });
        }
        return backupCodes;
    },

    verifyUserBackupCode: async function (
        code: $TSFixMe,
        secretKey: $TSFixMe,
        counter: $TSFixMe
    ) {
        const _this = this;
        hotp.options = { digits: 8 };
        const isValid = hotp.check(code, secretKey, counter);
        if (isValid) {
            const select =
                'createdAt name email tempEmail isVerified sso jwtRefreshToken companyName companyRole companySize referral companyPhoneNumber onCallAlert profilePic twoFactorAuthEnabled stripeCustomerId timeZone lastActive disabled paymentFailedDate role isBlocked adminNotes deleted deletedById alertPhoneNumber tempAlertPhoneNumber tutorial identification source isAdminMode';
            const user = await _this.findOneBy({
                query: { twoFactorSecretCode: secretKey },
                select,
            });
            const backupCodes = user.backupCodes.map((backupCode: $TSFixMe) => {
                if (backupCode.code === code) backupCode.used = true;
                return backupCode;
            });
            await _this.updateOneBy(
                { twoFactorSecretCode: secretKey },
                { backupCodes }
            );
            return user;
        }
        return isValid;
    },

    generateTwoFactorSecret: async function (userId: $TSFixMe) {
        const _this = this;
        const user = await _this.findOneBy({
            query: { _id: userId },
            select: 'email',
        });
        const secretCode = speakeasy.generateSecret({
            length: 20,
            name: `OneUptime (${user.email})`,
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
    },

    verifyAuthToken: async function (token: $TSFixMe, userId: $TSFixMe) {
        const _this = this;
        const user = await _this.findOneBy({
            query: { _id: userId },
            select: '_id twoFactorSecretCode',
        });
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
    },

    //Description: login function to authenticate user.
    //Params:
    //Param 1: email: User email.
    //Param 2: password: User password.
    //Returns: promise.
    login: async function (
        email: $TSFixMe,
        password: $TSFixMe,
        clientIP: $TSFixMe,
        userAgent: $TSFixMe
    ) {
        const _this = this;
        let user = null;
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
                const count = await _this.countBy({});
                if (count === 0) {
                    //create a new admin user.
                    user = await _this.create({
                        name: 'OneUptime Admin',
                        email: process.env.ADMIN_EMAIL,
                        password: process.env.ADMIN_PASSWORD,
                        role: 'master-admin',
                    });
                }
            }

            const select =
                'createdAt password cachedPassword name email tempEmail isVerified sso jwtRefreshToken companyName companyRole companySize referral companyPhoneNumber onCallAlert profilePic twoFactorAuthEnabled stripeCustomerId timeZone lastActive disabled paymentFailedDate role isBlocked adminNotes deleted deletedById alertPhoneNumber tempAlertPhoneNumber tutorial identification source isAdminMode';
            user = await _this.findOneBy({
                query: { email: email },
                select,
            });

            if (!user) {
                const error = new Error('User does not exist.');

                error.code = 400;
                throw error;
            } else if (user.sso) {
                const error = new Error(
                    'This domain is configured as SSO. Please use SSO to log in to your account'
                );

                error.code = 401;
                throw error;
            } else {
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
                            'Your account has been disabled. Kindly contact support@oneuptime.com'
                        );

                        error.code = 400;
                        throw error;
                    }
                }
                const encryptedPassword = user.password;

                if (user.disabled) {
                    const error = new Error(
                        'Your account has been disabled. Kindly contact support@oneuptime.com'
                    );

                    error.code = 400;
                    throw error;
                }
                if (
                    user.role !== 'master-admin' &&
                    !user.isVerified &&
                    NODE_ENV !== 'development'
                ) {
                    const error = new Error('Verify your email first.');

                    error.code = 401;
                    throw error;
                }
                if (!encryptedPassword) {
                    const error = new Error(
                        'Your account does not exist. Please sign up.'
                    );

                    error.code = 400;
                    throw error;
                } else {
                    const res = await bcrypt.compare(
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
                        let error;
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
            const error = new Error('Email is not in valid format.');

            error.code = 400;
            throw error;
        }
    },

    // Description: forgot password function
    //Params:
    //Param 1: email: User email.
    //Returns: promise.
    forgotPassword: async function (email: $TSFixMe) {
        const _this = this;
        if (util.isEmailValid(email)) {
            let user = await this.findOneBy({
                query: { email: email },
                select: 'isAdminMode cachedPassword _id',
            });

            if (!user) {
                const error = new Error('User does not exist.');

                error.code = 400;
                throw error;
            } else {
                // ensure user is not in admin mode
                if (user.isAdminMode && user.cachedPassword) {
                    const error = new Error(
                        'Your account is currently under maintenance. Please try again later'
                    );

                    error.code = 400;
                    throw error;
                }
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
            throw error;
        }
    },

    // Description: forgot password function.
    //Params:
    //Param 1:  password: User password.
    //Param 2:  token: token generated in forgot password function.
    //Returns: promise.
    resetPassword: async function (password: $TSFixMe, token: $TSFixMe) {
        const _this = this;
        let user = await _this.findOneBy({
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
                const error = new Error(
                    'Your account is currently under maintenance. Please try again later'
                );

                error.code = 400;
                throw error;
            }

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
    },

    // Description: replace password temporarily in "admin mode"
    switchToAdminMode: async function (
        userId: $TSFixMe,
        temporaryPassword: $TSFixMe
    ) {
        if (!temporaryPassword) {
            const error = new Error(
                'A temporary password is required for admin mode'
            );

            error.code = 400;
            throw error;
        }
        const _this = this;
        const user = await _this.findOneBy({
            query: { _id: userId },
            select: 'isAdminMode cachedPassword password',
        });

        if (!user) {
            const error = new Error('User not found');

            error.code = 400;
            throw error;
        } else {
            const hash = await bcrypt.hash(
                temporaryPassword,
                constants.saltRounds
            );

            //update the user.
            // if already in admin mode we shouldn't
            // replace the cached/original password so we don't lose it
            const passwordToCache = user.isAdminMode
                ? user.cachedPassword
                : user.password;
            const updatedUser = await _this.updateOneBy(
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
    },

    // Descripiton: revert from admin mode and replce user password
    exitAdminMode: async function (userId: $TSFixMe) {
        const _this = this;
        const user = await _this.findOneBy({
            query: { _id: userId },
            select: 'isAdminMode cachedPassword password',
        });

        if (!user) {
            const error = new Error('User not found');

            error.code = 400;
            throw error;
        } else {
            // ensure user is in admin mode
            if (!user.isAdminMode) {
                const error = new Error('User is not currently in admin mode');

                error.code = 400;
                throw error;
            }

            //update the user.
            const passwordToRestore = user.cachedPassword ?? user.password; // unlikely but just in case cachedPassword is null
            const updatedUser = await _this.updateOneBy(
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
    },

    //Description: Get new access token.
    //Params:
    //Param 1:  refreshToken: Refresh token.
    //Returns: promise.
    getNewToken: async function (refreshToken: $TSFixMe) {
        const _this = this;
        let user = await _this.findOneBy({
            query: { jwtRefreshToken: refreshToken },
            select: '_id',
        });

        if (!user) {
            const error = new Error('Invalid Refresh Token');

            error.code = 400;
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
    },

    changePassword: async function (data: $TSFixMe) {
        const _this = this;
        const currentPassword = data.currentPassword;
        let user = await _this.findOneBy({
            query: { _id: data._id },
            select: 'isAdminMode cachedPassword password',
        });

        // ensure user is not in admin mode
        if (user.isAdminMode && user.cachedPassword) {
            const error = new Error(
                'Your account is currently under maintenance. Please try again later'
            );

            error.code = 400;
            throw error;
        }

        const encryptedPassword = user.password;

        const check = await bcrypt.compare(currentPassword, encryptedPassword);
        if (check) {
            const newPassword = data.newPassword;
            const hash = await bcrypt.hash(newPassword, constants.saltRounds);

            data.password = hash;
            user = await _this.updateOneBy({ _id: data._id }, data);

            return user;
        } else {
            const error = new Error('Current Password is incorrect.');

            error.code = 400;
            throw error;
        }
    },

    getAllUsers: async function (skip: PositiveNumber, limit: PositiveNumber) {
        const _this = this;
        const select =
            'createdAt name email tempEmail isVerified sso jwtRefreshToken companyName companyRole companySize referral companyPhoneNumber onCallAlert profilePic twoFactorAuthEnabled stripeCustomerId timeZone lastActive disabled paymentFailedDate role isBlocked adminNotes deleted deletedById alertPhoneNumber tempAlertPhoneNumber tutorial identification source isAdminMode';
        let users = await _this.findBy({
            query: { _id: { $ne: null }, deleted: { $ne: null } },
            skip,
            limit,
            select,
        });
        users = await Promise.all(
            users.map(async (user: $TSFixMe) => {
                // find user subprojects and parent projects

                let userProjects = await ProjectService.findBy({
                    query: { 'users.userId': user._id },
                    select: 'parentProjectId',
                });
                let parentProjectIds = [];
                let projectIds = [];
                if (userProjects.length > 0) {
                    const subProjects = userProjects
                        .map((project: $TSFixMe) =>
                            project.parentProjectId ? project : null
                        )
                        .filter((subProject: $TSFixMe) => subProject !== null);
                    parentProjectIds = subProjects.map(
                        (subProject: $TSFixMe) =>
                            subProject.parentProjectId._id ||
                            subProject.parentProjectId
                    );
                    const projects = userProjects
                        .map((project: $TSFixMe) =>
                            project.parentProjectId ? null : project
                        )
                        .filter((project: $TSFixMe) => project !== null);
                    projectIds = projects.map(
                        (project: $TSFixMe) => project._id
                    );
                }
                const populate = [{ path: 'parentProjectId', select: 'name' }];
                const select =
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
    },

    restoreBy: async function (query: $TSFixMe) {
        const _this = this;
        query.deleted = true;

        const select = '_id';
        let user = await _this.findBy({ query, select });
        if (user && user.length > 1) {
            const users = await Promise.all(
                user.map(async (user: $TSFixMe) => {
                    query._id = user._id;
                    user = await _this.updateOneBy(query._id, {
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
                user = await _this.updateOneBy(query, {
                    deleted: false,
                    deletedBy: null,
                    deletedAt: null,
                });
            }
            return user;
        }
    },

    addNotes: async function (userId: $TSFixMe, notes: $TSFixMe) {
        const _this = this;
        const user = await _this.updateOneBy(
            {
                _id: userId,
            },
            {
                adminNotes: notes,
            }
        );
        return user;
    },

    searchUsers: async function (
        query: $TSFixMe,
        skip: PositiveNumber,
        limit: PositiveNumber
    ) {
        const _this = this;
        const select =
            'createdAt name email tempEmail isVerified sso jwtRefreshToken companyName companyRole companySize referral companyPhoneNumber onCallAlert profilePic twoFactorAuthEnabled stripeCustomerId timeZone lastActive disabled paymentFailedDate role isBlocked adminNotes deleted deletedById alertPhoneNumber tempAlertPhoneNumber tutorial identification source isAdminMode';
        let users = await _this.findBy({ query, skip, limit, select });
        users = await Promise.all(
            users.map(async (user: $TSFixMe) => {
                // find user subprojects and parent projects

                let userProjects = await ProjectService.findBy({
                    query: { 'users.userId': user._id },
                    select: 'parentProjectId',
                });
                let parentProjectIds = [];
                let projectIds = [];
                if (userProjects.length > 0) {
                    const subProjects = userProjects
                        .map((project: $TSFixMe) =>
                            project.parentProjectId ? project : null
                        )
                        .filter((subProject: $TSFixMe) => subProject !== null);
                    parentProjectIds = subProjects.map(
                        (subProject: $TSFixMe) =>
                            subProject.parentProjectId._id ||
                            subProject.parentProjectId
                    );
                    const projects = userProjects
                        .map((project: $TSFixMe) =>
                            project.parentProjectId ? null : project
                        )
                        .filter((project: $TSFixMe) => project !== null);
                    projectIds = projects.map(
                        (project: $TSFixMe) => project._id
                    );
                }
                const populate = [{ path: 'parentProjectId', select: 'name' }];
                const select =
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
    },

    hardDeleteBy: async function (query: $TSFixMe) {
        await UserModel.deleteMany(query);
        return 'User(s) Removed Successfully!';
    },

    getAccessToken: function ({ userId, expiresIn }: $TSFixMe) {
        return jwt.sign(
            {
                id: userId,
            },
            jwtSecretKey,
            { expiresIn: expiresIn }
        );
    },
};

import bcrypt from 'bcrypt';

import constants from '../config/constants.json';
import UserModel from 'common-server/models/user';
import util from './utilService.js';
import randToken from 'rand-token';
import PaymentService from './paymentService';
import crypto from 'crypto';
import ProjectService from './projectService';
import ErrorService from 'common-server/utils/error';

import jwt from 'jsonwebtoken';

import geoip from 'geoip-lite';
const jwtSecretKey = process.env['JWT_SECRET'];

import { IS_SAAS_SERVICE, IS_TESTING } from '../config/server';
const { NODE_ENV } = process.env;
import VerificationTokenModel from 'common-server/models/verificationToken';
import MailService from '../services/mailService';
import AirtableService from './airtableService';

import speakeasy from 'speakeasy';
import { hotp } from 'otplib';
import LoginHistoryService from './loginHistoryService';
import handleSelect from '../utils/select';
import handlePopulate from '../utils/populate';
