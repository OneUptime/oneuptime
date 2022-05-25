import {
    ExpressRequest,
    ExpressResponse,
    NextFunction,
    ExpressStatic,
} from 'CommonServer/Utils/Express';
import logger from 'CommonServer/Utils/Logger';
import App from 'CommonServer/Utils/StartServer';

export const APP_NAME: string = 'api';
const app = App(APP_NAME);

import expressRequestId from 'express-request-id';

app.use(expressRequestId);

import path from 'path';
import mongoose from './backend/config/db';

import Gl from 'greenlock';

import { getUser } from './backend/middlewares/user';

import { getProjectId } from './backend/middlewares/api';

// Middleware

import AuditLogsMiddleware from './backend/middlewares/auditLogs';

// API
import IncomingHTTPRequestAPI from './api/incomingHttpRequest';
import AlertAPI from './api/alert';
import UserAPI from './api/user';
import LoginHistoryAPI from './api/loginHistory';
import TokenAPI from './api/token';
import TeamAPI from './api/team';
import ProjectAPI from './api/project';
import InvoiceAPI from './api/invoice';
import ScheduleAPI from './api/schedule';
import MonitorAPI from './api/monitor';
import StatusPageAPI from './api/statusPage';
import FileAPI from './api/file';
import IncidentAPI from './api/incident';
import IncidentPriorityAPI from './api/incidentPriorities';
import IncidentSettingsAPI from './api/incidentSettings';
import ReportAPI from './api/report';
import LeadAPI from './api/lead';
import TwilioAPI from './api/twilio';
import SsoAPI from './api/sso';
import FeedbackAPI from './api/feedback';
import WebHookAPI from './api/webhooks';
import ZapierAPI from './api/zapier';
import SlackAPI from './api/slack';
import ServerAPI from './api/server';
import NotificationAPI from './api/notification';
import SubscriberAPI from './api/subscriber';
import SsoDefaultRoleAPI from './api/ssoDefaultRoles';
import AutomatedScriptAPI from './api/automatedScript';
import CallLogsAPI from './api/callLogs';
import EmailLogsAPI from './api/emailLogs';
import StripeAPI from './api/stripe';
import EmailTemplateAPI from './api/emailTemplate';
import SmsTemplateAPI from './api/smsTemplate';
import SubscriberAlertAPI from './api/subscriberAlert';
import ContainerSecurityAPI from './api/containerSecurity';
import ApplciationSecurityAPI from './api/applicationSecurity';
import GlobalConfigAPI from './api/globalConfig';
import DockerCredentialsAPI from './api/dockerCredential';
import GitCredentialsAPI from './api/gitCredential';
import ProbeAPI from './api/probe';
import ResourceCategoryAPI from './api/resourceCategory';
import StatusPageCategoryAPI from './api/statusPageCategory';
import TutorialAPI from './api/tutorial';
import ApplicationScannerAPI from './api/applicationScanner';
import ContainerScannerAPI from './api/containerScanner';
import AuditLogAPI from './api/auditLogs';
import SMSLogAPI from './api/smsLogs';
import ScheduledEventAPI from './api/scheduledEvent';
import LighthouseAPI from './api/lighthouse';
import ScriptRunnerAPI from './api/scriptRunner';
import CustomFieldAPI from './api/customField';
import ComponentAPI from './api/component';
import SearchAPI from './api/search';
import ApplicationLogAPI from './api/applicationLog';
import PerformanceTrackerAPI from './api/performanceTracker';
import PerformanceTrackerMetricAPI from './api/performanceTrackerMetric';
import ErrorTrackerAPI from './api/errorTracker';
import EmailSmtpAPI from './api/emailSmtp';
import SmsSmtpAPI from './api/smsSmtp';
import DomainVerificationTokenAPI from './api/domainVerificationToken';
import MonitorSlaAPI from './api/monitorSla';
import IncidentCommunicationSlaAPI from './api/incidentCommunicationSla';
import MonitorCriteriaAPI from './api/monitorCriteria';
import ApplicationSecurityLogAPI from './api/applicationSecurityLog';
import ContainerSecurityLogAPI from './api/containerSecurityLog';
import SiteManagerAPI from './api/siteManager';
import DefaultManagerAPI from './api/defaultManager';
import IncidentNoteTemplateAPI from './api/incidentNoteTemplate';
import CertificateStoreAPI from './api/certificateStore';
import AccountStoreAPI from './api/accountStore';
import SslAPI from './api/ssl';
import GroupsAPI from './api/groups';
import CallRoutingAPI from './api/callRouting';
import MonitorCustomFieldAPI from './api/monitorCustomField';

// WORKERS
import './backend/workers/main';

app.use(
    async (
        req: ExpressRequest,
        _res: ExpressResponse,
        next: NextFunction
    ): void => {
        req = (await getUser(req)) || req;
        req = (await getProjectId(req)) || req;
        next();
    }
);

//View engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Enable trust proxy

app.set('trust proxy', true);

app.use(ExpressStatic(path.join(__dirname, 'views')));

app.use('/api', ExpressStatic(path.join(__dirname, 'views')));

app.use(AuditLogsMiddleware.log);

// Routes(API)

app.use(
    ['/incomingHttpRequest', `${APP_NAME}/incomingHttpRequest`],
    IncomingHTTPRequestAPI
);

app.use(['/alert', `${APP_NAME}/alert`], AlertAPI);

app.use(['/user', `${APP_NAME}/user`], UserAPI);

app.use(['/history', `${APP_NAME}/history`], LoginHistoryAPI);

app.use(['/token', `${APP_NAME}/token`], TokenAPI);

app.use(['/team', `${APP_NAME}/team`], TeamAPI);

app.use(['/project', `${APP_NAME}/project`], ProjectAPI);

app.use(['/invoice', `${APP_NAME}/invoice`], InvoiceAPI);

app.use(['/schedule', `${APP_NAME}/schedule`], ScheduleAPI);

app.use(['/monitor', `${APP_NAME}/monitor`], MonitorAPI);

app.use(['/StatusPage', `${APP_NAME}/StatusPage`], StatusPageAPI);

app.use(['/file', `${APP_NAME}/file`], FileAPI);

app.use(['/incident', `${APP_NAME}/incident`], IncidentAPI);

app.use(
    ['/incidentPriorities', `${APP_NAME}/incidentPriorities`],
    IncidentPriorityAPI
);

app.use(
    ['/incidentSettings', `${APP_NAME}/incidentSettings`],
    IncidentSettingsAPI
);

app.use(['/reports', `${APP_NAME}/reports`], ReportAPI);

app.use(['/lead', `${APP_NAME}/lead`], LeadAPI);

app.use(['/feedback', `${APP_NAME}/feedback`], FeedbackAPI);

app.use(['/twilio', `${APP_NAME}/twilio`], TwilioAPI);

app.use(['/sso', `${APP_NAME}/sso`], SsoAPI);

app.use(['/ssoDefaultRoles', `${APP_NAME}/ssoDefaultRoles`], SsoDefaultRoleAPI);

app.use(['/zapier', `${APP_NAME}/zapier`], ZapierAPI);

app.use(['/slack', `${APP_NAME}/slack`], SlackAPI);

app.use(['/webhook', `${APP_NAME}/webhook`], WebHookAPI);

app.use(['/server', `${APP_NAME}/server`], ServerAPI);

app.use(['/notification', `${APP_NAME}/notification`], NotificationAPI);

app.use(['/stripe', `${APP_NAME}/stripe`], StripeAPI);

app.use(['/subscriber', `${APP_NAME}/subscriber`], SubscriberAPI);

app.use(
    ['/subscriberAlert', `${APP_NAME}/subscriberAlert`],
    SubscriberAlertAPI
);

app.use(['/emailTemplate', `${APP_NAME}/emailTemplate`], EmailTemplateAPI);

app.use(['/emailSmtp', `${APP_NAME}/emailSmtp`], EmailSmtpAPI);

app.use(['/smsTemplate', `${APP_NAME}/smsTemplate`], SmsTemplateAPI);

app.use(['/smsSmtp', `${APP_NAME}/smsSmtp`], SmsSmtpAPI);

app.use(
    ['/resourceCategory', `${APP_NAME}/resourceCategory`],
    ResourceCategoryAPI
);

app.use(
    ['/statusPageCategory', `${APP_NAME}/statusPageCategory`],
    StatusPageCategoryAPI
);

app.use(
    ['/monitorCriteria', `${APP_NAME}/monitorCriteria`],
    MonitorCriteriaAPI
);

app.use(['/scheduledEvent', `${APP_NAME}/scheduledEvent`], ScheduledEventAPI);

app.use(['/probe', `${APP_NAME}/probe`], ProbeAPI);

app.use(['/application', `${APP_NAME}/application`], ApplicationScannerAPI);

app.use(['/container', `${APP_NAME}/container`], ContainerScannerAPI);

app.use(['/lighthouse', `${APP_NAME}/lighthouse`], LighthouseAPI);

app.use(['/tutorial', `${APP_NAME}/tutorial`], TutorialAPI);

app.use(['/audit-logs', `${APP_NAME}/audit-logs`], AuditLogAPI);

app.use(['/email-logs', `${APP_NAME}/email-logs`], EmailLogsAPI);

app.use(['/call-logs', `${APP_NAME}/call-logs`], CallLogsAPI);

app.use(
    ['/automated-scripts', `${APP_NAME}/automated-scripts`],
    AutomatedScriptAPI
);

app.use(['/sms-logs', `${APP_NAME}/sms-logs`], SMSLogAPI);

app.use(['/component', `${APP_NAME}/component`], ComponentAPI);

app.use(['/application-log', `${APP_NAME}/application-log`], ApplicationLogAPI);

app.use(['/globalConfig', `${APP_NAME}/globalConfig`], GlobalConfigAPI);

app.use(
    ['/domainVerificationToken', `${APP_NAME}/domainVerificationToken`],
    DomainVerificationTokenAPI
);

app.use(['/security', `${APP_NAME}/security`], ContainerSecurityAPI);

app.use(['/security', `${APP_NAME}/security`], ApplciationSecurityAPI);

app.use(['/credential', `${APP_NAME}/credential`], GitCredentialsAPI);

app.use(['/credential', `${APP_NAME}/credential`], DockerCredentialsAPI);

app.use(['/securityLog', `${APP_NAME}/securityLog`], ApplicationSecurityLogAPI);

app.use(['/securityLog', `${APP_NAME}/securityLog`], ContainerSecurityLogAPI);

app.use(['/error-tracker', `${APP_NAME}/error-tracker`], ErrorTrackerAPI);

app.use(
    ['/incidentSla', `${APP_NAME}/incidentSla`],
    IncidentCommunicationSlaAPI
);

app.use(['/monitorSla', `${APP_NAME}/monitorSla`], MonitorSlaAPI);

app.use(
    ['/incoming-request', `${APP_NAME}/incoming-request`],
    IncomingHTTPRequestAPI
);

app.use(['/ScriptRunner', `${APP_NAME}/ScriptRunner`], ScriptRunnerAPI);

app.use(['/customField', `${APP_NAME}/customField`], CustomFieldAPI);

app.use(['/search', `${APP_NAME}/search`], SearchAPI);

app.use(
    ['/monitorCustomField', `${APP_NAME}/monitorCustomField`],
    MonitorCustomFieldAPI
);

app.use(['/callRouting', `${APP_NAME}/callRouting`], CallRoutingAPI);

app.use(['/group', `${APP_NAME}/group`], GroupsAPI);

app.use(['/ssl', `${APP_NAME}/ssl`], SslAPI);

app.use(['/account', `${APP_NAME}/account`], AccountStoreAPI);

app.use(['/certificate', `${APP_NAME}/certificate`], CertificateStoreAPI);

app.use(['/manager', `${APP_NAME}/manager`], SiteManagerAPI);

app.use(['/manager', `${APP_NAME}/manager`], DefaultManagerAPI);

app.use(
    ['/performanceTracker', `${APP_NAME}/performanceTracker`],
    PerformanceTrackerAPI
);

app.use(
    ['/performanceMetric', `${APP_NAME}/performanceMetric`],
    PerformanceTrackerMetricAPI
);

app.use(
    ['/incidentNoteTemplate', `${APP_NAME}/incidentNoteTemplate`],
    IncidentNoteTemplateAPI
);

app.use('/*', (_req: ExpressRequest, res: ExpressResponse) => {
    res.status(404).send({ error: 'not-found' });
});

mongoose.connection.on('connected', async () => {
    if (!process.env['IS_TESTING']) {
        const greenlock: $TSFixMe = Gl.create({
            manager: 'oneuptime-gl-manager',
            packageRoot: process.cwd(),
            maintainerEmail: 'certs@oneuptime.com',
            staging: false,

            notify: function (event, details): void {
                if ('error' === event) {
                    // `details` is an error object in this case

                    logger.error('Greenlock Notify: ', details);
                }
            },
            challenges: {
                'http-01': {
                    module: 'oneuptime-acme-http-01',
                },
            },
            store: {
                module: 'oneuptime-le-store',
            },
        });
        await greenlock.manager.defaults({
            agreeToTerms: true,
            subscriberEmail: 'certs@oneuptime.com',
        });

        global.greenlock = greenlock;
    }
});

export default app;
