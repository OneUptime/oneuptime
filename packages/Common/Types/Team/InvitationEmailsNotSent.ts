import BadDataException from "../Exception/BadDataException";
import { JSONObject } from "../JSON";
import ObjectID from "../ObjectID";

/*
 * WHOSE INVITATION EMAIL WAS NOT SENT, ON A PAGE OF PEOPLE (#9511).
 *
 * On a server that can send email, the Users list showed every pending
 * invitation as Invitation Sent, even one whose email the mail service
 * refused - a wrong SMTP password, a full quota, an address the provider
 * rejected - so nothing reached the person, and the person who invited them
 * waited for an answer that would not come. The failure was in the
 * project's Email Logs all along. Now the lists ask the server about the
 * pending people they show (POST /team-member/invitation-emails-not-sent),
 * and say Email Not Sent for each one whose latest invitation email failed,
 * with the mail service's answer as the Email Log words it.
 *
 * The server reads the project's Email Logs with the caller's own
 * permissions, so nobody is told a failure, or its reason, that they could
 * not read under Notification Logs > Email: a caller who may not read them
 * is answered with nobody. One read per page of people, never one per row.
 *
 * This module is the request and the answer, read the same way on both
 * sides. React-free and server-free.
 */

// Where the Dashboard asks, under the API (the team member route's own path).
export const INVITATION_EMAILS_NOT_SENT_ROUTE: string =
  "/team-member/invitation-emails-not-sent";

// The most people one ask may name: a list's largest page.
export const MAX_PEOPLE_PER_INVITATION_EMAILS_READ: number = 100;

// Someone whose latest invitation email to the project was not sent.
export interface InvitationEmailNotSent {
  userId: string;
  /*
   * Why, as the project's Email Log holds it: the mail service's answer, or
   * OneUptime's sentence for a server with no email set up. Empty when the
   * row says nothing.
   */
  statusMessage: string;
}

// A user id as both sides compare it.
const toUserIdText: (userId: string) => string = (userId: string): string => {
  return userId.trim().toLowerCase();
};

/*
 * The people asked about, as the server takes them: their user ids, each
 * once, at most MAX_PEOPLE_PER_INVITATION_EMAILS_READ. Anything else is
 * refused rather than guessed at.
 */
export function readInvitationEmailsNotSentRequest(
  body: unknown,
): Array<ObjectID> {
  const userIds: unknown =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as JSONObject)["userIds"]
      : undefined;

  if (
    !Array.isArray(userIds) ||
    userIds.some((userId: unknown): boolean => {
      return typeof userId !== "string" || !ObjectID.isValidUUID(userId);
    })
  ) {
    throw new BadDataException("Name the people to ask about by user ID.");
  }

  const unique: Array<string> = Array.from(
    new Set<string>((userIds as Array<string>).map(toUserIdText)),
  );

  if (unique.length > MAX_PEOPLE_PER_INVITATION_EMAILS_READ) {
    throw new BadDataException(
      `Ask about at most ${MAX_PEOPLE_PER_INVITATION_EMAILS_READ} people at a time.`,
    );
  }

  return unique.map((userId: string): ObjectID => {
    return new ObjectID(userId);
  });
}

// The request, as the Dashboard sends it: each person once, at most a page.
export function toInvitationEmailsNotSentRequestJSON(
  userIds: ReadonlyArray<string>,
): JSONObject {
  return {
    userIds: Array.from(
      new Set<string>(
        userIds.map(toUserIdText).filter((userId: string): boolean => {
          return Boolean(userId);
        }),
      ),
    ).slice(0, MAX_PEOPLE_PER_INVITATION_EMAILS_READ),
  };
}

// The answer, as the route sends it.
export function toInvitationEmailsNotSentAnswerJSON(
  people: ReadonlyArray<InvitationEmailNotSent>,
): JSONObject {
  return {
    people: people.map((person: InvitationEmailNotSent): JSONObject => {
      return {
        userId: toUserIdText(person.userId),
        statusMessage: person.statusMessage,
      };
    }),
  };
}

/*
 * The answer, as the Dashboard reads it: a person with no id is dropped,
 * each person once, and a reason that is not text reads as none.
 */
export function readInvitationEmailsNotSentAnswer(
  data: unknown,
): Array<InvitationEmailNotSent> {
  const json: JSONObject =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as JSONObject)
      : {};
  const people: unknown = json["people"];

  if (!Array.isArray(people)) {
    return [];
  }

  const seen: Set<string> = new Set<string>();
  const answer: Array<InvitationEmailNotSent> = [];

  for (const entry of people) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }

    const person: JSONObject = entry as JSONObject;
    const userId: string =
      typeof person["userId"] === "string"
        ? toUserIdText(person["userId"])
        : "";

    if (!userId || seen.has(userId)) {
      continue;
    }

    seen.add(userId);
    answer.push({
      userId: userId,
      statusMessage:
        typeof person["statusMessage"] === "string"
          ? person["statusMessage"].trim()
          : "",
    });
  }

  return answer;
}

/*
 * THE SAME, ACROSS PROJECTS, FOR A MASTER ADMIN (#9518).
 *
 * The Admin Dashboard lists a project's people too - a project's Users,
 * one of its teams, one of its people - and a person's projects (Users > a
 * person > Projects), and every one of them said Invitation Sent for a
 * pending invitation whose email the mail service refused. It works in no
 * project, and a person's projects are many, so it names each pending
 * row's person with the row's project (POST /team-member/invitation-emails-
 * not-sent-in-projects), and the server reads those projects' Email Logs,
 * as master admins may (master admins only). The same rule decides: a
 * person's latest invitation email to that project. One read per page,
 * never one per row.
 */

// Where the Admin Dashboard asks, under the API.
export const INVITATION_EMAILS_NOT_SENT_IN_PROJECTS_ROUTE: string =
  "/team-member/invitation-emails-not-sent-in-projects";

// A person invited to a project: what a pending row of the Admin Dashboard stands for.
export interface ProjectInvitee {
  projectId: string;
  userId: string;
}

// Someone whose latest invitation email to a project was not sent.
export interface ProjectInvitationEmailNotSent extends ProjectInvitee {
  // Why, as the project's Email Log holds it (InvitationEmailNotSent).
  statusMessage: string;
}

// A project invitee as both sides compare them: "<project id>/<user id>".
export function getProjectInviteeKey(invitee: ProjectInvitee): string {
  return `${toUserIdText(invitee.projectId)}/${toUserIdText(invitee.userId)}`;
}

/*
 * The invitees asked about, as the server takes them: a project and a
 * person each, each pair once, at most MAX_PEOPLE_PER_INVITATION_EMAILS_READ.
 * Anything else is refused rather than guessed at.
 */
export function readInvitationEmailsNotSentInProjectsRequest(
  body: unknown,
): Array<{ projectId: ObjectID; userId: ObjectID }> {
  const invitees: unknown =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as JSONObject)["invitees"]
      : undefined;

  const isInvitee: (entry: unknown) => boolean = (entry: unknown): boolean => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return false;
    }

    const projectId: unknown = (entry as JSONObject)["projectId"];
    const userId: unknown = (entry as JSONObject)["userId"];

    return (
      typeof projectId === "string" &&
      ObjectID.isValidUUID(projectId) &&
      typeof userId === "string" &&
      ObjectID.isValidUUID(userId)
    );
  };

  if (!Array.isArray(invitees) || !invitees.every(isInvitee)) {
    throw new BadDataException(
      "Name the people to ask about by project ID and user ID.",
    );
  }

  const unique: Map<string, ProjectInvitee> = new Map<string, ProjectInvitee>();

  for (const entry of invitees as Array<JSONObject>) {
    const invitee: ProjectInvitee = {
      projectId: toUserIdText(entry["projectId"] as string),
      userId: toUserIdText(entry["userId"] as string),
    };

    unique.set(getProjectInviteeKey(invitee), invitee);
  }

  if (unique.size > MAX_PEOPLE_PER_INVITATION_EMAILS_READ) {
    throw new BadDataException(
      `Ask about at most ${MAX_PEOPLE_PER_INVITATION_EMAILS_READ} people at a time.`,
    );
  }

  return Array.from(unique.values()).map(
    (invitee: ProjectInvitee): { projectId: ObjectID; userId: ObjectID } => {
      return {
        projectId: new ObjectID(invitee.projectId),
        userId: new ObjectID(invitee.userId),
      };
    },
  );
}

// The request, as the Admin Dashboard sends it: each invitee once, at most a page.
export function toInvitationEmailsNotSentInProjectsRequestJSON(
  invitees: ReadonlyArray<ProjectInvitee>,
): JSONObject {
  const unique: Map<string, JSONObject> = new Map<string, JSONObject>();

  for (const invitee of invitees) {
    const projectId: string = toUserIdText(invitee.projectId);
    const userId: string = toUserIdText(invitee.userId);

    if (!projectId || !userId) {
      continue;
    }

    unique.set(getProjectInviteeKey(invitee), {
      projectId: projectId,
      userId: userId,
    });
  }

  return {
    invitees: Array.from(unique.values()).slice(
      0,
      MAX_PEOPLE_PER_INVITATION_EMAILS_READ,
    ),
  };
}

// The answer, as the route sends it.
export function toInvitationEmailsNotSentInProjectsAnswerJSON(
  invitees: ReadonlyArray<ProjectInvitationEmailNotSent>,
): JSONObject {
  return {
    invitees: invitees.map(
      (invitee: ProjectInvitationEmailNotSent): JSONObject => {
        return {
          projectId: toUserIdText(invitee.projectId),
          userId: toUserIdText(invitee.userId),
          statusMessage: invitee.statusMessage,
        };
      },
    ),
  };
}

/*
 * The answer, as the Admin Dashboard reads it: an invitee with no project
 * or no person is dropped, each pair once, and a reason that is not text
 * reads as none.
 */
export function readInvitationEmailsNotSentInProjectsAnswer(
  data: unknown,
): Array<ProjectInvitationEmailNotSent> {
  const json: JSONObject =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as JSONObject)
      : {};
  const invitees: unknown = json["invitees"];

  if (!Array.isArray(invitees)) {
    return [];
  }

  const seen: Set<string> = new Set<string>();
  const answer: Array<ProjectInvitationEmailNotSent> = [];

  for (const entry of invitees) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }

    const invitee: JSONObject = entry as JSONObject;
    const projectId: string =
      typeof invitee["projectId"] === "string"
        ? toUserIdText(invitee["projectId"])
        : "";
    const userId: string =
      typeof invitee["userId"] === "string"
        ? toUserIdText(invitee["userId"])
        : "";

    if (!projectId || !userId) {
      continue;
    }

    const key: string = getProjectInviteeKey({
      projectId: projectId,
      userId: userId,
    });

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    answer.push({
      projectId: projectId,
      userId: userId,
      statusMessage:
        typeof invitee["statusMessage"] === "string"
          ? invitee["statusMessage"].trim()
          : "",
    });
  }

  return answer;
}
