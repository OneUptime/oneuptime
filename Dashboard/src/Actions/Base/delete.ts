import BaseAction from './base';

class DeleteActionBase extends BaseAction {
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
            actionType: 'delete',
        });
    }
}

export default DeleteActionBase;
