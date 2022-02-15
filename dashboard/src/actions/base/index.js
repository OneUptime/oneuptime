import CreateActionBase from "./create"
import UpdateActionBase from "./update"
import DeleteActionBase from "./delete"
import ListActionBase from "./list"
import GetActionBase from "./get"


export default class Actions {
    constructor({
        createActionProps,
        updateActionProps,
        deleteActionProps,
        updateActionProps,
        getActionProps,
        listActionProps,
        friendlyName,
        apiPath,
        isResourceInProject
    }){
        this.createAction = null;
        this.updateAction = null; 
        this.deleteAction = null; 
        this.getAction = null; 
        this.listAction = null; 

        if(createActionProps){
            this.createAction = new CreateActionBase({
                friendlyName, 
                apiPath, 
                isResourceInProject, 
                isRequestAllowed: createActionProps.isRequestAllowed,
            })
        }

        if(updateActionProps){
            this.updateAction = new UpdateActionBase({
                friendlyName, 
                apiPath, 
                isResourceInProject, 
                isRequestAllowed: updateActionProps.isRequestAllowed,
            })
        }

        if(deleteActionProps){
            this.deleteAction = new DeleteActionBase({
                friendlyName, 
                apiPath, 
                isResourceInProject, 
                isRequestAllowed: deleteActionProps.isRequestAllowed,
            })
        }

        if(getActionProps){
            this.deleteAction = new GetActionBase({
                friendlyName, 
                apiPath, 
                isResourceInProject, 
                isRequestAllowed: this.getActionProps.isRequestAllowed,
            })
        }

        if(listActionProps){
            this.listAction = new ListActionBase({
                friendlyName, 
                apiPath, 
                isResourceInProject, 
                isRequestAllowed: listActionProps.isRequestAllowed,
            })
        }
    }
}