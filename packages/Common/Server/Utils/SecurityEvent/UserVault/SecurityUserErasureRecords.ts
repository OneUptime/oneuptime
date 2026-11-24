import PostgresAppInstance from "../../../Infrastructure/PostgresDatabase";
import SecurityCaseAiActionService from "../../../Services/SecurityCaseAiActionService";
import SecurityCaseService from "../../../Services/SecurityCaseService";
import SecurityDetectionService from "../../../Services/SecurityDetectionService";
import SecurityPlaybookRunService from "../../../Services/SecurityPlaybookRunService";
import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import SecurityCaseAiAction from "../../../../Models/DatabaseModels/SecurityCaseAiAction";
import SecurityDetection from "../../../../Models/DatabaseModels/SecurityDetection";
import SecurityPlaybookRun from "../../../../Models/DatabaseModels/SecurityPlaybookRun";
import Includes from "../../../../Types/BaseDatabase/Includes";
import PartialEntity from "../../../../Types/Database/PartialEntity";
import OneUptimeDate from "../../../../Types/Date";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  SecurityCaseAiActionReason,
  SecurityCaseAiActionStatus,
} from "../../../../Types/SecurityCase/SecurityCaseAi";
import SecurityPlaybookRunStatus from "../../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import {
  ErasedName,
  getErasedRiskKeys,
  unnameGroupingKey,
  unnameJson,
  unnameTitle,
  unnameValue,
} from "../../../../Utils/SecurityEvent/SecurityUserErasureUnnaming";
import { getEntityCaseGroupingKey } from "../../../../Utils/SecurityCase/SecurityEntityRiskScore";
import logger from "../../Logger";

/*
 * WHAT AN ERASURE CHANGES IN POSTGRES (#10908): the person taken out of
 * what Security Events wrote about them once the user vault named them.
 * Each place gets what the Hash rule left in the name's place
 * (Utils/SecurityEvent/SecurityUserErasureUnnaming says which values):
 *
 *   - detections: their title, entities, group value and kept events;
 *   - cases: their title, entities and grouping key;
 *   - entity risk: the person's row is deleted. Risk is worked out again
 *     from what is found, which names the token from now on;
 *   - proposals: an action of OneUptime AI's waiting for a person's
 *     approval to act on them is withdrawn (Left, PersonErased), and a
 *     playbook run waiting for approval is cancelled - nobody may act on a
 *     person after they were erased because the vault named them. The
 *     target of every action and the results of every run that named them
 *     get the token too.
 *
 * What it does not change: what people wrote (notes, closing notes,
 * tasks, evidence, custom fields, watchlists, protected entities),
 * OneUptime AI's written reports, a case's feed, incidents and alerts a
 * detection opened, and notifications already sent.
 *
 * WRITTEN WITHOUT THE AUDIT LOG KEEPING THE NAME. An audited update records
 * the values it replaced, and an audited delete the whole row: through the
 * services, erasing a case's title would copy the person's name into the
 * audit log. So cases, a run's results and entity risk rows are written
 * with SQL of their own, and the erasure request records what it changed
 * (its counts). Detections and OneUptime AI's actions are not audited, and
 * are written through their services, as the server, without their hooks.
 *
 * Every step finds only what still names the person, so running it again
 * changes nothing more.
 */

// The most rows of one kind one run takes the person out of.
export const MAX_ROWS_PER_KIND: number = 5000;

// What an erasure changed in Postgres.
export interface SecurityUserErasureRecordCounts {
  // Cases that named the person, themselves or through their detections.
  cases: number;
  // Proposals to act on the person that were withdrawn.
  proposals: number;
}

// The run statuses a proposal still waits in: nothing it would do has been done.
const WAITING_RUN_STATUSES: ReadonlyArray<SecurityPlaybookRunStatus> = [
  SecurityPlaybookRunStatus.WaitingForApproval,
  SecurityPlaybookRunStatus.WaitingForOneUptimeAi,
];

// Why a run was cancelled, on its case's feed.
export const RUN_CANCELLED_FOR_ERASURE_MARKDOWN: string =
  "Cancelled: the person it would act on was erased from Security Events on request.";

interface IdRow {
  _id: string;
}

function namesOf(names: ReadonlyArray<ErasedName>): Array<string> {
  return names.map((name: ErasedName): string => {
    return name.named;
  });
}

// Each name as jsonb writes a string value: how it shows in a JSON column's text.
function jsonNamesOf(names: ReadonlyArray<ErasedName>): Array<string> {
  return names.map((name: ErasedName): string => {
    return JSON.stringify(name.named);
  });
}

function idsOf(rows: Array<IdRow>): Array<ObjectID> {
  return rows
    .map((row: IdRow): string => {
      return String(row._id || "");
    })
    .filter((id: string): boolean => {
      return ObjectID.isValidUUID(id);
    })
    .map((id: string): ObjectID => {
      return new ObjectID(id);
    });
}

export default class SecurityUserErasureRecords {
  private static async query(
    sql: string,
    parameters: Array<unknown>,
  ): Promise<Array<IdRow>> {
    return (await PostgresAppInstance.getDataSource()!.query(
      sql,
      parameters,
    )) as Array<IdRow>;
  }

  /*
   * Takes the person out of what Security Events wrote about them in a
   * project. See the file's comment.
   */
  public static async unnameRecords(data: {
    projectId: ObjectID;
    names: ReadonlyArray<ErasedName>;
  }): Promise<SecurityUserErasureRecordCounts> {
    const names: Array<ErasedName> = data.names.filter(
      (name: ErasedName): boolean => {
        return (
          Boolean(name.named) &&
          Boolean(name.hashed) &&
          name.named !== name.hashed
        );
      },
    );

    if (names.length === 0) {
      return { cases: 0, proposals: 0 };
    }

    const caseIds: Set<string> = new Set<string>();

    for (const caseId of await this.unnameDetections({
      projectId: data.projectId,
      names,
    })) {
      caseIds.add(caseId);
    }

    for (const caseId of await this.unnameCases({
      projectId: data.projectId,
      names,
    })) {
      caseIds.add(caseId);
    }

    await this.deleteEntityRisk({ projectId: data.projectId, names });

    const proposals: number =
      (await this.withdrawAiActions({ projectId: data.projectId, names })) +
      (await this.withdrawPlaybookRuns({ projectId: data.projectId, names }));

    return { cases: caseIds.size, proposals };
  }

  /*
   * The project's detections that name the person: in their group value,
   * their title, their entities or their kept events. Returns the cases of
   * the ones it changed.
   */
  public static async unnameDetections(data: {
    projectId: ObjectID;
    names: ReadonlyArray<ErasedName>;
  }): Promise<Array<string>> {
    const ids: Array<ObjectID> = idsOf(
      await this.query(
        `SELECT "_id" FROM "SecurityDetection" WHERE "projectId" = $1 AND "deletedAt" IS NULL AND ("groupValue" = ANY($2::text[]) OR EXISTS (SELECT 1 FROM unnest($2::text[]) AS erased(name) WHERE strpos("title", erased.name) > 0) OR EXISTS (SELECT 1 FROM unnest($3::text[]) AS erased(name) WHERE strpos(COALESCE("entities"::text, ''), erased.name) > 0 OR strpos(COALESCE("matchedEvents"::text, ''), erased.name) > 0)) LIMIT ${MAX_ROWS_PER_KIND}`,
        [
          data.projectId.toString(),
          namesOf(data.names),
          jsonNamesOf(data.names),
        ],
      ),
    );

    if (ids.length === 0) {
      return [];
    }

    const detections: Array<SecurityDetection> =
      await SecurityDetectionService.findBy({
        query: { projectId: data.projectId, _id: new Includes(ids) },
        select: {
          _id: true,
          securityCaseId: true,
          title: true,
          groupValue: true,
          entities: true,
          matchedEvents: true,
        },
        skip: 0,
        limit: ids.length,
        props: { isRoot: true },
      });

    const caseIds: Array<string> = [];

    for (const detection of detections) {
      const changes: Record<string, unknown> = {};
      const title: string | undefined | null = unnameTitle(
        detection.title,
        data.names,
      );
      const groupValue: string | undefined | null = unnameValue(
        detection.groupValue,
        data.names,
      );
      const entities: { value: JSONArray | undefined; changed: boolean } =
        unnameJson(detection.entities, data.names);
      const matchedEvents: {
        value: JSONObject | undefined;
        changed: boolean;
      } = unnameJson(detection.matchedEvents, data.names);

      if (title !== detection.title) {
        changes["title"] = title;
      }

      if (groupValue !== detection.groupValue) {
        changes["groupValue"] = groupValue;
      }

      if (entities.changed) {
        changes["entities"] = entities.value;
      }

      if (matchedEvents.changed) {
        changes["matchedEvents"] = matchedEvents.value;
      }

      if (Object.keys(changes).length === 0 || !detection.id) {
        continue;
      }

      await SecurityDetectionService.updateOneById({
        id: detection.id,
        data: changes as never,
        props: { isRoot: true, ignoreHooks: true },
      });

      if (detection.securityCaseId) {
        caseIds.push(detection.securityCaseId.toString());
      }
    }

    return caseIds;
  }

  /*
   * The project's cases that name the person: in their title, their
   * entities or their grouping key. Returns the ones it changed. Written
   * with SQL of its own, so the audit log never keeps the name the case
   * held (see the file's comment).
   */
  public static async unnameCases(data: {
    projectId: ObjectID;
    names: ReadonlyArray<ErasedName>;
  }): Promise<Array<string>> {
    // The grouping keys a case about one of the names holds.
    const keysAboutNames: Array<string> = data.names.map(
      (name: ErasedName): string => {
        return getEntityCaseGroupingKey(name.named);
      },
    );

    const ids: Array<ObjectID> = idsOf(
      await this.query(
        `SELECT "_id" FROM "SecurityCase" WHERE "projectId" = $1 AND "deletedAt" IS NULL AND ("groupingKey" = ANY($4::text[]) OR EXISTS (SELECT 1 FROM unnest($2::text[]) AS erased(name) WHERE strpos("title", erased.name) > 0) OR EXISTS (SELECT 1 FROM unnest($3::text[]) AS erased(name) WHERE strpos(COALESCE("entities"::text, ''), erased.name) > 0)) LIMIT ${MAX_ROWS_PER_KIND}`,
        [
          data.projectId.toString(),
          namesOf(data.names),
          jsonNamesOf(data.names),
          keysAboutNames,
        ],
      ),
    );

    if (ids.length === 0) {
      return [];
    }

    const cases: Array<SecurityCase> = await SecurityCaseService.findBy({
      query: { projectId: data.projectId, _id: new Includes(ids) },
      select: {
        _id: true,
        title: true,
        entities: true,
        groupingKey: true,
      },
      skip: 0,
      limit: ids.length,
      props: { isRoot: true },
    });

    const changedIds: Array<string> = [];

    for (const securityCase of cases) {
      const title: string | undefined | null = unnameTitle(
        securityCase.title,
        data.names,
      );
      const entities: { value: JSONArray | undefined; changed: boolean } =
        unnameJson(securityCase.entities, data.names);
      const groupingKey: string | undefined | null = unnameGroupingKey(
        securityCase.groupingKey,
        data.names,
      );

      if (
        !securityCase.id ||
        (title === securityCase.title &&
          !entities.changed &&
          groupingKey === securityCase.groupingKey)
      ) {
        continue;
      }

      await this.writeCase({
        projectId: data.projectId,
        caseId: securityCase.id,
        title: title ?? null,
        entities: entities.value ?? null,
        groupingKey: groupingKey ?? null,
      });

      changedIds.push(securityCase.id.toString());
    }

    return changedIds;
  }

  // A case's title, entities and grouping key, as the erasure leaves them.
  private static async writeCase(data: {
    projectId: ObjectID;
    caseId: ObjectID;
    title: string | null;
    entities: JSONArray | null;
    groupingKey: string | null;
  }): Promise<void> {
    await this.query(
      `UPDATE "SecurityCase" SET "title" = $3, "entities" = $4::jsonb, "groupingKey" = $5, "updatedAt" = now(), "version" = "version" + 1 WHERE "_id" = $1 AND "projectId" = $2`,
      [
        data.caseId.toString(),
        data.projectId.toString(),
        data.title,
        data.entities === null ? null : JSON.stringify(data.entities),
        data.groupingKey,
      ],
    );
  }

  /*
   * The person's entity risk rows, deleted with SQL of their own: an
   * audited delete keeps the row, name and all, in the audit log.
   */
  public static async deleteEntityRisk(data: {
    projectId: ObjectID;
    names: ReadonlyArray<ErasedName>;
  }): Promise<void> {
    const keys: Array<string> = getErasedRiskKeys(data.names);

    if (keys.length === 0) {
      return;
    }

    await this.query(
      `DELETE FROM "SecurityEntityRisk" WHERE "projectId" = $1 AND "entityKey" = ANY($2::text[])`,
      [data.projectId.toString(), keys],
    );
  }

  /*
   * OneUptime AI's actions that name the person: each one's target and
   * evidence get the token, and one waiting for a person's approval is
   * withdrawn - Left, because the person was erased - claimed from Asked,
   * so a person approving it at the same moment wins or loses cleanly.
   * Returns how many were withdrawn.
   */
  public static async withdrawAiActions(data: {
    projectId: ObjectID;
    names: ReadonlyArray<ErasedName>;
  }): Promise<number> {
    const ids: Array<ObjectID> = idsOf(
      await this.query(
        `SELECT "_id" FROM "SecurityCaseAiAction" WHERE "projectId" = $1 AND "deletedAt" IS NULL AND ("target" = ANY($2::text[]) OR EXISTS (SELECT 1 FROM unnest($3::text[]) AS erased(name) WHERE strpos(COALESCE("evidence"::text, ''), erased.name) > 0)) LIMIT ${MAX_ROWS_PER_KIND}`,
        [
          data.projectId.toString(),
          namesOf(data.names),
          jsonNamesOf(data.names),
        ],
      ),
    );

    if (ids.length === 0) {
      return 0;
    }

    const actions: Array<SecurityCaseAiAction> =
      await SecurityCaseAiActionService.findBy({
        query: { projectId: data.projectId, _id: new Includes(ids) },
        select: { _id: true, status: true, target: true, evidence: true },
        skip: 0,
        limit: ids.length,
        props: { isRoot: true },
      });

    let withdrawn: number = 0;

    for (const action of actions) {
      if (!action.id) {
        continue;
      }

      const target: string | undefined | null = unnameValue(
        action.target,
        data.names,
      );
      const evidence: { value: JSONObject | undefined; changed: boolean } =
        unnameJson(action.evidence, data.names);
      const changes: Record<string, unknown> = {};

      if (target !== action.target) {
        changes["target"] = target;
      }

      if (evidence.changed) {
        changes["evidence"] = evidence.value;
      }

      if (action.status === SecurityCaseAiActionStatus.Asked) {
        const isClaimed: boolean =
          await SecurityCaseAiActionService.compareAndSetColumnsByIdWithoutHooks(
            {
              id: action.id,
              data: {
                ...changes,
                status: SecurityCaseAiActionStatus.Left,
                reason: SecurityCaseAiActionReason.PersonErased,
                decidedAt: OneUptimeDate.getCurrentDate(),
              } as unknown as PartialEntity<SecurityCaseAiAction>,
              expectedData: {
                status: SecurityCaseAiActionStatus.Asked,
              } as unknown as PartialEntity<SecurityCaseAiAction>,
            },
          );

        if (isClaimed) {
          withdrawn++;
          continue;
        }
      }

      if (Object.keys(changes).length === 0) {
        continue;
      }

      await SecurityCaseAiActionService.updateOneById({
        id: action.id,
        data: changes as never,
        props: { isRoot: true, ignoreHooks: true },
      });
    }

    return withdrawn;
  }

  /*
   * Playbook runs whose results name the person: their results get the
   * token, with SQL of their own (a run is audited), and a run still
   * waiting - for a person's approval, or for OneUptime AI - is cancelled,
   * and its case's feed says why. Returns how many were cancelled.
   */
  public static async withdrawPlaybookRuns(data: {
    projectId: ObjectID;
    names: ReadonlyArray<ErasedName>;
  }): Promise<number> {
    const ids: Array<ObjectID> = idsOf(
      await this.query(
        `SELECT "_id" FROM "SecurityPlaybookRun" WHERE "projectId" = $1 AND "deletedAt" IS NULL AND EXISTS (SELECT 1 FROM unnest($2::text[]) AS erased(name) WHERE strpos(COALESCE("stepResults"::text, ''), erased.name) > 0) LIMIT ${MAX_ROWS_PER_KIND}`,
        [data.projectId.toString(), jsonNamesOf(data.names)],
      ),
    );

    if (ids.length === 0) {
      return 0;
    }

    const runs: Array<SecurityPlaybookRun> =
      await SecurityPlaybookRunService.findBy({
        query: { projectId: data.projectId, _id: new Includes(ids) },
        select: { _id: true, status: true, stepResults: true },
        skip: 0,
        limit: ids.length,
        props: { isRoot: true },
      });

    let cancelled: number = 0;

    for (const run of runs) {
      if (!run.id) {
        continue;
      }

      const results: { value: JSONArray | undefined; changed: boolean } =
        unnameJson(run.stepResults, data.names);

      if (!results.changed) {
        continue;
      }

      await this.query(
        `UPDATE "SecurityPlaybookRun" SET "stepResults" = $3::jsonb, "updatedAt" = now(), "version" = "version" + 1 WHERE "_id" = $1 AND "projectId" = $2`,
        [
          run.id.toString(),
          data.projectId.toString(),
          JSON.stringify(results.value ?? []),
        ],
      );

      if (
        !run.status ||
        !WAITING_RUN_STATUSES.includes(run.status as SecurityPlaybookRunStatus)
      ) {
        continue;
      }

      const isClaimed: boolean =
        await SecurityPlaybookRunService.compareAndSetColumnsByIdWithoutHooks({
          id: run.id,
          data: {
            status: SecurityPlaybookRunStatus.Cancelled,
          } as unknown as PartialEntity<SecurityPlaybookRun>,
          expectedData: {
            status: run.status,
          } as unknown as PartialEntity<SecurityPlaybookRun>,
        });

      if (!isClaimed) {
        continue;
      }

      cancelled++;

      try {
        await SecurityPlaybookRunService.recordCancellation({
          runId: run.id,
          reasonInMarkdown: RUN_CANCELLED_FOR_ERASURE_MARKDOWN,
        });
      } catch (error) {
        logger.error(
          `SecurityUserErasureRecords: could not record the cancellation of run ${run.id.toString()}; it is cancelled.`,
        );
        logger.error(error);
      }
    }

    return cancelled;
  }
}
