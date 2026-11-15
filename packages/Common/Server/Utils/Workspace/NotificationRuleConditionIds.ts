import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import BadDataException from "../../../Types/Exception/BadDataException";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import {
  getCheckOnLabel,
  NotificationRuleConditionCheckOn,
} from "../../../Types/Workspace/NotificationRules/NotificationRuleCondition";
import OnCallDutyPolicyService from "../../Services/OnCallDutyPolicyService";
import TeamMemberService from "../../Services/TeamMemberService";
import TeamService from "../../Services/TeamService";
import QueryHelper from "../../Types/Database/QueryHelper";
import UUIDColumnFilter, {
  EXAMPLE_UUID,
} from "../../Types/Database/UUIDColumnFilter";

/*
 * THE PEOPLE, TEAMS AND POLICIES A RULE'S CONDITIONS NAME ARE THE PROJECT'S
 * OWN (#7554, #7583).
 *
 * An owners condition names people and teams by id, an on-call rule's
 * On-Call Policy condition names policies by id. Such a condition - of a
 * notification rule, or of a summary, which offers the same conditions - is
 * held, when it is created or its conditions are written again, to:
 *
 * - ids that are ids: each one text Postgres reads as a UUID, as every id
 *   the API takes is (#4831), refused the way a mistyped id is refused
 *   everywhere else. Each is saved as the database writes ids - lower case,
 *   hyphenated - as that is how a record's owners and its policy are
 *   matched against it;
 * - records of the project: a team of the project, a member of it
 *   (TeamMember), a policy of it that is not archived. A rule cannot name
 *   another project's people, and an id that names nothing is a mistake
 *   worth saying.
 *
 * An id the rule held before the write is kept as it is, found or not: a
 * person who has since left the project, a team or policy since deleted.
 * The rule still loads, says so in its view, and can be saved with any
 * other change - only an id added now has to be found. The conditions that
 * name values by id (states, severities, labels, monitors, SLOs) are left
 * as they always were.
 */

// The conditions whose values are ids held to the project's records.
export const CHECKED_ID_CONDITIONS: ReadonlyArray<NotificationRuleConditionCheckOn> =
  [
    NotificationRuleConditionCheckOn.OnCallDutyPolicies,
    NotificationRuleConditionCheckOn.IncidentOwners,
    NotificationRuleConditionCheckOn.AlertOwners,
    NotificationRuleConditionCheckOn.IncidentEpisodeOwners,
    NotificationRuleConditionCheckOn.AlertEpisodeOwners,
    NotificationRuleConditionCheckOn.ScheduledMaintenanceOwners,
    NotificationRuleConditionCheckOn.MonitorOwners,
    NotificationRuleConditionCheckOn.OnCallDutyPolicyOwners,
    NotificationRuleConditionCheckOn.SloOwners,
  ];

/*
 * An id as the database writes it - lower case, hyphenated, without braces -
 * from any text Postgres reads as one. Other text is handed back trimmed.
 */
export const toCanonicalId: (value: string) => string = (
  value: string,
): string => {
  const text: string = value.trim();

  if (!UUIDColumnFilter.isUUIDText(text)) {
    return text;
  }

  const hex: string = text.replace(/[{}-]/g, "").toLowerCase();

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
};

// One condition as it was written, before anything in it is trusted.
interface WrittenCondition {
  filter: Record<string, unknown>;
  checkOn: NotificationRuleConditionCheckOn;
  values: Array<unknown>;
}

// The conditions of written filters that name ids held to the project.
const getCheckedConditions: (filters: unknown) => Array<WrittenCondition> = (
  filters: unknown,
): Array<WrittenCondition> => {
  if (!Array.isArray(filters)) {
    return [];
  }

  const conditions: Array<WrittenCondition> = [];

  for (const filter of filters) {
    if (!filter || typeof filter !== "object" || Array.isArray(filter)) {
      continue;
    }

    const written: Record<string, unknown> = filter as Record<string, unknown>;
    const checkOn: unknown = written["checkOn"];

    if (
      !CHECKED_ID_CONDITIONS.includes(
        checkOn as NotificationRuleConditionCheckOn,
      )
    ) {
      continue;
    }

    const value: unknown = written["value"];

    conditions.push({
      filter: written,
      checkOn: checkOn as NotificationRuleConditionCheckOn,
      values:
        value === undefined || value === null || value === ""
          ? []
          : Array.isArray(value)
            ? value
            : [value],
    });
  }

  return conditions;
};

// A refused value, as the message repeats it.
const describeValue: (value: unknown) => string = (value: unknown): string => {
  try {
    const text: string = JSON.stringify(value) ?? String(value);

    return text.length > 80 ? `${text.slice(0, 80)}...` : text;
  } catch {
    return "a value that is not text";
  }
};

export default class NotificationRuleConditionIds {
  /*
   * The filters of what was written: a rule's (its notificationRule's
   * filters) or a summary's (its filters column), as either was sent.
   */
  public static getRuleFilters(notificationRule: unknown): unknown {
    if (
      !notificationRule ||
      typeof notificationRule !== "object" ||
      Array.isArray(notificationRule)
    ) {
      return undefined;
    }

    return (notificationRule as Record<string, unknown>)["filters"];
  }

  // Whether written filters have a condition whose ids are held to the project.
  public static namesCheckedIds(filters: unknown): boolean {
    return getCheckedConditions(filters).length > 0;
  }

  /*
   * The ids written filters name in their checked conditions, as the
   * database writes ids: what a rule held before a write, kept whether or
   * not it is found now.
   */
  public static getIdsNamed(filters: unknown): Set<string> {
    const ids: Set<string> = new Set();

    for (const condition of getCheckedConditions(filters)) {
      for (const value of condition.values) {
        if (typeof value === "string" && value.trim()) {
          ids.add(toCanonicalId(value));
        }
      }
    }

    return ids;
  }

  /*
   * Refuses filters whose checked conditions name an id that is not one, or
   * - among the ids not in `keptIds` - one that is not a record of the
   * project, saying which condition and which id. Each id is written back
   * as the database writes ids.
   */
  public static async checkFilters(data: {
    projectId: ObjectID;
    filters: unknown;
    keptIds?: Set<string> | undefined;
  }): Promise<void> {
    const conditions: Array<WrittenCondition> = getCheckedConditions(
      data.filters,
    );

    if (conditions.length === 0) {
      return;
    }

    const kept: Set<string> = data.keptIds || new Set();
    const policyIds: Map<string, NotificationRuleConditionCheckOn> = new Map();
    const ownerIds: Map<string, NotificationRuleConditionCheckOn> = new Map();

    for (const condition of conditions) {
      const ids: Array<string> = [];

      for (const value of condition.values) {
        if (
          typeof value !== "string" ||
          !UUIDColumnFilter.isUUIDText(value.trim())
        ) {
          throw new BadDataException(
            `Invalid ID in the "${getCheckOnLabel(
              condition.checkOn,
            )}" condition: ${describeValue(
              value,
            )}. An ID is a UUID, such as "${EXAMPLE_UUID}".`,
          );
        }

        const id: string = toCanonicalId(value);

        ids.push(id);

        if (kept.has(id)) {
          continue;
        }

        if (
          condition.checkOn ===
          NotificationRuleConditionCheckOn.OnCallDutyPolicies
        ) {
          policyIds.set(id, condition.checkOn);
        } else {
          ownerIds.set(id, condition.checkOn);
        }
      }

      // Saved as the database writes ids, a list kept a list.
      if (Array.isArray(condition.filter["value"])) {
        condition.filter["value"] = ids;
      } else if (ids.length === 1) {
        condition.filter["value"] = ids[0];
      }
    }

    await NotificationRuleConditionIds.assertPoliciesFound({
      projectId: data.projectId,
      ids: policyIds,
    });

    await NotificationRuleConditionIds.assertOwnersFound({
      projectId: data.projectId,
      ids: ownerIds,
    });
  }

  /*
   * Each policy named is one of the project's, and not archived: an archived
   * policy pages no one, so nothing is posted about it, and no picker offers
   * it for a new pick (#7582). One a rule held before it was archived is
   * kept (keptIds), and never looked up.
   */
  private static async assertPoliciesFound(data: {
    projectId: ObjectID;
    ids: Map<string, NotificationRuleConditionCheckOn>;
  }): Promise<void> {
    if (data.ids.size === 0) {
      return;
    }

    const found: Set<string> = new Set(
      (
        await OnCallDutyPolicyService.findBy({
          query: {
            projectId: data.projectId,
            _id: QueryHelper.any(Array.from(data.ids.keys())),
            isArchived: false,
          },
          select: {
            _id: true,
          },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: {
            isRoot: true,
          },
        })
      ).map((policy: OnCallDutyPolicy): string => {
        return toCanonicalId(policy._id?.toString() || "");
      }),
    );

    for (const [id, checkOn] of data.ids) {
      if (!found.has(id)) {
        throw new BadDataException(
          `The "${getCheckOnLabel(
            checkOn,
          )}" condition names an on-call policy that is not in this project, or is archived: ${id}. Pick one of the project's on-call policies.`,
        );
      }
    }
  }

  // Each owner named is a team of the project, or a member of it.
  private static async assertOwnersFound(data: {
    projectId: ObjectID;
    ids: Map<string, NotificationRuleConditionCheckOn>;
  }): Promise<void> {
    if (data.ids.size === 0) {
      return;
    }

    const found: Set<string> = new Set(
      (
        await TeamService.findBy({
          query: {
            projectId: data.projectId,
            _id: QueryHelper.any(Array.from(data.ids.keys())),
          },
          select: {
            _id: true,
          },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: {
            isRoot: true,
          },
        })
      ).map((team: Team): string => {
        return toCanonicalId(team._id?.toString() || "");
      }),
    );

    const notTeams: Array<string> = Array.from(data.ids.keys()).filter(
      (id: string): boolean => {
        return !found.has(id);
      },
    );

    if (notTeams.length > 0) {
      const members: Array<TeamMember> = await TeamMemberService.findBy({
        query: {
          projectId: data.projectId,
          userId: QueryHelper.any(notTeams),
        },
        select: {
          userId: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

      for (const member of members) {
        if (member.userId) {
          found.add(toCanonicalId(member.userId.toString()));
        }
      }
    }

    for (const [id, checkOn] of data.ids) {
      if (!found.has(id)) {
        throw new BadDataException(
          `The "${getCheckOnLabel(
            checkOn,
          )}" condition names a person or team that is not in this project: ${id}. Pick people and teams of the project.`,
        );
      }
    }
  }
}
