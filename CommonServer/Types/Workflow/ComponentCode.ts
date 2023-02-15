// this class is the base class that all the component can implement
// 

import BadDataException from "Common/Types/Exception/BadDataException";
import NotImplementedException from "Common/Types/Exception/NotImplementedException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ComponentMetadata, { Port } from "Common/Types/Workflow/Component";
import { ExpressRouter } from "../../Utils/Express";

export interface RunProps {
    global: {
        variables: JSONObject
    },
    local: {
        variables: JSONObject,
        components: {
            // component id. 
            [x: string]: {
                returnValues: JSONObject
            }
        }
    },
    workflowId: ObjectID,
    workflowRunId: ObjectID
}

export interface RunReturnType {
    returnValues: JSONObject,
    executePort: Port
}

export interface InitProps{
    router: ExpressRouter;
    runWorkflow: (workflowId: ObjectID, returnValues: JSONObject) => void; 
}

export default class ComponentCode { 

    private metadata: ComponentMetadata | null = null;

    public constructor(metadata: ComponentMetadata){
        this.metadata = metadata;
    }


    public getMetadata(): ComponentMetadata { 
        if(!this.metadata){
            throw new BadDataException("ComponentMetadata not found")
        }

        return this.metadata;
    }

    public async init(_props: InitProps ): Promise<void>{
        throw new NotImplementedException();
    }

    public async run(_props: RunProps): Promise<RunReturnType>{
        throw new NotImplementedException();
    }
}