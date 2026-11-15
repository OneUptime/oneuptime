import {
  OWNER_TEAMS_ON_CREATE_KEY,
  OWNER_USERS_ON_CREATE_KEY,
  takesOwnersOnCreate,
} from "../Database/OwnersOnCreate";
import { Argument, ComponentInputType } from "./Component";

/*
 * THE OWNERS AN INCIDENT OR ALERT A WORKFLOW CREATES STARTS WITH (#8198).
 *
 * The owners' Created notification of an incident or alert goes out about
 * a minute after its create, to every owner it has by then
 * (CreatedNotificationHold): a workflow that added the owners in a later
 * step - its owner models' Create One - reached it only while that step
 * came within the minute; one with a delay or a long step in between left
 * the real owners with an "added as owner" email only, and the project's
 * owners with the Created one. Create One Incident and Create One Alert now
 * take the owners with the create: Owner Users and Owner Teams, picked in
 * the step or taken from an earlier step. They are handed to the record's
 * service as the REST create hands them (Types/Database/OwnersOnCreate):
 * asked about before anything is saved
 * (OwnerRuleAssignment.checkOwnersPickedOnCreate), as the step, a Project
 * Admin of the workflow's project, and added before the Created
 * notification is let go - quietly, as a create form's owners are, so the
 * Created notification is the one they get.
 *
 * The server reads the settings
 * (Server/Types/Workflow/Components/BaseModel/OwnersOnCreateArgument). The
 * stored ids are what saved workflows keep: never changed.
 */

export const OWNER_USERS_ARGUMENT_ID: string = OWNER_USERS_ON_CREATE_KEY;
export const OWNER_TEAMS_ARGUMENT_ID: string = OWNER_TEAMS_ON_CREATE_KEY;

// The most of each one step hands over: a list longer than this was pasted by mistake.
export const MAX_OWNERS_ON_CREATE: number = 50;

// What a record of each table is called in the settings' words.
const NOUNS: Record<string, string> = {
  Incident: "incident",
  Alert: "alert",
};

type GetOwnersOnCreateArgumentsFunction = (
  tableName: string | undefined,
) => Array<Argument>;

// The owner settings of this table's Create One step: none for most tables.
export const getOwnersOnCreateArguments: GetOwnersOnCreateArgumentsFunction = (
  tableName: string | undefined,
): Array<Argument> => {
  if (!takesOwnersOnCreate(tableName)) {
    return [];
  }

  const noun: string = NOUNS[tableName!] || "record";

  return [
    {
      id: OWNER_USERS_ARGUMENT_ID,
      name: "Owner Users",
      type: ComponentInputType.UserList,
      required: false,
      description: `People who own the ${noun}, told it was created. Pick people of this project, or use a user's ID or email address from an earlier step.`,
    },
    {
      id: OWNER_TEAMS_ARGUMENT_ID,
      name: "Owner Teams",
      type: ComponentInputType.TeamList,
      required: false,
      description: `Teams who own the ${noun}: each member is told it was created. Pick teams, or use a team's ID from an earlier step.`,
    },
  ];
};
