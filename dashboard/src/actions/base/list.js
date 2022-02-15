import BaseAction from "./base";

class ListActionBase extends BaseAction {
    constructor({ friendlyName, apiPath, isResourceInProject,isRequestAllowed }) {
        super({ friendlyName, apiPath, isResourceInProject, isRequestAllowed, actionType: "list" });
    }
}


export default ListActionBase;
