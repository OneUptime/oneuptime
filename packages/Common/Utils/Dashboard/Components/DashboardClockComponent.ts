import {
  ComponentArgument,
  ComponentArgumentSection,
  ComponentInputType,
} from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardClockComponent, {
  ClockWidgetFace,
  ClockWidgetHourFormat,
} from "../../../Types/Dashboard/DashboardComponents/DashboardClockComponent";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import TimezoneUtil from "../../../UI/Utils/Timezone";
import DashboardBaseComponentUtil from "./DashboardBaseComponent";

const ClockSection: ComponentArgumentSection = {
  name: "Clock",
  description: "Which timezone this clock shows",
  order: 1,
};

const DisplaySection: ComponentArgumentSection = {
  name: "Display Options",
  description: "Face, time format, and what to show alongside the time",
  order: 2,
  defaultCollapsed: true,
};

/*
 * Built once and reused. ArgumentsForm calls getComponentSettingsArguments on
 * every render — i.e. on every keystroke in the settings panel — and building
 * this list sorts ~400 zones with two moment.tz() calls per comparison, which
 * is more than enough to make typing in the panel feel laggy. The catalogue of
 * zones does not change while the tab is open.
 */
let cachedTimezoneOptions: Array<DropdownOption> | null = null;

type GetTimezoneOptionsFunction = () => Array<DropdownOption>;

const getTimezoneOptions: GetTimezoneOptionsFunction =
  (): Array<DropdownOption> => {
    if (!cachedTimezoneOptions) {
      cachedTimezoneOptions = TimezoneUtil.getTimezoneDropdownOptions();
    }

    return cachedTimezoneOptions;
  };

export default class DashboardClockComponentUtil extends DashboardBaseComponentUtil {
  public static override getDefaultComponent(): DashboardClockComponent {
    return {
      _type: ObjectType.DashboardComponent,
      componentType: DashboardComponentType.Clock,
      /*
       * Same footprint as the Gauge and SLO tiles, so a row of clocks lines
       * up with the other single-value widgets. 3x3 is also the smallest
       * square that fits a legible analog face plus its caption.
       */
      widthInDashboardUnits: 3,
      heightInDashboardUnits: 3,
      topInDashboardUnits: 0,
      leftInDashboardUnits: 0,
      componentId: ObjectID.generate(),
      minHeightInDashboardUnits: 1,
      minWidthInDashboardUnits: 2,
      arguments: {
        /*
         * Empty timezone means "wherever the viewer is". A clock dropped on
         * a dashboard is immediately correct and useful before it is
         * configured at all, which is not true if we guessed a city.
         */
        timezone: "",
        label: "",
        clockFace: ClockWidgetFace.Digital,
        hourFormat: ClockWidgetHourFormat.Auto,
        showSeconds: false,
        showDate: true,
        showTimezoneAbbreviation: true,
      },
    };
  }

  public static override getComponentConfigArguments(): Array<
    ComponentArgument<DashboardClockComponent>
  > {
    const componentArguments: Array<
      ComponentArgument<DashboardClockComponent>
    > = [];

    componentArguments.push({
      name: "Timezone",
      description:
        "The timezone this clock reads in. Leave empty to use the timezone of whoever is viewing the dashboard.",
      required: false,
      type: ComponentInputType.Dropdown,
      id: "timezone",
      placeholder: "Viewer's timezone",
      section: ClockSection,
      /*
       * The full IANA list, ordered by GMT offset and labelled
       * "GMT+5:30 Asia/Kolkata" — the same options and ordering the user
       * already picks their timezone from in User Settings.
       */
      dropdownOptions: getTimezoneOptions(),
    });

    componentArguments.push({
      name: "Label",
      description:
        "Caption under the time. Defaults to the city in the timezone, so use this for a team or office name instead.",
      required: false,
      type: ComponentInputType.Text,
      id: "label",
      placeholder: "Sydney Office",
      section: ClockSection,
    });

    componentArguments.push({
      name: "Clock Face",
      description: "Digital digits, or a drawn analog dial",
      required: false,
      type: ComponentInputType.Dropdown,
      id: "clockFace",
      placeholder: "Digital",
      section: DisplaySection,
      dropdownOptions: [
        { label: "Digital", value: ClockWidgetFace.Digital },
        { label: "Analog", value: ClockWidgetFace.Analog },
      ],
    });

    componentArguments.push({
      name: "Time Format",
      description:
        "Auto follows the viewer's own locale, so one dashboard reads naturally for teams in different countries.",
      required: false,
      type: ComponentInputType.Dropdown,
      id: "hourFormat",
      placeholder: "Auto",
      section: DisplaySection,
      dropdownOptions: [
        { label: "Auto (viewer's locale)", value: ClockWidgetHourFormat.Auto },
        { label: "12 Hour", value: ClockWidgetHourFormat.TwelveHour },
        { label: "24 Hour", value: ClockWidgetHourFormat.TwentyFourHour },
      ],
    });

    componentArguments.push({
      name: "Show Seconds",
      description:
        "Tick every second instead of every minute. Off by default — a wall dashboard rarely needs it.",
      required: false,
      type: ComponentInputType.Boolean,
      id: "showSeconds",
      section: DisplaySection,
    });

    componentArguments.push({
      name: "Show Date",
      description:
        "Show the day and date under the time — worth keeping on when the zone is a day ahead or behind.",
      required: false,
      type: ComponentInputType.Boolean,
      id: "showDate",
      section: DisplaySection,
    });

    componentArguments.push({
      name: "Show Timezone",
      description:
        "Show the zone abbreviation (EDT, GMT+05:30) so the time is never ambiguous.",
      required: false,
      type: ComponentInputType.Boolean,
      id: "showTimezoneAbbreviation",
      section: DisplaySection,
    });

    return componentArguments;
  }
}
