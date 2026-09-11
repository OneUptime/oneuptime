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
import DashboardBaseComponentUtil from "./DashboardBaseComponent";

const DisplaySection: ComponentArgumentSection = {
  name: "Display Options",
  description: "Configure the widget title and row limit",
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
      widthInDashboardUnits: 12,
      heightInDashboardUnits: 6,
      topInDashboardUnits: 0,
      leftInDashboardUnits: 0,
      componentId: ObjectID.generate(),
      minHeightInDashboardUnits: 3,
      minWidthInDashboardUnits: 6,
      arguments: {
        maxRows: 50,
      },
    };
  }

  public static override getComponentConfigArguments(): Array<
    ComponentArgument<DashboardSloListComponent>
  > {
    return [
      {
        name: "Title",
        description:
          "Header shown above the SLO list. Use {{UNIT}} to show a dashboard variable's selected label; configure Label Variable separately to filter SLOs.",
        required: false,
        type: ComponentInputType.Text,
        id: "title",
        section: DisplaySection,
      },
      {
        name: "Max Rows",
        description: "Maximum number of SLOs to show",
        required: false,
        type: ComponentInputType.Number,
        id: "maxRows",
        placeholder: "50",
        section: DisplaySection,
      },
      {
        name: "SLO Status",
        description: "Show only SLOs with the selected statuses",
        required: false,
        type: ComponentInputType.MultiSelectDropdown,
        id: "sloStatuses",
        placeholder: "All statuses",
        section: FiltersSection,
        dropdownOptions: Object.values(SloStatus).map((status: SloStatus) => {
          return { label: status, value: status };
        }),
      },
      {
        name: "Monitors",
        description: "Show only SLOs linked to the selected monitors",
        required: false,
        type: ComponentInputType.EntityMultiSelectDropdown,
        id: "monitorIds",
        placeholder: "All monitors",
        section: FiltersSection,
        entityFilterModelType: EntityFilterModelType.Monitor,
      },
      {
        name: "Labels",
        description: "Show only SLOs tagged with the selected labels",
        required: false,
        type: ComponentInputType.EntityMultiSelectDropdown,
        id: "labelIds",
        placeholder: "All labels",
        section: FiltersSection,
        entityFilterModelType: EntityFilterModelType.Label,
      },
      {
        name: "Label Variable",
        description:
          "Filter SLOs using a Project Labels dashboard variable. This is combined with the fixed filters above. All removes only the variable filter.",
        required: false,
        type: ComponentInputType.ProjectLabelVariable,
        id: "labelVariableId",
        section: FiltersSection,
      },
    ];
  }
}
