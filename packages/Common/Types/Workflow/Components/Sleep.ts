import IconProp from "../../Icon/IconProp";
import ComponentID from "../ComponentID";
import ComponentMetadata, {
  ComponentInputType,
  ComponentType,
} from "./../Component";

const components: Array<ComponentMetadata> = [
  {
    id: ComponentID.Sleep,
    title: "Sleep",
    category: "Utils",
    description:
      "Pause the workflow for a specified duration, then continue with the next steps. The workflow is suspended while sleeping and does not consume a worker — it resumes automatically when the sleep is over.",
    iconProp: IconProp.Clock,
    componentType: ComponentType.Component,
    arguments: [
      {
        type: ComponentInputType.Number,
        name: "Days",
        description: "Number of days to sleep. Optional. Defaults to 0.",
        required: false,
        id: "days",
        placeholder: "0",
      },
      {
        type: ComponentInputType.Number,
        name: "Hours",
        description: "Number of hours to sleep. Optional. Defaults to 0.",
        required: false,
        id: "hours",
        placeholder: "0",
      },
      {
        type: ComponentInputType.Number,
        name: "Minutes",
        description: "Number of minutes to sleep. Optional. Defaults to 0.",
        required: false,
        id: "minutes",
        placeholder: "0",
      },
      {
        type: ComponentInputType.Number,
        name: "Seconds",
        description: "Number of seconds to sleep. Optional. Defaults to 0.",
        required: false,
        id: "seconds",
        placeholder: "0",
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
          "Connect components to this port to run them after the sleep is over.",
        id: "out",
      },
    ],
  },
];

export default components;
