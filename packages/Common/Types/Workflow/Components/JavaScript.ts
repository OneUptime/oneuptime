import IconProp from "../../Icon/IconProp";
import ComponentID from "../ComponentID";
import ComponentMetadata, {
  ComponentInputType,
  ComponentType,
} from "./../Component";
import { translationKey } from "../../Translator";

const components: Array<ComponentMetadata> = [
  {
    id: ComponentID.JavaScriptCode,
    title: translationKey("Run Custom JavaScript"),
    category: translationKey("Custom Code"),
    description: translationKey("Run custom JavaScript in your workflow"),
    iconProp: IconProp.Code,
    componentType: ComponentType.Component,
    arguments: [
      {
        type: ComponentInputType.JavaScript,
        name: translationKey("JavaScript Code"),
        description: translationKey("JavaScript Code"),
        required: true,
        id: "code",
      },
      {
        type: ComponentInputType.JSON,
        name: translationKey("Arguments"),
        description: translationKey(
          "Pass in arguments to your JavaScript Code from this workflow",
        ),
        required: false,
        id: "arguments",
      },
    ],
    returnValues: [
      {
        type: ComponentInputType.AnyValue,
        name: translationKey("Value"),
        description: translationKey("Value as Output"),
        required: false,
        id: "returnValue",
      },
      {
        type: ComponentInputType.Text,
        name: translationKey("Error"),
        description: translationKey(
          "Error message when the script follows the Error port",
        ),
        required: false,
        id: "error",
      },
    ],
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
        title: translationKey("Success"),
        description: translationKey(
          "This is executed when the code runs successfully",
        ),
        id: "success",
      },
      {
        title: translationKey("Error"),
        description: translationKey("This is executed when code fails to run"),
        id: "error",
      },
    ],
  },
];

export default components;
