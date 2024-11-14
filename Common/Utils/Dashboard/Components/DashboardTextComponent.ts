import { ComponentArgument, ComponentInputType } from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardTextComponent from "../../../Types/Dashboard/DashboardComponents/DashboardTextComponent";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import DashboardBaseComponentUtil from "./DashboardBaseComponent";

export default class DashboardTextComponentUtil extends DashboardBaseComponentUtil {
  public static override getDefaultComponent(): DashboardTextComponent {
    return {
      _type: ObjectType.DashboardTextComponent,
      widthInDashboardUnits: 6,
      heightInDashboardUnits: 1,
      topInDashboardUnits: 0,
      leftInDashboardUnits: 0,
      arguments: {
        text: "Hello, World!",
        isBold: false,
        isItalic: false,
        isUnderline: false
      },
      componentId: ObjectID.generate(),
      minHeightInDashboardUnits: 1,
      minWidthInDashboardUnits: 3
    };
  }

  public static override getComponentConfigArguments(): Array<ComponentArgument<DashboardTextComponent>> {
    const componentArguments: Array<ComponentArgument<DashboardTextComponent>> = []; 

    componentArguments.push({
      name: "Text",
      description: "The text to display",
      required: true,
      type: ComponentInputType.LongText,
      id: "text",
      placeholder: "Hello, World!"
    });

    componentArguments.push({
      name: "Bold",
      description: "Whether the text should be bold",
      required: false,
      type: ComponentInputType.Boolean,
      id: "isBold",
      placeholder: "false"
    });

    componentArguments.push({
      name: "Italic",
      description: "Whether the text should be italic",
      required: false,
      type: ComponentInputType.Boolean,
      id: "isItalic",
      placeholder: "false"
    });

    componentArguments.push({
      name: "Underline",
      description: "Whether the text should be underlined",
      required: false,
      type: ComponentInputType.Boolean,
      id: "isUnderline",
      placeholder: "false"
    });

    return componentArguments;
  } 
}
