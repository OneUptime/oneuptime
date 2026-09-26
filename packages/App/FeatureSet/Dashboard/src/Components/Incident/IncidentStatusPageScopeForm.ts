import IncidentScopeAddedPagesNotification, {
  IncidentScopeAddedPagesNotificationAction,
} from "Common/Types/StatusPage/IncidentScopeAddedPagesNotification";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";

/*
 * The React-free half of editing an incident's status page scope
 * (Incident.statusPages): reading ids out of form values, and working out
 * what an edit adds and removes. The pages and components that show the
 * picker share these, and App/Tests exercises them directly.
 */

export interface NamedStatusPage {
  id: string;
  name: string;
}

/*
 * The ids in a form value, in whatever shape the form holds them: bare id
 * strings (the entity dropdown), ObjectIDs, models or {_id, name} objects
 * (values loaded from an incident or a template, the affected resources
 * picker), or {value, label} dropdown options. Lower-cased, without
 * duplicates, in the order first seen.
 */
export const getIdsFromFormValue: (value: unknown) => Array<string> = (
  value: unknown,
): Array<string> => {
  if (value === undefined || value === null || value === "") {
    return [];
  }

  const entries: Array<unknown> = Array.isArray(value) ? value : [value];

  return IncidentScopeAddedPagesNotification.normalizeStatusPageIds(
    entries.map((entry: unknown): unknown => {
      if (
        entry &&
        typeof entry === "object" &&
        !("_id" in entry) &&
        !("id" in entry) &&
        "value" in entry &&
        !("_type" in entry)
      ) {
        // A {value, label} dropdown option.
        return (entry as { value: unknown }).value;
      }

      return entry;
    }),
  );
};

/*
 * Status pages a loaded incident (or template) lists, as {id, name}, from the
 * models the card read.
 */
export const getNamedStatusPages: (
  statusPages:
    | Array<{ _id?: string | undefined; name?: string | undefined }>
    | undefined
    | null,
) => Array<NamedStatusPage> = (
  statusPages:
    | Array<{ _id?: string | undefined; name?: string | undefined }>
    | undefined
    | null,
): Array<NamedStatusPage> => {
  const named: Array<NamedStatusPage> = [];

  for (const statusPage of statusPages || []) {
    const id: string | undefined = getIdsFromFormValue(statusPage)[0];

    if (
      id &&
      !named.some((existing: NamedStatusPage): boolean => {
        return existing.id === id;
      })
    ) {
      named.push({
        id: id,
        name: statusPage.name?.trim() || "",
      });
    }
  }

  return named;
};

// The pages an edit adds to the scope it started from.
export const getAddedStatusPageIds: (data: {
  before: unknown;
  after: unknown;
}) => Array<string> = (data: {
  before: unknown;
  after: unknown;
}): Array<string> => {
  const before: Array<string> = getIdsFromFormValue(data.before);

  return getIdsFromFormValue(data.after).filter((id: string): boolean => {
    return !before.includes(id);
  });
};

/*
 * The pages an edit removes that were already sent the incident-created
 * notification (Incident.statusPagesNotifiedOnCreation). Removing them means
 * they hear nothing more about the incident, not even its resolution.
 */
export const getNotifiedStatusPagesBeingRemoved: (data: {
  loadedStatusPages: Array<NamedStatusPage>;
  notifiedStatusPageIds: unknown;
  formValue: unknown;
}) => Array<NamedStatusPage> = (data: {
  loadedStatusPages: Array<NamedStatusPage>;
  notifiedStatusPageIds: unknown;
  formValue: unknown;
}): Array<NamedStatusPage> => {
  const notified: Array<string> = getIdsFromFormValue(
    data.notifiedStatusPageIds,
  );
  const kept: Array<string> = getIdsFromFormValue(data.formValue);

  return data.loadedStatusPages.filter(
    (statusPage: NamedStatusPage): boolean => {
      return notified.includes(statusPage.id) && !kept.includes(statusPage.id);
    },
  );
};

/*
 * Whether an edit clears the scope of an incident that has one: the incident
 * then reaches every status page that lists its monitors.
 */
export const isClearingScope: (data: {
  isScoped: boolean | undefined;
  formValue: unknown;
}) => boolean = (data: {
  isScoped: boolean | undefined;
  formValue: unknown;
}): boolean => {
  return (
    data.isScoped === true && getIdsFromFormValue(data.formValue).length === 0
  );
};

/*
 * An incident scoped to pages that have all since been deleted: the flag is
 * never recomputed when join rows disappear, so it stays scoped - to nothing
 * - and is hidden from every status page (IncidentStatusPageScope).
 */
export const isScopedToDeletedStatusPages: (incident: {
  isScopedToStatusPages?: boolean | undefined;
  statusPages?: Array<unknown> | undefined;
}) => boolean = (incident: {
  isScopedToStatusPages?: boolean | undefined;
  statusPages?: Array<unknown> | undefined;
}): boolean => {
  return (
    incident.isScopedToStatusPages === true &&
    getIdsFromFormValue(incident.statusPages).length === 0
  );
};

/*
 * The incident as the scope card loaded it: what decides whether pages added
 * to its scope can be sent the incident-created notification.
 */
export interface AddedPagesNotificationIncident {
  statusPages?: unknown;
  statusPagesNotifiedOnCreation?: unknown;
  subscriberNotificationStatusOnIncidentCreated?:
    | StatusPageSubscriberNotificationStatus
    | undefined
    | null;
  shouldStatusPageSubscribersBeNotifiedOnIncidentCreated?: boolean | undefined;
  isVisibleOnStatusPage?: boolean | undefined;
  isPrivate?: boolean | undefined;
}

/*
 * Whether ticking "Send the incident-created notification to newly added
 * pages" would send anything for the edit as it stands: the pages it adds to
 * the loaded scope, and the server's own rule for them
 * (IncidentScopeAddedPagesNotification.getAction), so the box is offered
 * exactly when the server would queue the notification. It is not offered
 * when:
 *
 * - no page is added, or every added page was told already (it is in the
 *   incident's record of told pages);
 * - the incident is not set to notify on creation, is hidden or private;
 * - its notification went out before that record existed;
 * - the notification is queued or being sent: it reaches the added pages
 *   anyway.
 */
export const wouldQueueAddedPagesNotification: (data: {
  incident: AddedPagesNotificationIncident;
  formValue: unknown;
}) => boolean = (data: {
  incident: AddedPagesNotificationIncident;
  formValue: unknown;
}): boolean => {
  return (
    IncidentScopeAddedPagesNotification.getAction({
      addedStatusPageIds: getAddedStatusPageIds({
        before: data.incident.statusPages,
        after: data.formValue,
      }),
      incident: {
        subscriberNotificationStatusOnIncidentCreated:
          data.incident.subscriberNotificationStatusOnIncidentCreated,
        shouldStatusPageSubscribersBeNotifiedOnIncidentCreated:
          data.incident.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated,
        isVisibleOnStatusPage: data.incident.isVisibleOnStatusPage,
        isPrivate: data.incident.isPrivate,
        statusPagesNotifiedOnCreation:
          data.incident.statusPagesNotifiedOnCreation,
      },
    }) === IncidentScopeAddedPagesNotificationAction.Queue
  );
};

// "Site 03, Site 07" - names in the order given, blank ones left out.
export const joinStatusPageNames: (
  statusPages: Array<{ name: string }>,
) => string = (statusPages: Array<{ name: string }>): string => {
  return statusPages
    .map((statusPage: { name: string }): string => {
      return statusPage.name.trim();
    })
    .filter((name: string): boolean => {
      return name.length > 0;
    })
    .join(", ");
};
