import BaseAction from './base';

class CreateActionBase extends BaseAction {
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
            actionType: 'create',
        });
    }
}

export default CreateActionBase;
