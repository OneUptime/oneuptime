import IconProp from "../../Icon/IconProp";
import ComponentID from "../ComponentID";
import ComponentMetadata, {
  ComponentInputType,
  ComponentType,
} from "./../Component";

const components: Array<ComponentMetadata> = [
  {
    id: ComponentID.Log,
    title: "Log",
    category: "Utils",
    // What the step does, in the words of the run's Logs tab.
    description: "Writes its value to the run's log.",
    iconProp: IconProp.Logs,
    componentType: ComponentType.Component,
    arguments: [
      {
        type: ComponentInputType.AnyValue,
        name: "Value",
        description: "Value to log",
        required: true,
        id: "value",
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
          "Connect to this port if you want other components to execute after the value has been logged.",
        id: "out",
      },
    ],
  },
];

export default components;
