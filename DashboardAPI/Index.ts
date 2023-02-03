import 'ejs';
import Redis from 'CommonServer/Infrastructure/Redis';
import type { ExpressApplication } from 'CommonServer/Utils/Express';
import Express from 'CommonServer/Utils/Express';
import logger from 'CommonServer/Utils/Logger';
import BaseAPI from 'CommonServer/API/BaseAPI';
import App from 'CommonServer/Utils/StartServer';
import { PostgresAppInstance } from 'CommonServer/Infrastructure/PostgresDatabase';

import User from 'Model/Models/User';
import type { Service as UserServiceType } from 'CommonServer/Services/UserService';
import UserService from 'CommonServer/Services/UserService';

import BillingPaymentMethodAPI from 'CommonServer/API/BillingPaymentMethodAPI';

import BillingInvoiceAPI from 'CommonServer/API/BillingInvoiceAPI';

import Project from 'Model/Models/Project';
import type { Service as ProjectServiceType } from 'CommonServer/Services/ProjectService';
import ProjectService from 'CommonServer/Services/ProjectService';

import Probe from 'Model/Models/Probe';
import type { Service as ProbeServiceType } from 'CommonServer/Services/ProbeService';
import ProbeService from 'CommonServer/Services/ProbeService';

import StatusPagePrivateUser from 'Model/Models/StatusPagePrivateUser';
import type { Service as StatusPagePrivateUserServiceType } from 'CommonServer/Services/StatusPagePrivateUserService';
import StatusPagePrivateUserService from 'CommonServer/Services/StatusPagePrivateUserService';

import StatusPageFooterLink from 'Model/Models/StatusPageFooterLink';
import type { Service as StatusPageFooterLinkServiceType } from 'CommonServer/Services/StatusPageFooterLinkService';
import StatusPageFooterLinkService from 'CommonServer/Services/StatusPageFooterLinkService';

import StatusPageHeaderLink from 'Model/Models/StatusPageHeaderLink';
import type { Service as StatusPageHeaderLinkServiceType } from 'CommonServer/Services/StatusPageHeaderLinkService';
import StatusPageHeaderLinkService from 'CommonServer/Services/StatusPageHeaderLinkService';

import StatusPageAnnouncement from 'Model/Models/StatusPageAnnouncement';
import type { Service as StatusPageAnnouncementServiceType } from 'CommonServer/Services/StatusPageAnnouncementService';
import StatusPageAnnouncementService from 'CommonServer/Services/StatusPageAnnouncementService';

import EmailVerificationToken from 'Model/Models/EmailVerificationToken';
import type { Service as EmailVerificationTokenServiceType } from 'CommonServer/Services/EmailVerificationTokenService';
import EmailVerificationTokenService from 'CommonServer/Services/EmailVerificationTokenService';

import Team from 'Model/Models/Team';
import type { Service as TeamServiceType } from 'CommonServer/Services/TeamService';
import TeamService from 'CommonServer/Services/TeamService';

import TeamMember from 'Model/Models/TeamMember';
import type { Service as TeamMemberServiceType } from 'CommonServer/Services/TeamMemberService';
import TeamMemberService from 'CommonServer/Services/TeamMemberService';

import TeamPermission from 'Model/Models/TeamPermission';
import type { Service as TeamPermissionServiceType } from 'CommonServer/Services/TeamPermissionService';
import TeamPermissionService from 'CommonServer/Services/TeamPermissionService';

import Label from 'Model/Models/Label';
import type { Service as LabelServiceType } from 'CommonServer/Services/LabelService';
import LabelService from 'CommonServer/Services/LabelService';

import ProjectSmtpConfig from 'Model/Models/ProjectSmtpConfig';
import type { Service as ProjectSMTPConfigServiceType } from 'CommonServer/Services/ProjectSmtpConfigService';
import ProjectSmtpConfigService from 'CommonServer/Services/ProjectSmtpConfigService';

import ApiKey from 'Model/Models/ApiKey';
import type { Service as ApiKeyServiceType } from 'CommonServer/Services/ApiKeyService';
import ApiKeyService from 'CommonServer/Services/ApiKeyService';

import ApiKeyPermission from 'Model/Models/ApiKeyPermission';
import type { Service as ApiKeyPermissionServiceType } from 'CommonServer/Services/ApiKeyPermissionService';
import ApiKeyPermissionService from 'CommonServer/Services/ApiKeyPermissionService';

import Monitor from 'Model/Models/Monitor';
import type { Service as MonitorServiceType } from 'CommonServer/Services/MonitorService';
import MonitorService from 'CommonServer/Services/MonitorService';

import OnCallDuty from 'Model/Models/OnCallDuty';
import type { Service as OnCallDutyServiceType } from 'CommonServer/Services/OnCallDutyService';
import OnCallDutyService from 'CommonServer/Services/OnCallDutyService';

import MonitorStatus from 'Model/Models/MonitorStatus';
import type { Service as MonitorStatusServiceType } from 'CommonServer/Services/MonitorStatusService';
import MonitorStatusService from 'CommonServer/Services/MonitorStatusService';

import MonitorTimelineStatus from 'Model/Models/MonitorStatusTimeline';
import type { Service as MonitorTimelineStatusServiceType } from 'CommonServer/Services/MonitorStatusTimelineService';
import MonitorTimelineStatusService from 'CommonServer/Services/MonitorStatusTimelineService';

import ScheduledMaintenanceState from 'Model/Models/ScheduledMaintenanceState';
import type { Service as ScheduledMaintenanceStateServiceType } from 'CommonServer/Services/ScheduledMaintenanceStateService';
import ScheduledMaintenanceStateService from 'CommonServer/Services/ScheduledMaintenanceStateService';

import ScheduledMaintenance from 'Model/Models/ScheduledMaintenance';
import type { Service as ScheduledMaintenanceServiceType } from 'CommonServer/Services/ScheduledMaintenanceService';
import ScheduledMaintenanceService from 'CommonServer/Services/ScheduledMaintenanceService';

import ScheduledMaintenanceStateTimeline from 'Model/Models/ScheduledMaintenanceStateTimeline';
import type { Service as ScheduledMaintenanceStateTimelineServiceType } from 'CommonServer/Services/ScheduledMaintenanceStateTimelineService';
import ScheduledMaintenanceStateTimelineService from 'CommonServer/Services/ScheduledMaintenanceStateTimelineService';

import ScheduledMaintenanceInternalNote from 'Model/Models/ScheduledMaintenanceInternalNote';
import type { Service as ScheduledMaintenanceInternalNoteServiceType } from 'CommonServer/Services/ScheduledMaintenanceInternalNoteService';
import ScheduledMaintenanceInternalNoteService from 'CommonServer/Services/ScheduledMaintenanceInternalNoteService';

import ScheduledMaintenancePublicNote from 'Model/Models/ScheduledMaintenancePublicNote';
import type { Service as ScheduledMaintenancePublicNoteServiceType } from 'CommonServer/Services/ScheduledMaintenancePublicNoteService';
import ScheduledMaintenancePublicNoteService from 'CommonServer/Services/ScheduledMaintenancePublicNoteService';

import IncidentState from 'Model/Models/IncidentState';
import type { Service as IncidentStateServiceType } from 'CommonServer/Services/IncidentStateService';
import IncidentStateService from 'CommonServer/Services/IncidentStateService';

import Incident from 'Model/Models/Incident';
import type { Service as IncidentServiceType } from 'CommonServer/Services/IncidentService';
import IncidentService from 'CommonServer/Services/IncidentService';

import IncidentStateTimeline from 'Model/Models/IncidentStateTimeline';
import type { Service as IncidentStateTimelineServiceType } from 'CommonServer/Services/IncidentStateTimelineService';
import IncidentStateTimelineService from 'CommonServer/Services/IncidentStateTimelineService';

import IncidentInternalNote from 'Model/Models/IncidentInternalNote';
import type { Service as IncidentInternalNoteServiceType } from 'CommonServer/Services/IncidentInternalNoteService';
import IncidentInternalNoteService from 'CommonServer/Services/IncidentInternalNoteService';

import IncidentPublicNote from 'Model/Models/IncidentPublicNote';
import type { Service as IncidentPublicNoteServiceType } from 'CommonServer/Services/IncidentPublicNoteService';
import IncidentPublicNoteService from 'CommonServer/Services/IncidentPublicNoteService';

import Domain from 'Model/Models/Domain';
import type { Service as DomainServiceType } from 'CommonServer/Services/DomainService';
import DomainService from 'CommonServer/Services/DomainService';

import StatusPageGroup from 'Model/Models/StatusPageGroup';
import type { Service as StatusPageGroupServiceType } from 'CommonServer/Services/StatusPageGroupService';
import StatusPageGroupService from 'CommonServer/Services/StatusPageGroupService';

import StatusPageResource from 'Model/Models/StatusPageResource';
import type { Service as StatusPageResourceServiceType } from 'CommonServer/Services/StatusPageResourceService';
import StatusPageResourceService from 'CommonServer/Services/StatusPageResourceService';

import IncidentSeverity from 'Model/Models/IncidentSeverity';
import type { Service as IncidentSeverityServiceType } from 'CommonServer/Services/IncidentSeverityService';
import IncidentSeverityService from 'CommonServer/Services/IncidentSeverityService';

import StatusPageDomain from 'Model/Models/StatusPageDomain';
import type { Service as StatusPageDomainServiceType } from 'CommonServer/Services/StatusPageDomainService';
import StatusPageDomainService from 'CommonServer/Services/StatusPageDomainService';

// Import API

import StatusPageAPI from 'CommonServer/API/StatusPageAPI';

import StatusPageSubscriberAPI from 'CommonServer/API/StatusPageSubscriberAPI';

const app: ExpressApplication = Express.getExpressApp();

const APP_NAME: string = 'api';

//attach api's
app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<User, UserServiceType>(User, UserService).getRouter()
);
app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<Project, ProjectServiceType>(
        Project,
        ProjectService
    ).getRouter()
);
app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<Probe, ProbeServiceType>(Probe, ProbeService).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<StatusPageAnnouncement, StatusPageAnnouncementServiceType>(
        StatusPageAnnouncement,
        StatusPageAnnouncementService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<Team, TeamServiceType>(Team, TeamService).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<TeamMember, TeamMemberServiceType>(
        TeamMember,
        TeamMemberService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<TeamPermission, TeamPermissionServiceType>(
        TeamPermission,
        TeamPermissionService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<MonitorStatus, MonitorStatusServiceType>(
        MonitorStatus,
        MonitorStatusService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<IncidentState, IncidentStateServiceType>(
        IncidentState,
        IncidentStateService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<
        ScheduledMaintenanceState,
        ScheduledMaintenanceStateServiceType
    >(ScheduledMaintenanceState, ScheduledMaintenanceStateService).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<StatusPageResource, StatusPageResourceServiceType>(
        StatusPageResource,
        StatusPageResourceService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<Domain, DomainServiceType>(Domain, DomainService).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<StatusPageGroup, StatusPageGroupServiceType>(
        StatusPageGroup,
        StatusPageGroupService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<StatusPageDomain, StatusPageDomainServiceType>(
        StatusPageDomain,
        StatusPageDomainService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<IncidentStateTimeline, IncidentStateTimelineServiceType>(
        IncidentStateTimeline,
        IncidentStateTimelineService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<
        ScheduledMaintenanceStateTimeline,
        ScheduledMaintenanceStateTimelineServiceType
    >(
        ScheduledMaintenanceStateTimeline,
        ScheduledMaintenanceStateTimelineService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<StatusPagePrivateUser, StatusPagePrivateUserServiceType>(
        StatusPagePrivateUser,
        StatusPagePrivateUserService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<Incident, IncidentServiceType>(
        Incident,
        IncidentService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<ScheduledMaintenance, ScheduledMaintenanceServiceType>(
        ScheduledMaintenance,
        ScheduledMaintenanceService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<ApiKey, ApiKeyServiceType>(ApiKey, ApiKeyService).getRouter()
);
app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<ApiKeyPermission, ApiKeyPermissionServiceType>(
        ApiKeyPermission,
        ApiKeyPermissionService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<StatusPageHeaderLink, StatusPageHeaderLinkServiceType>(
        StatusPageHeaderLink,
        StatusPageHeaderLinkService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<StatusPageFooterLink, StatusPageFooterLinkServiceType>(
        StatusPageFooterLink,
        StatusPageFooterLinkService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<ApiKey, ApiKeyServiceType>(ApiKey, ApiKeyService).getRouter()
);
app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<ApiKeyPermission, ApiKeyPermissionServiceType>(
        ApiKeyPermission,
        ApiKeyPermissionService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<IncidentSeverity, IncidentSeverityServiceType>(
        IncidentSeverity,
        IncidentSeverityService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<Label, LabelServiceType>(Label, LabelService).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<EmailVerificationToken, EmailVerificationTokenServiceType>(
        EmailVerificationToken,
        EmailVerificationTokenService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<ProjectSmtpConfig, ProjectSMTPConfigServiceType>(
        ProjectSmtpConfig,
        ProjectSmtpConfigService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<Monitor, MonitorServiceType>(
        Monitor,
        MonitorService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<MonitorTimelineStatus, MonitorTimelineStatusServiceType>(
        MonitorTimelineStatus,
        MonitorTimelineStatusService
    ).getRouter()
);

app.use(`/${APP_NAME.toLocaleLowerCase()}`, new StatusPageAPI().getRouter());
app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new StatusPageSubscriberAPI().getRouter()
);
app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BillingPaymentMethodAPI().getRouter()
);
app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BillingInvoiceAPI().getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<
        ScheduledMaintenancePublicNote,
        ScheduledMaintenancePublicNoteServiceType
    >(
        ScheduledMaintenancePublicNote,
        ScheduledMaintenancePublicNoteService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<
        ScheduledMaintenanceInternalNote,
        ScheduledMaintenanceInternalNoteServiceType
    >(
        ScheduledMaintenanceInternalNote,
        ScheduledMaintenanceInternalNoteService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<IncidentPublicNote, IncidentPublicNoteServiceType>(
        IncidentPublicNote,
        IncidentPublicNoteService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<IncidentInternalNote, IncidentInternalNoteServiceType>(
        IncidentInternalNote,
        IncidentInternalNoteService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<OnCallDuty, OnCallDutyServiceType>(
        OnCallDuty,
        OnCallDutyService
    ).getRouter()
);

const init: Function = async (): Promise<void> => {
    try {
        // init the app
        await App(APP_NAME);
        // connect to the database.
        await PostgresAppInstance.connect(
            PostgresAppInstance.getDatasourceOptions()
        );

        // connect redis
        await Redis.connect();
    } catch (err) {
        logger.error('App Init Failed:');
        logger.error(err);
    }
};

init();
