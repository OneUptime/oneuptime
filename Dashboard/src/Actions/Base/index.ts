import Action from 'CommonUI/src/types/action';

import CreateActionBase from './create';
import UpdateActionBase from './update';
import DeleteActionBase from './delete';
import ListActionBase from './list';
import GetActionBase from './get';

export default class Actions {
    private createaction: Action;
    private deleteaction: Action;
    private getaction: Action;
    private listaction: Action;
    private updateaction: Action;
    public constructor({
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

    public getCreateActions(): void {
        return this.createAction.getActions();
    }

    public getListActions(): void {
        return this.listAction.getActions();
    }

    public getGetActions(): void {
        return this.getAction.getActions();
    }

    public getUpdateActions(): void {
        return this.updateAction.getActions();
    }

    public getDeleteActions(): void {
        return this.deleteAction.getActions();
    }

    public getCreateConstants(): void {
        return this.createAction.getConstants();
    }

    public getListConstants(): void {
        return this.listAction.getConstants();
    }

    public getGetConstants(): void {
        return this.getAction.getConstants();
    }

    public getUpdateConstants(): void {
        return this.updateAction.getConstants();
    }

    public getDeleteConstants(): void {
        return this.deleteAction.getConstants();
    }
}
