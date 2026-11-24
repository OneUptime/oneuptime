import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import { getIdsFromFormValue } from "../Incident/IncidentStatusPageScopeForm";

/*
 * Every word the dashboard shows about which status pages a maintenance
 * event is shown on (ScheduledMaintenance.statusPages and its template's).
 *
 * An event is shown on, and notifies the subscribers of, exactly the status
 * pages it names: the public status page asks for events by the page's id,
 * never through the event's monitors (StatusPageAPI,
 * StatusPageVisibilityQuery.shownScheduledMaintenance). So an event with no
 * page picked is on no status page at all.
 *
 * An incident works the other way round: left empty, its picker means every
 * status page that lists its monitors (IncidentStatusPageScopeCopy). The two
 * pickers looked alike and meant opposite things (#9131), so the words here
 * say what empty means in the field itself - its placeholder, its help, and
 * a warning on the review step - rather than leave someone who learned
 * incidents to assume their event is on their status page.
 *
 * The picker's help says which pages count and what none picked means, and
 * promises nothing of them (#9975): it said "Only these status pages show
 * this event and notify their subscribers", which is not what a page with
 * Show Maintenance Events or Send Notifications to Subscribers off does, nor
 * an archived one. What the pages picked really do is said where the server
 * has answered for them: the Subscriber Notifications line and the notes
 * under its boxes on Create and the templates' forms, and the note under the
 * picker on the event's Edit (ScheduledMaintenanceReach).
 *
 * React-free, so App's tests can check that each one is a key in every
 * Dashboard locale. Defined once, for the Create form, the event's own Edit
 * and the templates' forms (MaintenanceStatusPagesFormField).
 */
export const MaintenanceStatusPagesCopy: {
  pickerTitle: string;
  pickerDescription: string;
  templatePickerDescription: string;
  pickerPlaceholder: string;
  notShownWarning: string;
  templateNotShownWarning: string;
  notShownFact: string;
} = {
  pickerTitle: translationKey("Show event on these status pages"),
  pickerDescription: translationKey(
    "Only these status pages can show this event or notify their subscribers. Unlike an incident, an event with none picked shows on no status page.",
  ),
  templatePickerDescription: translationKey(
    "Only these status pages can show events from this template or notify their subscribers. With none picked, they show on no status page.",
  ),
  pickerPlaceholder: translationKey("Not shown on any status page"),
  notShownWarning: translationKey(
    "This event will not appear on any status page.",
  ),
  templateNotShownWarning: translationKey(
    "Events from this template will not appear on any status page.",
  ),
  // The event's header and details, for an event on no status page.
  notShownFact: translationKey("Not shown on any status page"),
};

/*
 * Whether a status page picker's form value holds no page, in whatever
 * shape the form holds it (getIdsFromFormValue).
 */
export const hasNoStatusPagePicked: (value: unknown) => boolean = (
  value: unknown,
): boolean => {
  return getIdsFromFormValue(value).length === 0;
};

export default MaintenanceStatusPagesCopy;
