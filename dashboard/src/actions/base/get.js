import BaseAction from "./base";

class GetActionBase extends BaseAction {
    constructor({ friendlyName, apiPath, isInProject,isRequestAllowed }) {
        super({ friendlyName, apiPath, isInProject, isRequestAllowed, actionType: "get" });
    }
}


export default GetActionBase;
