import TeamMembershipRemoval from "./TeamMembershipRemoval";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import Permission from "Common/Types/Permission";
import {
  MAX_PEOPLE_PER_PROJECT_REMOVAL_REACH,
  PROJECT_REMOVAL_REACH_ROUTE,
  PersonKeptInProject,
  readProjectRemovalReachAnswer,
  toProjectRemovalReachRequestJSON,
} from "Common/Types/Team/ProjectRemovalReach";
import { PluralTemplate } from "Common/Types/Translator";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import GrantablePermission from "Common/UI/Utils/GrantablePermission";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, { ModelAction } from "Common/UI/Utils/PermissionGate";
import { joinSentences } from "Common/UI/Utils/SentenceSeparator";
import {
  composedValue,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  MutableRefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * REMOVE FROM PROJECT, SAID BEFORE IT IS PRESSED (#6599).
 *
 * Remove from Project takes someone off every team of the project, or off
 * none: a reader whose Remove Team Members reaches only the teams they own
 * is refused, and the person stays (TeamMemberService.
 * assertCallerMayRemoveUserFromProject). The refusal was right, but it came
 * after the confirmation. So for such a reader - one who may remove people,
 * but not across the whole project - the Users list and the person's page
 * ask the server first, for the people they show (Types/Team/
 * ProjectRemovalReach), and lock Remove from Project for whoever would
 * stay: in the row's ⋯ menu, in Bulk Actions and on the person's page,
 * saying which teams keep them there - only the teams the reader may read,
 * the others counted - and, when the reader may take them off any team,
 * where to do that instead.
 *
 * Nobody else is asked about: a Project Owner, a Project Admin, a master
 * admin or anyone who may remove people across the whole project reaches
 * every membership, and someone who may remove nobody already sees Remove
 * from Project locked by their permissions. A failed answer locks nothing:
 * the server still refuses what it must, and says why.
 */

/*
 * What removes people across the whole project, as Remove from Project
 * reaches them: the team member table's delete permissions.
 */
export const PROJECT_REMOVAL_PERMISSIONS: ReadonlyArray<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.DeleteProjectTeam,
  Permission.RemoveProjectTeamMembers,
];

export const PROJECT_REMOVAL_LOCK_COPY: {
  namedTeams: string;
  unnamedTeams: PluralTemplate;
  goToTeams: string;
  namedAndOtherTeams: PluralTemplate;
  bulkIntro: PluralTemplate;
} = {
  // The teams that keep them, by the names the reader may read.
  namedTeams: translationKey(
    "Your role can't remove people from {{teams}}, so they would stay in this project.",
  ),
  // None of those teams is one the reader may read: how many, never which.
  unnamedTeams: {
    one: "Your role can't remove people from {{count}} of their teams, so they would stay in this project.",
    other:
      "Your role can't remove people from {{count}} of their teams, so they would stay in this project.",
  },
  // Said when the reader may take them off one of their teams at least.
  goToTeams: translationKey(
    "Remove them from your teams on their Teams page instead.",
  ),
  // The named teams, and the ones the reader may not read, counted.
  namedAndOtherTeams: {
    one: "{{teams}} and {{count}} other team",
    other: "{{teams}} and {{count}} other teams",
  },
  // Above the names of the selected people a bulk Remove from Project skips.
  bulkIntro: {
    one: "{{count}} of the selected people stays in this project, because your role can't remove them from all of their teams:",
    other:
      "{{count}} of the selected people stay in this project, because your role can't remove them from all of their teams:",
  },
};

/*
 * Whether the signed-in reader's Remove from Project can stop short of a
 * whole project: they may remove people (the table's delete), but not
 * across the whole project. Only then is the server asked.
 */
export const isProjectRemovalReachAsked: () => boolean = (): boolean => {
  if (
    GrantablePermission.canCurrentUserActOnWholeProject([
      ...PROJECT_REMOVAL_PERMISSIONS,
    ])
  ) {
    return false;
  }

  return PermissionGate.check(new TeamMember(), ModelAction.Delete).isAllowed;
};

/*
 * Of these people, the ones the reader's Remove from Project would leave in
 * the current project, as the server reads it - or null when it could not
 * be read, and nothing is locked.
 */
export const fetchPeopleKeptInProject: (
  userIds: Array<string>,
) => Promise<Array<PersonKeptInProject> | null> = async (
  userIds: Array<string>,
): Promise<Array<PersonKeptInProject> | null> => {
  const asked: Array<string> = Array.from(
    new Set<string>(
      userIds
        .map((userId: string): string => {
          return userId.trim().toLowerCase();
        })
        .filter((userId: string): boolean => {
          return Boolean(userId);
        }),
    ),
  ).slice(0, MAX_PEOPLE_PER_PROJECT_REMOVAL_REACH);

  if (asked.length === 0) {
    return [];
  }

  try {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post<JSONObject>({
        url: URL.fromString(APP_API_URL.toString()).addRoute(
          PROJECT_REMOVAL_REACH_ROUTE,
        ),
        data: toProjectRemovalReachRequestJSON(asked),
        headers: ModelAPI.getCommonHeaders(),
      });

    if (response instanceof HTTPErrorResponse || !response.isSuccess()) {
      return null;
    }

    // Only people who were asked about: an answer can name nobody else.
    const askedIds: Set<string> = new Set<string>(asked);

    return readProjectRemovalReachAnswer(response.data).filter(
      (person: PersonKeptInProject): boolean => {
        return askedIds.has(person.userId);
      },
    );
  } catch {
    return null;
  }
};

// The person a row of the Users list, or a membership, stands for.
export const getRowUserId: (row: TeamMember) => string = (
  row: TeamMember,
): string => {
  return (
    row.userId?.toString() ||
    row.user?.id?.toString() ||
    row.user?._id?.toString() ||
    ""
  )
    .trim()
    .toLowerCase();
};

// The teams that keep them, as the sentence names them.
const getKeepingTeams: (
  person: PersonKeptInProject,
  sentence: Translator,
) => string = (person: PersonKeptInProject, sentence: Translator): string => {
  const names: string = TeamMembershipRemoval.formatNamesInLanguage(
    person.teamNames,
    sentence,
  );

  if (person.hiddenTeamCount === 0) {
    return names;
  }

  return sentence.translatePlural(
    PROJECT_REMOVAL_LOCK_COPY.namedAndOtherTeams,
    person.hiddenTeamCount,
    { teams: names },
  );
};

/*
 * Why Remove from Project is locked for this person, in the reader's
 * words: which teams keep them in the project, and - when the reader may
 * take them off any team - where to do that instead.
 */
export const getProjectRemovalLockReason: (
  person: PersonKeptInProject,
  translator: Translator,
) => string = (person: PersonKeptInProject, translator: Translator): string => {
  const keeps: string =
    person.teamNames.length > 0
      ? translator.translateTemplate(PROJECT_REMOVAL_LOCK_COPY.namedTeams, {
          teams: composedValue((sentence: Translator): string => {
            return getKeepingTeams(person, sentence);
          }),
        })
      : translator.translatePlural(
          PROJECT_REMOVAL_LOCK_COPY.unnamedTeams,
          person.hiddenTeamCount,
        );

  if (!person.hasTeamInReach) {
    return keeps;
  }

  // Two whole sentences, side by side, as the reader's script runs them.
  return joinSentences([
    keeps,
    translator.translateText(PROJECT_REMOVAL_LOCK_COPY.goToTeams) ||
      PROJECT_REMOVAL_LOCK_COPY.goToTeams,
  ]);
};

export interface ProjectRemovalReach {
  // Whether this reader's Remove from Project is asked about at all.
  isAsked: boolean;
  // For the ModelTable: the rows it has just drawn.
  onFetchSuccess: (rows: Array<TeamMember>) => void;
  // Whom this row stands for, when Remove from Project would leave them in.
  getPersonKept: (row: TeamMember) => PersonKeptInProject | undefined;
  // The row's Remove from Project lock: why, or undefined when it may go.
  getDeleteDisabledReason: (row: TeamMember) => string | undefined;
}

/*
 * The Users list's half: hand `onFetchSuccess` to the ModelTable, and
 * `getDeleteDisabledReason` to its row lock. What each page answered is
 * kept for the visit, so the people a bulk Remove from Project selected on
 * an earlier page are still known; a page read again replaces what it
 * said of its own people.
 */
export const useProjectRemovalReach: () => ProjectRemovalReach =
  (): ProjectRemovalReach => {
    const translator: Translator = useTranslator();
    const isAsked: boolean = isProjectRemovalReachAsked();

    const [kept, setKept] = useState<ReadonlyMap<string, PersonKeptInProject>>(
      new Map<string, PersonKeptInProject>(),
    );

    /*
     * The ModelTable calls the onFetchSuccess it had when it fetched, which
     * can be a render's before: whether to ask is read from a ref, so the
     * latest decides.
     */
    const isAskedRef: MutableRefObject<boolean> = useRef<boolean>(isAsked);
    isAskedRef.current = isAsked;

    const onFetchSuccess: (rows: Array<TeamMember>) => void = useCallback(
      (rows: Array<TeamMember>): void => {
        if (!isAskedRef.current) {
          return;
        }

        const userIds: Array<string> = rows
          .map((row: TeamMember): string => {
            return getRowUserId(row);
          })
          .filter((userId: string): boolean => {
            return Boolean(userId);
          });

        if (userIds.length === 0) {
          return;
        }

        fetchPeopleKeptInProject(userIds)
          .then((people: Array<PersonKeptInProject> | null): void => {
            if (!people) {
              return;
            }

            setKept(
              (
                current: ReadonlyMap<string, PersonKeptInProject>,
              ): ReadonlyMap<string, PersonKeptInProject> => {
                const next: Map<string, PersonKeptInProject> = new Map(current);

                // What this page said of its people replaces what was known.
                for (const userId of userIds) {
                  next.delete(userId);
                }

                for (const person of people) {
                  next.set(person.userId, person);
                }

                return next;
              },
            );
          })
          .catch((): void => {
            // fetchPeopleKeptInProject answers null rather than throw.
          });
      },
      [],
    );

    const getPersonKept: (row: TeamMember) => PersonKeptInProject | undefined =
      useCallback(
        (row: TeamMember): PersonKeptInProject | undefined => {
          if (!isAsked) {
            return undefined;
          }

          return kept.get(getRowUserId(row));
        },
        [isAsked, kept],
      );

    const getDeleteDisabledReason: (row: TeamMember) => string | undefined =
      useCallback(
        (row: TeamMember): string | undefined => {
          const person: PersonKeptInProject | undefined = getPersonKept(row);

          return person
            ? getProjectRemovalLockReason(person, translator)
            : undefined;
        },
        [getPersonKept, translator],
      );

    return {
      isAsked: isAsked,
      onFetchSuccess: onFetchSuccess,
      getPersonKept: getPersonKept,
      getDeleteDisabledReason: getDeleteDisabledReason,
    };
  };

export interface PersonRemovalReach {
  // Still being read: Remove from Project waits for the answer.
  isReading: boolean;
  // The person, when Remove from Project would leave them in.
  person: PersonKeptInProject | null;
}

/*
 * The person's page's half: whether this one person would stay, read once
 * as the page opens (and again when `readAgain` changes). Not asked about,
 * the answer is at once nobody.
 */
export const usePersonRemovalReach: (data: {
  userId: string;
  readAgain?: unknown;
}) => PersonRemovalReach = (data: {
  userId: string;
  readAgain?: unknown;
}): PersonRemovalReach => {
  const isAsked: boolean = isProjectRemovalReachAsked();
  const userId: string = data.userId.trim().toLowerCase();

  const [answer, setAnswer] = useState<PersonRemovalReach>({
    isReading: isAsked,
    person: null,
  });

  useEffect(() => {
    if (!isAsked || !userId) {
      setAnswer({ isReading: false, person: null });
      return;
    }

    let isCurrent: boolean = true;

    setAnswer({ isReading: true, person: null });

    fetchPeopleKeptInProject([userId])
      .then((people: Array<PersonKeptInProject> | null): void => {
        if (!isCurrent) {
          return;
        }

        setAnswer({
          isReading: false,
          person:
            people?.find((person: PersonKeptInProject): boolean => {
              return person.userId === userId;
            }) || null,
        });
      })
      .catch((): void => {
        if (isCurrent) {
          setAnswer({ isReading: false, person: null });
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [isAsked, userId, data.readAgain]);

  return answer;
};
