import BadDataException from "../Exception/BadDataException";
import { JSONObject } from "../JSON";
import ObjectID from "../ObjectID";

/*
 * WHOM REMOVE FROM PROJECT WOULD LEAVE IN THE PROJECT (#6599).
 *
 * Remove from Project takes someone off every team of the project, or off
 * none (TeamMemberService.assertCallerMayRemoveUserFromProject): a caller
 * whose Remove Team Members reaches only some teams - scoped to the teams
 * they own, say - is refused, and the person stays. The Users list and the
 * person's own page offered Remove from Project anyway, and said so only
 * after the confirmation. Now they ask first (POST
 * /team-member/project-removal-reach), for the people they show, and lock
 * Remove from Project for anyone who would stay, saying which teams keep
 * them there.
 *
 * The server answers with the caller's own permissions, the way the removal
 * itself is checked, so the lock and the refusal never disagree:
 *
 *   - only the people the caller could not take off every team are named;
 *     a caller who may remove anyone (a master admin, OneUptime itself) is
 *     answered with nobody;
 *   - a team's name only when the caller may read the team; the rest are
 *     counted, never named;
 *   - whether the caller may take the person off any team at all, so the
 *     page says where to go instead only when there is somewhere to go.
 *
 * This module is the request and the answer, read the same way on both
 * sides. React-free and server-free.
 */

// Where the Dashboard asks, under the API (the team member route's own path).
export const PROJECT_REMOVAL_REACH_ROUTE: string =
  "/team-member/project-removal-reach";

// The most people one ask may name: a list's largest page.
export const MAX_PEOPLE_PER_PROJECT_REMOVAL_REACH: number = 100;

// Someone Remove from Project would leave in the project.
export interface PersonKeptInProject {
  userId: string;
  /*
   * The teams the caller may not take them off, by name, for the teams the
   * caller may read: sorted, each once.
   */
  teamNames: Array<string>;
  // Those teams the caller may not read, counted, never named.
  hiddenTeamCount: number;
  // Whether the caller may take them off at least one of their teams.
  hasTeamInReach: boolean;
}

/*
 * The people asked about, as the server takes them: their user ids, each
 * once, at most MAX_PEOPLE_PER_PROJECT_REMOVAL_REACH. Anything else is
 * refused rather than guessed at.
 */
export function readProjectRemovalReachRequest(body: unknown): Array<ObjectID> {
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
    new Set<string>(
      (userIds as Array<string>).map((userId: string): string => {
        return userId.trim().toLowerCase();
      }),
    ),
  );

  if (unique.length > MAX_PEOPLE_PER_PROJECT_REMOVAL_REACH) {
    throw new BadDataException(
      `Ask about at most ${MAX_PEOPLE_PER_PROJECT_REMOVAL_REACH} people at a time.`,
    );
  }

  return unique.map((userId: string): ObjectID => {
    return new ObjectID(userId);
  });
}

// The request, as the Dashboard sends it.
export function toProjectRemovalReachRequestJSON(
  userIds: ReadonlyArray<string>,
): JSONObject {
  return {
    userIds: Array.from(
      new Set<string>(
        userIds
          .map((userId: string): string => {
            return userId.trim().toLowerCase();
          })
          .filter((userId: string): boolean => {
            return Boolean(userId);
          }),
      ),
    ),
  };
}

// A list of team names: trimmed, each once, in the reader's alphabetical order.
export function toSortedTeamNames(names: ReadonlyArray<string>): Array<string> {
  return Array.from(
    new Set<string>(
      names
        .map((name: string): string => {
          return name.trim();
        })
        .filter((name: string): boolean => {
          return Boolean(name);
        }),
    ),
  ).sort((a: string, b: string): number => {
    return a.localeCompare(b, undefined, { sensitivity: "base" });
  });
}

// The answer, as the route sends it.
export function toProjectRemovalReachAnswerJSON(
  people: ReadonlyArray<PersonKeptInProject>,
): JSONObject {
  return {
    people: people.map((person: PersonKeptInProject): JSONObject => {
      return {
        userId: person.userId,
        teamNames: toSortedTeamNames(person.teamNames),
        hiddenTeamCount: Math.max(0, Math.floor(person.hiddenTeamCount)),
        hasTeamInReach: person.hasTeamInReach,
      };
    }),
  };
}

/*
 * The answer, as the Dashboard reads it: a person with no id, or with no
 * team keeping them - none named and none counted - is dropped, so a lock
 * never says nothing; each person once.
 */
export function readProjectRemovalReachAnswer(
  data: unknown,
): Array<PersonKeptInProject> {
  const json: JSONObject =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as JSONObject)
      : {};
  const people: unknown = json["people"];

  if (!Array.isArray(people)) {
    return [];
  }

  const seen: Set<string> = new Set<string>();
  const answer: Array<PersonKeptInProject> = [];

  for (const entry of people) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }

    const person: JSONObject = entry as JSONObject;
    const userId: string =
      typeof person["userId"] === "string"
        ? person["userId"].trim().toLowerCase()
        : "";

    if (!userId || seen.has(userId)) {
      continue;
    }

    const teamNames: Array<string> = toSortedTeamNames(
      Array.isArray(person["teamNames"])
        ? (person["teamNames"] as Array<unknown>).filter(
            (name: unknown): name is string => {
              return typeof name === "string";
            },
          )
        : [],
    );

    const rawHidden: unknown = person["hiddenTeamCount"];
    const hiddenTeamCount: number =
      typeof rawHidden === "number" && Number.isFinite(rawHidden)
        ? Math.max(0, Math.floor(rawHidden))
        : 0;

    if (teamNames.length === 0 && hiddenTeamCount === 0) {
      continue;
    }

    seen.add(userId);
    answer.push({
      userId: userId,
      teamNames: teamNames,
      hiddenTeamCount: hiddenTeamCount,
      hasTeamInReach: person["hasTeamInReach"] === true,
    });
  }

  return answer;
}
