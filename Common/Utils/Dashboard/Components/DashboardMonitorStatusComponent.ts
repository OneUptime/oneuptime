import DashboardMonitorStatusComponent from "../../../Types/Dashboard/DashboardComponents/DashboardMonitorStatusComponent";
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
  description: "Configure the panel title, layout, and row limit",
  order: 1,
};

const FiltersSection: ComponentArgumentSection = {
  name: "Filters",
  description: "Narrow which monitors are shown",
  order: 2,
  defaultCollapsed: true,
};

export default class DashboardMonitorStatusComponentUtil extends DashboardBaseComponentUtil {
  public static override getDefaultComponent(): DashboardMonitorStatusComponent {
    return {
      _type: ObjectType.DashboardComponent,
      componentType: DashboardComponentType.MonitorStatus,
      widthInDashboardUnits: 6,
      heightInDashboardUnits: 3,
      topInDashboardUnits: 0,
      leftInDashboardUnits: 0,
      componentId: ObjectID.generate(),
      minHeightInDashboardUnits: 2,
      minWidthInDashboardUnits: 3,
      arguments: {
        layout: "grid",
        maxRows: 24,
      },
    };
  }

  public static override getComponentConfigArguments(): Array<
    ComponentArgument<DashboardMonitorStatusComponent>
  > {
    const componentArguments: Array<
      ComponentArgument<DashboardMonitorStatusComponent>
    > = [];

    componentArguments.push({
      name: "Title",
      description: "Header shown above the status panel",
      required: false,
      type: ComponentInputType.Text,
      id: "title",
      section: DisplaySection,
    });

    componentArguments.push({
      name: "Layout",
      description: "Grid (LED tiles) or list (one row per monitor)",
      required: false,
      type: ComponentInputType.Dropdown,
      id: "layout",
      section: DisplaySection,
      dropdownOptions: [
        { label: "Grid", value: "grid" },
        { label: "List", value: "list" },
      ],
    });

    componentArguments.push({
      name: "Max Monitors",
      description: "Maximum number of monitors to show",
      required: false,
      type: ComponentInputType.Number,
      id: "maxRows",
      placeholder: "24",
      section: DisplaySection,
    });

    componentArguments.push({
      name: "Name Contains",
      description: "Substring filter on monitor name",
      required: false,
      type: ComponentInputType.Text,
      id: "nameContains",
      placeholder: "checkout-",
      section: FiltersSection,
    });

    componentArguments.push({
      name: "Label Names",
      description:
        "Comma-separated label names. Monitor must carry one of them.",
      required: false,
      type: ComponentInputType.Text,
      id: "labelFilter",
      placeholder: "production, payments",
      section: FiltersSection,
    });

    return componentArguments;
  }
}
