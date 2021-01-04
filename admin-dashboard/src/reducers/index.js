import { combineReducers } from 'redux';
import { routerReducer } from 'react-router-redux';
import { reducer as formReducer } from 'redux-form';
import modal from './modal';
import profileSettings from './profile';
import notifications from './notifications';
import user from './user';
import project from './project';
import probe from './probe';
import auditLogs from './auditLogs';
import emailLogs from './emailLogs';
import smsLogs from './smsLogs';
import settings from './settings';
import license from './license';
import page from './page';
import sso from './sso';
import version from './version';

const appReducer = combineReducers({
    routing: routerReducer,
    form: formReducer,
    modal,
    profileSettings,
    notifications,
    user,
    project,
    probe,
    auditLogs,
    emailLogs,
    smsLogs,
    settings,
    license,
    page,
    sso,
    version,
});

export default (state, action) => {
    if (action.type === 'CLEAR_STORE') {
        state = undefined;
    }
    return appReducer(state, action);
};
