import { lazy } from 'react';

const Users: $TSFixMe = lazy((): $TSFixMe => {
    return import('./Users');
});
const User: $TSFixMe = lazy((): $TSFixMe => {
    return import('./User');
});
const Projects: $TSFixMe = lazy((): $TSFixMe => {
    return import('./Projects');
});
const Project: $TSFixMe = lazy((): $TSFixMe => {
    return import('./Project');
});
const Probes: $TSFixMe = lazy((): $TSFixMe => {
    return import('./Probes');
});
const AuditLogs: $TSFixMe = lazy((): $TSFixMe => {
    return import('./AuditLogs');
});
const EmailLogs: $TSFixMe = lazy((): $TSFixMe => {
    return import('./EmailLogs');
});
const CallLogs: $TSFixMe = lazy((): $TSFixMe => {
    return import('./CallLogs');
});
const SmsLogs: $TSFixMe = lazy((): $TSFixMe => {
    return import('./SmsLogs');
});
const Settings: $TSFixMe = lazy((): $TSFixMe => {
    return import('./Settings');
});
const License: $TSFixMe = lazy((): $TSFixMe => {
    return import('./License');
});

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
