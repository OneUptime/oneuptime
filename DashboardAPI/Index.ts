import 'ejs';
import { PostgresAppInstance } from 'CommonServer/Infrastructure/PostgresDatabase';
import Redis from 'CommonServer/Infrastructure/Redis';
import Express, { ExpressApplication } from 'CommonServer/Utils/Express';
import logger from 'CommonServer/Utils/Logger';
import BaseAPI from 'CommonServer/API/BaseAPI';
import App from 'CommonServer/Utils/StartServer';

import User from 'Model/Models/User';
import UserService, {
    Service as UserServiceType,
} from 'CommonServer/Services/UserService';

import Project from 'Model/Models/Project';
import ProjectService, {
    Service as ProjectServiceType,
} from 'CommonServer/Services/ProjectService';

import Probe from 'Model/Models/Probe';
import ProbeService, {
    Service as ProbeServiceType,
} from 'CommonServer/Services/ProbeService';

import EmailVerificationToken from 'Model/Models/EmailVerificationToken';
import EmailVerificationTokenService, {
    Service as EmailVerificationTokenServiceType,
} from 'CommonServer/Services/EmailVerificationTokenService';

import Team from 'Model/Models/Team';
import TeamService, {
    Service as TeamServiceType,
} from 'CommonServer/Services/TeamService';

import TeamMember from 'Model/Models/TeamMember';
import TeamMemberService, {
    Service as TeamMemberServiceType,
} from 'CommonServer/Services/TeamMemberService';

import TeamPermission from 'Model/Models/TeamPermission';
import TeamPermissionService, {
    Service as TeamPermissionServiceType,
} from 'CommonServer/Services/TeamPermissionService';

import Label from 'Model/Models/Label';
import LabelService, {
    Service as LabelServiceType,
} from 'CommonServer/Services/LabelService';

import ProjectSmtpConfig from 'Model/Models/ProjectSmtpConfig';
import ProjectSmtpConfigService, {
    Service as ProjectSMTPConfigServiceType,
} from 'CommonServer/Services/ProjectSmtpConfigService';

import ApiKey from 'Model/Models/ApiKey';
import ApiKeyService, {
    Service as ApiKeyServiceType,
} from 'CommonServer/Services/ApiKeyService';

import ApiKeyPermission from 'Model/Models/ApiKeyPermission';
import ApiKeyPermissionService, {
    Service as ApiKeyPermissionServiceType,
} from 'CommonServer/Services/ApiKeyPermissionService';

import Monitor from 'Model/Models/Monitor';
import MonitorService, {
    Service as MonitorServiceType,
} from 'CommonServer/Services/MonitorService';

import StatusPage from 'Model/Models/StatusPage';
import StatusPageService, {
    Service as StatusPageServiceType,
} from 'CommonServer/Services/StatusPageService';

import OnCallDuty from 'Model/Models/OnCallDuty';
import OnCallDutyService, {
    Service as OnCallDutyServiceType,
} from 'CommonServer/Services/OnCallDutyService';

import MonitorStatus from 'Model/Models/MonitorStatus';
import MonitorStatusService, {
    Service as MonitorStatusServiceType,
} from 'CommonServer/Services/MonitorStatusService';

import IncidentState from 'Model/Models/IncidentState';
import IncidentStateStatusService, {
    Service as IncidentStateStatusServiceType,
} from 'CommonServer/Services/IncidentStateService';

const app: ExpressApplication = Express.getExpressApp();

const APP_NAME: string = 'api';

//attach api's
app.use(new BaseAPI<User, UserServiceType>(User, UserService).getRouter());
app.use(
    new BaseAPI<Project, ProjectServiceType>(
        Project,
        ProjectService
    ).getRouter()
);
app.use(new BaseAPI<Probe, ProbeServiceType>(Probe, ProbeService).getRouter());

app.use(new BaseAPI<Team, TeamServiceType>(Team, TeamService).getRouter());

app.use(
    new BaseAPI<TeamMember, TeamMemberServiceType>(
        TeamMember,
        TeamMemberService
    ).getRouter()
);

app.use(
    new BaseAPI<TeamPermission, TeamPermissionServiceType>(
        TeamPermission,
        TeamPermissionService
    ).getRouter()
);

app.use(
    new BaseAPI<MonitorStatus, MonitorStatusServiceType>(
        MonitorStatus,
        MonitorStatusService
    ).getRouter()
);

app.use(
    new BaseAPI<IncidentState, IncidentStateStatusServiceType>(
        IncidentState,
        IncidentStateStatusService
    ).getRouter()
);

app.use(
    new BaseAPI<ApiKey, ApiKeyServiceType>(ApiKey, ApiKeyService).getRouter()
);
app.use(
    new BaseAPI<ApiKeyPermission, ApiKeyPermissionServiceType>(
        ApiKeyPermission,
        ApiKeyPermissionService
    ).getRouter()
);

app.use(new BaseAPI<Label, LabelServiceType>(Label, LabelService).getRouter());

app.use(
    new BaseAPI<EmailVerificationToken, EmailVerificationTokenServiceType>(
        EmailVerificationToken,
        EmailVerificationTokenService
    ).getRouter()
);

app.use(
    new BaseAPI<ProjectSmtpConfig, ProjectSMTPConfigServiceType>(
        ProjectSmtpConfig,
        ProjectSmtpConfigService
    ).getRouter()
);

app.use(
    new BaseAPI<Monitor, MonitorServiceType>(
        Monitor,
        MonitorService
    ).getRouter()
);

app.use(
    new BaseAPI<StatusPage, StatusPageServiceType>(
        StatusPage,
        StatusPageService
    ).getRouter()
);

app.use(
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
