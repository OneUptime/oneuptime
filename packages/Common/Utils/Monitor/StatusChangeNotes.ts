import { translationKey, Translator } from "../../Types/Translator";
import { escapeRegExp } from "../RegExpEscape";

/*
 * WHY A MONITOR'S STATUS CHANGED, WHEN NO CRITERIA CHANGED IT (#9592, #9752).
 *
 * A status event's root cause is usually the Markdown a criteria writes
 * (MonitorRootCauseWording words it). When something else changed the
 * status, OneUptime writes one sentence of its own instead, in English, once,
 * for everyone who reads it:
 *
 *   - a person set it: "Monitor status created by [Jane](...)"
 *     (MonitorStatusTimelineService), or changed the monitor's status on its
 *     page: "This status was changed when the monitor was updated."
 *     (MonitorService);
 *   - the monitor was created: "This status was created when the monitor was
 *     created." (MonitorService);
 *   - an incident changed it: "Status was changed because Incident #42 was
 *     created." or "... was updated." (IncidentService);
 *   - a maintenance event changed it: "Changed because of maintenance event:
 *     <its id>" (ScheduledMaintenanceService);
 *   - no criteria matched: "No monitoring criteria met. Change to default
 *     status." (MonitorResource);
 *   - monitoring was turned off or back on (MonitorStatusTimelineService
 *     getMonitoringSwitchRootCause), with or without who did it;
 *   - what an OpenStack project uses had an incident, or is back
 *     (OpenStackProjectPages).
 *
 * Each is read here by its English and said in the reader's language: the
 * monitor's hero (MonitorStatusReason, as plain words) and its Status
 * Timeline's View Cause (StatusChangeCauseWording, as Markdown) say it the
 * same way. A value in it - who, which incident - is kept as it was handed
 * in (plain words or Markdown) and set apart from the words round it. Only a
 * whole note is read: any other text, a note a person wrote among them,
 * reads as written.
 *
 * React-free, so the Dashboard's tests and Common's read it the same way.
 */

export const STATUS_CHANGED_BY_USER: string = translationKey(
  "Changed by {{user}}",
);
export const STATUS_CHANGED_BY_NEW_INCIDENT: string = translationKey(
  "Changed because incident {{incident}} was created.",
);
export const STATUS_CHANGED_BY_UPDATED_INCIDENT: string = translationKey(
  "Changed because incident {{incident}} was updated.",
);
export const STATUS_CHANGED_BY_MAINTENANCE: string = translationKey(
  "Changed by a maintenance event.",
);
/*
 * Said better than the engine stores it ("No monitoring criteria met.
 * Change to default status."), in English too.
 */
export const STATUS_CHANGED_TO_DEFAULT: string = translationKey(
  "No criteria matched, so the monitor changed to its default status.",
);
export const STATUS_CREATED_WITH_MONITOR: string = translationKey(
  "This status was created when the monitor was created.",
);
export const STATUS_CHANGED_WITH_MONITOR: string = translationKey(
  "This status was changed when the monitor was updated.",
);
export const MONITORING_TURNED_OFF_BY_USER: string = translationKey(
  "{{user}} turned off monitoring. Nothing checks the monitor until it is turned back on, so its status stays at the last one recorded, and uptime, status pages and SLOs leave this time out.",
);
export const MONITORING_TURNED_OFF: string = translationKey(
  "Monitoring is off. Nothing checks the monitor until it is turned back on, so its status stays at the last one recorded, and uptime, status pages and SLOs leave this time out.",
);
export const MONITORING_TURNED_ON_BY_USER: string = translationKey(
  "{{user}} turned monitoring back on. Uptime, status pages and SLOs count the monitor's time again from here.",
);
export const MONITORING_TURNED_ON: string = translationKey(
  "Monitoring was turned back on. Uptime, status pages and SLOs count the monitor's time again from here.",
);
// OpenStackProjectPages writes these two, from here.
export const OPENSTACK_PROJECT_USES_INCIDENT: string = translationKey(
  "Something this project uses has an incident.",
);
export const OPENSTACK_PROJECT_USES_BACK: string = translationKey(
  "What this project uses is back.",
);

// What follows who turned monitoring off or on, as the service writes it.
const MONITORING_OFF_TAIL: string =
  " Nothing checks the monitor until it is turned back on, so its status stays at the last one recorded, and uptime, status pages and SLOs leave this time out.";
const MONITORING_ON_TAIL: string =
  " Uptime, status pages and SLOs count the monitor's time again from here.";

/*
 * Each note by its English as stored. A value is bounded, so a match is
 * linear in the text however long a person's name is.
 */
const MANUAL_CHANGE: RegExp = /^Monitor status created by (.{1,500})$/;
const NEW_INCIDENT: RegExp =
  /^Status was changed because Incident (.{1,200}) was created\.$/;
const UPDATED_INCIDENT: RegExp =
  /^Status was changed because Incident (.{1,200}) was updated\.$/;
const MAINTENANCE_CHANGE: RegExp =
  /^Changed because of maintenance event: (.{1,200})$/;
const MONITORING_OFF_BY: RegExp = new RegExp(
  `^(.{1,500}) turned off monitoring\\.${escapeRegExp(MONITORING_OFF_TAIL)}$`,
);
const MONITORING_ON_BY: RegExp = new RegExp(
  `^(.{1,500}) turned monitoring back on\\.${escapeRegExp(MONITORING_ON_TAIL)}$`,
);

// The engine's own words, a space and all, as MonitorResource stores them.
const NO_CRITERIA_MET: string =
  "No monitoring criteria met. Change to default status.";

// Notes whose English is stored as the key reads.
const NOTES_AS_STORED: ReadonlyArray<string> = [
  STATUS_CREATED_WITH_MONITOR,
  STATUS_CHANGED_WITH_MONITOR,
  MONITORING_TURNED_OFF,
  MONITORING_TURNED_ON,
  OPENSTACK_PROJECT_USES_INCIDENT,
  OPENSTACK_PROJECT_USES_BACK,
];

function say(translator: Translator, text: string): string {
  return translator.translateText(text) || text;
}

function sayWith(
  translator: Translator,
  template: string,
  values: Record<string, string>,
): string {
  return translator.translateTemplate(template, values, {
    setsValuesApart: true,
  });
}

/*
 * One of OneUptime's own status-change notes, in the reader's words; null
 * for any other text. `text` is the whole root cause, trimmed: plain words
 * for the hero, Markdown for View Cause - a value is kept as handed in.
 */
export function wordStatusChangeNote(
  text: string,
  translator: Translator,
): string | null {
  const note: string = text.trim();

  if (!note) {
    return null;
  }

  const manual: RegExpExecArray | null = MANUAL_CHANGE.exec(note);

  if (manual) {
    return sayWith(translator, STATUS_CHANGED_BY_USER, {
      user: manual[1] as string,
    });
  }

  const created: RegExpExecArray | null = NEW_INCIDENT.exec(note);

  if (created) {
    return sayWith(translator, STATUS_CHANGED_BY_NEW_INCIDENT, {
      incident: created[1] as string,
    });
  }

  const updated: RegExpExecArray | null = UPDATED_INCIDENT.exec(note);

  if (updated) {
    return sayWith(translator, STATUS_CHANGED_BY_UPDATED_INCIDENT, {
      incident: updated[1] as string,
    });
  }

  if (MAINTENANCE_CHANGE.test(note)) {
    return say(translator, STATUS_CHANGED_BY_MAINTENANCE);
  }

  if (note === NO_CRITERIA_MET) {
    return say(translator, STATUS_CHANGED_TO_DEFAULT);
  }

  for (const asStored of NOTES_AS_STORED) {
    if (note === asStored) {
      return say(translator, asStored);
    }
  }

  const turnedOff: RegExpExecArray | null = MONITORING_OFF_BY.exec(note);

  if (turnedOff) {
    return sayWith(translator, MONITORING_TURNED_OFF_BY_USER, {
      user: turnedOff[1] as string,
    });
  }

  const turnedOn: RegExpExecArray | null = MONITORING_ON_BY.exec(note);

  if (turnedOn) {
    return sayWith(translator, MONITORING_TURNED_ON_BY_USER, {
      user: turnedOn[1] as string,
    });
  }

  return null;
}
