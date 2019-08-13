var express = require('express');
var UserService = require('../services/userService');
var ProjectService = require('../services/projectService');
var jwtKey = require('../config/keys');
var jwt = require('jsonwebtoken');
var bcrypt = require('bcrypt');
var MailService = require('../services/mailService');
const getUser = require('../middlewares/user').getUser;
var sendErrorResponse = require('../middlewares/response').sendErrorResponse;
var sendItemResponse = require('../middlewares/response').sendItemResponse;
var router = express.Router();
var multer = require('multer');
const storage = require('../middlewares/upload');
var winston = require('winston');
var constants = require('../config/constants.json');
var { emaildomains } = require('../config/emaildomains');
var randToken = require('rand-token');
var VerificationTokenModel = require('../models/verificationToken');
var { FYIPE_ACCOUNT_HOST } = process.env;
var UserModel = require('../models/user');
var ErrorService = require('../services/errorService');

router.post('/signup', async function (req, res) {
    var data = req.body;
    if (!data.email) {
        return sendErrorResponse(req, res, {
            code: 400,
            message: 'Email must be present.'
        });
    }

    if (typeof data.email !== 'string') {
        return sendErrorResponse(req, res, {
            code: 400,
            message: 'Email is not in string format.'
        });
    }

    if (!emaildomains.test(data.email)){
        return sendErrorResponse(req, res, {
            code: 400,
            message: 'Business email address is required.'
        });
    }

    if (!data.password) {
        return sendErrorResponse(req, res, {
            code: 400,
            message: 'Password must be present.'
        });
    }

    if (typeof data.password !== 'string') {
        return sendErrorResponse(req, res, {
            code: 400,
            message: 'Password is not in string format.'
        });
    }

    if (!data.confirmPassword) {
        return sendErrorResponse(req, res, {
            code: 400,
            message: 'Confirm password must be present.'
        });
    }

    if (typeof data.confirmPassword !== 'string') {
        return sendErrorResponse(req, res, {
            code: 400,
            message: 'Confirm password is not in string format.'
        });
    }

    if (data.confirmPassword !== data.confirmPassword) {
        return sendErrorResponse(req, res, {
            code: 400,
            message: 'Password and Confirm password are not same.'
        });
    }

    if (!data.name) {
        return sendErrorResponse(req, res, {
            code: 400,
            message: 'Name must be present.'
        });
    }

    if (typeof data.name !== 'string') {
        return sendErrorResponse(req, res, {
            code: 400,
            message: 'Name is not in string format.'
        });
    }

    try {
        var user = await UserService.findOneBy({ email: data.email });
        //Checks if user is registered with only email
        if (user) {
            if (!user.password) {
                var hash = await bcrypt.hash(data.password, constants.saltRounds);
                // creating jwt refresh token
                var jwtRefreshToken = randToken.uid(256);
                user = await UserService.update({ _id: user._id, name: data.name, password: hash, jwtRefreshToken: jwtRefreshToken });

                // Call the MailService.
                MailService.sendSignupMail(user.email, user.name);

                // create access token and refresh token.
                let authUserObj = {
                    id: user._id,
                    name: user.name,
                    email: user.email,
                    cardRegistered: user.stripeCustomerId ? true : false,
                    tokens: {
                        jwtAccessToken: `${jwt.sign({
                            id: user._id,
                            name: user.name,
                            email: user.email
                        }, jwtKey.jwtSecretKey, { expiresIn: 8640000 })}`,
                        jwtRefreshToken: user.jwtRefreshToken,
                    },
                };
                winston.info('User just signed up');
                return sendItemResponse(req, res, authUserObj);
            } else {
                return sendErrorResponse(req, res, {
                    message: 'Email Address is already taken.',
                    code: 400
                });
            }
        } else {

            if (!data.companyName) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Company Name must be present.'
                });
            }

            if (typeof data.companyName !== 'string') {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Company Name is not in string format.'
                });
            }

            if (!data.companyPhoneNumber) {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Company phone number must be present.'
                });
            }

            if (typeof data.companyPhoneNumber !== 'string') {
                return sendErrorResponse(req, res, {
                    code: 400,
                    message: 'Company phone number  is not in string format.'
                });
            }
            if (data.cvv && !data.cvc) {
                data.cvc = data.cvv;
            }
            // Call the UserService.
            user = await UserService.signup(data);
            // Call the MailService.
            MailService.sendSignupMail(user.email, user.name);
            // create access token and refresh token.
            let authUserObj = {
                id: user._id,
                name: user.name,
                email: user.email,
                cardRegistered: user.stripeCustomerId ? true : false,
                tokens: {
                    jwtAccessToken: `${jwt.sign({
                        id: user._id,
                        name: user.name,
                        email: user.email
                    }, jwtKey.jwtSecretKey, { expiresIn: 8640000 })}`,
                    jwtRefreshToken: user.jwtRefreshToken,
                },
            };
            winston.info('A User just signed up');
            var project = await ProjectService.findOneBy({ 'users.userId': user._id });
            return sendItemResponse(req, res, Object.assign(authUserObj, { project: project }));
        }
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// Route
// Description: login function for  user
// Params:
// Param 1: req.body-> {email, password }
// Returns: 400: Error; 500: Server Error; 200: user
router.post('/login', async function (req, res) {
    var data = req.body;
    var clientIP = req.headers['x-forwarded-for'] || req.connection.remoteAddress;

    if (!data.email) {
        return sendErrorResponse(req, res, {
            code: 400,
            message: 'Email must be present.'
        });
    }

    if (typeof data.email !== 'string') {
        return sendErrorResponse(req, res, {
            code: 400,
            message: 'Email is not in string format.'
        });
    }

    if (!data.password) {
        return sendErrorResponse(req, res, {
            code: 400,
            message: 'Password must be present.'
        });
    }

    if (typeof data.password !== 'string') {
        return sendErrorResponse(req, res, {
            code: 400,
            message: 'Password is not in string format.'
        });
    }

    try {
        // Call the UserService
        var user = await UserService.login(data.email, data.password, clientIP);
        // create access token and refresh token.
        let authUserObj = {
            id: user._id,
            name: user.name,
            email: user.email,
            redirect: data.redirect || null,
            cardRegistered: user.stripeCustomerId ? true : false,
            tokens: {
                jwtAccessToken: `${jwt.sign({
                    id: user._id,
                    name: user.name,
                    email: user.email
                }, jwtKey.jwtSecretKey, { expiresIn: 8640000 })}`,
                jwtRefreshToken: user.jwtRefreshToken,
            },
        };

        return sendItemResponse(req, res, authUserObj);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }

});

// Route
// Description: forgot password function for  user
// Params:
// Param 1: req.body-> {email}; req.headers-> {host}
// Returns: 400: Error; 500: Server Error: 200: User password has been reset successfully.

router.post('/forgot-password', async function (req, res) {
    var data = req.body;

    if (!data.email) {
        return sendErrorResponse(req, res, {
            code: 400,
            message: 'Email must be present.'
        });
    }

    if (typeof data.email !== 'string') {
        return sendErrorResponse(req, res, {
            code: 400,
            message: 'Email in not in string format.'
        });
    }

    try {
        // Call the UserService.
        var user = await UserService.forgotPassword(data.email);
        // Call the MailService.
        await MailService.sendForgotPasswordMail(req.headers.host, user.email, user.resetPasswordToken);
        
        return sendItemResponse(req, res, {
            message: 'User received mail succcessfully.'
        });
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// Route
// Description: reset password function for  user
// Params:
// Param 1: req.body-> {password}; req.params-> {token}
// Returns: 400: Error; 500: Server Error; 200: User password has been reset successfully.
router.post('/reset-password', async function (req, res) {
    var data = req.body;

    if (!data.password) {
        return sendErrorResponse(req, res, {
            code: 400,
            message: 'Password must be present.'
        });
    }

    if (typeof data.password !== 'string') {
        return sendErrorResponse(req, res, {
            code: 400,
            message: 'Password in not in string format.'
        });
    }

    if (!data.token) {
        return sendErrorResponse(req, res, {
            code: 400,
            message: 'Token must be present.'
        });
    }

    if (typeof data.token !== 'string') {
        return sendErrorResponse(req, res, {
            code: 400,
            message: 'Token in not in string format.'
        });
    }

    try {
        // Call the UserService
        var user = await UserService.resetPassword(data.password, data.token);
        if (!user) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Reset password token has expired or token is invalid.'
            });
        }

        // Call the MailService.
        await MailService.sendResetPasswordConfirmMail(user.email);
        return sendItemResponse(req, res, {
            message: 'User password has been reset successfully.'
        });
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }

});

// Route
// Description: login function for  user
// Params:
// Param 1: req.body-> {email, password }
// Returns: 400: Error; 500: Server Error; 200: user
router.post('/isInvited', async function (req, res) {
    var data = req.body;

    if (!data.email) {
        return sendErrorResponse(req, res, {
            code: 400,
            message: 'Email must be present.'
        });
    }

    try {
        // Call the UserService
        var user = await UserService.findOneBy({ email: data.email });
        if (user) {
            return sendItemResponse(req, res, true);
        } else {
            return sendItemResponse(req, res, false);
        }
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }

});

// I used to validate token given to redirected urls such as status page
router.post('/isAuthenticated', getUser, async (req, res) => {
    // request will get here if user is authenticated.
    return sendItemResponse(req, res, { authenticated: true, user: req.user });
});

// Route
// Description: Updating profile setting.
// Params:
// Param 1: req.headers-> {authorization}; req.user-> {id}; req.files-> {profilePic};
// Returns: 200: Success, 400: Error; 500: Server Error.
router.put('/profile', getUser, async function (req, res) {
    var upload = multer({
        storage
    }).fields([{
        name: 'profilePic',
        maxCount: 1
    }]);

    upload(req, res, async function (error) {
        var userId = req.user ? req.user.id : null;
        var data = req.body;
        data._id = userId;

        if (error) {
            return sendErrorResponse(req, res, error);
        }

        if (req.files && req.files.profilePic && req.files.profilePic[0].filename) {
            data.profilePic = req.files.profilePic[0].filename;
        }

        try {
            // Call the UserService
            var user = await UserService.update(data);
            return sendItemResponse(req, res, user);
        } catch (error) {
            return sendErrorResponse(error);
        }
    });

});

// Route
// Description: Updating change password setting.
// Params:
// Param 1: req.headers-> {authorization}; req.user-> {id}; req.files-> {profilePic}; req.data- {currentPassword, newPassword, confirmPassword}
// Returns: 200: Success, 400: Error; 500: Server Error.
router.put('/changePassword', getUser, async function (req, res) {
    var data = req.body;
    var userId = req.user ? req.user.id : null;
    data._id = userId;

    if (!data.currentPassword) {
        return sendErrorResponse(req, res, {
            code: 400,
            message: 'Current Password must be present.'
        });
    }

    if (typeof data.currentPassword !== 'string') {
        return sendErrorResponse(req, res, {
            code: 400,
            message: 'Current Password  is not in string type.'
        });
    }

    if (!data.newPassword) {
        return sendErrorResponse(req, res, {
            code: 400,
            message: 'New Password  must be present.'
        });
    }

    if (typeof data.newPassword !== 'string') {
        return sendErrorResponse(req, res, {
            code: 400,
            message: 'New Password is not in string type.'
        });
    }

    if (!data.confirmPassword) {
        return sendErrorResponse(req, res, {
            code: 400,
            message: 'Confirm Password must be present.'
        });
    }

    if (typeof data.confirmPassword !== 'string') {
        return sendErrorResponse(req, res, {
            code: 400,
            message: 'Confirm Password  is not in string type.'
        });
    }

    if (data.confirmPassword !== data.newPassword) {
        return sendErrorResponse(req, res, {
            code: 400,
            message: 'New and Confirm password is not same.'
        });
    }

    try {
        var user = await UserService.changePassword(data);
        let userObj = {
            id: user._id,
            name: user.name,
            email: user.email,
            redirect: data.redirect,
            tokens: {
                jwtAccessToken: `${jwt.sign({
                    id: user._id,
                    name: user.name,
                    email: user.email
                }, jwtKey.jwtSecretKey, { expiresIn: 8640000 })}`,
                jwtRefreshToken: user.jwtRefreshToken,
            },
        };
        return sendItemResponse(req, res, userObj);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// Route
// Description: Get Previous User Settings.
// Params:
// Param 1: req.headers-> {authorization}; req.user-> {id};
// Returns: 200: Success, 400: Error; 500: Server Error.
router.get('/profile', getUser, async function (req, res) {
    var userId = req.user ? req.user.id : null;

    if (!userId) {
        return sendErrorResponse(req, res, {
            code: 400,
            message: 'UserId must be present.'
        });
    }

    try {
        // Call the UserService
        var user = await UserService.findOneBy({ _id: userId });
        let userObj = {
            id: user._id,
            name: user.name ? user.name : '',
            email: user.email ? user.email : '',
            password: user.password,
            companyName: user.companyName,
            companyRole: user.companyRole,
            companySize: user.companySize,
            referral: user.referral,
            companyPhoneNumber: user.companyPhoneNumber ? user.companyPhoneNumber : '',
            alertPhoneNumber: user.alertPhoneNumber ? user.alertPhoneNumber : '',
            profilePic: user.profilePic,
            timezone: user.timezone ? user.timezone : '',
            tokens: {
                jwtAccessToken: `${jwt.sign({
                    id: user._id,
                    name: user.name,
                    email: user.email
                }, jwtKey.jwtSecretKey, { expiresIn: 8640000 })}`,
                jwtRefreshToken: user.jwtRefreshToken,
            },
        };
        return sendItemResponse(req, res, userObj);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

router.get('/confirmation/:token', async function (req, res) {
    if (req.params && req.params.token) {
        var token = await VerificationTokenModel.findOne({ token: req.params.token });
        if (!token) {
            return res.redirect(FYIPE_ACCOUNT_HOST+'/user-verify/resend?status=Lc5orxwR5nKxTANs8jfNsCvGD8Us9ltq');
        }
        var user = await UserModel.findOne({
            _id: token.userId
        });
        if (!user) {
            return res.redirect(FYIPE_ACCOUNT_HOST+'/register?status=z1hb0g8vfg0rWM1Ly1euQSZ1L5ZNHuAk');
        }
        if (user.isVerified) {
            return res.redirect(FYIPE_ACCOUNT_HOST+'/login?status=IIYQNdn4impaXQeeteTBEBmz0If1rlwC');
        }
        try{
            await UserModel.findByIdAndUpdate(user._id, {
                $set:{
                    isVerified:true
                }
            });
            return res.redirect(FYIPE_ACCOUNT_HOST+'/login?status=V0JvLGX4U0lgO9Z9ulrOXFW9pNSGLSnP');
        } catch (error){
            ErrorService.log('user.confirm', error);
            throw error;
        }
    }
    else {
        return res.redirect(FYIPE_ACCOUNT_HOST+'/user-verify/resend?status=eG5aFRDeZXgOkjEfdhOYbFb2lA3Z0OJm');
    }
});

router.post('/resend', async function (req, res) {
    if (req.body && req.body.email) {
        var { email } = req.body;
        var user = await UserModel.findOne({ email });
        if (!user) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'No user associated with this email'
            });
        }
        if (user.isVerified) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'User has been already verified.'
            });
        }
        var token = await UserService.sendToken(user);
        if(token){
            res.status(200).send(`A verification email has been sent to ${user.email}`);
        }
    }
    else {
        return sendErrorResponse(req, res, {
            code: 400,
            message: 'Email should be present'
        });
    }
});

module.exports = router;
