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

// On Call Duty
import OnCallDuty from './OnCallDuty';

// Monitors
import Monitor from './Monitor';
import MonitorStatus from './MonitorStatus';
import IncidentState from './IncidentState';

// Project SMTP Config.
import ProjectSmtpConfig from './ProjectSmtpConfig';

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
    IncidentState
];
