import IncidentEpisodeRoleMember from "Common/Models/DatabaseModels/IncidentEpisodeRoleMember";
import IncidentMember from "Common/Models/DatabaseModels/IncidentMember";
import PermissionGate, {
  ModelAction,
  PermissionGateOptions,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import {
  usePrivateRecordGateOptions,
  withPrivateRecordGateOptions,
} from "Common/UI/Utils/PrivateRecordScope";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * WHO MAY CHANGE AN INCIDENT'S OR AN EPISODE'S ROLES, AS THE PAGES ASK IT.
 *
 * The roles cards and the overview headers both offer what changes the
 * roles - the cards' Assign, Add More, Reassign and Remove, the headers'
 * Assign and the commander's name, which hands the role on - and ask the
 * same gates, with what the reader holds on a private record (its scope,
 * handed in). Kept apart from the cards, so a page that draws a card of
 * its own in a test still asks the gates the real card asks.
 */

/*
 * Why a reader who may not change the record's roles finds a button
 * locked: in the words of what they pressed, not the member table's
 * ("create this Incident Member"). The permissions that would allow it
 * follow.
 */
export const INCIDENT_ROLES_LOCKED_SENTENCE: string = translationKey(
  "You do not have permission to change this incident's roles.",
);

export const EPISODE_ROLES_LOCKED_SENTENCE: string = translationKey(
  "You do not have permission to change this episode's roles.",
);

/*
 * Whether the reader may hand one of the incident's roles on (Reassign):
 * the update of the role row's person, which is what the server asks of
 * it - never the create and the delete Reassign used to be (#10191). The
 * roles card's Reassign and the header's commander (#10195) both ask it.
 */
export const getIncidentRoleReassignGate: (
  privateRecordOptions: PermissionGateOptions | undefined,
) => PermissionGateResult = (
  privateRecordOptions: PermissionGateOptions | undefined,
): PermissionGateResult => {
  return PermissionGate.checkColumnUpdate(
    new IncidentMember(),
    "userId",
    withPrivateRecordGateOptions(
      { sentence: INCIDENT_ROLES_LOCKED_SENTENCE },
      privateRecordOptions,
    ),
  );
};

// The same for one of an incident episode's roles.
export const getEpisodeRoleReassignGate: (
  privateRecordOptions: PermissionGateOptions | undefined,
) => PermissionGateResult = (
  privateRecordOptions: PermissionGateOptions | undefined,
): PermissionGateResult => {
  return PermissionGate.checkColumnUpdate(
    new IncidentEpisodeRoleMember(),
    "userId",
    withPrivateRecordGateOptions(
      { sentence: EPISODE_ROLES_LOCKED_SENTENCE },
      privateRecordOptions,
    ),
  );
};

/*
 * WHAT THE OVERVIEW'S HEADER OFFERS OF THE RECORD'S PRIMARY ROLE: Assign,
 * while nobody holds it - a new role row - and the commander's name, which
 * hands it on - the role row's update (#10195). Asked with what the reader
 * holds on a private record and what the server says they may do on this
 * one (#10272): a reader whose permission does not reach the record sees
 * the name as plain text, and no Assign.
 */
export interface EventRoleGates {
  mayAssign: boolean;
  mayReassign: boolean;
}

const INCIDENT_ROLE_ROW: IncidentMember = new IncidentMember();
const EPISODE_ROLE_ROW: IncidentEpisodeRoleMember =
  new IncidentEpisodeRoleMember();

// The incident page's header asks these.
export const useIncidentRoleGates: () => EventRoleGates =
  (): EventRoleGates => {
    const options: PermissionGateOptions | undefined =
      usePrivateRecordGateOptions(INCIDENT_ROLE_ROW);

    return {
      mayAssign: PermissionGate.check(
        INCIDENT_ROLE_ROW,
        ModelAction.Create,
        options,
      ).isAllowed,
      mayReassign: getIncidentRoleReassignGate(options).isAllowed,
    };
  };

// And an incident episode's.
export const useEpisodeRoleGates: () => EventRoleGates = (): EventRoleGates => {
  const options: PermissionGateOptions | undefined =
    usePrivateRecordGateOptions(EPISODE_ROLE_ROW);

  return {
    mayAssign: PermissionGate.check(
      EPISODE_ROLE_ROW,
      ModelAction.Create,
      options,
    ).isAllowed,
    mayReassign: getEpisodeRoleReassignGate(options).isAllowed,
  };
};
