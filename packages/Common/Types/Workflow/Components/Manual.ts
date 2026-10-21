import IconProp from "../../Icon/IconProp";
import ComponentID from "../ComponentID";
import ComponentMetadata, {
  ComponentInputType,
  ComponentType,
} from "./../Component";

const components: Array<ComponentMetadata> = [
  {
    id: ComponentID.Manual,
    title: "Manual",
    category: "Utils",
    description: "Run this workflow manually",
    iconProp: IconProp.Play,
    componentType: ComponentType.Trigger,
    arguments: [],
    runWorkflowManuallyArguments: [
      {
        type: ComponentInputType.JSON,
        name: "JSON",
        description: "Enter JSON value that you need to run this workflow",
        required: false,
        id: "value",
        placeholder: '{"key1": "value1", "key2": "value2", ....}',
      },
    ],
    returnValues: [
      {
        type: ComponentInputType.JSON,
        name: "JSON",
        description: "The JSON this run was started with.",
        required: false,
        id: "value",
        placeholder: '{"key1": "value1", "key2": "value2", ....}',
      },
    ],
    inPorts: [],
    outPorts: [
      {
        title: "Execute",
        description: "Connect the steps to run when the workflow is started.",
        id: "success",
      },
    ],
  },
];

export default components;
