import {
  ComponentArgument,
  ComponentArgumentSection,
  ComponentInputType,
  EntityFilterModelType,
} from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardSloComponent, {
  SloWidgetDisplayType,
  SloWidgetMetric,
} from "../../../Types/Dashboard/DashboardComponents/DashboardSloComponent";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import DashboardBaseComponentUtil from "./DashboardBaseComponent";

const DataSourceSection: ComponentArgumentSection = {
  name: "Data Source",
  description: "Pick the SLO and which of its numbers to show",
  order: 1,
};

const DisplaySection: ComponentArgumentSection = {
  name: "Display Options",
  description: "Choose between a single value and a trend chart",
  order: 2,
};

export default class DashboardSloComponentUtil extends DashboardBaseComponentUtil {
  public static override getDefaultComponent(): DashboardSloComponent {
    return {
      _type: ObjectType.DashboardComponent,
      componentType: DashboardComponentType.Slo,
      /*
       * Same footprint as the Gauge — the Tile default is a single big
       * number, and a 3x3 tile still leaves room for the status pill and
       * the target/budget subline once the widget is switched to Chart.
       */
      widthInDashboardUnits: 3,
      heightInDashboardUnits: 3,
      topInDashboardUnits: 0,
      leftInDashboardUnits: 0,
      componentId: ObjectID.generate(),
      minHeightInDashboardUnits: 2,
      minWidthInDashboardUnits: 2,
      arguments: {
        sloMetric: SloWidgetMetric.Sli,
        displayType: SloWidgetDisplayType.Tile,
      },
    };
  }

  public static override getComponentConfigArguments(): Array<
    ComponentArgument<DashboardSloComponent>
  > {
    const componentArguments: Array<ComponentArgument<DashboardSloComponent>> =
      [];

    componentArguments.push({
      name: "Service Level Objective",
      description: "The SLO this widget reports on",
      required: true,
      type: ComponentInputType.EntityDropdown,
      id: "serviceLevelObjectiveId",
      placeholder: "Select an SLO",
      section: DataSourceSection,
      entityFilterModelType: EntityFilterModelType.ServiceLevelObjective,
    });

    componentArguments.push({
      name: "Metric",
      description: "Which of the SLO's tracked numbers to show",
      required: true,
      type: ComponentInputType.Dropdown,
      id: "sloMetric",
      placeholder: "SLI",
      section: DataSourceSection,
      dropdownOptions: [
        { label: "SLI (Service Level Indicator)", value: SloWidgetMetric.Sli },
        {
          label: "Error Budget Remaining",
          value: SloWidgetMetric.ErrorBudgetRemaining,
        },
        { label: "Burn Rate", value: SloWidgetMetric.BurnRate },
      ],
    });

    componentArguments.push({
      name: "Display As",
      description:
        "Tile shows the current value. Chart shows the trend over the dashboard's time range.",
      required: true,
      type: ComponentInputType.Dropdown,
      id: "displayType",
      placeholder: "Tile",
      section: DisplaySection,
      dropdownOptions: [
        { label: "Tile", value: SloWidgetDisplayType.Tile },
        { label: "Chart", value: SloWidgetDisplayType.Chart },
      ],
    });

    componentArguments.push({
      name: "Title",
      description:
        "Header shown above the widget. Defaults to the SLO name and metric.",
      required: false,
      type: ComponentInputType.Text,
      id: "widgetTitle",
      section: DisplaySection,
    });

    return componentArguments;
  }
}
