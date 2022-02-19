import Actions from './base/index';

export default class StatusPageActions extends Actions {
    constructor() {
        super({
            createActionProps: {
                isRequestAllowed: true,
            },
            deleteActionProps: {
                isRequestAllowed: true,
            },
            getActionProps: {
                isRequestAllowed: true,
            },
            updateActionProps: {
                isRequestAllowed: true,
            },
            listActionProps: {
                isRequestAllowed: true,
            },
            apiPath: 'status-page',
            friendlyName: 'Status Page',
            isResourceInProject: true,
        });
    }
}
