import CreateActionBase from "./base/create";
import ListActionBase from "./base/list";
import DeleteActionBase from "./base/delete";
import UpdateActionBase from "./base/update";
import GetActionBase from "./base/get";

export class CreateStatusPage extends CreateActionBase {
    constructor() {
        super({
            friendlyName: "Status Page",
            apiPath: "status-page",
            isInProject: true, 
            isRequestAllowed: true, 
        })
    }
}

export class GetStatusPage extends GetActionBase {
    constructor() {
        super({
            friendlyName: "Status Page",
            apiPath: "status-page",
            isInProject: true, 
            isRequestAllowed: true, 
        })
    }
}

export class ListStatusPage extends ListActionBase {
    constructor() {
        super({
            friendlyName: "Status Page",
            apiPath: "status-page",
            isInProject: true, 
            isRequestAllowed: true, 
        })
    }
}

export class DeleteStatusPage extends DeleteActionBase {
    constructor() {
        super({
            friendlyName: "Status Page",
            apiPath: "status-page",
            isInProject: true, 
            isRequestAllowed: true, 
        })
    }
}

export class UpdateStatusPage extends UpdateActionBase {
    constructor() {
        super({
            friendlyName: "Status Page",
            apiPath: "status-page",
            isInProject: true, 
            isRequestAllowed: true, 
        })
    }
}



