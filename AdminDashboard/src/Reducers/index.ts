import { combineReducers } from 'redux';
import { RootState } from '../store';
import { routerReducer } from 'react-router-redux';
import Action from 'CommonUI/src/types/action';
import { reducer as formReducer } from 'redux-form';
import modal from './modal';
import profileSettings from './profile';
import notifications from './notifications';
import user from './user';
import project from './project';
import probe from './probe';
import auditLogs from './auditLogs';
import emailLogs from './emailLogs';
import callLogs from './callLogs';
import smsLogs from './smsLogs';
import settings from './settings';
import license from './license';
import page from './page';
import sso from './sso';
import ssoDefaultRoles from './ssoDefaultRoles';
import version from './version';
import dashboard from './dashboard';

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
    callLogs,
    emailLogs,
    smsLogs,
    settings,
    license,
    page,
    sso,
    ssoDefaultRoles,
    version,
    dashboard,
});

export default (state: RootState, action: Action): void => {
    if (action.type === 'CLEAR_STORE') {
        state = undefined;
    }
    return appReducer(state, action);
};
