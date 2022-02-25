import BaseAction from './base';

class GetActionBase extends BaseAction {
    constructor({
        friendlyName,
        apiPath,
        isResourceInProject,
        isRequestAllowed,
    }) {
        super({
            friendlyName,
            apiPath,
            isResourceInProject,
            isRequestAllowed,
            actionType: 'get',
        });
    }
}

export default GetActionBase;
