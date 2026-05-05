import DashboardDockerContainerListComponent from "../../../Types/Dashboard/DashboardComponents/DashboardDockerContainerListComponent";
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

const DisplaySection: ComponentArgumentSection = {
  name: "Display Options",
  description: "Configure the widget title and row limit",
  order: 1,
};

const FiltersSection: ComponentArgumentSection = {
  name: "Filters",
  description: "Narrow down which containers are shown",
  order: 2,
  defaultCollapsed: true,
};

export default class DashboardDockerContainerListComponentUtil extends DashboardBaseComponentUtil {
  public static override getDefaultComponent(): DashboardDockerContainerListComponent {
    return {
      _type: ObjectType.DashboardComponent,
      componentType: DashboardComponentType.DockerContainerList,
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
    ComponentArgument<DashboardDockerContainerListComponent>
  > {
    const args: Array<
      ComponentArgument<DashboardDockerContainerListComponent>
    > = [];

    args.push({
      name: "Title",
      description: "Header shown above the container list",
      required: false,
      type: ComponentInputType.Text,
      id: "title",
      section: DisplaySection,
    });

    args.push({
      name: "Max Rows",
      description: "Maximum number of containers to show",
      required: false,
      type: ComponentInputType.Number,
      id: "maxRows",
      placeholder: "25",
      section: DisplaySection,
    });

    args.push({
      name: "Hosts",
      description: "Show only containers from the selected hosts",
      required: false,
      type: ComponentInputType.EntityMultiSelectDropdown,
      id: "dockerHostIds",
      placeholder: "All hosts",
      section: FiltersSection,
      entityFilterModelType: EntityFilterModelType.DockerHost,
    });

    args.push({
      name: "Image Name",
      description: "Substring of the container image to match (e.g. nginx)",
      required: false,
      type: ComponentInputType.Text,
      id: "imageName",
      placeholder: "nginx",
      section: FiltersSection,
    });

    return args;
  }
}
