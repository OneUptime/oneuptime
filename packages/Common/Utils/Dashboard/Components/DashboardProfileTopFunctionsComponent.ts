import DashboardProfileTopFunctionsComponent from "../../../Types/Dashboard/DashboardComponents/DashboardProfileTopFunctionsComponent";
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
  PROFILE_WIDGET_DEFAULT_RANK,
  PROFILE_WIDGET_DEFAULT_ROWS,
  PROFILE_WIDGET_DISPLAY_SECTION,
  PROFILE_WIDGET_KIND_DESCRIPTION,
  PROFILE_WIDGET_KIND_NAME,
  PROFILE_WIDGET_KIND_OPTIONS,
  PROFILE_WIDGET_RANK_DESCRIPTION,
  PROFILE_WIDGET_RANK_NAME,
  PROFILE_WIDGET_RANK_OPTIONS,
  PROFILE_WIDGET_ROWS_DESCRIPTION,
  PROFILE_WIDGET_ROWS_NAME,
  PROFILE_WIDGET_SERVICE_DESCRIPTION,
  PROFILE_WIDGET_SERVICE_NAME,
  PROFILE_WIDGET_TITLE_DESCRIPTION,
  PROFILE_WIDGET_TITLE_NAME,
} from "./DashboardProfileWidgetShared";

export default class DashboardProfileTopFunctionsComponentUtil extends DashboardBaseComponentUtil {
  public static override getDefaultComponent(): DashboardProfileTopFunctionsComponent {
    return {
      _type: ObjectType.DashboardComponent,
      componentType: DashboardComponentType.ProfileTopFunctions,
      /*
       * Ten functions under the header, each its name, its file and its
       * share's bar: half the board's width keeps a long function name
       * whole beside its share, and pairs it with a chart of the same
       * service on the other half.
       */
      widthInDashboardUnits: 6,
      heightInDashboardUnits: 6,
      topInDashboardUnits: 0,
      leftInDashboardUnits: 0,
      componentId: ObjectID.generate(),
      minHeightInDashboardUnits: 3,
      minWidthInDashboardUnits: 4,
      arguments: {
        profileKind: PROFILE_WIDGET_DEFAULT_KIND,
        rankBy: PROFILE_WIDGET_DEFAULT_RANK,
        maxRows: PROFILE_WIDGET_DEFAULT_ROWS,
      },
    };
  }

  public static override getComponentConfigArguments(): Array<
    ComponentArgument<DashboardProfileTopFunctionsComponent>
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
        name: PROFILE_WIDGET_RANK_NAME,
        description: PROFILE_WIDGET_RANK_DESCRIPTION,
        required: true,
        type: ComponentInputType.Dropdown,
        id: "rankBy",
        section: PROFILE_WIDGET_DATA_SECTION,
        dropdownOptions: [...PROFILE_WIDGET_RANK_OPTIONS],
      },
      {
        name: PROFILE_WIDGET_ROWS_NAME,
        description: PROFILE_WIDGET_ROWS_DESCRIPTION,
        required: false,
        type: ComponentInputType.Number,
        id: "maxRows",
        placeholder: String(PROFILE_WIDGET_DEFAULT_ROWS),
        section: PROFILE_WIDGET_DATA_SECTION,
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
