// this class is the base class that all the component can implement
//

import { JSONObject } from 'Common/Types/JSON';
import ObjectID from 'Common/Types/ObjectID';
import { ExpressRouter } from '../../Utils/Express';
import ComponentCode from './ComponentCode';

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

export default class TrigegrCode extends ComponentCode {


    public executeWorkflow:  ((executeWorkflow: ExecuteWorkflowType) => Promise<void>) | null = null;

    public scheduleWorkflow:  ((
        executeWorkflow: ExecuteWorkflowType,
        scheduleAt: string
    ) => Promise<void>) | null = null;

    public constructor() {
        super();
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
}
