import DataStore from "../../../../Models/DatabaseModels/DataStore";
import DataStoreFinding from "../../../../Models/DatabaseModels/DataStoreFinding";
import Includes from "../../../../Types/BaseDatabase/Includes";
import DataConfidence from "../../../../Types/DataSecurity/DataConfidence";
import {
  DATA_TYPE_CATALOG,
  DataTypeInfo,
} from "../../../../Types/DataSecurity/DataTypeCatalog";
import OneUptimeDate from "../../../../Types/Date";
import ObjectID from "../../../../Types/ObjectID";
import { FieldClassification } from "../../../../Utils/DataSecurity/FieldClassifier";
import { UnplacedField } from "../../../../Utils/DataSecurity/UnplacedFields";
import AIService, {
  AI_DATA_SECURITY_FIELD_SUGGESTION_FEATURE,
  AILogResponse,
} from "../../../Services/AIService";
import DataStoreFindingService from "../../../Services/DataStoreFindingService";
import DataStoreService from "../../../Services/DataStoreService";
import DataSecurityFindingWriter, {
  CustomDataTypeSummary,
  MAX_FINDINGS_PER_STORE,
} from "../../DataSecurity/DataSecurityFindingWriter";
import { queueDataSecurityEvaluation } from "../../DataSecurity/DataSecurityJobs";
import DataSecurityRunner from "../../DataSecurity/DataSecurityRunner";
import {
  DataStoreLocationKind,
  LocationFindings,
} from "../../DataSecurity/DataSecurityScanTypes";
import {
  FieldAnswer,
  FieldSuggestionState,
  getFieldAnswerKey,
  keepStandingAnswers,
  readFieldSuggestionState,
  toStoredFieldSuggestionState,
} from "../../DataSecurity/FieldSuggestionState";
import logger from "../../Logger";
import {
  buildFieldSuggestionPrompt,
  FIELD_SUGGESTION_SYSTEM_PROMPT,
  FieldSuggestionAnswer,
  FieldSuggestionDataType,
  getFieldReference,
  MAX_FIELDS_PER_SUGGESTION_REQUEST,
  parseFieldSuggestionResponse,
} from "./FieldSuggestionPrompt";

/*
 * ONEUPTIME AI NAMES THE DATA TYPE OF THE FIELDS NO DETECTOR PLACED.
 *
 * A content scan keeps the fields it could not place - a column named
 * kundennr, a field called ref whose values look like AB-123456 - by their
 * names and the shapes of their values, never a value
 * (Utils/DataSecurity/UnplacedFields), and queues this when the project's
 * Enable AI is on (DataSecurityFindingWriter). This asks OneUptime AI, in
 * one constrained call, which of the data types the project scans for each
 * one holds (FieldSuggestionPrompt), and writes each type it names as a
 * finding of its own: Low confidence, no value matched, marked as OneUptime
 * AI's with its reason. It counts toward nothing - the store's
 * sensitivity, its checks, its issues - until a person confirms it on the
 * store's What's Inside; Not Sensitive turns it down.
 *
 * Bounded, as work no person started: one call per store scan at most, of
 * at most MAX_FIELDS_PER_SUGGESTION_REQUEST fields, no retries, and the
 * project's AI switch, credits and daily limits as for every AI call
 * (AIService.executeWithLogging). A field's answer stands for
 * FIELD_ANSWER_LIFETIME_IN_DAYS (FieldSuggestionState): the next scans
 * write it again from the answer, and ask nothing. A field a person
 * confirmed or turned down is not asked about again; a confirmed one is
 * written again, so it stays counted.
 *
 * A refusal - Enable AI turned off, no LLM provider, no credits, a daily
 * limit - or an answer that is not the JSON asked for is noted in the log
 * and nothing is kept: the fields are asked about after the next scan.
 */

// How long the call may take, and the most the answer may be.
export const FIELD_SUGGESTION_TIMEOUT_IN_MS: number = 90 * 1000;
export const FIELD_SUGGESTION_MAX_COMPLETION_TOKENS: number = 3000;

export enum FieldSuggestionSkip {
  StoreGone = "store-gone",
  NothingPending = "nothing-pending",
  AiOff = "ai-off",
  NoAnswer = "no-answer",
}

export interface FieldSuggestionOutcome {
  // Fields OneUptime AI answered about in this call.
  asked: number;
  // Suggestions written, new or again.
  written: number;
  // Stale suggestions taken away: the field's answer names another type now, or none.
  removed: number;
  skipped?: FieldSuggestionSkip | undefined;
}

// An AI finding a person already judged: confirmed, or turned down.
interface JudgedSuggestion {
  dataTypeId: string;
  isConfirmed: boolean;
  isSuppressed: boolean;
}

interface StoreSuggestions {
  // By location: the AI findings a person confirmed or turned down.
  judged: Map<string, JudgedSuggestion>;
  // By location: the AI findings nobody judged yet, with their data types.
  open: Map<string, Array<{ id: ObjectID; dataTypeId: string }>>;
}

// A suggestion as the finding writer takes it.
export function toSuggestedLocation(data: {
  field: UnplacedField;
  dataTypeId: string;
  reason?: string | undefined;
}): LocationFindings {
  const classification: FieldClassification = {
    dataTypeId: data.dataTypeId,
    matchCount: 0,
    testValueCount: 0,
    confidence: DataConfidence.Low,
    maskedSamples: [],
    distinctValues: 0,
    distinctValuesCapped: false,
    matchRatio: 0,
    valueCount: data.field.valueCount,
    valuesWithMatch: 0,
    isFreeText: false,
    nameHinted: false,
    foundByName: false,
    isAiSuggested: true,
    aiReason: data.reason,
  };

  return {
    location: data.field.location,
    locationKind: data.field.locationKind as DataStoreLocationKind,
    classifications: [classification],
  };
}

export default class DataSecurityFieldSuggestion {
  public static async suggestForStore(data: {
    projectId: ObjectID;
    dataStoreId: ObjectID;
  }): Promise<FieldSuggestionOutcome> {
    const outcome: FieldSuggestionOutcome = {
      asked: 0,
      written: 0,
      removed: 0,
    };
    const store: DataStore | null = await DataStoreService.findOneById({
      id: data.dataStoreId,
      select: {
        _id: true,
        projectId: true,
        kind: true,
        isArchived: true,
        fieldSuggestionState: true,
      },
      props: { isRoot: true },
    });

    if (
      !store?.projectId ||
      store.projectId.toString() !== data.projectId.toString() ||
      store.isArchived
    ) {
      return { ...outcome, skipped: FieldSuggestionSkip.StoreGone };
    }

    const state: FieldSuggestionState = readFieldSuggestionState(
      store.fieldSuggestionState,
    );

    if (state.pending.length === 0) {
      return { ...outcome, skipped: FieldSuggestionSkip.NothingPending };
    }

    // Enable AI off is a setting, not an error: nothing is asked or written.
    if (!(await AIService.isProjectAIEnabled(data.projectId))) {
      return { ...outcome, skipped: FieldSuggestionSkip.AiOff };
    }

    const now: Date = OneUptimeDate.getCurrentDate();
    const setup: {
      dataTypes: Array<FieldSuggestionDataType>;
      customTypes: Map<string, CustomDataTypeSummary>;
    } = await this.readDataTypes(data.projectId);
    const offered: Set<string> = new Set(
      setup.dataTypes.map((type: FieldSuggestionDataType): string => {
        return type.id;
      }),
    );
    const isKnownDataType: (dataTypeId: string) => boolean = (
      dataTypeId: string,
    ): boolean => {
      return offered.has(dataTypeId);
    };
    const suggestions: StoreSuggestions = await this.readSuggestions(
      data.dataStoreId,
    );
    const answers: Record<string, FieldAnswer> = keepStandingAnswers(
      state.answers,
      now,
    );

    const toAsk: Array<UnplacedField> = state.pending
      .filter((field: UnplacedField): boolean => {
        return (
          !suggestions.judged.has(field.location) &&
          !answers[getFieldAnswerKey(field)]
        );
      })
      .slice(0, MAX_FIELDS_PER_SUGGESTION_REQUEST);

    if (toAsk.length > 0) {
      const asked: Map<string, FieldSuggestionAnswer> | null = await this.ask({
        projectId: data.projectId,
        dataStoreId: data.dataStoreId,
        storeKind: store.kind || "",
        dataTypes: setup.dataTypes,
        fields: toAsk,
        isKnownDataType,
      });

      if (!asked) {
        outcome.skipped = FieldSuggestionSkip.NoAnswer;
      } else {
        outcome.asked = toAsk.length;

        toAsk.forEach((field: UnplacedField, index: number): void => {
          const answer: FieldSuggestionAnswer | undefined = asked.get(
            getFieldReference(index),
          );
          const stored: FieldAnswer = { at: now.toISOString() };

          if (answer?.dataTypeId) {
            stored.dataTypeId = answer.dataTypeId;
            stored.reason = answer.reason;
          }

          answers[getFieldAnswerKey(field)] = stored;
        });
      }
    }

    // What to write: the confirmed ones again, and every standing answer naming a type.
    const locations: Array<LocationFindings> = [];
    const stale: Array<ObjectID> = [];

    for (const field of state.pending) {
      const judged: JudgedSuggestion | undefined = suggestions.judged.get(
        field.location,
      );

      if (judged) {
        if (judged.isConfirmed && !judged.isSuppressed) {
          locations.push(
            toSuggestedLocation({ field, dataTypeId: judged.dataTypeId }),
          );
        }
        continue;
      }

      const answer: FieldAnswer | undefined = answers[getFieldAnswerKey(field)];

      if (!answer) {
        continue;
      }

      const dataTypeId: string | undefined =
        answer.dataTypeId && isKnownDataType(answer.dataTypeId)
          ? answer.dataTypeId
          : undefined;

      // Another type suggested before, or none now: that suggestion goes.
      for (const open of suggestions.open.get(field.location) || []) {
        if (open.dataTypeId !== dataTypeId) {
          stale.push(open.id);
        }
      }

      if (dataTypeId) {
        locations.push(
          toSuggestedLocation({ field, dataTypeId, reason: answer.reason }),
        );
      }
    }

    if (locations.length > 0) {
      outcome.written = await DataSecurityFindingWriter.recordFieldSuggestions({
        projectId: data.projectId,
        dataStoreId: data.dataStoreId,
        locations,
        customDataTypes: setup.customTypes,
        now,
      });
    }

    outcome.removed = await this.removeStale(stale);
    await this.saveAnswers(data.dataStoreId, answers);

    if (outcome.written > 0 || outcome.removed > 0) {
      await queueDataSecurityEvaluation(data.projectId);
    }

    return outcome;
  }

  /*
   * The data types an answer may name: the built-in catalog and the
   * project's own types, less the ones the project turned off.
   */
  private static async readDataTypes(projectId: ObjectID): Promise<{
    dataTypes: Array<FieldSuggestionDataType>;
    customTypes: Map<string, CustomDataTypeSummary>;
  }> {
    const setup: Awaited<ReturnType<typeof DataSecurityRunner.getScanSetup>> =
      await DataSecurityRunner.getScanSetup(projectId);
    const disabled: Set<string> = new Set(
      setup.setting.disabledDataTypeIds || [],
    );
    const dataTypes: Array<FieldSuggestionDataType> = [];

    for (const type of DATA_TYPE_CATALOG) {
      if (!disabled.has(type.id)) {
        dataTypes.push({ id: type.id, name: describeBuiltInType(type) });
      }
    }

    for (const [id, summary] of setup.customTypes) {
      if (!disabled.has(id)) {
        dataTypes.push({ id, name: summary.name });
      }
    }

    return { dataTypes, customTypes: setup.customTypes };
  }

  // The store's suggestions so far, by location: judged by a person, or not yet.
  private static async readSuggestions(
    dataStoreId: ObjectID,
  ): Promise<StoreSuggestions> {
    const rows: Array<DataStoreFinding> = await DataStoreFindingService.findBy({
      query: { dataStoreId, isAiSuggested: true },
      select: {
        _id: true,
        location: true,
        dataTypeId: true,
        isConfirmed: true,
        isSuppressed: true,
      },
      skip: 0,
      limit: MAX_FINDINGS_PER_STORE,
      props: { isRoot: true },
    });
    const suggestions: StoreSuggestions = {
      judged: new Map(),
      open: new Map(),
    };

    for (const row of rows) {
      if (!row.location || !row.dataTypeId || !row.id) {
        continue;
      }

      if (row.isConfirmed || row.isSuppressed) {
        suggestions.judged.set(row.location, {
          dataTypeId: row.dataTypeId,
          isConfirmed: Boolean(row.isConfirmed),
          isSuppressed: Boolean(row.isSuppressed),
        });
        continue;
      }

      const open: Array<{ id: ObjectID; dataTypeId: string }> =
        suggestions.open.get(row.location) || [];
      open.push({ id: row.id, dataTypeId: row.dataTypeId });
      suggestions.open.set(row.location, open);
    }

    return suggestions;
  }

  private static async ask(data: {
    projectId: ObjectID;
    dataStoreId: ObjectID;
    storeKind: string;
    dataTypes: Array<FieldSuggestionDataType>;
    fields: Array<UnplacedField>;
    isKnownDataType: (dataTypeId: string) => boolean;
  }): Promise<Map<string, FieldSuggestionAnswer> | null> {
    const references: Set<string> = new Set(
      data.fields.map((_field: UnplacedField, index: number): string => {
        return getFieldReference(index);
      }),
    );

    let response: AILogResponse;

    try {
      response = await AIService.executeWithLogging({
        projectId: data.projectId,
        feature: AI_DATA_SECURITY_FIELD_SUGGESTION_FEATURE,
        /*
         * No prompt previews in the AI Logs: they would name the store's
         * fields, and the AI Logs are read by every project member.
         */
        storeContentPreviews: false,
        storeErrorDetails: false,
        temperature: 0,
        maxTokens: FIELD_SUGGESTION_MAX_COMPLETION_TOKENS,
        requestTimeoutInMs: FIELD_SUGGESTION_TIMEOUT_IN_MS,
        requestRetries: 0,
        protectRequestParameters: true,
        messages: [
          { role: "system", content: FIELD_SUGGESTION_SYSTEM_PROMPT },
          {
            role: "user",
            content: buildFieldSuggestionPrompt({
              storeKind: data.storeKind,
              dataTypes: data.dataTypes,
              fields: data.fields,
            }),
          },
        ],
      });
    } catch (error) {
      // Enable AI, an LLM provider, credits, a daily limit: the project's settings, not a fault.
      logger.info(
        `DataSecurity: OneUptime AI did not suggest data types for store ${data.dataStoreId.toString()}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }

    const answers: Map<string, FieldSuggestionAnswer> | null =
      parseFieldSuggestionResponse({
        content: response.content,
        references,
        isKnownDataType: data.isKnownDataType,
      });

    if (!answers) {
      logger.warn(
        `DataSecurity: OneUptime AI's field suggestions for store ${data.dataStoreId.toString()} were not the JSON asked for.`,
      );
    }

    return answers;
  }

  private static async removeStale(ids: Array<ObjectID>): Promise<number> {
    if (ids.length === 0) {
      return 0;
    }

    try {
      return await DataStoreFindingService.deleteBy({
        query: {
          _id: new Includes(
            ids.map((id: ObjectID): string => {
              return id.toString();
            }),
          ),
          isAiSuggested: true,
          isConfirmed: false,
          isSuppressed: false,
        },
        limit: ids.length,
        skip: 0,
        props: { isRoot: true },
      });
    } catch (error) {
      logger.error("DataSecurity: could not remove stale field suggestions:");
      logger.error(error);
      return 0;
    }
  }

  // The answers, kept on the store with whatever its latest scan left pending.
  private static async saveAnswers(
    dataStoreId: ObjectID,
    answers: Record<string, FieldAnswer>,
  ): Promise<void> {
    const latest: DataStore | null = await DataStoreService.findOneById({
      id: dataStoreId,
      select: { _id: true, fieldSuggestionState: true },
      props: { isRoot: true },
    });
    const state: FieldSuggestionState = readFieldSuggestionState(
      latest?.fieldSuggestionState,
    );

    await DataStoreService.updateColumnsByIdWithoutHooks({
      id: dataStoreId,
      data: {
        fieldSuggestionState: toStoredFieldSuggestionState({
          ...state,
          answers: keepStandingAnswers(
            { ...state.answers, ...answers },
            OneUptimeDate.getCurrentDate(),
          ),
        }),
      } as never,
    });
  }
}

// A built-in type as the prompt lists it: its name, and its country when it has one.
function describeBuiltInType(type: DataTypeInfo): string {
  return type.country ? `${type.name} (${type.country})` : type.name;
}
