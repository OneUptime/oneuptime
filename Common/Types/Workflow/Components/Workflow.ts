import IconProp from "../../Icon/IconProp";
import ComponentID from "../ComponentID";
import ComponentMetadata, {
  ComponentInputType,
  ComponentType,
} from "./../Component";

const components: Array<ComponentMetadata> = [
  {
    id: ComponentID.WorkflowRun,
    title: "Execute Workflow",
    category: "Utils",
    description: "Execute another workflow in the same project (fire-and-forget)",
    iconProp: IconProp.Workflow,
    componentType: ComponentType.Component,
    arguments: [
      {
        type: ComponentInputType.Text,
        name: "Workflow ID",
        description:
          "ID of the workflow to execute. The workflow must be in the same project and be enabled. It must have a Manual trigger to receive the arguments passed below.",
        required: true,
        id: "workflowId",
        placeholder: "e.g. 64a0f7c9e3b2c1a4d5e6f7a8",
      },
      {
        type: ComponentInputType.JSON,
        name: "Arguments",
        description:
          "JSON payload to pass to the target workflow. The target workflow's Manual trigger will emit this object on its output port.",
        required: false,
        id: "arguments",
        placeholder: '{ "key": "value" }',
      },
    ],
    returnValues: [],
    inPorts: [
      {
        title: "In",
        description:
          "Please connect components to this port for this component to work.",
        id: "in",
      },
    ],
    outPorts: [
      {
        title: "Out",
        description:
          "Connect to this port if you want other components to execute after the workflow is triggered. This component is fire-and-forget — it does not wait for the child workflow to finish.",
        id: "out",
      },
      {
        title: "Error",
        description:
          "Executes if the child workflow could not be enqueued (e.g. not found, disabled, or in a different project).",
        id: "error",
      },
    ],
  },
];

export default components;
