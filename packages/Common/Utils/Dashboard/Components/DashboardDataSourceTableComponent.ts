import DashboardDataSourceTableComponent from "../../../Types/Dashboard/DashboardComponents/DashboardDataSourceTableComponent";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import DashboardBaseComponentUtil from "./DashboardBaseComponent";
import {
  ComponentArgument,
  ComponentArgumentSection,
  ComponentInputType,
} from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";

const DisplaySection: ComponentArgumentSection = {
  name: "Display Options",
  description: "Customize how the returned rows render",
  order: 1,
};

export default class DashboardDataSourceTableComponentUtil extends DashboardBaseComponentUtil {
  public static override getDefaultComponent(): DashboardDataSourceTableComponent {
    return {
      _type: ObjectType.DashboardComponent,
      componentType: DashboardComponentType.DataSourceTable,
      widthInDashboardUnits: 6,
      heightInDashboardUnits: 4,
      topInDashboardUnits: 0,
      leftInDashboardUnits: 0,
      componentId: ObjectID.generate(),
      minHeightInDashboardUnits: 3,
      minWidthInDashboardUnits: 4,
      arguments: {
        query: {
          id: ObjectID.generate().toString(),
          dataSourceId: "",
          query: "",
        },
      },
    };
  }

  public static override getComponentConfigArguments(): Array<
    ComponentArgument<DashboardDataSourceTableComponent>
  > {
    return [
      {
        name: "Title",
        description: "Header shown above the table",
        required: false,
        type: ComponentInputType.Text,
        id: "tableTitle",
        section: DisplaySection,
      },
      {
        name: "Description",
        description: "Subtitle shown below the title",
        required: false,
        type: ComponentInputType.LongText,
        id: "tableDescription",
        section: DisplaySection,
      },
      {
        name: "Max Rows",
        description:
          "Only render this many rows, applied after sorting. Leave empty to render every row the query returns.",
        required: false,
        type: ComponentInputType.Number,
        id: "maxRows",
        placeholder: "All rows",
        section: DisplaySection,
      },
    ];
  }
}
