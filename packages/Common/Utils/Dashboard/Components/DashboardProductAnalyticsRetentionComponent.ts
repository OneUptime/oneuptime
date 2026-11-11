import DashboardProductAnalyticsRetentionComponent from "../../../Types/Dashboard/DashboardComponents/DashboardProductAnalyticsRetentionComponent";
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
  description:
    "Pick a retention table saved on a RUM application's User Retention page",
  order: 1,
};

const DisplaySection: ComponentArgumentSection = {
  name: "Display Options",
  description: "Configure the widget heading",
  order: 2,
};

/*
 * The Retention widget (issue #6630): a saved retention table, read with
 * the dashboard's time range.
 */
export default class DashboardProductAnalyticsRetentionComponentUtil extends DashboardBaseComponentUtil {
  public static override getDefaultComponent(): DashboardProductAnalyticsRetentionComponent {
    return {
      _type: ObjectType.DashboardComponent,
      componentType: DashboardComponentType.ProductAnalyticsRetention,
      /*
       * A row a cohort and a column a period, a month's weeks or a
       * quarter's: wide, and tall enough for All cohorts and five cohorts
       * before it scrolls.
       */
      widthInDashboardUnits: 8,
      heightInDashboardUnits: 5,
      topInDashboardUnits: 0,
      leftInDashboardUnits: 0,
      componentId: ObjectID.generate(),
      minHeightInDashboardUnits: 3,
      minWidthInDashboardUnits: 4,
      arguments: {},
    };
  }

  public static override getComponentConfigArguments(): Array<
    ComponentArgument<DashboardProductAnalyticsRetentionComponent>
  > {
    return [
      {
        name: "Saved Retention Table",
        description:
          "The retention table this widget shows. Save one on a RUM application's User Retention page.",
        required: true,
        type: ComponentInputType.EntityDropdown,
        id: "savedViewId",
        placeholder: "Select a saved retention table",
        section: DataSourceSection,
        entityFilterModelType:
          EntityFilterModelType.ProductAnalyticsSavedRetention,
      },
      {
        name: "Title",
        description:
          "Header shown above the table. Defaults to the saved table's name.",
        required: false,
        type: ComponentInputType.Text,
        id: "title",
        section: DisplaySection,
      },
    ];
  }
}
