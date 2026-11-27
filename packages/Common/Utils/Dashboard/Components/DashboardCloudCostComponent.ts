import DashboardCloudCostComponent from "../../../Types/Dashboard/DashboardComponents/DashboardCloudCostComponent";
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

/*
 * THE CLOUD COST WIDGET (#11009): what the clouds cost, beside the health
 * of the services that spend it - a total against the period before, a
 * breakdown, or each day's spend, over every account, one account, a cost
 * group or a cost view, for the dashboard's time range.
 */

// What the widget draws.
export enum CloudCostWidgetDisplay {
  Total = "total",
  Breakdown = "breakdown",
  Trend = "trend",
}

// What the widget is over.
export enum CloudCostWidgetScope {
  AllAccounts = "AllAccounts",
  Account = "Account",
  CostGroup = "CostGroup",
  CostView = "CostView",
}

// What a breakdown is by: a column of the costs, or a cost view's groups.
export enum CloudCostWidgetBreakdown {
  Service = "service",
  Region = "region",
  Account = "cloudAccountId",
  Resource = "resourceId",
}

const DataSourceSection: ComponentArgumentSection = {
  name: "Data Source",
  description: "What the widget is over: every account, one, a group or a view",
  order: 1,
};

const DisplaySection: ComponentArgumentSection = {
  name: "Display Options",
  description: "What the widget draws, and its heading",
  order: 2,
};

export default class DashboardCloudCostComponentUtil extends DashboardBaseComponentUtil {
  public static override getDefaultComponent(): DashboardCloudCostComponent {
    return {
      _type: ObjectType.DashboardComponent,
      componentType: DashboardComponentType.CloudCost,
      /*
       * A chart of each day, or a list of ten services with their bars,
       * half a board wide and four rows tall; a total fits in a quarter.
       */
      widthInDashboardUnits: 6,
      heightInDashboardUnits: 4,
      topInDashboardUnits: 0,
      leftInDashboardUnits: 0,
      componentId: ObjectID.generate(),
      minHeightInDashboardUnits: 2,
      minWidthInDashboardUnits: 3,
      arguments: {
        display: CloudCostWidgetDisplay.Trend,
        scope: CloudCostWidgetScope.AllAccounts,
      },
    };
  }

  public static override getComponentConfigArguments(): Array<
    ComponentArgument<DashboardCloudCostComponent>
  > {
    return [
      {
        name: "Covers",
        description:
          "Every account, one account, a cost group or a cost view. Public dashboards show only its title.",
        required: true,
        type: ComponentInputType.Dropdown,
        id: "scope",
        placeholder: "Every account",
        section: DataSourceSection,
        dropdownOptions: [
          { label: "Every account", value: CloudCostWidgetScope.AllAccounts },
          { label: "One account", value: CloudCostWidgetScope.Account },
          { label: "A cost group", value: CloudCostWidgetScope.CostGroup },
          { label: "A cost view", value: CloudCostWidgetScope.CostView },
        ],
      },
      {
        name: "Account",
        description: "The account, when the widget covers one.",
        required: false,
        type: ComponentInputType.EntityDropdown,
        id: "cloudAccountId",
        placeholder: "Select an account",
        section: DataSourceSection,
        entityFilterModelType: EntityFilterModelType.CloudAccount,
      },
      {
        name: "Cost Group",
        description: "The cost group, when the widget covers one.",
        required: false,
        type: ComponentInputType.EntityDropdown,
        id: "cloudCostGroupId",
        placeholder: "Select a cost group",
        section: DataSourceSection,
        entityFilterModelType: EntityFilterModelType.CloudCostGroup,
      },
      {
        name: "Cost View",
        description:
          "The cost view, when the widget covers one: its breakdown is by its groups.",
        required: false,
        type: ComponentInputType.EntityDropdown,
        id: "cloudCostViewId",
        placeholder: "Select a cost view",
        section: DataSourceSection,
        entityFilterModelType: EntityFilterModelType.CloudCostView,
      },
      {
        name: "Show",
        description:
          "Total against the period before, the biggest parts of the spend, or each day's spend.",
        required: true,
        type: ComponentInputType.Dropdown,
        id: "display",
        placeholder: "Trend",
        section: DisplaySection,
        dropdownOptions: [
          { label: "Total", value: CloudCostWidgetDisplay.Total },
          { label: "Breakdown", value: CloudCostWidgetDisplay.Breakdown },
          { label: "Trend", value: CloudCostWidgetDisplay.Trend },
        ],
      },
      {
        name: "Break Down By",
        description:
          "What a breakdown lists. A cost view's breakdown lists its groups.",
        required: false,
        type: ComponentInputType.Dropdown,
        id: "breakdownBy",
        placeholder: "Services",
        section: DisplaySection,
        dropdownOptions: [
          { label: "Services", value: CloudCostWidgetBreakdown.Service },
          { label: "Regions", value: CloudCostWidgetBreakdown.Region },
          { label: "Accounts", value: CloudCostWidgetBreakdown.Account },
          { label: "Resources", value: CloudCostWidgetBreakdown.Resource },
        ],
      },
      {
        name: "Cost Basis",
        description: "Billed, amortized or net. Empty: the project's.",
        required: false,
        type: ComponentInputType.Dropdown,
        id: "basis",
        placeholder: "The project's cost basis",
        section: DisplaySection,
        dropdownOptions: [
          { label: "Billed", value: "billed" },
          { label: "Amortized", value: "amortized" },
          { label: "Net", value: "net" },
        ],
      },
      {
        name: "Title",
        description:
          "Header shown above the widget. Defaults to what it covers.",
        required: false,
        type: ComponentInputType.Text,
        id: "title",
        section: DisplaySection,
      },
    ];
  }
}
