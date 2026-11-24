import { translationKey } from "Common/Types/Translator";
import IncidentFromAlerts, {
  AlertOwnerIds,
} from "Common/Utils/Incident/IncidentFromAlerts";

/*
 * THE ALERTS' OWNERS ON THE DECLARE INCIDENT PAGE (#10867).
 *
 * Declaring an incident from an alert used to leave its Owners field empty,
 * and the people who own the alert - the ones already working it - had to
 * be picked again, in the middle of an outage. Now the incident starts with
 * them:
 *
 *   - when the declarer may add owners, the Owners field (under More
 *     fields) starts with every person and team that owns one of the
 *     alerts, and the banner over the form names them and says where to
 *     change them. What the field holds when the form is sent is the
 *     declaration's: the page tells the server not to add the alerts'
 *     owners itself (INCIDENT_CARRY_OVER_ALERT_OWNERS_KEY false), so an
 *     owner the declarer took out stays out, private incident or not;
 *   - when the declarer may not add owners - a role that may declare
 *     incidents and link alerts but not add incident owners - picking them
 *     in the field would refuse the whole declaration. So the field is left
 *     as it was, the server adds the alerts' owners itself once the incident
 *     exists (as it does for an incident declared from alerts through the
 *     API, an alert incident rule or a chat), and the banner says so;
 *   - when who owns the alerts could not be read, the server adds them all
 *     the same, and the banner says so without naming them;
 *   - an alert with no owners says nothing about owners.
 *
 * Nobody is told twice: the owners are added as every owner an incident
 * starts with is, before its "Incident Created" notification goes out, and
 * an owner the incident already has is not added again.
 *
 * React-free, so App's tests and the docs tests read the same words.
 */

export enum AlertOwnersOnDeclareMode {
  // No owner to carry over: nothing is said, nothing is sent.
  None = "None",
  // The Owners field starts with them, and the declarer can change it.
  InOwnersField = "InOwnersField",
  // OneUptime adds them once the incident is declared.
  AddedOnDeclare = "AddedOnDeclare",
}

export interface AlertOwnersOnDeclare {
  mode: AlertOwnersOnDeclareMode;
  // Who carries over, when it could be read; empty otherwise.
  owners: AlertOwnerIds;
  // Whether the owners could be read, so the banner can name them.
  areOwnersKnown: boolean;
}

export const NO_ALERT_OWNERS_ON_DECLARE: AlertOwnersOnDeclare = {
  mode: AlertOwnersOnDeclareMode.None,
  owners: { userIds: [], teamIds: [] },
  areOwnersKnown: true,
};

/*
 * How the page carries the alerts' owners over, from who owns them (null:
 * that could not be read) and whether the declarer may add owners to an
 * incident - both kinds the alerts have.
 */
export const getAlertOwnersOnDeclare: (data: {
  owners: AlertOwnerIds | null;
  mayAddOwnerUsers: boolean;
  mayAddOwnerTeams: boolean;
}) => AlertOwnersOnDeclare = (data: {
  owners: AlertOwnerIds | null;
  mayAddOwnerUsers: boolean;
  mayAddOwnerTeams: boolean;
}): AlertOwnersOnDeclare => {
  if (!data.owners) {
    return {
      mode: AlertOwnersOnDeclareMode.AddedOnDeclare,
      owners: { userIds: [], teamIds: [] },
      areOwnersKnown: false,
    };
  }

  if (IncidentFromAlerts.countAlertOwners(data.owners) === 0) {
    return NO_ALERT_OWNERS_ON_DECLARE;
  }

  const mayAddThem: boolean =
    (data.owners.userIds.length === 0 || data.mayAddOwnerUsers) &&
    (data.owners.teamIds.length === 0 || data.mayAddOwnerTeams);

  return {
    mode: mayAddThem
      ? AlertOwnersOnDeclareMode.InOwnersField
      : AlertOwnersOnDeclareMode.AddedOnDeclare,
    owners: data.owners,
    areOwnersKnown: true,
  };
};

/*
 * Whether the declaration tells the server not to add the alerts' owners
 * itself: only when the Owners field started with them, and so says who
 * owns the incident.
 */
export const isOwnersFieldTheAlertOwnersSource: (
  state: AlertOwnersOnDeclare,
) => boolean = (state: AlertOwnersOnDeclare): boolean => {
  return state.mode === AlertOwnersOnDeclareMode.InOwnersField;
};

// The Owners field starts with them: where to change them.
export const ALERT_OWNERS_IN_FIELD_ONE_ALERT: string = translationKey(
  "The alert's owners own the incident too. Change them under More fields before you declare.",
);

export const ALERT_OWNERS_IN_FIELD_SEVERAL_ALERTS: string = translationKey(
  "The owners of these alerts own the incident too. Change them under More fields before you declare.",
);

// OneUptime adds them as it declares the incident.
export const ALERT_OWNERS_ADDED_ONE_ALERT: string = translationKey(
  "The alert's owners own the incident too, once it is declared.",
);

export const ALERT_OWNERS_ADDED_SEVERAL_ALERTS: string = translationKey(
  "The owners of these alerts own the incident too, once it is declared.",
);

/*
 * The banner's sentence about the alerts' owners, said of one alert or of
 * several - or null when there is nothing to say.
 */
export const getAlertOwnersOnDeclareSentence: (
  state: AlertOwnersOnDeclare,
  alertCount: number,
) => string | null = (
  state: AlertOwnersOnDeclare,
  alertCount: number,
): string | null => {
  const isOneAlert: boolean = alertCount === 1;

  switch (state.mode) {
    case AlertOwnersOnDeclareMode.InOwnersField:
      return isOneAlert
        ? ALERT_OWNERS_IN_FIELD_ONE_ALERT
        : ALERT_OWNERS_IN_FIELD_SEVERAL_ALERTS;
    case AlertOwnersOnDeclareMode.AddedOnDeclare:
      return isOneAlert
        ? ALERT_OWNERS_ADDED_ONE_ALERT
        : ALERT_OWNERS_ADDED_SEVERAL_ALERTS;
    case AlertOwnersOnDeclareMode.None:
    default:
      return null;
  }
};

/*
 * The banner's sentence when an alert is private: Private Incident starts
 * switched on, and what that means while it stays on. Who owns it is the
 * owners' sentence above.
 */
export const PRIVATE_INCIDENT_FROM_ALERTS: string = translationKey(
  "At least one of these alerts is private, so Private Incident starts switched on. While it stays on, only the incident's owners, Project Owners and Project Admins can see it.",
);
