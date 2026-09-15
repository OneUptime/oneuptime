import {
  ComponentArgument,
  ComponentArgumentSection,
  ComponentInputType,
  EntityFilterModelType,
} from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardSloListComponent from "../../../Types/Dashboard/DashboardComponents/DashboardSloListComponent";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import SloStatus from "../../../Types/ServiceLevelObjective/SloStatus";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import {
  SLO_LIST_DEFAULT_MAX_ROWS,
  SLO_LIST_STATUS_FILTER_VALUES,
} from "../../Slo/SloListWidgetFormat";
import DashboardBaseComponentUtil from "./DashboardBaseComponent";
import { getViewModeArgument } from "./DashboardListSharedArgs";

const DisplaySection: ComponentArgumentSection = {
  name: "Display Options",
  description: "Configure the widget title, row limit and view",
  order: 1,
};

const FiltersSection: ComponentArgumentSection = {
  name: "Filters",
  description: "Narrow down which SLOs are shown",
  order: 2,
  defaultCollapsed: true,
};

export default class DashboardSloListComponentUtil extends DashboardBaseComponentUtil {
  public static override getDefaultComponent(): DashboardSloListComponent {
    return {
      _type: ObjectType.DashboardComponent,
      componentType: DashboardComponentType.SloList,
      /*
       * Wider than the other list widgets' 6 units: every row carries five
       * columns — name, status, SLI against target, the error-budget bar and
       * the burn rate — and the budget bar needs room to be read as a bar.
       */
      widthInDashboardUnits: 8,
      heightInDashboardUnits: 5,
      topInDashboardUnits: 0,
      leftInDashboardUnits: 0,
      componentId: ObjectID.generate(),
      minHeightInDashboardUnits: 3,
      minWidthInDashboardUnits: 6,
      arguments: {
        maxRows: SLO_LIST_DEFAULT_MAX_ROWS,
      },
    };
  }

  public static override getComponentConfigArguments(): Array<
    ComponentArgument<DashboardSloListComponent>
  > {
    const componentArguments: Array<
      ComponentArgument<DashboardSloListComponent>
    > = [];

    componentArguments.push({
      name: "Title",
      description: "Header shown above the SLO list",
      required: false,
      type: ComponentInputType.Text,
      id: "title",
      section: DisplaySection,
    });

    componentArguments.push({
      name: "Max Rows",
      description:
        "Maximum number of SLOs to show. Enabled SLOs come first, ordered by least error budget remaining, so the SLOs cut off are disabled ones first, then the healthiest.",
      required: false,
      type: ComponentInputType.Number,
      id: "maxRows",
      placeholder: String(SLO_LIST_DEFAULT_MAX_ROWS),
      section: DisplaySection,
    });

    componentArguments.push(
      getViewModeArgument<DashboardSloListComponent>(DisplaySection),
    );

    componentArguments.push({
      name: "Status",
      description:
        "Show only enabled SLOs in the selected statuses. Leave empty to show every SLO, including disabled ones and ones not evaluated yet.",
      required: false,
      type: ComponentInputType.MultiSelectDropdown,
      id: "sloStatuses",
      placeholder: "All statuses",
      section: FiltersSection,
      dropdownOptions: SLO_LIST_STATUS_FILTER_VALUES.map(
        (status: SloStatus): DropdownOption => {
          return { label: status, value: status };
        },
      ),
    });

    componentArguments.push({
      name: "Labels",
      description: "Show only SLOs tagged with the selected labels",
      required: false,
      type: ComponentInputType.EntityMultiSelectDropdown,
      id: "labelIds",
      placeholder: "All labels",
      section: FiltersSection,
      entityFilterModelType: EntityFilterModelType.Label,
    });

    componentArguments.push({
      name: "Label Variable",
      description:
        "Filter SLOs using a Project Labels dashboard variable. This is combined with the fixed filters above. All removes only the variable filter.",
      required: false,
      type: ComponentInputType.ProjectLabelVariable,
      id: "labelVariableId",
      section: FiltersSection,
    });

    return componentArguments;
  }
}
