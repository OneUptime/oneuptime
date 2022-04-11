import StatusPageAction from '../actions/StatusPage';
import getReducer from './base/index';

export default getReducer({
    actionBase: new StatusPageAction(),
});
