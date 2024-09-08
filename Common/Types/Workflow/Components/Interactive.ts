import ComponentMetadata, {
  ComponentInputType,
  ComponentType,
} from "../Component";
import ComponentID from "../ComponentID";
import IconProp from "../../Icon/IconProp";

const components: Array<ComponentMetadata> = [
  {
    id: ComponentID.Delay,
    title: "Delay",
    category: "Interactive",
    description: "Wait for fixed amount of time",
    iconProp: IconProp.Calendar,
    componentType: ComponentType.Component,
    arguments: [
      {
        type: ComponentInputType.AnyValue,
        name: "Milliseconds",
        description: "Milliseconds to wait",
        required: true,
        id: "delay",
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
          "Connect to this port if you want other components to execute after the delay expired",
        id: "out",
      },
    ],
  },
];

export default components;
