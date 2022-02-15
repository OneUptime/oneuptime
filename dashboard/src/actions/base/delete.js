import BaseAction from "./base";

class DeleteActionBase extends BaseAction {
    constructor({ friendlyName, apiPath, isResourceInProject, isRequestAllowed }) {
        super({ friendlyName, apiPath, isResourceInProject, isRequestAllowed, actionType: "delete" });
    }
}

export default DeleteActionBase;
