import Alert from "../../../Models/DatabaseModels/Alert";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import AIRunType from "../../../Types/AI/AIRunType";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { FindWhereProperty } from "../../../Types/BaseDatabase/Query";
import QueryOperator from "../../../Types/BaseDatabase/QueryOperator";
import Text from "../../../Types/Text";
import PrivateRecordPermission, {
  PrivateRecordKind,
} from "../../Types/Database/Permissions/PrivateRecordPermission";
import QueryUtil from "../../Types/Database/QueryUtil";
import PrivateRecordReadFilter from "../Permission/PrivateRecordReadFilter";
import { combineWithPrivacyClause } from "../PrivacyFilterUtil";
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
 * Written on the key naming the run, as a lookup of that run by its primary
 * key - `key IS NULL OR EXISTS (SELECT 1 FROM "AIRun" ... WHERE _id = key
 * AND ...)` - and of the incident or alert it is about by theirs: a row
 * naming no run is not narrowed by it, and a read never gathers every run
 * or every record the caller may read first.
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

    const conditions: Array<string> = [`(${readBy.join(" OR ")})`];

    for (const key of AI_RUN_RECORD_KEYS) {
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
        continue;
      }

      const operator: FindOperator<unknown> =
        notUnseen as unknown as FindOperator<unknown>;
      const column: string = `"${run}"."${key.column}"`;
      const record: string = `aiRunRecord${Text.generateRandomText(10)}`;

      Object.assign(parameters, operator.objectLiteralParameters || {});

      /*
       * A record that is gone names none the caller sees: nothing says any
       * more whether it was private.
       */
      conditions.push(
        `(${column} IS NULL OR (EXISTS (SELECT 1 FROM "${kind.tableName}" "${record}" WHERE "${record}"."_id" = ${column}) AND ${(operator.getSql as (alias: string) => string)(column)}))`,
      );
    }

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

    filtered[data.column] = combineWithPrivacyClause(existing, readable);

    return filtered as T;
  }
}
