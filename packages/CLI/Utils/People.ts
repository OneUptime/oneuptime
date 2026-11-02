import { executeApiRequest } from "../Core/ApiClient";
import { ResolvedCredentials } from "../Types/CLITypes";
import { DatabaseBaseModelType } from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import {
  CliFieldFlag,
  getCliFieldFlags,
  getModelApiPathOf,
} from "Common/Utils/DeveloperDocs/CliCommands";
import {
  INVITATION_EMAIL_FIELD,
  normalizePersonEmail,
} from "Common/Utils/DeveloperDocs/PeopleByEmail";

/*
 * PEOPLE NAMED BY THEIR EMAIL ADDRESS
 *
 * The API names a person by their user ID, and nobody knows anyone's ID.
 * So wherever a create or an update takes one (--user-id, --owner-users),
 * the CLI takes their address too (--user-email, --owner-user-emails, or
 * userEmail / ownerUserEmails in --data), finds the person and sends their
 * ID - the rules the Terraform provider follows
 * (Common/Utils/DeveloperDocs/PeopleByEmail.ts):
 *
 *   - the person is found among the API key's own project's members and
 *     invitees - its team members, the only place a project key can read
 *     who is in the project - by exact address, in any case. Nobody
 *     outside the key's project is ever found;
 *   - a team member named by an address nobody in the project has is
 *     invited by it, as the dashboard's Invite does;
 *   - one of the two, never both.
 */

// How far a lookup reads: one person's memberships are never this many.
const PEOPLE_LOOKUP_LIMIT: number = 100;

// Reads a string the API may wrap: "x", {"_type": ..., "value": "x"} or {"_id": "x"}.
function apiString(value: JSONValue | undefined): string {
  if (typeof value === "string") {
    return value;
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const wrapped: JSONObject = value as JSONObject;

    if (typeof wrapped["value"] === "string") {
      return wrapped["value"] as string;
    }

    if (typeof wrapped["_id"] === "string") {
      return wrapped["_id"] as string;
    }
  }

  return "";
}

function rowsOf(result: JSONValue): Array<JSONValue> {
  if (Array.isArray(result)) {
    return result as Array<JSONValue>;
  }

  const data: JSONValue | undefined = (result as JSONObject | null)?.["data"];

  return Array.isArray(data) ? (data as Array<JSONValue>) : [];
}

/*
 * The user ID of the member or invitee of the key's project with this
 * address, or null when nobody in the project has it. A refusal says what
 * the key needs - in words that never say "API key", which the error
 * handler reads as the key itself being refused (exit 2): this is a
 * permission the key lacks (exit 1).
 */
export async function findPersonIdByEmail(data: {
  credentials: ResolvedCredentials;
  email: string;
}): Promise<string | null> {
  const email: string = normalizePersonEmail(data.email);
  let result: JSONValue;

  try {
    result = await executeApiRequest({
      apiUrl: data.credentials.apiUrl,
      apiKey: data.credentials.apiKey,
      apiPath: getModelApiPathOf(TeamMember),
      operation: "list",
      query: { user: { email } },
      select: { _id: true, userId: true, user: { _id: true, email: true } },
      sort: { createdAt: "ASC" },
      skip: 0,
      limit: PEOPLE_LOOKUP_LIMIT,
    });
  } catch (error) {
    throw new Error(
      `The CLI finds ${data.email} among this project's members and invitees, and could not: ${
        error instanceof Error ? error.message : String(error)
      } It reads them as the project's team members, so the key needs a permission that may read those, such as Project Member, Project Admin or Read Teams. Or name the person by user ID instead.`,
    );
  }

  for (const row of rowsOf(result)) {
    const member: JSONObject = row as JSONObject;
    const user: JSONObject | undefined = member["user"] as
      | JSONObject
      | undefined;

    if (normalizePersonEmail(apiString(user?.["email"])) !== email) {
      continue;
    }

    const id: string = apiString(member["userId"]) || apiString(user?.["_id"]);

    if (id) {
      return id;
    }
  }

  return null;
}

function notInProjectError(email: string): Error {
  return new Error(
    `No one in this project, or invited to it, has the email address ${email}. Invite them with \`oneuptime team-member create --team-id <team-id> --user-email ${email}\`, or, if they changed their address in OneUptime, use the new one.`,
  );
}

export interface ResolvedPeople {
  data: JSONObject;
  // What the create sends beside its data: the address an invitation goes to.
  miscDataProps: JSONObject;
}

/*
 * The data with every person named by address named by ID instead: the
 * companion fields (userEmail, ownerUserEmails) taken out, their people's
 * IDs put in. A team member nobody in the project has the address of is
 * invited by it: the address goes in miscDataProps, as the dashboard sends
 * it, and the ID stays out.
 */
export async function resolvePeople(data: {
  modelType: DatabaseBaseModelType;
  credentials: ResolvedCredentials;
  data: JSONObject;
}): Promise<ResolvedPeople> {
  const resolved: JSONObject = { ...data.data };
  const miscDataProps: JSONObject = {};

  for (const flag of getCliFieldFlags(data.modelType)) {
    const person: CliFieldFlag["person"] = flag.person;

    if (!person || resolved[person.columnName] === undefined) {
      continue;
    }

    const given: JSONValue = resolved[person.columnName] as JSONValue;

    delete resolved[person.columnName];

    if (resolved[flag.columnName] !== undefined) {
      throw new Error(
        `Give ${flag.flag} or ${person.flag}, not both: each names the same ${person.isList ? "people" : "person"}.`,
      );
    }

    const emails: Array<string> = (Array.isArray(given) ? given : [given])
      .map((value: JSONValue): string => {
        return String(value).trim();
      })
      .filter((value: string): boolean => {
        return value.length > 0;
      });

    if (!person.isList) {
      const email: string | undefined = emails[0];

      if (!email) {
        throw new Error(`${person.flag} needs an email address.`);
      }

      const id: string | null = await findPersonIdByEmail({
        credentials: data.credentials,
        email,
      });

      if (id) {
        resolved[flag.columnName] = id;
      } else if (person.invitesByEmail) {
        miscDataProps[INVITATION_EMAIL_FIELD] = normalizePersonEmail(email);
      } else {
        throw notInProjectError(email);
      }

      continue;
    }

    const ids: Array<JSONObject> = [];

    for (const email of emails) {
      const id: string | null = await findPersonIdByEmail({
        credentials: data.credentials,
        email,
      });

      if (!id) {
        throw notInProjectError(email);
      }

      ids.push({ _id: id });
    }

    resolved[flag.columnName] = ids;
  }

  return { data: resolved, miscDataProps };
}
