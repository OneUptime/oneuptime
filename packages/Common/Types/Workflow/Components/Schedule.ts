import IconProp from "../../Icon/IconProp";
import ComponentID from "../ComponentID";
import ComponentMetadata, {
  ComponentInputType,
  ComponentType,
} from "./../Component";
import { translationKey } from "../../Translator";

const components: Array<ComponentMetadata> = [
  {
    id: ComponentID.Schedule,
    title: translationKey("Schedule"),
    category: translationKey("Schedule"),
    description: translationKey("Run this workflow on particular schedule"),
    iconProp: IconProp.Clock,
    componentType: ComponentType.Trigger,
    runWorkflowManuallyArguments: [],
    arguments: [
      {
        type: ComponentInputType.CronTab,
        name: translationKey("Schedule at"),
        description: translationKey("Trigger this workflow at"),
        required: true,
        id: "schedule",
      },
    ],
    returnValues: [],
    inPorts: [],
    outPorts: [
      {
        title: translationKey("Execute"),
        description: translationKey(
          "Connect the steps to run at each scheduled time.",
        ),
        id: "execute",
      },
    ],
  },
];

export default components;
