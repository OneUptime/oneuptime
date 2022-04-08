import PositiveNumber from 'common/types/PositiveNumber';
import BadDataException from 'common/types/exception/BadDataException';
export default class Service {
    // async addUserToDefaultProjects({ domain, userId }: $TSFixMe) {

    //     const populateDefaultRoleSso = [
    //         { path: 'domain', select: '_id domain' },
    //         { path: 'project', select: '_id name' },
    //     ];

    //     const ssoDefaultRoles = await this.findBy({
    //         query: { domain },
    //         select: 'project role',
    //         populate: populateDefaultRoleSso,
    //     });

    //     if (!ssoDefaultRoles.length) return;

    //     for (const ssoDefaultRole of ssoDefaultRoles) {
    //         const { project, role } = ssoDefaultRole;
    //         const { _id: projectId } = project;

    //         const projectObj = await ProjectService.findOneBy({
    //             query: { _id: projectId },
    //             select: 'users',
    //         });
    //         if (!projectObj) continue;

    //         const { users } = projectObj;
    //         users.push({
    //             userId,
    //             role,
    //         });
    //         await ProjectService.updateOneBy({ _id: projectId }, { users });
    //     }
    // }

    async findBy({
        query,
        limit,
        skip,
        populate,
        select,
        sort = [
            {
                lastActive: SortOrder.Descending,
            },
        ],
    }: FindBy) {
        if (!query['deleted']) query['deleted'] = false;
        const userQuery = UserModel.find(query)
            .lean()
            .limit(limit.toNumber())
            .skip(skip.toNumber())
            .sort(sort);

        userQuery.select(select);
        userQuery.populate(populate);

        const users = await userQuery;
        return users;
    }

    async create(data: $TSFixMe) {
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
    }

    async countBy(query: Query) {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) query['deleted'] = false;
        const count = await UserModel.countDocuments(query);
        return count;
    }

    async deleteBy(query: Query, userId: string) {
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
    }

    async findOneBy({ query, select, populate, sort }: FindOneBy) {
        if (!query) {
            query = {};
        }
        if (!query['deleted']) query['deleted'] = false;
        const userQuery = UserModel.findOne(query).sort(sort).lean().sort(sort);

        userQuery.select(select);
        userQuery.populate(populate);

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
    }

    async updateOneBy(query: Query, data: $TSFixMe) {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) query['deleted'] = false;

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
    }

    async updateBy(query: Query, data: $TSFixMe) {
        if (!query) {
            query = {};
        }

        if (!query['deleted']) query['deleted'] = false;
        let updatedData = await UserModel.updateMany(query, {
            $set: data,
        });
        const select =
            'createdAt name email tempEmail isVerified sso jwtRefreshToken companyName companyRole companySize referral companyPhoneNumber onCallAlert profilePic twoFactorAuthEnabled stripeCustomerId timeZone lastActive disabled paymentFailedDate role isBlocked adminNotes deleted deletedById alertPhoneNumber tempAlertPhoneNumber tutorial identification source isAdminMode';
        updatedData = await this.findBy({ query, select });
        return updatedData;
    }

    async updatePush({ userId, data }: $TSFixMe) {
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
    }

    async closeTutorialBy(
        query: Query,
        type: $TSFixMe,
        data: $TSFixMe,
        projectId: string
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
    }

    async sendToken(user: $TSFixMe, email: $TSFixMe) {
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
                this.updateOneBy({ _id: user._id }, { tempEmail: email }).catch(
                    error => {
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
    async signup(data: $TSFixMe) {
        const email = data.email;
        const stripePlanId = data.planId || null;
        const paymentIntent = data.paymentIntent || null;

        if (util.isEmailValid(email)) {
            let user = await this.findOneBy({
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
                let verificationToken;
                if (user.role !== 'master-admin' || !customerId) {
                    verificationToken = await this.sendToken(user, user.email);
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
    }

    async getUserIpLocation(clientIP: $TSFixMe) {
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
    }

    async generateUserBackupCodes(
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
    }

    async verifyUserBackupCode(
        code: $TSFixMe,
        secretKey: $TSFixMe,
        counter: $TSFixMe
    ) {
        hotp.options = { digits: 8 };
        const isValid = hotp.check(code, secretKey, counter);
        if (isValid) {
            const select =
                'createdAt name email tempEmail isVerified sso jwtRefreshToken companyName companyRole companySize referral companyPhoneNumber onCallAlert profilePic twoFactorAuthEnabled stripeCustomerId timeZone lastActive disabled paymentFailedDate role isBlocked adminNotes deleted deletedById alertPhoneNumber tempAlertPhoneNumber tutorial identification source isAdminMode';
            const user = await this.findOneBy({
                query: { twoFactorSecretCode: secretKey },
                select,
            });
            const backupCodes = user.backupCodes.map((backupCode: $TSFixMe) => {
                if (backupCode.code === code) backupCode.used = true;
                return backupCode;
            });
            await this.updateOneBy(
                { twoFactorSecretCode: secretKey },
                { backupCodes }
            );
            return user;
        }
        return isValid;
    }

    async generateTwoFactorSecret(userId: string) {
        const user = await this.findOneBy({
            query: { _id: userId },
            select: 'email',
        });
        const secretCode = speakeasy.generateSecret({
            length: 20,
            name: `OneUptime (${user.email})`,
        });
        const backupCodes = await this.generateUserBackupCodes(
            secretCode.base32,
            8
        );
        const data = {
            twoFactorSecretCode: secretCode.base32,
            otpauth_url: secretCode.otpauth_url,
            backupCodes,
        };
        await this.updateOneBy({ _id: userId }, data);
        return { otpauth_url: secretCode.otpauth_url };
    }

    async verifyAuthToken(token: $TSFixMe, userId: string) {
        const user = await this.findOneBy({
            query: { _id: userId },
            select: '_id twoFactorSecretCode',
        });
        const isValidCode = speakeasy.totp.verify({
            secret: user.twoFactorSecretCode,
            encoding: 'base32',
            token: token,
        });
        if (isValidCode) {
            const updatedUser = await this.updateOneBy(
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
    async login(
        email: $TSFixMe,
        password: $TSFixMe,
        clientIP: $TSFixMe,
        userAgent: $TSFixMe
    ) {
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
                const count = await this.countBy({});
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

            const select =
                'createdAt password cachedPassword name email tempEmail isVerified sso jwtRefreshToken companyName companyRole companySize referral companyPhoneNumber onCallAlert profilePic twoFactorAuthEnabled stripeCustomerId timeZone lastActive disabled paymentFailedDate role isBlocked adminNotes deleted deletedById alertPhoneNumber tempAlertPhoneNumber tutorial identification source isAdminMode';
            user = await this.findOneBy({
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
                        user = await this.updateOneBy(
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
                    const error = new BadDataException(
                        'Your account has been disabled. Kindly contact support@oneuptime.com'
                    );
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
                    const error = new BadDataException(
                        'Your account does not exist. Please sign up.'
                    );
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
    }

    // Description: forgot password function
    //Params:
    //Param 1: email: User email.
    //Returns: promise.
    async forgotPassword(email: $TSFixMe) {
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
                    const error = new BadDataException(
                        'Your account is currently under maintenance. Please try again later'
                    );
                    throw error;
                }
                const buf = await crypto.randomBytes(20);
                const token = buf.toString('hex');

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
            const error = new Error('Email is not in valid format.');

            error.code = 400;
            throw error;
        }
    }

    // Description: forgot password function.
    //Params:
    //Param 1:  password: User password.
    //Param 2:  token: token generated in forgot password function.
    //Returns: promise.
    async resetPassword(password: $TSFixMe, token: $TSFixMe) {
        let user = await this.findOneBy({
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
    async switchToAdminMode(userId: string, temporaryPassword: $TSFixMe) {
        if (!temporaryPassword) {
            const error = new Error(
                'A temporary password is required for admin mode'
            );

            error.code = 400;
            throw error;
        }

        const user = await this.findOneBy({
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
            const updatedUser = await this.updateOneBy(
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
    async exitAdminMode(userId: string) {
        const user = await this.findOneBy({
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
            const updatedUser = await this.updateOneBy(
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
    async getNewToken(refreshToken: $TSFixMe) {
        let user = await this.findOneBy({
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

            user = await this.updateOneBy(
                { _id: user._id },
                { jwtRefreshToken: jwtRefreshToken }
            );

            const token = {
                accessToken: accessToken,
                refreshToken: refreshToken,
            };
            return token;
        }
    }

    async changePassword(data: $TSFixMe) {
        const currentPassword = data.currentPassword;
        let user = await this.findOneBy({
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
            user = await this.updateOneBy({ _id: data._id }, data);

            return user;
        } else {
            const error = new Error('Current Password is incorrect.');

            error.code = 400;
            throw error;
        }
    }

    async getAllUsers(skip: PositiveNumber, limit: PositiveNumber) {
        const select =
            'createdAt name email tempEmail isVerified sso jwtRefreshToken companyName companyRole companySize referral companyPhoneNumber onCallAlert profilePic twoFactorAuthEnabled stripeCustomerId timeZone lastActive disabled paymentFailedDate role isBlocked adminNotes deleted deletedById alertPhoneNumber tempAlertPhoneNumber tutorial identification source isAdminMode';
        let users = await this.findBy({
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
    }

    async restoreBy(query: Query) {
        query.deleted = true;

        const select = '_id';
        let user = await this.findBy({ query, select });
        if (user && user.length > 1) {
            const users = await Promise.all(
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

    async addNotes(userId: string, notes: $TSFixMe) {
        const user = await this.updateOneBy(
            {
                _id: userId,
            },
            {
                adminNotes: notes,
            }
        );
        return user;
    }

    async searchUsers(
        query: Query,
        skip: PositiveNumber,
        limit: PositiveNumber
    ) {
        const select =
            'createdAt name email tempEmail isVerified sso jwtRefreshToken companyName companyRole companySize referral companyPhoneNumber onCallAlert profilePic twoFactorAuthEnabled stripeCustomerId timeZone lastActive disabled paymentFailedDate role isBlocked adminNotes deleted deletedById alertPhoneNumber tempAlertPhoneNumber tutorial identification source isAdminMode';
        let users = await this.findBy({ query, skip, limit, select });
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
    }

    async hardDeleteBy(query: Query) {
        await UserModel.deleteMany(query);
        return 'User(s) Removed Successfully!';
    }

    getAccessToken({ userId, expiresIn }: $TSFixMe) {
        return jwt.sign(
            {
                id: userId,
            },
            jwtSecretKey,
            { expiresIn: expiresIn }
        );
    }
}

import bcrypt from 'bcrypt';

import constants from '../config/constants.json';
import UserModel from '../models/user';
import util from './utilService.js';
import randToken from 'rand-token';
import PaymentService from './PaymentService';
import crypto from 'crypto';
import ProjectService from './ProjectService';
import ErrorService from '../utils/error';

import jwt from 'jsonwebtoken';

import geoip from 'geoip-lite';
const jwtSecretKey = process.env['JWT_SECRET'];

import { IS_SAAS_SERVICE, IS_TESTING } from '../config/server';
const { NODE_ENV } = process.env;
import VerificationTokenModel from '../models/verificationToken';
import MailService from './MailService';
import AirtableService from './AirtableService';

import speakeasy from 'speakeasy';
import { hotp } from 'otplib';
import LoginHistoryService from './LoginHistoryService';

import FindOneBy from '../types/db/FindOneBy';
import FindBy from '../types/db/FindBy';
import Query from '../types/db/Query';
import SortOrder from '../types/db/SortOrder';
