import Express, { ExpressRouter } from 'CommonServer/Utils/Express';
import Components from 'CommonServer/Types/Workflow/Components/Index';
import ComponentCode, {
    ExecuteWorkflowType,
} from 'CommonServer/Types/Workflow/ComponentCode';
import QueueWorkflow from '../Services/QueueWorkflow';

export default class ComponentCodeAPI {
    public router!: ExpressRouter;

    public constructor() {
        this.router = Express.getRouter();

        // init all component code.
        /// Get all the components.
        for (const key in Components) {
            const ComponentCodeItem: typeof ComponentCode | undefined =
                Components[key];
            if (ComponentCodeItem) {
                const instance = new ComponentCodeItem();
                instance.init({
                    router: this.router,
                    scheduleWorkflow: this.scheduleWorkflow,
                    executeWorkflow: this.executeWorkflow,
                });
            }
        }
    }

    public async scheduleWorkflow(
        executeWorkflow: ExecuteWorkflowType,
        scheduleAt: string
    ) {
        /// add to queue.
        await QueueWorkflow.addWorkflowToQueue(executeWorkflow, scheduleAt);
    }

    public async executeWorkflow(executeWorkflow: ExecuteWorkflowType) {
        // add to queue.
        await QueueWorkflow.addWorkflowToQueue(executeWorkflow);
    }
}
