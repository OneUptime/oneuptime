import { DisableSignup } from 'CommonServer/Config';
import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
} from 'CommonServer/utils/Express';


const router: ExpressRouter = Express.getRouter();

router.post('/signup', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
        if (
            DisableSignup
        ) {
            // Res,and next is skipped in isUserMasterAdmin because we don't want to reject the request.
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
                token: req.query['token'],
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
                // Creating jwt refresh token
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
                // Create access token and refresh token.
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
            }
            return sendErrorResponse(req, res, {
                message: 'Email Address is already taken.',
                code: 400,
            });
        }
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

        // Create access token and refresh token.
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
    } catch (error) {
        return sendErrorResponse(req, res, error as Exception);
    }
});

export default router; 