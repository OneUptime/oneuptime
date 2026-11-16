import { getModelTypeByName } from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import RULE_CRITERIA_FIELDS_BY_MODEL from "../../../Types/Rules/RuleCriteriaFieldRegistry";
import { getMetadataArgsStorage } from "typeorm";
import { JoinTableMetadataArgs } from "typeorm/metadata-args/JoinTableMetadataArgs";

/*
 * EVERY LIST A RULE CAN BE LIMITED TO, AND THE RECORDS IT HOLDS (#9066).
 *
 * A rule is limited to records through a list - a join table that the
 * database empties of a record when the record is deleted (ON DELETE
 * CASCADE) - and an empty list puts no limit at all. Two kinds:
 *
 *   - MATCH lists: what the rule matches. Every list among a rule kind's
 *     match fields (RULE_CRITERIA_FIELDS_BY_MODEL, the API allowlist the
 *     rule forms and engines are held to): an on-call rule's monitors,
 *     incident severities, incident labels and monitor labels; a host label
 *     rule's host labels; a naming rule's network sites. Read only while
 *     the rule has no conditions of its own: a rule saved with conditions
 *     (`criteria`) names records by id inside them, which a delete leaves
 *     where they are - a condition on a deleted monitor matches nothing - and
 *     never reads its old lists.
 *   - SCOPE lists: what the rule may use, where an empty list means
 *     everything (RULE_SCOPE_LISTS_BY_MODEL): the runbooks, code
 *     repositories and external MCP servers an AI rule lets OneUptime AI
 *     use. Read whatever the rule's conditions are.
 *
 * Worked out from the models themselves - the rule's column says which
 * record it holds, its join table which columns name the two - so a list
 * added to a rule kind's match fields is covered with nothing more to do.
 * RuleLimitLists.test holds every list to its join table.
 */

export enum RuleLimitListKind {
  Match = "Match",
  Scope = "Scope",
}

/*
 * The lists that say what a rule may use, where an empty list means all of
 * the project's: each is described as such on its column.
 */
export const RULE_SCOPE_LISTS_BY_MODEL: Readonly<
  Record<string, ReadonlyArray<string>>
> = {
  /*
   * "Leave empty to let it pick any of the project's runbooks", "...every
   * repository the project has connected", "...all of the project's MCP
   * servers".
   */
  AutoRemediationRule: ["runbooks", "codeRepositories", "externalMcpServers"],
};

export interface RuleLimitList {
  // The rule's table, which is also its model's name: "IncidentOnCallRule".
  ruleTable: string;
  // The rule's column: "monitors".
  list: string;
  kind: RuleLimitListKind;
  // The join table, and its columns naming the rule and the record.
  joinTable: string;
  ruleColumn: string;
  recordColumn: string;
  // The table of the records the list holds: "Monitor".
  recordTable: string;
}

type ModelType = { new (): BaseModel };

// The join table of `modelType`'s list `propertyName`, or null.
function getJoinTable(
  modelType: ModelType,
  propertyName: string,
): { joinTable: string; ruleColumn: string; recordColumn: string } | null {
  const joinTable: JoinTableMetadataArgs | undefined =
    getMetadataArgsStorage().joinTables.find(
      (args: JoinTableMetadataArgs): boolean => {
        return args.target === modelType && args.propertyName === propertyName;
      },
    );

  const ruleColumn: string | undefined = joinTable?.joinColumns?.[0]?.name;
  const recordColumn: string | undefined =
    joinTable?.inverseJoinColumns?.[0]?.name;

  if (!joinTable?.name || !ruleColumn || !recordColumn) {
    return null;
  }

  return {
    joinTable: joinTable.name,
    ruleColumn: ruleColumn,
    recordColumn: recordColumn,
  };
}

/*
 * The list `list` of the rule kind `ruleTable`, when it is a list of records
 * with a join table: null for a column that is not (a pattern, a type).
 */
export function getRuleLimitList(data: {
  ruleTable: string;
  list: string;
  kind: RuleLimitListKind;
}): RuleLimitList | null {
  const modelType: ModelType | null = getModelTypeByName(data.ruleTable);

  if (!modelType) {
    return null;
  }

  const metadata: TableColumnMetadata | undefined =
    new modelType().getTableColumnMetadata(data.list);

  if (
    !metadata ||
    metadata.type !== TableColumnType.EntityArray ||
    !metadata.modelType
  ) {
    return null;
  }

  const joinTable: {
    joinTable: string;
    ruleColumn: string;
    recordColumn: string;
  } | null = getJoinTable(modelType, data.list);

  const recordTable: string | null = new metadata.modelType().tableName || null;

  if (!joinTable || !recordTable) {
    return null;
  }

  return {
    ruleTable: data.ruleTable,
    list: data.list,
    kind: data.kind,
    ...joinTable,
    recordTable: recordTable,
  };
}

let allLists: Array<RuleLimitList> | null = null;

// Every list a rule can be limited to, match lists first, by rule kind.
export function getRuleLimitLists(): Array<RuleLimitList> {
  if (allLists) {
    return allLists;
  }

  const lists: Array<RuleLimitList> = [];

  for (const [ruleTable, fields] of Object.entries(
    RULE_CRITERIA_FIELDS_BY_MODEL,
  ) as Array<[string, ReadonlyArray<string>]>) {
    for (const field of fields) {
      const list: RuleLimitList | null = getRuleLimitList({
        ruleTable: ruleTable,
        list: field,
        kind: RuleLimitListKind.Match,
      });

      if (list) {
        lists.push(list);
      }
    }
  }

  for (const [ruleTable, fields] of Object.entries(
    RULE_SCOPE_LISTS_BY_MODEL,
  ) as Array<[string, ReadonlyArray<string>]>) {
    for (const field of fields) {
      const list: RuleLimitList | null = getRuleLimitList({
        ruleTable: ruleTable,
        list: field,
        kind: RuleLimitListKind.Scope,
      });

      if (list) {
        lists.push(list);
      }
    }
  }

  allLists = lists;

  return lists;
}

// The lists that can hold records of `recordTable`: none for most tables.
export function getRuleLimitListsHolding(
  recordTable: string | null | undefined,
): Array<RuleLimitList> {
  if (!recordTable) {
    return [];
  }

  return getRuleLimitLists().filter((list: RuleLimitList): boolean => {
    return list.recordTable === recordTable;
  });
}

// The lists of one rule kind.
export function getRuleLimitListsOf(
  ruleTable: string | null | undefined,
): Array<RuleLimitList> {
  if (!ruleTable) {
    return [];
  }

  return getRuleLimitLists().filter((list: RuleLimitList): boolean => {
    return list.ruleTable === ruleTable;
  });
}

// The tables whose records some rule can be limited to.
export function getRuleLimitRecordTables(): Array<string> {
  return Array.from(
    new Set<string>(
      getRuleLimitLists().map((list: RuleLimitList): string => {
        return list.recordTable;
      }),
    ),
  ).sort();
}
