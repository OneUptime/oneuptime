import QueueWorkflow from "../Services/QueueWorkflow";
import ObjectID from "Common/Types/ObjectID";
import ComponentCode from "Common/Server/Types/Workflow/ComponentCode";
import Components from "Common/Server/Types/Workflow/Components/Index";
import TriggerCode, {
  ExecuteWorkflowType,
} from "Common/Server/Types/Workflow/TriggerCode";
import Express, { ExpressRouter } from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";

export default class ComponentCodeAPI {
  public router!: ExpressRouter;

  public constructor() {
    this.router = Express.getRouter();
  }

  public init(): void {
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
    scheduleAt: string,
  ): Promise<void> {
    /// add to queue.
    await QueueWorkflow.addWorkflowToQueue(executeWorkflow, scheduleAt);
  }

  public async executeWorkflow(
    executeWorkflow: ExecuteWorkflowType,
  ): Promise<void> {
    // add to queue.
    await QueueWorkflow.addWorkflowToQueue(executeWorkflow);
  }

  public async removeWorkflow(workflowId: ObjectID): Promise<void> {
    // add to queue.
    await QueueWorkflow.removeWorkflow(workflowId);
  }
}
