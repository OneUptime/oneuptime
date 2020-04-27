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
import settings from './settings';
import license from './license';
import page from './page';
import sso from './sso'

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
    settings,
    license,
    page,
    sso,
});

export default (state, action) => {
    if (action.type === 'CLEAR_STORE') {
        state = undefined;
    }
    return appReducer(state, action);
};
