import { combineReducers } from 'redux';
import component from './component';
import monitor from './monitor';
import Action from 'CommonUI/src/types/action';
import { routerReducer } from 'react-router-redux';
import { RootState } from '../store';

import { reducer as formReducer } from 'redux-form';
import alert from './alert';
import team from './team';
import modal from './modal';
import project from './project';
import schedule from './schedule';
import changePassword from './changePassword';
import statusPage from './statusPage';
import StatusPage from './StatusPage';
import incident from './incident';
import report from './report';
import invoice from './invoice';
import profileSettings from './profile';
import feedback from './feedback';
import notifications from './notifications';
import slack from './slack';
import webHooks from './webHook';
import subProject from './subProject';
import emailTemplates from './emailTemplates';
import smsTemplates from './smsTemplates';
import subscriber from './subscriber';
import scheduledEvent from './scheduledEvent';
import resourceCategories from './resourceCategories';
import card from './card';
import page from './page';
import probe from './probe';
import version from './version';
import tutorial from './tutorial';
import dateTime from './dateTime';
import applicationLog from './applicationLog';
import security from './security';
import credential from './credential';
import msTeams from './msteams';
import slackWebhooks from './slackWebhooks';
import incidentPriorities from './incidentPriorities';
import incidentBasicSettings from './incidentBasicSettings';
import errorTracker from './errorTracker';
import animateSidebar from './animateSidebar';
import incidentCommunicationSla from './incidentCommunicationSla';
import monitorSla from './monitorSla';
import incomingRequest from './incomingRequest';
import customField from './customField';
import monitorCustomField from './monitorCustomField';
import callRouting from './callRouting';
import groups from './groups';
import search from './search';
import performanceTracker from './performanceTracker';
import performanceTrackerMetric from './performanceTrackerMetric';
import automatedScripts from './automatedScript';
import incidentNoteTemplate from './incidentNoteTemplate';
import statusPageCategory from './statusPageCategory';
import sso from './sso';

const appReducer = combineReducers({
    routing: routerReducer,
    form: formReducer,
    team,
    alert,
    modal,
    project,
    changePassword,
    component,
    monitor,
    resourceCategories,
    schedule,
    statusPage,
    incident,
    invoice,
    search,
    profileSettings,
    feedback,
    groups,
    notifications,
    slack,
    slackWebhooks,
    webHooks,
    report,
    subProject,
    emailTemplates,
    smsTemplates,
    subscriber,
    scheduledEvent,
    card,
    page,
    probe,
    version,
    tutorial,
    dateTime,
    applicationLog,
    security,
    credential,
    msTeams,
    incidentPriorities,
    incidentBasicSettings,
    errorTracker,
    animateSidebar,
    incidentSla: incidentCommunicationSla,
    monitorSla,
    incomingRequest,
    customField,
    monitorCustomField,
    callRouting,
    performanceTracker,
    performanceTrackerMetric,
    automatedScripts,
    incidentNoteTemplate,
    statusPageCategory,
    sso,
    StatusPage,
});

// Global Actions.

export default (state: RootState, action: Action) => {
    if (action.type === 'CLEAR_STORE') {
        state = undefined;
    }
    return appReducer(state, action);
};
