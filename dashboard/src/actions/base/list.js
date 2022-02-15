import BaseAction from "./base";

class ListActionBase extends BaseAction {
    constructor({ friendlyName, apiPath, isInProject,isRequestAllowed }) {
        super({ friendlyName, apiPath, isInProject, isRequestAllowed, actionType: "list" });
    }
}


export default ListActionBase;
