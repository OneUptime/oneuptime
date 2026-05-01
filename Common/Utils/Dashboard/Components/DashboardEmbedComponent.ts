import DashboardEmbedComponent from "../../../Types/Dashboard/DashboardComponents/DashboardEmbedComponent";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import DashboardBaseComponentUtil from "./DashboardBaseComponent";
import {
  ComponentArgument,
  ComponentArgumentSection,
  ComponentInputType,
} from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";

const DisplaySection: ComponentArgumentSection = {
  name: "Display Options",
  description: "Configure the embed",
  order: 1,
};

export default class DashboardEmbedComponentUtil extends DashboardBaseComponentUtil {
  public static override getDefaultComponent(): DashboardEmbedComponent {
    return {
      _type: ObjectType.DashboardComponent,
      componentType: DashboardComponentType.Embed,
      widthInDashboardUnits: 6,
      heightInDashboardUnits: 4,
      topInDashboardUnits: 0,
      leftInDashboardUnits: 0,
      componentId: ObjectID.generate(),
      minHeightInDashboardUnits: 3,
      minWidthInDashboardUnits: 3,
      arguments: {},
    };
  }

  public static override getComponentConfigArguments(): Array<
    ComponentArgument<DashboardEmbedComponent>
  > {
    const componentArguments: Array<
      ComponentArgument<DashboardEmbedComponent>
    > = [];

    componentArguments.push({
      name: "Title",
      description: "Header shown above the embed",
      required: false,
      type: ComponentInputType.Text,
      id: "title",
      section: DisplaySection,
    });

    componentArguments.push({
      name: "URL",
      description: "Page to embed (must allow iframe embedding)",
      required: true,
      type: ComponentInputType.Text,
      id: "url",
      placeholder: "https://example.com/embed",
      section: DisplaySection,
    });

    componentArguments.push({
      name: "Sandbox",
      description:
        "Block scripts and pop-outs in the embedded page. Most embed targets need scripts, so leave off unless you know the source is untrusted.",
      required: false,
      type: ComponentInputType.Boolean,
      id: "sandbox",
      section: DisplaySection,
    });

    return componentArguments;
  }
}
