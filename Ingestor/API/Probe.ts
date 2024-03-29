import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
    NextFunction,
} from 'CommonServer/Utils/Express';
import Response from 'CommonServer/Utils/Response';
import ProbeAuthorization from '../Middleware/ProbeAuthorization';
import ProbeMonitorResponse from 'Common/Types/Probe/ProbeMonitorResponse';
import ProbeApiIngestResponse from 'Common/Types/Probe/ProbeApiIngestResponse';
import BadDataException from 'Common/Types/Exception/BadDataException';
import ProbeMonitorResponseService from 'CommonServer/Utils/Probe/ProbeMonitorResponse';
import JSONFunctions from 'Common/Types/JSONFunctions';
import { DisableAutomaticIncidentCreation } from 'CommonServer/EnvironmentConfig';
import { JSONObject } from 'Common/Types/JSON';
import ObjectID from 'Common/Types/ObjectID';
import Probe from 'Model/Models/Probe';
import ProbeService from 'CommonServer/Services/ProbeService';
import GlobalConfigService from 'CommonServer/Services/GlobalConfigService';
import Email from 'Common/Types/Email';
import GlobalConfig from 'Model/Models/GlobalConfig';
import ProjectService from 'CommonServer/Services/ProjectService';
import User from 'Model/Models/User';
import MailService from 'CommonServer/Services/MailService';
import EmailTemplateType from 'Common/Types/Email/EmailTemplateType';
import logger from 'CommonServer/Utils/Logger';

const router: ExpressRouter = Express.getRouter();

router.post(
    '/probe/status-report/offline',
    ProbeAuthorization.isAuthorizedServiceMiddleware,
    async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ): Promise<void> => {
        try {
            const data: JSONObject = req.body;
            const statusReport: JSONObject = JSONFunctions.deserialize(
                (data as JSONObject)['statusReport'] as JSONObject
            ) as JSONObject;

            if (!statusReport) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadDataException('StatusReport not found')
                );
            }

            // process status report here.

            let isWebsiteCheckOffline: boolean = false;
            let isPingCheckOffline: boolean = false;

            if (statusReport['isWebsiteCheckOffline']) {
                isWebsiteCheckOffline = statusReport[
                    'isWebsiteCheckOffline'
                ] as boolean;
            }

            if (statusReport['isPingCheckOffline']) {
                isPingCheckOffline = statusReport[
                    'isPingCheckOffline'
                ] as boolean;
            }

            if (isWebsiteCheckOffline || isPingCheckOffline) {
                // email probe owner.
                const probeId: ObjectID = new ObjectID(
                    data['probeId'] as string
                );

                const probe: Probe | null = await ProbeService.findOneBy({
                    query: {
                        _id: probeId.toString(),
                    },
                    select: {
                        _id: true,
                        projectId: true,
                        name: true,
                        description: true,
                    },
                    props: {
                        isRoot: true,
                    },
                });

                if (!probe) {
                    return Response.sendErrorResponse(
                        req,
                        res,
                        new BadDataException('Invalid Probe ID or Probe Key')
                    );
                }

                // If global probe offline? If yes, then email master-admin.
                // If not a global probe then them email project owners.

                const isGlobalProbe: boolean = !probe.projectId;
                const emailsToNotify: Email[] = [];

                let emailReason: string = '';

                if (isGlobalProbe) {
                    // email master-admin

                    const globalConfig: GlobalConfig | null =
                        await GlobalConfigService.findOneBy({
                            query: {},
                            select: {
                                _id: true,
                                adminNotificationEmail: true,
                            },
                            props: {
                                isRoot: true,
                            },
                        });

                    if (!globalConfig) {
                        return Response.sendErrorResponse(
                            req,
                            res,
                            new BadDataException('Global config not found')
                        );
                    }

                    const adminNotificationEmail: Email | undefined =
                        globalConfig.adminNotificationEmail;

                    if (adminNotificationEmail) {
                        // email adminNotificationEmail
                        emailsToNotify.push(adminNotificationEmail);

                        emailReason =
                            'This email is sent to you becuse you have listed this email as a notification email in the Admin Dashobard. To change this email, please visit the Admin Dashboard > Settings > Email.';
                    }
                } else {
                    if (!probe.projectId) {
                        return Response.sendErrorResponse(
                            req,
                            res,
                            new BadDataException('Invalid Project ID')
                        );
                    }

                    // email project owners.
                    const owners: Array<User> = await ProjectService.getOwners(
                        probe.projectId!
                    );

                    for (const owner of owners) {
                        if (owner.email) {
                            emailsToNotify.push(owner.email);
                        }
                    }

                    emailReason =
                        'This email is sent to you because you are listed as an owner of the project that this probe is associated with. To change this email, please visit the Project Dashboard > Settings > Teams and Members > Owners.';
                }

                const issue: string = '';

                if (isWebsiteCheckOffline) {
                    issue.concat(
                        'This probe cannot reach out to monitor websites'
                    );
                }

                if (isPingCheckOffline) {
                    issue.concat(
                        'This probe cannot reach out to ping other servers / hostnames or IP addresses.'
                    );
                }

                // now send an email to all the emailsToNotify
                for (const email of emailsToNotify) {
                    MailService.sendMail(
                        {
                            toEmail: email,
                            templateType: EmailTemplateType.ProbeOffline,
                            subject: 'Probe Offline Notification',
                            vars: {
                                probeName: probe.name || '',
                                description: probe.description || '',
                                projectId: probe.projectId?.toString() || '',
                                probeId: probe.id?.toString() || '',
                                hostname:
                                    statusReport['hostname']?.toString() || '',
                                emailReason: emailReason,
                                issue: issue,
                            },
                        },
                        {
                            projectId: probe.projectId,
                        }
                    ).catch((err: Error) => {
                        logger.error(err);
                    });
                }
            }

            return Response.sendJsonObjectResponse(req, res, {
                message: 'Status Report received',
            });
        } catch (err) {
            return next(err);
        }
    }
);

router.post(
    '/probe/response/ingest',
    ProbeAuthorization.isAuthorizedServiceMiddleware,
    async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ): Promise<void> => {
        try {
            if (DisableAutomaticIncidentCreation) {
                return Response.sendJsonObjectResponse(req, res, {
                    message: 'Automatic incident creation is disabled.',
                });
            }

            const probeResponse: ProbeMonitorResponse =
                JSONFunctions.deserialize(
                    req.body['probeMonitorResponse']
                ) as any;

            if (!probeResponse) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadDataException('ProbeMonitorResponse not found')
                );
            }

            // process probe response here.
            const probeApiIngestResponse: ProbeApiIngestResponse =
                await ProbeMonitorResponseService.processProbeResponse(
                    probeResponse
                );

            return Response.sendJsonObjectResponse(req, res, {
                probeApiIngestResponse: probeApiIngestResponse,
            } as any);
        } catch (err) {
            return next(err);
        }
    }
);

export default router;
