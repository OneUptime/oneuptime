import BadDataException from "../Exception/BadDataException";
import { JSONObject } from "../JSON";

/*
 * SEARCH FINDS THE PROJECT'S PEOPLE (#7036).
 *
 * Cmd/Ctrl+K found services, schedules, teams and the rest by name, and
 * never a person: a project's people are its team memberships, and finding
 * one by name or email is a search through the membership to the user. The
 * Dashboard now asks the server (POST /team-member/search-members) with what
 * was typed, and the server searches the project's members by name and by
 * email, with the reader's own permissions, as the Users page lists them
 * (Server/Utils/Team/ProjectMemberSearch):
 *
 *   - Only someone who may see the project's people (the Users page) may ask;
 *     anyone else is refused.
 *   - Emails are searched, and shown, only for a reader the Users page shows
 *     them to.
 *   - Only the project's own members are found: someone in another project
 *     only, or an address no one has, gives the same empty answer, so an
 *     answer never says whether an email exists elsewhere.
 *   - Bound as Search's other record searches are: at least two letters,
 *     a few people per answer, asked once the reader stops typing.
 *
 * This module is the request and the answer, read the same way on both
 * sides. React-free and server-free.
 */

// Where the Dashboard asks, under the API (the team member route's own path).
export const PROJECT_MEMBER_SEARCH_ROUTE: string =
  "/team-member/search-members";

/*
 * The fewest letters a search needs, as Search's other record searches send
 * none shorter (PROVIDER_SEARCH_MIN_QUERY_LENGTH): one letter is in nearly
 * every name, and would list people for nothing.
 */
export const PROJECT_MEMBER_SEARCH_MIN_LENGTH: number = 2;

/*
 * The longest text searched for: a name or an address is shorter. Anything
 * longer is cut rather than refused, so a pasted line still finds whom it
 * starts with.
 */
export const PROJECT_MEMBER_SEARCH_MAX_LENGTH: number = 100;

// The most people one answer lists, as Search lists five of each kind.
export const PROJECT_MEMBER_SEARCH_LIMIT: number = 5;

export interface ProjectMemberSearchMatch {
  // The person, whose page is /users/<userId> in the project.
  userId: string;
  // Their name, or "" while they have none (invited, not signed up).
  name: string;
  // Their email, only for a reader who may see the project's emails.
  email?: string | undefined;
}

/*
 * What was typed, as the server takes it: text, trimmed and cut to its
 * limit, of at least PROJECT_MEMBER_SEARCH_MIN_LENGTH letters - a shorter
 * one is refused, never answered with everyone.
 */
export function readProjectMemberSearchText(body: unknown): string {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new BadDataException("The search must be a JSON object with text.");
  }

  const raw: unknown = (body as JSONObject)["text"];

  if (typeof raw !== "string") {
    throw new BadDataException("Send what was typed as text, a string.");
  }

  const text: string = raw
    .trim()
    .substring(0, PROJECT_MEMBER_SEARCH_MAX_LENGTH)
    .trim();

  if (text.length < PROJECT_MEMBER_SEARCH_MIN_LENGTH) {
    throw new BadDataException(
      `Type at least ${PROJECT_MEMBER_SEARCH_MIN_LENGTH} letters to search the project's members.`,
    );
  }

  return text;
}

// The answer, as the route sends it.
export function toProjectMemberSearchAnswerJSON(
  matches: ReadonlyArray<ProjectMemberSearchMatch>,
): JSONObject {
  return {
    members: matches.map((match: ProjectMemberSearchMatch): JSONObject => {
      const json: JSONObject = { userId: match.userId, name: match.name };

      if (match.email) {
        json["email"] = match.email;
      }

      return json;
    }),
  };
}

/*
 * The answer, as the Dashboard reads it: a row with no person, or with
 * neither a name nor an email to show, is dropped rather than drawn empty;
 * each person once; at most PROJECT_MEMBER_SEARCH_LIMIT of them.
 */
export function readProjectMemberSearchAnswer(
  data: unknown,
): Array<ProjectMemberSearchMatch> {
  const json: JSONObject =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as JSONObject)
      : {};
  const members: unknown = json["members"];
  const seen: Set<string> = new Set<string>();
  const matches: Array<ProjectMemberSearchMatch> = [];

  for (const entry of Array.isArray(members) ? members : []) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }

    const member: JSONObject = entry as JSONObject;
    const userId: unknown = member["userId"];
    const name: string =
      typeof member["name"] === "string" ? member["name"].trim() : "";
    const email: string =
      typeof member["email"] === "string" ? member["email"].trim() : "";

    if (typeof userId !== "string" || !userId || seen.has(userId)) {
      continue;
    }

    if (!name && !email) {
      continue;
    }

    seen.add(userId);
    matches.push({ userId, name, ...(email ? { email } : {}) });

    if (matches.length >= PROJECT_MEMBER_SEARCH_LIMIT) {
      break;
    }
  }

  return matches;
}

// Lowercase, accents aside: "José" is found by "jose".
const fold: (text: string) => string = (text: string): string => {
  return text.normalize("NFKD").replace(/[̀-ͯ]+/g, "").toLowerCase().trim();
};

/*
 * How well a person matches what was typed, best first: their name starts
 * with it, a word of their name does, their email does, or it is somewhere
 * in either.
 */
export function getProjectMemberMatchRank(
  match: ProjectMemberSearchMatch,
  text: string,
): number {
  const typed: string = fold(text);
  const name: string = fold(match.name);
  const email: string = fold(match.email || "");

  if (typed && name.startsWith(typed)) {
    return 0;
  }

  if (
    typed &&
    name.split(/\s+/).some((word: string): boolean => {
      return word.startsWith(typed);
    })
  ) {
    return 1;
  }

  if (typed && email.startsWith(typed)) {
    return 2;
  }

  return 3;
}

/*
 * The people an answer lists: each once, best match first, then by name
 * (a person with none by their email), at most
 * PROJECT_MEMBER_SEARCH_LIMIT of them.
 */
export function rankProjectMemberMatches(
  matches: ReadonlyArray<ProjectMemberSearchMatch>,
  text: string,
): Array<ProjectMemberSearchMatch> {
  const byUser: Map<string, ProjectMemberSearchMatch> = new Map();

  for (const match of matches) {
    if (!match.userId || (!match.name && !match.email)) {
      continue;
    }

    const known: ProjectMemberSearchMatch | undefined = byUser.get(
      match.userId,
    );

    // One person in several teams is one person; keep what is known of them.
    byUser.set(match.userId, {
      userId: match.userId,
      name: match.name || known?.name || "",
      ...(match.email || known?.email
        ? { email: match.email || known?.email }
        : {}),
    });
  }

  const sortName: (match: ProjectMemberSearchMatch) => string = (
    match: ProjectMemberSearchMatch,
  ): string => {
    return fold(match.name || match.email || "");
  };

  return Array.from(byUser.values())
    .sort(
      (a: ProjectMemberSearchMatch, b: ProjectMemberSearchMatch): number => {
        return (
          getProjectMemberMatchRank(a, text) -
            getProjectMemberMatchRank(b, text) ||
          sortName(a).localeCompare(sortName(b)) ||
          a.userId.localeCompare(b.userId)
        );
      },
    )
    .slice(0, PROJECT_MEMBER_SEARCH_LIMIT);
}
