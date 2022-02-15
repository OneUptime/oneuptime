import BaseAction from "./base";

class CreateActionBase extends BaseAction {
    constructor({ friendlyName, apiPath, isInProject,isRequestAllowed }) {
        super({ friendlyName, apiPath, isInProject, isRequestAllowed, actionType: "create" });
    }
}

export default CreateActionBase;
