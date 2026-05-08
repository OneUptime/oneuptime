import DashboardDockerImageListComponent from "../../../Types/Dashboard/DashboardComponents/DashboardDockerImageListComponent";
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
  description: "Narrow down which images are shown",
  order: 2,
  defaultCollapsed: true,
};

export default class DashboardDockerImageListComponentUtil extends DashboardBaseComponentUtil {
  public static override getDefaultComponent(): DashboardDockerImageListComponent {
    return {
      _type: ObjectType.DashboardComponent,
      componentType: DashboardComponentType.DockerImageList,
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
    ComponentArgument<DashboardDockerImageListComponent>
  > {
    const args: Array<ComponentArgument<DashboardDockerImageListComponent>> =
      [];

    args.push({
      name: "Title",
      description: "Header shown above the image list",
      required: false,
      type: ComponentInputType.Text,
      id: "title",
      section: DisplaySection,
    });

    args.push({
      name: "Max Rows",
      description: "Maximum number of images to show",
      required: false,
      type: ComponentInputType.Number,
      id: "maxRows",
      placeholder: "25",
      section: DisplaySection,
    });

    args.push({
      name: "Hosts",
      description: "Show only images from the selected hosts",
      required: false,
      type: ComponentInputType.EntityMultiSelectDropdown,
      id: "dockerHostIds",
      placeholder: "All hosts",
      section: FiltersSection,
      entityFilterModelType: EntityFilterModelType.DockerHost,
    });

    args.push({
      name: "Name Contains",
      description: "Show only images whose name contains this substring",
      required: false,
      type: ComponentInputType.Text,
      id: "nameSearch",
      placeholder: "nginx",
      section: FiltersSection,
    });

    return args;
  }
}
