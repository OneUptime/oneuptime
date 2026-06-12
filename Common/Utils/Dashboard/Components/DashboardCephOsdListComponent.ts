import DashboardCephOsdListComponent from "../../../Types/Dashboard/DashboardComponents/DashboardCephOsdListComponent";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import DashboardBaseComponentUtil from "./DashboardBaseComponent";
import {
  ComponentArgument,
  ComponentInputType,
} from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import {
  CephFiltersSection,
  getCephCommonArguments,
} from "./DashboardCephResourceListShared";

export default class DashboardCephOsdListComponentUtil extends DashboardBaseComponentUtil {
  public static override getDefaultComponent(): DashboardCephOsdListComponent {
    return {
      _type: ObjectType.DashboardComponent,
      componentType: DashboardComponentType.CephOsdList,
      widthInDashboardUnits: 6,
      heightInDashboardUnits: 4,
      topInDashboardUnits: 0,
      leftInDashboardUnits: 0,
      componentId: ObjectID.generate(),
      minHeightInDashboardUnits: 3,
      minWidthInDashboardUnits: 6,
      arguments: {
        maxRows: 25,
        /*
         * The classic "OSD wall" — a honeycomb where each cell is an
         * OSD colored by up/in state — is the view operators expect
         * for this widget, so honeycomb is the default. The list view
         * stays one dropdown away.
         */
        viewMode: "honeycomb",
      },
    };
  }

  public static override getComponentConfigArguments(): Array<
    ComponentArgument<DashboardCephOsdListComponent>
  > {
    const args: Array<ComponentArgument<DashboardCephOsdListComponent>> =
      getCephCommonArguments<DashboardCephOsdListComponent>();

    args.push({
      name: "State",
      description: "Quick filter by OSD up/in state",
      required: false,
      type: ComponentInputType.Dropdown,
      id: "stateFilter",
      section: CephFiltersSection,
      dropdownOptions: [
        { label: "All", value: "" },
        { label: "Up only", value: "up" },
        { label: "Down only", value: "down" },
        { label: "Out only", value: "out" },
      ],
    });

    return args;
  }
}
