import User from './User';
import Probe from './Probe';
import Project from './Project';
import EmailVerificationToken from './EmailVerificationToken';

// Team
import Team from './Team';
import TeamMember from './TeamMember';
import TeamPermission from './TeamPermission';

// API Keys
import ApiKey from './ApiKey';
import ApiKeyPermission from './ApiKeyPermission';

//Labels.
import Label from './Label';

// Status Page
import StatusPage from './StatusPage';
import StatusPageGroup from './StatusPageGroup';
import StatusPageDomain from './StatusPageDomain';
import StatusPageResource from './StatusPageResource'

// On Call Duty
import OnCallDuty from './OnCallDuty';

// Monitors
import Monitor from './Monitor';
import MonitorStatus from './MonitorStatus';
import MonitorStatusTimeline from './MonitorStatusTimeline';

// Incidents
import Incident from './Incident';
import IncidentState from './IncidentState';
import IncidentStateTimeline from './IncidentStateTimeline';
import IncidentPublicNote from './IncidentPublicNote';
import IncidentInternalNote from './IncidentInternalNote';
import IncidentSeverity from './IncidentSeverity';

// Project SMTP Config.
import ProjectSmtpConfig from './ProjectSmtpConfig';

import Domain from './Domain';

import File from './File';

export default [
    User,
    Probe,
    Project,
    EmailVerificationToken,
    Team,
    TeamMember,
    TeamPermission,
    ApiKey,
    Label,
    ApiKeyPermission,
    ProjectSmtpConfig,
    StatusPage,
    OnCallDuty,
    Monitor,
    MonitorStatus,
    IncidentState,
    Incident,
    IncidentStateTimeline,
    MonitorStatusTimeline,
    IncidentPublicNote,
    IncidentInternalNote,
    File,
    Domain,
    StatusPageGroup,
    StatusPageDomain,
    StatusPageResource,
    IncidentSeverity
];
