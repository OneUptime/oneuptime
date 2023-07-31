import Express, { ExpressRouter } from 'CommonServer/Utils/Express';
import Components from 'CommonServer/Types/Workflow/Components/Index';
import TriggerCode, {
    ExecuteWorkflowType,
} from 'CommonServer/Types/Workflow/TriggerCode';
import ComponentCode from 'CommonServer/Types/Workflow/ComponentCode';
import QueueWorkflow from '../Services/QueueWorkflow';
import logger from 'CommonServer/Utils/Logger';
import ObjectID from 'Common/Types/ObjectID';

export default class ComponentCodeAPI {
    public router!: ExpressRouter;

    public constructor() {
        this.router = Express.getRouter();

        // init all component code.
        /// Get all the components.
        for (const key in Components) {
            const ComponentCode: ComponentCode | undefined = Components[key];
            if (ComponentCode instanceof TriggerCode) {
                const instance: TriggerCode = ComponentCode;
                instance
                    .setupComponent({
                        router: this.router,
                        scheduleWorkflow: this.scheduleWorkflow,
                        executeWorkflow: this.executeWorkflow,
                        removeWorkflow: this.removeWorkflow,
                    })
                    .catch((err: Error) => {
                        logger.error(err);
                    });
            }
        }
    }

    public async scheduleWorkflow(
        executeWorkflow: ExecuteWorkflowType,
        scheduleAt: string
    ): Promise<void> {
        /// add to queue.
        await QueueWorkflow.addWorkflowToQueue(executeWorkflow, scheduleAt);
    }

    public async executeWorkflow(
        executeWorkflow: ExecuteWorkflowType
    ): Promise<void> {
        // add to queue.
        await QueueWorkflow.addWorkflowToQueue(executeWorkflow);
    }

    public async removeWorkflow(workflowId: ObjectID): Promise<void> {
        // add to queue.
        await QueueWorkflow.removeWorkflow(workflowId);
    }
}
