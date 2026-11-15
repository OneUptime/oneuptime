import IconProp from "../../Icon/IconProp";
import ComponentID from "../ComponentID";
import ComponentMetadata, {
  ComponentInputType,
  ComponentType,
} from "./../Component";
import { translationKey } from "../../Translator";

const components: Array<ComponentMetadata> = [
  {
    id: ComponentID.Sleep,
    title: translationKey("Sleep"),
    category: translationKey("Utils"),
    description: translationKey(
      "Pause the workflow for a specified duration, then continue with the next steps. The workflow is suspended while sleeping and does not consume a worker — it resumes automatically when the sleep is over.",
    ),
    iconProp: IconProp.Clock,
    componentType: ComponentType.Component,
    arguments: [
      {
        type: ComponentInputType.Number,
        name: translationKey("Days"),
        description: translationKey("Number of days to sleep. Defaults to 0."),
        required: false,
        id: "days",
        placeholder: "0",
      },
      {
        type: ComponentInputType.Number,
        name: translationKey("Hours"),
        description: translationKey("Number of hours to sleep. Defaults to 0."),
        required: false,
        id: "hours",
        placeholder: "0",
      },
      {
        type: ComponentInputType.Number,
        name: translationKey("Minutes"),
        description: translationKey(
          "Number of minutes to sleep. Defaults to 0.",
        ),
        required: false,
        id: "minutes",
        placeholder: "0",
      },
      {
        type: ComponentInputType.Number,
        name: translationKey("Seconds"),
        description: translationKey(
          "Number of seconds to sleep. Defaults to 0.",
        ),
        required: false,
        id: "seconds",
        placeholder: "0",
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
          "Connect components to this port to run them after the sleep is over.",
        ),
        id: "out",
      },
    ],
  },
];

export default components;
