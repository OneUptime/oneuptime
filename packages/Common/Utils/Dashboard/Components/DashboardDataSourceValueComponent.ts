import DashboardDataSourceValueComponent, {
  DataSourceValueReduce,
} from "../../../Types/Dashboard/DashboardComponents/DashboardDataSourceValueComponent";
import { DashboardValueTrendDirection } from "../../../Types/Dashboard/DashboardComponents/DashboardValueComponent";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import DashboardBaseComponentUtil from "./DashboardBaseComponent";
import {
  ComponentArgument,
  ComponentArgumentSection,
  ComponentInputType,
} from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import { DATA_SOURCE_REDUCE_DROPDOWN_OPTIONS } from "./DashboardDataSourceShared";

const DisplaySection: ComponentArgumentSection = {
  name: "Display Options",
  description: "Title, unit, and how the returned points reduce to one number",
  order: 1,
};

const ThresholdsSection: ComponentArgumentSection = {
  name: "Thresholds",
  description: "Set warning and critical levels",
  order: 2,
  defaultCollapsed: true,
};

export default class DashboardDataSourceValueComponentUtil extends DashboardBaseComponentUtil {
  public static override getDefaultComponent(): DashboardDataSourceValueComponent {
    return {
      _type: ObjectType.DashboardComponent,
      componentType: DashboardComponentType.DataSourceValue,
      widthInDashboardUnits: 3,
      heightInDashboardUnits: 1,
      topInDashboardUnits: 0,
      leftInDashboardUnits: 0,
      componentId: ObjectID.generate(),
      minHeightInDashboardUnits: 1,
      minWidthInDashboardUnits: 1,
      arguments: {
        title: "",
        query: {
          id: ObjectID.generate().toString(),
          dataSourceId: "",
          query: "",
        },
        reduce: DataSourceValueReduce.Last,
      },
    };
  }

  public static override getComponentConfigArguments(): Array<
    ComponentArgument<DashboardDataSourceValueComponent>
  > {
    return [
      {
        name: "Title",
        description: "Label shown above the value",
        required: false,
        type: ComponentInputType.Text,
        id: "title",
        section: DisplaySection,
      },
      {
        name: "Reduce",
        description:
          "How the points returned across the dashboard's time range collapse into the single number shown",
        required: false,
        type: ComponentInputType.Dropdown,
        id: "reduce",
        placeholder: DataSourceValueReduce.Last,
        section: DisplaySection,
        dropdownOptions: DATA_SOURCE_REDUCE_DROPDOWN_OPTIONS,
      },
      {
        name: "Unit",
        description:
          'Suffix rendered after the number. Known units also scale it — "Bytes" reads as 1.5 MB, "ms" as 2.4 sec, "%" as 99.9%. Leave empty for a bare number.',
        required: false,
        type: ComponentInputType.Text,
        id: "unit",
        placeholder: "e.g. %, ms, Bytes, requests",
        section: DisplaySection,
      },
      {
        name: "Trend Direction",
        description:
          "How the trend arrow is coloured. Higher is better paints a rise green; higher is worse paints it red.",
        required: false,
        type: ComponentInputType.Dropdown,
        id: "trendDirection",
        isAdvanced: true,
        section: DisplaySection,
        dropdownOptions: [
          {
            label: "Higher is better (↑ green)",
            value: DashboardValueTrendDirection.HigherIsBetter,
          },
          {
            label: "Higher is worse (↑ red)",
            value: DashboardValueTrendDirection.HigherIsWorse,
          },
        ],
      },
      {
        name: "Warning Threshold",
        description: "Yellow background when value exceeds this",
        required: false,
        type: ComponentInputType.Number,
        id: "warningThreshold",
        isAdvanced: true,
        section: ThresholdsSection,
      },
      {
        name: "Critical Threshold",
        description: "Red background when value exceeds this",
        required: false,
        type: ComponentInputType.Number,
        id: "criticalThreshold",
        isAdvanced: true,
        section: ThresholdsSection,
      },
    ];
  }
}
