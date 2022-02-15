import BaseAction from "./base";

class UpdateActionBase extends BaseAction {
    constructor({ friendlyName, apiPath, isInProject,isRequestAllowed }) {
        super({ friendlyName, apiPath, isInProject, isRequestAllowed, actionType: "update" });
    }
}

export default UpdateActionBase;
