// this class is the base class that all the component can implement
// 

import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ComponentMetadata, { Port } from "Common/Types/Workflow/Component";
import { ExpressRouter } from "../../Utils/Express";

export interface RunProps {
    arguments: JSONObject;
    workflowId: ObjectID;
    workflowRunId: ObjectID;
}

export interface RunReturnType {
    returnValues: JSONObject,
    executePort?: Port | undefined
}

export interface ExecuteWorkflowType {
    workflowId: ObjectID,
    returnValues: JSONObject,
}

export interface InitProps {
    router: ExpressRouter;
    executeWorkflow: (executeWorkflow: ExecuteWorkflowType) => Promise<void>;
    scheduleWorkflow: (executeWorkflow: ExecuteWorkflowType, scheduleAt: string) => Promise<void>;
}

export default class ComponentCode {

    private metadata: ComponentMetadata | null = null;

    public constructor(metadata: ComponentMetadata) {
        this.metadata = metadata;
    }


    public getMetadata(): ComponentMetadata {
        if (!this.metadata) {
            throw new BadDataException("ComponentMetadata not found")
        }

        return this.metadata;
    }

    public async init(_props: InitProps): Promise<void> {
        return await Promise.resolve()
    }

    public async run(_props: RunProps): Promise<RunReturnType> {
        return await Promise.resolve({
            returnValues: {},
            port: undefined
        })
    }
}