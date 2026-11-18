import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { RuleCriteriaFilter } from "../../../Types/Rules/RuleCriteria";
import { getRuleCriteriaOwnerFieldsForModel } from "../../../Types/Rules/RuleCriteriaFieldRegistry";
import findProjectOwnerIds from "./ProjectOwnerIds";

/*
 * THE PEOPLE AND TEAMS A RULE'S OWNER CONDITIONS NAME ARE THE PROJECT'S OWN
 * (#9353).
 *
 * An alert on-call rule's Alert Owner condition names people and teams by
 * id (RULE_CRITERIA_OWNER_FIELDS_BY_MODEL). When a rule is created, or its
 * conditions are written again, each id it names is a team of the project
 * or a member of it - as a workspace rule's owner condition is held
 * (NotificationRuleConditionIds) - so a rule cannot name another project's
 * people, and an id that names nothing is said to be a mistake.
 *
 * An id the rule held before the write is kept as it is, found or not: a
 * person who has since left the project, a team since deleted. The rule
 * still loads and can be saved with any other change; only an id added now
 * has to be found. Each id is saved lower case, as the database writes the
 * owners it is matched against. That the ids are ids at all is the
 * criteria's own check (DatabaseService.validateRuleCriteriaForModel).
 */

function getFilters(criteria: unknown): Array<RuleCriteriaFilter> {
  if (typeof criteria !== "object" || criteria === null) {
    return [];
  }

  const filters: unknown = (criteria as { filters?: unknown }).filters;

  if (!Array.isArray(filters)) {
    return [];
  }

  return filters.filter((filter: unknown): filter is RuleCriteriaFilter => {
    return (
      typeof filter === "object" &&
      filter !== null &&
      typeof (filter as RuleCriteriaFilter).field === "string"
    );
  });
}

function getOwnerFilters(data: {
  modelName: string;
  criteria: unknown;
}): Array<RuleCriteriaFilter> {
  const ownerFields: ReadonlyArray<string> = getRuleCriteriaOwnerFieldsForModel(
    data.modelName,
  );

  if (ownerFields.length === 0) {
    return [];
  }

  return getFilters(data.criteria).filter(
    (filter: RuleCriteriaFilter): boolean => {
      return ownerFields.includes(filter.field);
    },
  );
}

function getValues(filter: RuleCriteriaFilter): Array<string> {
  const values: Array<unknown> = Array.isArray(filter.value)
    ? filter.value
    : [filter.value];

  return values.filter((value: unknown): value is string => {
    return typeof value === "string";
  });
}

export default class RuleCriteriaOwnerIds {
  // Whether the criteria name anyone in an owner condition.
  public static namesOwners(data: {
    modelName: string;
    criteria: unknown;
  }): boolean {
    return getOwnerFilters(data).length > 0;
  }

  // Every id the criteria's owner conditions name, lower case.
  public static getIdsNamed(data: {
    modelName: string;
    criteria: unknown;
  }): Set<string> {
    const ids: Set<string> = new Set();

    for (const filter of getOwnerFilters(data)) {
      for (const value of getValues(filter)) {
        ids.add(value.trim().toLowerCase());
      }
    }

    return ids;
  }

  /*
   * Refuses criteria whose owner conditions name, among the ids not in
   * `keptIds`, one that is not a team or a member of the project, saying
   * which id. Writes each id back lower case.
   */
  public static async check(data: {
    projectId: ObjectID;
    modelName: string;
    criteria: unknown;
    keptIds?: Set<string> | undefined;
  }): Promise<void> {
    const filters: Array<RuleCriteriaFilter> = getOwnerFilters(data);

    if (filters.length === 0) {
      return;
    }

    const kept: Set<string> = data.keptIds || new Set();
    const toFind: Array<string> = [];

    for (const filter of filters) {
      if (!Array.isArray(filter.value)) {
        continue;
      }

      const ids: Array<string> = getValues(filter).map(
        (value: string): string => {
          return value.trim().toLowerCase();
        },
      );

      filter.value = ids;

      for (const id of ids) {
        if (!kept.has(id) && ObjectID.isValidUUID(id)) {
          toFind.push(id);
        }
      }
    }

    if (toFind.length === 0) {
      return;
    }

    const found: Set<string> = await findProjectOwnerIds({
      projectId: data.projectId,
      ids: toFind,
    });

    for (const id of toFind) {
      if (!found.has(id)) {
        throw new BadDataException(
          `An owner condition names a person or team that is not in this project: ${id}. Pick people and teams of the project.`,
        );
      }
    }
  }
}
