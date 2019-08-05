import { combineReducers } from 'redux';
import { routerReducer } from 'react-router-redux';
import { reducer as formReducer } from 'redux-form';
import modal from './modal';
import profileSettings from './profile';
import feedback from './feedback';
import notifications from './notifications';

const appReducer = combineReducers({
    routing: routerReducer,
    form: formReducer,
    modal,
    profileSettings,
    feedback,
    notifications,
});

export default (state, action) => {
    if (action.type === 'CLEAR_STORE') {
        state = undefined;
    }
    return appReducer(state, action);
}
