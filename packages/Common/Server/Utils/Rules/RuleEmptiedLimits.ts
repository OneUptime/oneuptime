import PostgresAppInstance from "../../Infrastructure/PostgresDatabase";
import logger from "../Logger";
import RuleSetCache from "./RuleSetCache";
import {
  getRuleLimitLists,
  getRuleLimitListsHolding,
  getRuleLimitListsOf,
  RuleLimitList,
  RuleLimitListKind,
} from "./RuleLimitLists";
import type AuditLogServiceType from "../../Services/AuditLogService";
import { getModelTypeByName } from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  addRuleEmptiedLimits,
  buildRuleEmptiedLimit,
  describeRuleEmptiedLimitNames,
  readRuleEmptiedLimits,
  RuleEmptiedLimit,
} from "../../../Types/Rules/RuleEmptiedLimit";
import { DataSource } from "typeorm";

/*
 * A RULE IS NEVER WIDENED TO EVERYTHING BY A DELETE (#9066).
 *
 * A rule limited to records through a list (RuleLimitLists) - the incidents
 * of some monitors, the hosts that carry some labels, the runbooks an AI
 * rule may run - is left with an empty list when the last of them is
 * deleted: the database takes a deleted record out of every list (ON DELETE
 * CASCADE), and an empty list puts no limit at all. "Page Payments for
 * Checkout's incidents" became "page Payments for every incident", and a
 * privacy rule for one monitor's incidents made every incident private.
 *
 * So a delete of records some rule can be limited to - by a person, the
 * API, Terraform, a workflow, OneUptime's own clean-ups or a retention
 * purge: every delete goes through DatabaseService - switches such a rule
 * off first, and writes on it why (RuleBaseModel.emptiedLimits):
 *
 *   1. beforeDelete, before the DELETE: the rules whose list holds one of
 *      the records and no other record that is not deleted (a record soft
 *      deleted is left out of every read, as if it were gone) are switched
 *      off, and noted - one entry per list, with the records' names. A rule
 *      off already is noted only. A rule that keeps a record in the list
 *      keeps its limit and is left as it is. A match list is read only while
 *      the rule has no conditions of its own (RuleLimitListKind).
 *   2. The DELETE. If it fails, afterDeleteFailed puts back what step 1
 *      wrote, where nothing has written over it since.
 *   3. afterDelete: a rule that kept another record at step 1 and lost it
 *      before the DELETE - a person took it out meanwhile - is switched off
 *      too. Each rule switched off or noted goes into its audit trail, as a
 *      change made by whoever deleted the records (AuditLogService
 *      .recordUpdate, for the writes made round DatabaseService), and every
 *      process reads the rules again (RuleSetCache).
 *
 * Switching off comes first so a rule never matches everything, not even
 * for the moment between the two statements, and a process stopped between
 * them leaves the rule off rather than wide open. If step 1 fails, the
 * delete is refused.
 *
 * Switching such a rule on again is refused while a list its note names is
 * still empty (refuseSwitchOnWhileEmptied), unless the same write says what
 * the list holds now - or gives the rule conditions of its own, for a match
 * list - so it is never widened by a click on Enable either. Switching it on
 * clears the note (clearAfterSwitchOn).
 *
 * A rule left with an empty list before this existed cannot be told from
 * one saved empty on purpose: the delete left no trace on it. The one trace
 * there is: a list that still holds records, all of them soft deleted - the
 * rule reads it as empty. switchOffRulesLimitedOnlyToDeletedRecords finds
 * those (the data migration SwitchOffRulesLimitedOnlyToDeletedRecords).
 */

type Row = Record<string, unknown>;

type QueryFunction = (
  sql: string,
  parameters: Array<unknown>,
) => Promise<Array<Row>>;

// A rule a delete notes, and what it was before, to put back on a failure.
export interface RuleNotedByDelete {
  ruleTable: string;
  ruleId: string;
  projectId: string | null;
  wasEnabled: boolean | null;
  emptiedLimitsBefore: unknown;
  emptiedLimitsWritten: Array<RuleEmptiedLimit>;
}

// The rules whose list held one of the records, by rule.
interface ListCandidates {
  list: RuleLimitList;
  recordIdsByRule: Map<string, Array<string>>;
}

// What a delete of some rule's records noted, for the steps after it.
export interface EmptiedLimitsOfDelete {
  recordTable: string;
  recordIds: Array<string>;
  // Each record's name, by id, read before the DELETE.
  names: Map<string, string>;
  deletedAt: Date;
  candidates: Array<ListCandidates>;
  noted: Array<RuleNotedByDelete>;
  // Who deleted the records: the audit trail's author of the switch-off.
  props?: DatabaseCommonInteractionProps | undefined;
}

// A rule the reads found, as it is.
interface RuleState {
  ruleId: string;
  projectId: string | null;
  isEnabled: boolean | null;
  emptiedLimits: unknown;
}

// A rule to note, with the entries of the lists it lost.
interface RuleToNote {
  ruleTable: string;
  state: RuleState;
  entries: Array<RuleEmptiedLimit>;
}

const quote: (name: string) => string = (name: string): string => {
  return `"${name.replace(/"/g, '""')}"`;
};

const idText: (id: unknown) => string = (id: unknown): string => {
  return id === null || id === undefined ? "" : String(id).toLowerCase();
};

const toBooleanOrNull: (value: unknown) => boolean | null = (
  value: unknown,
): boolean | null => {
  return typeof value === "boolean" ? value : null;
};

export default class RuleEmptiedLimits {
  /*
   * How statements are sent: the app's data source. A seam for tests, which
   * hand their own.
   */
  public static getQuery(): QueryFunction | null {
    const dataSource: DataSource | null = PostgresAppInstance.getDataSource();

    if (!dataSource) {
      return null;
    }

    return async (
      sql: string,
      parameters: Array<unknown>,
    ): Promise<Array<Row>> => {
      return (await dataSource.query(sql, parameters)) as Array<Row>;
    };
  }

  /*
   * Step 1, before the DELETE of `recordIds` of `recordTable`: the rules
   * left with no record in a list once they are gone are switched off and
   * noted. Null when no rule can be limited to records of the table, or
   * none of these records is in a list. Throws when it cannot read or
   * write: the delete is refused then.
   */
  public static async beforeDelete(data: {
    recordTable: string | null | undefined;
    recordIds: Array<ObjectID | string | null | undefined>;
    props?: DatabaseCommonInteractionProps | undefined;
  }): Promise<EmptiedLimitsOfDelete | null> {
    const lists: Array<RuleLimitList> = getRuleLimitListsHolding(
      data.recordTable,
    );

    const recordIds: Array<string> = Array.from(
      new Set<string>(
        data.recordIds.map(idText).filter((id: string): boolean => {
          return id.length > 0;
        }),
      ),
    );

    if (lists.length === 0 || recordIds.length === 0 || !data.recordTable) {
      return null;
    }

    const query: QueryFunction | null = this.getQuery();

    if (!query) {
      return null;
    }

    const of: EmptiedLimitsOfDelete = {
      recordTable: data.recordTable,
      recordIds: recordIds,
      names: new Map<string, string>(),
      deletedAt: new Date(),
      candidates: [],
      noted: [],
      props: data.props,
    };

    for (const list of lists) {
      const recordIdsByRule: Map<
        string,
        Array<string>
      > = await this.readRulesHolding({
        query: query,
        list: list,
        recordIds: recordIds,
      });

      if (recordIdsByRule.size > 0) {
        of.candidates.push({ list: list, recordIdsByRule: recordIdsByRule });
      }
    }

    if (of.candidates.length === 0) {
      return of;
    }

    of.names = await this.readNames({
      query: query,
      recordTable: data.recordTable,
      recordIds: recordIds,
    });

    const toNote: Map<string, RuleToNote> = new Map<string, RuleToNote>();

    for (const candidate of of.candidates) {
      const emptied: Array<RuleState> = await this.readRulesLeftEmpty({
        query: query,
        list: candidate.list,
        recordIds: recordIds,
        ruleIds: Array.from(candidate.recordIdsByRule.keys()),
      });

      for (const state of emptied) {
        this.addEntry({
          toNote: toNote,
          ruleTable: candidate.list.ruleTable,
          state: state,
          entry: buildRuleEmptiedLimit({
            list: candidate.list.list,
            names: (candidate.recordIdsByRule.get(state.ruleId) || []).map(
              (recordId: string): string => {
                return of.names.get(recordId) || "";
              },
            ),
            deletedAt: of.deletedAt,
            switchedOff: state.isEnabled === true,
          }),
        });
      }
    }

    of.noted = await this.writeNotes({ query: query, toNote: toNote });

    return of;
  }

  /*
   * Step 3, after the DELETE: a rule whose list lost its other records
   * between step 1 and the DELETE is switched off too, and every process
   * reads the rules again. Never throws: the records are gone already.
   */
  public static async afterDelete(
    of: EmptiedLimitsOfDelete | null,
  ): Promise<void> {
    if (!of || of.candidates.length === 0) {
      return;
    }

    try {
      const query: QueryFunction | null = this.getQuery();

      if (query) {
        const notedKeys: Set<string> = new Set<string>(
          of.noted.map((noted: RuleNotedByDelete): string => {
            return `${noted.ruleTable}|${noted.ruleId}`;
          }),
        );

        const toNote: Map<string, RuleToNote> = new Map<string, RuleToNote>();

        for (const candidate of of.candidates) {
          const ruleIds: Array<string> = Array.from(
            candidate.recordIdsByRule.keys(),
          ).filter((ruleId: string): boolean => {
            return !notedKeys.has(`${candidate.list.ruleTable}|${ruleId}`);
          });

          if (ruleIds.length === 0) {
            continue;
          }

          const emptied: Array<RuleState> = await this.readRulesLeftEmpty({
            query: query,
            list: candidate.list,
            recordIds: of.recordIds,
            ruleIds: ruleIds,
          });

          for (const state of emptied) {
            this.addEntry({
              toNote: toNote,
              ruleTable: candidate.list.ruleTable,
              state: state,
              entry: buildRuleEmptiedLimit({
                list: candidate.list.list,
                names: (candidate.recordIdsByRule.get(state.ruleId) || []).map(
                  (recordId: string): string => {
                    return of.names.get(recordId) || "";
                  },
                ),
                deletedAt: of.deletedAt,
                switchedOff: state.isEnabled === true,
              }),
            });
          }
        }

        of.noted.push(
          ...(await this.writeNotes({ query: query, toNote: toNote })),
        );
      }
    } catch (err) {
      logger.error(
        `Could not check the rules limited to the deleted ${of.recordTable} records again after the delete: ${err}`,
      );
    }

    await this.recordInAuditTrail({ noted: of.noted, props: of.props });

    await this.logAndForget(of);
  }

  /*
   * Each rule switched off or noted, in its audit trail: its switch and its
   * note, changed by whoever made the delete (by OneUptime, for a purge), in
   * the rule's own project. Recorded as every write made round
   * DatabaseService's hooks is (AuditLogService.recordUpdate), with the two
   * columns named: the note is OneUptime's to write, but the delete was a
   * person's. Never throws.
   */
  public static async recordInAuditTrail(data: {
    noted: Array<RuleNotedByDelete>;
    props?: DatabaseCommonInteractionProps | undefined;
  }): Promise<void> {
    if (data.noted.length === 0) {
      return;
    }

    try {
      const auditLogService: typeof AuditLogServiceType =
        // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
        require("../../Services/AuditLogService").default;

      for (const noted of data.noted) {
        const modelType: { new (): BaseModel } | null = getModelTypeByName(
          noted.ruleTable,
        );

        if (!modelType) {
          continue;
        }

        const projectId: ObjectID | undefined = noted.projectId
          ? new ObjectID(noted.projectId)
          : data.props?.tenantId;

        // The rule as it was: its project, its switch and its note.
        const before: BaseModel = new modelType();
        const beforeFields: Record<string, unknown> =
          before as unknown as Record<string, unknown>;
        before._id = noted.ruleId;
        beforeFields["projectId"] = projectId;
        beforeFields["isEnabled"] = noted.wasEnabled;
        beforeFields["emptiedLimits"] =
          readRuleEmptiedLimits(noted.emptiedLimitsBefore).length > 0
            ? noted.emptiedLimitsBefore
            : null;

        await auditLogService.recordUpdate({
          model: new modelType(),
          before: before,
          updatedFields: {
            isEnabled: false,
            emptiedLimits: noted.emptiedLimitsWritten,
          } as unknown as JSONObject,
          itemId: new ObjectID(noted.ruleId),
          props: {
            ...(data.props || { isRoot: true }),
            tenantId: projectId,
          },
          includeColumns: ["isEnabled", "emptiedLimits"],
        });
      }
    } catch (err) {
      logger.error(
        `Could not record the rules switched off by a delete in their audit trail: ${err}`,
      );
    }
  }

  /*
   * Step 2 failed: the records are still there, so the rules step 1
   * switched off are put back as they were - each only while it still holds
   * the note step 1 wrote, so a change made since is kept. Never throws: the
   * delete's own error is what the caller hears.
   */
  public static async afterDeleteFailed(
    of: EmptiedLimitsOfDelete | null,
  ): Promise<void> {
    if (!of || of.noted.length === 0) {
      return;
    }

    const query: QueryFunction | null = this.getQuery();

    if (!query) {
      return;
    }

    for (const noted of of.noted) {
      try {
        await query(
          `UPDATE ${quote(noted.ruleTable)}
              SET "isEnabled" = $2,
                  "emptiedLimits" = $3::jsonb,
                  "version" = "version" + 1,
                  "updatedAt" = now()
            WHERE "_id" = $1::uuid
              AND "emptiedLimits" = $4::jsonb`,
          [
            noted.ruleId,
            noted.wasEnabled,
            readRuleEmptiedLimits(noted.emptiedLimitsBefore).length > 0
              ? JSON.stringify(noted.emptiedLimitsBefore)
              : null,
            JSON.stringify(noted.emptiedLimitsWritten),
          ],
        );
      } catch (err) {
        logger.error(
          `Could not switch ${noted.ruleTable} ${noted.ruleId} back on after the delete of its ${of.recordTable} records failed: ${err}`,
        );
      }
    }

    await RuleSetCache.forgetProjects(
      of.noted.map((noted: RuleNotedByDelete): string | null => {
        return noted.projectId;
      }),
    );
  }

  /*
   * A write that switches rules on (`isEnabled: true`) is refused while a
   * list a rule's note names is still empty - it would put no limit on the
   * rule - unless the write says what that list holds now, or, for a match
   * list, the rule has conditions of its own (in the write or already).
   */
  public static async refuseSwitchOnWhileEmptied(data: {
    ruleTable: string | null | undefined;
    ruleIds: Array<ObjectID | string | null | undefined>;
    written: Record<string, unknown>;
  }): Promise<void> {
    const lists: Array<RuleLimitList> = getRuleLimitListsOf(data.ruleTable);

    const ruleIds: Array<string> = Array.from(
      new Set<string>(
        data.ruleIds.map(idText).filter((id: string): boolean => {
          return id.length > 0;
        }),
      ),
    );

    if (lists.length === 0 || ruleIds.length === 0 || !data.ruleTable) {
      return;
    }

    const query: QueryFunction | null = this.getQuery();

    if (!query) {
      return;
    }

    const rows: Array<Row> = await query(
      `SELECT "_id"::text AS "ruleId",
              "emptiedLimits" AS "emptiedLimits",
              ("criteria" IS NOT NULL) AS "hasCriteria"
         FROM ${quote(data.ruleTable)}
        WHERE "_id" = ANY($1::uuid[])
          AND "emptiedLimits" IS NOT NULL`,
      [ruleIds],
    );

    const writesCriteria: boolean =
      data.written["criteria"] !== undefined &&
      data.written["criteria"] !== null;

    for (const row of rows) {
      for (const entry of readRuleEmptiedLimits(row["emptiedLimits"])) {
        const list: RuleLimitList | undefined = lists.find(
          (candidate: RuleLimitList): boolean => {
            return candidate.list === entry.list;
          },
        );

        // A list that limits the rule no more, or that this write fills in.
        if (!list || data.written[entry.list] !== undefined) {
          continue;
        }

        // Conditions decide what the rule matches, not its old lists.
        if (
          list.kind === RuleLimitListKind.Match &&
          (row["hasCriteria"] === true || writesCriteria)
        ) {
          continue;
        }

        if (
          await this.holdsRecord({
            query: query,
            list: list,
            ruleId: idText(row["ruleId"]),
          })
        ) {
          continue;
        }

        throw new BadDataException(
          this.getSwitchOnRefusal({ ruleTable: data.ruleTable, entry: entry }),
        );
      }
    }
  }

  /*
   * After a write switched rules on: their notes go. A rule switched on
   * with a list still empty was switched on with that list said in the
   * same write (refuseSwitchOnWhileEmptied). Never throws.
   */
  public static async clearAfterSwitchOn(data: {
    ruleTable: string | null | undefined;
    ruleIds: Array<ObjectID | string | null | undefined>;
  }): Promise<void> {
    const ruleIds: Array<string> = Array.from(
      new Set<string>(
        data.ruleIds.map(idText).filter((id: string): boolean => {
          return id.length > 0;
        }),
      ),
    );

    if (
      !data.ruleTable ||
      ruleIds.length === 0 ||
      getRuleLimitListsOf(data.ruleTable).length === 0
    ) {
      return;
    }

    const query: QueryFunction | null = this.getQuery();

    if (!query) {
      return;
    }

    try {
      await query(
        `UPDATE ${quote(data.ruleTable)}
            SET "emptiedLimits" = NULL
          WHERE "_id" = ANY($1::uuid[])
            AND "emptiedLimits" IS NOT NULL`,
        [ruleIds],
      );
    } catch (err) {
      logger.error(
        `Could not clear the note of the ${data.ruleTable} rules switched on: ${err}`,
      );
    }
  }

  /*
   * Every rule whose list still holds records, all of them soft deleted -
   * read as an empty list, so the rule puts no limit there - is switched
   * off and noted, as a delete would have done. A list already in a rule's
   * note is left as it is, so this runs any number of times. How many rules
   * it noted.
   */
  public static async switchOffRulesLimitedOnlyToDeletedRecords(): Promise<number> {
    const query: QueryFunction | null = this.getQuery();

    if (!query) {
      return 0;
    }

    const toNote: Map<string, RuleToNote> = new Map<string, RuleToNote>();

    for (const list of getRuleLimitLists()) {
      const rows: Array<Row> = await query(
        `SELECT r."_id"::text AS "ruleId",
                r."projectId"::text AS "projectId",
                r."isEnabled" AS "isEnabled",
                r."emptiedLimits" AS "emptiedLimits",
                array_agg(COALESCE(t."name"::text, '') ORDER BY t."name") AS "names",
                max(t."deletedAt") AS "deletedAt"
           FROM ${quote(list.ruleTable)} r
           JOIN ${quote(list.joinTable)} j ON j.${quote(list.ruleColumn)} = r."_id"
           JOIN ${quote(list.recordTable)} t ON t."_id" = j.${quote(list.recordColumn)}
          WHERE ${list.kind === RuleLimitListKind.Match ? 'r."criteria" IS NULL AND' : ""}
                NOT EXISTS (
                  SELECT 1
                    FROM ${quote(list.joinTable)} k
                    JOIN ${quote(list.recordTable)} u ON u."_id" = k.${quote(list.recordColumn)}
                   WHERE k.${quote(list.ruleColumn)} = r."_id"
                     AND u."deletedAt" IS NULL
                )
          GROUP BY r."_id", r."projectId", r."isEnabled", r."emptiedLimits"`,
        [],
      );

      for (const row of rows) {
        const state: RuleState = this.toRuleState(row);

        // Noted for this list already: by a delete, or an earlier run.
        if (
          readRuleEmptiedLimits(state.emptiedLimits).some(
            (entry: RuleEmptiedLimit): boolean => {
              return entry.list === list.list;
            },
          )
        ) {
          continue;
        }

        const deletedAt: Date =
          row["deletedAt"] instanceof Date
            ? row["deletedAt"]
            : new Date(String(row["deletedAt"] || Date.now()));

        this.addEntry({
          toNote: toNote,
          ruleTable: list.ruleTable,
          state: state,
          entry: buildRuleEmptiedLimit({
            list: list.list,
            names: Array.isArray(row["names"])
              ? (row["names"] as Array<unknown>).map((name: unknown) => {
                  return typeof name === "string" ? name : "";
                })
              : [],
            deletedAt: Number.isNaN(deletedAt.getTime())
              ? new Date()
              : deletedAt,
            switchedOff: state.isEnabled === true,
          }),
        });
      }
    }

    const noted: Array<RuleNotedByDelete> = await this.writeNotes({
      query: query,
      toNote: toNote,
    });

    if (noted.length > 0) {
      logger.info(
        `Switched off ${noted.length} rules whose lists held only deleted records (#9066).`,
      );
      await this.recordInAuditTrail({ noted: noted, props: { isRoot: true } });
      await RuleSetCache.forgetEveryProject();
    }

    return noted.length;
  }

  // The words a refused switch-on says. English, as every API error is.
  public static getSwitchOnRefusal(data: {
    ruleTable: string;
    entry: RuleEmptiedLimit;
  }): string {
    const title: string = this.getListTitle(data.ruleTable, data.entry.list);
    const date: string = data.entry.deletedAt.slice(0, 10);

    return `This rule was switched off on ${date} because every record it was limited to in ${title} was deleted: ${describeRuleEmptiedLimitNames(
      data.entry,
    )}. Switched on as it is, ${title} would not limit it at all. Choose what it applies to on its edit form first, or send ${data.entry.list} with the update that switches it on - an empty list makes it apply to every record.`;
  }

  // A rule kind's list as its form names it: "Monitors".
  public static getListTitle(ruleTable: string, list: string): string {
    const modelType: { new (): BaseModel } | null =
      getModelTypeByName(ruleTable);

    const title: string | undefined = modelType
      ? new modelType().getTableColumnMetadata(list)?.title
      : undefined;

    return title || list;
  }

  // The rules whose list holds one of the records, with the ones each holds.
  private static async readRulesHolding(data: {
    query: QueryFunction;
    list: RuleLimitList;
    recordIds: Array<string>;
  }): Promise<Map<string, Array<string>>> {
    const rows: Array<Row> = await data.query(
      `SELECT ${quote(data.list.ruleColumn)}::text AS "ruleId",
              ${quote(data.list.recordColumn)}::text AS "recordId"
         FROM ${quote(data.list.joinTable)}
        WHERE ${quote(data.list.recordColumn)} = ANY($1::uuid[])`,
      [data.recordIds],
    );

    const byRule: Map<string, Array<string>> = new Map<string, Array<string>>();

    for (const row of rows) {
      const ruleId: string = idText(row["ruleId"]);
      const recordId: string = idText(row["recordId"]);

      if (!ruleId || !recordId) {
        continue;
      }

      byRule.set(ruleId, [...(byRule.get(ruleId) || []), recordId]);
    }

    return byRule;
  }

  /*
   * Of `ruleIds`, the rules whose list holds no record that is not deleted
   * once the records are gone - and, for a match list, that have no
   * conditions of their own - as they are now.
   */
  private static async readRulesLeftEmpty(data: {
    query: QueryFunction;
    list: RuleLimitList;
    recordIds: Array<string>;
    ruleIds: Array<string>;
  }): Promise<Array<RuleState>> {
    if (data.ruleIds.length === 0) {
      return [];
    }

    const rows: Array<Row> = await data.query(
      `SELECT r."_id"::text AS "ruleId",
              r."projectId"::text AS "projectId",
              r."isEnabled" AS "isEnabled",
              r."emptiedLimits" AS "emptiedLimits"
         FROM ${quote(data.list.ruleTable)} r
        WHERE r."_id" = ANY($2::uuid[])
          ${data.list.kind === RuleLimitListKind.Match ? 'AND r."criteria" IS NULL' : ""}
          AND NOT EXISTS (
            SELECT 1
              FROM ${quote(data.list.joinTable)} k
              JOIN ${quote(data.list.recordTable)} t ON t."_id" = k.${quote(data.list.recordColumn)}
             WHERE k.${quote(data.list.ruleColumn)} = r."_id"
               AND t."deletedAt" IS NULL
               AND NOT (k.${quote(data.list.recordColumn)} = ANY($1::uuid[]))
          )`,
      [data.recordIds, data.ruleIds],
    );

    return rows.map((row: Row): RuleState => {
      return this.toRuleState(row);
    });
  }

  // Whether the rule's list holds a record that is not deleted.
  private static async holdsRecord(data: {
    query: QueryFunction;
    list: RuleLimitList;
    ruleId: string;
  }): Promise<boolean> {
    const rows: Array<Row> = await data.query(
      `SELECT 1
         FROM ${quote(data.list.joinTable)} k
         JOIN ${quote(data.list.recordTable)} t ON t."_id" = k.${quote(data.list.recordColumn)}
        WHERE k.${quote(data.list.ruleColumn)} = $1::uuid
          AND t."deletedAt" IS NULL
        LIMIT 1`,
      [data.ruleId],
    );

    return rows.length > 0;
  }

  // The records' names, by id.
  private static async readNames(data: {
    query: QueryFunction;
    recordTable: string;
    recordIds: Array<string>;
  }): Promise<Map<string, string>> {
    const rows: Array<Row> = await data.query(
      `SELECT "_id"::text AS "recordId", "name"::text AS "name"
         FROM ${quote(data.recordTable)}
        WHERE "_id" = ANY($1::uuid[])`,
      [data.recordIds],
    );

    return new Map<string, string>(
      rows.map((row: Row): [string, string] => {
        return [
          idText(row["recordId"]),
          typeof row["name"] === "string" ? row["name"] : "",
        ];
      }),
    );
  }

  private static toRuleState(row: Row): RuleState {
    return {
      ruleId: idText(row["ruleId"]),
      projectId: row["projectId"] ? idText(row["projectId"]) : null,
      isEnabled: toBooleanOrNull(row["isEnabled"]),
      emptiedLimits: row["emptiedLimits"] ?? null,
    };
  }

  private static addEntry(data: {
    toNote: Map<string, RuleToNote>;
    ruleTable: string;
    state: RuleState;
    entry: RuleEmptiedLimit;
  }): void {
    const key: string = `${data.ruleTable}|${data.state.ruleId}`;
    const existing: RuleToNote | undefined = data.toNote.get(key);

    if (existing) {
      existing.entries.push(data.entry);
      return;
    }

    data.toNote.set(key, {
      ruleTable: data.ruleTable,
      state: data.state,
      entries: [data.entry],
    });
  }

  /*
   * Switches each rule off and writes its note: what it held before, with
   * the new entries. One statement a rule, each only while the rule still
   * holds the note it was read with, so a note written meanwhile is never
   * lost - such a rule is read again and written once more.
   */
  private static async writeNotes(data: {
    query: QueryFunction;
    toNote: Map<string, RuleToNote>;
  }): Promise<Array<RuleNotedByDelete>> {
    const noted: Array<RuleNotedByDelete> = [];

    for (const rule of data.toNote.values()) {
      let state: RuleState = rule.state;

      for (let attempt: number = 0; attempt < 3; attempt++) {
        const written: Array<RuleEmptiedLimit> = addRuleEmptiedLimits(
          state.emptiedLimits,
          rule.entries,
        );

        const updated: Array<Row> = await data.query(
          `UPDATE ${quote(rule.ruleTable)}
              SET "isEnabled" = false,
                  "emptiedLimits" = $2::jsonb,
                  "version" = "version" + 1,
                  "updatedAt" = now()
            WHERE "_id" = $1::uuid
              AND "emptiedLimits" IS NOT DISTINCT FROM $3::jsonb
          RETURNING "_id"`,
          [
            state.ruleId,
            JSON.stringify(written),
            state.emptiedLimits === null || state.emptiedLimits === undefined
              ? null
              : JSON.stringify(state.emptiedLimits),
          ],
        );

        if (this.countUpdated(updated) > 0) {
          noted.push({
            ruleTable: rule.ruleTable,
            ruleId: state.ruleId,
            projectId: state.projectId,
            wasEnabled: state.isEnabled,
            emptiedLimitsBefore: state.emptiedLimits,
            emptiedLimitsWritten: written,
          });
          break;
        }

        const reread: Array<Row> = await data.query(
          `SELECT "_id"::text AS "ruleId",
                  "projectId"::text AS "projectId",
                  "isEnabled" AS "isEnabled",
                  "emptiedLimits" AS "emptiedLimits"
             FROM ${quote(rule.ruleTable)}
            WHERE "_id" = $1::uuid`,
          [state.ruleId],
        );

        // The rule is gone: nothing to switch off.
        if (reread.length === 0) {
          break;
        }

        state = {
          ...this.toRuleState(reread[0]!),
          // Whether this switched it off is decided by what it was read as first.
          isEnabled: rule.state.isEnabled,
        };
      }
    }

    return noted;
  }

  /*
   * How many rows an UPDATE ... RETURNING changed, as the driver hands it
   * back: the rows, or [rows, count].
   */
  private static countUpdated(result: unknown): number {
    if (!Array.isArray(result)) {
      return 0;
    }

    if (
      result.length === 2 &&
      Array.isArray(result[0]) &&
      typeof result[1] === "number"
    ) {
      return result[1];
    }

    return result.length;
  }

  private static async logAndForget(of: EmptiedLimitsOfDelete): Promise<void> {
    if (of.noted.length === 0) {
      return;
    }

    for (const noted of of.noted) {
      logger.info(
        `${noted.ruleTable} ${noted.ruleId} ${
          noted.wasEnabled === true ? "was switched off" : "was noted"
        }: every ${of.recordTable} record a list of it was limited to was deleted (#9066).`,
        {
          projectId: noted.projectId || undefined,
        },
      );
    }

    await RuleSetCache.forgetProjects(
      of.noted.map((noted: RuleNotedByDelete): string | null => {
        return noted.projectId;
      }),
    );
  }
}
