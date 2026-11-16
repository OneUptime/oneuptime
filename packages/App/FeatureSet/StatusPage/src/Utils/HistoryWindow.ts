import { JSONObject } from "Common/Types/JSON";
import { PluralTemplate } from "Common/Types/Translator";
import {
  getStatusPageHistoryInDays,
  HISTORY_IN_DAYS_RESPONSE_KEY,
} from "Common/Utils/StatusPage/HistoryWindow";

/*
 * What a status page's lists say about the window they cover.
 *
 * The server sends an incident, announcement or maintenance event only from
 * the last N days (the page's history setting, 14 when unset), and the lists
 * used to say only "Resolved Incidents" and, empty, "No Incident" under an
 * alarm icon - which visitors read as "this service has never had an
 * incident" (#9122). Each list now names its window, from the number the
 * server read it with, in the reader's plural forms (translatePlural): the
 * keys are flat in the status page's locale files, each with its "_one".
 */
export const HISTORY_WINDOW_WORDS: {
  resolvedIncidents: PluralTemplate;
  noIncidents: PluralTemplate;
  endedAnnouncements: PluralTemplate;
  noAnnouncements: PluralTemplate;
  completedMaintenance: PluralTemplate;
  noMaintenance: PluralTemplate;
} = {
  resolvedIncidents: {
    one: "Resolved in the Last Day",
    other: "Resolved in the Last {{count}} Days",
  },
  noIncidents: {
    one: "No incidents in the last day",
    other: "No incidents in the last {{count}} days",
  },
  endedAnnouncements: {
    one: "Ended in the Last Day",
    other: "Ended in the Last {{count}} Days",
  },
  noAnnouncements: {
    one: "No announcements in the last day",
    other: "No announcements in the last {{count}} days",
  },
  completedMaintenance: {
    one: "Completed in the Last Day",
    other: "Completed in the Last {{count}} Days",
  },
  noMaintenance: {
    one: "None is planned, and none took place in the last day.",
    other: "None is planned, and none took place in the last {{count}} days.",
  },
};

// The window a list's response says the server read it with.
export const readHistoryInDays: (
  data: JSONObject | null | undefined,
) => number = (data: JSONObject | null | undefined): number => {
  return getStatusPageHistoryInDays(
    data?.[HISTORY_IN_DAYS_RESPONSE_KEY] as number | undefined,
  );
};
