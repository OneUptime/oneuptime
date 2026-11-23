import AutoRemediationRule from "../../../../Models/DatabaseModels/AutoRemediationRule";
import DataSecurityAiProposal from "../../../../Models/DatabaseModels/DataSecurityAiProposal";
import DataSecurityIssue from "../../../../Models/DatabaseModels/DataSecurityIssue";
import DataStore from "../../../../Models/DatabaseModels/DataStore";
import DataStoreFinding from "../../../../Models/DatabaseModels/DataStoreFinding";
import Project from "../../../../Models/DatabaseModels/Project";
import Includes from "../../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../../Types/Date";
import {
  DataSecurityAiAutonomy,
  DataSecurityAiChangeSafety,
  DataSecurityAiPlan,
  DataSecurityAiProposalKind,
  DataSecurityAiProposalStatus,
  DataSecurityAiWithoutAskingVerdict,
  DataSecurityAiWork,
  DataSecurityAiWorkDecision,
  decideDataSecurityAiWork,
  getDataSecurityAiWithoutAskingVerdict,
} from "../../../../Types/DataSecurity/DataSecurityAi";
import { DATA_SENSITIVITY_RANK } from "../../../../Types/DataSecurity/DataSensitivity";
import {
  DataStoreFindingPrecedent,
  DataStoreFindingVerdict,
  DataStoreFindingVerdictRecord,
  FindingWrongMatchSign,
  getFindingVerdictInputHash,
  toDataStoreFindingVerdictJson,
} from "../../../../Types/DataSecurity/DataStoreFindingVerdict";
import DataTypeNamer from "../../../../Types/DataSecurity/DataTypeNamer";
import ObjectID from "../../../../Types/ObjectID";
import { DataSecurityAiRuleIssue } from "../../../../Utils/DataSecurity/DataSecurityAiRuleMatch";
import { getHintedDataTypeIds } from "../../../../Utils/DataSecurity/FieldNameHints";
import {
  getFindingFieldName,
  getWrongMatchSigns,
  isFindingAwaitingJudgement,
} from "../../../../Utils/DataSecurity/FindingJudgement";
import { AILogResponse } from "../../../Services/AIService";
import DataSecurityAiProposalService from "../../../Services/DataSecurityAiProposalService";
import DataStoreFindingService from "../../../Services/DataStoreFindingService";
import DataStoreService from "../../../Services/DataStoreService";
import ProjectService from "../../../Services/ProjectService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import { MAX_FINDINGS_PER_STORE } from "../../DataSecurity/DataSecurityFindingWriter";
import {
  PrecedentCandidate,
  selectFindingPrecedent,
} from "./FindingPrecedent";
import logger from "../../Logger";
import ProjectLanguage from "../../Notification/ProjectLanguage";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import ConfirmFindingsAction, {
  ConfirmFindingsPlan,
  MAX_FINDINGS_CONFIRMED_AT_ONCE,
  planConfirmFindings,
  readConfirmFindingsPlan,
} from "./Actions/ConfirmFindingsAction";
import DataSecurityAiCall from "./DataSecurityAiCall";
import DataSecurityAiEngine from "./DataSecurityAiEngine";
import {
  AiFindingPrecedent,
  AiFindingToJudge,
  findingVerdictData,
} from "./DataSecurityAiInput";
import DataSecurityAiProposals from "./DataSecurityAiProposals";
import {
  buildFindingVerdictPrompt,
  canConfirmOnItsOwn,
  FINDING_VERDICT_MAX_TOKENS,
  FINDING_VERDICT_TEMPERATURE,
  FINDING_VERDICT_TIMEOUT_IN_MS,
  FindingVerdictAnswer,
  getFindingReference,
  getPrecedentReference,
  holdFindingVerdictToFacts,
  MAX_FINDINGS_PER_VERDICT_REQUEST,
  MAX_VERDICT_REQUESTS_PER_RUN,
  parseFindingVerdictResponse,
} from "./FindingVerdictPrompt";
import {
  DATA_STORE_FOR_OWNER_PLAN_SELECT,
  DataStoreForOwnerPlan,
} from "./Owners/DataStoreOwnerSelects";

/*
 * ONEUPTIME AI'S VERDICTS ON THE FINDINGS THAT WAIT FOR A PERSON (#10372).
 *
 * A little after a store's scan (and its field suggestions), its findings
 * that wait for a person (FindingJudgement.isFindingAwaitingJudgement) are
 * judged:
 *
 *  1. The project's two switches - Enable AI, and "Work on new Data
 *     Security issues" - and its Data Security AI rules, matched against
 *     the store and each finding's data category as a store with no issue
 *     (a rule that names a check or a severity matches none): where Judge
 *     is Off, nothing is judged; with no rule, the project's defaults
 *     suggest.
 *  2. Each finding's precedent: the team's earlier decisions on findings of
 *     its data type, by the field's name first and by meaning second
 *     (FindingPrecedent).
 *  3. What the verdict would be written from is hashed: a finding whose
 *     hash is the one its verdict keeps is not asked about again, so the
 *     hourly scan of a service's telemetry makes no model call.
 *  4. OneUptime AI is asked, at most MAX_VERDICT_REQUESTS_PER_RUN calls of
 *     MAX_FINDINGS_PER_VERDICT_REQUEST findings - the ones with no verdict
 *     first, the most sensitive first - through the one Data Security call
 *     (names, shapes and counts, never a value), and its answer is held to
 *     what it was told (holdFindingVerdictToFacts). Each verdict is kept
 *     on its finding, in the project's language.
 *  5. A Confirm is made on OneUptime AI's own only where a rule - never
 *     the defaults - sets Judge to Without asking, and only on the team's
 *     own confirmation of a finding like it or a field named for the type
 *     (canConfirmOnItsOwn), never again for a finding whose earlier
 *     confirmation a person undid or dismissed: one proposal for the store,
 *     made without asking (ConfirmFindingsAction), or waiting in Data
 *     Security > AI where the hour's circuit breaker stops it.
 *
 * A Not sensitive verdict is never applied, under any rule: it waits on its
 * finding's row for a person, whose reason the dialog starts from its
 * draft. A refusal - Enable AI turned off, no LLM provider, no credits, a
 * daily limit - or an answer that is not the JSON asked for is logged, and
 * the findings are asked about after the next scan. Read and written as
 * OneUptime (root), the project scoped explicitly. Never throws.
 */

export enum FindingVerdictSkip {
  AiOff = "ai-off",
  StoreGone = "store-gone",
  NothingWaits = "nothing-waits",
  RulesUnreadable = "rules-unreadable",
  JudgeOff = "judge-off",
  NoAnswer = "no-answer",
}

export interface FindingVerdictOutcome {
  // Findings of the store that wait for a person.
  waiting: number;
  // Verdicts written in this run.
  judged: number;
  // Waiting findings whose verdict still stands: nothing it rests on changed.
  unchanged: number;
  // Findings OneUptime AI confirmed on its own, or proposed to.
  confirmedOnItsOwn: number;
  skipped?: FindingVerdictSkip | undefined;
}

// The most decided findings of one data type read as precedent, of each decision.
export const MAX_PRECEDENT_CANDIDATES_PER_TYPE: number = 500;

const FINDING_SELECT: {
  _id: true;
  dataStoreId: true;
  dataTypeId: true;
  dataTypeName: true;
  dataCategory: true;
  sensitivity: true;
  location: true;
  locationKind: true;
  confidence: true;
  valueCount: true;
  matchPercent: true;
  matchCount: true;
  distinctValues: true;
  testValueCount: true;
  isFreeText: true;
  isNameHinted: true;
  isFoundByName: true;
  isAiSuggested: true;
  isScrubbed: true;
  isSuppressed: true;
  isConfirmed: true;
  aiVerdictInputHash: true;
} = {
  _id: true,
  dataStoreId: true,
  dataTypeId: true,
  dataTypeName: true,
  dataCategory: true,
  sensitivity: true,
  location: true,
  locationKind: true,
  confidence: true,
  valueCount: true,
  matchPercent: true,
  matchCount: true,
  distinctValues: true,
  testValueCount: true,
  isFreeText: true,
  isNameHinted: true,
  isFoundByName: true,
  isAiSuggested: true,
  isScrubbed: true,
  isSuppressed: true,
  isConfirmed: true,
  aiVerdictInputHash: true,
};

const PRECEDENT_SELECT: {
  _id: true;
  dataStoreId: true;
  dataTypeId: true;
  location: true;
  locationKind: true;
  isFreeText: true;
  isSuppressed: true;
  isConfirmed: true;
  isConfirmedByAi: true;
  suppressedReason: true;
  decidedAt: true;
} = {
  _id: true,
  dataStoreId: true,
  dataTypeId: true,
  location: true,
  locationKind: true,
  isFreeText: true,
  isSuppressed: true,
  isConfirmed: true,
  isConfirmedByAi: true,
  suppressedReason: true,
  decidedAt: true,
};

// What the project's rules say of judging one data type's findings on a store.
interface JudgeDecision {
  judge: DataSecurityAiWorkDecision;
  llmProviderId: string;
}

// One finding to judge, with what it is judged from.
interface FindingToJudge {
  finding: DataStoreFinding;
  item: AiFindingToJudge;
  precedent: Array<DataStoreFindingPrecedent>;
  signs: Array<FindingWrongMatchSign>;
  hash: string;
}

function idOf(row: { id?: ObjectID | null; _id?: unknown } | null): string {
  return (row?.id?.toString() || String(row?._id || "")).toLowerCase();
}

function rankOf(value: unknown): number {
  return (
    (DATA_SENSITIVITY_RANK as Readonly<Record<string, number>>)[
      String(value || "")
    ] || 0
  );
}

export default class DataSecurityFindingVerdicts {
  @CaptureSpan()
  public static async judgeStore(data: {
    projectId: ObjectID;
    dataStoreId: ObjectID;
    now?: Date | undefined;
  }): Promise<FindingVerdictOutcome> {
    const now: Date = data.now || OneUptimeDate.getCurrentDate();
    const outcome: FindingVerdictOutcome = {
      waiting: 0,
      judged: 0,
      unchanged: 0,
      confirmedOnItsOwn: 0,
    };

    try {
      const project: Project | null = await ProjectService.findOneById({
        id: data.projectId,
        select: {
          _id: true,
          enableAi: true,
          enableAutomaticDataSecurityAi: true,
          requireTwoApprovalsForRiskierFixes: true,
        },
        props: { isRoot: true },
      });

      if (
        !project ||
        project.enableAi === false ||
        project.enableAutomaticDataSecurityAi !== true
      ) {
        return { ...outcome, skipped: FindingVerdictSkip.AiOff };
      }

      const store: (DataStoreForOwnerPlan & DataStore) | null =
        (await DataStoreService.findOneBy({
          query: { _id: data.dataStoreId, projectId: data.projectId },
          select: { ...DATA_STORE_FOR_OWNER_PLAN_SELECT, isArchived: true },
          props: { isRoot: true },
        })) as (DataStoreForOwnerPlan & DataStore) | null;

      if (!store?.id || store.isArchived) {
        return { ...outcome, skipped: FindingVerdictSkip.StoreGone };
      }

      const waiting: Array<DataStoreFinding> = (
        await DataStoreFindingService.findBy({
          query: {
            projectId: data.projectId,
            dataStoreId: store.id,
            isSuppressed: false,
            isConfirmed: false,
          },
          select: FINDING_SELECT,
          sort: { matchCount: SortOrder.Descending },
          skip: 0,
          limit: MAX_FINDINGS_PER_STORE,
          props: { isRoot: true },
        })
      ).filter((finding: DataStoreFinding): boolean => {
        return Boolean(finding.id) && isFindingAwaitingJudgement(finding);
      });

      outcome.waiting = waiting.length;

      if (waiting.length === 0) {
        return { ...outcome, skipped: FindingVerdictSkip.NothingWaits };
      }

      const rules: Array<AutoRemediationRule> | null =
        await DataSecurityAiEngine.readRules(data.projectId);

      if (!rules) {
        return { ...outcome, skipped: FindingVerdictSkip.RulesUnreadable };
      }

      const dataTypes: {
        namer: DataTypeNamer;
        categoryOf: Map<string, string>;
      } = await DataSecurityAiEngine.readDataTypes(data.projectId);
      const decisions: Map<string, JudgeDecision | null> = new Map();

      for (const finding of waiting) {
        const dataTypeId: string = finding.dataTypeId || "";

        if (!decisions.has(dataTypeId)) {
          decisions.set(
            dataTypeId,
            await DataSecurityFindingVerdicts.decideJudge({
              projectId: data.projectId,
              store,
              dataTypeId,
              rules,
              categoryOf: dataTypes.categoryOf,
            }),
          );
        }
      }

      const judged: Array<DataStoreFinding> = waiting.filter(
        (finding: DataStoreFinding): boolean => {
          return Boolean(decisions.get(finding.dataTypeId || ""));
        },
      );

      if (judged.length === 0) {
        return { ...outcome, skipped: FindingVerdictSkip.JudgeOff };
      }

      const language: string = await ProjectLanguage.getLanguage(
        data.projectId,
      );
      const toJudge: Array<FindingToJudge> =
        await DataSecurityFindingVerdicts.prepare({
          projectId: data.projectId,
          store,
          findings: judged,
          namer: dataTypes.namer,
          language,
        });

      outcome.unchanged = judged.length - toJudge.length;

      const asked: Array<FindingToJudge> = toJudge
        .sort((a: FindingToJudge, b: FindingToJudge): number => {
          const neverA: number = a.finding.aiVerdictInputHash ? 1 : 0;
          const neverB: number = b.finding.aiVerdictInputHash ? 1 : 0;

          return (
            neverA - neverB ||
            rankOf(b.finding.sensitivity) - rankOf(a.finding.sensitivity) ||
            (b.finding.matchCount || 0) - (a.finding.matchCount || 0)
          );
        })
        .slice(0, MAX_FINDINGS_PER_VERDICT_REQUEST * MAX_VERDICT_REQUESTS_PER_RUN);
      const written: Array<{
        entry: FindingToJudge;
        record: DataStoreFindingVerdictRecord;
      }> = [];

      for (
        let start: number = 0;
        start < asked.length;
        start += MAX_FINDINGS_PER_VERDICT_REQUEST
      ) {
        const batch: Array<FindingToJudge> = asked.slice(
          start,
          start + MAX_FINDINGS_PER_VERDICT_REQUEST,
        );
        const answers: Map<string, FindingVerdictAnswer> | null =
          await DataSecurityFindingVerdicts.ask({
            projectId: data.projectId,
            store,
            batch,
            language,
            namer: dataTypes.namer,
            llmProviderId:
              decisions.get(batch[0]!.finding.dataTypeId || "")
                ?.llmProviderId || "",
          });

        if (!answers) {
          outcome.skipped = FindingVerdictSkip.NoAnswer;
          break;
        }

        for (let index: number = 0; index < batch.length; index++) {
          const entry: FindingToJudge = batch[index]!;
          const answer: FindingVerdictAnswer | undefined = answers.get(
            getFindingReference(index),
          );

          // Not answered: asked again after the next scan.
          if (!answer) {
            continue;
          }

          const record: DataStoreFindingVerdictRecord =
            holdFindingVerdictToFacts({
              answer,
              precedent: entry.precedent,
              signs: entry.signs,
              language,
              now,
            });

          await DataStoreFindingService.updateColumnsByIdWithoutHooks({
            id: entry.finding.id!,
            data: {
              aiVerdict: record.verdict,
              aiVerdictAnalysis: toDataStoreFindingVerdictJson(record),
              aiVerdictAt: now,
              aiVerdictInputHash: entry.hash,
            } as never,
          });

          outcome.judged++;
          written.push({ entry, record });
        }
      }

      outcome.confirmedOnItsOwn =
        await DataSecurityFindingVerdicts.confirmOnItsOwn({
          projectId: data.projectId,
          store,
          written,
          decisions,
          namer: dataTypes.namer,
          requireTwoApprovalsForRiskierChanges:
            project.requireTwoApprovalsForRiskierFixes === true,
          now,
        });

      return outcome;
    } catch (error) {
      logger.error(
        `DataSecurity verdicts: could not judge the findings of store ${data.dataStoreId.toString()} of project ${data.projectId.toString()}: ${error}`,
      );
      return outcome;
    }
  }

  /*
   * What the project's AI rules say of judging one data type's findings on
   * a store: each rule matched against the store and the type's category,
   * as a store with no issue - a rule that names a check or a severity
   * matches none. Null when Judge is off.
   */
  public static async decideJudge(data: {
    projectId: ObjectID;
    store: DataStore;
    dataTypeId: string;
    rules: ReadonlyArray<AutoRemediationRule>;
    categoryOf: Map<string, string>;
  }): Promise<JudgeDecision | null> {
    const asIssue: DataSecurityIssue = new DataSecurityIssue();

    asIssue.dataTypeIds = data.dataTypeId ? [data.dataTypeId] : [];

    const facts: DataSecurityAiRuleIssue =
      await DataSecurityAiEngine.readRuleIssue({
        projectId: data.projectId,
        issue: asIssue,
        store: data.store,
        categoryOf: data.categoryOf,
      });
    const plan: DataSecurityAiPlan = decideDataSecurityAiWork({
      isAiEnabled: true,
      isAutomaticOn: true,
      rules: {
        rulesSetUp: data.rules.length > 0,
        matchingRules: DataSecurityAiEngine.matchRules(data.rules, facts),
      },
      issue: {},
    });

    if (plan.skip !== null) {
      return null;
    }

    const judge: DataSecurityAiWorkDecision =
      plan.works[DataSecurityAiWork.Judge];

    return judge.autonomy === DataSecurityAiAutonomy.Off
      ? null
      : { judge, llmProviderId: plan.llmProviderId };
  }

  /*
   * Each finding with its precedent and signs, and the hash of what its
   * verdict would be written from - leaving out the ones whose verdict
   * still stands.
   */
  private static async prepare(data: {
    projectId: ObjectID;
    store: DataStoreForOwnerPlan & DataStore;
    findings: Array<DataStoreFinding>;
    namer: DataTypeNamer;
    language: string;
  }): Promise<Array<FindingToJudge>> {
    const candidates: Map<string, Array<PrecedentCandidate>> =
      await DataSecurityFindingVerdicts.readPrecedentCandidates({
        projectId: data.projectId,
        dataTypeIds: [
          ...new Set(
            data.findings.map((finding: DataStoreFinding): string => {
              return finding.dataTypeId || "";
            }),
          ),
        ],
      });
    const chosen: Map<string, Array<DataStoreFindingPrecedent>> = new Map();
    const precedentStoreIds: Set<string> = new Set();

    for (const finding of data.findings) {
      const precedent: Array<DataStoreFindingPrecedent> =
        selectFindingPrecedent({
          finding: {
            id: idOf(finding),
            dataStoreId: idOf(data.store),
            dataTypeId: finding.dataTypeId,
            location: finding.location,
            locationKind: finding.locationKind,
            isFreeText: finding.isFreeText,
          },
          candidates: candidates.get(finding.dataTypeId || "") || [],
        });

      chosen.set(idOf(finding), precedent);

      for (const entry of precedent) {
        precedentStoreIds.add(entry.dataStoreId);
      }
    }

    const stores: Map<string, { kind: string; environment: string }> =
      await DataSecurityFindingVerdicts.readStores({
        projectId: data.projectId,
        dataStoreIds: [...precedentStoreIds],
      });
    const prepared: Array<FindingToJudge> = [];

    for (const finding of data.findings) {
      const precedent: Array<DataStoreFindingPrecedent> =
        chosen.get(idOf(finding)) || [];
      const signs: Array<FindingWrongMatchSign> = getWrongMatchSigns(finding);
      const field: string | null = getFindingFieldName(finding);
      const item: AiFindingToJudge = {
        ref: "",
        finding,
        signs,
        nameSaysInstead: field
          ? [...getHintedDataTypeIds(field)]
              .filter((id: string): boolean => {
                return id !== finding.dataTypeId;
              })
              .map((id: string): string => {
                return data.namer.nameOf(id);
              })
          : [],
        precedent: precedent.map(
          (
            entry: DataStoreFindingPrecedent,
            index: number,
          ): AiFindingPrecedent => {
            const store: { kind: string; environment: string } | undefined =
              stores.get(entry.dataStoreId.toLowerCase());

            return {
              ref: getPrecedentReference(index),
              decision: entry.decision,
              location: entry.location,
              isSameName: entry.isSameName,
              reason: entry.reason,
              storeKind: store?.kind,
              storeEnvironment: store?.environment,
              isSameStore:
                entry.dataStoreId.toLowerCase() === idOf(data.store),
            };
          },
        ),
      };
      const hash: string = getFindingVerdictInputHash({
        data: findingVerdictData({
          store: data.store,
          item,
          dataTypeNamer: data.namer,
        }),
        language: data.language,
      });

      if (finding.aiVerdictInputHash === hash) {
        continue;
      }

      prepared.push({ finding, item, precedent, signs, hash });
    }

    return prepared;
  }

  /*
   * The project's decided findings of each data type, newest first: the
   * marks of not sensitive, and people's confirmations - never OneUptime
   * AI's own.
   */
  public static async readPrecedentCandidates(data: {
    projectId: ObjectID;
    dataTypeIds: Array<string>;
  }): Promise<Map<string, Array<PrecedentCandidate>>> {
    const byType: Map<string, Array<PrecedentCandidate>> = new Map();

    for (const dataTypeId of data.dataTypeIds) {
      if (!dataTypeId) {
        continue;
      }

      const rows: Array<DataStoreFinding> = [];

      for (const query of [
        { isSuppressed: true },
        { isConfirmed: true, isConfirmedByAi: false, isSuppressed: false },
      ]) {
        rows.push(
          ...(await DataStoreFindingService.findBy({
            query: { projectId: data.projectId, dataTypeId, ...query },
            select: PRECEDENT_SELECT,
            sort: { updatedAt: SortOrder.Descending },
            skip: 0,
            limit: MAX_PRECEDENT_CANDIDATES_PER_TYPE,
            props: { isRoot: true },
          })),
        );
      }

      byType.set(
        dataTypeId,
        rows.map((row: DataStoreFinding): PrecedentCandidate => {
          return {
            id: idOf(row),
            dataStoreId: row.dataStoreId?.toString().toLowerCase() || "",
            dataTypeId: row.dataTypeId,
            location: row.location,
            locationKind: row.locationKind,
            isFreeText: row.isFreeText,
            isSuppressed: row.isSuppressed,
            isConfirmed: row.isConfirmed,
            isConfirmedByAi: row.isConfirmedByAi,
            suppressedReason: row.suppressedReason,
            decidedAt: row.decidedAt,
          };
        }),
      );
    }

    return byType;
  }

  // The kind and environment of the stores precedent is on, by id.
  private static async readStores(data: {
    projectId: ObjectID;
    dataStoreIds: Array<string>;
  }): Promise<Map<string, { kind: string; environment: string }>> {
    const stores: Map<string, { kind: string; environment: string }> =
      new Map();
    const ids: Array<string> = data.dataStoreIds.filter((id: string) => {
      return ObjectID.isValidUUID(id);
    });

    if (ids.length === 0) {
      return stores;
    }

    const rows: Array<DataStore> = await DataStoreService.findBy({
      query: {
        projectId: data.projectId,
        _id: new Includes(
          ids.map((id: string): ObjectID => {
            return new ObjectID(id);
          }),
        ),
      },
      select: { _id: true, kind: true, environment: true },
      skip: 0,
      limit: ids.length,
      props: { isRoot: true },
    });

    for (const row of rows) {
      stores.set(idOf(row), {
        kind: row.kind || "",
        environment: row.environment || "",
      });
    }

    return stores;
  }

  private static async ask(data: {
    projectId: ObjectID;
    store: DataStoreForOwnerPlan;
    batch: Array<FindingToJudge>;
    language: string;
    namer: DataTypeNamer;
    llmProviderId: string;
  }): Promise<Map<string, FindingVerdictAnswer> | null> {
    const findings: Array<AiFindingToJudge> = data.batch.map(
      (entry: FindingToJudge, index: number): AiFindingToJudge => {
        return { ...entry.item, ref: getFindingReference(index) };
      },
    );
    let response: AILogResponse;

    try {
      /*
       * Through the one Data Security call (DataSecurityAiCall): nothing of
       * what was sent or answered in the AI Logs, filed under its own
       * autonomous label, on the project's own model.
       */
      response = await DataSecurityAiCall.ask({
        projectId: data.projectId,
        prompt: buildFindingVerdictPrompt({
          store: data.store,
          findings,
          language: data.language,
          dataTypeNamer: data.namer,
        }),
        temperature: FINDING_VERDICT_TEMPERATURE,
        maxTokens: FINDING_VERDICT_MAX_TOKENS,
        requestTimeoutInMs: FINDING_VERDICT_TIMEOUT_IN_MS,
        requestRetries: 0,
        protectRequestParameters: true,
        rulePickedProviderId: data.llmProviderId,
      });
    } catch (error) {
      // Enable AI, an LLM provider, credits, a daily limit: the project's settings, not a fault.
      logger.info(
        `DataSecurity verdicts: OneUptime AI did not judge the findings of store ${idOf(data.store)}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }

    const answers: Map<string, FindingVerdictAnswer> | null =
      parseFindingVerdictResponse({
        content: response.content,
        references: new Set(
          findings.map((finding: AiFindingToJudge): string => {
            return finding.ref;
          }),
        ),
      });

    if (!answers) {
      logger.warn(
        `DataSecurity verdicts: OneUptime AI's verdicts on the findings of store ${idOf(data.store)} were not the JSON asked for.`,
      );
    }

    return answers;
  }

  /*
   * The findings a person took OneUptime AI's own confirmation back from,
   * or turned it down for: never confirmed on its own again.
   */
  private static async readTurnedDown(data: {
    projectId: ObjectID;
    dataStoreId: ObjectID;
  }): Promise<Set<string>> {
    const proposals: Array<DataSecurityAiProposal> =
      await DataSecurityAiProposalService.findBy({
        query: {
          projectId: data.projectId,
          dataStoreId: data.dataStoreId,
          kind: DataSecurityAiProposalKind.ConfirmFindings,
          status: QueryHelper.any([
            DataSecurityAiProposalStatus.Undone,
            DataSecurityAiProposalStatus.Dismissed,
          ]),
        },
        select: { _id: true, plan: true },
        skip: 0,
        limit: 500,
        props: { isRoot: true },
      });
    const ids: Set<string> = new Set();

    for (const proposal of proposals) {
      for (const finding of readConfirmFindingsPlan(proposal.plan)?.findings ||
        []) {
        ids.add(finding.findingId.toLowerCase());
      }
    }

    return ids;
  }

  /*
   * The Confirms OneUptime AI makes on its own (see the module comment):
   * one proposal per deciding rule, made without asking where the verdict
   * of its change allows.
   */
  private static async confirmOnItsOwn(data: {
    projectId: ObjectID;
    store: DataStoreForOwnerPlan & DataStore;
    written: Array<{
      entry: FindingToJudge;
      record: DataStoreFindingVerdictRecord;
    }>;
    decisions: Map<string, JudgeDecision | null>;
    namer: DataTypeNamer;
    requireTwoApprovalsForRiskierChanges: boolean;
    now: Date;
  }): Promise<number> {
    const eligible: Array<{
      finding: DataStoreFinding;
      record: DataStoreFindingVerdictRecord;
      judge: DataSecurityAiWorkDecision;
    }> = [];

    for (const { entry, record } of data.written) {
      const decision: JudgeDecision | null | undefined = data.decisions.get(
        entry.finding.dataTypeId || "",
      );

      if (
        decision &&
        record.verdict === DataStoreFindingVerdict.Confirm &&
        decision.judge.autonomy === DataSecurityAiAutonomy.WithoutAsking &&
        !decision.judge.fromDefaults &&
        canConfirmOnItsOwn({
          record,
          isNameHinted: entry.finding.isNameHinted === true,
        })
      ) {
        eligible.push({
          finding: entry.finding,
          record,
          judge: decision.judge,
        });
      }
    }

    if (eligible.length === 0) {
      return 0;
    }

    const turnedDown: Set<string> =
      await DataSecurityFindingVerdicts.readTurnedDown({
        projectId: data.projectId,
        dataStoreId: data.store.id!,
      });
    const byRule: Map<
      string,
      {
        judge: DataSecurityAiWorkDecision;
        findings: ConfirmFindingsPlan["findings"];
      }
    > = new Map();

    for (const { finding, record, judge } of eligible) {
      if (turnedDown.has(idOf(finding))) {
        continue;
      }

      const key: string = judge.ruleId || "";
      const group: {
        judge: DataSecurityAiWorkDecision;
        findings: ConfirmFindingsPlan["findings"];
      } = byRule.get(key) || { judge, findings: [] };

      if (group.findings.length < MAX_FINDINGS_CONFIRMED_AT_ONCE) {
        group.findings.push({
          findingId: idOf(finding),
          dataTypeId: finding.dataTypeId || "",
          dataTypeName: data.namer.nameOf(
            finding.dataTypeId || "",
            finding.dataTypeName,
          ),
          location: finding.location || "",
          reason: record.reason,
        });
      }

      byRule.set(key, group);
    }

    let confirmed: number = 0;

    for (const group of byRule.values()) {
      if (group.findings.length === 0) {
        continue;
      }

      const verdict: DataSecurityAiWithoutAskingVerdict =
        getDataSecurityAiWithoutAskingVerdict({
          work: group.judge,
          safety: DataSecurityAiChangeSafety.RecordsJudgement,
          meetsDefaultConditions: false,
          isNamedByRule: false,
          requireTwoApprovalsForRiskierChanges:
            data.requireTwoApprovalsForRiskierChanges,
          changesWithoutAskingThisHour:
            await DataSecurityAiEngine.countChangesWithoutAskingThisHour({
              projectId: data.projectId,
              now: data.now,
            }),
        });

      await DataSecurityAiProposals.propose({
        projectId: data.projectId,
        issue: null,
        store: data.store,
        action: ConfirmFindingsAction,
        change: planConfirmFindings({
          dataStoreId: idOf(data.store),
          storeName: data.store.name || "",
          findings: group.findings,
        }),
        work: group.judge,
        verdict,
        riskScore: 0,
        now: data.now,
      });

      confirmed += group.findings.length;
    }

    return confirmed;
  }
}
