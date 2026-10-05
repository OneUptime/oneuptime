import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import Select from "Common/Types/BaseDatabase/Select";
import { JSONObject } from "Common/Types/JSON";
import UptimePrecision from "Common/Types/StatusPage/UptimePrecision";
import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import IncidentStatusPageScopeCopy from "../Incident/IncidentStatusPageScopeCopy";

/*
 * What a status page shows its visitors, in one card on Advanced -> Advanced
 * Settings: each list (incidents, episodes, announcements, scheduled
 * maintenance) with how far back it goes and whether its items carry their
 * labels; its uptime - how many days the bars cover, whether the page shows
 * one overall uptime percentage (and to how many decimals), and which
 * monitor statuses count as downtime; and the "Powered by OneUptime" line.
 *
 * It used to be six cards on that page, each with its own Edit button and
 * dialog (the incidents one in two steps), for what is mostly a switch and a
 * number of days per list, and the overall uptime percentage and the
 * downtime statuses were two more cards below it. A dialog also saved every
 * field it held, so on a plan that may not change one of them nothing in it
 * could be changed: the free history and scope settings shared their dialog
 * with the Growth plan's Show Incidents, and the free uptime precision its
 * dialog with the Scale plan's Show Overall Uptime Percent. Each control
 * here saves its own column the moment it is changed (StatusPageSwitchRow,
 * StatusPageDaysSetting, StatusPageChoiceSetting,
 * StatusPageDowntimeStatusesSetting) and names the plan it needs before
 * anyone tries.
 *
 * What hiding a list does, so the copy says it right: the list, its tab and
 * its public endpoint go, and the page's subscribers are no longer notified
 * about that kind of event (the Workers jobs skip a page that hides it). How
 * far back a hidden list goes, and whether it shows labels, change nothing,
 * so those are offered only while the list is shown. Only Show Incidents
 * Scoped to This Page stays either way: it also decides which incidents
 * bring their episodes onto the page. In the same way the uptime precision
 * is offered only while the overall uptime percentage is shown: it is the
 * precision of that percentage and nothing else (each resource and group
 * has its own).
 *
 * Kept free of React so the card and App/Tests read these exact strings.
 * Every string is a whole sentence or a whole name wrapped in
 * translationKey() (or a PluralTemplate), so npm run i18n:extract finds it,
 * and each is translated in all seventeen Dashboard locale files
 * (App/Tests/Dashboard/StatusPageDisplaySettingsOnePlace checks).
 */

// The status page columns the card switches on and off.
export type DisplaySwitchColumn =
  | "showIncidentsOnStatusPage"
  | "showIncidentLabelsOnStatusPage"
  | "onlyShowScopedIncidents"
  | "showEpisodesOnStatusPage"
  | "showEpisodeLabelsOnStatusPage"
  | "showAnnouncementsOnStatusPage"
  | "showScheduledMaintenanceEventsOnStatusPage"
  | "showScheduledEventLabelsOnStatusPage"
  | "showOverallUptimePercentOnStatusPage"
  | "hidePoweredByOneUptimeBranding";

// The status page columns that hold a number of days.
export type DisplayDaysColumn =
  | "showIncidentHistoryInDays"
  | "showEpisodeHistoryInDays"
  | "showAnnouncementHistoryInDays"
  | "showScheduledEventHistoryInDays"
  | "showUptimeHistoryInDays";

// The status page column that holds one pick from a short list.
export type DisplayChoiceColumn = "overallUptimePercentPrecision";

// The status page column that holds a list of the project's monitor statuses.
export type DisplayStatusesColumn = "downtimeMonitorStatuses";

// The columns that hold a single value, each with a default the model declares.
export type DisplayValueColumn =
  | DisplaySwitchColumn
  | DisplayDaysColumn
  | DisplayChoiceColumn;

export type DisplaySettingColumn = DisplayValueColumn | DisplayStatusesColumn;

export type DisplaySectionId =
  | "incidents"
  | "episodes"
  | "announcements"
  | "scheduled-maintenance"
  | "uptime-history"
  | "powered-by";

export interface DisplaySwitchDefinition {
  column: DisplaySwitchColumn;
  // The switch's name. It does not change with the switch.
  title: string;
  // A line under it, whichever way it is set...
  description?: string | undefined;
  // ...or only while it is off, saying what off means.
  offDescription?: string | undefined;
  /*
   * The switch is on while the column is false. Only the "Powered by
   * OneUptime" line is stored as what to hide; on this card every switch
   * reads the same way, on = visitors see it.
   */
  isInverted?: boolean | undefined;
}

export interface DisplayChoiceOption {
  // What the column stores.
  value: string;
  // What the option reads as. Not translated: a number reads the same.
  label: string;
}

export interface DisplayChoiceDefinition {
  column: DisplayChoiceColumn;
  // The name beside the dropdown, which is also its accessible name.
  label: string;
  options: ReadonlyArray<DisplayChoiceOption>;
}

export interface DisplayOptionDefinition extends DisplaySwitchDefinition {
  // Offered only while the section's own switch is on.
  isOnlyWhileShown: boolean;
  // A pick offered under this switch, only while this switch is on.
  choiceWhileOn?: DisplayChoiceDefinition | undefined;
}

export interface DisplayDaysDefinition {
  column: DisplayDaysColumn;
  // The box's accessible name: the setting's own name.
  label: string;
  // The most days the column may hold. No upper limit when left out.
  maxDays?: number | undefined;
}

export interface DisplayStatusesDefinition {
  column: DisplayStatusesColumn;
  // The name above the picker, which is also its accessible name.
  label: string;
  // The line under it, while at least one status is picked...
  description: string;
  // ...and while none is (which only the API can leave a page with).
  emptyDescription: string;
  // Why the last status cannot be taken off.
  keepOne: string;
  placeholder: string;
}

export interface DisplaySectionDefinition {
  id: DisplaySectionId;
  // Whether the page shows this at all. Uptime history has no switch.
  show?: DisplaySwitchDefinition | undefined;
  // A section without a switch carries its own name and line instead.
  title?: string | undefined;
  description?: string | undefined;
  // How far back the list goes, offered while it is shown.
  days?: DisplayDaysDefinition | undefined;
  options: ReadonlyArray<DisplayOptionDefinition>;
  // Which monitor statuses count against the uptime the page shows.
  statuses?: DisplayStatusesDefinition | undefined;
}

export const StatusPageDisplaySettingsCopy: {
  cardTitle: string;
  cardDescription: string;
  hiddenListDescription: string;
  uptimeTitle: string;
  uptimeDescription: string;
  overallUptimeDescription: string;
  precisionLabel: string;
  downtimeLabel: string;
  downtimeDescription: string;
  downtimeEmptyDescription: string;
  downtimeKeepOne: string;
  downtimePlaceholder: string;
  daysTooFew: string;
  daysOutOfRange: string;
  saving: string;
  saved: string;
  notFound: string;
} = {
  cardTitle: translationKey("What your status page shows"),
  cardDescription: translationKey(
    "Choose what visitors see on this status page, and how far back each list goes. Changes are saved as you make them.",
  ),
  hiddenListDescription: translationKey(
    "Hidden from visitors, and subscribers aren't notified about them.",
  ),
  uptimeTitle: translationKey("Uptime History"),
  uptimeDescription: translationKey(
    "How many days the uptime bars and uptime percentages cover, up to {{max}}.",
  ),
  /*
   * What the visitor sees: "99.99% uptime" at the end of the overall status
   * line ("All resources are operational"), which is only there while every
   * resource is operational. It is the average of the uptime of the page's
   * resources and groups (ResourceUptime's
   * calculateAvgUptimePercentageOfAllResources).
   */
  overallUptimeDescription: translationKey(
    "The average uptime of the page's resources, shown beside its overall status while everything is operational.",
  ),
  precisionLabel: translationKey("Precision"),
  downtimeLabel: translationKey("Counts as downtime"),
  /*
   * Every uptime percentage on the page - a resource's, a group's, the
   * overall one - counts the time a monitor spent in one of these statuses
   * as down; a status page has no fallback for an empty list (an SLO
   * does), so with none picked every one of them reads 100%.
   */
  downtimeDescription: translationKey(
    "Time a monitor spends in any of these statuses counts against its uptime on this page.",
  ),
  downtimeEmptyDescription: translationKey(
    "No status counts as downtime, so every uptime percentage on this page reads 100%.",
  ),
  downtimeKeepOne: translationKey(
    "Keep at least one status. With none, every uptime percentage on this page would read 100%.",
  ),
  downtimePlaceholder: translationKey("Select monitor statuses"),
  daysTooFew: translationKey("Enter a whole number of days, 1 or more."),
  daysOutOfRange: translationKey(
    "Enter a whole number of days between 1 and {{max}}.",
  ),
  saving: translationKey("Saving…"),
  saved: translationKey("Saved"),
  notFound: translationKey("Status page not found."),
};

/*
 * How precise the overall uptime percentage is, as the visitor would read
 * it. Each option is its own example, so the dropdown needs no words of its
 * own (the column stores the longer enum values, which say it in English:
 * "99.99% (Two Decimal)").
 */
export const UPTIME_PRECISION_OPTIONS: ReadonlyArray<DisplayChoiceOption> = [
  { value: UptimePrecision.NO_DECIMAL, label: "99%" },
  { value: UptimePrecision.ONE_DECIMAL, label: "99.9%" },
  { value: UptimePrecision.TWO_DECIMAL, label: "99.99%" },
  { value: UptimePrecision.THREE_DECIMAL, label: "99.999%" },
];

/*
 * The sentence the number of days is typed into, the same for every list:
 * under Show Incidents it reads "Show the last [14] days". Each language puts
 * the box where its grammar wants it.
 */
export const DISPLAY_DAYS_SENTENCE: PluralTemplate = {
  one: "Show the last {{count}} day",
  other: "Show the last {{count}} days",
};

// The uptime bars cover at most this many days (the API clamps to it too).
export const MAX_UPTIME_HISTORY_DAYS: number = 90;

const WHOLE_NUMBER: RegExp = /^\d+$/;

/*
 * In the order the old cards had them, which is the order the dashboard
 * menus and the docs list these things in.
 */
export const DISPLAY_SECTIONS: ReadonlyArray<DisplaySectionDefinition> = [
  {
    id: "incidents",
    show: {
      column: "showIncidentsOnStatusPage",
      title: translationKey("Show Incidents"),
      offDescription: StatusPageDisplaySettingsCopy.hiddenListDescription,
    },
    days: {
      column: "showIncidentHistoryInDays",
      label: translationKey("Show Incident History (in days)"),
    },
    options: [
      {
        column: "showIncidentLabelsOnStatusPage",
        title: translationKey("Show Incident Labels"),
        isOnlyWhileShown: true,
      },
      {
        column: "onlyShowScopedIncidents",
        title: IncidentStatusPageScopeCopy.onlyShowScopedIncidentsTitle,
        description:
          IncidentStatusPageScopeCopy.onlyShowScopedIncidentsDescription,
        isOnlyWhileShown: false,
      },
    ],
  },
  {
    id: "episodes",
    show: {
      column: "showEpisodesOnStatusPage",
      title: translationKey("Show Episodes"),
      offDescription: StatusPageDisplaySettingsCopy.hiddenListDescription,
    },
    days: {
      column: "showEpisodeHistoryInDays",
      label: translationKey("Show Episode History (in days)"),
    },
    options: [
      {
        column: "showEpisodeLabelsOnStatusPage",
        title: translationKey("Show Episode Labels"),
        isOnlyWhileShown: true,
      },
    ],
  },
  {
    id: "announcements",
    show: {
      column: "showAnnouncementsOnStatusPage",
      title: translationKey("Show Announcements"),
      offDescription: StatusPageDisplaySettingsCopy.hiddenListDescription,
    },
    days: {
      column: "showAnnouncementHistoryInDays",
      label: translationKey("Show Announcement History (in days)"),
    },
    options: [],
  },
  {
    id: "scheduled-maintenance",
    show: {
      column: "showScheduledMaintenanceEventsOnStatusPage",
      title: translationKey("Show Scheduled Maintenance Events"),
      offDescription: StatusPageDisplaySettingsCopy.hiddenListDescription,
    },
    days: {
      column: "showScheduledEventHistoryInDays",
      label: translationKey("Show Scheduled Event History (in days)"),
    },
    options: [
      {
        column: "showScheduledEventLabelsOnStatusPage",
        title: translationKey("Show Event Labels"),
        isOnlyWhileShown: true,
      },
    ],
  },
  /*
   * Everything about the page's uptime, in one place: how many days the
   * bars and percentages cover, the one overall percentage (and its
   * precision, offered while it is shown), then which statuses count as
   * downtime in all of them - the setting fewest people change, last.
   */
  {
    id: "uptime-history",
    title: StatusPageDisplaySettingsCopy.uptimeTitle,
    description: StatusPageDisplaySettingsCopy.uptimeDescription,
    days: {
      column: "showUptimeHistoryInDays",
      label: translationKey("Show Uptime History (in days)"),
      maxDays: MAX_UPTIME_HISTORY_DAYS,
    },
    options: [
      {
        column: "showOverallUptimePercentOnStatusPage",
        title: translationKey("Show Overall Uptime Percent"),
        description: StatusPageDisplaySettingsCopy.overallUptimeDescription,
        isOnlyWhileShown: false,
        choiceWhileOn: {
          column: "overallUptimePercentPrecision",
          label: StatusPageDisplaySettingsCopy.precisionLabel,
          options: UPTIME_PRECISION_OPTIONS,
        },
      },
    ],
    statuses: {
      column: "downtimeMonitorStatuses",
      label: StatusPageDisplaySettingsCopy.downtimeLabel,
      description: StatusPageDisplaySettingsCopy.downtimeDescription,
      emptyDescription: StatusPageDisplaySettingsCopy.downtimeEmptyDescription,
      keepOne: StatusPageDisplaySettingsCopy.downtimeKeepOne,
      placeholder: StatusPageDisplaySettingsCopy.downtimePlaceholder,
    },
  },
  {
    id: "powered-by",
    show: {
      column: "hidePoweredByOneUptimeBranding",
      title: translationKey("Show Powered By OneUptime Branding"),
      isInverted: true,
    },
    options: [],
  },
];

// Every switch on the card, section by section, in the order drawn.
export const DISPLAY_SWITCHES: ReadonlyArray<DisplaySwitchDefinition> =
  DISPLAY_SECTIONS.flatMap(
    (section: DisplaySectionDefinition): Array<DisplaySwitchDefinition> => {
      return [...(section.show ? [section.show] : []), ...section.options];
    },
  );

// Every number of days on the card, in the order drawn.
export const DISPLAY_DAYS: ReadonlyArray<DisplayDaysDefinition> =
  DISPLAY_SECTIONS.flatMap(
    (section: DisplaySectionDefinition): Array<DisplayDaysDefinition> => {
      return section.days ? [section.days] : [];
    },
  );

// Every pick offered under a switch, in the order drawn.
export const DISPLAY_CHOICES: ReadonlyArray<DisplayChoiceDefinition> =
  DISPLAY_SECTIONS.flatMap(
    (section: DisplaySectionDefinition): Array<DisplayChoiceDefinition> => {
      return section.options.flatMap(
        (option: DisplayOptionDefinition): Array<DisplayChoiceDefinition> => {
          return option.choiceWhileOn ? [option.choiceWhileOn] : [];
        },
      );
    },
  );

// Every list of monitor statuses on the card, in the order drawn.
export const DISPLAY_STATUSES: ReadonlyArray<DisplayStatusesDefinition> =
  DISPLAY_SECTIONS.flatMap(
    (section: DisplaySectionDefinition): Array<DisplayStatusesDefinition> => {
      return section.statuses ? [section.statuses] : [];
    },
  );

// Every column that holds a single value: the switches, days and picks.
export const DISPLAY_VALUE_COLUMNS: ReadonlyArray<DisplayValueColumn> = [
  ...DISPLAY_SWITCHES.map(
    (definition: DisplaySwitchDefinition): DisplayValueColumn => {
      return definition.column;
    },
  ),
  ...DISPLAY_DAYS.map(
    (definition: DisplayDaysDefinition): DisplayValueColumn => {
      return definition.column;
    },
  ),
  ...DISPLAY_CHOICES.map(
    (definition: DisplayChoiceDefinition): DisplayValueColumn => {
      return definition.column;
    },
  ),
];

// Every column the card reads and writes.
export const DISPLAY_SETTING_COLUMNS: ReadonlyArray<DisplaySettingColumn> = [
  ...DISPLAY_VALUE_COLUMNS,
  ...DISPLAY_STATUSES.map(
    (definition: DisplayStatusesDefinition): DisplaySettingColumn => {
      return definition.column;
    },
  ),
];

/*
 * What the card asks the server for: its columns, and nothing else - and of
 * a list of statuses, what each chip shows: its name and its colour.
 */
export const getDisplaySettingsSelect: () => Select<StatusPage> =
  (): Select<StatusPage> => {
    const select: Select<StatusPage> = {};

    for (const column of DISPLAY_VALUE_COLUMNS) {
      select[column] = true;
    }

    for (const definition of DISPLAY_STATUSES) {
      select[definition.column] = { _id: true, name: true, color: true };
    }

    return select;
  };

/*
 * The value a column holds on a page that has none for it: the model's own
 * default (true for the four lists, 14 days, 90 days of uptime, two
 * decimals ...), the same one the server stores for a new status page.
 *
 * A list of statuses has none: the server fills a new page's from the
 * project's statuses when it creates the page (StatusPageService).
 */
let statusPageModel: StatusPage | null = null;

export const getDisplaySettingDefault: (
  column: DisplayValueColumn,
) => boolean | number | string = (
  column: DisplayValueColumn,
): boolean | number | string => {
  if (!statusPageModel) {
    statusPageModel = new StatusPage();
  }

  const defaultValue: unknown =
    statusPageModel.getTableColumnMetadata(column)?.defaultValue;

  if (
    typeof defaultValue === "number" ||
    typeof defaultValue === "boolean" ||
    typeof defaultValue === "string"
  ) {
    return defaultValue;
  }

  throw new Error(`StatusPage.${column} has no default to show.`);
};

/*
 * What a pick or a list of statuses sends when it changes: its own column,
 * alone. The server refuses a whole write that carries a column the
 * project's plan may not change, changed or not (ColumnPermission), so a
 * control never sends a neighbour's value along - the free precision is
 * not refused for the Scale plan's switch above it.
 */
export const getDisplayChoiceWrite: (
  column: DisplayChoiceColumn,
  value: string,
) => JSONObject = (column: DisplayChoiceColumn, value: string): JSONObject => {
  return { [column]: value };
};

// The statuses by id: the server reads each as the monitor status it names.
export const getDisplayStatusesWrite: (
  column: DisplayStatusesColumn,
  statusIds: ReadonlyArray<string>,
) => JSONObject = (
  column: DisplayStatusesColumn,
  statusIds: ReadonlyArray<string>,
): JSONObject => {
  return { [column]: [...statusIds] };
};

/*
 * The options of a pick, with the value the page holds added at the end if
 * the list leaves it out (the column is free text to the API), so the
 * dropdown never looks empty for a page that has a value.
 */
export const getDisplayChoiceOptions: (
  definition: DisplayChoiceDefinition,
  currentValue: string | undefined,
) => Array<DisplayChoiceOption> = (
  definition: DisplayChoiceDefinition,
  currentValue: string | undefined,
): Array<DisplayChoiceOption> => {
  const options: Array<DisplayChoiceOption> = [...definition.options];

  if (
    currentValue &&
    !options.some((option: DisplayChoiceOption): boolean => {
      return option.value === currentValue;
    })
  ) {
    options.push({ value: currentValue, label: currentValue });
  }

  return options;
};

// The line under a list of statuses, for how many are picked.
export const getDisplayStatusesDescription: (
  definition: DisplayStatusesDefinition,
  pickedCount: number,
) => string = (
  definition: DisplayStatusesDefinition,
  pickedCount: number,
): string => {
  return pickedCount > 0 ? definition.description : definition.emptyDescription;
};

/*
 * Why a list of statuses cannot be saved, or null when it can: taking the
 * last one off would leave nothing counting as downtime.
 */
export const getDisplayStatusesProblem: (
  definition: DisplayStatusesDefinition,
  statusIds: ReadonlyArray<string>,
) => string | null = (
  definition: DisplayStatusesDefinition,
  statusIds: ReadonlyArray<string>,
): string | null => {
  return statusIds.length === 0 ? definition.keepOne : null;
};

// Whether two lists of statuses hold the same statuses, in any order.
export const isSameStatusList: (
  first: ReadonlyArray<string>,
  second: ReadonlyArray<string>,
) => boolean = (
  first: ReadonlyArray<string>,
  second: ReadonlyArray<string>,
): boolean => {
  const firstSet: Set<string> = new Set(first);
  const secondSet: Set<string> = new Set(second);

  if (firstSet.size !== secondSet.size) {
    return false;
  }

  for (const id of firstSet) {
    if (!secondSet.has(id)) {
      return false;
    }
  }

  return true;
};

export type DaysParseResult =
  | { isValid: true; days: number }
  | { isValid: false; error: string; values: Record<string, number> };

/*
 * What was typed into a number-of-days box, as the column would store it: a
 * whole number of days, at least 1 (0 or less leaves a list empty, and the
 * server reads 0 as its default instead), and no more than the column
 * allows. Otherwise the message to show, and the values it is filled with.
 */
export const parseDisplayDays: (
  text: string,
  maxDays?: number | undefined,
) => DaysParseResult = (
  text: string,
  maxDays?: number | undefined,
): DaysParseResult => {
  const trimmed: string = text.trim();
  const days: number = Number(trimmed);

  const isWholeNumber: boolean =
    WHOLE_NUMBER.test(trimmed) && Number.isSafeInteger(days);

  const isInRange: boolean =
    days >= 1 && (maxDays === undefined || days <= maxDays);

  if (isWholeNumber && isInRange) {
    return { isValid: true, days: days };
  }

  if (maxDays === undefined) {
    return {
      isValid: false,
      error: StatusPageDisplaySettingsCopy.daysTooFew,
      values: {},
    };
  }

  return {
    isValid: false,
    error: StatusPageDisplaySettingsCopy.daysOutOfRange,
    values: { max: maxDays },
  };
};

// What a switch's line under it says, the way it is set now.
export const getDisplaySwitchDescription: (
  definition: DisplaySwitchDefinition,
  isOn: boolean,
) => string | undefined = (
  definition: DisplaySwitchDefinition,
  isOn: boolean,
): string | undefined => {
  if (!isOn && definition.offDescription) {
    return definition.offDescription;
  }

  return definition.description;
};

// The data-testid of a switch on the card, and of its row (`-row`).
export const getDisplaySwitchTestId: (column: DisplaySwitchColumn) => string = (
  column: DisplaySwitchColumn,
): string => {
  return `status-page-display-switch-${column}`;
};

// The data-testid of a number-of-days box, and of its row (`-row`).
export const getDisplayDaysTestId: (column: DisplayDaysColumn) => string = (
  column: DisplayDaysColumn,
): string => {
  return `status-page-display-days-${column}`;
};

// The data-testid of a pick under a switch, and of its row (`-row`).
export const getDisplayChoiceTestId: (column: DisplayChoiceColumn) => string = (
  column: DisplayChoiceColumn,
): string => {
  return `status-page-display-choice-${column}`;
};

// The data-testid of a list of statuses, and of its row (`-row`).
export const getDisplayStatusesTestId: (
  column: DisplayStatusesColumn,
) => string = (column: DisplayStatusesColumn): string => {
  return `status-page-display-statuses-${column}`;
};

export const getDisplaySectionTestId: (id: DisplaySectionId) => string = (
  id: DisplaySectionId,
): string => {
  return `status-page-display-section-${id}`;
};

export default StatusPageDisplaySettingsCopy;
