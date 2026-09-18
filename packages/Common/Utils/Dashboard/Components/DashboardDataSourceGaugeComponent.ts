import DashboardDataSourceGaugeComponent from "../../../Types/Dashboard/DashboardComponents/DashboardDataSourceGaugeComponent";
import { DataSourceValueReduce } from "../../../Types/Dashboard/DashboardComponents/DashboardDataSourceValueComponent";
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
  description: "Customize the gauge range and appearance",
  order: 1,
};

const ThresholdsSection: ComponentArgumentSection = {
  name: "Thresholds",
  description: "Set warning and critical levels",
  order: 2,
  defaultCollapsed: true,
};

export default class DashboardDataSourceGaugeComponentUtil extends DashboardBaseComponentUtil {
  public static override getDefaultComponent(): DashboardDataSourceGaugeComponent {
    return {
      _type: ObjectType.DashboardComponent,
      componentType: DashboardComponentType.DataSourceGauge,
      widthInDashboardUnits: 3,
      heightInDashboardUnits: 3,
      topInDashboardUnits: 0,
      leftInDashboardUnits: 0,
      componentId: ObjectID.generate(),
      minHeightInDashboardUnits: 2,
      minWidthInDashboardUnits: 2,
      arguments: {
        query: {
          id: ObjectID.generate().toString(),
          dataSourceId: "",
          query: "",
        },
        reduce: DataSourceValueReduce.Last,
        minValue: 0,
        maxValue: 100,
      },
    };
  }

  public static override getComponentConfigArguments(): Array<
    ComponentArgument<DashboardDataSourceGaugeComponent>
  > {
    return [
      {
        name: "Title",
        description: "Label shown above the gauge",
        required: false,
        type: ComponentInputType.Text,
        id: "gaugeTitle",
        section: DisplaySection,
      },
      {
        name: "Reduce",
        description:
          "How the points returned across the dashboard's time range collapse into the single number the needle points at",
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
          'Suffix rendered after the centre value and on the min/max labels. Known units also scale it — "Bytes" reads as 1.5 MB, "ms" as 2.4 sec, "%" as 99.9%.',
        required: false,
        type: ComponentInputType.Text,
        id: "unit",
        placeholder: "e.g. %, ms, Bytes",
        section: DisplaySection,
      },
      {
        name: "Min Value",
        description: "Left end of the gauge scale",
        required: false,
        type: ComponentInputType.Number,
        id: "minValue",
        placeholder: "0",
        section: DisplaySection,
      },
      {
        name: "Max Value",
        description: "Right end of the gauge scale",
        required: false,
        type: ComponentInputType.Number,
        id: "maxValue",
        placeholder: "100",
        section: DisplaySection,
      },
      {
        name: "Warning Threshold",
        description: "Yellow zone starts at this value",
        required: false,
        type: ComponentInputType.Number,
        id: "warningThreshold",
        isAdvanced: true,
        section: ThresholdsSection,
      },
      {
        name: "Critical Threshold",
        description: "Red zone starts at this value",
        required: false,
        type: ComponentInputType.Number,
        id: "criticalThreshold",
        isAdvanced: true,
        section: ThresholdsSection,
      },
    ];
  }
}
