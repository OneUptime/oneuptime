import Action from 'Common-ui/src/types/action';

import CreateActionBase from './create';
import UpdateActionBase from './update';
import DeleteActionBase from './delete';
import ListActionBase from './list';
import GetActionBase from './get';

export default class Actions {
    createaction: Action;
    deleteaction: Action;
    getaction: Action;
    listaction: Action;
    updateaction: Action;
    constructor({
        createActionProps,
        updateActionProps,
        deleteActionProps,
        getActionProps,
        listActionProps,
        friendlyName,
        apiPath,
        isResourceInProject,
    }: $TSFixMe) {
        this.createAction = null;
        this.updateAction = null;
        this.deleteAction = null;
        this.getAction = null;
        this.listAction = null;

        if (createActionProps) {
            this.createAction = new CreateActionBase({
                friendlyName,
                apiPath,
                isResourceInProject,
                isRequestAllowed: createActionProps.isRequestAllowed,
            });
        }

        if (updateActionProps) {
            this.updateAction = new UpdateActionBase({
                friendlyName,
                apiPath,
                isResourceInProject,
                isRequestAllowed: updateActionProps.isRequestAllowed,
            });
        }

        if (deleteActionProps) {
            this.deleteAction = new DeleteActionBase({
                friendlyName,
                apiPath,
                isResourceInProject,
                isRequestAllowed: deleteActionProps.isRequestAllowed,
            });
        }

        if (getActionProps) {
            this.getAction = new GetActionBase({
                friendlyName,
                apiPath,
                isResourceInProject,
                isRequestAllowed: getActionProps.isRequestAllowed,
            });
        }

        if (listActionProps) {
            this.listAction = new ListActionBase({
                friendlyName,
                apiPath,
                isResourceInProject,
                isRequestAllowed: listActionProps.isRequestAllowed,
            });
        }
    }

    getCreateActions() {
        return this.createAction.getActions();
    }

    getListActions() {
        return this.listAction.getActions();
    }

    getGetActions() {
        return this.getAction.getActions();
    }

    getUpdateActions() {
        return this.updateAction.getActions();
    }

    getDeleteActions() {
        return this.deleteAction.getActions();
    }

    getCreateConstants() {
        return this.createAction.getConstants();
    }

    getListConstants() {
        return this.listAction.getConstants();
    }

    getGetConstants() {
        return this.getAction.getConstants();
    }

    getUpdateConstants() {
        return this.updateAction.getConstants();
    }

    getDeleteConstants() {
        return this.deleteAction.getConstants();
    }
}
