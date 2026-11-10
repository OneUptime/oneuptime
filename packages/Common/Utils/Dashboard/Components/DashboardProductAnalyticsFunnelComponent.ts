import DashboardProductAnalyticsFunnelComponent from "../../../Types/Dashboard/DashboardComponents/DashboardProductAnalyticsFunnelComponent";
import {
  ComponentArgument,
  ComponentArgumentSection,
  ComponentInputType,
  EntityFilterModelType,
} from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import DashboardBaseComponentUtil from "./DashboardBaseComponent";

const DataSourceSection: ComponentArgumentSection = {
  name: "Data Source",
  description: "Pick a funnel saved on a RUM application's Funnels page",
  order: 1,
};

const DisplaySection: ComponentArgumentSection = {
  name: "Display Options",
  description: "Configure the widget heading",
  order: 2,
};

/*
 * The Funnel widget (issue #6630): a saved funnel, read with the
 * dashboard's time range.
 */
export default class DashboardProductAnalyticsFunnelComponentUtil extends DashboardBaseComponentUtil {
  public static override getDefaultComponent(): DashboardProductAnalyticsFunnelComponent {
    return {
      _type: ObjectType.DashboardComponent,
      componentType: DashboardComponentType.ProductAnalyticsFunnel,
      /*
       * A bar a step, up to six, each with its name, its people and its
       * drop-off beside it: half a board wide and five rows tall.
       */
      widthInDashboardUnits: 6,
      heightInDashboardUnits: 5,
      topInDashboardUnits: 0,
      leftInDashboardUnits: 0,
      componentId: ObjectID.generate(),
      minHeightInDashboardUnits: 3,
      minWidthInDashboardUnits: 3,
      arguments: {},
    };
  }

  public static override getComponentConfigArguments(): Array<
    ComponentArgument<DashboardProductAnalyticsFunnelComponent>
  > {
    return [
      {
        name: "Saved Funnel",
        description:
          "The funnel this widget shows. Save one on a RUM application's Funnels page.",
        required: true,
        type: ComponentInputType.EntityDropdown,
        id: "savedViewId",
        placeholder: "Select a saved funnel",
        section: DataSourceSection,
        entityFilterModelType: EntityFilterModelType.ProductAnalyticsSavedFunnel,
      },
      {
        name: "Title",
        description:
          "Header shown above the funnel. Defaults to the saved funnel's name.",
        required: false,
        type: ComponentInputType.Text,
        id: "title",
        section: DisplaySection,
      },
    ];
  }
}
