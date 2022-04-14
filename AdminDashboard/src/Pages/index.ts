import { lazy } from 'react';

const Users = lazy((): $TSFixMe => import('./Users'));
const User = lazy((): $TSFixMe => import('./User'));
const Projects = lazy((): $TSFixMe => import('./Projects'));
const Project = lazy((): $TSFixMe => import('./Project'));
const Probes = lazy((): $TSFixMe => import('./Probes'));
const AuditLogs = lazy((): $TSFixMe => import('./AuditLogs'));
const EmailLogs = lazy((): $TSFixMe => import('./EmailLogs'));
const CallLogs = lazy((): $TSFixMe => import('./CallLogs'));
const SmsLogs = lazy((): $TSFixMe => import('./SmsLogs'));
const Settings = lazy((): $TSFixMe => import('./Settings'));
const License = lazy((): $TSFixMe => import('./License'));

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
