import { combineReducers } from 'redux';
import status from './status';
import { reducer as form } from 'redux-form';
import login from './login';
import subscribe from './subscribe'

const appReducer = combineReducers({ status, form, login,subscribe });

export default (state, action) => {
  if (action.type === 'CLEAR_STORE') {
    state = undefined;
  }

return appReducer(state, action);
}