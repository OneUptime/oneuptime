import AIRun from "../../../Models/DatabaseModels/AIRun";
import Alert from "../../../Models/DatabaseModels/Alert";
import AutoRemediationSuggestion from "../../../Models/DatabaseModels/AutoRemediationSuggestion";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import AIRunType from "../../../Types/AI/AIRunType";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { FindWhereProperty } from "../../../Types/BaseDatabase/Query";
import QueryOperator from "../../../Types/BaseDatabase/QueryOperator";
import Text from "../../../Types/Text";
import PrivateRecordPermission, {
  PrivateRecordColumn,
  PrivateRecordKind,
} from "../../Types/Database/Permissions/PrivateRecordPermission";
import QueryUtil from "../../Types/Database/QueryUtil";
import PrivateRecordReadFilter from "../Permission/PrivateRecordReadFilter";
import {
  combineWithPrivacyClause,
  shouldBypassRecordPrivacy,
} from "../PrivacyFilterUtil";
import { FindOperator, Raw } from "typeorm";

/*
 * WHAT AN AI RUN RAN AND PRINTED IS READ ONLY BY THOSE WHO MAY READ THE
 * RUN (#9155).
 *
 * A Runner job OneUptime AI ran for one of its AI runs holds the command
 * the run ran and what that printed: the run's own output. It is read by
 * those who may read the run, where OneUptime shows that run's work:
 *
 *   - a chat - Ask AI, or a question asked in an incident's or alert's AI
 *     conversation - only by the person who asked, as the chat itself, its
 *     tool calls and the rows its tools read are (AIChatPrivacyFilter: an
 *     incident's AI conversation shows the other responders the answer,
 *     never its tool arguments or rows). Not by Project Owners or Project
 *     Admins, who read no one else's chat either (AIRunPrivacyFilter);
 *   - a run OneUptime starts on its own (RUNS_ONEUPTIME_STARTS: an
 *     investigation, and the runs that work out and apply a fix) by
 *     everyone, as the incident's or alert's AI panel shows the
 *     investigation - the commands in its evidence included - to everyone
 *     who may read that record;
 *   - a CodeFix run (PROJECT_WIDE_RUNS) by everyone, as the run itself is
 *     (AIRunPrivacyFilter).
 *
 * And, as everything about a private record is (PrivateRecordReadFilter),
 * one of a run about a private incident or alert only by those who see
 * that record: the people named as its owners, the members of its owner
 * teams who accepted their invitation, Project Owners and Project Admins.
 * One of a run about a record that is gone only by Project Owners and
 * Project Admins, as nothing says any more whether it was private - as the
 * commands of a deleted fix (#9154). A job naming a run that is gone - a
 * chat deleted, with its runs - is read by no one in the project: the
 * person who asked deleted it, and its commands do not become someone
 * else's to read. An API key and a workflow's step read no chat's: no
 * person asked. Root and server admins read every one.
 *
 * WHAT A RUN IS ABOUT (#9165). A run names the incident or alert it is
 * about by a key of its own (AI_RUN_RECORD_KEYS: an investigation, the fix
 * pull request OneUptime AI writes from one), or a fix OneUptime AI
 * proposed for one, which is a part of that record (AI_RUN_PART_KEYS: the
 * Code task that writes a fix step's change into the code declaring its
 * cloud resource, DeclaredCodeChanges). A turn of a Code task - a reply -
 * names none of these: it is about what its task is about, the first run
 * its key names (AI_RUN_TASK_KEY). The same rule holds wherever the run is
 * read: its own row (AIRunPrivacyFilter, applyToRunRow), what it ran
 * (applyToRunKey: Runner jobs), its pull request (AIAgentTaskPullRequest
 * Service) and the Code pages' own SQL (getRunAboutSql, getReadableRunsSql).
 *
 * WHAT A RUN CARRIES (#9186). A Code task can hold an incident or an alert
 * without being a fix of one: a person added it as context to the request
 * or to a reply, or the task was asked from a postmortem action item and
 * carries its incident (AI_RUN_CARRIED_KEYS). A task carries what every one
 * of its turns carries (AIRunService), so a turn is read as its task is.
 * And a pull request OneUptime AI opened from a chat carries the chat's
 * subject, in the same keys of its own (AIAgentTaskPullRequestService). A
 * row is read only by those who see every record it carries, one carrying
 * a record that is gone only by those who see every private record. These
 * keys are read here alone: the fix-task triggers, the daily fix-task limit
 * and the AI logs read the keys above as a fix of the record, and a task
 * that only carries one is no fix of it.
 *
 * Written on the key naming the run, as a lookup of that run by its primary
 * key - `key IS NULL OR EXISTS (SELECT 1 FROM "AIRun" ... WHERE _id = key
 * AND ...)` - and of the incident, alert, fix or task it is about by
 * theirs: a row naming no run is not narrowed by it, and a read never
 * gathers every run or every record the caller may read first.
 */

/*
 * Every kind of AI run is one of these three (AIRunOutputReadFilter.test
 * holds a new kind to being put in one):
 */

// The runs a person asked for, read only by them: their chats.
export const PERSONAL_RUNS: ReadonlyArray<AIRunType> = [AIRunType.Chat];

// The runs OneUptime starts on its own, which no person asked for.
export const RUNS_ONEUPTIME_STARTS: ReadonlyArray<AIRunType> = [
  AIRunType.Investigation,
  AIRunType.RemediationPlan,
  AIRunType.RemediationExecution,
  /*
   * OneUptime AI working a security case, whether a triage or a person's
   * Respond with AI started it: the case's, never a person's own.
   */
  AIRunType.SecurityCaseResponse,
];

// The runs that are the project's, as AI runs are read (AIRunPrivacyFilter).
export const PROJECT_WIDE_RUNS: ReadonlyArray<AIRunType> = [AIRunType.CodeFix];

// The record a run is about, by the key of the run naming it.
export interface AIRunRecordKey {
  column: string;
  recordModelType: { new (): BaseModel };
}

export const AI_RUN_RECORD_KEYS: ReadonlyArray<AIRunRecordKey> = [
  { column: "triggeredByIncidentId", recordModelType: Incident },
  { column: "triggeredByAlertId", recordModelType: Alert },
];

/*
 * A part of a private record a run is about, by the key of the run naming
 * it: a fix OneUptime AI proposed for an incident or alert (#9165).
 */
export interface AIRunPartKey {
  column: string;
  partModelType: { new (): BaseModel };
}

export const AI_RUN_PART_KEYS: ReadonlyArray<AIRunPartKey> = [
  {
    column: "triggeredByAutoRemediationSuggestionId",
    partModelType: AutoRemediationSuggestion,
  },
];

// The first run of the Code task a turn is a reply in (CodeTaskRuns).
export const AI_RUN_TASK_KEY: string = "codeTaskId";

/*
 * The records a row carries without being a fix of one (#9186), by the key
 * listing them: a JSON list of ids each, as a Code task can carry several.
 * An AI run's, and a pull request record's.
 */
export interface AIRunCarriedKey {
  column: string;
  recordModelType: { new (): BaseModel };
}

export const AI_RUN_CARRIED_KEYS: ReadonlyArray<AIRunCarriedKey> = [
  { column: "carriedIncidentIds", recordModelType: Incident },
  { column: "carriedAlertIds", recordModelType: Alert },
];

// Every key of a run the rule reads: what a read of the run is narrowed by.
export const AI_RUN_ABOUT_KEYS: ReadonlyArray<string> = [
  ...AI_RUN_RECORD_KEYS.map((key: AIRunRecordKey): string => {
    return key.column;
  }),
  ...AI_RUN_PART_KEYS.map((key: AIRunPartKey): string => {
    return key.column;
  }),
  ...AI_RUN_CARRIED_KEYS.map((key: AIRunCarriedKey): string => {
    return key.column;
  }),
  AI_RUN_TASK_KEY,
];

// The keys a pull request record's own read is narrowed by: what it carries.
export const CARRIED_RECORD_COLUMNS: ReadonlyArray<string> =
  AI_RUN_CARRIED_KEYS.map((key: AIRunCarriedKey): string => {
    return key.column;
  });

/*
 * An id as a carried key lists it: a UUID, matched case-insensitively. An
 * entry that is not one is cast to no id, so the row naming it is read as
 * one carrying a record that is gone: only by those who see every private
 * record. Anchored at the start; its length is checked beside it.
 */
const CARRIED_ID_PATTERN: string =
  "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/*
 * A condition on one key, written for the key's SQL - a column of an alias,
 * or the column TypeORM hands a Raw - with the parameters it binds. Built
 * once, so every read gets parameter names and aliases of its own, and
 * written as often as its SQL is asked for.
 */
interface KeyCondition {
  write: (key: string) => string;
  parameters: Record<string, unknown>;
}

export default class AIRunOutputReadFilter {
  /*
   * The condition on a key naming an AI run that keeps the rows of the runs
   * the caller may read (see above), and those naming none. Undefined for
   * root and server admins, who read every one.
   */
  public static getReadableRunsRaw(
    props: DatabaseCommonInteractionProps,
  ): FindWhereProperty<any> | undefined {
    if (props.isRoot || props.isMasterAdmin) {
      return undefined;
    }

    const run: string = `aiRun${Text.generateRandomText(10)}`;
    const projectWide: string = `aiRunProjectWide_${Text.generateRandomText(10)}`;
    const startedByOneUptime: string = `aiRunNobodyAsked_${Text.generateRandomText(10)}`;

    const parameters: Record<string, unknown> = {
      [projectWide]: [...PROJECT_WIDE_RUNS],
      [startedByOneUptime]: [...RUNS_ONEUPTIME_STARTS],
    };

    const readBy: Array<string> = [
      `"${run}"."runType" IN (:...${projectWide})`,
      `("${run}"."userId" IS NULL AND "${run}"."runType" IN (:...${startedByOneUptime}))`,
    ];

    // The person who asked: an API key or a workflow's step is no person.
    if (props.userId) {
      const asker: string = `aiRunAsker_${Text.generateRandomText(10)}`;

      parameters[asker] = props.userId.toString();
      readBy.push(`"${run}"."userId" = :${asker}`);
    }

    const conditions: Array<string> = [
      `(${readBy.join(" OR ")})`,
      ...AIRunOutputReadFilter.writeAboutConditions({
        run: run,
        props: props,
        parameters: parameters,
      }),
    ];

    /*
     * Asked of each row's own run, by its primary key - never by gathering
     * every run, or every incident, the caller may read first.
     */
    return Raw((alias: string): string => {
      return `(${alias} IS NULL OR EXISTS (SELECT 1 FROM "AIRun" "${run}" WHERE "${run}"."_id" = ${alias} AND ${conditions.join(" AND ")}))`;
    }, parameters);
  }

  /*
   * `query` over `modelType`'s rows, kept to the rows whose `column` names
   * no AI run, or one the caller may read. The caller's own filter on the
   * column stays beside it - one of OneUptime's operators written as SQL
   * first, as the model writes it (QueryUtil.serializeQuery), so it is
   * kept rather than dropped. As it is for root and server admins.
   */
  public static applyToRunKey<T>(data: {
    query: T;
    props: DatabaseCommonInteractionProps;
    modelType: { new (): BaseModel };
    column: string;
  }): T {
    const readable: FindWhereProperty<any> | undefined =
      AIRunOutputReadFilter.getReadableRunsRaw(data.props);

    if (!readable) {
      return data.query;
    }

    return AIRunOutputReadFilter.addToColumn({
      query: data.query,
      modelType: data.modelType,
      column: data.column,
      condition: readable,
    });
  }

  /*
   * A query over the AI runs themselves (AIRunService: `/ai-run`, a find, a
   * count, a live update), kept to the runs about no private incident or
   * alert the caller does not see: each key the rule reads
   * (AI_RUN_ABOUT_KEYS) names none, or one they see - a record that exists
   * and is no private one they do not see, a fix whose record they see,
   * records carried that they see every one of, a task about what they see.
   * The caller's own filter on each key stays beside it. Who may read which
   * kind of run is the caller's (AIRunPrivacyFilter). As it is for those who
   * see every private record.
   */
  public static applyToRunRow<T>(
    query: T,
    props: DatabaseCommonInteractionProps,
  ): T {
    if (shouldBypassRecordPrivacy(props)) {
      return query;
    }

    const keys: Array<{ column: string; condition: KeyCondition | null }> = [
      ...AI_RUN_RECORD_KEYS.map((key: AIRunRecordKey) => {
        return {
          column: key.column,
          condition: AIRunOutputReadFilter.getRecordKeyCondition(key, props),
        };
      }),
      ...AI_RUN_PART_KEYS.map((key: AIRunPartKey) => {
        return {
          column: key.column,
          condition: AIRunOutputReadFilter.getPartKeyCondition(key, props),
        };
      }),
      ...AIRunOutputReadFilter.getCarriedKeyConditions(props),
      {
        column: AI_RUN_TASK_KEY,
        condition: AIRunOutputReadFilter.getTaskKeyCondition(props),
      },
    ];

    return AIRunOutputReadFilter.addConditions({
      query: query,
      modelType: AIRun,
      keys: keys,
    });
  }

  /*
   * A query over rows that carry records in keys of their own - a pull
   * request record OneUptime AI opened from a chat (#9186) - kept to the rows
   * carrying none the caller does not see: every record each key lists
   * exists, and is no private one they do not see. The caller's own filter
   * on each key stays beside it. As it is for those who see every private
   * record.
   */
  public static applyToCarriedKeys<T>(data: {
    query: T;
    props: DatabaseCommonInteractionProps;
    modelType: { new (): BaseModel };
  }): T {
    if (shouldBypassRecordPrivacy(data.props)) {
      return data.query;
    }

    return AIRunOutputReadFilter.addConditions({
      query: data.query,
      modelType: data.modelType,
      keys: AIRunOutputReadFilter.getCarriedKeyConditions(data.props),
    });
  }

  /*
   * The same, for a statement written with positional parameters - the Code
   * pages' count of a repository's open pull requests (CodeTaskStats): the
   * SQL that keeps the row `alias` to the rows carrying no record the
   * caller does not see, each value it binds added to `parameters` as `$n`.
   * Null for those who see every private record.
   */
  public static getCarriedRecordsSql(data: {
    alias: string;
    props: DatabaseCommonInteractionProps;
    parameters: Array<unknown>;
  }): string | null {
    if (shouldBypassRecordPrivacy(data.props)) {
      return null;
    }

    const named: Record<string, unknown> = {};
    const conditions: Array<string> = [];

    for (const key of AIRunOutputReadFilter.getCarriedKeyConditions(
      data.props,
    )) {
      if (!key.condition) {
        continue;
      }

      Object.assign(named, key.condition.parameters);
      conditions.push(key.condition.write(`"${data.alias}"."${key.column}"`));
    }

    if (conditions.length === 0) {
      return null;
    }

    return AIRunOutputReadFilter.toPositional({
      sql: `(${conditions.join(" AND ")})`,
      named: named,
      parameters: data.parameters,
    });
  }

  /*
   * The same rule, for a statement written with positional parameters - the
   * Code pages' own reads (CodeTaskListQuery, CodeTaskStats): the SQL that
   * keeps the run `alias` (a table alias, "AIRun" for the table read
   * without one) to the runs about no private record the caller does not
   * see, each value it binds added to `parameters` as `$n`. Null for those
   * who see every private record.
   */
  public static getRunAboutSql(data: {
    alias: string;
    props: DatabaseCommonInteractionProps;
    parameters: Array<unknown>;
  }): string | null {
    if (shouldBypassRecordPrivacy(data.props)) {
      return null;
    }

    const named: Record<string, unknown> = {};
    const conditions: Array<string> =
      AIRunOutputReadFilter.writeAboutConditions({
        run: data.alias,
        props: data.props,
        parameters: named,
      });

    if (conditions.length === 0) {
      return null;
    }

    return AIRunOutputReadFilter.toPositional({
      sql: `(${conditions.join(" AND ")})`,
      named: named,
      parameters: data.parameters,
    });
  }

  /*
   * getReadableRunsRaw on the key `key` (its SQL: "pullRequest"."aiRunId"),
   * for a statement written with positional parameters - a pull request,
   * read through its run. Null for root and server admins.
   */
  public static getReadableRunsSql(data: {
    key: string;
    props: DatabaseCommonInteractionProps;
    parameters: Array<unknown>;
  }): string | null {
    const readable: FindWhereProperty<any> | undefined =
      AIRunOutputReadFilter.getReadableRunsRaw(data.props);

    if (!readable) {
      return null;
    }

    const operator: FindOperator<unknown> =
      readable as unknown as FindOperator<unknown>;

    return AIRunOutputReadFilter.toPositional({
      sql: (operator.getSql as (alias: string) => string)(data.key),
      named: (operator.objectLiteralParameters || {}) as Record<
        string,
        unknown
      >,
      parameters: data.parameters,
    });
  }

  /*
   * The conditions on the run `run` (an alias) that keep it to the runs
   * about no private record the caller does not see: its own keys, and the
   * task it is a turn of. None for those who see every private record.
   */
  private static writeAboutConditions(data: {
    run: string;
    props: DatabaseCommonInteractionProps;
    parameters: Record<string, unknown>;
  }): Array<string> {
    const conditions: Array<string> =
      AIRunOutputReadFilter.writeOwnConditions(data);

    const task: KeyCondition | null = AIRunOutputReadFilter.getTaskKeyCondition(
      data.props,
    );

    if (task) {
      Object.assign(data.parameters, task.parameters);
      conditions.push(task.write(`"${data.run}"."${AI_RUN_TASK_KEY}"`));
    }

    return conditions;
  }

  /*
   * The conditions on the run's own keys: its record, its fix and the
   * records it carries.
   */
  private static writeOwnConditions(data: {
    run: string;
    props: DatabaseCommonInteractionProps;
    parameters: Record<string, unknown>;
  }): Array<string> {
    const conditions: Array<string> = [];

    const written: Array<{ column: string; condition: KeyCondition | null }> = [
      ...AI_RUN_RECORD_KEYS.map((key: AIRunRecordKey) => {
        return {
          column: key.column,
          condition: AIRunOutputReadFilter.getRecordKeyCondition(
            key,
            data.props,
          ),
        };
      }),
      ...AI_RUN_PART_KEYS.map((key: AIRunPartKey) => {
        return {
          column: key.column,
          condition: AIRunOutputReadFilter.getPartKeyCondition(key, data.props),
        };
      }),
      ...AIRunOutputReadFilter.getCarriedKeyConditions(data.props),
    ];

    for (const key of written) {
      if (!key.condition) {
        continue;
      }

      Object.assign(data.parameters, key.condition.parameters);
      conditions.push(key.condition.write(`"${data.run}"."${key.column}"`));
    }

    return conditions;
  }

  /*
   * A key naming an incident or an alert: no record, or one that exists and
   * is no private one the caller does not see. A record that is gone names
   * none the caller sees: nothing says any more whether it was private.
   * Null for those who see every private record.
   */
  private static getRecordKeyCondition(
    key: AIRunRecordKey,
    props: DatabaseCommonInteractionProps,
  ): KeyCondition | null {
    const kind: PrivateRecordKind = PrivateRecordPermission.getKind(
      new key.recordModelType().tableName,
    )!;

    // No record of the kind, or one that is no private one they do not see.
    const notUnseen: FindWhereProperty<any> | undefined =
      PrivateRecordReadFilter.getOptionalRecordReadRaw({
        kind: kind,
        props: props,
      });

    // Those who see every private record read a run about any of them.
    if (!notUnseen) {
      return null;
    }

    const operator: FindOperator<unknown> =
      notUnseen as unknown as FindOperator<unknown>;
    const getSql: (alias: string) => string = operator.getSql as (
      alias: string,
    ) => string;
    const record: string = `aiRunRecord${Text.generateRandomText(10)}`;

    return {
      parameters: { ...(operator.objectLiteralParameters || {}) },
      write: (column: string): string => {
        return `(${column} IS NULL OR (EXISTS (SELECT 1 FROM "${kind.tableName}" "${record}" WHERE "${record}"."_id" = ${column}) AND ${getSql(column)}))`;
      },
    };
  }

  /*
   * A key naming a part of a private record - a fix OneUptime AI proposed
   * for an incident or alert: no part, or one that exists and whose every
   * private record it names the caller sees. A fix that is gone - deleted
   * with its record (#9103) - names none the caller sees, as its commands
   * are read (#9154). Null for those who see every private record.
   */
  private static getPartKeyCondition(
    key: AIRunPartKey,
    props: DatabaseCommonInteractionProps,
  ): KeyCondition | null {
    if (shouldBypassRecordPrivacy(props)) {
      return null;
    }

    const part: string = `aiRunPart${Text.generateRandomText(10)}`;
    const parameters: Record<string, unknown> = {};
    const seen: Array<string> = [];

    for (const recordColumn of PrivateRecordPermission.getPrivateRecordColumns(
      key.partModelType,
    )) {
      const notUnseen: FindWhereProperty<any> | undefined =
        PrivateRecordReadFilter.getOptionalRecordReadRaw({
          kind: recordColumn.kind,
          props: props,
        });

      if (!notUnseen) {
        continue;
      }

      const operator: FindOperator<unknown> =
        notUnseen as unknown as FindOperator<unknown>;

      Object.assign(parameters, operator.objectLiteralParameters || {});
      seen.push(
        (operator.getSql as (alias: string) => string)(
          `"${part}"."${AIRunOutputReadFilter.getKeyOf(recordColumn)}"`,
        ),
      );
    }

    const tableName: string = new key.partModelType().tableName as string;

    return {
      parameters: parameters,
      write: (column: string): string => {
        return `(${column} IS NULL OR EXISTS (SELECT 1 FROM "${tableName}" "${part}" WHERE "${part}"."_id" = ${column}${seen
          .map((condition: string): string => {
            return ` AND ${condition}`;
          })
          .join("")}))`;
      },
    };
  }

  /*
   * The key naming a turn's task: no task - the run is a task's first turn,
   * or no Code task at all - or a task whose own keys meet the rule. A task
   * that is gone is about nothing the caller is known to see. Null for those
   * who see every private record.
   */
  private static getTaskKeyCondition(
    props: DatabaseCommonInteractionProps,
  ): KeyCondition | null {
    const task: string = `aiRunTask${Text.generateRandomText(10)}`;
    const parameters: Record<string, unknown> = {};
    const conditions: Array<string> = AIRunOutputReadFilter.writeOwnConditions({
      run: task,
      props: props,
      parameters: parameters,
    });

    if (conditions.length === 0) {
      return null;
    }

    return {
      parameters: parameters,
      write: (column: string): string => {
        return `(${column} IS NULL OR EXISTS (SELECT 1 FROM "AIRun" "${task}" WHERE "${task}"."_id" = ${column} AND ${conditions.join(" AND ")}))`;
      },
    };
  }

  // A condition for each key listing the records a row carries.
  private static getCarriedKeyConditions(
    props: DatabaseCommonInteractionProps,
  ): Array<{ column: string; condition: KeyCondition | null }> {
    return AI_RUN_CARRIED_KEYS.map((key: AIRunCarriedKey) => {
      return {
        column: key.column,
        condition: AIRunOutputReadFilter.getCarriedKeyCondition(key, props),
      };
    });
  }

  /*
   * A key listing the incidents or alerts a row carries (#9186): no list,
   * or one whose every entry is a record that exists and is no private one
   * the caller does not see. Written as what it leaves out - NOT EXISTS an
   * entry that fails - so each entry is looked up by its primary key, and a
   * row carrying none costs nothing. An entry that is no id is cast to none
   * (a CASE, which Postgres evaluates in order, so no cast ever fails a
   * read) and fails, as a record that is gone does: nothing says any more
   * whether it was private. Null for those who see every private record.
   */
  private static getCarriedKeyCondition(
    key: AIRunCarriedKey,
    props: DatabaseCommonInteractionProps,
  ): KeyCondition | null {
    const kind: PrivateRecordKind = PrivateRecordPermission.getKind(
      new key.recordModelType().tableName,
    )!;

    const notUnseen: FindWhereProperty<any> | undefined =
      PrivateRecordReadFilter.getOptionalRecordReadRaw({
        kind: kind,
        props: props,
      });

    if (!notUnseen) {
      return null;
    }

    const operator: FindOperator<unknown> =
      notUnseen as unknown as FindOperator<unknown>;
    const getSql: (alias: string) => string = operator.getSql as (
      alias: string,
    ) => string;
    const random: string = Text.generateRandomText(10);
    const entry: string = `aiRunCarried${random}`;
    const id: string = `aiRunCarriedId${random}`;
    const record: string = `aiRunCarriedRecord${random}`;
    const carriedId: string = `"${id}"."id"`;

    return {
      parameters: { ...(operator.objectLiteralParameters || {}) },
      write: (column: string): string => {
        const list: string = `CASE WHEN jsonb_typeof(${column}) = 'array' THEN ${column} ELSE CAST('[]' AS jsonb) END`;
        const asId: string = `CASE WHEN char_length("${entry}"."value") = 36 AND "${entry}"."value" ~* '${CARRIED_ID_PATTERN}' THEN CAST("${entry}"."value" AS uuid) END`;

        return `(${column} IS NULL OR NOT EXISTS (SELECT 1 FROM (SELECT ${asId} AS "id" FROM jsonb_array_elements_text(${list}) AS "${entry}"("value")) AS "${id}" WHERE NOT (${carriedId} IS NOT NULL AND EXISTS (SELECT 1 FROM "${kind.tableName}" "${record}" WHERE "${record}"."_id" = ${carriedId}) AND ${getSql(carriedId)})))`;
      },
    };
  }

  /*
   * `query`, with each key's condition put on its column beside the
   * caller's own filter on it.
   */
  private static addConditions<T>(data: {
    query: T;
    modelType: { new (): BaseModel };
    keys: Array<{ column: string; condition: KeyCondition | null }>;
  }): T {
    let filtered: T = data.query;

    for (const key of data.keys) {
      if (!key.condition) {
        continue;
      }

      filtered = AIRunOutputReadFilter.addToColumn({
        query: filtered,
        modelType: data.modelType,
        column: key.column,
        condition: Raw(key.condition.write, key.condition.parameters),
      });
    }

    return filtered;
  }

  // The column of a part's row naming a private record.
  private static getKeyOf(column: PrivateRecordColumn): string {
    return column.isRecord ? "_id" : column.column;
  }

  /*
   * `query`, with `condition` put on `column` beside the caller's own filter
   * on it, which stays - one of OneUptime's operators written as SQL first,
   * as the model writes it (QueryUtil.serializeQuery), so it is kept rather
   * than dropped.
   */
  private static addToColumn<T>(data: {
    query: T;
    modelType: { new (): BaseModel };
    column: string;
    condition: FindWhereProperty<any>;
  }): T {
    const filtered: Record<string, unknown> = (data.query || {}) as Record<
      string,
      unknown
    >;

    let existing: unknown = filtered[data.column];

    if (existing instanceof QueryOperator) {
      existing = (
        QueryUtil.serializeQuery(data.modelType, {
          [data.column]: existing,
        } as never) as Record<string, unknown>
      )[data.column];
    }

    filtered[data.column] = combineWithPrivacyClause(existing, data.condition);

    return filtered as T;
  }

  /*
   * SQL written with named parameters (`:name`, `:...name` for a list),
   * written with positional ones instead: each value added to `parameters`,
   * and its name replaced by `$n` (a list by one `$n` a value). Every name
   * here is one this file or PrivateRecordReadFilter made up, with ten
   * random characters, so none is part of the SQL around it; longest first,
   * so none is read as the start of another.
   */
  private static toPositional(data: {
    sql: string;
    named: Record<string, unknown>;
    parameters: Array<unknown>;
  }): string {
    let sql: string = data.sql;

    const names: Array<string> = Object.keys(data.named).sort(
      (left: string, right: string): number => {
        return right.length - left.length;
      },
    );

    for (const name of names) {
      const value: unknown = data.named[name];
      const pattern: RegExp = new RegExp(
        `:(\\.\\.\\.)?${name}(?![A-Za-z0-9_])`,
        "g",
      );

      let placeholder: string | null = null;

      sql = sql.replace(pattern, (_match: string, spread?: string): string => {
        if (spread && Array.isArray(value)) {
          return value
            .map((each: unknown): string => {
              return `$${data.parameters.push(each)}`;
            })
            .join(", ");
        }

        if (placeholder === null) {
          placeholder = `$${data.parameters.push(value)}`;
        }

        return placeholder;
      });
    }

    return sql;
  }
}
