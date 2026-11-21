import { sha256Hex } from "../../../../Types/AutoRemediation/RemediationPlanFingerprint";
import {
  DataStoreOwnerCandidate,
  DataStoreOwnerEvidence,
  DataStoreOwnerEvidenceSource,
  DataStoreOwnerKind,
  DataStoreOwnersPlan,
  DataStoreOwnerUnmatched,
  getOwnersKey,
  getStoreOwnerRuleFacts,
  listOwnerNames,
} from "../../../../Types/DataSecurity/DataStoreOwnerProposal";
import DataTypeNamer from "../../../../Types/DataSecurity/DataTypeNamer";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  DataStoreOwnerAnswer,
  HeldDataStoreOwnerAnswer,
  holdDataStoreOwnerAnswerToEvidence,
} from "../../../../Utils/DataSecurity/DataStoreOwnerAnswer";
import {
  DataStoreOwnerDirectory,
  DataStoreOwnerEvidenceSet,
} from "../../../../Utils/DataSecurity/DataStoreOwnerEvidence";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../../Utils/Markdown/FeedMarkdown";
import AIService from "../../../Services/AIService";
import DataStoreOwnerTeamService from "../../../Services/DataStoreOwnerTeamService";
import DataStoreOwnerUserService from "../../../Services/DataStoreOwnerUserService";
import DataStoreOwnerEvidenceReader, {
  CodeOwnersFileCache,
  DATA_STORE_FOR_OWNER_EVIDENCE_SELECT,
  DataStoreForOwnerEvidence,
} from "../../DataSecurity/Owners/DataStoreOwnerEvidenceReader";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import AIInvestigationEngine from "../SRE/AIInvestigationEngine";
import {
  DataSecurityAiPlannedChange,
  DataSecurityAiPlanOutcome,
} from "./DataSecurityAiAction";
import DataSecurityAiCall from "./DataSecurityAiCall";
import { AiStoreRecord } from "./DataSecurityAiInput";
import {
  buildDataStoreOwnerPrompt,
  DATA_STORE_OWNER_ANSWER_SHAPE,
  DATA_STORE_OWNER_MAX_TOKENS,
  DATA_STORE_OWNER_TEMPERATURE,
  DataStoreOwnerStrictAnswer,
} from "./DataStoreOwnerPrompt";
import { readStrictAnswer } from "./StrictAnswer";

/*
 * ONEUPTIME AI'S OWNERS FOR ONE STORE (#10374): from the evidence of who
 * owns it to the change a person approves.
 *
 *  1. A store that has owners has nothing to propose.
 *  2. The evidence, read by plain code (DataStoreOwnerEvidenceReader): a
 *     store none of it names a candidate for has nothing to propose either,
 *     and no model is asked.
 *  3. OneUptime AI, asked through the one Data Security call, on the
 *     project's own model, with the input builder's prompt
 *     (DataStoreOwnerPrompt): which candidates own it, the evidence they
 *     rest on, why and how sure.
 *  4. Its answer, held to the evidence (DataStoreOwnerAnswer): an owner or
 *     a piece of evidence it made up is dropped, and every owner rests on
 *     evidence that names it.
 *  5. The change: who becomes an owner, why, how it is proven, how to undo
 *     it - each owner and piece of evidence by name, for the person who
 *     approves it.
 *
 * Owners are told, so the change always asks (ChangesWhoIsTold): nothing
 * here makes it. What stopped it is a short code Why AI did not act says.
 */

// The columns of a store the planner reads: the evidence's, and the builder's.
export const DATA_STORE_FOR_OWNER_PLAN_SELECT: typeof DATA_STORE_FOR_OWNER_EVIDENCE_SELECT & {
  kind: true;
  provider: true;
  region: true;
  environment: true;
  sensitivity: true;
  sensitivityOverride: true;
  dataTypeIds: true;
  dataCategories: true;
  exposure: true;
  isPublicByDesign: true;
} = {
  ...DATA_STORE_FOR_OWNER_EVIDENCE_SELECT,
  kind: true,
  provider: true,
  region: true,
  environment: true,
  sensitivity: true,
  sensitivityOverride: true,
  dataTypeIds: true,
  dataCategories: true,
  exposure: true,
  isPublicByDesign: true,
};

export type DataStoreForOwnerPlan = DataStoreForOwnerEvidence & AiStoreRecord;

// Why there is nothing to propose, as Why AI did not act's detail codes.
export const DATA_STORE_OWNER_NOTHING: {
  hasOwners: "store-has-owners";
  noEvidence: "no-evidence-of-owner";
  noProvider: "no-llm-provider";
  noCredits: "no-ai-credits";
  dailyLimit: "ai-daily-limit-reached";
  callFailed: "could-not-ask";
  unreadable: "answer-not-read";
} = {
  hasOwners: "store-has-owners",
  noEvidence: "no-evidence-of-owner",
  noProvider: "no-llm-provider",
  noCredits: "no-ai-credits",
  dailyLimit: "ai-daily-limit-reached",
  callFailed: "could-not-ask",
  unreadable: "answer-not-read",
};

const KIND_WORDS: Readonly<Record<DataStoreOwnerKind, string>> = {
  [DataStoreOwnerKind.Team]: "team",
  [DataStoreOwnerKind.User]: "person",
};

// What makes two owner proposals for a store the same: the store and its owners.
export function getDataStoreOwnersPlanKey(
  dataStoreId: string,
  owners: ReadonlyArray<{ kind: DataStoreOwnerKind; id: string }>,
): string {
  return `owners:${sha256Hex(
    `${dataStoreId.toLowerCase()}\n${getOwnersKey(owners)}`,
  ).slice(0, 16)}`;
}

function namesOf(
  evidence: DataStoreOwnerEvidence,
  candidates: ReadonlyArray<DataStoreOwnerCandidate>,
): string {
  return listOwnerNames(
    evidence.owners.map((owner: { kind: DataStoreOwnerKind; id: string }) => {
      return (
        candidates.find((candidate: DataStoreOwnerCandidate): boolean => {
          return (
            candidate.kind === owner.kind &&
            candidate.id.toLowerCase() === owner.id.toLowerCase()
          );
        })?.name || ""
      );
    }),
  );
}

/*
 * A piece of evidence in a sentence, for the person who approves: what it
 * is and whom it names - or why it names nobody.
 */
export function describeDataStoreOwnerEvidence(
  evidence: DataStoreOwnerEvidence,
  candidates: ReadonlyArray<DataStoreOwnerCandidate>,
): MarkdownText {
  const names: string = namesOf(evidence, candidates);

  switch (evidence.source) {
    case DataStoreOwnerEvidenceSource.CloudTag:
      return names
        ? mdText`The cloud tag ${FeedMarkdown.code(`${evidence.tagKey}=${evidence.tagValue}`)} names **${names}**.`
        : mdText`The cloud tag ${FeedMarkdown.code(`${evidence.tagKey}=${evidence.tagValue}`)} names ${evidence.unmatched === DataStoreOwnerUnmatched.NoMemberWithEmail ? "an email address no member of this project has" : "no team of this project"}.`;
    case DataStoreOwnerEvidenceSource.ServiceOwners:
      if (!names) {
        return mdText`The service **${evidence.serviceName || ""}** ${evidence.isServiceTelemetry ? "writes this telemetry" : "uses this store"}, and has no owners.`;
      }

      return evidence.isServiceTelemetry
        ? mdText`This is the telemetry of the service **${evidence.serviceName || ""}**, owned by **${names}**.`
        : mdText`The service **${evidence.serviceName || ""}** uses this store, and is owned by **${names}**.`;
    case DataStoreOwnerEvidenceSource.CodeOwners: {
      const where: MarkdownText = mdText`${FeedMarkdown.code(evidence.filePath || "")} in ${evidence.repositoryName || ""} declares this store, and its code owners (${FeedMarkdown.code(evidence.codeOwnersPath || "")}) name ${FeedMarkdown.code(evidence.codeOwner || "")}`;

      if (names) {
        return mdText`${where}: **${names}**.`;
      }

      return evidence.unmatched === DataStoreOwnerUnmatched.NoTeamNamed
        ? mdText`${where}, and no team of this project has that name.`
        : mdText`${where}, whom no member of this project is known by.`;
    }
    case DataStoreOwnerEvidenceSource.ChangedBy:
      return mdText`**${names}** changed it ${String(evidence.changeCount || 1)} ${evidence.changeCount === 1 ? "time" : "times"} in the cloud${evidence.lastChangedAt ? `, last on ${evidence.lastChangedAt.slice(0, 10)}` : ""}${evidence.operation ? ` (${evidence.operation})` : ""}.`;
    case DataStoreOwnerEvidenceSource.AddedBy:
      return mdText`**${names}** added it to OneUptime.`;
    default:
      return mdText``;
  }
}

export default class DataStoreOwnerPlanner {
  // Whether the store has an owner, a person or a team, already.
  public static async hasOwners(data: {
    projectId: ObjectID;
    dataStoreId: ObjectID;
  }): Promise<boolean> {
    const query: { projectId: ObjectID; dataStoreId: ObjectID } = {
      projectId: data.projectId,
      dataStoreId: data.dataStoreId,
    };
    const [users, teams]: [number, number] = await Promise.all([
      DataStoreOwnerUserService.countBy({
        query,
        props: { isRoot: true },
      }).then((count: { toNumber: () => number }): number => {
        return count.toNumber();
      }),
      DataStoreOwnerTeamService.countBy({
        query,
        props: { isRoot: true },
      }).then((count: { toNumber: () => number }): number => {
        return count.toNumber();
      }),
    ]);

    return users + teams > 0;
  }

  /*
   * The owners OneUptime AI proposes for the store, as a change for a
   * person to approve - or nothing, and why.
   */
  @CaptureSpan()
  public static async plan(data: {
    projectId: ObjectID;
    store: DataStoreForOwnerPlan;
    // Sensitive: it fails "Nobody owns this sensitive store".
    isSensitive: boolean;
    directory: DataStoreOwnerDirectory;
    dataTypeNamer: DataTypeNamer;
    // The Data Security AI rule's pick of LLM provider, when one picks one.
    llmProviderId?: string | undefined;
    codeOwnersCache?: CodeOwnersFileCache | undefined;
  }): Promise<DataSecurityAiPlanOutcome> {
    const storeId: string = (
      data.store.id?.toString() || String(data.store._id || "")
    ).toLowerCase();

    if (!storeId) {
      return { kind: "nothing", detail: DATA_STORE_OWNER_NOTHING.noEvidence };
    }

    if (
      await DataStoreOwnerPlanner.hasOwners({
        projectId: data.projectId,
        dataStoreId: new ObjectID(storeId),
      })
    ) {
      return { kind: "nothing", detail: DATA_STORE_OWNER_NOTHING.hasOwners };
    }

    const found: DataStoreOwnerEvidenceSet =
      await DataStoreOwnerEvidenceReader.read({
        projectId: data.projectId,
        store: data.store,
        directory: data.directory,
        codeOwnersCache: data.codeOwnersCache,
      });

    if (found.candidates.length === 0) {
      return { kind: "nothing", detail: DATA_STORE_OWNER_NOTHING.noEvidence };
    }

    const pickedProviderId: ObjectID | undefined =
      data.llmProviderId && ObjectID.isValidUUID(data.llmProviderId)
        ? new ObjectID(data.llmProviderId)
        : undefined;
    const blocker: "provider_missing" | "insufficient_ai_balance" | null =
      await AIInvestigationEngine.getProviderOrBalanceReason(
        data.projectId,
        pickedProviderId,
      );

    if (blocker === "provider_missing") {
      return { kind: "nothing", detail: DATA_STORE_OWNER_NOTHING.noProvider };
    }

    if (blocker === "insufficient_ai_balance") {
      return { kind: "nothing", detail: DATA_STORE_OWNER_NOTHING.noCredits };
    }

    if (
      await AIService.getReachedProjectDailyLimit({ projectId: data.projectId })
    ) {
      return { kind: "nothing", detail: DATA_STORE_OWNER_NOTHING.dailyLimit };
    }

    let content: string;

    try {
      const response: { content: string } = await DataSecurityAiCall.ask({
        projectId: data.projectId,
        prompt: buildDataStoreOwnerPrompt({
          store: data.store,
          candidates: found.candidates,
          evidence: found.evidence,
          servicesUsingIt: found.servicesUsingIt,
          dataTypeNamer: data.dataTypeNamer,
        }),
        maxTokens: DATA_STORE_OWNER_MAX_TOKENS,
        temperature: DATA_STORE_OWNER_TEMPERATURE,
        // No person started it: the call's own messages and bounds hold.
        protectRequestParameters: true,
        rulePickedProviderId: data.llmProviderId,
      });

      content = response.content || "";
    } catch (error) {
      logger.error(
        `DataSecurity owners: could not ask OneUptime AI about store ${storeId} of project ${data.projectId.toString()}: ${error}`,
      );
      return { kind: "nothing", detail: DATA_STORE_OWNER_NOTHING.callFailed };
    }

    const answer: DataStoreOwnerStrictAnswer | null = readStrictAnswer(
      content,
      DATA_STORE_OWNER_ANSWER_SHAPE,
    );

    if (!answer) {
      return { kind: "nothing", detail: DATA_STORE_OWNER_NOTHING.unreadable };
    }

    const held: HeldDataStoreOwnerAnswer = holdDataStoreOwnerAnswerToEvidence({
      answer: answer as DataStoreOwnerAnswer,
      candidates: found.candidates,
      evidence: found.evidence,
    });

    if (held.inventedOwners.length > 0 || held.inventedEvidence.length > 0) {
      logger.debug(
        `DataSecurity owners: OneUptime AI named ${held.inventedOwners.length} owners and ${held.inventedEvidence.length} pieces of evidence that are not store ${storeId}'s: dropped.`,
      );
    }

    if (held.kind === "nothing") {
      return { kind: "nothing", detail: held.detail };
    }

    return {
      kind: "planned",
      changes: [
        DataStoreOwnerPlanner.toChange({
          plan: {
            dataStoreId: storeId,
            dataStoreName: data.store.name || "",
            owners: held.owners,
            confidence: held.confidence,
            reason: held.reason,
            disagreement: held.disagreement,
            restsOn: held.restsOn,
            evidence: found.evidence,
            candidates: found.candidates,
            ruleFacts: getStoreOwnerRuleFacts({
              name: data.store.name,
              cloudTags: data.store.cloudTags,
            }),
            isSensitive: data.isSensitive,
          },
        }),
      ],
    };
  }

  // The change a store's owners plan makes, as its proposal shows it.
  public static toChange(data: {
    plan: DataStoreOwnersPlan;
  }): DataSecurityAiPlannedChange {
    const plan: DataStoreOwnersPlan = data.plan;
    const names: Array<string> = plan.owners.map(
      (owner: DataStoreOwnerCandidate): string => {
        return owner.name;
      },
    );
    const cannotOpen: Array<DataStoreOwnerCandidate> = plan.owners.filter(
      (owner: DataStoreOwnerCandidate): boolean => {
        return !owner.canOpenStore;
      },
    );
    const restsOn: Array<DataStoreOwnerEvidence> = plan.evidence.filter(
      (item: DataStoreOwnerEvidence): boolean => {
        return plan.restsOn.includes(item.id);
      },
    );
    const otherEvidence: Array<DataStoreOwnerEvidence> = plan.evidence.filter(
      (item: DataStoreOwnerEvidence): boolean => {
        return !plan.restsOn.includes(item.id);
      },
    );

    return {
      title:
        names.length === 1
          ? `Make ${names[0]} the owner of ${plan.dataStoreName}`
          : `Make ${listOwnerNames(names)} the owners of ${plan.dataStoreName}`,
      changeMarkdown: FeedMarkdown.join(
        [
          mdText`${FeedMarkdown.bulletList(
            plan.owners.map((owner: DataStoreOwnerCandidate): MarkdownText => {
              return mdText`**${owner.name}** (${KIND_WORDS[owner.kind]})`;
            }),
          )}`,
          mdText`${plan.owners.length === 1 ? "This owner is" : "These owners are"} added to **${plan.dataStoreName}**, and told, as any owner is.`,
          cannotOpen.length > 0
            ? mdText`${listOwnerNames(
                cannotOpen.map((owner: DataStoreOwnerCandidate): string => {
                  return owner.name;
                }),
              )} cannot open this store in Data Security today: give them a Security role, or pick another owner.`
            : mdText``,
        ].filter((part: MarkdownText): boolean => {
          return part.toString().length > 0;
        }),
        "\n\n",
      ).toString(),
      reasonMarkdown: FeedMarkdown.join(
        [
          plan.reason ? mdText`${plan.reason}` : mdText``,
          mdText`How sure OneUptime AI is: **${plan.confidence}**.`,
          plan.disagreement
            ? mdText`The evidence disagrees: ${plan.disagreement}`
            : mdText``,
          mdText`What it rests on:`,
          FeedMarkdown.bulletList(
            restsOn.map((item: DataStoreOwnerEvidence): MarkdownText => {
              return describeDataStoreOwnerEvidence(item, plan.candidates);
            }),
          ),
          otherEvidence.length > 0 ? mdText`What else was found:` : mdText``,
          FeedMarkdown.bulletList(
            otherEvidence.map((item: DataStoreOwnerEvidence): MarkdownText => {
              return describeDataStoreOwnerEvidence(item, plan.candidates);
            }),
          ),
        ].filter((part: MarkdownText): boolean => {
          return part.toString().length > 0;
        }),
        "\n\n",
      ).toString(),
      proofMarkdown: (plan.isSensitive
        ? mdText`The store's own check decides: once the owners are added, the store is checked again, and **Nobody owns this sensitive store** passes and its issue resolves.`
        : mdText`The store's Owners page lists them. It holds no sensitive data yet, so no check waits on its owners: the day a scan finds some, they are the ones told.`
      ).toString(),
      undoMarkdown:
        mdText`Undo removes the owners this added, and nothing else. They were told when they were added, and that is not taken back.`.toString(),
      plan: plan as unknown as JSONObject,
      planKey: getDataStoreOwnersPlanKey(plan.dataStoreId, plan.owners),
      // An owner is told: never made without a person, under any rule.
      meetsDefaultConditions: false,
    };
  }
}
