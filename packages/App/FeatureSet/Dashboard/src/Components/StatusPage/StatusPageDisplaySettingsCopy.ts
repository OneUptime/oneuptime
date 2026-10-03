import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import Select from "Common/Types/BaseDatabase/Select";
import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import IncidentStatusPageScopeCopy from "../Incident/IncidentStatusPageScopeCopy";

/*
 * What a status page shows its visitors, in one card on Advanced -> Advanced
 * Settings: each list (incidents, episodes, announcements, scheduled
 * maintenance) with how far back it goes and whether its items carry their
 * labels, how many days the uptime bars cover, and the "Powered by
 * OneUptime" line.
 *
 * It used to be six cards on that page, each with its own Edit button and
 * dialog (the incidents one in two steps), for what is mostly a switch and a
 * number of days per list. A dialog also saved every field it held, so on a
 * plan that may not change one of them nothing in it could be changed: the
 * free history and scope settings shared their dialog with the Growth plan's
 * Show Incidents. Each control here saves its own column the moment it is
 * changed (StatusPageSwitchRow, StatusPageDaysSetting) and names the plan it
 * needs before anyone tries.
 *
 * What hiding a list does, so the copy says it right: the list, its tab and
 * its public endpoint go, and the page's subscribers are no longer notified
 * about that kind of event (the Workers jobs skip a page that hides it). How
 * far back a hidden list goes, and whether it shows labels, change nothing,
 * so those are offered only while the list is shown. Only Show Incidents
 * Scoped to This Page stays either way: it also decides which incidents
 * bring their episodes onto the page.
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
  | "hidePoweredByOneUptimeBranding";

// The status page columns that hold a number of days.
export type DisplayDaysColumn =
  | "showIncidentHistoryInDays"
  | "showEpisodeHistoryInDays"
  | "showAnnouncementHistoryInDays"
  | "showScheduledEventHistoryInDays"
  | "showUptimeHistoryInDays";

export type DisplaySettingColumn = DisplaySwitchColumn | DisplayDaysColumn;

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

export interface DisplayOptionDefinition extends DisplaySwitchDefinition {
  // Offered only while the section's own switch is on.
  isOnlyWhileShown: boolean;
}

export interface DisplayDaysDefinition {
  column: DisplayDaysColumn;
  // The box's accessible name: the setting's own name.
  label: string;
  // The most days the column may hold. No upper limit when left out.
  maxDays?: number | undefined;
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
}

export const StatusPageDisplaySettingsCopy: {
  cardTitle: string;
  cardDescription: string;
  hiddenListDescription: string;
  uptimeTitle: string;
  uptimeDescription: string;
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
  daysTooFew: translationKey("Enter a whole number of days, 1 or more."),
  daysOutOfRange: translationKey(
    "Enter a whole number of days between 1 and {{max}}.",
  ),
  saving: translationKey("Saving…"),
  saved: translationKey("Saved"),
  notFound: translationKey("Status page not found."),
};

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
  {
    id: "uptime-history",
    title: StatusPageDisplaySettingsCopy.uptimeTitle,
    description: StatusPageDisplaySettingsCopy.uptimeDescription,
    days: {
      column: "showUptimeHistoryInDays",
      label: translationKey("Show Uptime History (in days)"),
      maxDays: MAX_UPTIME_HISTORY_DAYS,
    },
    options: [],
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
    (
      section: DisplaySectionDefinition,
    ): Array<DisplaySwitchDefinition> => {
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

// Every column the card reads and writes.
export const DISPLAY_SETTING_COLUMNS: ReadonlyArray<DisplaySettingColumn> = [
  ...DISPLAY_SWITCHES.map(
    (definition: DisplaySwitchDefinition): DisplaySettingColumn => {
      return definition.column;
    },
  ),
  ...DISPLAY_DAYS.map(
    (definition: DisplayDaysDefinition): DisplaySettingColumn => {
      return definition.column;
    },
  ),
];

// What the card asks the server for: its columns, and nothing else.
export const getDisplaySettingsSelect: () => Select<StatusPage> =
  (): Select<StatusPage> => {
    const select: Select<StatusPage> = {};

    for (const column of DISPLAY_SETTING_COLUMNS) {
      select[column] = true;
    }

    return select;
  };

/*
 * The value a column holds on a page that has none for it: the model's own
 * default (true for the four lists, 14 days, 90 days of uptime ...), the
 * same one the server stores for a new status page.
 */
let statusPageModel: StatusPage | null = null;

export const getDisplaySettingDefault: (
  column: DisplaySettingColumn,
) => boolean | number = (column: DisplaySettingColumn): boolean | number => {
  if (!statusPageModel) {
    statusPageModel = new StatusPage();
  }

  const defaultValue: unknown =
    statusPageModel.getTableColumnMetadata(column)?.defaultValue;

  if (typeof defaultValue === "number" || typeof defaultValue === "boolean") {
    return defaultValue;
  }

  throw new Error(`StatusPage.${column} has no default to show.`);
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

export const getDisplaySectionTestId: (id: DisplaySectionId) => string = (
  id: DisplaySectionId,
): string => {
  return `status-page-display-section-${id}`;
};

export default StatusPageDisplaySettingsCopy;
