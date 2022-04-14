import { lazy } from 'react';

const Users: $TSFixMe = lazy((): $TSFixMe => import('./Users'));
const User: $TSFixMe = lazy((): $TSFixMe => import('./User'));
const Projects: $TSFixMe = lazy((): $TSFixMe => import('./Projects'));
const Project: $TSFixMe = lazy((): $TSFixMe => import('./Project'));
const Probes: $TSFixMe = lazy((): $TSFixMe => import('./Probes'));
const AuditLogs: $TSFixMe = lazy((): $TSFixMe => import('./AuditLogs'));
const EmailLogs: $TSFixMe = lazy((): $TSFixMe => import('./EmailLogs'));
const CallLogs: $TSFixMe = lazy((): $TSFixMe => import('./CallLogs'));
const SmsLogs: $TSFixMe = lazy((): $TSFixMe => import('./SmsLogs'));
const Settings: $TSFixMe = lazy((): $TSFixMe => import('./Settings'));
const License: $TSFixMe = lazy((): $TSFixMe => import('./License'));

export default {
    Users,
    User,
    Projects,
    Project,
    Probes,
    AuditLogs,
    EmailLogs,
    SmsLogs,
    CallLogs,
    Settings,
    License,
};
