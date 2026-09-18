import DashboardDockerSwarmServiceListComponent from "../../../Types/Dashboard/DashboardComponents/DashboardDockerSwarmServiceListComponent";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import DashboardBaseComponentUtil from "./DashboardBaseComponent";
import {
  ComponentArgument,
  ComponentInputType,
} from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import {
  DockerSwarmFiltersSection,
  getDockerSwarmCommonArguments,
} from "./DashboardDockerSwarmResourceListShared";

export default class DashboardDockerSwarmServiceListComponentUtil extends DashboardBaseComponentUtil {
  public static override getDefaultComponent(): DashboardDockerSwarmServiceListComponent {
    return {
      _type: ObjectType.DashboardComponent,
      componentType: DashboardComponentType.DockerSwarmServiceList,
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
    ComponentArgument<DashboardDockerSwarmServiceListComponent>
  > {
    const args: Array<
      ComponentArgument<DashboardDockerSwarmServiceListComponent>
    > =
      getDockerSwarmCommonArguments<DashboardDockerSwarmServiceListComponent>();

    args.push({
      name: "Service Mode",
      description: "Show only replicated services or only global services",
      required: false,
      type: ComponentInputType.Dropdown,
      id: "serviceModeFilter",
      section: DockerSwarmFiltersSection,
      dropdownOptions: [
        { label: "All", value: "" },
        { label: "Replicated only", value: "replicated" },
        { label: "Global only", value: "global" },
      ],
    });

    args.push({
      name: "Status",
      description: "Quick filter by whether the service is fully converged",
      required: false,
      type: ComponentInputType.Dropdown,
      id: "statusFilter",
      section: DockerSwarmFiltersSection,
      dropdownOptions: [
        { label: "All", value: "" },
        { label: "Converged only", value: "converged" },
        { label: "Not converged only", value: "notconverged" },
      ],
    });

    return args;
  }
}
