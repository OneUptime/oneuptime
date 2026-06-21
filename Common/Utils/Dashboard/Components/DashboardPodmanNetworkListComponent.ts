import DashboardPodmanNetworkListComponent from "../../../Types/Dashboard/DashboardComponents/DashboardPodmanNetworkListComponent";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import DashboardBaseComponentUtil from "./DashboardBaseComponent";
import {
  ComponentArgument,
  ComponentArgumentSection,
  ComponentInputType,
  EntityFilterModelType,
} from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import { getViewModeArgument } from "./DashboardListSharedArgs";

const DisplaySection: ComponentArgumentSection = {
  name: "Display Options",
  description: "Configure the widget title and row limit",
  order: 1,
};

const FiltersSection: ComponentArgumentSection = {
  name: "Filters",
  description: "Narrow down which networks are shown",
  order: 2,
  defaultCollapsed: true,
};

export default class DashboardPodmanNetworkListComponentUtil extends DashboardBaseComponentUtil {
  public static override getDefaultComponent(): DashboardPodmanNetworkListComponent {
    return {
      _type: ObjectType.DashboardComponent,
      componentType: DashboardComponentType.PodmanNetworkList,
      widthInDashboardUnits: 6,
      heightInDashboardUnits: 4,
      topInDashboardUnits: 0,
      leftInDashboardUnits: 0,
      componentId: ObjectID.generate(),
      minHeightInDashboardUnits: 3,
      minWidthInDashboardUnits: 6,
      arguments: {
        maxRows: 25,
      },
    };
  }

  public static override getComponentConfigArguments(): Array<
    ComponentArgument<DashboardPodmanNetworkListComponent>
  > {
    const args: Array<ComponentArgument<DashboardPodmanNetworkListComponent>> =
      [];

    args.push({
      name: "Title",
      description: "Header shown above the network list",
      required: false,
      type: ComponentInputType.Text,
      id: "title",
      section: DisplaySection,
    });

    args.push({
      name: "Max Rows",
      description: "Maximum number of networks to show",
      required: false,
      type: ComponentInputType.Number,
      id: "maxRows",
      placeholder: "25",
      section: DisplaySection,
    });

    args.push(
      getViewModeArgument<DashboardPodmanNetworkListComponent>(DisplaySection),
    );

    args.push({
      name: "Hosts",
      description: "Show only networks from the selected hosts",
      required: false,
      type: ComponentInputType.EntityMultiSelectDropdown,
      id: "podmanHostIds",
      placeholder: "All hosts",
      section: FiltersSection,
      entityFilterModelType: EntityFilterModelType.PodmanHost,
    });

    return args;
  }
}
