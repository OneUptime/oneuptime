import {
    ExpressRequest,
    ExpressResponse,
    NextFunction,
    ExpressStatic,
} from 'CommonServer/Utils/Express';
import logger from 'CommonServer/Utils/Logger';
import app from 'CommonServer/Utils/StartServer';

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
import IncomingRequestAPI from './api/incomingHttpRequest';
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

app.use(async function (
    req: ExpressRequest,
    _res: ExpressResponse,
    next: NextFunction
) {
    req = (await getUser(req)) || req;
    req = (await getProjectId(req)) || req;
    next();
});

//View engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// enable trust proxy

app.set('trust proxy', true);

app.use(ExpressStatic(path.join(__dirname, 'views')));

app.use('/api', ExpressStatic(path.join(__dirname, 'views')));

app.use(AuditLogsMiddleware.log);

// Routes(API)

app.use(
    ['/incomingHttpRequest', '/api/incomingHttpRequest'],
    IncomingHTTPRequestAPI
);

app.use(['/alert', '/api/alert'], AlertAPI);

app.use(['/user', '/api/user'], UserAPI);

app.use(['/history', '/api/history'], LoginHistoryAPI);

app.use(['/token', '/api/token'], TokenAPI);

app.use(['/team', '/api/team'], TeamAPI);

app.use(['/project', '/api/project'], ProjectAPI);

app.use(['/invoice', '/api/invoice'], InvoiceAPI);

app.use(['/schedule', '/api/schedule'], ScheduleAPI);

app.use(['/monitor', '/api/monitor'], MonitorAPI);

app.use(['/status-page', '/api/status-page'], StatusPageAPI);

app.use(['/file', '/api/file'], FileAPI);

app.use(['/incident', '/api/incident'], IncidentAPI);

app.use(
    ['/incidentPriorities', '/api/incidentPriorities'],
    IncidentPriorityAPI
);

app.use(['/incidentSettings', '/api/incidentSettings'], IncidentSettingsAPI);

app.use(['/reports', '/api/reports'], ReportAPI);

app.use(['/lead', '/api/lead'], LeadAPI);

app.use(['/feedback', '/api/feedback'], FeedbackAPI);

app.use(['/twilio', '/api/twilio'], TwilioAPI);

app.use(['/sso', '/api/sso'], SsoAPI);

app.use(['/ssoDefaultRoles', '/api/ssoDefaultRoles'], SsoDefaultRoleAPI);

app.use(['/zapier', '/api/zapier'], ZapierAPI);

app.use(['/slack', '/api/slack'], SlackAPI);

app.use(['/webhook', '/api/webhook'], WebHookAPI);

app.use(['/server', '/api/server'], ServerAPI);

app.use(['/notification', '/api/notification'], NotificationAPI);

app.use(['/stripe', '/api/stripe'], StripeAPI);

app.use(['/subscriber', '/api/subscriber'], SubscriberAPI);

app.use(['/subscriberAlert', '/api/subscriberAlert'], SubscriberAlertAPI);

app.use(['/emailTemplate', '/api/emailTemplate'], EmailTemplateAPI);

app.use(['/emailSmtp', '/api/emailSmtp'], EmailSmtpAPI);

app.use(['/smsTemplate', '/api/smsTemplate'], SmsTemplateAPI);

app.use(['/smsSmtp', '/api/smsSmtp'], SmsSmtpAPI);

app.use(['/resourceCategory', '/api/resourceCategory'], ResourceCategoryAPI);

app.use(
    ['/statusPageCategory', '/api/statusPageCategory'],
    StatusPageCategoryAPI
);

app.use(['/monitorCriteria', '/api/monitorCriteria'], MonitorCriteriaAPI);

app.use(['/scheduledEvent', '/api/scheduledEvent'], ScheduledEventAPI);

app.use(['/probe', '/api/probe'], ProbeAPI);

app.use(['/application', '/api/application'], ApplicationScannerAPI);

app.use(['/container', '/api/container'], ContainerScannerAPI);

app.use(['/lighthouse', '/api/lighthouse'], LighthouseAPI);

app.use(['/tutorial', '/api/tutorial'], TutorialAPI);

app.use(['/audit-logs', '/api/audit-logs'], AuditLogAPI);

app.use(['/email-logs', '/api/email-logs'], EmailLogsAPI);

app.use(['/call-logs', '/api/call-logs'], CallLogsAPI);

app.use(['/automated-scripts', '/api/automated-scripts'], AutomatedScriptAPI);

app.use(['/sms-logs', '/api/sms-logs'], SMSLogAPI);

app.use(['/component', '/api/component'], ComponentAPI);

app.use(['/application-log', '/api/application-log'], ApplicationLogAPI);

app.use(['/globalConfig', '/api/globalConfig'], GlobalConfigAPI);

app.use(
    ['/domainVerificationToken', '/api/domainVerificationToken'],
    DomainVerificationTokenAPI
);

app.use(['/security', '/api/security'], ContainerSecurityAPI);

app.use(['/security', '/api/security'], ApplciationSecurityAPI);

app.use(['/credential', '/api/credential'], GitCredentialsAPI);

app.use(['/credential', '/api/credential'], DockerCredentialsAPI);

app.use(['/securityLog', '/api/securityLog'], ApplicationSecurityLogAPI);

app.use(['/securityLog', '/api/securityLog'], ContainerSecurityLogAPI);

app.use(['/error-tracker', '/api/error-tracker'], ErrorTrackerAPI);

app.use(['/incidentSla', '/api/incidentSla'], IncidentCommunicationSlaAPI);

app.use(['/monitorSla', '/api/monitorSla'], MonitorSlaAPI);

app.use(['/incoming-request', '/api/incoming-request'], IncomingRequestAPI);

app.use(['/script-runner', '/api/script-runner'], ScriptRunnerAPI);

app.use(['/customField', '/api/customField'], CustomFieldAPI);

app.use(['/search', '/api/search'], SearchAPI);

app.use(
    ['/monitorCustomField', '/api/monitorCustomField'],
    MonitorCustomFieldAPI
);

app.use(['/callRouting', '/api/callRouting'], CallRoutingAPI);

app.use(['/group', '/api/group'], GroupsAPI);

app.use(['/ssl', '/api/ssl'], SslAPI);

app.use(['/account', '/api/account'], AccountStoreAPI);

app.use(['/certificate', '/api/certificate'], CertificateStoreAPI);

app.use(['/manager', '/api/manager'], SiteManagerAPI);

app.use(['/manager', '/api/manager'], DefaultManagerAPI);

app.use(
    ['/performanceTracker', '/api/performanceTracker'],
    PerformanceTrackerAPI
);

app.use(
    ['/performanceMetric', '/api/performanceMetric'],
    PerformanceTrackerMetricAPI
);

app.use(
    ['/incidentNoteTemplate', '/api/incidentNoteTemplate'],
    IncidentNoteTemplateAPI
);

app.use('/*', (_req: ExpressRequest, res: ExpressResponse) => {
    res.status(404).send({ error: 'not-found' });
});

mongoose.connection.on('connected', async () => {
    if (!process.env.IS_TESTING) {
        const greenlock = Gl.create({
            manager: 'oneuptime-gl-manager',
            packageRoot: process.cwd(),
            maintainerEmail: 'certs@oneuptime.com',
            staging: false,

            notify: function (event, details) {
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
