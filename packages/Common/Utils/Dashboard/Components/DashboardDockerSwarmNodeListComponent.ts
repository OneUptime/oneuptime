import DashboardDockerSwarmNodeListComponent from "../../../Types/Dashboard/DashboardComponents/DashboardDockerSwarmNodeListComponent";
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

export default class DashboardDockerSwarmNodeListComponentUtil extends DashboardBaseComponentUtil {
  public static override getDefaultComponent(): DashboardDockerSwarmNodeListComponent {
    return {
      _type: ObjectType.DashboardComponent,
      componentType: DashboardComponentType.DockerSwarmNodeList,
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
    ComponentArgument<DashboardDockerSwarmNodeListComponent>
  > {
    const args: Array<
      ComponentArgument<DashboardDockerSwarmNodeListComponent>
    > = getDockerSwarmCommonArguments<DashboardDockerSwarmNodeListComponent>();

    args.push({
      name: "Role",
      description: "Show only manager nodes or only worker nodes",
      required: false,
      type: ComponentInputType.Dropdown,
      id: "roleFilter",
      section: DockerSwarmFiltersSection,
      dropdownOptions: [
        { label: "All", value: "" },
        { label: "Managers only", value: "manager" },
        { label: "Workers only", value: "worker" },
      ],
    });

    args.push({
      name: "Status",
      description: "Quick filter by node readiness",
      required: false,
      type: ComponentInputType.Dropdown,
      id: "statusFilter",
      section: DockerSwarmFiltersSection,
      dropdownOptions: [
        { label: "All", value: "" },
        { label: "Ready only", value: "ready" },
        { label: "Not ready only", value: "notready" },
      ],
    });

    return args;
  }
}
