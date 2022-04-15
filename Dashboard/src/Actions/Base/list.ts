import BaseAction from './base';

class ListActionBase extends BaseAction {
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
            actionType: 'list',
        });
    }
}

export default ListActionBase;
