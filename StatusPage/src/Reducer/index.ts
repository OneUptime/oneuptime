import { combineReducers } from 'redux';
import { RootState } from '../store';
import Action from 'CommonUI/src/Types/Action';
import { reducer as form } from 'redux-form';
import login from './login';
import status from './status';
import probe from './probe';
import subscribe from './subscribe';

const appReducer: $TSFixMe = combineReducers({
    form,
    login,
    status,
    probe,
    subscribe,
});

export default (state: RootState, action: Action): void => {
    if (action.type === 'CLEAR_STORE') {
        state = undefined;
    }

    return appReducer(state, action);
};
