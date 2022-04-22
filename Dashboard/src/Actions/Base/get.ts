import BaseAction from './base';

class GetActionBase extends BaseAction {
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
            actionType: 'get',
        });
    }
}

export default GetActionBase;
