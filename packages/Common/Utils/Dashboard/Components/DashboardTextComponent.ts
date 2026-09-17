import {
  ComponentArgument,
  ComponentArgumentSection,
  ComponentInputType,
} from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardTextComponent from "../../../Types/Dashboard/DashboardComponents/DashboardTextComponent";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import DashboardBaseComponentUtil from "./DashboardBaseComponent";

const ContentSection: ComponentArgumentSection = {
  name: "Content",
  description: "The text content to display",
  order: 1,
};

const FormattingSection: ComponentArgumentSection = {
  name: "Formatting",
  description: "Text style options",
  order: 2,
  defaultCollapsed: true,
};

export default class DashboardTextComponentUtil extends DashboardBaseComponentUtil {
  public static override getDefaultComponent(): DashboardTextComponent {
    return {
      _type: ObjectType.DashboardComponent,
      componentType: DashboardComponentType.Text,
      widthInDashboardUnits: 6,
      heightInDashboardUnits: 1,
      topInDashboardUnits: 0,
      leftInDashboardUnits: 0,
      arguments: {
        text: "Hello, World!",
        isBold: false,
        isItalic: false,
        isUnderline: false,
        isMarkdown: false,
      },
      componentId: ObjectID.generate(),
      minHeightInDashboardUnits: 1,
      minWidthInDashboardUnits: 3,
    };
  }

  public static override getComponentConfigArguments(): Array<
    ComponentArgument<DashboardTextComponent>
  > {
    const componentArguments: Array<ComponentArgument<DashboardTextComponent>> =
      [];

    componentArguments.push({
      name: "Text",
      description: "The text to display in the widget",
      required: true,
      type: ComponentInputType.LongText,
      id: "text",
      placeholder: "Hello, World!",
      section: ContentSection,
    });

    componentArguments.push({
      name: "Bold",
      description: "Make text bold",
      required: false,
      type: ComponentInputType.Boolean,
      id: "isBold",
      section: FormattingSection,
    });

    componentArguments.push({
      name: "Italic",
      description: "Make text italic",
      required: false,
      type: ComponentInputType.Boolean,
      id: "isItalic",
      section: FormattingSection,
    });

    componentArguments.push({
      name: "Underline",
      description: "Underline the text",
      required: false,
      type: ComponentInputType.Boolean,
      id: "isUnderline",
      section: FormattingSection,
    });

    componentArguments.push({
      name: "Markdown",
      description: "Render as markdown (headers, links, lists, code, tables)",
      required: false,
      type: ComponentInputType.Boolean,
      id: "isMarkdown",
      section: FormattingSection,
    });

    return componentArguments;
  }
}
