module.exports = {

    findBy: async function (query, skip, limit) {
        try {
            if (!skip) skip = 0;
    
            if (!limit) limit = 0;
    
            if (typeof (skip) === 'string') skip = parseInt(skip);
    
            if (typeof (limit) === 'string') limit = parseInt(limit);
    
            if (!query) query = {};
    
            if (!query.deleted) query.deleted = false;
            var users = await UserModel.find(query)
                .sort([['createdAt', -1]])
                .limit(limit)
                .skip(skip);
            return users;
        } catch (error) {
            ErrorService.log('userService.find', error);
            throw error;
        }
    },

    create: async function (data) {
        try {
            var userModel = new UserModel();
            userModel.name = data.name || null;
            userModel.email = data.email || null;
            userModel.password = data.password || null;
            userModel.companyName = data.companyName || null;
            userModel.companyRole = data.companyRole || null;
            userModel.companySize = data.companySize || null;
            userModel.referral = data.referral || null;
            userModel.companyPhoneNumber = data.companyPhoneNumber || null;
            userModel.onCallAlert = data.onCallAlert || null;
            userModel.profilePic = data.profilePic || null;
            userModel.jwtRefreshToken = data.jwtRefreshToken || null;
            userModel.stripeCustomerId = data.stripeCustomerId || null;
            userModel.resetPasswordToken = data.resetPasswordToken || null;
            userModel.resetPasswordExpires = data.resetPasswordExpires || null;
            userModel.createdAt = data.createdAt || Date.now();
            userModel.timezone = data.timezone || null;
            userModel.lastActive = data.lastActive || Date.now();
            userModel.coupon = data.coupon || null;
            userModel.adminNotes = data.adminNotes || null;
            userModel.tempEmail = data.tempEmail || null;

            var user = await userModel.save();
            return user;
        } catch (error) {
            ErrorService.log('userService.save', error);
            throw error;
        }
    },

    countBy: async function (query) {
        try {
            if (!query) {
                query = {};
            }
    
            if (!query.deleted) query.deleted = false;
            var count = await UserModel.count(query);
            return count;
        } catch (error) {
            ErrorService.log('UserService.count', error);
            throw error;
        }
    },

    deleteBy: async function (query, userId) {
        try {
            if (!query) {
                query = {};
            }
    
            query.deleted = false;
            var user = await UserModel.findOneAndUpdate(query, {
                $set: {
                    deleted: true,
                    deletedById: userId,
                    deletedAt: Date.now()
                }
            }, {
                new: true
            });
            return user;
        } catch (error) {
            ErrorService.log('UserService.updateMany', error);
            throw error;
        }
    },

    findOneBy: async function (query) {
        try {
            if (!query) {
                query = {};
            }
            if (!query.deleted) query.deleted = false;
            var user = await UserModel.findOne(query)
                .sort([['createdAt', -1]]);
            return user;
        } catch (error) {
            ErrorService.log('UserModel.findOne', error);
            throw error;
        }
    },

    update: async function (data) {
        try {
            var _this = this;
            if (!data._id) {
                let user = await _this.create(data);
                return user;
            } else {
                var user = await _this.findOneBy({ _id: data._id, deleted: { $ne: null } });

                var name = data.name || user.name;
                var email = data.email || user.email;
                var password = data.password || user.password;
                var companyName = data.companyName || user.companyName;
                var companyRole = data.companyRole || user.companyRole;
                var companySize = data.companySize || user.companySize;
                var referral = data.referral || user.referral;
                var companyPhoneNumber = data.companyPhoneNumber || user.companyPhoneNumber;
                var onCallAlert = data.onCallAlert || user.onCallAlert;
                var profilePic = data.profilePic || user.profilePic;
                var jwtRefreshToken = data.jwtRefreshToken || user.jwtRefreshToken;
                var stripeCustomerId = data.stripeCustomerId || user.stripeCustomerId;
                var resetPasswordToken = data.resetPasswordToken;
                var resetPasswordExpires = data.resetPasswordExpires;
                var createdAt = data.createdAt || user.createdAt;
                var timezone = data.timezone || user.timezone;
                var lastActive = data.lastActive || user.lastActive;
                var coupon = data.coupon || user.coupon;
                var disabled = data.disabled || false;
                var adminNotes = data.adminNotes || user.adminNotes;
                var isVerified = data.email ? data.email === user.email && user.isVerified : user.isVerified;
                var tempEmail = data.tempEmail || user.tempEmail || null;
    
                var isBlocked = user.isBlocked;
                if (typeof data.isBlocked === 'boolean') {
                    isBlocked = data.isBlocked;
                }
    
                var deleted = user.deleted;
                var deletedById = user.deletedById;
                var deletedAt = user.deletedAt;
                if (data.deleted === false) {
                    deleted = false;
                    deletedById = null;
                    deletedAt = null;
                }
    
                var updatedUser = await UserModel.findOneAndUpdate({ _id: data._id }, {
                    $set: {
                        name: name,
                        email: email,
                        isVerified: isVerified,
                        password: password,
                        companyName: companyName,
                        companyRole: companyRole,
                        companySize: companySize,
                        referral: referral,
                        companyPhoneNumber: companyPhoneNumber,
                        onCallAlert: onCallAlert,
                        profilePic: profilePic,
                        jwtRefreshToken: jwtRefreshToken,
                        stripeCustomerId: stripeCustomerId,
                        resetPasswordToken: resetPasswordToken,
                        resetPasswordExpires: resetPasswordExpires,
                        createdAt: createdAt,
                        timezone: timezone,
                        lastActive: lastActive,
                        coupon: coupon,
                        disabled: disabled,
                        deleted,
                        deletedById,
                        deletedAt,
                        isBlocked,
                        adminNotes,
                        tempEmail
                    }
                }, {
                    new: true
                });
                return updatedUser;
            }
        } catch (error) {
            ErrorService.log('UserService.update', error);
            throw error;
        }
    },

    closeTutorialBy: async function (query, type, data) {
        try {
            if (!query) query = {};
            if (!data) data = {};
    
            type = type.replace(/-([a-z])/g, function (g) { return g[1].toUpperCase(); });
            data[type] = { show: false };

            var tutorial = await UserModel.findOneAndUpdate(query, { $set: { tutorial: data } }, { new: true });
            return tutorial || null;
        } catch (error) {
            ErrorService.log('userService.closeTutorialBy', error);
            throw error;
        }
    },

    sendToken: async function (user, email) {
        try {
            const _this = this;
            var verificationTokenModel = new VerificationTokenModel({
                userId: user._id,
                token: crypto.randomBytes(16).toString('hex')
            });
            var verificationToken = await verificationTokenModel.save();
            if (verificationToken) {
                var verificationTokenURL = `${BACKEND_HOST}/user/confirmation/${verificationToken.token}`;
                MailService.sendVerifyEmail(verificationTokenURL, user.name, email);
                if (email !== user.email) {
                    _this.update({ _id: user._id, tempEmail: email });
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
    signup: async function (data) {
        try {
            var _this = this;
            var email = data.email;
            var stripePlanId = data.planId;
            var paymentIntent = data.paymentIntent;

            if (util.isEmailValid(email)) {
                var user = await _this.findOneBy({ email: email });
    
                if (user) {
                    let error = new Error('User already exists.');
                    error.code = 400;
                    ErrorService.log('UserService.signup', error);
                    throw error;
                } else {
                    // Check here is the payment intent is successfully paid. If yes then create the customer else not.
                    var processedPaymentIntent = await PaymentService.checkPaymentIntent(paymentIntent);
                    if (processedPaymentIntent.status !== 'succeeded') {
                        let error = new Error('Unsuccessful attempt to charge card');
                        error.code = 400;
                        ErrorService.log('PaymentService.checkPaymentIntent', error);
                        throw error;
                    }
                    var customerId = processedPaymentIntent.customer;
    
                    var hash = await bcrypt.hash(data.password, constants.saltRounds);
    
                    data.password = hash;
                    // creating jwt refresh token
                    data.jwtRefreshToken = randToken.uid(256);
                    //save a user only when payment method is charged and then next steps
                    user = await _this.create(data);
    
                    let createdAt = new Date(user.createdAt).toISOString().split('T', 1);
                    var record = await AirtableService.logUser({
                        name: data.name,
                        email: data.email,
                        phone: data.companyPhoneNumber,
                        company: data.companyName,
                        jobRole: data.companyRole,
                        createdAt
                    });
    
                    await _this.sendToken(user, user.email);
    
                    //update customer Id
                    user = await _this.update({ _id: user._id, stripeCustomerId: customerId });
                    var subscription = await PaymentService.subscribePlan(stripePlanId, customerId, data.coupon);
    
                    var projectName = 'Unnamed Project';
                    var projectData = {
                        name: projectName,
                        userId: user._id,
                        stripePlanId: stripePlanId,
                        stripeSubscriptionId: subscription.stripeSubscriptionId
                    };
                    await ProjectService.create(projectData);

                    user.airtableId = record.id || null;
    
                    return user;
                }
            } else {
                let error = new Error('Email is not in valid format.');
                error.code = 400;
                ErrorService.log('UserService.signup', error);
                throw error;
            }
        } catch (error) {
            ErrorService.log('UserService.signup', error);
            throw error;
        }
    },
    getUserIpLocation: async function (clientIP) {
        try {
            var ipLocation;
            ipLocation = await iplocation(clientIP);
            return ipLocation;
        } catch (error) {
            ipLocation = {};
        }
    },

    //Description: login function to authenticate user.
    //Params:
    //Param 1: email: User email.
    //Param 2: password: User password.
    //Returns: promise.
    login: async function (email, password, clientIP) {
        try {
            var _this = this;
            if (util.isEmailValid(email)) {
            // find user if present in db.
                var user = await _this.findOneBy({ email: email });
                
                if (!user) {
                    let error = new Error('User does not exist.');
                    error.code = 400;
                    ErrorService.log('UserService.login', error);
                    throw error;
                } else {
                    var ipLocation = await _this.getUserIpLocation(clientIP);
                    await LoginIPLog.create({ userId: user._id, ipLocation });

                    if (user.paymentFailedDate) {
                        // calculate number of days the subscription renewal has failed.
                        var oneDayInMilliSeconds = 1000 * 60 * 60 * 24;
                        var daysAfterPaymentFailed = Math.round((new Date - user.paymentFailedDate) / oneDayInMilliSeconds);
    
                        if (daysAfterPaymentFailed >= 15) {
                            user = await _this.update({ _id: user._id, disabled: true });
                            
                            let error = new Error('Your account has been disabled. Kindly contact support@fyipe.com');
                            error.code = 400;
                            ErrorService.log('UserService.login', error);
                            throw error;
                        }
                    }
                    var encryptedPassword = user.password;
    
                    if (user.disabled) {
                        let error = new Error('Your account has been disabled. Kindly contact support@fyipe.com');
                        error.code = 400;
                        ErrorService.log('UserService.login', error);
                        throw error;
                    }
                    if (!user.isVerified) {
                        let error = new Error('Verify your email first.');
                        error.code = 401;
                        ErrorService.log('UserService.login', error);
                        throw error;
                    }
                    if (!encryptedPassword) {
                        let error = new Error('Your account does not exist. Please sign up.');
                        error.code = 400;
                        ErrorService.log('UserService.login', error);
                        throw error;
                    } else {
                        var res = await bcrypt.compare(password, encryptedPassword);
                        
                        if (res) {
                            return user;
                        } else {
                            let error = new Error('Password is incorrect.');
                            error.code = 400;
                            ErrorService.log('UserService.login', error);
                            throw error;
                        }
                    }
                }
            } else {
                let error = new Error('Email is not in valid format.');
                error.code = 400;
                ErrorService.log('UserService.login', error);
                throw error;
            }
        } catch (error) {
            ErrorService.log('UserService.login', error);
            throw error;
        }
    },

    // Description: forgot password function
    //Params:
    //Param 1: email: User email.
    //Returns: promise.
    forgotPassword: async function (email) {
        try {
            var _this = this;
            if (util.isEmailValid(email)) {
                var user = await this.findOneBy({ email: email });
                
                if (!user) {
                    let error = new Error('User does not exist.');
                    error.code = 400;
                    ErrorService.log('UserService.forgotPassword', error);
                    throw error;
                } else {
                    var buf = await crypto.randomBytes(20);
                    var token = buf.toString('hex');

                    //update a user.
                    user = await _this.update({
                        _id: user._id,
                        resetPasswordToken: token,
                        resetPasswordExpires: Date.now() + 3600000 // 1 hour
                    });
                    
                    return user;
                }
            } else {
                let error = new Error('Email is not in valid format.');
                error.code = 400;
                ErrorService.log('UserService.forgotPassword', error);
                throw error;
            }
        } catch (error) {
            ErrorService.log('UserService.forgotPassword', error);
            throw error;
        }
    },

    // Description: forgot password function.
    //Params:
    //Param 1:  password: User password.
    //Param 2:  token: token generated in forgot password function.
    //Returns: promise.
    resetPassword: async function (password, token) {
        try {
            var _this = this;
            var user = await _this.findOneBy({
                resetPasswordToken: token,
                resetPasswordExpires: {
                    $gt: Date.now()
                }
            });
    
            if (!user) {
                return null;
            } else {
                var hash = await bcrypt.hash(password, constants.saltRounds);
    
                //update a user.
                user = await _this.update({
                    _id: user._id,
                    password: hash,
                    resetPasswordToken: '',
                    resetPasswordExpires: ''
                });
    
                return user;
            }
        } catch (error) {
            ErrorService.log('UserService.resetPassword', error);
            throw error;
        }
    },

    //Description: Get new access token.
    //Params:
    //Param 1:  refreshToken: Refresh token.
    //Returns: promise.
    getNewToken: async function (refreshToken) {
        try {
            var _this = this;
            var user = await _this.findOneBy({ jwtRefreshToken: refreshToken });
            
            if (!user) {
                let error = new Error('Invalid Refresh Token');
                error.code = 400;
                ErrorService.log('UserService.getNewToken', error);
                throw error;
            } else {
                var userObj = { id: user._id };

                var accessToken = `${jwt.sign(userObj, jwtKey.jwtSecretKey, { expiresIn: 86400 })}`;
                var jwtRefreshToken = randToken.uid(256);

                user = await _this.update({ _id: user._id, jwtRefreshToken: jwtRefreshToken });
    
                var token = {
                    accessToken: accessToken,
                    refreshToken: refreshToken
                };
                return token;
            }
        } catch (error) {
            ErrorService.log('UserService.getNewToken', error);
            throw error;
        }
        
    },

    changePassword: async function (data) {
        try {
            var _this = this;
            var currentPassword = data.currentPassword;
            var user = await _this.findOneBy({ _id: data._id });
            var encryptedPassword = user.password;

            var check = await bcrypt.compare(currentPassword, encryptedPassword);
            if (check) {
                var newPassword = data.newPassword;
                var hash = await bcrypt.hash(newPassword, constants.saltRounds);
                
                data.password = hash;
                user = await _this.update(data);
                
                return user;
            } else {
                let error = new Error('Current Password is incorrect.');
                error.code = 400;
                ErrorService.log('UserService.changePassword', error);
                throw error;
            }
        } catch (error) {
            ErrorService.log('UserService.changePassword', error);
            throw error;
        }
        
    },

    getAllUsers: async function (skip, limit) {
        var _this = this;
        let users = await _this.findBy({ _id: { $ne: null }, deleted: { $ne: null } }, skip, limit);
        users = await Promise.all(users.map(async (user) => {
            // find user subprojects and parent projects
            var userProjects = await ProjectService.findBy({ 'users.userId': user._id });
            var parentProjectIds = [];
            var projectIds = [];
            if (userProjects.length > 0) {
                var subProjects = userProjects.map(project => project.parentProjectId ? project : null).filter(subProject => subProject !== null);
                parentProjectIds = subProjects.map(subProject => subProject.parentProjectId._id);
                var projects = userProjects.map(project => project.parentProjectId ? null : project).filter(project => project !== null);
                projectIds = projects.map(project => project._id);
            }
            userProjects = await ProjectService.findBy({ $or: [{ _id: { $in: parentProjectIds } }, { _id: { $in: projectIds } }] });
            return await Object.assign({}, user._doc, { projects: userProjects });
        }));
        return users;
    },

    restoreBy: async function (query) {
        const _this = this;
        query.deleted = true;

        let user = await _this.findBy(query);
        if (user && user.length > 1) {
            const users = await Promise.all(user.map(async (user) => {
                const userId = user._id;
                user = await _this.update({
                    _id: userId,
                    deleted: false,
                    deletedBy: null,
                    deletedAt: null,
                });
                return user;
            }));
            return users;
        } else {
            user = user[0];
            if (user) {
                const userId = user._id;
                user = await _this.update({
                    _id: userId,
                    deleted: false,
                    deletedBy: null,
                    deletedAt: null,
                });
            }
            return user;
        }
    },

    addNotes: async function (userId, notes) {
        const _this = this;
        let adminNotes = (await _this.update({
            _id: userId,
            adminNotes: notes
        })).adminNotes;
        return adminNotes;
    },

    searchUsers: async function (query, skip, limit) {
        var _this = this;
        let users = await _this.findBy(query, skip, limit);
        users = await Promise.all(users.map(async (user) => {
            // find user subprojects and parent projects
            var userProjects = await ProjectService.findBy({ 'users.userId': user._id });
            var parentProjectIds = [];
            var projectIds = [];
            if (userProjects.length > 0) {
                var subProjects = userProjects.map(project => project.parentProjectId ? project : null).filter(subProject => subProject !== null);
                parentProjectIds = subProjects.map(subProject => subProject.parentProjectId._id);
                var projects = userProjects.map(project => project.parentProjectId ? null : project).filter(project => project !== null);
                projectIds = projects.map(project => project._id);
            }
            userProjects = await ProjectService.findBy({ $or: [{ _id: { $in: parentProjectIds } }, { _id: { $in: projectIds } }] });
            return await Object.assign({}, user._doc, { projects: userProjects });
        }));
        return users;
    },

    hardDeleteBy: async function (query) {
        try {
            await UserModel.deleteMany(query);
            return 'User(s) Removed Successfully!';
        } catch (error) {
            ErrorService.log('UserModel.deleteMany', error);
            throw error;
        }
    },

};

var bcrypt = require('bcrypt');
var constants = require('../config/constants.json');
var UserModel = require('../models/user');
var LoginIPLog = require('../models/LoginIPLog');
var util = require('./utilService.js');
var randToken = require('rand-token');
var PaymentService = require('./paymentService');
var crypto = require('crypto');
var ProjectService = require('./projectService');
var ErrorService = require('./errorService');
var jwt = require('jsonwebtoken');
var iplocation = require('iplocation').default;
var jwtKey = require('../config/keys');
var { BACKEND_HOST } = process.env;
var VerificationTokenModel = require('../models/verificationToken');
var MailService = require('../services/mailService');
var AirtableService = require('./airtableService');
