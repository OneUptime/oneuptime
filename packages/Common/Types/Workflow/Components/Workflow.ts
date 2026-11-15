import IconProp from "../../Icon/IconProp";
import ComponentID from "../ComponentID";
import ComponentMetadata, {
  ComponentInputType,
  ComponentType,
} from "./../Component";
import { translationKey } from "../../Translator";

const components: Array<ComponentMetadata> = [
  {
    id: ComponentID.WorkflowRun,
    title: translationKey("Execute Workflow"),
    category: translationKey("Utils"),
    description: translationKey(
      "Execute another workflow in the same project (fire-and-forget)",
    ),
    iconProp: IconProp.Workflow,
    componentType: ComponentType.Component,
    arguments: [
      {
        type: ComponentInputType.WorkflowSelect,
        name: translationKey("Workflow"),
        description: translationKey(
          "Pick the workflow to execute. The workflow must be in the same project and be enabled. It must have a Manual trigger to receive the arguments passed below.",
        ),
        required: true,
        id: "workflowId",
        placeholder: translationKey("Select a workflow"),
      },
      {
        type: ComponentInputType.JSON,
        name: translationKey("Arguments"),
        description: translationKey(
          "JSON payload to pass to the target workflow. The target workflow's Manual trigger will emit this object on its output port.",
        ),
        required: false,
        id: "arguments",
        placeholder: '{ "key": "value" }',
      },
    ],
    returnValues: [],
    inPorts: [
      {
        title: translationKey("In"),
        description: translationKey(
          "Please connect components to this port for this component to work.",
        ),
        id: "in",
      },
    ],
    outPorts: [
      {
        title: translationKey("Out"),
        description: translationKey(
          "Connect to this port if you want other components to execute after the workflow is triggered. This component is fire-and-forget — it does not wait for the child workflow to finish.",
        ),
        id: "out",
      },
      {
        title: translationKey("Error"),
        description: translationKey(
          "Executes if the child workflow could not be enqueued (e.g. not found, disabled, or in a different project).",
        ),
        id: "error",
      },
    ],
  },
];

export default components;
