import {
  NUMBER_PREFIX_COLUMNS,
  NumberPrefixColumn,
  NumberPrefixColumnInfo,
} from "Common/Utils/Project/NumberPrefix";

/*
 * What each product's Number Prefix page holds: Incidents → Settings →
 * Number Prefix (incidents and incident episodes), the same page under
 * Alerts (alerts and alert episodes) and under Scheduled Maintenance
 * (events). One card per page, one row per kind of number, edited together
 * in one dialog. The copy lives here, beside the columns it describes, so
 * the three pages say the same thing the same way.
 */

export const NUMBER_PREFIX_PAGE_TITLE: string = "Number Prefix";

/*
 * Where the prefixes were before, in each product: a page called More
 * Settings that held nothing else. The address still works and forwards to
 * Number Prefix (MovedNumberPrefixPageRedirect), so a bookmark or an older
 * link lands on the page that replaced it.
 */
export const MORE_SETTINGS_PATH: string = "settings/more";

export const NUMBER_PREFIX_EDIT_BUTTON_TITLE: string = "Update";

// The edit dialog says what it edits, rather than "Edit Project".
export const NUMBER_PREFIX_EDIT_MODAL_TITLE: string = "Edit Number Prefix";

export interface NumberPrefixRow {
  column: NumberPrefixColumn;
  // The row's title on the card: what the numbers are numbers of.
  label: string;
  // The edit form's field for the column.
  formTitle: string;
  formDescription: string;
  // What a new project starts with, offered as the placeholder.
  placeholder: string;
}

export interface NumberPrefixPage {
  // The form's name and the card's detail id: unique per page.
  name: string;
  detailId: string;
  cardDescription: string;
  // Under the edit dialog's title, at the moment a change is made.
  editDescription: string;
  rows: Array<NumberPrefixRow>;
}

function defaultPrefixFor(column: NumberPrefixColumn): string {
  const info: NumberPrefixColumnInfo | undefined = NUMBER_PREFIX_COLUMNS.find(
    (candidate: NumberPrefixColumnInfo): boolean => {
      return candidate.column === column;
    },
  );

  return info?.defaultForNewProjects || "";
}

function row(data: {
  column: NumberPrefixColumn;
  label: string;
  formTitle: string;
  formDescription: string;
}): NumberPrefixRow {
  return {
    ...data,
    placeholder: defaultPrefixFor(data.column),
  };
}

export const INCIDENT_NUMBER_PREFIXES: NumberPrefixPage = {
  name: "Incident Number Prefix",
  detailId: "model-detail-project-incident-prefix",
  cardDescription:
    "The short text in front of incident and episode numbers, like INC- in INC-42.",
  editDescription:
    "Only new incidents and episodes use the new prefix. Existing ones keep their numbers.",
  rows: [
    row({
      column: "incidentNumberPrefix",
      label: "Incidents",
      formTitle: "Incident Number Prefix",
      formDescription: "Shown before every incident number. Leave empty for #.",
    }),
    row({
      column: "incidentEpisodeNumberPrefix",
      label: "Incident Episodes",
      formTitle: "Incident Episode Number Prefix",
      formDescription:
        "Shown before every incident episode number. Leave empty for #.",
    }),
  ],
};

export const ALERT_NUMBER_PREFIXES: NumberPrefixPage = {
  name: "Alert Number Prefix",
  detailId: "model-detail-project-alert-prefix",
  cardDescription:
    "The short text in front of alert and episode numbers, like ALT- in ALT-42.",
  editDescription:
    "Only new alerts and episodes use the new prefix. Existing ones keep their numbers.",
  rows: [
    row({
      column: "alertNumberPrefix",
      label: "Alerts",
      formTitle: "Alert Number Prefix",
      formDescription: "Shown before every alert number. Leave empty for #.",
    }),
    row({
      column: "alertEpisodeNumberPrefix",
      label: "Alert Episodes",
      formTitle: "Alert Episode Number Prefix",
      formDescription:
        "Shown before every alert episode number. Leave empty for #.",
    }),
  ],
};

export const SCHEDULED_MAINTENANCE_NUMBER_PREFIXES: NumberPrefixPage = {
  name: "Scheduled Maintenance Number Prefix",
  detailId: "model-detail-project-sm-prefix",
  cardDescription:
    "The short text in front of scheduled maintenance event numbers, like SM- in SM-42.",
  editDescription:
    "Only new events use the new prefix. Existing ones keep their numbers.",
  rows: [
    row({
      column: "scheduledMaintenanceNumberPrefix",
      label: "Events",
      formTitle: "Scheduled Maintenance Number Prefix",
      formDescription: "Shown before every event number. Leave empty for #.",
    }),
  ],
};

export const NUMBER_PREFIX_PAGES: ReadonlyArray<NumberPrefixPage> = [
  INCIDENT_NUMBER_PREFIXES,
  ALERT_NUMBER_PREFIXES,
  SCHEDULED_MAINTENANCE_NUMBER_PREFIXES,
];

// The Project columns a page's card reads, edits and gates its button on.
export function getNumberPrefixColumns(
  page: NumberPrefixPage,
): Array<NumberPrefixColumn> {
  return page.rows.map((prefixRow: NumberPrefixRow): NumberPrefixColumn => {
    return prefixRow.column;
  });
}
