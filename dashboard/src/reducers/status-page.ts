import StatusPageAction from '../actions/status-page';
import getReducer from './base/index';

export default getReducer({
    actionBase: new StatusPageAction(),
});
