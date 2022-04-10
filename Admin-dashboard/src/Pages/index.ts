import { lazy } from 'react';

const Users = lazy(() => import('./Users'));
const User = lazy(() => import('./User'));
const Projects = lazy(() => import('./Projects'));
const Project = lazy(() => import('./Project'));
const Probes = lazy(() => import('./Probes'));
const AuditLogs = lazy(() => import('./AuditLogs'));
const EmailLogs = lazy(() => import('./EmailLogs'));
const CallLogs = lazy(() => import('./CallLogs'));
const SmsLogs = lazy(() => import('./SmsLogs'));
const Settings = lazy(() => import('./Settings'));
const License = lazy(() => import('./License'));

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
