import ComponentCode, {
  Interactive,
  RunOptions,
  RunReturnType,
} from "../../ComponentCode";
import ComponentMetadata, {
  Port,
} from "../../../../../Types/Workflow/Component";
import InteractiveComponents from "../../../../../Types/Workflow/Components/Interactive";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import Workflow from "../../../../../Models/DatabaseModels/Workflow";
import ObjectID from "../../../../../Types/ObjectID";
import WorkflowService from "../../../../Services/WorkflowService";

export default class Delay extends ComponentCode {
  public constructor() {
    super();

    const DelayComponent: ComponentMetadata | undefined =
      InteractiveComponents.find((i: ComponentMetadata) => {
        return i.id === ComponentID.Delay;
      });

    if (!DelayComponent) {
      throw new BadDataException("Component not found.");
    }

    this.setMetadata(DelayComponent);
  }

  public override async run(
    args: JSONObject,
    options: RunOptions,
  ): Promise<RunReturnType> {
    const outPort: Port | undefined = this.getMetadata().outPorts.find(
      (p: Port) => {
        return p.id === "out";
      },
    );

    if (!outPort) {
      throw options.onError(new BadDataException("Out port not found"));
    }

    const _delay: string = args["delay"] as string;
    const delay: number = parseInt(_delay, 10);
    const workflowId: ObjectID = options.workflowId;
    const workflow: Workflow | null = await WorkflowService.findOneById({
      id: workflowId,
      select: {
        graph: true,
        projectId: true,
        interactiveData: true,
      },
      props: {
        isRoot: true,
      },
    });
    if (!workflow) {
      throw options.onError(new BadDataException("Workflow not found"));
    }
    if (workflow.interactiveData) {
      options.log(
        "Interactive data present, workflow already in the waiting state",
      );
      options.log(workflow.interactiveData);
      // already is delayed, check is it the same node first
      const interactive: Interactive =
        workflow.interactiveData as unknown as Interactive; // TODO this is not 100% correct, the Date attributes are still strings, find how to convert
      if (interactive.componentId !== options.nodeId) {
        throw options.onError(
          new BadDataException(
            "Waiting in different interactive component, aborting",
          ),
        );
      }
      options.log(JSON.stringify(interactive));
      if (
        new Date(interactive.startedWaiting).getTime() + delay <
        new Date().getTime()
      ) {
        options.log("Delay expired, continuing to the next node");
        return Promise.resolve({
          returnValues: {},
          executePort: outPort,
        });
      }
      options.log("Delay not yet expired, continuing with the wait");
      interactive.lastTimeChecked = new Date();
      return Promise.resolve({
        returnValues: {},
        executePort: outPort,
        interactive,
      });
    }
    const interactive: Interactive = {
      componentId: options.nodeId,
      lastTimeChecked: new Date(),
      startedWaiting: new Date(),
      nextStateCheck: new Date(new Date().getTime() + delay),
      waiting: true,
    };
    options.log("Initated the waiting node");
    return Promise.resolve({
      returnValues: {},
      executePort: outPort,
      interactive,
    });
  }
}
