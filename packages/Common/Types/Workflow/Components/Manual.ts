import IconProp from "../../Icon/IconProp";
import ComponentID from "../ComponentID";
import ComponentMetadata, {
  ComponentInputType,
  ComponentType,
} from "./../Component";
import { translationKey } from "../../Translator";

const components: Array<ComponentMetadata> = [
  {
    id: ComponentID.Manual,
    title: translationKey("Manual"),
    category: translationKey("Utils"),
    description: translationKey("Run this workflow manually"),
    iconProp: IconProp.Play,
    componentType: ComponentType.Trigger,
    arguments: [],
    runWorkflowManuallyArguments: [
      {
        type: ComponentInputType.JSON,
        name: translationKey("JSON"),
        description: translationKey(
          "Enter JSON value that you need to run this workflow",
        ),
        required: false,
        id: "value",
        placeholder: '{"key1": "value1", "key2": "value2", ....}',
      },
    ],
    returnValues: [
      {
        type: ComponentInputType.JSON,
        name: translationKey("JSON"),
        description: translationKey("The JSON this run was started with."),
        required: false,
        id: "value",
        placeholder: '{"key1": "value1", "key2": "value2", ....}',
      },
    ],
    inPorts: [],
    outPorts: [
      {
        title: translationKey("Execute"),
        description: translationKey(
          "Connect the steps to run when the workflow is started.",
        ),
        id: "success",
      },
    ],
  },
];

export default components;
