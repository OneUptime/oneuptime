// this class is the base class that all the component can implement
//

import BadDataException from 'Common/Types/Exception/BadDataException';
import Exception from 'Common/Types/Exception/Exception';
import { JSONObject } from 'Common/Types/JSON';
import ObjectID from 'Common/Types/ObjectID';
import ComponentMetadata, { Port } from 'Common/Types/Workflow/Component';



export interface RunOptions {
    log: Function;
    workflowLogId: ObjectID;
    workflowId: ObjectID;
    projectId: ObjectID;
    onError: (exception: Exception) => Exception;
}

export interface RunReturnType {
    returnValues: JSONObject;
    executePort?: Port | undefined;
}

export default class ComponentCode {
    private metadata: ComponentMetadata | null = null;
    
    public constructor() {}

    public setMetadata(metadata: ComponentMetadata): void {
        this.metadata = metadata;
    }

    public getMetadata(): ComponentMetadata {
        if (!this.metadata) {
            throw new BadDataException('ComponentMetadata not found');
        }

        return this.metadata;
    }

    public async run(
        _args: JSONObject,
        _options: RunOptions
    ): Promise<RunReturnType> {
        return await Promise.resolve({
            returnValues: {},
            port: undefined,
        });
    }
}
