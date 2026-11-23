import AutoRemediationRule from "../../../../Models/DatabaseModels/AutoRemediationRule";
import DataStore from "../../../../Models/DatabaseModels/DataStore";
import Project from "../../../../Models/DatabaseModels/Project";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../../Types/Date";
import {
  DataSecurityAiAutonomy,
  DataSecurityAiWorkDecision,
} from "../../../../Types/DataSecurity/DataSecurityAi";
import { DataSecurityAiFeature } from "../../../../Types/DataSecurity/DataSecurityAiFeatures";
import DataTypeNamer from "../../../../Types/DataSecurity/DataTypeNamer";
import {
  RECORD_FIELDS,
  RecordField,
  RecordFieldStatus,
  readStoreRecordDrafts,
} from "../../../../Types/DataSecurity/RecordOfProcessing";
import ObjectID from "../../../../Types/ObjectID";
import DataStoreService from "../../../Services/DataStoreService";
import ProjectService from "../../../Services/ProjectService";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import DataSecurityAiEngine from "./DataSecurityAiEngine";
import DataStoreOwnerProposalRun from "./DataStoreOwnerProposalRun";
import {
  DATA_STORE_FOR_OWNER_PLAN_SELECT,
  DataStoreForOwnerPlan,
} from "./Owners/DataStoreOwnerSelects";
import RecordOfProcessingDrafter, {
  getStoreRecordStatuses,
  isStoreDraftedForRecord,
  RecordDraftOutcome,
  RecordDraftSkip,
} from "./RecordOfProcessingDrafter";

/*
 * WHEN ONEUPTIME AI DRAFTS THE RECORD OF PROCESSING ON ITS OWN (#10375):
 * once a day, for the stores that hold personal data - under the project's
 * Data Security AI rules, as all its work is (#10364).
 *
 *  1. The project's two switches: Enable AI, and "Work on new Data
 *     Security issues". Off, nothing runs and nothing is written; Review
 *     Drafts still drafts a store when a person asks.
 *  2. Each store with personal data - not one OneUptime declares, whose
 *     record it fills in itself (#10398) - is matched against the AI rules
 *     as a store with no issue, as the owners are (a rule that names a
 *     check or a severity matches none): drafting a record is Judge work,
 *     a judgement OneUptime records for a person to confirm. Off for the
 *     store, it is left as it is. Suggest and Without asking draft alike:
 *     a draft is never confirmed on its own, whatever a rule says.
 *  3. The riskiest stores first, and at most RECORD_DRAFT_STORES_PER_RUN a
 *     day. A store whose every field a person wrote, or OneUptime fills
 *     in, is not read at all; one whose drafts' facts did not change asks
 *     OneUptime AI nothing (RecordOfProcessingDrafter).
 *  4. A missing LLM provider, AI credits used up or the day's AI limit
 *     reached stops the run: the next day's picks up where it stopped.
 *
 * Read and written as OneUptime (root), with the project scoped
 * explicitly. Never throws.
 */

// The most stores whose drafts one run asks OneUptime AI for.
export const RECORD_DRAFT_STORES_PER_RUN: number = 50;

// The most stores one run reads.
const MAX_STORES_READ: number = 2000;

export interface RecordDraftRunOutcome {
  skipped: "ai-off" | "rules-unreadable" | null;
  // Stores OneUptime AI was asked about, and those it drafted for.
  storesAsked: number;
  storesDrafted: number;
  // Why the run stopped before its budget, when it did.
  stoppedBecause: RecordDraftSkip | null;
}

// The reasons that stop a run: they hold for every store until something changes.
const STOPS_THE_RUN: ReadonlyArray<RecordDraftSkip> = [
  RecordDraftSkip.NoLlmProvider,
  RecordDraftSkip.NoAiCredits,
  RecordDraftSkip.AiDailyLimitReached,
];

// What the run reads of each store: what the rules match on, and its record.
const RUN_STORE_SELECT: typeof DATA_STORE_FOR_OWNER_PLAN_SELECT & {
  purpose: true;
  retention: true;
  legalBasis: true;
  dataSubjects: true;
  recordDrafts: true;
} = {
  ...DATA_STORE_FOR_OWNER_PLAN_SELECT,
  purpose: true,
  retention: true,
  legalBasis: true,
  dataSubjects: true,
  recordDrafts: true,
};

/*
 * Whether a store's record could take a draft at all: a field no person
 * wrote and OneUptime does not fill in. A store whose every field is a
 * person's has nothing for OneUptime AI, whatever its facts say.
 */
export function mayTakeADraft(store: DataStore): boolean {
  const statuses: Record<RecordField, RecordFieldStatus> =
    getStoreRecordStatuses(store, readStoreRecordDrafts(store.recordDrafts));

  return RECORD_FIELDS.some((field: RecordField): boolean => {
    return (
      statuses[field] !== RecordFieldStatus.Written &&
      statuses[field] !== RecordFieldStatus.FilledIn
    );
  });
}

export default class RecordOfProcessingDraftRun {
  @CaptureSpan()
  public static async run(data: {
    projectId: ObjectID;
    now?: Date | undefined;
  }): Promise<RecordDraftRunOutcome> {
    const outcome: RecordDraftRunOutcome = {
      skipped: null,
      storesAsked: 0,
      storesDrafted: 0,
      stoppedBecause: null,
    };

    try {
      const project: Project | null = await ProjectService.findOneById({
        id: data.projectId,
        select: {
          _id: true,
          enableAi: true,
          enableAutomaticDataSecurityAi: true,
        },
        props: { isRoot: true },
      });

      if (
        !project ||
        project.enableAi === false ||
        project.enableAutomaticDataSecurityAi !== true
      ) {
        return { ...outcome, skipped: "ai-off" };
      }

      const rules: Array<AutoRemediationRule> | null =
        await DataSecurityAiEngine.readRules(data.projectId);

      if (!rules) {
        return { ...outcome, skipped: "rules-unreadable" };
      }

      const stores: Array<DataStore> = (
        await DataStoreService.findBy({
          query: { projectId: data.projectId, isArchived: false },
          select: RUN_STORE_SELECT,
          sort: { riskScore: SortOrder.Descending },
          skip: 0,
          limit: MAX_STORES_READ,
          props: { isRoot: true },
        })
      ).filter((store: DataStore): boolean => {
        return (
          Boolean(store.id) &&
          isStoreDraftedForRecord(store) &&
          mayTakeADraft(store)
        );
      });

      if (stores.length === 0) {
        return outcome;
      }

      const dataTypes: {
        namer: DataTypeNamer;
        categoryOf: Map<string, string>;
      } = await DataSecurityAiEngine.readDataTypes(data.projectId);

      for (const store of stores) {
        if (outcome.storesAsked >= RECORD_DRAFT_STORES_PER_RUN) {
          break;
        }

        const decided: {
          judge: DataSecurityAiWorkDecision;
          llmProviderId: string;
        } | null = await DataStoreOwnerProposalRun.decideForStore({
          projectId: data.projectId,
          store: store as DataStoreForOwnerPlan,
          rules,
          categoryOf: dataTypes.categoryOf,
        });

        if (!decided || decided.judge.autonomy === DataSecurityAiAutonomy.Off) {
          continue;
        }

        const result: RecordDraftOutcome =
          await RecordOfProcessingDrafter.draftStore({
            projectId: data.projectId,
            dataStoreId: store.id!,
            feature: DataSecurityAiFeature.DraftRecord,
            llmProviderId: decided.llmProviderId || undefined,
            dataTypeNamer: dataTypes.namer,
            now: data.now || OneUptimeDate.getCurrentDate(),
          });

        if (result.drafted) {
          outcome.storesAsked++;
          outcome.storesDrafted++;
          continue;
        }

        if (STOPS_THE_RUN.includes(result.reason)) {
          outcome.stoppedBecause = result.reason;
          break;
        }

        // A model call that left nothing to keep still spent a draft of the day's.
        if (
          result.reason === RecordDraftSkip.NothingHeld ||
          result.reason === RecordDraftSkip.Failed
        ) {
          outcome.storesAsked++;
        }
      }

      return outcome;
    } catch (error) {
      logger.error(
        `DataSecurity AI: could not draft the record of processing of project ${data.projectId.toString()}: ${error}`,
      );
      return outcome;
    }
  }
}
