import BadDataException from "../Exception/BadDataException";
import { JSONObject } from "../JSON";
import ObjectID from "../ObjectID";
import { readProjectMemberSearchText } from "./ProjectMemberSearch";

/*
 * WHO AN INVITATION'S EMAIL BOX SUGGESTS AS THE ADDRESS IS TYPED (#9701).
 *
 * Inviting someone to a team, or to the project, asked for their email and
 * nothing more, so inviting a colleague who was already in the project
 * meant finding their address elsewhere and typing it exactly. The box now
 * suggests people as it is typed in, and a click fills their address:
 *
 *   - the project's own people, as Search finds them (Server/Utils/Team/
 *     ProjectMemberSearch, #7036): by name or email, with the reader's own
 *     permissions, never anyone of another project. On OneUptime Cloud and
 *     on a server somebody runs alike;
 *   - on a server somebody runs (not OneUptime Cloud), to its master admin,
 *     who sees every account in the Admin Dashboard already: the server's
 *     other accounts too, as not in this project yet. And to anyone who may
 *     invite people to the project, once a master admin turns on Suggest
 *     Every Account When Inviting (#9744): off until then, for a server
 *     that hosts several organizations. Nobody else is ever shown an
 *     account of another project, there, and nobody at all on Cloud.
 *
 * Each says where they stand, so a pick is never a surprise: already in
 * the team being invited to, or invited to it and not yet accepted (both
 * offered for what they are, never picked: the invitation would be
 * refused); invited to the project and not yet accepted; a member; or not
 * in this project yet. Typing an address nobody has works as it always
 * did: the suggestions are only suggestions.
 *
 * Only someone whose address the reader may see is suggested: an
 * invitation is sent to an address. This module is the request and the
 * answer, read the same way on both sides. React-free and server-free.
 */

// Where the invitation forms ask, under the API (the team member route's own path).
export const INVITE_SUGGESTIONS_ROUTE: string =
  "/team-member/invite-suggestions";

// The most of the server's other accounts one answer suggests.
export const INVITE_SUGGESTIONS_SERVER_LIMIT: number = 5;

// The most people one answer lists: the project's, then the server's.
export const INVITE_SUGGESTIONS_LIMIT: number = 10;

// Where a suggested person stands, for the team or the project being invited to.
export enum InviteSuggestionStanding {
  // Accepted a membership of the team being invited to: nothing to invite.
  InThisTeam = "InThisTeam",
  // Invited to that team already, and not accepted yet.
  InvitedToThisTeam = "InvitedToThisTeam",
  // Invited to the project, accepted no invitation of it yet.
  Invited = "Invited",
  // A member of the project.
  Member = "Member",
  /*
   * An account on this server, not in this project: for a master admin, or
   * anyone who may invite while the server lets them (#9744).
   */
  NotInProject = "NotInProject",
}

export interface InviteSuggestion {
  userId: string;
  // Their name, or "" while they have none (invited, not signed up).
  name: string;
  email: string;
  standing: InviteSuggestionStanding;
}

export interface InviteSuggestionsRequest {
  // What was typed: trimmed, cut, long enough (readProjectMemberSearchText).
  text: string;
  // The team the invitation is for, when the form knows it.
  teamId: ObjectID | null;
}

// Whether a suggestion is offered to be picked: never one the team has.
export const isInviteSuggestionPickable: (
  suggestion: Pick<InviteSuggestion, "standing">,
) => boolean = (suggestion: Pick<InviteSuggestion, "standing">): boolean => {
  return (
    suggestion.standing !== InviteSuggestionStanding.InThisTeam &&
    suggestion.standing !== InviteSuggestionStanding.InvitedToThisTeam
  );
};

/*
 * Where a person stands, from their memberships of the project: of the
 * team being invited to first, then of the project as a whole.
 */
export const getInviteSuggestionStanding: (data: {
  memberships: ReadonlyArray<{
    teamId: string;
    hasAcceptedInvitation: boolean;
  }>;
  teamId: string | null;
}) => InviteSuggestionStanding = (data: {
  memberships: ReadonlyArray<{
    teamId: string;
    hasAcceptedInvitation: boolean;
  }>;
  teamId: string | null;
}): InviteSuggestionStanding => {
  if (data.memberships.length === 0) {
    return InviteSuggestionStanding.NotInProject;
  }

  const teamKey: string = (data.teamId || "").toLowerCase();

  const inThisTeam: Array<{ teamId: string; hasAcceptedInvitation: boolean }> =
    teamKey
      ? data.memberships.filter(
          (membership: {
            teamId: string;
            hasAcceptedInvitation: boolean;
          }): boolean => {
            return membership.teamId.toLowerCase() === teamKey;
          },
        )
      : [];

  if (
    inThisTeam.some(
      (membership: {
        teamId: string;
        hasAcceptedInvitation: boolean;
      }): boolean => {
        return membership.hasAcceptedInvitation;
      },
    )
  ) {
    return InviteSuggestionStanding.InThisTeam;
  }

  if (inThisTeam.length > 0) {
    return InviteSuggestionStanding.InvitedToThisTeam;
  }

  return data.memberships.some(
    (membership: {
      teamId: string;
      hasAcceptedInvitation: boolean;
    }): boolean => {
      return membership.hasAcceptedInvitation;
    },
  )
    ? InviteSuggestionStanding.Member
    : InviteSuggestionStanding.Invited;
};

/*
 * The request, as the server takes it: what was typed (at least two
 * letters, as Search's people take it), and the team, when one is named -
 * an id, or nothing.
 */
export function readInviteSuggestionsRequest(
  body: unknown,
): InviteSuggestionsRequest {
  const text: string = readProjectMemberSearchText(body);
  const teamId: unknown = (body as JSONObject)["teamId"];

  if (teamId === undefined || teamId === null || teamId === "") {
    return { text: text, teamId: null };
  }

  if (typeof teamId !== "string" || !ObjectID.isValidUUID(teamId.trim())) {
    throw new BadDataException(
      "The team to suggest people for must be a team's ID. Leave it out to suggest people for the project.",
    );
  }

  return { text: text, teamId: new ObjectID(teamId.trim()) };
}

const STANDINGS: ReadonlyArray<string> = Object.values(
  InviteSuggestionStanding,
);

// The answer, as the route sends it.
export function toInviteSuggestionsAnswerJSON(
  suggestions: ReadonlyArray<InviteSuggestion>,
): JSONObject {
  return {
    people: suggestions.map((suggestion: InviteSuggestion): JSONObject => {
      return {
        userId: suggestion.userId,
        name: suggestion.name,
        email: suggestion.email,
        standing: suggestion.standing,
      };
    }),
  };
}

/*
 * The answer, as the form reads it: a row with no person, no address, or
 * no standing it knows is dropped rather than drawn; each person once; at
 * most INVITE_SUGGESTIONS_LIMIT of them, in the order given.
 */
export function readInviteSuggestionsAnswer(
  data: unknown,
): Array<InviteSuggestion> {
  const json: JSONObject =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as JSONObject)
      : {};
  const people: unknown = json["people"];
  const seen: Set<string> = new Set<string>();
  const suggestions: Array<InviteSuggestion> = [];

  for (const entry of Array.isArray(people) ? people : []) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }

    const person: JSONObject = entry as JSONObject;
    const userId: unknown = person["userId"];
    const name: string =
      typeof person["name"] === "string" ? person["name"].trim() : "";
    const email: string =
      typeof person["email"] === "string" ? person["email"].trim() : "";
    const standing: unknown = person["standing"];

    if (typeof userId !== "string" || !userId || seen.has(userId)) {
      continue;
    }

    if (
      !email ||
      typeof standing !== "string" ||
      !STANDINGS.includes(standing)
    ) {
      continue;
    }

    seen.add(userId);
    suggestions.push({
      userId: userId,
      name: name,
      email: email,
      standing: standing as InviteSuggestionStanding,
    });

    if (suggestions.length >= INVITE_SUGGESTIONS_LIMIT) {
      break;
    }
  }

  return suggestions;
}
