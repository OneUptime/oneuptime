import DataSecurityAiProposal from "../../../../Models/DatabaseModels/DataSecurityAiProposal";
import DataSecuritySetting from "../../../../Models/DatabaseModels/DataSecuritySetting";
import DataStore from "../../../../Models/DatabaseModels/DataStore";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import {
  DATA_SECURITY_AI_PROPOSAL_KINDS,
  DataSecurityAiAutonomy,
  DataSecurityAiProposalKind,
  DataSecurityAiProposalStatus,
  getDataSecurityAiPlanFingerprint,
} from "../../../../Types/DataSecurity/DataSecurityAi";
import {
  DATA_TYPE_CATALOG,
  DataTypeInfo,
} from "../../../../Types/DataSecurity/DataTypeCatalog";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  CandidateInputField,
  DataTypeCandidate,
  DataTypeCandidateField,
  findDataTypeCandidates,
} from "../../../../Utils/DataSecurity/DataTypeCandidates";
import {
  checkDataTypeDraft,
  DataTypeDraft,
  DataTypeDraftProblem,
  DataTypeDropReason,
  DataTypeGroupField,
  DataTypeProposalPlan,
  DROPPED_DATA_TYPE_COOLDOWN_DAYS,
  MAX_DRAFT_WORDS,
  MAX_PLAN_FIELDS,
  narrowDataTypeDraft,
  PROVING_HOURS,
} from "../../../../Utils/DataSecurity/DataTypeProposal";
import { splitFieldName } from "../../../../Utils/DataSecurity/FieldNameHints";
import {
  fieldOwnName,
  UnplacedField,
} from "../../../../Utils/DataSecurity/UnplacedFields";
import AIService, { AILogResponse } from "../../../Services/AIService";
import DataSecurityAiProposalService from "../../../Services/DataSecurityAiProposalService";
import DataSecuritySettingService from "../../../Services/DataSecuritySettingService";
import DataStoreService from "../../../Services/DataStoreService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import DataSecurityRunner from "../../DataSecurity/DataSecurityRunner";
import DataTypeProving from "../../DataSecurity/DataTypeProving";
import {
  FieldAnswer,
  FieldSuggestionState,
  getFieldAnswerKey,
  keepStandingAnswers,
  readFieldSuggestionState,
} from "../../DataSecurity/FieldSuggestionState";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import {
  AiDataTypeDraftRetry,
  buildDraftDataTypePrompt,
} from "./DataSecurityAiInput";
import DataSecurityAiCall from "./DataSecurityAiCall";
import {
  DataTypeDraftAnswer,
  DRAFT_DATA_TYPE_SYSTEM_PROMPT,
  DRAFT_PROBLEM_WORDS,
  readDataTypeDraftAnswer,
} from "./DataTypeDraftPrompt";

/*
 * ONEUPTIME AI LEARNS THE COMPANY'S OWN DATA TYPES (#10371).
 *
 * A project's content scans keep the fields no detector could place, store
 * by store, by their names and the shapes of their values
 * (DataStore.fieldSuggestionState). A little after a scan that kept some,
 * once for every store (queueDataTypeDiscovery), this:
 *
 *   1. decides the drafts being proven whose stores were all scanned, or
 *      whose proving time is over (DataTypeProving) - counts, no AI;
 *   2. groups the project's unplaced fields across its stores
 *      (DataTypeCandidates): the same shape under the same kind of name in
 *      at least three fields of two stores. A field OneUptime AI already
 *      named a known type for is placed, and left out;
 *   3. leaves out a group already drafted, proposed, added or turned down
 *      ("Not a data type"), by its key or most of its fields - and one
 *      dropped in the last DROPPED_DATA_TYPE_COOLDOWN_DAYS;
 *   4. asks OneUptime AI to draft each new group into a data type - at
 *      most MAX_DRAFTS_PER_RUN a run - from its fields' names and shapes,
 *      never a value (buildDraftDataTypePrompt), and holds the draft to
 *      what a saved type is held to (checkDataTypeDraft), once more told
 *      why when it is not;
 *   5. proves each draft on its stores' next scans: a proposal being
 *      proven, which no one is asked about until its numbers say it is
 *      worth asking (DataTypeProving). A group OneUptime AI says is no data
 *      type of the company's own, or that it cannot draft, is kept as
 *      dropped, so it is not asked about again for the cooldown.
 *
 * Bounded as work no person started: Enable AI, the project's credits and
 * its daily limits stop it as they stop every AI call, its calls count
 * toward the autonomous budget, one call per group (two when the first
 * draft's pattern cannot be used), no retries. Read and written as
 * OneUptime, the project scoped explicitly. Never throws.
 */

// The most groups drafted in one run: the ones with the most fields first.
export const MAX_DRAFTS_PER_RUN: number = 3;

// The most stores a run reads the unplaced fields of: the latest scanned first.
export const MAX_DISCOVERY_STORES: number = 500;

// The most drafts of the project a run reads, to leave out what was drafted.
const MAX_DRAFTS_READ: number = 1_000;

// How long a call may take, and the most its answer may be.
export const DATA_TYPE_DRAFT_TIMEOUT_IN_MS: number = 90 * 1000;
export const DATA_TYPE_DRAFT_MAX_COMPLETION_TOKENS: number = 1_500;

// How many times a group is asked about: once, and once more told why.
export const DATA_TYPE_DRAFT_ATTEMPTS: number = 2;

export enum DataTypeDiscoverySkip {
  AiOff = "ai-off",
  NothingToGroup = "nothing-to-group",
}

export interface DataTypeDiscoveryOutcome {
  // Drafts whose proof was decided: proposed or dropped.
  decided: number;
  candidates: number;
  // Drafts now being proven.
  drafted: number;
  // Groups OneUptime AI drafted no usable data type for.
  dropped: number;
  skipped?: DataTypeDiscoverySkip | undefined;
}

// A draft of the project already made: its group, and where it stands.
interface DraftedGroup {
  planKey: string;
  status: DataSecurityAiProposalStatus | undefined;
  expiredAt: Date | undefined;
  fields: Set<string>;
}

// A field as the drafts already made name it: its store and its location.
function fieldRef(dataStoreId: string, location: string): string {
  return `${dataStoreId.toLowerCase()}\n${location}`;
}

// What a group's fields are called, as field names: policy_no is "policy no".
export function getGroupNameHints(
  fields: ReadonlyArray<{ field: UnplacedField }>,
): Array<string> {
  const hints: Array<string> = [];

  for (const entry of fields) {
    const hint: string = splitFieldName(fieldOwnName(entry.field.location))
      .join(" ")
      .trim();

    if (hint && !hints.includes(hint)) {
      hints.push(hint);
    }
  }

  return hints;
}

// The draft, with its group's own field names among its field names.
export function withGroupNameHints(
  draft: DataTypeDraft,
  candidate: DataTypeCandidate,
): DataTypeDraft {
  const nameHints: Array<string> = [...draft.nameHints];

  for (const hint of getGroupNameHints(candidate.fields)) {
    if (nameHints.length >= MAX_DRAFT_WORDS) {
      break;
    }

    if (!nameHints.includes(hint)) {
      nameHints.push(hint);
    }
  }

  return { ...draft, nameHints };
}

function toGroupField(entry: DataTypeCandidateField): DataTypeGroupField {
  const field: DataTypeGroupField = {
    dataStoreId: entry.dataStoreId,
    storeName: entry.storeName,
    storeKind: entry.storeKind,
    location: entry.field.location,
    locationKind: entry.field.locationKind,
    shapes: entry.field.shapes,
    valueCount: entry.field.valueCount,
  };

  if (entry.serviceId) {
    field.serviceId = entry.serviceId;
  }

  return field;
}

// A group, as its draft's plan keeps it - with the draft, or with none.
export function toDataTypePlan(data: {
  candidate: DataTypeCandidate;
  draft: DataTypeDraft;
  reason: string;
  now: Date;
  provingHours: number;
}): DataTypeProposalPlan {
  const draft: DataTypeDraft = withGroupNameHints(data.draft, data.candidate);

  return {
    groupKey: data.candidate.key,
    skeleton: data.candidate.skeleton,
    words: data.candidate.words,
    fields: data.candidate.fields.slice(0, MAX_PLAN_FIELDS).map(toGroupField),
    fieldCount: data.candidate.fields.length,
    storeCount: data.candidate.stores,
    shapes: data.candidate.shapes,
    draft,
    narrowed: narrowDataTypeDraft(draft, data.candidate.words),
    reason: data.reason,
    provingSince: data.now.toISOString(),
    provingUntil: OneUptimeDate.addRemoveHours(
      data.now,
      data.provingHours,
    ).toISOString(),
  };
}

/*
 * Whether a group was drafted before and should not be again: by its key -
 * unless only dropped, longer ago than the cooldown - or by most of its
 * fields, under any key: a group that gained a field and changed its word
 * is the same group to the person who turned it down.
 */
export function isGroupTaken(data: {
  candidate: DataTypeCandidate;
  drafted: ReadonlyArray<DraftedGroup>;
  now: Date;
}): boolean {
  const cooldownStart: number =
    data.now.getTime() - DROPPED_DATA_TYPE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
  const refs: Array<string> = data.candidate.fields.map(
    (entry: DataTypeCandidateField): string => {
      return fieldRef(entry.dataStoreId, entry.field.location);
    },
  );

  return data.drafted.some((group: DraftedGroup): boolean => {
    const isDroppedLongAgo: boolean =
      group.status === DataSecurityAiProposalStatus.Expired &&
      (!group.expiredAt || group.expiredAt.getTime() < cooldownStart);

    if (isDroppedLongAgo) {
      return false;
    }

    if (group.planKey === data.candidate.key) {
      return true;
    }

    const shared: number = refs.filter((ref: string): boolean => {
      return group.fields.has(ref);
    }).length;

    return shared * 2 >= refs.length && shared > 0;
  });
}

function readDraftedFields(plan: unknown): Set<string> {
  const fields: Set<string> = new Set();
  const raw: unknown =
    plan && typeof plan === "object" ? (plan as JSONObject)["fields"] : null;

  for (const item of Array.isArray(raw) ? raw : []) {
    const entry: JSONObject = (item || {}) as JSONObject;

    if (
      typeof entry["dataStoreId"] === "string" &&
      typeof entry["location"] === "string"
    ) {
      fields.add(fieldRef(entry["dataStoreId"], entry["location"]));
    }
  }

  return fields;
}

export default class DataTypeDiscovery {
  @CaptureSpan()
  public static async runForProject(data: {
    projectId: ObjectID;
    now?: Date | undefined;
  }): Promise<DataTypeDiscoveryOutcome> {
    const now: Date = data.now || OneUptimeDate.getCurrentDate();
    const outcome: DataTypeDiscoveryOutcome = {
      decided: 0,
      candidates: 0,
      drafted: 0,
      dropped: 0,
    };

    try {
      // Counts decide, whether AI is on or not: no model is asked.
      outcome.decided = await DataTypeProving.finishProofs({
        projectId: data.projectId,
        now,
      });

      // Enable AI off is a setting, not an error: nothing is drafted.
      if (!(await AIService.isProjectAIEnabled(data.projectId))) {
        return { ...outcome, skipped: DataTypeDiscoverySkip.AiOff };
      }

      const candidates: Array<DataTypeCandidate> = findDataTypeCandidates(
        await this.readUnplacedFields(data.projectId, now),
      );

      outcome.candidates = candidates.length;

      if (candidates.length === 0) {
        return { ...outcome, skipped: DataTypeDiscoverySkip.NothingToGroup };
      }

      const drafted: Array<DraftedGroup> = await this.readDrafted(
        data.projectId,
      );
      const fresh: Array<DataTypeCandidate> = candidates
        .filter((candidate: DataTypeCandidate): boolean => {
          return !isGroupTaken({ candidate, drafted, now });
        })
        .slice(0, MAX_DRAFTS_PER_RUN);

      if (fresh.length === 0) {
        return outcome;
      }

      const knownDataTypes: Array<string> = await this.readKnownDataTypes(
        data.projectId,
      );
      const provingHours: number = await this.getProvingHours(data.projectId);

      for (const candidate of fresh) {
        const answer: DataTypeDraftAnswer | null = await this.draft({
          projectId: data.projectId,
          candidate,
          knownDataTypes,
        });

        // No answer - AI refused, the budget is spent: asked again next run.
        if (!answer) {
          continue;
        }

        if (answer.kind === "draft") {
          const id: ObjectID | null = await DataTypeProving.startProving({
            projectId: data.projectId,
            plan: toDataTypePlan({
              candidate,
              draft: answer.draft,
              reason: answer.reason,
              now,
              provingHours,
            }),
          });

          if (id) {
            outcome.drafted++;
          }

          continue;
        }

        await this.recordDropped({
          projectId: data.projectId,
          candidate,
          reason:
            answer.kind === "none"
              ? DataTypeDropReason.NotADataType
              : DataTypeDropReason.DraftUnusable,
          aiReason: answer.reason,
          now,
        });
        outcome.dropped++;
      }
    } catch (error) {
      logger.error(
        `DataSecurity: could not look for the data types of project ${data.projectId.toString()}:`,
      );
      logger.error(error);
    }

    return outcome;
  }

  /*
   * The fields the project's latest scans could not place, store by store:
   * less those OneUptime AI already named a type for.
   */
  private static async readUnplacedFields(
    projectId: ObjectID,
    now: Date,
  ): Promise<Array<CandidateInputField>> {
    const stores: Array<DataStore> = await DataStoreService.findBy({
      query: {
        projectId,
        isArchived: false,
        fieldSuggestionState: QueryHelper.notNull(),
      },
      select: {
        _id: true,
        name: true,
        kind: true,
        serviceId: true,
        fieldSuggestionState: true,
      },
      sort: { contentScannedAt: SortOrder.Descending },
      skip: 0,
      limit: MAX_DISCOVERY_STORES,
      props: { isRoot: true },
    });
    const fields: Array<CandidateInputField> = [];

    for (const store of stores) {
      if (!store.id) {
        continue;
      }

      const state: FieldSuggestionState = readFieldSuggestionState(
        store.fieldSuggestionState,
      );
      const answers: Record<string, FieldAnswer> = keepStandingAnswers(
        state.answers,
        now,
      );

      for (const field of state.pending) {
        // Placed by OneUptime AI's suggestion: one of the types it knows.
        if (answers[getFieldAnswerKey(field)]?.dataTypeId) {
          continue;
        }

        const entry: CandidateInputField = {
          dataStoreId: store.id.toString(),
          storeName: store.name || "",
          storeKind: store.kind || "",
          field,
        };

        if (store.serviceId) {
          entry.serviceId = store.serviceId.toString();
        }

        fields.push(entry);
      }
    }

    return fields;
  }

  // The data type drafts the project has: being proven, offered, decided or dropped.
  private static async readDrafted(
    projectId: ObjectID,
  ): Promise<Array<DraftedGroup>> {
    const rows: Array<DataSecurityAiProposal> =
      await DataSecurityAiProposalService.findBy({
        query: { projectId, kind: DataSecurityAiProposalKind.AddDataType },
        select: {
          _id: true,
          planKey: true,
          status: true,
          expiredAt: true,
          plan: true,
        },
        sort: { createdAt: SortOrder.Descending },
        skip: 0,
        limit: MAX_DRAFTS_READ,
        props: { isRoot: true },
      });

    return rows.map((row: DataSecurityAiProposal): DraftedGroup => {
      return {
        planKey: row.planKey || "",
        status: row.status,
        expiredAt: row.expiredAt || undefined,
        fields: readDraftedFields(row.plan),
      };
    });
  }

  // The data types the project scans for, by name: built-in and its own.
  private static async readKnownDataTypes(
    projectId: ObjectID,
  ): Promise<Array<string>> {
    const names: Array<string> = DATA_TYPE_CATALOG.map(
      (info: DataTypeInfo): string => {
        return info.name;
      },
    );

    try {
      const setup: Awaited<ReturnType<typeof DataSecurityRunner.getScanSetup>> =
        await DataSecurityRunner.getScanSetup(projectId);

      for (const summary of setup.customTypes.values()) {
        names.push(summary.name);
      }
    } catch (error) {
      logger.warn(
        `DataSecurity: could not read project ${projectId.toString()}'s own data types; drafting without them:`,
      );
      logger.warn(error);
    }

    return names;
  }

  /*
   * How long a draft is proven: PROVING_HOURS - or, in a project that scans
   * content less often than that, one scan interval and an hour, so each
   * store is scanned once while it is.
   */
  private static async getProvingHours(projectId: ObjectID): Promise<number> {
    const setting: DataSecuritySetting =
      await DataSecuritySettingService.getOrCreateForProject(projectId);

    return Math.max(
      PROVING_HOURS,
      (setting.contentScanIntervalInHours || 24) + 1,
    );
  }

  /*
   * OneUptime AI's draft of a group, held to what a saved type is: once,
   * and once more told why the first could not be used. Null when it did
   * not answer.
   */
  private static async draft(data: {
    projectId: ObjectID;
    candidate: DataTypeCandidate;
    knownDataTypes: Array<string>;
  }): Promise<DataTypeDraftAnswer | null> {
    let retry: AiDataTypeDraftRetry | undefined = undefined;
    let last: DataTypeDraftAnswer | null = null;

    for (
      let attempt: number = 1;
      attempt <= DATA_TYPE_DRAFT_ATTEMPTS;
      attempt++
    ) {
      let response: AILogResponse;

      try {
        /*
         * Through the one Data Security call: nothing of the prompt - the
         * stores' field names - nor of the answer in the AI Logs, filed
         * under AI_DATA_SECURITY_DATA_TYPE_DRAFT_FEATURE, which the
         * autonomous budget counts, on the project's own model.
         */
        response = await DataSecurityAiCall.ask({
          projectId: data.projectId,
          prompt: buildDraftDataTypePrompt({
            instructions: DRAFT_DATA_TYPE_SYSTEM_PROMPT,
            fields: data.candidate.fields.map(
              (entry: DataTypeCandidateField) => {
                return { storeKind: entry.storeKind, field: entry.field };
              },
            ),
            storeCount: data.candidate.stores,
            knownDataTypes: data.knownDataTypes,
            retry,
          }),
          temperature: 0,
          maxTokens: DATA_TYPE_DRAFT_MAX_COMPLETION_TOKENS,
          requestTimeoutInMs: DATA_TYPE_DRAFT_TIMEOUT_IN_MS,
          requestRetries: 0,
          protectRequestParameters: true,
        });
      } catch (error) {
        // Enable AI, an LLM provider, credits, a daily limit: the project's settings, not a fault.
        logger.info(
          `DataSecurity: OneUptime AI drafted no data type for project ${data.projectId.toString()}: ${error instanceof Error ? error.message : String(error)}`,
        );
        return null;
      }

      const answer: DataTypeDraftAnswer | null = readDataTypeDraftAnswer(
        response.content,
      );

      if (!answer) {
        logger.warn(
          `DataSecurity: OneUptime AI's data type draft for project ${data.projectId.toString()} was not the JSON asked for.`,
        );
        return last;
      }

      if (answer.kind !== "draft") {
        return answer;
      }

      const problem: DataTypeDraftProblem | null = checkDataTypeDraft(
        answer.draft,
        data.candidate.shapes,
      );

      if (!problem) {
        return answer;
      }

      last = { kind: "unusable", reason: answer.reason };
      retry = {
        pattern: answer.draft.pattern,
        problem: DRAFT_PROBLEM_WORDS[problem],
      };
    }

    return last;
  }

  /*
   * A group OneUptime AI drafted no usable data type for, kept as dropped:
   * it is not asked about again for DROPPED_DATA_TYPE_COOLDOWN_DAYS. No
   * one is asked about it.
   */
  private static async recordDropped(data: {
    projectId: ObjectID;
    candidate: DataTypeCandidate;
    reason: DataTypeDropReason;
    aiReason: string;
    now: Date;
  }): Promise<void> {
    const proposal: DataSecurityAiProposal = new DataSecurityAiProposal();
    const plan: JSONObject = {
      groupKey: data.candidate.key,
      skeleton: data.candidate.skeleton,
      words: data.candidate.words,
      fields: data.candidate.fields
        .slice(0, MAX_PLAN_FIELDS)
        .map(toGroupField) as unknown as Array<JSONObject>,
      fieldCount: data.candidate.fields.length,
      storeCount: data.candidate.stores,
      shapes: data.candidate.shapes as unknown as Array<JSONObject>,
      reason: data.aiReason,
    };

    proposal.projectId = data.projectId;
    proposal.kind = DataSecurityAiProposalKind.AddDataType;
    proposal.work =
      DATA_SECURITY_AI_PROPOSAL_KINDS[
        DataSecurityAiProposalKind.AddDataType
      ].work;
    proposal.safety =
      DATA_SECURITY_AI_PROPOSAL_KINDS[
        DataSecurityAiProposalKind.AddDataType
      ].safety;
    proposal.status = DataSecurityAiProposalStatus.Expired;
    proposal.expiredAt = data.now;
    proposal.title =
      `No data type drafted for ${data.candidate.fields.length} fields of ${data.candidate.stores} stores`.slice(
        0,
        500,
      );
    proposal.plan = plan;
    proposal.planKey = data.candidate.key.slice(0, 100);
    proposal.planFingerprint = getDataSecurityAiPlanFingerprint({
      kind: DataSecurityAiProposalKind.AddDataType,
      plan,
    });
    proposal.riskScore = 0;
    proposal.autonomy = DataSecurityAiAutonomy.Suggest;
    proposal.result = { dropReason: data.reason };

    await DataSecurityAiProposalService.create({
      data: proposal,
      props: { isRoot: true },
    });
  }
}
