import DataStore from "../../../../Models/DatabaseModels/DataStore";
import { DataStoreFeedEventType } from "../../../../Models/DatabaseModels/DataStoreFeed";
import { sha256Hex } from "../../../../Types/AutoRemediation/RemediationPlanFingerprint";
import { Purple500 } from "../../../../Types/BrandColors";
import OneUptimeDate from "../../../../Types/Date";
import { isPersonalDataCategory } from "../../../../Types/DataSecurity/DataCategory";
import { toStableJsonText } from "../../../../Types/DataSecurity/DataSecurityAi";
import { DataSecurityAiFeature } from "../../../../Types/DataSecurity/DataSecurityAiFeatures";
import { isDeclaredDataStoreKind } from "../../../../Types/DataSecurity/DataStoreKind";
import DataTypeNamer from "../../../../Types/DataSecurity/DataTypeNamer";
import {
  getRecordFieldDraftAction,
  getRecordFieldStatus,
  readRecordFieldValue,
  readStoreRecordDrafts,
  RECORD_FIELDS,
  RecordDraftSkip,
  RecordField,
  RecordFieldDraft,
  RecordFieldDraftAction,
  RecordFieldState,
  RecordFieldStatus,
  StoreRecordDrafts,
  STORE_RECORD_DRAFTS_VERSION,
  toStoreRecordDraftsJson,
} from "../../../../Types/DataSecurity/RecordOfProcessing";
import ObjectID from "../../../../Types/ObjectID";
import { mdText } from "../../../../Utils/Markdown/FeedMarkdown";
import AIService, { AILogResponse } from "../../../Services/AIService";
import DataStoreFeedService from "../../../Services/DataStoreFeedService";
import DataStoreService from "../../../Services/DataStoreService";
import ProjectDataTypeNames from "../../DataSecurity/ProjectDataTypeNames";
import { getTelemetryRetentionSignal } from "../../DataSecurity/StoreTelemetryRetention";
import logger from "../../Logger";
import ProjectLanguage from "../../Notification/ProjectLanguage";
import UserLanguage from "../../Notification/UserLanguage";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import AIInvestigationEngine from "../SRE/AIInvestigationEngine";
import DataSecurityAiCall from "./DataSecurityAiCall";
import DataSecurityAiInput, {
  AiComplianceFacts,
  AiRecordDossier,
} from "./DataSecurityAiInput";
import RecordOfProcessingDossier from "./RecordOfProcessingDossier";
import {
  buildRecordDraftPrompt,
  holdRecordDraftToFacts,
  readRecordDraftAnswer,
  RECORD_DRAFT_MAX_TOKENS,
  RECORD_DRAFT_TEMPERATURE,
  RecordDraftAnswer,
} from "./RecordOfProcessingPrompt";

/*
 * ONEUPTIME AI DRAFTS A STORE'S RECORD OF PROCESSING (#10375): ITS
 * PURPOSE, RETENTION, LEGAL BASIS AND THE PEOPLE IT IS ABOUT.
 *
 * Drafted two ways, the same way:
 *
 *   - on its own, for every store with personal data the project's Data
 *     Security AI rules let it judge, in the daily run
 *     (RecordOfProcessingDraftRun, the DraftRecord feature), which never
 *     throws;
 *   - when a person asks, on Review Drafts (DraftRecordOnRequest), which
 *     says in words what stopped it.
 *
 * Each reads what OneUptime knows of the store (RecordOfProcessingDossier),
 * makes its facts (DataSecurityAiInput.recordFacts) and decides, field by
 * field, what it may do (getRecordFieldDraftAction): never anything with a
 * person's words or with what plain code fills in; draft a field nobody
 * answered, or whose draft's facts changed; and beside a confirmed field
 * whose facts changed, propose a change, never apply it. Nothing to do,
 * no model call.
 *
 * What it sends is the builder's - names, counts and configuration, never a
 * value, a sample or a record - asked through the one Data Security call
 * (DataSecurityAiCall), which keeps nothing of it in the AI Logs. The
 * answer is read strictly and held to its facts (holdRecordDraftToFacts)
 * before it is kept.
 *
 * It writes the drafts alone (DataStore.recordDrafts), never the store's
 * record: only a person's press puts a draft there. The store's timeline
 * says what was drafted, once per draft written, never per view.
 */

// Bumped when what the drafts are asked changes, so every store is drafted again once.
export const RECORD_DRAFT_VERSION: number = 1;

export { RecordDraftSkip };

export type RecordDraftOutcome =
  | {
      drafted: true;
      // The fields drafted, and those a change was proposed for.
      draftedFields: Array<RecordField>;
      proposedFields: Array<RecordField>;
    }
  | { drafted: false; reason: RecordDraftSkip };

// The store's record columns and drafts, as the drafter reads them.
const RECORD_SELECT: {
  _id: true;
  kind: true;
  dataCategories: true;
  purpose: true;
  retention: true;
  legalBasis: true;
  dataSubjects: true;
  recordDrafts: true;
} = {
  _id: true,
  kind: true,
  dataCategories: true,
  purpose: true,
  retention: true,
  legalBasis: true,
  dataSubjects: true,
  recordDrafts: true,
};

// A store's record column, by its field.
export function getRecordColumnValue(
  store: DataStore,
  field: RecordField,
): unknown {
  switch (field) {
    case RecordField.Purpose:
      return store.purpose;
    case RecordField.Retention:
      return store.retention;
    case RecordField.LegalBasis:
      return store.legalBasis;
    case RecordField.People:
      return store.dataSubjects;
    default:
      return undefined;
  }
}

/*
 * Where each field of a store's record stands. A telemetry store's
 * retention is filled in by OneUptime when nobody wrote one.
 */
export function getStoreRecordStatuses(
  store: DataStore,
  drafts: StoreRecordDrafts,
): Record<RecordField, RecordFieldStatus> {
  const isTelemetry: boolean = getTelemetryRetentionSignal(store.kind) !== null;
  const statuses: Partial<Record<RecordField, RecordFieldStatus>> = {};

  for (const field of RECORD_FIELDS) {
    statuses[field] = getRecordFieldStatus({
      value: readRecordFieldValue(field, getRecordColumnValue(store, field)),
      state: drafts.fields[field],
      isFilledIn: field === RecordField.Retention && isTelemetry,
    });
  }

  return statuses as Record<RecordField, RecordFieldStatus>;
}

// Whether a store is in the record of processing at all, and drafted by OneUptime AI.
export function isStoreDraftedForRecord(store: DataStore): boolean {
  return (
    !isDeclaredDataStoreKind(store.kind) &&
    (store.dataCategories || []).some(isPersonalDataCategory)
  );
}

/*
 * What a store's drafts are written from, in sixty-four hex digits: the
 * facts as OneUptime AI reads them, the language and the version of what
 * it is asked.
 */
export function getRecordDraftInputHash(data: {
  built: AiComplianceFacts;
  language: string;
}): string {
  return sha256Hex(
    toStableJsonText({
      version: RECORD_DRAFT_VERSION,
      language: data.language,
      data: data.built.data,
    }),
  );
}

export default class RecordOfProcessingDrafter {
  /*
   * Draft what may be drafted of one store's record. On its own (no
   * userId) it never throws: what stopped it is the outcome's reason. A
   * person's request throws in words a person reads; `force` (Draft Again)
   * drafts again what no person confirmed, whatever changed.
   */
  @CaptureSpan()
  public static async draftStore(data: {
    projectId: ObjectID;
    dataStoreId: ObjectID;
    feature:
      | DataSecurityAiFeature.DraftRecord
      | DataSecurityAiFeature.DraftRecordOnRequest;
    userId?: ObjectID | undefined;
    force?: boolean | undefined;
    // The Data Security AI rule's pick, when one picks a provider.
    llmProviderId?: ObjectID | string | undefined;
    dataTypeNamer?: DataTypeNamer | undefined;
    now?: Date | undefined;
  }): Promise<RecordDraftOutcome> {
    const byPerson: boolean = data.feature === DataSecurityAiFeature.DraftRecordOnRequest;

    try {
      return await this.draft({ ...data, byPerson });
    } catch (error) {
      if (byPerson) {
        throw error;
      }

      logger.error(
        `DataSecurity AI: could not draft the record of store ${data.dataStoreId.toString()} of project ${data.projectId.toString()}: ${error}`,
      );

      return { drafted: false, reason: RecordDraftSkip.Failed };
    }
  }

  private static async draft(data: {
    projectId: ObjectID;
    dataStoreId: ObjectID;
    feature:
      | DataSecurityAiFeature.DraftRecord
      | DataSecurityAiFeature.DraftRecordOnRequest;
    userId?: ObjectID | undefined;
    force?: boolean | undefined;
    llmProviderId?: ObjectID | string | undefined;
    dataTypeNamer?: DataTypeNamer | undefined;
    now?: Date | undefined;
    byPerson: boolean;
  }): Promise<RecordDraftOutcome> {
    const now: Date = data.now || OneUptimeDate.getCurrentDate();

    if (data.byPerson) {
      await AIService.assertProjectAIEnabled(data.projectId);
    }

    const store: DataStore = await RecordOfProcessingDossier.readStore({
      projectId: data.projectId,
      dataStoreId: data.dataStoreId,
    });

    if (isDeclaredDataStoreKind(store.kind)) {
      return { drafted: false, reason: RecordDraftSkip.Declared };
    }

    if (!isStoreDraftedForRecord(store)) {
      return { drafted: false, reason: RecordDraftSkip.NotPersonalData };
    }

    const current: DataStore = await this.readRecord(data);
    const drafts: StoreRecordDrafts = readStoreRecordDrafts(
      current.recordDrafts,
    );
    const language: string = data.userId
      ? await UserLanguage.getLanguage(data.userId)
      : await ProjectLanguage.getLanguage(data.projectId);
    const dossier: AiRecordDossier = await RecordOfProcessingDossier.read({
      projectId: data.projectId,
      store,
    });
    const built: AiComplianceFacts = DataSecurityAiInput.recordFacts({
      dossier,
      dataTypeNamer:
        data.dataTypeNamer ||
        (await ProjectDataTypeNames.read({ projectId: data.projectId })),
    });
    const inputHash: string = getRecordDraftInputHash({ built, language });
    const statuses: Record<RecordField, RecordFieldStatus> =
      getStoreRecordStatuses(current, drafts);
    const actions: Map<RecordField, RecordFieldDraftAction> = new Map();

    for (const field of RECORD_FIELDS) {
      const action: RecordFieldDraftAction = getRecordFieldDraftAction({
        status: statuses[field],
        state: drafts.fields[field],
        facts: built.facts,
        previousInputHash: drafts.inputHash,
        inputHash,
        force: data.force,
      });

      if (action !== RecordFieldDraftAction.Leave) {
        actions.set(field, action);
      }
    }

    if (actions.size === 0) {
      return { drafted: false, reason: RecordDraftSkip.NothingToDraft };
    }

    if (!data.byPerson) {
      const blocked: RecordDraftSkip | null = await this.getBlocker({
        projectId: data.projectId,
        llmProviderId: data.llmProviderId,
      });

      if (blocked) {
        return { drafted: false, reason: blocked };
      }
    }

    const fields: Array<RecordField> = [...actions.keys()];
    const response: AILogResponse = await DataSecurityAiCall.ask({
      projectId: data.projectId,
      userId: data.userId,
      prompt: buildRecordDraftPrompt({
        feature: data.feature,
        built,
        fields,
        language,
      }),
      maxTokens: RECORD_DRAFT_MAX_TOKENS,
      temperature: RECORD_DRAFT_TEMPERATURE,
      // No person started it: the call's own messages and bounds hold.
      protectRequestParameters: !data.byPerson,
      rulePickedProviderId: data.llmProviderId,
    });
    const answer: RecordDraftAnswer | null = readRecordDraftAnswer(
      response.content,
    );
    const held: Partial<Record<RecordField, RecordFieldDraft>> = answer
      ? holdRecordDraftToFacts({
          answer,
          fields,
          facts: built.facts,
          language,
          now,
        })
      : {};

    /*
     * Written over the record as it is now: a person may have confirmed or
     * written a field while OneUptime AI drafted, and what they did stands.
     * Each field changes only where it still stands as it was decided on.
     */
    const fresh: DataStore = await this.readRecord(data);
    const freshDrafts: StoreRecordDrafts = readStoreRecordDrafts(
      fresh.recordDrafts,
    );
    const freshStatuses: Record<RecordField, RecordFieldStatus> =
      getStoreRecordStatuses(fresh, freshDrafts);
    const next: StoreRecordDrafts = {
      version: STORE_RECORD_DRAFTS_VERSION,
      facts: built.facts,
      fields: { ...freshDrafts.fields },
      inputHash,
      draftedAt: now.toISOString(),
    };
    const draftedFields: Array<RecordField> = [];
    const proposedFields: Array<RecordField> = [];

    for (const [field, action] of actions) {
      if (freshStatuses[field] !== statuses[field]) {
        continue;
      }

      const state: RecordFieldState = { ...(next.fields[field] || {}) };
      const draft: RecordFieldDraft | undefined = held[field];

      if (action === RecordFieldDraftAction.Draft) {
        // A draft the facts no longer support goes: the field is empty, not stale.
        state.draft = draft;

        if (draft) {
          draftedFields.push(field);
        }
      } else if (draft) {
        state.proposed = draft;
        proposedFields.push(field);
      }

      if (state.draft || state.confirmed || state.proposed) {
        next.fields[field] = state;
      } else {
        delete next.fields[field];
      }
    }

    await DataStoreService.updateColumnsByIdWithoutHooks({
      id: data.dataStoreId,
      data: { recordDrafts: toStoreRecordDraftsJson(next) } as never,
    });

    if (draftedFields.length === 0 && proposedFields.length === 0) {
      return { drafted: false, reason: RecordDraftSkip.NothingHeld };
    }

    await this.writeTimeline({
      projectId: data.projectId,
      dataStoreId: data.dataStoreId,
      draftedFields,
      proposedFields,
      userId: data.userId,
    });

    return { drafted: true, draftedFields, proposedFields };
  }

  private static async readRecord(data: {
    projectId: ObjectID;
    dataStoreId: ObjectID;
  }): Promise<DataStore> {
    const store: DataStore | null = await DataStoreService.findOneBy({
      query: { _id: data.dataStoreId, projectId: data.projectId },
      select: RECORD_SELECT,
      props: { isRoot: true },
    });

    if (!store) {
      throw new Error("The data store is gone.");
    }

    return store;
  }

  // Why a draft on its own cannot be asked now, or null when it can.
  private static async getBlocker(data: {
    projectId: ObjectID;
    llmProviderId?: ObjectID | string | undefined;
  }): Promise<RecordDraftSkip | null> {
    const pick: ObjectID | undefined =
      typeof data.llmProviderId === "string" &&
      ObjectID.isValidUUID(data.llmProviderId)
        ? new ObjectID(data.llmProviderId)
        : data.llmProviderId instanceof ObjectID
          ? data.llmProviderId
          : undefined;
    const blocker: "provider_missing" | "insufficient_ai_balance" | null =
      await AIInvestigationEngine.getProviderOrBalanceReason(
        data.projectId,
        pick,
      );

    if (blocker === "provider_missing") {
      return RecordDraftSkip.NoLlmProvider;
    }

    if (blocker === "insufficient_ai_balance") {
      return RecordDraftSkip.NoAiCredits;
    }

    return (await AIService.getReachedProjectDailyLimit({
      projectId: data.projectId,
    }))
      ? RecordDraftSkip.AiDailyLimitReached
      : null;
  }

  // The store's timeline: what OneUptime AI drafted, for a person to review.
  private static async writeTimeline(data: {
    projectId: ObjectID;
    dataStoreId: ObjectID;
    draftedFields: Array<RecordField>;
    proposedFields: Array<RecordField>;
    userId?: ObjectID | undefined;
  }): Promise<void> {
    const titles: Readonly<Record<RecordField, string>> = {
      [RecordField.Purpose]: "Purpose",
      [RecordField.Retention]: "Retention",
      [RecordField.LegalBasis]: "Legal Basis",
      [RecordField.People]: "People It Is About",
    };
    const named: (fields: Array<RecordField>) => string = (
      fields: Array<RecordField>,
    ): string => {
      return fields
        .map((field: RecordField): string => {
          return titles[field];
        })
        .join(", ");
    };
    const lines: Array<string> = [];

    if (data.draftedFields.length > 0) {
      lines.push(
        mdText`OneUptime AI drafted this store's record of processing for you to review: **${named(data.draftedFields)}**.`.toString(),
      );
    }

    if (data.proposedFields.length > 0) {
      lines.push(
        mdText`A fact the confirmed record rests on changed, so OneUptime AI proposes a change, for you to take or leave: **${named(data.proposedFields)}**.`.toString(),
      );
    }

    try {
      await DataStoreFeedService.createDataStoreFeedItem({
        projectId: data.projectId,
        dataStoreId: data.dataStoreId,
        dataStoreFeedEventType: DataStoreFeedEventType.AiProposed,
        displayColor: Purple500,
        feedInfoInMarkdown: lines.join("\n\n"),
        userId: data.userId,
      });
    } catch (error) {
      logger.error(
        `DataSecurity AI: could not write the timeline of store ${data.dataStoreId.toString()}: ${error}`,
      );
    }
  }
}
