// this class is the base class that all the component can implement
//

import { JSONObject } from 'Common/Types/JSON';
import ObjectID from 'Common/Types/ObjectID';
import { ExpressRouter } from '../../Utils/Express';
import ComponentCode, { RunOptions, RunReturnType } from './ComponentCode';
import { Port } from 'Common/Types/Workflow/Component';
import BadDataException from 'Common/Types/Exception/BadDataException';

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
    removeWorkflow: (workflowId: ObjectID) => Promise<void>;
}

export interface UpdateProps {
    workflowId: ObjectID;
}

export default class TrigegrCode extends ComponentCode {
    public executeWorkflow:
        | ((executeWorkflow: ExecuteWorkflowType) => Promise<void>)
        | null = null;

    public scheduleWorkflow:
        | ((
              executeWorkflow: ExecuteWorkflowType,
              scheduleAt: string
          ) => Promise<void>)
        | null = null;

    public removeWorkflow: ((workflowId: ObjectID) => Promise<void>) | null =
        null;

    public constructor() {
        super();
    }

    public override async run(
        args: JSONObject,
        options: RunOptions
    ): Promise<RunReturnType> {
        const successPort: Port | undefined = this.getMetadata().outPorts.find(
            (p: Port) => {
                return p.id === 'success';
            }
        );

        if (!successPort) {
            throw options.onError(
                new BadDataException('Success port not found')
            );
        }

        return {
            returnValues: {
                ...args,
            },
            executePort: successPort,
        };
    }

    public async setupComponent(props: InitProps): Promise<void> {
        this.executeWorkflow = props.executeWorkflow;
        this.scheduleWorkflow = props.scheduleWorkflow;
        this.removeWorkflow = props.removeWorkflow;

        return await this.init(props);
    }

    public async init(_props: InitProps): Promise<void> {
        return await Promise.resolve();
    }

    public async update(_props: UpdateProps): Promise<void> {
        return await Promise.resolve();
    }
}
