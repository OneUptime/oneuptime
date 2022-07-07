import {
    ExpressRequest,
    ExpressResponse,
    NextFunction,
    ExpressStatic,
    ExpressApplication,
} from 'CommonServer/Utils/Express';
import logger from 'CommonServer/Utils/Logger';
import App from 'CommonServer/Utils/StartServer';

export const APP_NAME: string = 'api';
const app: ExpressApplication = App(APP_NAME);

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
import IncomingHTTPRequestAPI from './apia/incomingHttpRequest';
import AlertAPI from './apia/alert';
import UserAPI from './apia/user';
import LoginHistoryAPI from './apia/loginHistory';
import TokenAPI from './apia/token';
import TeamAPI from './apia/team';
import ProjectAPI from './apia/project';
import InvoiceAPI from './apia/invoice';
import ScheduleAPI from './apia/schedule';
import MonitorAPI from './apia/monitor';
import StatusPageAPI from './apia/statusPage';
import FileAPI from './apia/file';
import IncidentAPI from './apia/incident';
import IncidentPriorityAPI from './apia/incidentPriorities';
import IncidentSettingsAPI from './apia/incidentSettings';
import ReportAPI from './apia/report';
import LeadAPI from './apia/lead';
import TwilioAPI from './apia/twilio';
import SsoAPI from './apia/sso';
import FeedbackAPI from './apia/feedback';
import WebHookAPI from './apia/webhooks';
import ZapierAPI from './apia/zapier';
import SlackAPI from './apia/slack';
import ServerAPI from './apia/server';
import NotificationAPI from './apia/notification';
import SubscriberAPI from './apia/subscriber';
import SsoDefaultRoleAPI from './apia/ssoDefaultRoles';
import AutomatedScriptAPI from './apia/automatedScript';
import CallLogsAPI from './apia/callLogs';
import EmailLogsAPI from './apia/emailLogs';
import StripeAPI from './apia/stripe';
import EmailTemplateAPI from './apia/emailTemplate';
import SmsTemplateAPI from './apia/smsTemplate';
import SubscriberAlertAPI from './apia/subscriberAlert';
import ContainerSecurityAPI from './apia/containerSecurity';
import ApplciationSecurityAPI from './apia/applicationSecurity';
import GlobalConfigAPI from './apia/globalConfig';
import DockerCredentialsAPI from './apia/dockerCredential';
import GitCredentialsAPI from './apia/gitCredential';
import ProbeAPI from './apia/probe';
import ResourceCategoryAPI from './apia/resourceCategory';
import StatusPageCategoryAPI from './apia/statusPageCategory';
import TutorialAPI from './apia/tutorial';
import ApplicationScannerAPI from './apia/applicationScanner';
import ContainerScannerAPI from './apia/containerScanner';
import AuditLogAPI from './apia/auditLogs';
import SMSLogAPI from './apia/smsLogs';
import ScheduledEventAPI from './apia/scheduledEvent';
import LighthouseAPI from './apia/lighthouse';
import ScriptRunnerAPI from './apia/scriptRunner';
import CustomFieldAPI from './apia/customField';
import ComponentAPI from './apia/component';
import SearchAPI from './apia/search';
import ApplicationLogAPI from './apia/applicationLog';
import PerformanceTrackerAPI from './apia/performanceTracker';
import PerformanceTrackerMetricAPI from './apia/performanceTrackerMetric';
import ErrorTrackerAPI from './apia/errorTracker';
import EmailSmtpAPI from './apia/emailSmtp';
import SmsSmtpAPI from './apia/smsSmtp';
import DomainVerificationTokenAPI from './apia/domainVerificationToken';
import MonitorSlaAPI from './apia/monitorSla';
import IncidentCommunicationSlaAPI from './apia/incidentCommunicationSla';
import MonitorCriteriaAPI from './apia/monitorCriteria';
import ApplicationSecurityLogAPI from './apia/applicationSecurityLog';
import ContainerSecurityLogAPI from './apia/containerSecurityLog';
import SiteManagerAPI from './apia/siteManager';
import DefaultManagerAPI from './apia/defaultManager';
import IncidentNoteTemplateAPI from './apia/incidentNoteTemplate';
import CertificateStoreAPI from './apia/certificateStore';
import AccountStoreAPI from './apia/accountStore';
import SslAPI from './apia/ssl';
import GroupsAPI from './apia/groups';
import CallRoutingAPI from './apia/callRouting';
import MonitorCustomFieldAPI from './apia/monitorCustomField';

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
