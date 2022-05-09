import { DisableSignup, IsSaaSService } from 'CommonServer/Config';
import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
} from 'CommonServer/utils/Express';
import BadRequestException from 'Common/Types/Exception/BadRequestException';
import { JSONObject } from 'Common/Types/JSON';
import User from 'Common/Models/User';
import Service from 'CommonServer/Services/Index';

const UserService = Service.UserService;

const router: ExpressRouter = Express.getRouter();

router.post('/signup', async (req: ExpressRequest, res: ExpressResponse) => {
    try {

        if (
            DisableSignup
        ) {
            throw new BadRequestException("Sign up is disabled.");
        }

        const data: JSONObject = req.body;
        const user: User = User.fromJSON(data);

        if (IsSaaSService) {
            //ALERT: Delete data.role so user don't accidently sign up as master-admin from the API.
            user.isMasterAdmin = false;
        }

       
        const [userData, token]: $TSFixMe = await Promise.all([
            UserService.findOneBy({
                query: { email: user.email },
                select: {
                    _id: true,
                    password: true
                },
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