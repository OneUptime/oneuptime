import BaseAction from "./base";

class DeleteActionBase extends BaseAction {
    constructor({ friendlyName, apiPath, isInProject, isRequestAllowed }) {
        super({ friendlyName, apiPath, isInProject, isRequestAllowed, actionType: "delete" });
    }
}

export default DeleteActionBase;
