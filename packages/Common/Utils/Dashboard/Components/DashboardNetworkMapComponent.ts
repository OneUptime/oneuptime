import DashboardNetworkMapComponent from "../../../Types/Dashboard/DashboardComponents/DashboardNetworkMapComponent";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import DashboardBaseComponentUtil from "./DashboardBaseComponent";
import {
  ComponentArgument,
  ComponentArgumentSection,
  ComponentInputType,
  EntityFilterModelType,
} from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";

const DisplaySection: ComponentArgumentSection = {
  name: "Display Options",
  description: "Configure the widget title, size of the map and its labels",
  order: 1,
};

const FiltersSection: ComponentArgumentSection = {
  name: "Filters",
  description: "Narrow down which network sites are drawn",
  order: 2,
  defaultCollapsed: true,
};

/*
 * A map is only readable while the markers on it can be told apart, and the
 * fetch is a plain list query — so the widget draws a bounded number of
 * sites rather than every row in the project. 250 comfortably covers a
 * franchise estate at the level a dashboard tile is read at, and the footer
 * says out loud when the cap dropped anything.
 */
export const DEFAULT_MAX_SITES: number = 250;

export default class DashboardNetworkMapComponentUtil extends DashboardBaseComponentUtil {
  public static override getDefaultComponent(): DashboardNetworkMapComponent {
    return {
      _type: ObjectType.DashboardComponent,
      componentType: DashboardComponentType.NetworkMap,
      /*
       * A map needs room in BOTH axes: the world is roughly 2:1, so a
       * short-and-wide tile letterboxes it into a strip. Half the grid
       * across and five rows down is the smallest shape that still reads
       * as a map rather than as a banner.
       */
      widthInDashboardUnits: 6,
      heightInDashboardUnits: 5,
      topInDashboardUnits: 0,
      leftInDashboardUnits: 0,
      componentId: ObjectID.generate(),
      minHeightInDashboardUnits: 4,
      minWidthInDashboardUnits: 4,
      arguments: {
        maxSites: DEFAULT_MAX_SITES,
        viewMode: "map",
        showLabels: true,
      },
    };
  }

  public static override getComponentConfigArguments(): Array<
    ComponentArgument<DashboardNetworkMapComponent>
  > {
    const args: Array<ComponentArgument<DashboardNetworkMapComponent>> = [];

    args.push({
      name: "Title",
      description: "Header shown above the map",
      required: false,
      type: ComponentInputType.Text,
      id: "title",
      section: DisplaySection,
    });

    args.push({
      name: "View Mode",
      description:
        "Draw the sites on a world map (default), or list them in a table.",
      required: false,
      type: ComponentInputType.Dropdown,
      id: "viewMode",
      section: DisplaySection,
      dropdownOptions: [
        { label: "Map", value: "map" },
        { label: "List", value: "list" },
      ],
    });

    args.push({
      name: "Max Sites",
      description: "Maximum number of network sites to draw",
      required: false,
      type: ComponentInputType.Number,
      id: "maxSites",
      placeholder: String(DEFAULT_MAX_SITES),
      section: DisplaySection,
    });

    args.push({
      name: "Show Site Names",
      description:
        "Print each site's name under its marker. Names come off automatically when the map gets too busy for them to be readable.",
      required: false,
      type: ComponentInputType.Boolean,
      id: "showLabels",
      section: DisplaySection,
    });

    args.push({
      name: "Site Types",
      description:
        "Only draw sites of these types — e.g. just the stores, or just the regional hubs.",
      required: false,
      type: ComponentInputType.EntityMultiSelectDropdown,
      id: "networkSiteTypeIds",
      section: FiltersSection,
      entityFilterModelType: EntityFilterModelType.NetworkSiteType,
    });

    args.push({
      name: "Status",
      description: "Quick filter by the status rolled up onto the site",
      required: false,
      type: ComponentInputType.Dropdown,
      id: "statusFilter",
      section: FiltersSection,
      dropdownOptions: [
        { label: "All", value: "" },
        { label: "Down only", value: "down" },
        { label: "Operational only", value: "operational" },
      ],
    });

    return args;
  }
}
