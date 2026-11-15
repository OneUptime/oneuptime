import IconProp from "../../Icon/IconProp";
import ComponentID from "../ComponentID";
import ComponentMetadata, {
  ComponentInputType,
  ComponentType,
} from "./../Component";
import { translationKey } from "../../Translator";

const components: Array<ComponentMetadata> = [
  {
    id: ComponentID.Log,
    title: translationKey("Log"),
    category: translationKey("Utils"),
    // What the step does, in the words of the run's Logs tab.
    description: translationKey("Writes its value to the run's log."),
    iconProp: IconProp.Logs,
    componentType: ComponentType.Component,
    arguments: [
      {
        type: ComponentInputType.AnyValue,
        name: translationKey("Value"),
        description: translationKey("Value to log"),
        required: true,
        id: "value",
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
          "Connect to this port if you want other components to execute after the value has been logged.",
        ),
        id: "out",
      },
    ],
  },
];

export default components;
