import AutoRemediationRule from "../../../../Models/DatabaseModels/AutoRemediationRule";
import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import DataSecurityIssue from "../../../../Models/DatabaseModels/DataSecurityIssue";
import DataStore from "../../../../Models/DatabaseModels/DataStore";
import Project from "../../../../Models/DatabaseModels/Project";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../../Types/Date";
import {
  DataSecurityAiAskReason,
  DataSecurityAiAutonomy,
  DataSecurityAiChangeSafety,
  DataSecurityAiPlan,
  DataSecurityAiWithoutAskingVerdict,
  DataSecurityAiWork,
  DataSecurityAiWorkDecision,
  decideDataSecurityAiWork,
  getDataSecurityAiWithoutAskingVerdict,
} from "../../../../Types/DataSecurity/DataSecurityAi";
import {
  DataSecurityAiDecisionEntry,
  DataSecurityAiDecisionReason,
} from "../../../../Types/DataSecurity/DataSecurityAiDecision";
import { TELEMETRY_FINDING_CHECK_IDS } from "../../../../Types/DataSecurity/DataSecurityCheckCatalog";
import DataSecurityIssueResolution from "../../../../Types/DataSecurity/DataSecurityIssueResolution";
import DataSecurityIssueStatus from "../../../../Types/DataSecurity/DataSecurityIssueStatus";
import {
  MAX_CALL_SITE_PLACES,
  SERVICE_TELEMETRY_STORE_KINDS,
  TelemetryLeakFixLeak,
  TelemetryLeakFixStrategy,
  TelemetryLeakHandling,
  TelemetryLeakPlace,
} from "../../../../Types/DataSecurity/TelemetryLeakFix";
import ObjectID from "../../../../Types/ObjectID";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../../Utils/Markdown/FeedMarkdown";
import CodeRepositoryService from "../../../Services/CodeRepositoryService";
import DataSecurityIssueService from "../../../Services/DataSecurityIssueService";
import DataStoreService from "../../../Services/DataStoreService";
import ProjectService from "../../../Services/ProjectService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import TelemetryLeakFix, {
  TelemetryLeakFixPlan,
} from "../../DataSecurity/TelemetryLeakFix";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import OpenPullRequestCap, {
  OpenPullRequestCapDecision,
} from "../CodeFix/OpenPullRequestCap";
import TelemetryLeakFixAction from "./Actions/TelemetryLeakFixAction";
import { DataSecurityAiPlannedChange } from "./DataSecurityAiAction";
import DataSecurityAiEngine from "./DataSecurityAiEngine";
import DataSecurityAiProposals from "./DataSecurityAiProposals";

/*
 * ONEUPTIME AI PROPOSES THE FIX OF EACH SERVICE'S TELEMETRY LEAKS IN ITS
 * CODE (#10367), UNDER THE PROJECT'S RULES (#10364).
 *
 * A little after each evaluation, while Enable AI and Work on new issues
 * are on, for each service with an open telemetry issue - or one contained
 * at ingest, which the code still writes - the riskiest service first:
 *
 *   - the Fix work the project's AI rules give the service's riskiest issue
 *     decides it, as the engine decides it for that issue (a rule matches a
 *     service, so it may open them without asking per service): Off
 *     proposes nothing; out of the box it is Suggest, so the pull request
 *     waits for a person in Data Security > AI, showing where each leak is
 *     written and the files OneUptime AI starts from;
 *   - one proposal per service and repository (TelemetryLeakFix.planService),
 *     kept on its riskiest issue; a newer plan replaces the one still
 *     waiting in its lane, and the same plan is never proposed twice;
 *   - a rule whose Fix is Without asking opens it on its own - in a
 *     repository something decided, never one a person must pick - while
 *     the repository is under its cap on open AI pull requests, counting
 *     those this run opened: the riskiest services get the slots, and the
 *     rest wait, saying why (AtPullRequestCap);
 *   - a fix already on its way for the service there is not proposed again.
 *
 * Never throws.
 */

const ROOT: { isRoot: true } = { isRoot: true };

// The most services one run proposes for, the riskiest first.
export const MAX_TELEMETRY_FIX_SERVICES_PER_RUN: number = 10;

// The most issues read to find the services with leaks.
const MAX_TELEMETRY_ISSUES_READ: number = 500;

// The most places a proposal's preview names, and leaks it lists.
const MAX_PREVIEW_LEAKS: number = 12;

const SIGNAL_WORDS: Readonly<Record<string, string>> = {
  Logs: "logs",
  Spans: "spans",
  Exceptions: "exceptions",
  AiCalls: "AI calls",
  Metrics: "metrics",
};

function idOf(record: { id?: ObjectID | null; _id?: unknown }): string {
  return (record.id?.toString() || String(record._id || "")).toLowerCase();
}

// Where a place is, in a few words: its file and line, else its names.
export function describeTelemetryLeakPlace(
  place: TelemetryLeakPlace,
): MarkdownText {
  const parts: Array<MarkdownText> = [];

  if (place.filePath) {
    parts.push(
      FeedMarkdown.code(
        place.lineNumber !== undefined
          ? `${place.filePath}:${place.lineNumber}`
          : place.filePath,
      ),
    );
  }

  if (place.functionName) {
    parts.push(mdText`in ${FeedMarkdown.code(place.functionName)}`);
  }

  if (place.spanName) {
    parts.push(mdText`span ${FeedMarkdown.code(place.spanName)}`);
  }

  if (place.template) {
    parts.push(mdText`line ${FeedMarkdown.code(place.template)}`);
  }

  if (place.metricName) {
    parts.push(mdText`metric ${FeedMarkdown.code(place.metricName)}`);
  }

  if (place.scopeName && !place.filePath) {
    parts.push(mdText`from ${FeedMarkdown.code(place.scopeName)}`);
  }

  return FeedMarkdown.join(parts, " ");
}

/*
 * What a proposal shows before anyone approves it: how the leaks are fixed,
 * each leak with where it is written, and the files OneUptime AI starts
 * from - places, keys, data types and templates, never a value.
 */
export function buildTelemetryFixPreview(plan: TelemetryLeakFixPlan): string {
  const how: MarkdownText =
    plan.decision.strategy === TelemetryLeakFixStrategy.CallSites
      ? mdText`One pull request that fixes each leak where it is written: it is written in ${String(plan.decision.placeCount)} place${plan.decision.placeCount === 1 ? "" : "s"}, at most ${String(MAX_CALL_SITE_PLACES)}.`
      : plan.decision.strategy === TelemetryLeakFixStrategy.RedactionStep
        ? mdText`One pull request that adds one redaction step where the service sets up its telemetry, with a test, rather than editing each place: the leaks are written in more than ${String(MAX_CALL_SITE_PLACES)} places, or your scrub rules hide them at ingest already.`
        : mdText`One pull request that fixes the few leaks where they are written, and adds one redaction step, with a test, for the keys your scrub rules hide at ingest already.`;
  const leakLines: Array<string> = plan.decision.leaks
    .slice(0, MAX_PREVIEW_LEAKS)
    .map((leak: TelemetryLeakFixLeak): string => {
      const what: MarkdownText = leak.key
        ? mdText`**${leak.dataTypeName}** in ${FeedMarkdown.code(leak.key)} of ${SIGNAL_WORDS[leak.signal] || leak.signal}`
        : mdText`**${leak.dataTypeName}** in the ${leak.location} of ${SIGNAL_WORDS[leak.signal] || leak.signal}`;
      const where: Array<MarkdownText> = leak.places
        .slice(0, 2)
        .map(describeTelemetryLeakPlace);
      const fix: string =
        leak.handling === TelemetryLeakHandling.CallSite
          ? "fixed where it is written"
          : "covered by the redaction step";

      return mdText`- ${what}: ${where.length > 0 ? FeedMarkdown.join(where, "; ") : mdText`its key is looked for in the code`} (${fix})`.toString();
    });
  const more: number = plan.decision.leaks.length - leakLines.length;
  const files: string =
    plan.startFiles.length > 0
      ? mdText`OneUptime AI starts from ${FeedMarkdown.join(
          plan.startFiles.slice(0, 5).map((file: string): MarkdownText => {
            return FeedMarkdown.code(file);
          }),
          ", ",
        )}${plan.folder ? mdText`, in ${FeedMarkdown.code(plan.folder)}` : FeedMarkdown.empty()}.`.toString()
      : plan.folder
        ? mdText`OneUptime AI starts in ${FeedMarkdown.code(plan.folder)}.`.toString()
        : "";
  const where: string = plan.repository
    ? mdText`In **${plan.repository.name || plan.repository.repositoryName}**.`.toString()
    : "No repository was found for this service's code: pick the one that holds it when you approve.";

  return [
    how.toString(),
    "",
    ...leakLines,
    ...(more > 0 ? [`- …and ${more} more`] : []),
    "",
    where,
    ...(files ? [files] : []),
    ...(plan.hasSecrets
      ? [
          "",
          mdText`**A secret is among them.** The code fix stops new copies only: rotate the secret too.`.toString(),
        ]
      : []),
  ].join("\n");
}

export default class TelemetryLeakFixProposals {
  @CaptureSpan()
  public static async proposeForProject(data: {
    projectId: ObjectID;
    now?: Date | undefined;
  }): Promise<number> {
    try {
      const project: Project | null = await ProjectService.findOneById({
        id: data.projectId,
        select: {
          _id: true,
          enableAi: true,
          enableAutomaticDataSecurityAi: true,
          requireTwoApprovalsForRiskierFixes: true,
        },
        props: ROOT,
      });

      if (
        !project ||
        project.enableAi === false ||
        project.enableAutomaticDataSecurityAi !== true
      ) {
        return 0;
      }

      const now: Date = data.now || OneUptimeDate.getCurrentDate();
      const services: Array<{
        serviceId: string;
        issue: DataSecurityIssue;
        store: DataStore;
      }> = await TelemetryLeakFixProposals.findServicesWithLeaks(
        data.projectId,
      );

      if (services.length === 0) {
        return 0;
      }

      const rules: Array<AutoRemediationRule> | null =
        await DataSecurityAiEngine.readRules(data.projectId);
      const categoryOf: Map<string, string> = rules?.length
        ? (await DataSecurityAiEngine.readDataTypes(data.projectId)).categoryOf
        : new Map();
      // Pull requests this run opened, by repository: they count toward its cap.
      const openedThisRun: Map<string, number> = new Map();
      let proposed: number = 0;

      for (const service of services.slice(
        0,
        MAX_TELEMETRY_FIX_SERVICES_PER_RUN,
      )) {
        try {
          proposed += await TelemetryLeakFixProposals.proposeForService({
            projectId: data.projectId,
            serviceId: new ObjectID(service.serviceId),
            riskiestIssue: service.issue,
            riskiestStore: service.store,
            rules,
            categoryOf,
            requireTwoApprovals:
              project.requireTwoApprovalsForRiskierFixes === true,
            openedThisRun,
            now,
          });
        } catch (error) {
          logger.error(
            `DataSecurity AI: could not propose the telemetry fix of service ${service.serviceId}: ${error}`,
          );
        }
      }

      return proposed;
    } catch (error) {
      logger.error(
        `DataSecurity AI: could not propose the telemetry fixes of project ${data.projectId.toString()}: ${error}`,
      );
      return 0;
    }
  }

  /*
   * The services with a telemetry leak: each one's riskiest open telemetry
   * issue - or one contained at ingest - and its store, the riskiest
   * service first.
   */
  public static async findServicesWithLeaks(
    projectId: ObjectID,
  ): Promise<
    Array<{ serviceId: string; issue: DataSecurityIssue; store: DataStore }>
  > {
    const issues: Array<DataSecurityIssue> =
      await DataSecurityIssueService.findBy({
        query: {
          projectId,
          checkId: QueryHelper.any([...TELEMETRY_FINDING_CHECK_IDS]),
          status: QueryHelper.any([
            DataSecurityIssueStatus.Open,
            DataSecurityIssueStatus.Resolved,
          ]),
        },
        select: {
          _id: true,
          checkId: true,
          severity: true,
          riskScore: true,
          status: true,
          resolution: true,
          dataStoreId: true,
          dataTypeIds: true,
          checkGroup: true,
        },
        sort: { riskScore: SortOrder.Descending },
        skip: 0,
        limit: MAX_TELEMETRY_ISSUES_READ,
        props: ROOT,
      });
    const leaking: Array<DataSecurityIssue> = issues.filter(
      (issue: DataSecurityIssue): boolean => {
        return (
          Boolean(issue.dataStoreId) &&
          (issue.status === DataSecurityIssueStatus.Open ||
            issue.resolution === DataSecurityIssueResolution.ContainedAtIngest)
        );
      },
    );

    if (leaking.length === 0) {
      return [];
    }

    const stores: Array<DataStore> = await DataStoreService.findBy({
      query: {
        projectId,
        _id: QueryHelper.any(
          Array.from(
            new Set(
              leaking.map((issue: DataSecurityIssue): string => {
                return idOf({ id: issue.dataStoreId || null });
              }),
            ),
          ),
        ),
        kind: QueryHelper.any([...SERVICE_TELEMETRY_STORE_KINDS]),
        isArchived: false,
      },
      select: {
        _id: true,
        name: true,
        kind: true,
        provider: true,
        environment: true,
        sensitivity: true,
        serviceId: true,
        labels: { _id: true },
      },
      skip: 0,
      limit: MAX_TELEMETRY_ISSUES_READ,
      props: ROOT,
    });
    const storeById: Map<string, DataStore> = new Map(
      stores.map((store: DataStore): [string, DataStore] => {
        return [idOf(store), store];
      }),
    );
    const services: Map<
      string,
      { serviceId: string; issue: DataSecurityIssue; store: DataStore }
    > = new Map();

    // The issues come riskiest first: a service's first is its riskiest.
    for (const issue of leaking) {
      const store: DataStore | undefined = storeById.get(
        idOf({ id: issue.dataStoreId || null }),
      );
      const serviceId: string = store?.serviceId
        ? store.serviceId.toString().toLowerCase()
        : "";

      if (store && serviceId && !services.has(serviceId)) {
        services.set(serviceId, { serviceId, issue, store });
      }
    }

    return Array.from(services.values());
  }

  // One service's fixes, one per repository, each proposed as its work says.
  private static async proposeForService(data: {
    projectId: ObjectID;
    serviceId: ObjectID;
    riskiestIssue: DataSecurityIssue;
    riskiestStore: DataStore;
    rules: Array<AutoRemediationRule> | null;
    categoryOf: Map<string, string>;
    requireTwoApprovals: boolean;
    openedThisRun: Map<string, number>;
    now: Date;
  }): Promise<number> {
    const decided: {
      work: DataSecurityAiWorkDecision;
      llmProviderId: string;
    } | null = await TelemetryLeakFixProposals.decideFixWork({
      projectId: data.projectId,
      issue: data.riskiestIssue,
      store: data.riskiestStore,
      rules: data.rules,
      categoryOf: data.categoryOf,
    });

    if (!decided || decided.work.autonomy === DataSecurityAiAutonomy.Off) {
      return 0;
    }

    const work: DataSecurityAiWorkDecision = decided.work;

    const plans: Array<TelemetryLeakFixPlan> =
      await TelemetryLeakFix.planService({
        projectId: data.projectId,
        serviceId: data.serviceId,
        now: data.now,
      });
    let proposed: number = 0;

    for (const plan of plans) {
      const repositoryId: string = (plan.repository?.id || "").toLowerCase();

      if (
        repositoryId &&
        (await TelemetryLeakFix.findFixOnItsWay({
          projectId: data.projectId,
          serviceId: plan.serviceId,
          repositoryId,
        }))
      ) {
        continue;
      }

      const issue: DataSecurityIssue | null =
        await DataSecurityIssueService.findOneBy({
          query: {
            _id: plan.riskiestIssueId,
            projectId: data.projectId,
          },
          select: { _id: true, riskScore: true, dataStoreId: true },
          props: ROOT,
        });

      if (!issue?.id) {
        continue;
      }

      const verdict: DataSecurityAiWithoutAskingVerdict =
        await TelemetryLeakFixProposals.getVerdict({
          projectId: data.projectId,
          plan,
          work,
          requireTwoApprovals: data.requireTwoApprovals,
          openedThisRun: data.openedThisRun,
          now: data.now,
        });
      const change: DataSecurityAiPlannedChange =
        TelemetryLeakFixProposals.toChange({
          plan,
          work,
          llmProviderId: decided.llmProviderId,
        });
      const entry: DataSecurityAiDecisionEntry =
        await DataSecurityAiProposals.propose({
          projectId: data.projectId,
          issue,
          store: issue.dataStoreId
            ? await DataStoreService.findOneBy({
                query: { _id: issue.dataStoreId, projectId: data.projectId },
                select: { _id: true },
                props: ROOT,
              })
            : null,
          action: TelemetryLeakFixAction,
          change,
          work,
          verdict,
          riskScore: plan.riskScore,
          now: data.now,
        });

      if (
        entry.reason === DataSecurityAiDecisionReason.AppliedWithoutAsking &&
        repositoryId
      ) {
        data.openedThisRun.set(
          repositoryId,
          (data.openedThisRun.get(repositoryId) || 0) + 1,
        );
      }

      if (
        entry.reason === DataSecurityAiDecisionReason.Proposed ||
        entry.reason === DataSecurityAiDecisionReason.AppliedWithoutAsking
      ) {
        proposed++;
      }
    }

    return proposed;
  }

  /*
   * Whether a plan's pull request is opened without asking: the work's and
   * the change's verdict - a pull request is OpensPullRequest - then a
   * repository something decided, and the repository's cap on open AI pull
   * requests, the ones this run opened counted.
   */
  public static async getVerdict(data: {
    projectId: ObjectID;
    plan: TelemetryLeakFixPlan;
    work: DataSecurityAiWorkDecision;
    requireTwoApprovals: boolean;
    openedThisRun: Map<string, number>;
    now: Date;
  }): Promise<DataSecurityAiWithoutAskingVerdict> {
    const verdict: DataSecurityAiWithoutAskingVerdict =
      getDataSecurityAiWithoutAskingVerdict({
        work: data.work,
        safety: DataSecurityAiChangeSafety.OpensPullRequest,
        meetsDefaultConditions: false,
        isNamedByRule: false,
        requireTwoApprovalsForRiskierChanges: data.requireTwoApprovals,
        changesWithoutAskingThisHour:
          data.work.autonomy === DataSecurityAiAutonomy.WithoutAsking
            ? await DataSecurityAiEngine.countChangesWithoutAskingThisHour({
                projectId: data.projectId,
                now: data.now,
              })
            : 0,
      });

    if (!verdict.runWithoutAsking) {
      return verdict;
    }

    // Nothing decides where it goes: a person picks when they approve.
    if (!data.plan.repository) {
      return { runWithoutAsking: false, askReason: null };
    }

    const repository: CodeRepository | null =
      await CodeRepositoryService.findOneBy({
        query: { _id: data.plan.repository.id, projectId: data.projectId },
        select: { _id: true, maxOpenFixPullRequests: true },
        props: ROOT,
      });

    if (!repository?.id) {
      return { runWithoutAsking: false, askReason: null };
    }

    const cap: OpenPullRequestCapDecision =
      await OpenPullRequestCap.checkForRepository({
        codeRepositoryId: repository.id,
        configuredLimit: repository.maxOpenFixPullRequests ?? null,
      });
    const openedHere: number =
      data.openedThisRun.get(data.plan.repository.id.toLowerCase()) || 0;
    const counted: OpenPullRequestCapDecision = OpenPullRequestCap.evaluate({
      configuredLimit: repository.maxOpenFixPullRequests ?? null,
      openCount: cap.openCount + openedHere,
    });

    return counted.allowed
      ? verdict
      : {
          runWithoutAsking: false,
          askReason: DataSecurityAiAskReason.AtPullRequestCap,
        };
  }

  // A plan as the change a proposal shows: what, why, how it is proven and undone.
  public static toChange(data: {
    plan: TelemetryLeakFixPlan;
    work: DataSecurityAiWorkDecision;
    // The provider the deciding rules pick: the fix's run uses it.
    llmProviderId?: string | undefined;
  }): DataSecurityAiPlannedChange {
    const plan: TelemetryLeakFixPlan = data.plan;
    const issueCount: number = plan.issues.length;

    return {
      title: (issueCount > 1
        ? `Stop ${plan.serviceName || "a service"} writing sensitive data to its telemetry: one pull request for ${issueCount} issues`
        : `Stop ${plan.serviceName || "a service"} writing sensitive data to its telemetry`
      ).slice(0, 500),
      changeMarkdown: buildTelemetryFixPreview(plan),
      reasonMarkdown:
        mdText`A scrub rule hides a leak in OneUptime only: the code still writes it to every other place the service sends its telemetry. Data Security found where ${plan.serviceName || "the service"} writes each one, from the records it was seen in.`.toString(),
      proofMarkdown:
        "Once the pull request is merged and deployed, Data Security watches the service's new version, and each issue resolves as Fixed in code when the version writes the data no more.",
      undoMarkdown:
        "A pull request merges nothing by itself: close it in Code, or on its repository, to undo this.",
      plan: {
        serviceId: plan.serviceId,
        ...(plan.repository ? { repositoryId: plan.repository.id } : {}),
        issueIds: plan.issues.map((issue: { issueId: string }): string => {
          return issue.issueId;
        }),
        strategy: plan.decision.strategy,
        placeCount: plan.decision.placeCount,
        startFiles: plan.startFiles,
        fingerprint: plan.fingerprint,
        ...(data.llmProviderId && ObjectID.isValidUUID(data.llmProviderId)
          ? { llmProviderId: data.llmProviderId }
          : {}),
      },
      planKey: plan.planKey,
      safety: DataSecurityAiChangeSafety.OpensPullRequest,
      meetsDefaultConditions: false,
      isNamedByRule: false,
    };
  }

  /*
   * The Fix work for a service, as the project's AI rules decide it for its
   * riskiest issue - the defaults (Suggest) with no rule; null when the
   * rules could not be read, or none matches: nothing a rule may keep out
   * is proposed.
   */
  private static async decideFixWork(data: {
    projectId: ObjectID;
    issue: DataSecurityIssue;
    store: DataStore;
    rules: Array<AutoRemediationRule> | null;
    categoryOf: Map<string, string>;
  }): Promise<{
    work: DataSecurityAiWorkDecision;
    llmProviderId: string;
  } | null> {
    if (!data.rules) {
      return null;
    }

    const plan: DataSecurityAiPlan = decideDataSecurityAiWork({
      isAiEnabled: true,
      isAutomaticOn: true,
      rules: {
        rulesSetUp: data.rules.length > 0,
        matchingRules:
          data.rules.length > 0
            ? DataSecurityAiEngine.matchRules(
                data.rules,
                await DataSecurityAiEngine.readRuleIssue({
                  projectId: data.projectId,
                  issue: data.issue,
                  store: data.store,
                  categoryOf: data.categoryOf,
                }),
              )
            : [],
      },
      issue: { severity: data.issue.severity },
    });

    return plan.skip
      ? null
      : {
          work: plan.works[DataSecurityAiWork.Fix],
          llmProviderId: plan.llmProviderId,
        };
  }
}
