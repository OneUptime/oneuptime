import BaseAction from './base';

class UpdateActionBase extends BaseAction {
    public constructor({
        friendlyName,
        apiPath,
        isResourceInProject,
        isRequestAllowed,
    }: $TSFixMe) {
        super({
            friendlyName,
            apiPath,
            isResourceInProject,
            isRequestAllowed,
            actionType: 'update',
        });
    }
}

export default UpdateActionBase;
