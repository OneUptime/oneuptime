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
