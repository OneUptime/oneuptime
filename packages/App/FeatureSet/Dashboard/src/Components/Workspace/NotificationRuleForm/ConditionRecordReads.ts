import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import Team from "Common/Models/DatabaseModels/Team";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import Query from "Common/Types/BaseDatabase/Query";
import Search from "Common/Types/BaseDatabase/Search";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import NotificationRuleCondition, {
  NotificationRuleConditionCheckOn,
} from "Common/Types/Workspace/NotificationRules/NotificationRuleCondition";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import RecordsById from "Common/UI/Utils/RecordsById";
import { getSharedNameSelect } from "Common/UI/Utils/SharedNameOptions";
import { MutableRefObject, useEffect, useRef, useState } from "react";

/*
 * WHAT A WORKSPACE RULE'S CONDITION NEEDS READ, BY WHAT IT HOLDS (#10689).
 *
 * The rules and summaries pages read the project's first 10,000 on-call
 * policies and teams whole, for a condition to work out:
 *
 *   - which policies an On-Call Policy Name condition's words name today,
 *     for "Use On-Call Policy instead" (PolicyNameConditionSwitch): a
 *     policy past them was never among them;
 *   - which of an owners condition's ids are teams, the others being
 *     people: a team past them was taken for a person, and read "No longer
 *     in this project".
 *
 * Each is read by what the condition holds now: the policies whose name
 * holds the words, and the condition's ids as teams.
 */

const WORDS_SEARCH_DEBOUNCE_MS: number = 250;

// The words an On-Call Policy Name condition compares with, or none.
export const getPolicyNameWords: (
  condition: NotificationRuleCondition | undefined | null,
) => string = (
  condition: NotificationRuleCondition | undefined | null,
): string => {
  if (
    condition?.checkOn !==
      NotificationRuleConditionCheckOn.OnCallDutyPolicyName ||
    typeof condition.value !== "string"
  ) {
    return "";
  }

  return condition.value.trim();
};

/*
 * The policies whose name holds the words, searched on the server, letter
 * case aside - archived ones too: PolicyNameConditionSwitch leaves those
 * out itself. Every way of comparing a name the switch handles names only
 * policies whose name holds the words (they match, or "does not contain"
 * leaves them out), so these are all it needs.
 */
export const readPoliciesNamedByWords: (
  words: string,
) => Promise<Array<OnCallDutyPolicy>> = async (
  words: string,
): Promise<Array<OnCallDutyPolicy>> => {
  const result: ListResult<OnCallDutyPolicy> =
    await ModelAPI.getList<OnCallDutyPolicy>({
      modelType: OnCallDutyPolicy,
      query: { name: new Search(words) } as Query<OnCallDutyPolicy>,
      select: {
        _id: true,
        name: true,
        isArchived: true,
        // What tells policies of one name apart (#10064).
        ...getSharedNameSelect(OnCallDutyPolicy),
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      sort: { name: SortOrder.Ascending },
    });

  return result.data;
};

/*
 * The policies an On-Call Policy Name condition's words may name
 * (readPoliciesNamedByWords), read as the words are typed. Undefined while
 * there are no words, while they are read, or when they could not be.
 */
export const usePoliciesNamedByWords: (
  condition: NotificationRuleCondition | undefined | null,
) => Array<OnCallDutyPolicy> | undefined = (
  condition: NotificationRuleCondition | undefined | null,
): Array<OnCallDutyPolicy> | undefined => {
  const words: string = getPolicyNameWords(condition);
  const [read, setRead] = useState<{
    words: string;
    policies: Array<OnCallDutyPolicy>;
  } | null>(null);

  useEffect(() => {
    if (!words) {
      return;
    }

    let isCurrent: boolean = true;

    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      readPoliciesNamedByWords(words)
        .then((policies: Array<OnCallDutyPolicy>) => {
          if (isCurrent) {
            setRead({ words: words, policies: policies });
          }
        })
        .catch(() => {
          // Unread: the switch says nothing.
        });
    }, WORDS_SEARCH_DEBOUNCE_MS);

    return () => {
      isCurrent = false;
      clearTimeout(timer);
    };
  }, [words]);

  return read && read.words === words ? read.policies : undefined;
};

/*
 * Which of an owners condition's ids are the project's teams: those known
 * already - the page's, and the ones picked here, as teams or as people -
 * and any other read by its id as a team. An owners condition holds people
 * and teams in one list.
 *
 * Undefined while one is read, so a team is never drawn as a person who
 * left before it is known. One that could not be read is taken for a
 * person, as it always was.
 */
export const useTeamIdsAmong: (data: {
  ids: Array<string>;
  knownTeamIds: Set<string>;
  // Ids known not to be teams: people picked here.
  knownPeopleIds: Set<string>;
  isNeeded: boolean;
}) => Set<string> | undefined = (data: {
  ids: Array<string>;
  knownTeamIds: Set<string>;
  knownPeopleIds: Set<string>;
  isNeeded: boolean;
}): Set<string> | undefined => {
  // Each id read, by whether it is a team.
  const readRef: MutableRefObject<Map<string, boolean>> = useRef<
    Map<string, boolean>
  >(new Map<string, boolean>());
  // Drawn again as each read lands: what was read is in readRef.
  const [, setReads] = useState<number>(0);

  const toRead: Array<string> = data.isNeeded
    ? RecordsById.getValuesToRead({ ids: data.ids }).filter(
        (id: string): boolean => {
          return (
            !data.knownTeamIds.has(id) &&
            !data.knownPeopleIds.has(id) &&
            !readRef.current.has(id)
          );
        },
      )
    : [];
  const toReadKey: string = [...toRead].sort().join("|");

  useEffect(() => {
    if (!toReadKey) {
      return;
    }

    const ids: Array<string> = toReadKey.split("|");

    RecordsById.read<Team>({
      modelType: Team,
      ids: ids,
      select: { _id: true },
    })
      .then((teams: Array<Team>) => {
        const teamIds: Set<string> = new Set<string>(
          teams.map((team: Team): string => {
            return team._id?.toString().toLowerCase() || "";
          }),
        );

        for (const id of ids) {
          readRef.current.set(id, teamIds.has(id));
        }
      })
      .catch(() => {
        for (const id of ids) {
          readRef.current.set(id, false);
        }
      })
      .finally(() => {
        setReads((count: number): number => {
          return count + 1;
        });
      });
  }, [toReadKey]);

  if (toRead.length > 0) {
    return undefined;
  }

  const teamIds: Set<string> = new Set<string>(data.knownTeamIds);

  for (const [id, isTeam] of readRef.current) {
    if (isTeam) {
      teamIds.add(id);
    }
  }

  return teamIds;
};
