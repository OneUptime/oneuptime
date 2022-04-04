import {
    ExpressRequest,
    ExpressResponse,
    NextFunction,
    ExpressStatic,
} from 'common-server/utils/Express';
import logger from 'common-server/utils/logger';
import app from 'common-server/utils/StartServer';

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
import IncomingHTTPRequestAPI from './backend/api/incomingHttpRequest';
import AlertAPI from './backend/api/alert';
import UserAPI from './backend/api/user';
import LoginHistoryAPI from './backend/api/loginHistory';
import TokenAPI from './backend/api/token';
import TeamAPI from './backend/api/team';
import ProjectAPI from './backend/api/project';
import InvoiceAPI from './backend/api/invoice';
import ScheduleAPI from './backend/api/schedule';
import MonitorAPI from './backend/api/monitor';
import StatusPageAPI from './backend/api/statusPage';
import FileAPI from './backend/api/file';
import IncidentAPI from './backend/api/incident';
import IncidentPriorityAPI from './backend/api/incidentPriorities';
import IncidentSettingsAPI from './backend/api/incidentSettings';
import ReportAPI from './backend/api/report';
import LeadAPI from './backend/api/lead';
import TwilioAPI from './backend/api/twilio';
import SsoAPI from './backend/api/sso';
import FeedbackAPI from './backend/api/feedback';
import WebHookAPI from './backend/api/webhooks';
import ZapierAPI from './backend/api/zapier';
import SlackAPI from './backend/api/slack';
import ServerAPI from './backend/api/server';
import NotificationAPI from './backend/api/notification';
import SubscriberAPI from './backend/api/subscriber';
import SsoDefaultRoleAPI from './backend/api/ssoDefaultRoles';
import AutomatedScriptAPI from './backend/api/automatedScript';
import CallLogsAPI from './backend/api/callLogs';
import EmailLogsAPI from './backend/api/emailLogs';
import StripeAPI from './backend/api/stripe';
import EmailTemplateAPI from './backend/api/emailTemplate';
import SmsTemplateAPI from './backend/api/smsTemplate';
import SubscriberAlertAPI from './backend/api/subscriberAlert';
import ContainerSecurityAPI from './backend/api/containerSecurity';
import ApplciationSecurityAPI from './backend/api/applicationSecurity';
import GlobalConfigAPI from './backend/api/globalConfig';
import DockerCredentialsAPI from './backend/api/dockerCredential';
import GitCredentialsAPI from './backend/api/gitCredential';
import ProbeAPI from './backend/api/probe';
import ResourceCategoryAPI from './backend/api/resourceCategory';
import StatusPageCategoryAPI from './backend/api/statusPageCategory';
import TutorialAPI from './backend/api/tutorial';
import ApplicationScannerAPI from './backend/api/applicationScanner';
import ContainerScannerAPI from './backend/api/containerScanner';
import AuditLogAPI from './backend/api/auditLogs';
import SMSLogAPI from './backend/api/smsLogs';
import ScheduledEventAPI from './backend/api/scheduledEvent';
import LighthouseAPI from './backend/api/lighthouse';
import IncomingRequestAPI from './backend/api/incomingHttpRequest';
import ScriptRunnerAPI from './backend/api/scriptRunner';
import CustomFieldAPI from './backend/api/customField';
import ComponentAPI from './backend/api/component';
import SearchAPI from './backend/api/search';
import ApplicationLogAPI from './backend/api/applicationLog';
import PerformanceTrackerAPI from './backend/api/performanceTracker';
import PerformanceTrackerMetricAPI from './backend/api/performanceTrackerMetric';
import ErrorTrackerAPI from './backend/api/errorTracker';
import EmailSmtpAPI from './backend/api/emailSmtp';
import SmsSmtpAPI from './backend/api/smsSmtp';
import DomainVerificationTokenAPI from './backend/api/domainVerificationToken';
import MonitorSlaAPI from './backend/api/monitorSla';
import IncidentCommunicationSlaAPI from './backend/api/incidentCommunicationSla';
import MonitorCriteriaAPI from './backend/api//monitorCriteria';
import ApplicationSecurityLogAPI from './backend/api/applicationSecurityLog';
import ContainerSecurityLogAPI from './backend/api/containerSecurityLog';
import SiteManagerAPI from './backend/api/siteManager';
import DefaultManagerAPI from './backend/api/defaultManager';
import IncidentNoteTemplateAPI from './backend/api/incidentNoteTemplate';
import CertificateStoreAPI from './backend/api/certificateStore';
import AccountStoreAPI from './backend/api/accountStore';
import SslAPI from './backend/api/ssl';
import GroupsAPI from './backend/api/groups';
import CallRoutingAPI from './backend/api/callRouting';
import MonitorCustomFieldAPI from './backend/api/monitorCustomField';

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
