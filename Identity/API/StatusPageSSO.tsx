import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
    NextFunction,
} from 'CommonServer/Utils/Express';
import BadRequestException from 'Common/Types/Exception/BadRequestException';
import ServerException from 'Common/Types/Exception/ServerException';
import Response from 'CommonServer/Utils/Response';
import StatusPageSsoService from 'CommonServer/Services/StatusPageSsoService';
import ObjectID from 'Common/Types/ObjectID';
import xml2js from 'xml2js';
import { JSONObject } from 'Common/Types/JSON';
import logger from 'CommonServer/Utils/Logger';
import Email from 'Common/Types/Email';
import User from 'Model/Models/User';
import UserService from 'CommonServer/Services/UserService';
import AuthenticationEmail from '../Utils/AuthenticationEmail';
import OneUptimeDate from 'Common/Types/Date';
import PositiveNumber from 'Common/Types/PositiveNumber';
import JSONWebToken from 'CommonServer/Utils/JsonWebToken';
import URL from 'Common/Types/API/URL';
import { DashboardRoute, Domain, HttpProtocol } from 'CommonServer/Config';
import Route from 'Common/Types/API/Route';
import TeamMember from 'Model/Models/TeamMember';
import TeamMemberService from 'CommonServer/Services/TeamMemberService';
import AccessTokenService from 'CommonServer/Services/AccessTokenService';
import SSOUtil from "../Utils/SSO";
import Exception from 'Common/Types/Exception/Exception';
import StatusPageSSO from 'Model/Models/StatusPageSso';

const router: ExpressRouter = Express.getRouter();

router.get(
    '/status-page-sso/:statusPageId/:statusPageSsoId',
    async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ): Promise<void> => {
        try {
            if (!req.params['statusPageId']) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadRequestException('Status Page ID not found')
                );
            }

            if (!req.params['statusPageSsoId']) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadRequestException('Status Page SSO ID not found')
                );
            }

            const statusPageSSO: StatusPageSSO | null =
                await StatusPageSsoService.findOneBy({
                    query: {
                        statusPageId: new ObjectID(req.params['statusPageId']),
                        _id: req.params['statusPageSsoId'],
                        isEnabled: true,
                    },
                    select: {
                        signOnURL: true,
                    },
                    props: {
                        isRoot: true,
                    },
                });

            if (!statusPageSSO) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadRequestException('SSO Config not found')
                );
            }

            // redirect to Identity Provider.

            if (!statusPageSSO.signOnURL) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadRequestException('Sign On URL not found')
                );
            }

            return Response.redirect(req, res, statusPageSSO.signOnURL);
        } catch (err) {
            return next(err);
        }
    }
);

router.post(
    '/status-page-idp-login/:statusPageId/:statusPageSsoId',
    async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
        try {
            const samlResponseBase64: string = req.body.SAMLResponse;

            const samlResponse: string = Buffer.from(
                samlResponseBase64,
                'base64'
            ).toString();

            let response: JSONObject = await xml2js.parseStringPromise(
                samlResponse
            );

            let issuerUrl: string = '';
            let email: Email | null = null;


            if (!req.params['statusPageId']) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadRequestException('Status Page ID not found')
                );
            }

            if (!req.params['statusPageSsoId']) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadRequestException('Status Page SSO ID not found')
                );
            }

            const statusPageSSO: StatusPageSSO | null =
                await StatusPageSsoService.findOneBy({
                    query: {
                        projectId: new ObjectID(req.params['statusPageId']),
                        _id: req.params['statusPageSsoId'],
                        isEnabled: true,
                    },
                    select: {
                        signOnURL: true,
                        issuerURL: true,
                        publicCertificate: true,
                    },
                    props: {
                        isRoot: true,
                    },
                });

            if (!statusPageSSO) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadRequestException('SSO Config not found')
                );
            }

            // redirect to Identity Provider.

            if (!statusPageSSO.issuerURL) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadRequestException('Issuer URL not found')
                );
            }

            // redirect to Identity Provider.

            if (!statusPageSSO.signOnURL) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadRequestException('Sign on URL not found')
                );
            }

            

            if (!statusPageSSO.publicCertificate) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadRequestException('Public Certificate not found')
                );
            }

            try {

                SSOUtil.isPayloadValid(response);
                SSOUtil.isSignatureValid(response, statusPageSSO.publicCertificate);
                issuerUrl = SSOUtil.getIssuer(response);

                console.log(issuerUrl);

                email = SSOUtil.getEmail(response);

                console.log(email);
            } catch (err: unknown) {
                if (err instanceof Exception) {
                    return Response.sendErrorResponse(req, res, err);
                }else{
                    return Response.sendErrorResponse(req, res, new ServerException());
                }
            }


            if (statusPageSSO.issuerURL.toString() !== issuerUrl) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadRequestException('Issuer URL does not match')
                );
            }


            // Check if he already belongs to the project, If he does - then log in.

            let alreadySavedUser: User | null = await UserService.findOneBy({
                query: { email: email },
                select: {
                    _id: true,
                    name: true,
                    email: true,
                    isMasterAdmin: true,
                    isEmailVerified: true,
                    profilePictureId: true,
                },
                props: {
                    isRoot: true,
                },
            });

            let isNewUser: boolean = false;

            if (!alreadySavedUser) {
                // this should never happen because user is logged in before he signs in with SSO UNLESS he initiates the login though the IDP.

                /// Create a user.

                alreadySavedUser = await UserService.createByEmail(email, {
                    isRoot: true,
                });

                isNewUser = true;
            }

            // If he does not then add him to teams that he should belong and log in.
            if (!alreadySavedUser.isEmailVerified && !isNewUser) {
                await AuthenticationEmail.sendVerificationEmail(
                    alreadySavedUser
                );

                return Response.render(req, res, '../Views/Message.ejs', {
                    title: 'Email not verified.',
                    message:
                        'Email is not verified. We have sent you an email with the verification link. Please do not forget to check spam.',
                });
            }

            // check if the user already belongs to the project
            const teamMemberCount: PositiveNumber =
                await TeamMemberService.countBy({
                    query: {
                        projectId: new ObjectID(
                            req.params['statusPageId'] as string
                        ),
                        userId: alreadySavedUser.id!,
                    },
                    props: {
                        isRoot: true,
                    },
                });

            if (teamMemberCount.toNumber() === 0) {
                // user not in project, add him to default teams.

                if (!statusPageSSO.teams || statusPageSSO.teams.length === 0) {
                    return Response.render(req, res, '../Views/Message.ejs', {
                        title: 'No teams added.',
                        message:
                            'No teams have been added to this SSO config. Please contact your admin and have default teams added.',
                    });
                }

                for (const team of statusPageSSO.teams) {
                    // add user to team
                    let teamMember: TeamMember = new TeamMember();
                    teamMember.projectId = new ObjectID(
                        req.params['statusPageId'] as string
                    );
                    teamMember.userId = alreadySavedUser.id!;
                    teamMember.hasAcceptedInvitation = true;
                    teamMember.invitationAcceptedAt =
                        OneUptimeDate.getCurrentDate();
                    teamMember.teamId = team.id!;

                    teamMember = await TeamMemberService.create({
                        data: teamMember,
                        props: {
                            isRoot: true,
                            ignoreHooks: true,
                        },
                    });
                }
            }

            if (isNewUser) {
                return Response.render(req, res, '../Views/Message.ejs', {
                    title: 'You have not signed up so far.',
                    message:
                        'You need to sign up for an account on OneUptime with this email:' +
                        email.toString() +
                        '. Once you have signed up, you can use SSO to log in to your project.',
                });
            }

            const token: string = JSONWebToken.sign(
                {
                    userId: alreadySavedUser.id!,
                    projectId: new ObjectID(req.params['statusPageId']),
                    email: email,
                    isMasterAdmin: false,
                },
                OneUptimeDate.getSecondsInDays(new PositiveNumber(30))
            );

            // Refresh Permissions for this user here.
            await AccessTokenService.refreshUserAllPermissions(
                alreadySavedUser.id!
            );

            return Response.redirect(
                req,
                res,
                new URL(
                    HttpProtocol,
                    Domain,
                    new Route(DashboardRoute.toString()).addRoute(
                        '/' + req.params['statusPageId']
                    ),
                    'sso_token=' + token
                )
            );
        } catch (err) {
            logger.error(err);
            Response.sendErrorResponse(req, res, new ServerException());
        }
    }
);

export default router;
