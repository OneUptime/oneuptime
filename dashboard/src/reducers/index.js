import { combineReducers } from 'redux';
import monitor from './monitor';
import { routerReducer } from 'react-router-redux';
import { reducer as formReducer } from 'redux-form';
import alert from './alert';
import team from './team';
import modal from './modal';
import project from './project';
import schedule from './schedule';
import changePassword from './changePassword';
import statusPage from './statusPage';
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
import monitorCategories from './monitorCategories';
import card from './card';
import page from './page';
import probe from './probe';
import version from './version';
import tutorial from './tutorial';
import dateTime from './dateTime';

const appReducer = combineReducers({
    routing: routerReducer,
    form: formReducer,
    team,
    alert,
    modal,
    project,
    changePassword,
    monitor,
    monitorCategories,
    schedule,
    statusPage,
    incident,
    invoice,
    profileSettings,
    feedback,
    notifications,
    slack,
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
});

export default (state, action) => {
    if (action.type === 'CLEAR_STORE') {
        state = undefined;
    }
    return appReducer(state, action);
};
