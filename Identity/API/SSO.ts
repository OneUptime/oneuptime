import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
    NextFunction,
} from 'CommonServer/Utils/Express';
import BadRequestException from 'Common/Types/Exception/BadRequestException';
import ServerException from 'Common/Types/Exception/ServerException';
import Response from 'CommonServer/Utils/Response';
import ProjectSSO from 'Model/Models/ProjectSso';
import ProjectSSOService from 'CommonServer/Services/ProjectSsoService';
import ObjectID from 'Common/Types/ObjectID';
import xml2js from 'xml2js';
import { JSONArray, JSONObject } from 'Common/Types/JSON';
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

const router: ExpressRouter = Express.getRouter();

router.get(
    '/sso/:projectId/:projectSsoId',
    async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ): Promise<void> => {
        try {
            if (!req.params['projectId']) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadRequestException('Project ID not found')
                );
            }

            if (!req.params['projectSsoId']) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadRequestException('Project SSO ID not found')
                );
            }

            const projectSSO: ProjectSSO | null =
                await ProjectSSOService.findOneBy({
                    query: {
                        projectId: new ObjectID(req.params['projectId']),
                        _id: req.params['projectSsoId'],
                        isEnabled: true,
                    },
                    select: {
                        signOnURL: true,
                    },
                    props: {
                        isRoot: true,
                    },
                });

            if (!projectSSO) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadRequestException('SSO Config not found')
                );
            }

            // redirect to Identity Provider.

            if (!projectSSO.signOnURL) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadRequestException('Sign On URL not found')
                );
            }

            return Response.redirect(req, res, projectSSO.signOnURL);
        } catch (err) {
            return next(err);
        }
    }
);

router.post(
    '/idp-login/:projectId/:projectSsoId',
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

            if (!response['saml2p:Response']) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadRequestException('SAML Response not found.')
                );
            }

            response = response['saml2p:Response'] as JSONObject;

            const issuers: JSONArray = response['saml2:Issuer'] as JSONArray;

            if (issuers.length === 0) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadRequestException('Issuers not found')
                );
            }

            const issuer: JSONObject | undefined = issuers[0];

            if (!issuer) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadRequestException('Issuer not found')
                );
            }

            const issuerUrl: string = issuer['_'] as string;

            if (!issuerUrl) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadRequestException(
                        'Issuer URL not found in SAML response'
                    )
                );
            }

            if (!req.params['projectId']) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadRequestException('Project ID not found')
                );
            }

            if (!req.params['projectSsoId']) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadRequestException('Project SSO ID not found')
                );
            }

            const projectSSO: ProjectSSO | null =
                await ProjectSSOService.findOneBy({
                    query: {
                        projectId: new ObjectID(req.params['projectId']),
                        _id: req.params['projectSsoId'],
                        isEnabled: true,
                    },
                    select: {
                        signOnURL: true,
                        issuerURL: true,
                        publicCertificate: true,
                        teams: true,
                    },
                    populate: {
                        teams: {
                            _id: true,
                        },
                    },
                    props: {
                        isRoot: true,
                    },
                });

            if (!projectSSO) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadRequestException('SSO Config not found')
                );
            }

            // redirect to Identity Provider.

            if (!projectSSO.issuerURL) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadRequestException('Issuer URL not found')
                );
            }

            // redirect to Identity Provider.

            if (!projectSSO.signOnURL) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadRequestException('Sign on URL not found')
                );
            }

            if (projectSSO.issuerURL.toString() !== issuerUrl) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadRequestException('Issuer URL does not match')
                );
            }

            if (!projectSSO.publicCertificate) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadRequestException('Public Certificate not found')
                );
            }

            // TODO: Verify signed message with certificate.

            const samlAssertion: JSONArray = response[
                'saml2:Assertion'
            ] as JSONArray;

            if (!samlAssertion || samlAssertion.length === 0) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadRequestException('SAML Assertion not found')
                );
            }

            const samlSubject: JSONArray = (samlAssertion[0] as JSONObject)[
                'saml2:Subject'
            ] as JSONArray;

            if (!samlSubject || samlSubject.length === 0) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadRequestException('SAML Subject not found')
                );
            }

            const samlNameId: JSONArray = (samlSubject[0] as JSONObject)[
                'saml2:NameID'
            ] as JSONArray;

            if (!samlNameId || samlNameId.length === 0) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadRequestException('SAML NAME ID not found')
                );
            }

            const emailString: string = (samlNameId[0] as JSONObject)[
                '_'
            ] as string;

            if (!emailString) {
                if (!samlNameId || samlNameId.length === 0) {
                    return Response.sendErrorResponse(
                        req,
                        res,
                        new BadRequestException('SAML Email not found')
                    );
                }
            }

            // Now we have the user email.
            const email: Email = new Email(emailString);

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
                            req.params['projectId'] as string
                        ),
                        userId: alreadySavedUser.id!,
                    },
                    props: {
                        isRoot: true,
                    },
                });

            if (teamMemberCount.toNumber() === 0) {
                // user not in project, add him to default teams.

                if (!projectSSO.teams || projectSSO.teams.length === 0) {
                    return Response.render(req, res, '../Views/Message.ejs', {
                        title: 'No teams added.',
                        message:
                            'No teams have been added to this SSO config. Please contact your admin and have default teams added.',
                    });
                }

                for (const team of projectSSO.teams) {
                    // add user to team
                    let teamMember: TeamMember = new TeamMember();
                    teamMember.projectId = new ObjectID(
                        req.params['projectId'] as string
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
                    projectId: new ObjectID(req.params['projectId']),
                    email: email,
                    isMasterAdmin: false,
                },
                OneUptimeDate.getSecondsInDays(new PositiveNumber(30))
            );

            return Response.redirect(
                req,
                res,
                new URL(
                    HttpProtocol,
                    Domain,
                    new Route(DashboardRoute.toString()).addRoute(
                        '/' + req.params['projectId']
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
