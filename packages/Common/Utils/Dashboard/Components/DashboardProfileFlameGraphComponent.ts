import DashboardProfileFlameGraphComponent from "../../../Types/Dashboard/DashboardComponents/DashboardProfileFlameGraphComponent";
import {
  ComponentArgument,
  ComponentInputType,
} from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import DashboardBaseComponentUtil from "./DashboardBaseComponent";
import {
  PROFILE_WIDGET_DATA_SECTION,
  PROFILE_WIDGET_DEFAULT_KIND,
  PROFILE_WIDGET_DISPLAY_SECTION,
  PROFILE_WIDGET_KIND_DESCRIPTION,
  PROFILE_WIDGET_KIND_NAME,
  PROFILE_WIDGET_KIND_OPTIONS,
  PROFILE_WIDGET_SERVICE_DESCRIPTION,
  PROFILE_WIDGET_SERVICE_NAME,
  PROFILE_WIDGET_TITLE_DESCRIPTION,
  PROFILE_WIDGET_TITLE_NAME,
} from "./DashboardProfileWidgetShared";

export default class DashboardProfileFlameGraphComponentUtil extends DashboardBaseComponentUtil {
  public static override getDefaultComponent(): DashboardProfileFlameGraphComponent {
    return {
      _type: ObjectType.DashboardComponent,
      componentType: DashboardComponentType.ProfileFlameGraph,
      /*
       * A flame graph reads across: the whole width of the board keeps a
       * function's name readable two or three levels down, and four rows
       * hold some fifteen frames of stack before it scrolls.
       */
      widthInDashboardUnits: 12,
      heightInDashboardUnits: 4,
      topInDashboardUnits: 0,
      leftInDashboardUnits: 0,
      componentId: ObjectID.generate(),
      minHeightInDashboardUnits: 3,
      minWidthInDashboardUnits: 6,
      arguments: {
        profileKind: PROFILE_WIDGET_DEFAULT_KIND,
      },
    };
  }

  public static override getComponentConfigArguments(): Array<
    ComponentArgument<DashboardProfileFlameGraphComponent>
  > {
    return [
      {
        name: PROFILE_WIDGET_SERVICE_NAME,
        description: PROFILE_WIDGET_SERVICE_DESCRIPTION,
        required: false,
        type: ComponentInputType.ProfiledService,
        id: "serviceId",
        section: PROFILE_WIDGET_DATA_SECTION,
      },
      {
        name: PROFILE_WIDGET_KIND_NAME,
        description: PROFILE_WIDGET_KIND_DESCRIPTION,
        required: true,
        type: ComponentInputType.Dropdown,
        id: "profileKind",
        section: PROFILE_WIDGET_DATA_SECTION,
        dropdownOptions: [...PROFILE_WIDGET_KIND_OPTIONS],
      },
      {
        name: PROFILE_WIDGET_TITLE_NAME,
        description: PROFILE_WIDGET_TITLE_DESCRIPTION,
        required: false,
        type: ComponentInputType.Text,
        id: "title",
        section: PROFILE_WIDGET_DISPLAY_SECTION,
      },
    ];
  }
}
