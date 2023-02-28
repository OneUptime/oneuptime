// this class is the base class that all the component can implement
//

import BadDataException from 'Common/Types/Exception/BadDataException';
import Exception from 'Common/Types/Exception/Exception';
import { JSONObject } from 'Common/Types/JSON';
import ObjectID from 'Common/Types/ObjectID';
import ComponentMetadata, { Port } from 'Common/Types/Workflow/Component';
import { ExpressRouter } from '../../Utils/Express';

export interface RunProps {
    arguments: JSONObject;
    workflowId: ObjectID;
    workflowLogId: ObjectID;
    timeout: number;
}

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

export interface ExecuteWorkflowType {
    workflowId: ObjectID;
    returnValues: JSONObject;
}

export interface InitProps {
    router: ExpressRouter;
    executeWorkflow: (executeWorkflow: ExecuteWorkflowType) => Promise<void>;
    scheduleWorkflow: (
        executeWorkflow: ExecuteWorkflowType,
        scheduleAt: string
    ) => Promise<void>;
}

export interface UpdateProps {
    workflowId: ObjectID;
}

export default class ComponentCode {
    private metadata: ComponentMetadata | null = null;

    public executeWorkflow:  ((executeWorkflow: ExecuteWorkflowType) => Promise<void>) | null = null;

    public scheduleWorkflow:  ((
        executeWorkflow: ExecuteWorkflowType,
        scheduleAt: string
    ) => Promise<void>) | null = null;

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

    public async setupComponent(props: InitProps): Promise<void> {

        this.executeWorkflow = props.executeWorkflow;
        this.scheduleWorkflow = props.scheduleWorkflow;

        return await this.init(props);
    }

    public async init(_props: InitProps): Promise<void> {
        return await Promise.resolve();
    }

    public async update(_props: UpdateProps): Promise<void> {
        return await Promise.resolve();
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
